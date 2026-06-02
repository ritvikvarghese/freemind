"use client";

import { useSyncExternalStore } from "react";
import { reportStorageError } from "./quotaToast";
import { deleteChatHistoriesForBoard } from "./chatHistory";
import { deleteConnectorsForBoard } from "./connectors";
import { deleteCanvasChatsForBoard } from "./canvasChats";

// One workspace = one Board. tldraw stores its IndexedDB data under
// `persistenceKey`, so each board gets its own isolated store. We keep that
// key as a stored field (not derived) so the existing `canvas-ai-v1` data is
// adopted as a seeded "Default" board with zero IDB migration. See plan
// docs/plans/2026-05-21-001-feat-multi-board-home-page-plan.md.

export type Board = {
  id: string;
  title: string;
  persistenceKey: string;
  createdAt: number; // epoch ms
};

const STORAGE_KEY = "canvas-ai:boards";

const LEGACY_BOARD: Board = {
  id: "legacy",
  title: "Default",
  persistenceKey: "canvas-ai-v1",
  createdAt: 0, // unknown — pre-dates the createdAt field
};

const listeners = new Set<() => void>();

// Cached snapshot. `useSyncExternalStore` requires getSnapshot() to return
// the same reference between calls until something actually changes — without
// this cache we'd return a fresh array each call and React would infinite-loop.
let cache: Board[] | null = null;

function notify() {
  for (const cb of listeners) cb();
}

function readRaw(): Board[] | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v == null) return null;
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return null;
    // Backfill createdAt for boards saved before the field existed. Stamping
    // with Date.now() at first sight is a small lie (they're older than that)
    // but it's stable thereafter and beats showing nothing.
    const now = Date.now();
    let mutated = false;
    const boards = (parsed as Partial<Board>[]).map((b) => {
      if (typeof b.createdAt === "number") return b as Board;
      mutated = true;
      return { ...b, createdAt: now } as Board;
    });
    if (mutated) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
      } catch (err) {
        reportStorageError(err);
      }
    }
    return boards;
  } catch {
    return null;
  }
}

function writeRaw(boards: Board[]): void {
  cache = boards;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch (err) {
    reportStorageError(err);
  }
  notify();
}

export function getBoards(): Board[] {
  if (cache !== null) return cache;
  const raw = readRaw();
  if (raw != null) {
    cache = raw;
    return cache;
  }
  // First run on the client — adopt the existing canvas-ai-v1 store as a real
  // board record. Defer the localStorage write to a microtask so we don't
  // mutate during a React render pass (which would re-trigger getSnapshot).
  cache = [LEGACY_BOARD];
  if (typeof window !== "undefined") {
    queueMicrotask(() => {
      // Only write if nothing was inserted in the meantime (e.g. by another
      // tab via the storage event).
      if (window.localStorage.getItem(STORAGE_KEY) == null) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        } catch (err) {
          reportStorageError(err);
        }
      }
    });
  }
  return cache;
}

export function getBoard(id: string): Board | undefined {
  return getBoards().find((b) => b.id === id);
}

export function createBoard(title: string): Board {
  const id = crypto.randomUUID();
  const trimmed = title.trim() || "Untitled";
  const board: Board = {
    id,
    title: trimmed,
    persistenceKey: `canvas-ai-board:${id}`,
    createdAt: Date.now(),
  };
  writeRaw([board, ...getBoards()]);
  return board;
}

// Delete a board: remove it from the list AND drop the tldraw IndexedDB
// databases keyed off its persistenceKey. Without the IDB cleanup, deleting a
// board just hides it — the underlying store (potentially many MB) stays on
// disk forever. The legacy asset DB name predates v2 docs but tldraw still
// writes one in some flows, so we delete both to be safe. No-op if the board
// doesn't exist. Caller is responsible for confirming with the user.
export function deleteBoard(id: string): void {
  const boards = getBoards();
  const target = boards.find((b) => b.id === id);
  if (!target) return;
  writeRaw(boards.filter((b) => b.id !== id));
  if (typeof window !== "undefined" && "indexedDB" in window) {
    // Fire-and-forget: a failed deleteDatabase still leaves the board removed
    // from the list, which is the user-visible outcome they asked for.
    window.indexedDB.deleteDatabase(`TLDRAW_DOCUMENT_v2${target.persistenceKey}`);
    window.indexedDB.deleteDatabase(
      `TLDRAW_ASSET_STORE_v1${target.persistenceKey}`,
    );
  }
  // Clear chat histories tied to this board's artifacts. Fire-and-forget — the
  // board is gone from the user's view regardless.
  void deleteChatHistoriesForBoard(target.persistenceKey);
  // Same for manual connectors stored against this board's persistenceKey.
  void deleteConnectorsForBoard(target.persistenceKey);
  // And the per-canvas chat sessions (canvas-ai-canvas-chats-v1).
  void deleteCanvasChatsForBoard(target.persistenceKey);
}

// Rename a board. No-op if the title is unchanged, the board doesn't exist,
// or the new title trims to empty (we don't allow "Untitled-by-typo"). The
// board's persistenceKey is preserved so the tldraw store stays intact.
export function renameBoard(id: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const boards = getBoards();
  const next = boards.map((b) =>
    b.id === id ? { ...b, title: trimmed } : b,
  );
  // Skip the write if nothing actually changed (saves a notify + storage hit).
  const changed = next.some((b, i) => b.title !== boards[i].title);
  if (!changed) return;
  writeRaw(next);
}

// Persist a manual ordering of the board list. `orderedIds` is the desired
// order; any board id missing from it is appended (defensive — keeps boards
// that raced in from another tab). Pure reorder — createdAt and every other
// field is untouched, so the displayed dates don't change. No-op if the order
// is already identical.
export function reorderBoards(orderedIds: string[]): void {
  const boards = getBoards();
  const byId = new Map(boards.map((b) => [b.id, b]));
  const next: Board[] = [];
  for (const id of orderedIds) {
    const b = byId.get(id);
    if (b) {
      next.push(b);
      byId.delete(id);
    }
  }
  for (const b of byId.values()) next.push(b); // any not listed
  if (next.length === boards.length && next.every((b, i) => b.id === boards[i].id)) {
    return;
  }
  writeRaw(next);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null; // invalidate; next getSnapshot re-reads
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: Board[] = [];

export function useBoards(): Board[] {
  return useSyncExternalStore(subscribe, getBoards, () => EMPTY);
}
