"use client";

import { useSyncExternalStore } from "react";
import { reportStorageError } from "./quotaToast";

const STORAGE_KEY = "canvas-ai:anthropic-api-key";
const ENV_KEY = "NEXT_PUBLIC_ANTHROPIC_API_KEY";

type Listener = () => void;
const listeners = new Set<Listener>();

function readLocal(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readEnv(): string | null {
  // Next.js inlines NEXT_PUBLIC_* at build time, so this is a literal string lookup.
  const v = process.env[ENV_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Read the currently effective API key. localStorage wins over env so the
 * settings panel can override a baked-in dev key.
 */
export function getApiKey(): string | null {
  return readLocal() ?? readEnv();
}

export function setApiKey(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch (err) {
    reportStorageError(err);
  }
  notify();
}

export function clearApiKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    reportStorageError(err);
  }
  notify();
}

/** True when getApiKey() would return a non-null, non-empty string. */
export function hasApiKey(): boolean {
  const k = getApiKey();
  return typeof k === "string" && k.length > 0;
}

/** Returns 'localStorage' | 'env' | null so the settings UI can hint where the key came from. */
export function getApiKeySource(): "localStorage" | "env" | null {
  if (readLocal()) return "localStorage";
  if (readEnv()) return "env";
  return null;
}

function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function notify() {
  for (const cb of listeners) cb();
}

/** React hook that re-renders when the key changes (settings panel save/clear). */
export function useApiKey(): {
  key: string | null;
  source: "localStorage" | "env" | null;
  hasKey: boolean;
} {
  const key = useSyncExternalStore(
    subscribe,
    () => getApiKey(),
    () => null,
  );
  const source = useSyncExternalStore(
    subscribe,
    () => getApiKeySource(),
    () => null,
  );
  return { key, source, hasKey: typeof key === "string" && key.length > 0 };
}
