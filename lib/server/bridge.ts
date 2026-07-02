// In-memory mailbox for the local canvas bridge. The open board tab pushes its
// tldraw snapshot here on every (debounced) change and drains a queue of write
// commands; a terminal agent reads the snapshot and enqueues writes. Flow is
// always tab <-> mailbox <-> agent — the browser is the only thing that can see
// IndexedDB, so it relays through this process-local store.
//
// State is module-level (one Map per dev process), exactly like rateLimit.ts.
// That is the right scope: a single local user, one running `pnpm dev`/`pnpm
// use`. Nothing here is durable — restart the server and the slots are empty
// until the tab pushes again, which it does on mount.
//
// LOCAL ONLY. assertLocalBridge() refuses on the public Railway build and off
// loopback, so this never becomes a public surface (see the bridge plan).

import { GuardError } from "./guardFetch";

/** Thrown when the bridge is reached on a non-local / public deployment. */
export class BridgeDisabledError extends GuardError {}

// A shape the tab is asked to create. `id` is a client-unique command id used to
// dedupe across overlapping polls / two tabs (drain already pops, this is belt
// and suspenders). `assets` are created before the shape that references them.
export type BridgeAsset = {
  id: string; // tldraw asset id, e.g. "asset:abc123"
  type: "image";
  props: Record<string, unknown>; // mimeType, src (data URL), w, h, name, ...
};

export type BridgeWrite = {
  id: string; // command id (dedupe key), NOT the shape id
  shape: {
    type: string; // "text", "canvas-ai-document", "design-preview", ...
    x?: number;
    y?: number;
    props?: Record<string, unknown>;
  };
  assets?: BridgeAsset[];
};

type Slot = {
  snapshot: unknown | null; // tldraw document snapshot ({ store, schema })
  pushedAt: number | null; // ms epoch of the last push, null if never
  writes: BridgeWrite[]; // pending commands for the tab to apply
};

const slots = new Map<string, Slot>();

function slotFor(boardId: string): Slot {
  let slot = slots.get(boardId);
  if (!slot) {
    slot = { snapshot: null, pushedAt: null, writes: [] };
    slots.set(boardId, slot);
  }
  return slot;
}

/** Tab -> mailbox: store the latest snapshot for a board. */
export function putSnapshot(boardId: string, snapshot: unknown): void {
  const slot = slotFor(boardId);
  slot.snapshot = snapshot;
  slot.pushedAt = Date.now();
}

/** Agent -> mailbox: the latest snapshot, or a not-present marker. */
export function readSnapshot(boardId: string): {
  present: boolean;
  pushedAt: number | null;
  snapshot: unknown | null;
} {
  const slot = slots.get(boardId);
  if (!slot || slot.snapshot === null) {
    return { present: false, pushedAt: null, snapshot: null };
  }
  return { present: true, pushedAt: slot.pushedAt, snapshot: slot.snapshot };
}

/** Agent -> mailbox: enqueue write commands; returns the new queue depth. */
export function enqueueWrites(boardId: string, writes: BridgeWrite[]): number {
  const slot = slotFor(boardId);
  slot.writes.push(...writes);
  return slot.writes.length;
}

/** Tab -> mailbox: take and clear all pending commands (drain == pop). */
export function drainWrites(boardId: string): BridgeWrite[] {
  const slot = slots.get(boardId);
  if (!slot || slot.writes.length === 0) return [];
  const pending = slot.writes;
  slot.writes = [];
  return pending;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Gate every bridge request to local use only. Two independent checks so a
 * misconfiguration can't open it: (1) refuse outright on the public build
 * (Railway injects RAILWAY_GIT_COMMIT_SHA), (2) require a loopback Host. The
 * agent calls these routes from the terminal with no Origin/Referer, so we
 * deliberately do NOT use assertSameOrigin here — the loopback Host is the
 * boundary.
 */
export function assertLocalBridge(request: Request): void {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    throw new BridgeDisabledError("Bridge is disabled on the public build.");
  }
  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  ).trim();
  // Strip a trailing :port and any IPv6 brackets, e.g. "[::1]:3000" -> "::1".
  const hostname = host
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (!LOOPBACK.has(hostname)) {
    throw new BridgeDisabledError("Bridge is localhost-only.");
  }
}
