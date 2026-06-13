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

// Give focus its own browser-history entry so the Back button returns to the
// canvas (closing focus) instead of skipping past it to wherever the canvas was
// opened from. We push a tagged entry on open and consume it on close; the
// popstate handler closes focus when the user navigates Back onto the canvas.
// Next 16 supports the native History API for this (it merges with router state).
const FOCUS_STATE_KEY = "__fmFocus";
let focusHistoryActive = false;

function clearFocusState(): void {
  openShapeId = null;
  clearPersisted();
  notify();
}

function handlePopState(): void {
  if (!focusHistoryActive) return;
  // Our focus entry was popped (Back/forward) — close focus, and do NOT touch
  // history again (the entry is already gone).
  focusHistoryActive = false;
  if (openShapeId !== null) clearFocusState();
}

function pushFocusHistory(): void {
  if (typeof window === "undefined" || focusHistoryActive) return;
  window.addEventListener("popstate", handlePopState);
  try {
    window.history.pushState(
      { ...(window.history.state ?? {}), [FOCUS_STATE_KEY]: true },
      "",
    );
    focusHistoryActive = true;
  } catch {
    // History API blocked — Back just won't return to the canvas; non-fatal.
  }
}

export function openFocus(id: TLShapeId): void {
  openShapeId = id;
  persistOpen(id);
  pushFocusHistory();
  notify();
}

export function closeFocus(): void {
  // If we own a pushed history entry, step back to consume it; handlePopState
  // finishes the close so Back and the in-app close stay symmetric. Otherwise
  // (no entry, e.g. History API blocked) close directly.
  if (focusHistoryActive && typeof window !== "undefined") {
    window.history.back();
    return;
  }
  clearFocusState();
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
