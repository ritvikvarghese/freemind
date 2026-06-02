"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrlTransform } from "@/lib/markdown/urlTransform";
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
  resolveAttachments,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

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
            attachments={resolveAttachments?.(m) ?? []}
          />
        ))}
        {streamingAssistantText.length > 0 ||
        streamingToolUses.length > 0 ? (
          <div className="space-y-2">
            {streamingAssistantText ? (
              <div className="canvas-ai-prose canvas-ai-chat-prose text-[13px]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={markdownUrlTransform}
                >
                  {streamingAssistantText}
                </ReactMarkdown>
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
  attachments,
}: {
  message: ChatMessage;
  liveStatus: Map<string, Proposal["status"]>;
  onAccept: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
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
        <div className="rounded-button bg-surface-hover px-3 py-2 text-[13px] text-text-primary whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {message.text ? (
        <div className="canvas-ai-prose canvas-ai-chat-prose text-[13px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={markdownUrlTransform}
          >
            {message.text}
          </ReactMarkdown>
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
