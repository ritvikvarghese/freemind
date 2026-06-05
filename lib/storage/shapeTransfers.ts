"use client";

// "Duplicate to another canvas": the target board may not be mounted, so we
// don't write into its tldraw store directly (fragile). Instead we queue the
// shape here and the target board materializes it the next time it mounts (see
// CanvasRoot onMount). Our custom shapes store their content inline in props
// (markdown / fullText / dataUrl), so {type, props} is fully self-contained.

const KEY = "canvas-ai:shape-transfers";

export type ShapeTransfer = {
  type: string;
  props: Record<string, unknown>;
};

function readAll(): Record<string, ShapeTransfer[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, ShapeTransfer[]>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full/blocked — the duplicate just won't land; non-fatal */
  }
}

/** Queue a shape to appear on the board with `targetPersistenceKey`. */
export function queueShapeTransfer(
  targetPersistenceKey: string,
  payload: ShapeTransfer,
): void {
  const all = readAll();
  (all[targetPersistenceKey] ??= []).push(payload);
  writeAll(all);
}

/** Drain (return + clear) the shapes queued for a board. */
export function takeShapeTransfers(
  targetPersistenceKey: string,
): ShapeTransfer[] {
  const all = readAll();
  const list = all[targetPersistenceKey] ?? [];
  if (list.length) {
    delete all[targetPersistenceKey];
    writeAll(all);
  }
  return list;
}
