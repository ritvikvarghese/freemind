// Local canvas bridge — write queue endpoint.
//
//   POST /api/bridge/<boardId>/writes   agent enqueues shapes/assets to create
//   GET  /api/bridge/<boardId>/writes   the open tab drains the queue (pop)
//
// Drain is a pop, so a command is handed to exactly one poller — that is the
// cross-tab guard: if a board is open in two tabs, only one applies a given
// command (and tldraw's IndexedDB sync mirrors the result to the other tab).
// Localhost-only, like the snapshot route (see assertLocalBridge).

import {
  assertLocalBridge,
  BridgeDisabledError,
  drainWrites,
  enqueueWrites,
  type BridgeWrite,
} from "@/lib/server/bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ boardId: string }> };

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
  const writes = (body as { writes?: unknown })?.writes;
  if (!Array.isArray(writes) || !writes.every(isWrite)) {
    return Response.json(
      { ok: false, error: "Expected { writes: BridgeWrite[] }." },
      { status: 400 },
    );
  }
  const queued = enqueueWrites(boardId, writes);
  return Response.json({ ok: true, queued });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  try {
    assertLocalBridge(request);
  } catch (err) {
    return forbidden(err);
  }
  const { boardId } = await ctx.params;
  return Response.json(
    { ok: true, writes: drainWrites(boardId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Minimal structural check: a command needs a dedupe id and a shape with a type.
function isWrite(w: unknown): w is BridgeWrite {
  if (typeof w !== "object" || w === null) return false;
  const { id, shape } = w as { id?: unknown; shape?: unknown };
  if (typeof id !== "string" || id.length === 0) return false;
  if (typeof shape !== "object" || shape === null) return false;
  return typeof (shape as { type?: unknown }).type === "string";
}

function forbidden(err: unknown): Response {
  const disabled = err instanceof BridgeDisabledError;
  return Response.json(
    { ok: false, error: disabled ? err.message : "Forbidden." },
    { status: disabled ? 404 : 403 },
  );
}
