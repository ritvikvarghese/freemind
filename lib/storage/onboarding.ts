"use client";

// One-time first-run flag. Set the first time a user lands on the home page so
// the welcome flow (redirect into the seeded "welcome" canvas + the key modal)
// runs exactly once per browser. Local-only, like every other bit of state.
import { reportStorageError } from "./quotaToast";

const ONBOARDED_KEY = "canvas-ai:onboarded";

export function isOnboarded(): boolean {
  if (typeof window === "undefined") return true; // never onboard during SSR
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // If storage is unreadable, treat as onboarded so we don't loop-redirect.
    return true;
  }
}

export function markOnboarded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
  } catch (err) {
    reportStorageError(err);
  }
}
