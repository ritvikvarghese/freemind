"use client";

/**
 * Module-level handle to the currently-mounted board's persistenceKey. Set by
 * CanvasRoot on mount; read by features that need to scope IDB writes to the
 * active board (chat history, etc.). Cleared on unmount so a stale key from
 * the previous board doesn't leak into a new mount.
 */
let currentPersistenceKey: string | null = null;

export function setCurrentBoardPersistenceKey(key: string | null): void {
  currentPersistenceKey = key;
}

export function getCurrentBoardPersistenceKey(): string | null {
  return currentPersistenceKey;
}
