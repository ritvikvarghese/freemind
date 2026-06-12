"use client";

import { openDB, type IDBPDatabase } from "idb";
import { useSyncExternalStore } from "react";
import type { AgentMode } from "@/lib/agent/modes";
import type { TLShapeId } from "tldraw";
import type { ChatMessage } from "./chatTypes";
import type { DocumentChatRecord } from "./documentChatTypes";
import { loadChatHistory } from "./chatHistory";
import { reportStorageError } from "./quotaToast";

/**
 * Per-document chat sessions. Mirrors `canvasChats.ts` (same reactive discipline:
 * frozen EMPTY + stable cached snapshots so `useSyncExternalStore` never loops),
 * but scoped by `documentId` instead of a board. A separate IDB DB keeps it
 * independent from the canvas-chat and legacy artifact-chat stores.
 */

const DB_NAME = "canvas-ai-document-chats-v1";
const STORE = "document-chats";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("documentChats unavailable on server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("byDocument", "documentId");
          store.createIndex("byBoard", "boardPersistenceKey");
        }
      },
    });
  }
  return dbPromise;
}

// --- reactive in-memory layer -------------------------------------------------

const EMPTY: readonly DocumentChatRecord[] = Object.freeze([]);
const recordById = new Map<string, DocumentChatRecord>();
const cacheByDocument = new Map<string, DocumentChatRecord[]>();
const loadedDocuments = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Rebuild a document's cached array (newest-active first). New reference each
// call, so only invoke it when that document's contents actually changed.
function rebuildDocument(documentId: string): void {
  const arr: DocumentChatRecord[] = [];
  for (const rec of recordById.values()) {
    if (rec.documentId === documentId) arr.push(rec);
  }
  arr.sort((a, b) => b.updatedAt - a.updatedAt);
  cacheByDocument.set(documentId, arr);
}

function getDocumentChats(documentId: string): DocumentChatRecord[] {
  return (
    (cacheByDocument.get(documentId) as DocumentChatRecord[]) ??
    (EMPTY as DocumentChatRecord[])
  );
}

async function persist(rec: DocumentChatRecord): Promise<void> {
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

export async function ensureDocumentChatsLoaded(
  documentId: string,
): Promise<void> {
  if (loadedDocuments.has(documentId)) return;
  loadedDocuments.add(documentId);
  try {
    const db = await getDb();
    const recs = (await db.getAllFromIndex(
      STORE,
      "byDocument",
      documentId,
    )) as DocumentChatRecord[];
    let touched = false;
    for (const rec of recs) {
      if (!recordById.has(rec.id)) {
        recordById.set(rec.id, rec);
        touched = true;
      }
    }
    if (touched || !cacheByDocument.has(documentId)) {
      rebuildDocument(documentId);
      notify();
    }
  } catch (err) {
    reportStorageError(err);
  }
}

/**
 * Create the record for an already-allocated session id if it doesn't exist
 * yet (returns the existing one otherwise). The panel opens a "draft" with a
 * fresh id but only calls this on the FIRST sent message, so a chat never
 * counts or shows in the list until the user has actually prompted.
 */
export function ensureDocumentChat(input: {
  id: string;
  documentId: string;
  boardPersistenceKey: string;
  title: string;
  mode: AgentMode;
}): DocumentChatRecord {
  const existing = recordById.get(input.id);
  if (existing) return existing;
  const now = Date.now();
  const rec: DocumentChatRecord = {
    id: input.id,
    documentId: input.documentId,
    boardPersistenceKey: input.boardPersistenceKey,
    title: input.title,
    mode: input.mode,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  recordById.set(rec.id, rec);
  rebuildDocument(rec.documentId);
  notify();
  void persist(rec);
  return rec;
}

export async function loadDocumentChat(
  id: string,
): Promise<DocumentChatRecord | null> {
  const inMemory = recordById.get(id);
  if (inMemory) return inMemory;
  try {
    const db = await getDb();
    const rec = (await db.get(STORE, id)) as DocumentChatRecord | undefined;
    if (!rec) return null;
    recordById.set(rec.id, rec);
    rebuildDocument(rec.documentId);
    notify();
    return rec;
  } catch (err) {
    reportStorageError(err);
    return null;
  }
}

export function saveDocumentChatMessages(
  id: string,
  messages: ChatMessage[],
): void {
  const prev = recordById.get(id);
  if (!prev) return;
  const next: DocumentChatRecord = { ...prev, messages, updatedAt: Date.now() };
  recordById.set(id, next);
  rebuildDocument(next.documentId);
  notify();
  persistDebounced(id);
}

export function setDocumentChatMode(id: string, mode: AgentMode): void {
  const prev = recordById.get(id);
  if (!prev || prev.mode === mode) return;
  const next: DocumentChatRecord = { ...prev, mode, updatedAt: Date.now() };
  recordById.set(id, next);
  rebuildDocument(next.documentId);
  notify();
  persistDebounced(id);
}

export function deleteDocumentChat(id: string): void {
  const rec = recordById.get(id);
  if (!rec) return;
  recordById.delete(id);
  rebuildDocument(rec.documentId);
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

/** Cascade: drop every document chat tied to a board (board deletion). */
export async function deleteDocumentChatsForBoard(
  boardKey: string,
): Promise<void> {
  const touchedDocs = new Set<string>();
  for (const [id, rec] of recordById) {
    if (rec.boardPersistenceKey === boardKey) {
      touchedDocs.add(rec.documentId);
      recordById.delete(id);
    }
  }
  for (const d of touchedDocs) {
    cacheByDocument.delete(d);
    loadedDocuments.delete(d);
  }
  notify();
  try {
    const db = await getDb();
    const tx = db.transaction(STORE, "readwrite");
    let cursor = await tx.store.index("byBoard").openCursor(boardKey);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (err) {
    reportStorageError(err);
  }
}

/**
 * One-time migration: if a document has no sessions yet but carried a legacy
 * single chat (from `chatHistory.ts`), import those messages as its first
 * session so no history is lost. Idempotent (only runs when the doc has zero
 * sessions and the legacy thread is non-empty).
 */
export async function migrateLegacyDocumentChat(
  documentId: TLShapeId,
  boardPersistenceKey: string,
): Promise<void> {
  await ensureDocumentChatsLoaded(documentId);
  if (getDocumentChats(documentId).length > 0) return;
  const legacy = await loadChatHistory(documentId);
  if (legacy.length === 0) return;
  const now = Date.now();
  const rec: DocumentChatRecord = {
    id: crypto.randomUUID(),
    documentId,
    boardPersistenceKey,
    title: "Chat",
    mode: "freeform",
    messages: legacy,
    createdAt: now,
    updatedAt: now,
  };
  recordById.set(rec.id, rec);
  rebuildDocument(documentId);
  notify();
  void persist(rec);
}

export function useDocumentChats(
  documentId: string | null,
): DocumentChatRecord[] {
  return useSyncExternalStore(
    subscribe,
    () =>
      documentId
        ? getDocumentChats(documentId)
        : (EMPTY as DocumentChatRecord[]),
    () => EMPTY as DocumentChatRecord[],
  );
}

export function useDocumentChat(id: string | null): DocumentChatRecord | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (recordById.get(id) ?? null) : null),
    () => null,
  );
}
