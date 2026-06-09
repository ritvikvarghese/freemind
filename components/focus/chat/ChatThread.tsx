"use client";

import { useEffect, useRef } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { FileText, Loader2 } from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { installChatCopyGuard } from "@/lib/clipboard/chatCopyGuard";
import type { ChatMessage, Proposal } from "@/lib/storage/chatTypes";
import type {
  DocumentNodeShape,
  SourceSnapshot,
} from "@/components/canvas/shapes/DocumentNode";
import { SourceCard } from "@/components/canvas/chat/SourceCard";
import { openFocus } from "@/lib/focus/openFocus";
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
      {message.docRef ? <DocRefCard docId={message.docRef.docId} /> : null}
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

const DOC_STATUS_LABEL: Record<DocumentNodeShape["props"]["status"], string> = {
  researching: "Researching…",
  streaming: "Writing…",
  done: "Created",
  stopped: "Stopped",
  error: "Couldn’t finish",
};

/**
 * Live status card for a document the chat just created (Deepsynth / Deepsearch
 * / Create artifact). Reads the DocumentNode's status + title reactively and
 * opens it on click, so the chat shows what's happening instead of a silent doc
 * appearing on the canvas.
 */
function DocRefCard({ docId }: { docId: string }) {
  const editor = useEditor();
  const id = docId as TLShapeId;
  const doc = useValue(
    "chat-doc-ref",
    () => {
      const s = editor.getShape(id) as DocumentNodeShape | undefined;
      if (!s || s.type !== "canvas-ai-document") return null;
      return { status: s.props.status, title: s.props.title };
    },
    [editor, id],
  );

  if (!doc) {
    return (
      <div className="rounded-button border border-hairline bg-elevated px-3 py-2 text-[12px] text-text-tertiary">
        Document removed.
      </div>
    );
  }

  const inProgress = doc.status === "researching" || doc.status === "streaming";

  return (
    <button
      type="button"
      onClick={() => openFocus(id)}
      className="flex w-full items-center gap-2.5 rounded-button border border-hairline bg-elevated px-3 py-2 text-left hover:border-hairline-hover"
    >
      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text-primary">
          {doc.title || "Untitled document"}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
          {inProgress ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : null}
          {DOC_STATUS_LABEL[doc.status]}
        </div>
      </div>
    </button>
  );
}
