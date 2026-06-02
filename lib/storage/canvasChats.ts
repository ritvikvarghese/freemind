"use client";

import { openDB, type IDBPDatabase } from "idb";
import { useSyncExternalStore } from "react";
import type { AgentMode } from "@/lib/agent/modes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { ChatMessage } from "./chatTypes";
import type { CanvasChatRecord } from "./canvasChatTypes";
import { reportStorageError } from "./quotaToast";

/**
 * Per-canvas chat sessions. Separate IDB DB from the artifact-chat store
 * (`canvas-ai-chat-v1`) — different keys and lifecycles. Mirrors the
 * `connectors.ts` reactive discipline (frozen EMPTY + stable cached snapshots so
 * `useSyncExternalStore` never loops) and the `chatHistory.ts` IDB + `byBoard`
 * index pattern.
 */

const DB_NAME = "canvas-ai-canvas-chats-v1";
const STORE = "canvas-chats";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("canvasChats unavailable on server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("byBoard", "boardPersistenceKey");
        }
      },
    });
  }
  return dbPromise;
}

// --- reactive in-memory layer -------------------------------------------------

const EMPTY: readonly CanvasChatRecord[] = Object.freeze([]);
// Source of truth in memory. Object identity is the reactive signal: replacing a
// record (new ref) re-renders its `useCanvasChat` subscribers; rebuilding a
// board's array (new ref) re-renders its `useCanvasChats` subscribers.
const recordById = new Map<string, CanvasChatRecord>();
const cacheByBoard = new Map<string, CanvasChatRecord[]>();
const loadedBoards = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Rebuild a board's cached array (newest-active first). New reference each call,
// so only invoke it when that board's contents actually changed.
function rebuildBoard(boardKey: string): void {
  const arr: CanvasChatRecord[] = [];
  for (const rec of recordById.values()) {
    if (rec.boardPersistenceKey === boardKey) arr.push(rec);
  }
  arr.sort((a, b) => b.updatedAt - a.updatedAt);
  cacheByBoard.set(boardKey, arr);
}

function getBoardChats(boardKey: string): CanvasChatRecord[] {
  return (cacheByBoard.get(boardKey) as CanvasChatRecord[]) ?? (EMPTY as CanvasChatRecord[]);
}

async function persist(rec: CanvasChatRecord): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE, rec);
  } catch (err) {
    reportStorageError(err);
  }
}

// Debounced per-record persistence for the hot path (streaming message saves).
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function persistDebounced(id: string): void {
  const existing = persistTimers.get(id);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    id,
    setTimeout(() => {
      persistTimers.delete(id);
      const rec = recordById.get(id);
      if (rec) void persist(rec);
    }, 400),
  );
}

export async function ensureCanvasChatsLoaded(boardKey: string): Promise<void> {
  if (loadedBoards.has(boardKey)) return;
  loadedBoards.add(boardKey);
  try {
    const db = await getDb();
    const recs = (await db.getAllFromIndex(
      STORE,
      "byBoard",
      boardKey,
    )) as CanvasChatRecord[];
    let touched = false;
    for (const rec of recs) {
      // Don't clobber an in-memory record that may be newer (mid-stream).
      if (!recordById.has(rec.id)) {
        recordById.set(rec.id, rec);
        touched = true;
      }
    }
    if (touched || !cacheByBoard.has(boardKey)) {
      rebuildBoard(boardKey);
      notify();
    }
  } catch (err) {
    reportStorageError(err);
  }
}

export function createCanvasChat(input: {
  boardPersistenceKey: string;
  title: string;
  mode: AgentMode;
  sources: SourceSnapshot[];
  sourceIds: string[];
}): CanvasChatRecord {
  const now = Date.now();
  const rec: CanvasChatRecord = {
    id: crypto.randomUUID(),
    boardPersistenceKey: input.boardPersistenceKey,
    title: input.title,
    mode: input.mode,
    sources: input.sources,
    sourceIds: input.sourceIds,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  recordById.set(rec.id, rec);
  rebuildBoard(rec.boardPersistenceKey);
  notify();
  void persist(rec);
  return rec;
}

export async function loadCanvasChat(
  id: string,
): Promise<CanvasChatRecord | null> {
  const inMemory = recordById.get(id);
  if (inMemory) return inMemory;
  try {
    const db = await getDb();
    const rec = (await db.get(STORE, id)) as CanvasChatRecord | undefined;
    if (!rec) return null;
    recordById.set(rec.id, rec);
    rebuildBoard(rec.boardPersistenceKey);
    notify();
    return rec;
  } catch (err) {
    reportStorageError(err);
    return null;
  }
}

export function saveCanvasChatMessages(id: string, messages: ChatMessage[]): void {
  const prev = recordById.get(id);
  if (!prev) return;
  const next: CanvasChatRecord = {
    ...prev,
    messages,
    updatedAt: Date.now(),
  };
  recordById.set(id, next);
  rebuildBoard(next.boardPersistenceKey);
  notify();
  persistDebounced(id);
}

/** Append sources to an existing chat (dedup by id). Used when the user adds
 *  more canvas context to an open chat — later turns include them. */
export function addSourcesToCanvasChat(
  id: string,
  sources: SourceSnapshot[],
  sourceIds: string[],
): void {
  const prev = recordById.get(id);
  if (!prev) return;
  const have = new Set(prev.sourceIds);
  const addSources = sources.filter((s) => !have.has(s.id));
  const addIds = sourceIds.filter((sid) => !have.has(sid));
  if (addSources.length === 0 && addIds.length === 0) return;
  const next: CanvasChatRecord = {
    ...prev,
    sources: [...prev.sources, ...addSources],
    sourceIds: [...prev.sourceIds, ...addIds],
    updatedAt: Date.now(),
  };
  recordById.set(id, next);
  rebuildBoard(next.boardPersistenceKey);
  notify();
  void persist(next);
}

/** Update the chat's reasoning mode (e.g. user switches to Deepsearch). */
export function setCanvasChatMode(id: string, mode: AgentMode): void {
  const prev = recordById.get(id);
  if (!prev || prev.mode === mode) return;
  const next: CanvasChatRecord = { ...prev, mode, updatedAt: Date.now() };
  recordById.set(id, next);
  rebuildBoard(next.boardPersistenceKey);
  notify();
  persistDebounced(id);
}

export function renameCanvasChat(id: string, title: string): void {
  const prev = recordById.get(id);
  const trimmed = title.trim();
  if (!prev || !trimmed || prev.title === trimmed) return;
  const next: CanvasChatRecord = { ...prev, title: trimmed, updatedAt: Date.now() };
  recordById.set(id, next);
  rebuildBoard(next.boardPersistenceKey);
  notify();
  void persist(next);
}

export function deleteCanvasChat(id: string): void {
  const rec = recordById.get(id);
  if (!rec) return;
  recordById.delete(id);
  rebuildBoard(rec.boardPersistenceKey);
  notify();
  void (async () => {
    try {
      const db = await getDb();
      await db.delete(STORE, id);
    } catch (err) {
      reportStorageError(err);
    }
  })();
}

/** Drop every canvas chat tied to a board (board deletion cascade). */
export async function deleteCanvasChatsForBoard(boardKey: string): Promise<void> {
  for (const [id, rec] of recordById) {
    if (rec.boardPersistenceKey === boardKey) recordById.delete(id);
  }
  cacheByBoard.delete(boardKey);
  loadedBoards.delete(boardKey);
  notify();
  try {
    const db = await getDb();
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.store.index("byBoard");
    let cursor = await index.openCursor(boardKey);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (err) {
    reportStorageError(err);
  }
}

export function useCanvasChats(boardKey: string | null): CanvasChatRecord[] {
  return useSyncExternalStore(
    subscribe,
    () => (boardKey ? getBoardChats(boardKey) : (EMPTY as CanvasChatRecord[])),
    () => EMPTY as CanvasChatRecord[],
  );
}

export function useCanvasChat(id: string | null): CanvasChatRecord | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? recordById.get(id) ?? null : null),
    () => null,
  );
}
