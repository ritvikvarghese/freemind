"use client";

/**
 * Requests *persistent* storage for the origin. All of Freemind's data lives in
 * the browser (IndexedDB + localStorage) with no server backup; by default that
 * sits in the evictable "best-effort" bucket, which the browser can clear under
 * disk pressure. Persistent storage exempts the origin from automatic eviction —
 * clearing then requires an explicit user action.
 *
 * Caveats: Chrome usually grants this silently based on engagement; Firefox
 * prompts. It does NOT save you from Safari/WebKit's 7-day script-writable
 * storage deletion (only "installed" web apps are spared there), nor from the
 * user manually clearing site data. Best-effort, fire-and-forget.
 */

let requested = false;

export async function requestPersistentStorage(): Promise<void> {
  if (requested) return;
  requested = true;
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    if (await navigator.storage.persisted?.()) return;
    await navigator.storage.persist();
  } catch {
    /* ignored — purely a durability hint */
  }
}

/** Whether the origin currently has persistent storage (for surfacing in UI). */
export async function isStoragePersisted(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persisted)
      return false;
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}
