"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Comment } from "@/lib/storage/commentTypes";
import {
  resolveComments,
  type CommentResolution,
} from "@/components/focus/editor/commentDecorations";

type Badge = {
  /** Y offset relative to the wrapper element. */
  y: number;
  /** Comments grouped on roughly the same line so a single chip can stand in. */
  group: CommentResolution[];
};

type Props = {
  editor: Editor;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  comments: Comment[];
  onOpen: (commentId: string, anchorRect: DOMRect) => void;
};

const GROUP_TOLERANCE_PX = 18;

/**
 * Right-margin column of comment chips, one per commented line (à la Notion
 * / Google Docs). Reads PM `coordsAtPos` for each comment range and renders
 * a small chip in the gutter to the right of the prose column. Recomputes on
 * every editor transaction so the chips follow the text as it edits.
 */
export function CommentMargin({ editor, wrapperRef, comments, onOpen }: Props) {
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    const compute = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const resolutions = resolveComments(editor, comments).filter(
        (r) => r.range !== null && !r.comment.resolved,
      );
      const placed: Badge[] = [];
      for (const r of resolutions) {
        if (!r.range) continue;
        let coords: { top: number };
        try {
          coords = editor.view.coordsAtPos(r.range.from);
        } catch {
          continue;
        }
        const y = coords.top - wrapperRect.top;
        const existing = placed.find(
          (b) => Math.abs(b.y - y) < GROUP_TOLERANCE_PX,
        );
        if (existing) existing.group.push(r);
        else placed.push({ y, group: [r] });
      }
      setBadges(placed);
    };
    // Defer initial pass so the editor's DOM has measurements.
    const raf = requestAnimationFrame(compute);
    const onTx = () => compute();
    editor.on("transaction", onTx);
    window.addEventListener("resize", compute);
    const scroller = wrapperRef.current?.closest(".canvas-ai-focus-paper");
    scroller?.addEventListener("scroll", compute, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      editor.off("transaction", onTx);
      window.removeEventListener("resize", compute);
      scroller?.removeEventListener("scroll", compute);
    };
  }, [editor, wrapperRef, comments]);

  if (!badges.length) return null;

  return (
    <div
      className="pointer-events-none absolute top-0 right-0 h-full"
      style={{ width: 36, transform: "translateX(calc(100% + 12px))" }}
      aria-hidden={false}
    >
      {badges.map((b, i) => (
        <BadgeButton key={i} y={b.y} group={b.group} onOpen={onOpen} />
      ))}
    </div>
  );
}

function BadgeButton({
  y,
  group,
  onOpen,
}: {
  y: number;
  group: CommentResolution[];
  onOpen: (id: string, rect: DOMRect) => void;
}) {
  const count = group.length;
  return (
    <button
      type="button"
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onOpen(group[0].comment.id, rect);
      }}
      title={count > 1 ? `${count} comments` : "1 comment"}
      className="pointer-events-auto absolute flex items-center gap-1 rounded-button border border-hairline bg-elevated px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
      style={{
        top: y,
        boxShadow: "var(--shadow-panel)",
      }}
    >
      <MessageSquare className="h-3 w-3" aria-hidden />
      <span>{count}</span>
    </button>
  );
}
