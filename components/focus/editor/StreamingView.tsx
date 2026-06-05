"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";

type Props = {
  markdown: string;
  /** Show the "writing…" indicator. Default true. */
  showIndicator?: boolean;
};

/**
 * Read-only renderer used while the AI is streaming markdown into the shape.
 * Pattern A from the plan: stream into a placeholder; once the run completes
 * the parent swaps this for the live Tiptap RichEditor. Streaming live into
 * Tiptap is fragile (broken fences, partial list markers — see Tiptap #5563).
 *
 * Bottom-anchored auto-scroll keeps the latest content visible without
 * fighting the user if they scroll up to read prior paragraphs.
 */
export function StreamingView({ markdown, showIndicator = true }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = distanceFromBottom < 40;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [markdown]);

  return (
    <div ref={scrollRef} className="canvas-ai-streaming-view h-full overflow-auto">
      <div className="canvas-ai-prose">
        {markdown ? (
          <MarkdownView>{markdown}</MarkdownView>
        ) : null}
        {showIndicator ? (
          <div className="mt-3 inline-flex items-center gap-2 text-[12px] text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span>writing…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
