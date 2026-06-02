"use client";

import { useSyncExternalStore } from "react";
import type { TLShapeId } from "tldraw";

let openShapeId: TLShapeId | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function openFocus(id: TLShapeId): void {
  openShapeId = id;
  notify();
}

export function closeFocus(): void {
  openShapeId = null;
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useFocusShapeId(): TLShapeId | null {
  return useSyncExternalStore(
    subscribe,
    () => openShapeId,
    () => null,
  );
}
