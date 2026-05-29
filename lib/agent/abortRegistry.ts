"use client";

import { useSyncExternalStore } from "react";

// One concurrent run at a time. The registry holds the live AbortController
// (or null) and notifies subscribers when it changes so UI can disable the
// Run button + render a Cancel button on the active DocumentNode.

type Entry = {
  controller: AbortController;
  shapeId: string;
};

let active: Entry | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function beginRun(shapeId: string): AbortController {
  active?.controller.abort();
  const controller = new AbortController();
  active = { controller, shapeId };
  notify();
  return controller;
}

export function endRun(shapeId: string): void {
  if (active?.shapeId === shapeId) {
    active = null;
    notify();
  }
}

export function abortRun(shapeId: string): void {
  if (active?.shapeId === shapeId) {
    active.controller.abort();
    active = null;
    notify();
  }
}

export function getActiveShapeId(): string | null {
  return active?.shapeId ?? null;
}

export function isRunActive(): boolean {
  return active !== null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useActiveRun(): {
  shapeId: string | null;
  isActive: boolean;
} {
  const shapeId = useSyncExternalStore(
    subscribe,
    () => getActiveShapeId(),
    () => null,
  );
  return { shapeId, isActive: shapeId !== null };
}
