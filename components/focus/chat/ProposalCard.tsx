"use client";

import { Check, X, AlertTriangle, Ban } from "lucide-react";
import type { Proposal } from "@/lib/storage/chatTypes";

type Props = {
  proposal: Proposal;
  onAccept: () => void;
  onReject: () => void;
};

export function ProposalCard({ proposal, onAccept, onReject }: Props) {
  const acceptDisabled =
    proposal.status === "stale" ||
    proposal.status === "blocked" ||
    proposal.status === "accepted" ||
    proposal.status === "rejected";

  return (
    <div className="rounded-button border border-hairline bg-elevated p-3 text-[12px]">
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 grid h-5 w-5 place-items-center rounded-full text-[10px] font-medium uppercase"
          style={{
            color: "var(--color-text-secondary)",
            background: "var(--color-surface-hover)",
          }}
        >
          {proposal.kind === "propose_edit" ? "E" : "§"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-text-secondary">{proposal.rationale}</div>
          <PreviewBlock proposal={proposal} />
          <StatusLine status={proposal.status} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onReject}
          disabled={proposal.status === "accepted" || proposal.status === "rejected"}
          className="flex items-center gap-1 rounded-button px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
        >
          <X className="h-3 w-3" aria-hidden /> Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={acceptDisabled}
          className="flex items-center gap-1 rounded-button bg-accent px-2 py-1 text-[11px] font-medium text-on-accent disabled:opacity-40"
        >
          <Check className="h-3 w-3" aria-hidden /> Accept
        </button>
      </div>
    </div>
  );
}

function PreviewBlock({ proposal }: { proposal: Proposal }) {
  if (proposal.kind === "propose_edit") {
    return (
      <div className="mt-2 space-y-1 font-mono text-[11px] leading-snug">
        <div className="rounded-button bg-app/40 p-2 text-text-tertiary line-through">
          {proposal.old_text}
        </div>
        <div
          className="rounded-button p-2"
          style={{
            background:
              "color-mix(in srgb, #4ec07a 18%, var(--color-elevated))",
            color: "var(--color-text-primary)",
          }}
        >
          {proposal.new_text}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1 text-[11px]">
      <div className="text-text-tertiary">
        Replace section: <span className="font-mono">{proposal.heading}</span>
      </div>
      <pre
        className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-button p-2 font-mono text-[11px]"
        style={{
          background:
            "color-mix(in srgb, #4ec07a 14%, var(--color-elevated))",
        }}
      >
        {proposal.new_markdown}
      </pre>
    </div>
  );
}

function StatusLine({ status }: { status: Proposal["status"] }) {
  if (status === "pending") return null;
  if (status === "accepted")
    return (
      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-text-tertiary">
        <Check className="h-3 w-3" aria-hidden /> Accepted
      </div>
    );
  if (status === "rejected")
    return (
      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-text-tertiary">
        <X className="h-3 w-3" aria-hidden /> Rejected
      </div>
    );
  if (status === "stale")
    return (
      <div
        className="mt-2 inline-flex items-center gap-1 text-[11px]"
        style={{ color: "var(--color-error)" }}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Stale — document changed. Reject and re-prompt.
      </div>
    );
  if (status === "blocked")
    return (
      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-text-tertiary">
        <Ban className="h-3 w-3" aria-hidden />
        Conflicts with an earlier proposal — resolve that first.
      </div>
    );
  return null;
}
