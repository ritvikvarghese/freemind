"use client";

import { openDB, type IDBPDatabase } from "idb";
import { useSyncExternalStore } from "react";
import { reportStorageError } from "./quotaToast";
import { markPulse } from "@/lib/canvas/pulse";

/**
 * Manual, visual-only connectors between two nodes — a thinking aid, not an AI
 * relationship (unlike the auto provenance lines, which feed source -> doc).
 * Persisted per board in IDB, mirroring the chatHistory.ts pattern, with a tiny
 * reactive in-memory layer so the overlay re-renders on add/remove.
 */
export type Connector = { id: string; fromId: string; toId: string };

const DB_NAME = "canvas-ai-connectors-v1";
const STORE = "connectors";
const DB_VERSION = 1;

type BoardRecord = {
  boardPersistenceKey: string;
  connectors: Connector[];
  updatedAt: number;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("connectors unavailable on server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "boardPersistenceKey" });
        }
      },
    });
  }
  return dbPromise;
}

// --- reactive committed-connector state ---------------------------------------

const EMPTY: readonly Connector[] = Object.freeze([]);
const cache = new Map<string, Connector[]>();
const loaded = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Snapshot must be referentially stable between mutations or useSyncExternalStore
// loops forever (see the proposalRegistry crash). cache holds the same array
// reference until a mutation replaces it; missing boards share the frozen EMPTY.
function getConnectors(key: string): Connector[] {
  return (cache.get(key) as Connector[]) ?? (EMPTY as Connector[]);
}

async function persist(key: string): Promise<void> {
  try {
    const db = await getDb();
    const rec: BoardRecord = {
      boardPersistenceKey: key,
      connectors: cache.get(key) ?? [],
      updatedAt: Date.now(),
    };
    await db.put(STORE, rec);
  } catch (err) {
    reportStorageError(err);
  }
}

export async function ensureConnectorsLoaded(key: string): Promise<void> {
  if (loaded.has(key)) return;
  loaded.add(key);
  try {
    const db = await getDb();
    const rec = (await db.get(STORE, key)) as BoardRecord | undefined;
    if (rec?.connectors?.length) {
      cache.set(key, rec.connectors);
      notify();
    }
  } catch (err) {
    reportStorageError(err);
  }
}

export function addConnector(key: string, fromId: string, toId: string): void {
  if (fromId === toId) return;
  const list = cache.get(key) ?? [];
  const exists = list.some(
    (c) =>
      (c.fromId === fromId && c.toId === toId) ||
      (c.fromId === toId && c.toId === fromId),
  );
  if (exists) return;
  const id = crypto.randomUUID();
  cache.set(key, [...list, { id, fromId, toId }]);
  markPulse(`c:${id}`); // one-shot pulse the moment the connection is made
  notify();
  void persist(key);
}

export function removeConnector(key: string, id: string): void {
  const list = cache.get(key);
  if (!list) return;
  cache.set(
    key,
    list.filter((c) => c.id !== id),
  );
  notify();
  void persist(key);
}

export function useConnectors(key: string | null): Connector[] {
  return useSyncExternalStore(
    subscribe,
    () => (key ? getConnectors(key) : (EMPTY as Connector[])),
    () => EMPTY as Connector[],
  );
}

/** Drop every connector tied to a board's persistenceKey (board deletion). */
export async function deleteConnectorsForBoard(key: string): Promise<void> {
  cache.delete(key);
  loaded.delete(key);
  notify();
  try {
    const db = await getDb();
    await db.delete(STORE, key);
  } catch (err) {
    reportStorageError(err);
  }
}

// --- ephemeral drag state (not persisted) -------------------------------------

export type DragState = { fromId: string; toX: number; toY: number } | null;

let drag: DragState = null;
const dragListeners = new Set<() => void>();

function notifyDrag(): void {
  for (const cb of dragListeners) cb();
}

export function setDrag(next: DragState): void {
  drag = next;
  notifyDrag();
}

export function useDrag(): DragState {
  return useSyncExternalStore(
    (cb) => {
      dragListeners.add(cb);
      return () => dragListeners.delete(cb);
    },
    () => drag,
    () => null,
  );
}
