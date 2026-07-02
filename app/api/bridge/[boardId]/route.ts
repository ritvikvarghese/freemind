// Local canvas bridge — snapshot endpoint.
//
//   GET  /api/bridge/<boardId>   agent reads the latest pushed board snapshot
//   POST /api/bridge/<boardId>   the open tab pushes its current snapshot here
//
// boardId is the /b/<boardId> URL segment (the link you drop), so a board is
// selected by its link and multiple open boards get independent slots. The
// store is process-local and in-memory (lib/server/bridge.ts). Localhost-only:
// no-op on the public build (see assertLocalBridge).

import {
  assertLocalBridge,
  BridgeDisabledError,
  putSnapshot,
  readSnapshot,
} from "@/lib/server/bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ boardId: string }> };

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  try {
    assertLocalBridge(request);
  } catch (err) {
    return forbidden(err);
  }
  const { boardId } = await ctx.params;
  const { present, pushedAt, snapshot } = readSnapshot(boardId);
  return Response.json(
    { ok: true, boardId, present, pushedAt, snapshot },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  try {
    assertLocalBridge(request);
  } catch (err) {
    return forbidden(err);
  }
  const { boardId } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Bad JSON." }, { status: 400 });
  }
  const snapshot = (body as { snapshot?: unknown })?.snapshot;
  if (snapshot == null || typeof snapshot !== "object") {
    return Response.json(
      { ok: false, error: "Missing snapshot." },
      { status: 400 },
    );
  }
  putSnapshot(boardId, snapshot);
  return Response.json({ ok: true });
}

function forbidden(err: unknown): Response {
  const disabled = err instanceof BridgeDisabledError;
  return Response.json(
    { ok: false, error: disabled ? err.message : "Forbidden." },
    { status: disabled ? 404 : 403 },
  );
}
