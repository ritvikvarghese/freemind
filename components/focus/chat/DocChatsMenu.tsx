"use client";

import { useEffect, useRef } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useDocumentChats } from "@/lib/storage/documentChats";

type Props = {
  documentId: string;
  openChatId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

/**
 * This document's chats, dropped from the top chat icon. Mirrors the canvas
 * Chats menu: a New chat row plus the document's sessions (newest first), each
 * reopenable and deletable.
 */
export function DocChatsMenu({
  documentId,
  openChatId,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: Props) {
  const chats = useDocumentChats(documentId);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-[70] mt-2 w-[272px] rounded-panel border border-hairline bg-elevated p-1.5 shadow-[var(--shadow-floating)]"
    >
      <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        Chats
      </div>
      <button
        type="button"
        onClick={onNew}
        className="flex w-full items-center gap-2 rounded-button px-2 py-2 text-left text-[12.5px] font-medium text-text-primary hover:bg-surface-hover"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
        New chat
      </button>
      {chats.length > 0 ? (
        <div className="my-1 h-px bg-hairline" />
      ) : null}
      <div className="max-h-[320px] overflow-auto">
        {chats.map((c) => (
          <div
            key={c.id}
            className={
              "group flex items-center gap-2 rounded-button px-2 py-2 text-[12.5px] " +
              (c.id === openChatId
                ? "bg-surface-hover text-text-primary"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
            }
          >
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.title || "Chat"}</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(c.id)}
              aria-label="Delete chat"
              title="Delete chat"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-button text-text-tertiary opacity-0 transition-opacity duration-100 hover:bg-app hover:text-text-primary group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
