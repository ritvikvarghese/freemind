"use client";

import { useEffect, useRef } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { installChatCopyGuard } from "@/lib/clipboard/chatCopyGuard";
import type { ChatMessage, Proposal } from "@/lib/storage/chatTypes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import { SourceCard } from "@/components/canvas/chat/SourceCard";
import { ProposalCard } from "./ProposalCard";
import { ToolUseStreamingCard } from "./ToolUseStreamingCard";

export type StreamingToolUse = {
  id: string;
  name: string;
  rationale: string | null;
};

type Props = {
  messages: ChatMessage[];
  streamingAssistantText: string;
  streamingToolUses: StreamingToolUse[];
  /** Map of proposalId → live status (from in-memory registry). */
  liveStatus: Map<string, Proposal["status"]>;
  onAccept: (proposal: Proposal) => void;
  onReject: (proposal: Proposal) => void;
  /** Re-ask the AI to make a stale proposal's edit against the current doc.
   *  Omitted by the canvas chat (no proposals there). */
  onRedo?: (proposal: Proposal) => void;
  /** Canvas chat only: resolve a message's attachmentIds to source snapshots so
   *  their cards render inline above the bubble. Omitted by the artifact chat. */
  resolveAttachments?: (message: ChatMessage) => SourceSnapshot[];
};

export function ChatThread({
  messages,
  streamingAssistantText,
  streamingToolUses,
  liveStatus,
  onAccept,
  onReject,
  onRedo,
  resolveAttachments,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  // Stop tldraw from hijacking Cmd+C over selected chat text (it would copy
  // serialized shape JSON because the document shape stays selected).
  useEffect(() => installChatCopyGuard(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = dist < 40;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingAssistantText, streamingToolUses]);

  const isEmpty =
    messages.length === 0 &&
    streamingAssistantText.length === 0 &&
    streamingToolUses.length === 0;

  return (
    <div
      ref={scrollRef}
      className="canvas-ai-chat-selectable min-h-0 flex-1 overflow-auto px-3 py-4"
    >
      {isEmpty ? (
        <div className="mx-auto mt-12 max-w-[280px] text-center text-[12px] text-text-tertiary">
          Ask a question about the document, or request an edit. Edits are
          proposed and you accept or reject each one.
        </div>
      ) : null}
      <div className="space-y-4">
        {messages.map((m) => (
          <MessageBlock
            key={m.id}
            message={m}
            liveStatus={liveStatus}
            onAccept={onAccept}
            onReject={onReject}
            onRedo={onRedo}
            attachments={resolveAttachments?.(m) ?? []}
          />
        ))}
        {streamingAssistantText.length > 0 ||
        streamingToolUses.length > 0 ? (
          <div className="space-y-2">
            {streamingAssistantText ? (
              <div className="canvas-ai-prose canvas-ai-chat-prose text-[13px]">
                <MarkdownView>{streamingAssistantText}</MarkdownView>
              </div>
            ) : null}
            {streamingToolUses.map((tu) => (
              <ToolUseStreamingCard
                key={tu.id}
                toolName={tu.name}
                rationale={tu.rationale}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  liveStatus,
  onAccept,
  onReject,
  onRedo,
  attachments,
}: {
  message: ChatMessage;
  liveStatus: Map<string, Proposal["status"]>;
  onAccept: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
  onRedo?: (p: Proposal) => void;
  attachments: SourceSnapshot[];
}) {
  if (message.role === "user") {
    return (
      <div className="ml-6 space-y-1.5">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        ) : null}
        {message.quote ? (
          <div className="flex items-stretch gap-2 rounded-button border border-hairline bg-elevated px-2.5 py-1.5">
            <div className="w-[2px] shrink-0 rounded-sm bg-text-tertiary/50" aria-hidden />
            <div className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-snug text-text-secondary">
              {message.quote}
            </div>
          </div>
        ) : null}
        {message.text ? (
          <div className="rounded-button bg-surface-hover px-3 py-2 text-[13px] text-text-primary whitespace-pre-wrap">
            {message.text}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {message.text ? (
        <div className="canvas-ai-prose canvas-ai-chat-prose text-[13px]">
          <MarkdownView>{message.text}</MarkdownView>
        </div>
      ) : null}
      {message.proposals?.map((p) => {
        const live = liveStatus.get(p.id) ?? p.status;
        const proposal = { ...p, status: live } as Proposal;
        return (
          <ProposalCard
            key={p.id}
            proposal={proposal}
            onAccept={() => onAccept(proposal)}
            onReject={() => onReject(proposal)}
            onRedo={onRedo ? () => onRedo(proposal) : undefined}
          />
        );
      })}
      {message.error ? (
        <div
          className="rounded-button border px-3 py-2 text-[12px]"
          style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          {message.error}
        </div>
      ) : null}
    </div>
  );
}
