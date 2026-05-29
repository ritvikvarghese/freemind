"use client";

import { useSyncExternalStore } from "react";
import { reportStorageError } from "./quotaToast";

export type Theme = "dark" | "light";

const STORAGE_KEY = "canvas-ai:theme";
const DEFAULT: Theme = "dark";

const listeners = new Set<() => void>();

function readLocal(): Theme {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function getTheme(): Theme {
  return readLocal();
}

export function setTheme(value: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch (err) {
    reportStorageError(err);
  }
  applyTheme(value);
  for (const cb of listeners) cb();
}

/** Reflect the theme on <html data-theme> so the CSS palette overrides apply. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function subscribe(cb: () => void): () => void {
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

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => DEFAULT);
}
