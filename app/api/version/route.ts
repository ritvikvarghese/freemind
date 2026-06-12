// Reports the currently-deployed build identity so an already-open tab can
// detect that a newer version has shipped (see components/VersionWatcher.tsx).
// Railway injects RAILWAY_GIT_COMMIT_SHA at build and runtime; the client bakes
// the same value as NEXT_PUBLIC_BUILD_SHA at build time and compares the two.
// Empty locally (no Railway vars), which makes the watcher a no-op.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
  return Response.json(
    { sha },
    { headers: { "Cache-Control": "no-store" } },
  );
}
