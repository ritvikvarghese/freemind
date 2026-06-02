"use client";

import { useSyncExternalStore } from "react";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";

/**
 * Tiny external store for the active canvas-chat dock — mirrors
 * `lib/focus/openFocus.ts`. Only the open id is reactive; the first-message
 * `autoSend` is read-and-cleared imperatively so a StrictMode double-mount can't
 * fire the opening prompt twice.
 *
 * The dock's *staged attachments* (docs added but not yet sent) also live here
 * rather than in dock-local state, so the canvas (FloatingPrompt's "Add to
 * chat") and the dock's own "Add from canvas" button feed one source of truth.
 * The dock reads them reactively — no setState-in-effect bridge.
 */

const EMPTY_STAGED: readonly SourceSnapshot[] = Object.freeze([]);

let openId: string | null = null;
let pendingAutoSend: string | null = null;
// Staged attachments for the open dock. Replaced by reference on every change so
// `useStagedSources` re-renders; reset whenever a chat opens or closes.
let staged: SourceSnapshot[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function openChat(id: string, opts?: { autoSend?: string }): void {
  openId = id;
  pendingAutoSend = opts?.autoSend ?? null;
  staged = [];
  notify();
}

export function closeChat(): void {
  openId = null;
  pendingAutoSend = null;
  staged = [];
  notify();
}

/** Read-and-clear the pending opening prompt (exactly-once). */
export function consumeAutoSend(): string | null {
  const v = pendingAutoSend;
  pendingAutoSend = null;
  return v;
}

/** Stage sources into the open dock (dedups by id against what's staged). */
export function stageSourcesToOpenChat(sources: SourceSnapshot[]): void {
  if (sources.length === 0) return;
  const have = new Set(staged.map((s) => s.id));
  const add = sources.filter((s) => !have.has(s.id));
  if (add.length === 0) return;
  staged = [...staged, ...add];
  notify();
}

export function removeStagedSource(id: string): void {
  if (!staged.some((s) => s.id === id)) return;
  staged = staged.filter((s) => s.id !== id);
  notify();
}

export function clearStagedSources(): void {
  if (staged.length === 0) return;
  staged = [];
  notify();
}

export function useOpenChatId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => openId,
    () => null,
  );
}

export function useStagedSources(): SourceSnapshot[] {
  return useSyncExternalStore(
    subscribe,
    () => staged,
    () => EMPTY_STAGED as SourceSnapshot[],
  );
}
