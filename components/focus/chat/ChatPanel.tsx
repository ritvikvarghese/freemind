"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import type { TLShapeId } from "tldraw";
import { X } from "lucide-react";
import type {
  ChatMessage,
  Proposal,
  ProposalStatus,
} from "@/lib/storage/chatTypes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { Editor } from "@tiptap/core";
import {
  loadChatHistory,
  saveChatHistory,
} from "@/lib/storage/chatHistory";
import { useApiKey } from "@/lib/storage/apiKey";
import { runChat } from "@/lib/agent/chat/runChat";
import {
  parseProposeEdit,
  parseProposeReplaceSection,
  peekPartialRationale,
} from "@/lib/agent/chat/tools";
import {
  addProposal,
  removeProposal,
  updateProposal,
  useProposals,
  clearProposals,
} from "@/lib/agent/chat/proposalRegistry";
import { applyProposalToEditor, computeBlockedIds, isProposalResolvable } from "@/components/focus/editor/applyProposal";
import { refreshDiffDecorations } from "@/components/focus/editor/diffDecorations";
import { ChatThread, type StreamingToolUse } from "./ChatThread";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";

type Props = {
  artifactId: TLShapeId;
  boardPersistenceKey: string;
  doc: { markdown: string; sources: SourceSnapshot[] };
  /** The live editor instance, used to apply accepted proposals + refresh decorations. */
  editor: Editor | null;
  onClose: () => void;
};

export type ChatPanelHandle = {
  openWithContext: (selectionText: string) => void;
};

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(
  { artifactId, boardPersistenceKey, doc, editor, onClose },
  ref,
) {
  const { hasKey } = useApiKey();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<ChatComposerHandle | null>(null);

  const proposals = useProposals(artifactId);

  const liveStatus = useMemo(() => {
    const m = new Map<string, ProposalStatus>();
    const markdown = editor?.getMarkdown() ?? doc.markdown;
    const blocked = computeBlockedIds(markdown, proposals);
    for (const p of proposals) {
      if (p.status === "accepted" || p.status === "rejected") {
        m.set(p.id, p.status);
        continue;
      }
      if (!isProposalResolvable(markdown, p)) {
        m.set(p.id, "stale");
        continue;
      }
      m.set(p.id, blocked.has(p.id) ? "blocked" : "pending");
    }
    return m;
  }, [proposals, doc.markdown, editor]);

  // Load history on mount / artifact change.
  useEffect(() => {
    let cancelled = false;
    loadChatHistory(artifactId).then((loaded) => {
      if (!cancelled) setMessages(loaded);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
      clearProposals(artifactId);
    };
  }, [artifactId]);

  // Persist history on every change. Cheap — IDB write is async and small.
  useEffect(() => {
    saveChatHistory(artifactId, boardPersistenceKey, messages);
  }, [artifactId, boardPersistenceKey, messages]);

  // Re-render diff decorations whenever the live status map changes.
  useEffect(() => {
    if (!editor) return;
    refreshDiffDecorations(editor);
  }, [liveStatus, editor]);

  useImperativeHandle(ref, () => ({
    openWithContext: (text) => {
      composerRef.current?.insertContext(text);
    },
  }));

  const submit = useCallback(
    ({
      text,
      quotedContext,
    }: {
      text: string;
      quotedContext: string | null;
    }) => {
      // Display copy: the visible bubble shows the quoted selection above the
      // typed instruction so the user sees what the model saw. Wire copy:
      // wrap the quote in a tagged block so the model treats it as context,
      // not as the user's literal request.
      const displayText = quotedContext
        ? `> ${quotedContext.split("\n").join("\n> ")}${text ? `\n\n${text}` : ""}`
        : text;
      const wireMessage = quotedContext
        ? `<selection>\n${quotedContext}\n</selection>\n\n${text || "Discuss or refine the selection above."}`
        : text;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: displayText,
        createdAt: Date.now(),
      };
      const history = [...messages, userMsg];
      setMessages(history);

      setBusy(true);
      setStreamingText("");
      setStreamingToolUses([]);

      const assembledProposals: Proposal[] = [];

      abortRef.current = runChat({
        doc,
        history,
        userMessage: wireMessage,
        onTextDelta: (delta) => {
          setStreamingText((cur) => cur + delta);
        },
        onToolUseStart: (id, name) => {
          setStreamingToolUses((cur) => [
            ...cur,
            { id, name, rationale: null },
          ]);
        },
        onToolUseInputDelta: (id, partialJson) => {
          const rationale = peekPartialRationale(partialJson);
          if (rationale == null) return;
          setStreamingToolUses((cur) =>
            cur.map((t) => (t.id === id ? { ...t, rationale } : t)),
          );
        },
        onToolUseEnd: (id, name, finalJson) => {
          setStreamingToolUses((cur) => cur.filter((t) => t.id !== id));
          const proposal = buildProposalFromTool(id, name, finalJson);
          if (!proposal) return;
          assembledProposals.push(proposal);
          addProposal(artifactId, proposal);
        },
        onDone: (finalText) => {
          const assistantMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: finalText,
            proposals: assembledProposals.length ? assembledProposals : undefined,
            createdAt: Date.now(),
          };
          setMessages((cur) => [...cur, assistantMsg]);
          setStreamingText("");
          setStreamingToolUses([]);
          setBusy(false);
          abortRef.current = null;
        },
        onError: (message) => {
          const assistantMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "",
            error: message,
            createdAt: Date.now(),
          };
          setMessages((cur) => [...cur, assistantMsg]);
          setStreamingText("");
          setStreamingToolUses([]);
          setBusy(false);
          abortRef.current = null;
        },
      });
    },
    [artifactId, doc, messages],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onAccept = useCallback(
    (proposal: Proposal) => {
      if (!editor) return;
      const live = liveStatus.get(proposal.id) ?? proposal.status;
      if (live !== "pending") return;
      const result = applyProposalToEditor(editor, proposal);
      if (result.ok) {
        updateProposal(artifactId, proposal.id, { status: "accepted" });
        // Reflect in persisted history.
        setMessages((cur) =>
          cur.map((m) =>
            m.proposals
              ? {
                  ...m,
                  proposals: m.proposals.map((p) =>
                    p.id === proposal.id ? { ...p, status: "accepted" } : p,
                  ),
                }
              : m,
          ),
        );
      } else {
        updateProposal(artifactId, proposal.id, { status: "stale" });
      }
    },
    [artifactId, editor, liveStatus],
  );

  const onReject = useCallback(
    (proposal: Proposal) => {
      updateProposal(artifactId, proposal.id, { status: "rejected" });
      setMessages((cur) =>
        cur.map((m) =>
          m.proposals
            ? {
                ...m,
                proposals: m.proposals.map((p) =>
                  p.id === proposal.id ? { ...p, status: "rejected" } : p,
                ),
              }
            : m,
        ),
      );
      // Drop from in-memory registry so decorations clear immediately.
      removeProposal(artifactId, proposal.id);
    },
    [artifactId],
  );

  return (
    <aside
      className="flex h-full w-full min-h-0 flex-col overflow-hidden border-l border-hairline bg-elevated"
      aria-label="AI chat"
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="text-[12px] font-medium text-text-secondary">Chat</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid h-6 w-6 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ChatThread
        messages={messages}
        streamingAssistantText={streamingText}
        streamingToolUses={streamingToolUses}
        liveStatus={liveStatus}
        onAccept={onAccept}
        onReject={onReject}
      />
      <ChatComposer
        ref={composerRef}
        disabled={!hasKey}
        disabledHint={
          hasKey ? undefined : "Set an API key in Settings to chat."
        }
        busy={busy}
        onSubmit={submit}
        onStop={stop}
      />
    </aside>
  );
});

function buildProposalFromTool(
  id: string,
  name: string,
  finalJson: string,
): Proposal | null {
  if (name === "propose_edit") {
    const parsed = parseProposeEdit(finalJson);
    if (!parsed) return null;
    return {
      id,
      kind: "propose_edit",
      status: "pending",
      ...parsed,
    };
  }
  if (name === "propose_replace_section") {
    const parsed = parseProposeReplaceSection(finalJson);
    if (!parsed) return null;
    return {
      id,
      kind: "propose_replace_section",
      status: "pending",
      ...parsed,
    };
  }
  return null;
}
