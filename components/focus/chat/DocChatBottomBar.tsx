"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { MessageSquare, MessagesSquare } from "lucide-react";

type Props = {
  editor: Editor | null;
  /** A chat session is open (the panel is showing). */
  chatOpen: boolean;
  /** Right inset so the bar sits over the document column, not the chat panel. */
  rightInset: number;
  disabled?: boolean;
  /** Open a chat (most recent, or a new one). */
  onLaunch: () => void;
  /** Add the current selection to the chat (opens/seeds one if needed). */
  onAddToChat: (selectionText: string) => void;
};

/**
 * The unobtrusive bottom affordance over the document column: a small chat
 * launcher pill (replacing the old full composer) plus a prominent "Add to
 * chat" button that appears whenever text is selected. The chat already has the
 * whole document as context, so the launcher just opens it.
 */
export function DocChatBottomBar({
  editor,
  chatOpen,
  rightInset,
  disabled,
  onLaunch,
  onAddToChat,
}: Props) {
  const [selText, setSelText] = useState("");

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      const t =
        from !== to ? editor.state.doc.textBetween(from, to, " ").trim() : "";
      setSelText(t);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    // Deferred initial read (avoids a synchronous setState inside the effect).
    const raf = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(raf);
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 z-30"
      style={{ right: rightInset }}
    >
      {editor && selText && !disabled ? (
        <button
          type="button"
          onClick={() => onAddToChat(selText)}
          className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-button bg-accent px-3.5 py-2 text-[12.5px] font-medium text-on-accent shadow-[var(--shadow-floating)] transition-opacity duration-100 hover:opacity-90"
        >
          <MessagesSquare className="h-4 w-4" aria-hidden />
          Add to chat
        </button>
      ) : null}

      {!chatOpen ? (
        <button
          type="button"
          onClick={onLaunch}
          disabled={disabled}
          title={disabled ? "Set an API key in Settings to chat" : "Chat about this document"}
          className="pointer-events-auto absolute bottom-6 right-6 flex items-center gap-2 rounded-full border border-hairline bg-elevated py-2 pl-3 pr-3.5 text-[12.5px] font-medium text-text-secondary shadow-[var(--shadow-floating)] transition-colors duration-100 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          Ask or Edit with AI
        </button>
      ) : null}
    </div>
  );
}
