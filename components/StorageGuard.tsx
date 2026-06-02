"use client";

import { useEffect } from "react";
import { requestPersistentStorage } from "@/lib/storage/persist";

/**
 * Mounts once at the app root and asks the browser for persistent storage so
 * our local-only data isn't evicted under disk pressure. Renders nothing.
 */
export function StorageGuard() {
  useEffect(() => {
    void requestPersistentStorage();
  }, []);
  return null;
}
