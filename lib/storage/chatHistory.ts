"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { TLShapeId } from "tldraw";
import type { ChatMessage, ChatRecord } from "./chatTypes";
import { reportStorageError } from "./quotaToast";

const DB_NAME = "canvas-ai-chat-v1";
const STORE = "chat-history";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("chatHistory unavailable on server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "artifactId" });
          store.createIndex("byBoard", "boardPersistenceKey");
        }
      },
    });
  }
  return dbPromise;
}

export async function loadChatHistory(
  artifactId: TLShapeId,
): Promise<ChatMessage[]> {
  try {
    const db = await getDb();
    const rec = (await db.get(STORE, artifactId as unknown as string)) as
      | ChatRecord
      | undefined;
    return rec?.messages ?? [];
  } catch (err) {
    reportStorageError(err);
    return [];
  }
}

export async function saveChatHistory(
  artifactId: TLShapeId,
  boardPersistenceKey: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const db = await getDb();
    const rec: ChatRecord = {
      artifactId,
      boardPersistenceKey,
      messages,
      updatedAt: Date.now(),
    };
    await db.put(STORE, rec);
  } catch (err) {
    reportStorageError(err);
  }
}

/**
 * Drop every chat-history record tied to a board's persistenceKey. Called from
 * `deleteBoard` so deleting a board doesn't leave orphan chat blobs in IDB.
 */
export async function deleteChatHistoriesForBoard(
  boardPersistenceKey: string,
): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.store.index("byBoard");
    let cursor = await index.openCursor(boardPersistenceKey);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (err) {
    reportStorageError(err);
  }
}
