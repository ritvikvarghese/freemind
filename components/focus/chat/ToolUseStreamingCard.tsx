"use client";

import { Loader2, Wand2, Globe } from "lucide-react";

type Props = {
  toolName: string;
  rationale: string | null;
};

export function ToolUseStreamingCard({ toolName, rationale }: Props) {
  const isWebSearch = toolName === "web_search";
  const label = isWebSearch
    ? "Searching the web"
    : toolName === "propose_replace_section"
      ? "Rewriting section"
      : "Preparing edit";
  const Icon = isWebSearch ? Globe : Wand2;
  return (
    <div className="rounded-button border border-hairline bg-elevated p-3 text-[12px]">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-5 w-5 place-items-center text-text-tertiary">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span>{label}…</span>
          </div>
          {rationale ? (
            <div className="mt-1 text-text-secondary">{rationale}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
