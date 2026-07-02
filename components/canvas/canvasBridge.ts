// Client half of the local canvas bridge. While a board is open on localhost,
// the tab pushes its tldraw snapshot to the in-memory mailbox on every debounced
// change (so a terminal agent can read the live board), and polls the mailbox
// for write commands to apply (so the agent can draw shapes back onto the open
// canvas). The browser is the only thing that can see IndexedDB; this is what
// makes it the bridge. See lib/server/bridge.ts and the bridge plan.
//
// Disabled outside local use: the public build bakes NEXT_PUBLIC_BUILD_SHA and
// is served off a non-loopback host, either of which makes this a no-op.

import {
  createShapeId,
  type Editor,
  type TLAsset,
  type TLShape,
  type TLShapePartial,
} from "tldraw";

const PUSH_DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 1000;

// One write command from an agent: a shape to create, plus any assets it
// references (created first). Mirrors BridgeWrite in lib/server/bridge.ts.
type IncomingWrite = {
  id: string;
  shape: { type: string; x?: number; y?: number; props?: Record<string, unknown> };
  assets?: { id: string; type: "image"; props: Record<string, unknown> }[];
};

/** Local-only: never run on the public build or off a loopback host. */
function bridgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_BUILD_SHA) return false; // public Railway build
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Wire a board's tab to the mailbox. Returns a disposer (call on unmount). A
 * no-op returning a no-op when the bridge is disabled, so callers can wire it
 * unconditionally.
 */
export function startCanvasBridge(editor: Editor, boardId: string): () => void {
  if (!bridgeEnabled()) return () => {};

  const base = `/api/bridge/${encodeURIComponent(boardId)}`;
  let disposed = false;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const pushSnapshot = async () => {
    if (disposed) return;
    try {
      // document only (records + schema); session/presence is tab-local noise.
      const { document } = editor.getSnapshot();
      await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: document }),
      });
    } catch {
      // Mailbox unreachable (server restart, etc.) — the next change retries.
    }
  };

  const schedulePush = () => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushSnapshot, PUSH_DEBOUNCE_MS);
  };

  // Re-push whenever document records change (shapes, assets, bindings).
  const unlisten = editor.store.listen(schedulePush, { scope: "document" });
  // Push once now so the agent sees the current board without waiting for an edit.
  void pushSnapshot();

  // --- Write-back: poll the queue, apply commands the agent enqueued. ---

  // Command ids already applied by THIS tab, so an overlapping poll or a
  // re-delivery never creates a shape twice. (Cross-tab is handled server-side:
  // draining the queue pops, so each command reaches only one tab.)
  const applied = new Set<string>();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const applyWrites = (writes: IncomingWrite[]) => {
    const fresh = writes.filter((w) => !applied.has(w.id));
    if (fresh.length === 0) return;
    editor.run(() => {
      for (const w of fresh) {
        applied.add(w.id);
        if (w.assets?.length) {
          editor.createAssets(
            w.assets.map(
              (a) =>
                ({
                  id: a.id,
                  typeName: "asset",
                  type: a.type,
                  props: a.props,
                  meta: {},
                }) as unknown as TLAsset,
            ),
          );
        }
        editor.createShape({
          id: createShapeId(),
          type: w.shape.type,
          x: w.shape.x,
          y: w.shape.y,
          props: w.shape.props,
        } as TLShapePartial<TLShape>);
      }
    });
  };

  const poll = async () => {
    if (disposed) return;
    try {
      const res = await fetch(`${base}/writes`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { writes?: IncomingWrite[] };
        if (data.writes?.length) applyWrites(data.writes);
      }
    } catch {
      // Mailbox unreachable — try again next tick.
    } finally {
      if (!disposed) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  void poll();

  // Background tabs throttle setTimeout, so a queued write can sit for seconds
  // until the tab is refocused. When the tab becomes visible or regains focus,
  // cancel the pending tick and poll now so queued writes apply on return.
  const flushPoll = () => {
    if (disposed || document.visibilityState === "hidden") return;
    if (pollTimer) clearTimeout(pollTimer);
    void poll();
  };
  document.addEventListener("visibilitychange", flushPoll);
  window.addEventListener("focus", flushPoll);

  return () => {
    disposed = true;
    if (pushTimer) clearTimeout(pushTimer);
    if (pollTimer) clearTimeout(pollTimer);
    document.removeEventListener("visibilitychange", flushPoll);
    window.removeEventListener("focus", flushPoll);
    unlisten();
  };
}
