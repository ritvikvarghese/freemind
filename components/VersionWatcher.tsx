"use client";

import { useEffect, useState } from "react";

// The build this tab loaded with, baked at build time. On Railway, set
// NEXT_PUBLIC_BUILD_SHA=${{RAILWAY_GIT_COMMIT_SHA}} so it matches what
// /api/version reports at runtime. Empty locally => the watcher never prompts.
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Polls the deployed build identity and, when a newer version has shipped,
// shows a non-intrusive "Refresh" banner. The web is pull-only: a redeploy
// cannot reach an open tab, so this is how an open tab finds out. Manual
// refresh only (never force-reloads); board state is in IndexedDB, so a reload
// loses nothing.
export function VersionWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!BUILD_SHA || stale) return;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const sha =
          data && typeof data === "object" && "sha" in data
            ? (data as { sha: unknown }).sha
            : "";
        if (!cancelled && typeof sha === "string" && sha && sha !== BUILD_SHA) {
          setStale(true);
        }
      } catch {
        // Network blip or no version endpoint: stay silent, try again later.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    void check();

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stale]);

  if (!stale) return null;

  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-panel border border-hairline bg-elevated px-3.5 py-2 text-[12px] text-text-primary shadow-[var(--shadow-floating)]">
      <span>A new version of Freemind is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-button bg-accent px-2.5 py-1 text-[11px] font-medium text-on-accent transition-opacity hover:opacity-90"
      >
        Refresh
      </button>
    </div>
  );
}
