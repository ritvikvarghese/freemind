"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, X } from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Comment } from "@/lib/storage/commentTypes";
import {
  captureAnchorAtSelection,
  refreshCommentDecorations,
} from "@/components/focus/editor/commentDecorations";

type Anchor = {
  anchor_before: string;
  anchor_text: string;
  anchor_after: string;
};

type Props = {
  editor: Editor | null;
  comments: Comment[];
  onChange: (next: Comment[]) => void;
};

export type CommentLayerHandle = {
  /** Opens the create-composer anchored to the current editor selection. */
  beginCommentFromSelection: () => void;
  /** Opens the viewer popover for a specific comment, positioned at the given
   *  viewport rect (used by the right-margin badges and the sidebar). */
  openComment: (commentId: string, anchorRect: DOMRect) => void;
};

const POPOVER_WIDTH = 320;

export const CommentLayer = forwardRef<CommentLayerHandle, Props>(
  function CommentLayer({ editor, comments, onChange }, ref) {
    const [composer, setComposer] = useState<{
      anchor: Anchor;
      x: number;
      y: number;
    } | null>(null);
    const [viewer, setViewer] = useState<{
      commentId: string;
      x: number;
      y: number;
    } | null>(null);

    // Click on a highlight OR an inline badge inside the editor → open the
    // view popover at that span. One delegated listener on the editor DOM
    // node is cheaper than wiring per-decoration handlers.
    useEffect(() => {
      if (!editor) return;
      const dom = editor.view.dom;
      const onClick = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest(
          "[data-comment-id]",
        ) as HTMLElement | null;
        if (!target) return;
        const id = target.dataset.commentId;
        if (!id) return;
        // Badges sit on the right edge of the line; anchor the popover to
        // their left so it doesn't fall off-screen.
        const isBadge = target.hasAttribute("data-comment-badge");
        const rect = target.getBoundingClientRect();
        setViewer({
          commentId: id,
          x: isBadge
            ? clampLeft(rect.left - POPOVER_WIDTH - 8)
            : clampLeft(rect.left),
          y: isBadge ? rect.top : rect.bottom + 6,
        });
        setComposer(null);
        e.preventDefault();
      };
      dom.addEventListener("click", onClick);
      return () => dom.removeEventListener("click", onClick);
    }, [editor]);

    // Re-render decorations when the comment list changes.
    useEffect(() => {
      if (editor) refreshCommentDecorations(editor);
    }, [editor, comments]);

    useImperativeHandle(
      ref,
      () => ({
        beginCommentFromSelection: () => {
          if (!editor) return;
          const anchor = captureAnchorAtSelection(editor);
          if (!anchor) return;
          const { from, to } = editor.state.selection;
          const start = editor.view.coordsAtPos(from);
          const end = editor.view.coordsAtPos(to);
          const x = clampLeft((start.left + end.right) / 2 - POPOVER_WIDTH / 2);
          const y = end.bottom + 8;
          setComposer({ anchor, x, y });
          setViewer(null);
        },
        openComment: (commentId, rect) => {
          const x = clampLeft(rect.left - POPOVER_WIDTH - 12);
          const y = rect.top;
          setViewer({ commentId, x, y });
          setComposer(null);
        },
      }),
      [editor],
    );

    const closeComposer = useCallback(() => setComposer(null), []);
    const closeViewer = useCallback(() => setViewer(null), []);

    const handleCreate = useCallback(
      (body: string) => {
        if (!composer) return;
        const c: Comment = {
          id: crypto.randomUUID(),
          ...composer.anchor,
          body,
          createdAt: Date.now(),
          resolved: false,
        };
        onChange([...comments, c]);
        setComposer(null);
      },
      [composer, comments, onChange],
    );

    const handleResolveToggle = useCallback(
      (id: string) => {
        onChange(
          comments.map((c) =>
            c.id === id ? { ...c, resolved: !c.resolved } : c,
          ),
        );
        setViewer(null);
      },
      [comments, onChange],
    );

    const handleDelete = useCallback(
      (id: string) => {
        onChange(comments.filter((c) => c.id !== id));
        setViewer(null);
      },
      [comments, onChange],
    );

    const overlay = (
      <>
        {composer ? (
          <ComposerPopover
            x={composer.x}
            y={composer.y}
            quote={composer.anchor.anchor_text}
            onCancel={closeComposer}
            onSubmit={handleCreate}
          />
        ) : null}
        {viewer
          ? (() => {
              const c = comments.find((x) => x.id === viewer.commentId);
              if (!c) return null;
              return (
                <ViewerPopover
                  x={viewer.x}
                  y={viewer.y}
                  comment={c}
                  onClose={closeViewer}
                  onResolveToggle={() => handleResolveToggle(c.id)}
                  onDelete={() => handleDelete(c.id)}
                />
              );
            })()
          : null}
      </>
    );

    if (typeof document === "undefined" || !document.body) return null;
    return createPortal(overlay, document.body);
  },
);

function clampLeft(x: number): number {
  if (typeof window === "undefined") return x;
  const margin = 8;
  const max = window.innerWidth - POPOVER_WIDTH - margin;
  return Math.max(margin, Math.min(max, x));
}

function ComposerPopover({
  x,
  y,
  quote,
  onCancel,
  onSubmit,
}: {
  x: number;
  y: number;
  quote: string;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onCancel]);

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      ref={wrapRef}
      className="fixed z-[60] rounded-button border border-hairline bg-elevated p-3 shadow-floating"
      style={{
        left: x,
        top: y,
        width: POPOVER_WIDTH,
        boxShadow: "var(--shadow-floating)",
      }}
    >
      <QuoteBlock text={quote} />
      <textarea
        ref={taRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Add a comment…"
        rows={3}
        className="mt-2 w-full resize-none rounded-button border border-hairline bg-app px-2 py-1.5 text-[13px] leading-snug text-text-primary outline-none placeholder:text-text-tertiary"
      />
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-button px-2 py-1 text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!body.trim()}
          className="rounded-button bg-accent px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-40"
        >
          Comment
        </button>
      </div>
    </div>
  );
}

function ViewerPopover({
  x,
  y,
  comment,
  onClose,
  onResolveToggle,
  onDelete,
}: {
  x: number;
  y: number;
  comment: Comment;
  onClose: () => void;
  onResolveToggle: () => void;
  onDelete: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  return (
    <div
      ref={wrapRef}
      className="fixed z-[60] rounded-button border border-hairline bg-elevated p-3 shadow-floating"
      style={{
        left: x,
        top: y,
        width: POPOVER_WIDTH,
        boxShadow: "var(--shadow-floating)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-text-tertiary">
          {formatTime(comment.createdAt)}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onResolveToggle}
            title={comment.resolved ? "Reopen" : "Resolve"}
            aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"}
            className="grid h-6 w-6 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete comment"
            title="Delete"
            className="grid h-6 w-6 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded-button text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="mt-2">
        <QuoteBlock text={comment.anchor_text} />
      </div>
      <div
        className={
          "mt-2 whitespace-pre-wrap text-[13px] leading-snug " +
          (comment.resolved
            ? "text-text-tertiary line-through"
            : "text-text-primary")
        }
      >
        {comment.body}
      </div>
    </div>
  );
}

function QuoteBlock({ text }: { text: string }) {
  const truncated = text.length > 200 ? text.slice(0, 200) + "…" : text;
  return (
    <div className="flex items-start gap-2">
      <div
        className="my-0.5 w-[2px] shrink-0 self-stretch rounded-sm"
        style={{ background: "var(--color-text-tertiary)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-snug text-text-secondary">
        {truncated}
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
