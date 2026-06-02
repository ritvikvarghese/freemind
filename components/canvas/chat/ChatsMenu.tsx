"use client";

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Trash2 } from "lucide-react";
import { useBoardKey } from "@/components/canvas/BoardContext";
import type { AgentMode } from "@/lib/agent/modes";
import {
  deleteCanvasChat,
  ensureCanvasChatsLoaded,
  useCanvasChats,
} from "@/lib/storage/canvasChats";
import { openChat, useOpenChatId } from "@/lib/chat/openChat";

function modeLabel(mode: AgentMode): string {
  return mode === "deepsearch"
    ? "Deepsearch"
    : mode === "deepsynth"
      ? "Deepsynth"
      : "Freeform";
}

function relativeTime(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export function ChatsMenu() {
  const boardKey = useBoardKey();
  const chats = useCanvasChats(boardKey);
  const openId = useOpenChatId();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (boardKey) void ensureCanvasChatsLoaded(boardKey);
  }, [boardKey]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingId(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      setConfirmingId(null);
    } else {
      setNow(Date.now());
      setConfirmingId(null);
      setOpen(true);
    }
  }

  // Slide the cluster left of the dock when it's open, so nothing stacks. The
  // gear sits at right:416 in that state, so Chats goes just left of it.
  const right = openId ? 464 : 64;

  return (
    <div
      ref={ref}
      className="pointer-events-auto fixed top-4 z-40"
      style={{ right, transition: "right 140ms var(--ease-out-fast)" }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={toggle}
        title="All canvas chats"
        aria-label="All canvas chats"
        className="flex h-9 items-center gap-2 rounded-button border border-hairline bg-elevated px-3 text-[12px] font-medium text-text-secondary hover:text-text-primary hover:border-hairline-hover transition-colors duration-100"
      >
        <MessagesSquare className="h-4 w-4" aria-hidden />
        Chats
        {chats.length > 0 ? (
          <span className="text-text-tertiary">{chats.length}</span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[340px] rounded-panel border border-hairline bg-elevated p-1.5 shadow-[var(--shadow-floating)]">
          <div className="px-2 pb-2 pt-1.5 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
            All canvas chats
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
          {chats.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
              No chats on this canvas yet.
            </div>
          ) : (
            chats.map((c) => {
              const confirming = confirmingId === c.id;
              return (
                <div
                  key={c.id}
                  className="group flex items-center gap-2 rounded-button px-2.5 py-2 hover:bg-surface-hover"
                >
                  <button
                    type="button"
                    onClick={() => {
                      openChat(c.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[13px] text-text-primary">
                      {c.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-tertiary">
                      {confirming
                        ? "Delete this chat?"
                        : `${relativeTime(c.updatedAt, now)} · ${modeLabel(c.mode)} · ${c.sources.length} source${c.sources.length === 1 ? "" : "s"}`}
                    </div>
                  </button>
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="rounded-button px-2 py-1 text-[11px] text-text-tertiary hover:text-text-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteCanvasChat(c.id);
                          setConfirmingId(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-button border border-hairline px-2 py-1 text-[11px] hover:bg-surface-hover"
                        style={{ color: "var(--color-error)" }}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(c.id)}
                      aria-label="Delete chat"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-button text-text-tertiary opacity-0 hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              );
            })
          )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
