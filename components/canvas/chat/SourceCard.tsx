"use client";

import { X } from "lucide-react";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";

/**
 * A Claude.ai-style attachment card for a chat source. Used staged above the
 * composer, inline above the message it was attached to, and in the context
 * panel. Text/pasted sources show a short preview; file-like sources show a
 * line count. The kind badge sits bottom-left.
 */

const BADGE: Record<SourceSnapshot["kind"], string> = {
  text: "TEXT",
  "upload-pdf": "PDF",
  "upload-markdown": "MD",
  document: "DOC",
  image: "IMG",
  youtube: "YT",
};

function lineCount(text: string): number {
  if (!text.trim()) return 0;
  return text.split("\n").length;
}

export function SourceCard({
  source,
  onRemove,
}: {
  source: SourceSnapshot;
  onRemove?: () => void;
}) {
  const isText = source.kind === "text";
  const preview = source.text.trim().slice(0, 160);
  const lines = lineCount(source.text);

  return (
    <div className="relative flex h-[88px] w-[150px] shrink-0 flex-col justify-between overflow-hidden rounded-lg border border-hairline bg-elevated p-2.5">
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-button bg-elevated text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}

      {isText ? (
        <div
          className="min-h-0 flex-1 overflow-hidden text-[10px] leading-snug text-text-secondary"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
          }}
        >
          {preview || "Empty"}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <div
            className="text-[12px] font-medium leading-snug text-text-primary"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={source.title}
          >
            {source.title || "Untitled"}
          </div>
          {source.kind !== "image" ? (
            <div className="mt-0.5 text-[10px] text-text-tertiary">
              {lines} {lines === 1 ? "line" : "lines"}
            </div>
          ) : null}
        </div>
      )}

      <span className="mt-1 inline-flex w-fit rounded-button border border-hairline px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-text-tertiary">
        {BADGE[source.kind]}
      </span>
    </div>
  );
}
