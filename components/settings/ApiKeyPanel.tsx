"use client";

import { useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  Eye,
  EyeOff,
  Loader2,
  Check,
  Trash2,
  Sun,
  Moon,
  Download,
  Upload,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  ArrowRight,
} from "lucide-react";
import Anthropic, { AuthenticationError, APIError } from "@anthropic-ai/sdk";
import { useEditor } from "tldraw";
import { clearApiKey, setApiKey, useApiKey } from "@/lib/storage/apiKey";
import { clearCanvas } from "@/lib/canvas/clearCanvas";
import { toast } from "@/components/canvas/toast";
import { setTheme, useTheme, type Theme } from "@/lib/storage/theme";
import { useOpenChatId } from "@/lib/chat/openChat";
import { downloadBackup, importBackupFile } from "@/lib/storage/backup";
import {
  isStoragePersisted,
  requestPersistentStorage,
} from "@/lib/storage/persist";

type ValidateResult =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function ApiKeyPanel() {
  const editor = useEditor();
  const { key, source, hasKey } = useApiKey();
  const theme = useTheme();
  const openChatId = useOpenChatId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<ValidateResult>({ kind: "idle" });
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backupBusy, setBackupBusy] = useState<"idle" | "export" | "import">(
    "idle",
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Refresh storage-persistence status whenever the panel opens.
  useEffect(() => {
    if (open) void isStoragePersisted().then(setPersisted);
  }, [open]);

  async function handleExport() {
    setBackupBusy("export");
    try {
      await downloadBackup();
      toast("Backup downloaded.");
    } catch (err) {
      toast(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackupBusy("idle");
    }
  }

  async function handleImport(file: File) {
    setBackupBusy("import");
    try {
      const r = await importBackupFile(file);
      toast(
        `Restored ${r.boardsAdded} board${r.boardsAdded === 1 ? "" : "s"}, ${r.databasesRestored} canvas${r.databasesRestored === 1 ? "" : "es"}, ${r.recordsMerged} records — reloading…`,
      );
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackupBusy("idle");
    }
  }

  async function handleProtectStorage() {
    await requestPersistentStorage();
    setPersisted(await isStoragePersisted());
  }

  function openPanel() {
    setDraft("");
    setStatus({ kind: "idle" });
    setReveal(false);
    setConfirmingClear(false);
    setOpen(true);
  }

  function togglePanel() {
    if (open) {
      setOpen(false);
    } else {
      openPanel();
    }
  }

  function handleClearCanvas() {
    const removed = clearCanvas(editor);
    setConfirmingClear(false);
    setOpen(false);
    if (removed === 0) {
      toast("Canvas was already empty.");
    } else {
      toast(
        `Cleared ${removed} shape${removed === 1 ? "" : "s"} — undo if needed (⌘Z).`,
      );
    }
  }

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setStatus({ kind: "validating" });
    const result = await validateKey(trimmed);
    if (result.ok) {
      setApiKey(trimmed);
      setStatus({ kind: "ok" });
      // Auto-close after a beat so the user sees the confirmation
      setTimeout(() => setOpen(false), 700);
    } else {
      setStatus({ kind: "error", message: result.message });
    }
  }

  function handleClear() {
    clearApiKey();
    setDraft("");
    setStatus({ kind: "idle" });
  }

  return (
    <div
      ref={panelRef}
      className="pointer-events-auto fixed top-4 z-40 flex items-center gap-2"
      style={{
        right: openChatId ? 416 : 16,
        transition: "right 140ms var(--ease-out-fast)",
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* First-run nudge: only while no key is set and the panel is closed.
          Disappears for good once a key is saved. */}
      {!hasKey && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-button border border-[var(--color-accent)] bg-elevated px-2.5 py-1.5 text-[12px] font-medium text-text-primary shadow-[var(--shadow-floating)] transition-colors duration-100 hover:bg-surface-hover"
        >
          <KeyRound className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden />
          Add your API key
          <ArrowRight className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={togglePanel}
        className="h-9 w-9 grid place-items-center rounded-button text-text-secondary hover:text-text-primary bg-elevated border border-hairline hover:border-hairline-hover transition-colors duration-100"
      >
        <SettingsIcon className="h-4 w-4" aria-hidden />
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 max-h-[calc(100vh-72px)] w-[340px] overflow-y-auto rounded-panel border border-hairline bg-elevated p-4 shadow-[var(--shadow-floating)]">
          <div className="text-[13px] font-medium tracking-tight text-text-primary">
            Anthropic API key
          </div>
          <div className="mt-1 text-[12px] text-text-tertiary">
            Stored in your browser. Used to call Claude directly from this page.
          </div>

          {hasKey ? (
            <div className="mt-3 flex items-center gap-2 rounded-button border border-hairline px-2.5 py-1.5 text-[11px]">
              <Check className="h-3 w-3 text-text-secondary" aria-hidden />
              <span className="text-text-secondary">
                Key set ({source === "env" ? "from .env.local" : "saved here"}) ·{" "}
                <span className="font-mono">{maskKey(key ?? "")}</span>
              </span>
            </div>
          ) : null}

          <label className="mt-3 block text-[12px] text-text-secondary">
            Paste a new key
          </label>
          <div className="mt-1 relative">
            <input
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
              className="w-full rounded-button bg-app border border-hairline px-3 py-2 pr-9 text-[12px] font-mono text-text-primary outline-none focus:border-hairline-hover transition-colors"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? "Hide key" : "Show key"}
              className="absolute inset-y-0 right-2 grid place-items-center text-text-tertiary hover:text-text-secondary"
            >
              {reveal ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {status.kind === "error" ? (
            <div
              className="mt-2 text-[11px]"
              style={{ color: "var(--color-error)" }}
            >
              {status.message}
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-end gap-2">
            {hasKey ? (
              <button
                type="button"
                onClick={handleClear}
                className="text-[12px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded-button"
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={draft.trim().length === 0 || status.kind === "validating"}
              className="flex items-center gap-1.5 rounded-button bg-accent text-on-accent px-3 py-1.5 text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {status.kind === "validating" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : status.kind === "ok" ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
              {status.kind === "ok" ? "Saved" : "Save"}
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-hairline">
            <div className="text-[13px] font-medium tracking-tight text-text-primary">
              Appearance
            </div>
            <div className="mt-1 text-[12px] text-text-tertiary">
              Pick a canvas theme. The choice is remembered next time you open
              this app.
            </div>
            <div className="mt-3 inline-flex rounded-button border border-hairline p-0.5">
              <ThemeChip
                value="dark"
                current={theme}
                icon={<Moon className="h-3 w-3" aria-hidden />}
                label="Dark"
              />
              <ThemeChip
                value="light"
                current={theme}
                icon={<Sun className="h-3 w-3" aria-hidden />}
                label="Light"
              />
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-hairline">
            <div className="text-[13px] font-medium tracking-tight text-text-primary">
              Backup &amp; restore
            </div>
            <div className="mt-1 text-[12px] text-text-tertiary">
              Export a copy of your data to re-import if it&apos;s ever lost.
              Import only adds what&apos;s missing.
            </div>

            {persisted !== null ? (
              persisted ? (
                <div className="mt-3 flex items-center gap-2 rounded-button border border-hairline px-2.5 py-1.5 text-[11px] text-text-secondary">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  Storage is protected from automatic eviction.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleProtectStorage()}
                  className="mt-3 flex w-full items-center gap-2 rounded-button border border-hairline px-2.5 py-1.5 text-[11px] text-text-secondary hover:border-hairline-hover hover:text-text-primary transition-colors duration-100"
                >
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                  Storage not protected. Click to protect.
                </button>
              )
            ) : null}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={backupBusy !== "idle"}
                className="flex items-center gap-1.5 rounded-button px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary border border-hairline hover:border-hairline-hover transition-colors duration-100 disabled:opacity-40"
              >
                {backupBusy === "export" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden />
                )}
                Export backup
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={backupBusy !== "idle"}
                className="flex items-center gap-1.5 rounded-button px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary border border-hairline hover:border-hairline-hover transition-colors duration-100 disabled:opacity-40"
              >
                {backupBusy === "import" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                Import
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void handleImport(file);
                }}
              />
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-hairline">
            <div className="text-[13px] font-medium tracking-tight text-text-primary">
              Canvas
            </div>
            <div className="mt-1 text-[12px] text-text-tertiary">
              Remove every note, upload, and document from the canvas. Undoable
              with ⌘Z right after.
            </div>
            <div className="mt-3 flex items-center justify-end">
              {confirmingClear ? (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="text-[12px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded-button"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCanvas}
                    className="flex items-center gap-1.5 rounded-button px-3 py-1.5 text-[12px] font-medium border border-hairline transition-colors duration-100 hover:bg-surface-hover"
                    style={{ color: "var(--color-error)" }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Clear everything
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  className="flex items-center gap-1.5 rounded-button px-3 py-1.5 text-[12px] text-text-secondary hover:text-text-primary border border-hairline hover:border-hairline-hover transition-colors duration-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Clear canvas
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemeChip({
  value,
  current,
  icon,
  label,
}: {
  value: Theme;
  current: Theme;
  icon: React.ReactNode;
  label: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => setTheme(value)}
      aria-pressed={active}
      className={
        "flex items-center gap-1.5 px-2.5 py-1 rounded-button text-[11px] font-medium tracking-tight transition-colors duration-100 " +
        (active
          ? "bg-accent text-on-accent"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-hover")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function maskKey(k: string): string {
  if (k.length <= 12) return "•".repeat(Math.max(0, k.length - 4)) + k.slice(-4);
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

async function validateKey(
  key: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthenticationError) {
      return { ok: false, message: "Invalid API key." };
    }
    if (err instanceof APIError) {
      return { ok: false, message: `API error: ${err.status} ${err.message}` };
    }
    if (err instanceof Error && err.message.toLowerCase().includes("failed to fetch")) {
      return {
        ok: false,
        message: "Cannot reach api.anthropic.com — check network or firewall.",
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
