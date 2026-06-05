"use client";

import { useSyncExternalStore } from "react";
import type { Editor, TLShapeId } from "tldraw";
import {
  getCurrentBoardPersistenceKey,
} from "@/lib/storage/currentBoard";

let openShapeId: TLShapeId | null = null;
const listeners = new Set<() => void>();

// Persist which document/upload is open in focus mode, scoped to its board, so
// a reload lands the user back where they were instead of dropping to the bare
// canvas. Cleared when focus is closed, so closing then reloading shows the
// canvas as expected.
const STORAGE_KEY = "canvas-ai:last-focus";

function persistOpen(id: TLShapeId): void {
  try {
    const boardKey = getCurrentBoardPersistenceKey();
    if (!boardKey) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boardKey, shapeId: id }));
  } catch {
    // localStorage unavailable / quota — restore is best-effort.
  }
}

function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function notify() {
  for (const cb of listeners) cb();
}

export function openFocus(id: TLShapeId): void {
  openShapeId = id;
  persistOpen(id);
  notify();
}

export function closeFocus(): void {
  openShapeId = null;
  clearPersisted();
  notify();
}

/**
 * Reopen the last focused shape after a reload, if it belonged to the board now
 * mounting and still exists. Returns "retry" when the entry matches this board
 * but the shape isn't in the store yet (persisted shapes can load just after
 * onMount), so the caller can poll briefly. "skip" means nothing to restore;
 * "done" means it reopened.
 */
export function restoreFocus(editor: Editor): "done" | "retry" | "skip" {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return "skip";
  }
  if (!raw) return "skip";
  let parsed: { boardKey?: string; shapeId?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPersisted();
    return "skip";
  }
  const boardKey = getCurrentBoardPersistenceKey();
  if (!parsed.shapeId || parsed.boardKey !== boardKey) return "skip";
  const id = parsed.shapeId as TLShapeId;
  if (!editor.getShape(id)) return "retry";
  openFocus(id);
  return "done";
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
