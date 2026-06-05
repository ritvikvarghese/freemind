"use client";

import { useSyncExternalStore } from "react";
import { reportStorageError } from "./quotaToast";
import { deleteChatHistoriesForBoard } from "./chatHistory";
import { deleteConnectorsForBoard } from "./connectors";
import { deleteCanvasChatsForBoard } from "./canvasChats";
import { deleteDocumentChatsForBoard } from "./documentChats";

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
  /** Folder this board lives in. Absent = top level. Additive; no migration. */
  folderId?: string;
};

// A folder groups boards on the home page. It owns no tldraw data — it's just a
// label + membership (boards carry `folderId`). Stored separately so the board
// list and its IDB stores are untouched. Deleting a folder ungroups (never
// deletes) its boards.
export type Folder = {
  id: string;
  name: string;
  createdAt: number; // epoch ms
  /**
   * Parent folder this folder is nested under. Absent = top level. One level of
   * nesting max (a folder with a `parentId` can never itself be a parent), so
   * the tree is at most two deep. Additive; no migration.
   */
  parentId?: string;
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
  // And the per-document chat sessions (canvas-ai-document-chats-v1).
  void deleteDocumentChatsForBoard(target.persistenceKey);
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

// Move a board into a folder (or to the top level with `folderId: null`).
// No-op if already there or the board is gone. The persistenceKey and every
// other field are untouched, so the tldraw store is unaffected.
export function moveBoardToFolder(
  boardId: string,
  folderId: string | null,
): void {
  const boards = getBoards();
  let changed = false;
  const next = boards.map((b) => {
    if (b.id !== boardId) return b;
    if (folderId === null) {
      if (b.folderId === undefined) return b;
      changed = true;
      return omitFolderId(b);
    }
    if (b.folderId === folderId) return b;
    changed = true;
    return { ...b, folderId };
  });
  if (changed) writeRaw(next);
}

function omitFolderId(b: Board): Board {
  if (b.folderId === undefined) return b;
  const copy = { ...b };
  delete copy.folderId;
  return copy;
}

// ---- Folders -------------------------------------------------------------

const FOLDERS_KEY = "canvas-ai:folders";
const folderListeners = new Set<() => void>();
let foldersCache: Folder[] | null = null;

function notifyFolders() {
  for (const cb of folderListeners) cb();
}

function readFoldersRaw(): Folder[] {
  if (typeof window === "undefined") return [];
  try {
    const v = window.localStorage.getItem(FOLDERS_KEY);
    if (v == null) return [];
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Partial<Folder>[])
      .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
      .map((f) => ({
        id: f.id as string,
        name: f.name as string,
        createdAt: typeof f.createdAt === "number" ? f.createdAt : 0,
        ...(typeof f.parentId === "string" ? { parentId: f.parentId } : {}),
      }));
  } catch {
    return [];
  }
}

function writeFolders(folders: Folder[]): void {
  foldersCache = folders;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch (err) {
      reportStorageError(err);
    }
  }
  notifyFolders();
}

export function getFolders(): Folder[] {
  if (foldersCache !== null) return foldersCache;
  foldersCache = readFoldersRaw();
  return foldersCache;
}

// Create a folder. Pass `parentId` to nest it under a top-level folder. The
// 2-level cap is enforced here: a parentId is only honored when it points to a
// folder that is itself top-level (no grandchildren allowed).
export function createFolder(name: string, parentId?: string): Folder {
  const folders = getFolders();
  let pid: string | undefined;
  if (parentId) {
    const parent = folders.find((f) => f.id === parentId);
    if (parent && parent.parentId === undefined) pid = parentId;
  }
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: name.trim() || "New folder",
    createdAt: Date.now(),
    ...(pid ? { parentId: pid } : {}),
  };
  writeFolders([...folders, folder]);
  return folder;
}

function folderHasChildren(folders: Folder[], id: string): boolean {
  return folders.some((f) => f.parentId === id);
}

function omitParentId(f: Folder): Folder {
  if (f.parentId === undefined) return f;
  const copy = { ...f };
  delete copy.parentId;
  return copy;
}

// Persist a manual ordering of the folder list (mirrors reorderBoards). Order is
// stored flat; each level's view is a stable filter of this array, so reordering
// here reorders siblings within their level. Any id missing from `orderedIds` is
// appended. No-op if already identical.
export function reorderFolders(orderedIds: string[]): void {
  const folders = getFolders();
  const byId = new Map(folders.map((f) => [f.id, f]));
  const next: Folder[] = [];
  for (const id of orderedIds) {
    const f = byId.get(id);
    if (f) {
      next.push(f);
      byId.delete(id);
    }
  }
  for (const f of byId.values()) next.push(f);
  if (
    next.length === folders.length &&
    next.every((f, i) => f.id === folders[i].id)
  ) {
    return;
  }
  writeFolders(next);
}

// The single drag gesture for folders: make `draggedId` a sibling of `targetId`
// (adopting the target's parent) and place it immediately before the target.
// Same parent → pure reorder. Different parent → move between levels (promote a
// subfolder, or nest a top-level folder next to an existing subfolder). Enforces
// the 2-level cap and prevents making a folder its own parent.
export function placeFolderBefore(draggedId: string, targetId: string): void {
  if (draggedId === targetId) return;
  const folders = getFolders();
  const dragged = folders.find((f) => f.id === draggedId);
  const target = folders.find((f) => f.id === targetId);
  if (!dragged || !target) return;
  const newParent = target.parentId; // undefined = top level
  if (newParent === draggedId) return; // can't nest a folder under itself
  // 2-level cap: a folder that has subfolders can't itself become nested.
  if (newParent !== undefined && folderHasChildren(folders, draggedId)) return;

  const reparented = folders.map((f) =>
    f.id === draggedId
      ? newParent === undefined
        ? omitParentId(f)
        : { ...f, parentId: newParent }
      : f,
  );
  const draggedFolder = reparented.find((f) => f.id === draggedId)!;
  const without = reparented.filter((f) => f.id !== draggedId);
  const ti = without.findIndex((f) => f.id === targetId);
  without.splice(ti, 0, draggedFolder);

  const unchanged =
    without.length === folders.length &&
    without.every(
      (f, i) => f.id === folders[i].id && f.parentId === folders[i].parentId,
    );
  if (unchanged) return;
  writeFolders(without);
}

// Move a folder to a specific parent (or to the top level with `null`). Used by
// the CANVASES-header drop (promote to top). Enforces the 2-level cap.
export function moveFolderToParent(
  id: string,
  parentId: string | null,
): void {
  const folders = getFolders();
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  if (parentId === null) {
    if (folder.parentId === undefined) return;
    writeFolders(folders.map((f) => (f.id === id ? omitParentId(f) : f)));
    return;
  }
  if (parentId === id || folder.parentId === parentId) return;
  const parent = folders.find((f) => f.id === parentId);
  if (!parent || parent.parentId !== undefined) return; // parent must be top-level
  if (folderHasChildren(folders, id)) return; // would exceed 2 levels
  writeFolders(folders.map((f) => (f.id === id ? { ...f, parentId } : f)));
}

export function renameFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const folders = getFolders();
  const next = folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
  if (next.every((f, i) => f.name === folders[i].name)) return;
  writeFolders(next);
}

// Delete a folder. Nothing inside is destroyed — its direct boards and direct
// subfolders are reparented one level up (to the deleted folder's parent, which
// is the top level for a top-level folder). Deleting a top-level folder thus
// promotes its subfolders to the top level (with their own boards intact);
// deleting a subfolder dumps its boards back into the parent folder. No-op if
// the folder doesn't exist.
export function deleteFolder(id: string): void {
  const folders = getFolders();
  const target = folders.find((f) => f.id === id);
  if (!target) return;
  const up = target.parentId; // undefined = top level

  const boards = getBoards();
  let movedAny = false;
  const movedBoards = boards.map((b) => {
    if (b.folderId !== id) return b;
    movedAny = true;
    return up === undefined ? omitFolderId(b) : { ...b, folderId: up };
  });
  if (movedAny) writeRaw(movedBoards);

  const nextFolders = folders
    .filter((f) => f.id !== id)
    .map((f) =>
      f.parentId === id
        ? up === undefined
          ? omitParentId(f)
          : { ...f, parentId: up }
        : f,
    );
  writeFolders(nextFolders);
}

function subscribeFolders(cb: () => void): () => void {
  folderListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === FOLDERS_KEY) {
      foldersCache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    folderListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY_FOLDERS: Folder[] = [];

export function useFolders(): Folder[] {
  return useSyncExternalStore(
    subscribeFolders,
    getFolders,
    () => EMPTY_FOLDERS,
  );
}
