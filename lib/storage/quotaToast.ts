"use client";

import { toast } from "@/components/canvas/toast";

const RATE_LIMIT_MS = 5_000;
let lastReportAt = 0;

/**
 * Surface a localStorage write failure to the user. Tldraw's IndexedDB
 * persistence has a much higher ceiling than localStorage, so this fires
 * mainly when the Anthropic API key save hits a quota or a security
 * restriction (private mode, disabled storage, etc).
 *
 * Rate-limited so repeated saves don't spam the toast queue.
 */
export function reportStorageError(err: unknown): void {
  const now = Date.now();
  if (now - lastReportAt < RATE_LIMIT_MS) return;
  lastReportAt = now;

  const name = (err as { name?: string })?.name;
  if (name === "QuotaExceededError") {
    toast(
      "Browser storage is full. Clear the canvas in Settings or remove some uploads.",
      "error",
    );
  } else if (name === "SecurityError") {
    toast(
      "Browser storage is disabled (private mode or site permissions).",
      "error",
    );
  } else {
    toast(
      `Could not save to browser storage: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "error",
    );
  }
}
