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
import { X, ChevronLeft, Plus } from "lucide-react";
import type {
  ChatMessage,
  Proposal,
  ProposalStatus,
} from "@/lib/storage/chatTypes";
import type { AgentMode } from "@/lib/agent/modes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { Editor } from "@tiptap/core";
import {
  ensureDocumentChat,
  loadDocumentChat,
  saveDocumentChatMessages,
  setDocumentChatMode,
} from "@/lib/storage/documentChats";
import { useApiKey } from "@/lib/storage/apiKey";
import { runChat } from "@/lib/agent/chat/runChat";
import {
  parseProposeEdit,
  parseProposeReplaceSection,
  peekPartialRationale,
} from "@/lib/agent/chat/tools";
import { chatWebSearchMaxUses } from "@/lib/agent/chat/chatModes";
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

/** Doc chat modes, mapped onto the shared AgentMode tiers for persistence and
 *  web budget: chat = no web (deepsynth/closed-corpus), freeform = light web,
 *  deepsearch = heavy web + writes findings into the doc by default. */
export type DocChatMode = "chat" | "freeform" | "deepsearch";

function toAgentMode(mode: DocChatMode): AgentMode {
  if (mode === "deepsearch") return "deepsearch";
  if (mode === "freeform") return "freeform";
  return "deepsynth";
}

function fromAgentMode(mode: AgentMode | undefined): DocChatMode {
  if (mode === "deepsearch") return "deepsearch";
  if (mode === "freeform") return "freeform";
  return "chat";
}

type Props = {
  /** The document chat session this panel renders (one per chat). For a draft
   *  this id has no store record yet; it is created on the first sent message. */
  chatId: string;
  /** The document this chat belongs to, for committing a draft on first send. */
  documentId: string;
  boardPersistenceKey: string;
  /** Session title, shown in the panel header. */
  title: string;
  doc: { markdown: string; sources: SourceSnapshot[] };
  /** The live editor instance, used to apply accepted proposals + refresh decorations. */
  editor: Editor | null;
  onClose: () => void;
  /** Back to the document's chats list (multi-chat). */
  onBack?: () => void;
  /** Start a fresh chat from the panel header. */
  onNewChat?: () => void;
};

export type ChatPanelHandle = {
  openWithContext: (selectionText: string) => void;
};

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(
  {
    chatId,
    documentId,
    boardPersistenceKey,
    title,
    doc,
    editor,
    onClose,
    onBack,
    onNewChat,
  },
  ref,
) {
  const { hasKey } = useApiKey();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
  // Composer mode: "chat" (no web), "freeform" (light web, conversational), or
  // "deepsearch" (heavy web, writes findings into the doc by default). Edit
  // proposals work in every mode.
  const [mode, setMode] = useState<DocChatMode>("chat");
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  // Don't persist until the session's history has hydrated, or the initial
  // empty state would clobber a real saved thread.
  const hydratedRef = useRef(false);

  // Proposals are keyed per chat session (each chat owns its proposed edits).
  const proposals = useProposals(chatId);

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

  // Load the session's history on mount / session change.
  useEffect(() => {
    hydratedRef.current = false;
    let cancelled = false;
    loadDocumentChat(chatId).then((rec) => {
      if (cancelled) return;
      setMessages(rec?.messages ?? []);
      setMode(fromAgentMode(rec?.mode));
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
      // Do NOT abort an in-flight run on unmount: closing the panel should let
      // the response finish. The run persists its result straight to the store
      // (see onDone/onError), so it survives the panel closing.
      clearProposals(chatId);
    };
  }, [chatId]);

  // Persist messages on change, once hydrated. Cheap — IDB write is debounced.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveDocumentChatMessages(chatId, messages);
  }, [chatId, messages]);

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
      baseMessages,
    }: {
      text: string;
      quotedContext: string | null;
      /** Override the history this turn builds on. Used by Redo, which removes
       *  the stale proposal first; without this the closure's `messages` would
       *  clobber that removal. Defaults to the current messages. */
      baseMessages?: ChatMessage[];
    }) => {
      // The quoted selection renders as its own styled block above the bubble
      // (see ChatThread). Wire copy: wrap the quote in a tagged block so the
      // model treats it as context, not as the user's literal request.
      const wireMessage = quotedContext
        ? `<selection>\n${quotedContext}\n</selection>\n\n${text || "Discuss or refine the selection above."}`
        : text;

      // Commit a draft session on its first message: until now the chat had a
      // reserved id but no store record, so it never counted or showed in the
      // list. Title is the first message. No-op once the session exists.
      const titleSeed = (text || quotedContext || "New chat").trim();
      const turnMode = toAgentMode(mode);
      ensureDocumentChat({
        id: chatId,
        documentId,
        boardPersistenceKey,
        title:
          titleSeed.length > 48 ? titleSeed.slice(0, 47) + "…" : titleSeed,
        mode: turnMode,
      });

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        createdAt: Date.now(),
        ...(quotedContext ? { quote: quotedContext } : {}),
      };
      const history = [...(baseMessages ?? messages), userMsg];
      setMessages(history);

      setBusy(true);
      setStreamingText("");
      setStreamingToolUses([]);

      const assembledProposals: Proposal[] = [];

      abortRef.current = runChat({
        doc,
        history,
        userMessage: wireMessage,
        // Freeform allows light web; Deepsearch allows heavy web. Edit tools
        // stay on in every mode, so any web turn can also write into the doc.
        webSearchMaxUses: chatWebSearchMaxUses(turnMode),
        // Only Deepsearch defaults to writing findings into the document.
        webSearchWritesDoc: mode === "deepsearch",
        onWebSearch: (query) => {
          setStreamingToolUses((cur) => [
            ...cur,
            { id: crypto.randomUUID(), name: "web_search", rationale: query || null },
          ]);
        },
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
          addProposal(chatId, proposal);
        },
        onDone: (finalText, webSearches) => {
          const assistantMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: finalText,
            proposals: assembledProposals.length ? assembledProposals : undefined,
            createdAt: Date.now(),
            ...(webSearches.length ? { webSearches } : {}),
          };
          // Persist straight to the store so the result lands even if the panel
          // was closed mid-stream (the persist effect only runs while mounted).
          saveDocumentChatMessages(chatId, [...history, assistantMsg]);
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
          saveDocumentChatMessages(chatId, [...history, assistantMsg]);
          setMessages((cur) => [...cur, assistantMsg]);
          setStreamingText("");
          setStreamingToolUses([]);
          setBusy(false);
          abortRef.current = null;
        },
      });
    },
    [chatId, documentId, boardPersistenceKey, doc, messages, mode],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const selectMode = useCallback(
    (next: DocChatMode) => {
      setMode(next);
      setDocumentChatMode(chatId, toAgentMode(next));
    },
    [chatId],
  );

  const onAccept = useCallback(
    (proposal: Proposal) => {
      if (!editor) return;
      const live = liveStatus.get(proposal.id) ?? proposal.status;
      if (live !== "pending") return;
      const result = applyProposalToEditor(editor, proposal);
      if (result.ok) {
        updateProposal(chatId, proposal.id, { status: "accepted" });
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
        updateProposal(chatId, proposal.id, { status: "stale" });
      }
    },
    [chatId, editor, liveStatus],
  );

  const onReject = useCallback(
    (proposal: Proposal) => {
      updateProposal(chatId, proposal.id, { status: "rejected" });
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
      removeProposal(chatId, proposal.id);
    },
    [chatId],
  );

  // A stale proposal can't be applied because the document moved underneath it.
  // Instead of dead-ending the user, re-ask the model to make the same change
  // against the CURRENT document (it re-anchors and proposes a fresh edit). We
  // pass the original intent as context since chat history carries only flat
  // text, not the prior tool_use blocks.
  const onRedo = useCallback(
    (proposal: Proposal) => {
      const detail =
        proposal.kind === "propose_edit"
          ? `Intent: ${proposal.rationale}\n\nReplace this text:\n${proposal.old_text}\n\nWith:\n${proposal.new_text}`
          : `Intent: ${proposal.rationale}\n\nReplace the section "${proposal.heading}" with:\n${proposal.new_markdown}`;
      // Drop the superseded proposal card from the thread (and the in-memory
      // registry) so it disappears rather than lingering with live buttons.
      removeProposal(chatId, proposal.id);
      const base = messages.map((m) =>
        m.proposals
          ? { ...m, proposals: m.proposals.filter((p) => p.id !== proposal.id) }
          : m,
      );
      submit({
        text: "Redo this edit against the current document.",
        quotedContext: detail,
        baseMessages: base,
      });
    },
    [chatId, messages, submit],
  );

  return (
    <aside
      className="flex h-full w-full min-h-0 flex-col overflow-hidden border-l border-hairline bg-elevated"
      aria-label="AI chat"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-2.5 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chats"
            title="Back to chats"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">
          {title || "Chat"}
        </div>
        {onNewChat ? (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
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
        onRedo={onRedo}
      />
      <ChatComposer
        ref={composerRef}
        disabled={!hasKey}
        disabledHint={
          hasKey ? undefined : "Set an API key in Settings to chat."
        }
        busy={busy}
        mode={mode}
        onSelectMode={selectMode}
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
