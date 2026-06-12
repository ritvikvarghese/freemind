"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Loader2, Check, X, ExternalLink } from "lucide-react";
import { hasApiKey, setApiKey } from "@/lib/storage/apiKey";
import { validateApiKey } from "@/lib/agent/validateApiKey";

type Status =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

// Strip the one-shot ?welcome=1 marker without a navigation, so a refresh or a
// back-nav doesn't re-open the modal.
function stripWelcomeParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.has("welcome")) {
    url.searchParams.delete("welcome");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

/**
 * First-run welcome + API key prompt. Mounted on the canvas; shows only when
 * the user arrived via the first-run redirect (?welcome=1) and has no key yet.
 * It is a soft nudge, not a gate: dismissing it falls back to the persistent
 * "Set your API key" pill. Shows once (the param is stripped on close).
 */
export function WelcomeModal() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("welcome") === "1" && !hasApiKey();
  });
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    stripWelcomeParam();
    setOpen(false);
  }

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setStatus({ kind: "validating" });
    const result = await validateApiKey(trimmed);
    if (result.ok) {
      setApiKey(trimmed);
      setStatus({ kind: "ok" });
      setTimeout(close, 650); // let the user see the confirmation
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  if (!open) return null;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Freemind"
      onClick={close}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto fixed inset-0 z-[800] grid place-items-center bg-black/30 px-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-panel border border-hairline bg-elevated p-6 shadow-[var(--shadow-panel)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="text-center">
          <div className="text-[26px] font-medium tracking-tight text-text-primary">
            Freemind
          </div>
          <div className="mt-1 text-[14px] text-text-secondary">
            A canvas for the mind
          </div>
        </div>

        <p className="mt-5 text-center text-[13px] leading-relaxed text-text-secondary">
          Use your own Anthropic API key. It stays in this browser and is never
          sent to our servers.
        </p>

        <label className="mt-5 block text-[12px] text-text-secondary">
          Paste your key
        </label>
        <div className="relative mt-1">
          <input
            ref={inputRef}
            type={reveal ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void handleSave();
            }}
            placeholder="sk-ant-..."
            className="w-full rounded-button border border-hairline bg-app px-3 py-2 pr-9 text-[12px] font-mono text-text-primary outline-none transition-colors focus:border-hairline-hover"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Hide key" : "Show key"}
            className="absolute inset-y-0 right-2 grid place-items-center text-text-tertiary hover:text-text-secondary"
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>

        {status.kind === "error" ? (
          <div className="mt-2 text-[11px]" style={{ color: "var(--color-error)" }}>
            {status.message}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={draft.trim().length === 0 || status.kind === "validating"}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-button bg-accent px-3 py-2 text-[13px] font-medium text-on-accent transition-opacity duration-100 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status.kind === "validating" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : status.kind === "ok" ? (
            <Check className="h-3.5 w-3.5" />
          ) : null}
          {status.kind === "ok" ? "Saved" : "Save and start"}
        </button>

        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-text-tertiary transition-colors duration-100 hover:text-text-secondary"
        >
          Get an API key
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>

        <div className="mt-5 border-t border-hairline pt-4 text-center">
          <p className="text-[11px] leading-relaxed text-text-tertiary">
            No account needed. Explore without a key, add one to ask Claude.
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-2 rounded-button px-3 py-1 text-[12px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            Explore first
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return modal;
  return createPortal(modal, document.body);
}
