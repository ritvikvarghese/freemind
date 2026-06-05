"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor } from "tldraw";
import { ArrowUp, ChevronDown, Files, Square, X } from "lucide-react";
import type { ChatMessage, Proposal } from "@/lib/storage/chatTypes";
import type { AgentMode } from "@/lib/agent/modes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import { useApiKey } from "@/lib/storage/apiKey";
import {
  addSourcesToCanvasChat,
  saveCanvasChatMessages,
  setCanvasChatMode,
  useCanvasChat,
} from "@/lib/storage/canvasChats";
import { runCanvasChat, type WebSearch } from "@/lib/agent/chat/runCanvasChat";
import {
  clearStagedSources,
  closeChat,
  consumeAutoSend,
  removeStagedSource,
  useStagedSources,
} from "@/lib/chat/openChat";
import { ChatThread, type StreamingToolUse } from "@/components/focus/chat/ChatThread";
import { SourceCard } from "./SourceCard";
import { promoteToArtifact } from "./promoteToArtifact";

// Canvas chat has no proposals; ChatThread still wants these props.
const EMPTY_STATUS = new Map<string, Proposal["status"]>();
const noop = () => {};

type ComposerMode = "chat" | "deepsearch" | "create-artifact";

const MODE_LABEL: Record<ComposerMode, string> = {
  chat: "Chat",
  deepsearch: "Deepsearch",
  "create-artifact": "Create artifact",
};

// Canvas chat panel width is user-draggable (left edge) and persisted.
const CHAT_MIN_W = 340;
const CHAT_MAX_W = 760;
const CHAT_DEFAULT_W = 400;
const CHAT_WIDTH_KEY = "canvas-ai:chat-width";

// The composer's Deepsearch toggle layers on top of the chat's started mode.
function resolveTurnMode(cm: ComposerMode, started: AgentMode): AgentMode {
  if (cm === "deepsearch") return "deepsearch";
  return started === "deepsynth" ? "deepsynth" : "freeform";
}

export function ChatDock({ id }: { id: string }) {
  const editor = useEditor();
  const { hasKey } = useApiKey();
  const session = useCanvasChat(id);

  // Mounted fresh per chat id (CanvasOverlay sets key={id}), so lazy initializers
  // seed from the session without a reset effect.
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => session?.messages ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
  const [value, setValue] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>(() =>
    session?.mode === "deepsearch" ? "deepsearch" : "chat",
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const startedMode = useRef<AgentMode>(session?.mode ?? "freeform");

  // Sources added (from the dock button or the canvas "Add to chat") but not yet
  // sent — staged as cards above the composer (Claude.ai style). Held in the
  // shared openChat store so both entry points feed one list. On send they
  // commit into the session (so later turns keep them in context), bind to that
  // message for the inline cards, and seed the per-turn <focus>.
  const stagedSources = useStagedSources();
  // Context panel toggle (the "Files" button by the close X) — shows every doc
  // in the chat as cards, like Claude's context view (content only).
  const [contextOpen, setContextOpen] = useState(false);

  const [quotedContext, setQuotedContext] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return CHAT_DEFAULT_W;
    const v = Number(window.localStorage.getItem(CHAT_WIDTH_KEY));
    return Number.isFinite(v) && v >= CHAT_MIN_W && v <= CHAT_MAX_W
      ? v
      : CHAT_DEFAULT_W;
  });

  // Drag the left edge to resize. Panel is docked right, so dragging toward the
  // left (smaller clientX) widens it. Persist on release.
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(
          CHAT_MAX_W,
          Math.max(CHAT_MIN_W, startW + (startX - ev.clientX)),
        );
        setWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        setWidth((w) => {
          try {
            window.localStorage.setItem(CHAT_WIDTH_KEY, String(w));
          } catch {
            /* storage full / blocked — width just won't persist */
          }
          return w;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "col-resize";
    },
    [width],
  );
  const [quoteBtn, setQuoteBtn] = useState<
    { text: string; x: number; y: number } | null
  >(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  const threadWrapRef = useRef<HTMLDivElement | null>(null);

  // Resolve a message's attachmentIds to snapshots for the inline cards.
  const sourcesById = useMemo(() => {
    const m = new Map<string, SourceSnapshot>();
    for (const s of session?.sources ?? []) m.set(s.id, s);
    return m;
  }, [session?.sources]);
  const resolveAttachments = useCallback(
    (m: ChatMessage): SourceSnapshot[] =>
      (m.attachmentIds ?? [])
        .map((aid) => sourcesById.get(aid))
        .filter((s): s is SourceSnapshot => s !== undefined),
    [sourcesById],
  );

  // Show a floating "Reply" affordance when the user selects text in the thread.
  const onThreadMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (text && sel && sel.rangeCount > 0 && threadWrapRef.current?.contains(sel.anchorNode)) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setQuoteBtn({ text, x: rect.left + rect.width / 2, y: rect.top - 6 });
    } else {
      setQuoteBtn(null);
    }
  }, []);

  const sendChatTurn = useCallback(
    (text: string, mode: AgentMode, prior: ChatMessage[]) => {
      if (!session) return;
      const quote = quotedContext;
      if (!hasKey || (!text && !quote)) return;

      // Commit staged attachments into the session (so later turns keep them in
      // context) and bind this message to them — plus the originals on the
      // first turn — for the inline cards.
      const staged = stagedSources;
      const prevSources = session.sources;
      if (staged.length) {
        addSourcesToCanvasChat(
          id,
          staged,
          staged.map((s) => s.id),
        );
      }
      const effectiveSources = staged.length
        ? [...prevSources, ...staged]
        : prevSources;
      const originalIds = prior.length === 0 ? prevSources.map((s) => s.id) : [];
      const attachmentIds = [...originalIds, ...staged.map((s) => s.id)];

      // Per-turn <focus> directive: name the just-added (staged) docs so the
      // model builds this answer mainly from them. sids match the s1/s2…
      // numbering chatModes assigns by index in the sources it receives.
      const focused = staged.map((s) => {
        const idx = effectiveSources.findIndex((e) => e.id === s.id);
        return `"${s.title || "Untitled"}" (s${idx + 1})`;
      });
      const focusBlock = focused.length
        ? `<focus>${focused.join(", ")}</focus>\n\n`
        : "";
      // The quote renders as its own styled block above the bubble (see
      // ChatThread); wire it as a tagged block so the model treats it as
      // context, not the request.
      const wireMessage = quote
        ? `${focusBlock}<quote>\n${quote}\n</quote>\n\n${text || "Discuss or refine the quoted text above."}`
        : `${focusBlock}${text}`;
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        createdAt: Date.now(),
        ...(quote ? { quote } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      };
      const display = [...prior, userMsg];
      setMessages(display);
      saveCanvasChatMessages(id, display);
      if (staged.length) clearStagedSources();
      setQuotedContext(null);
      setBusy(true);
      setStreamingText("");
      setStreamingToolUses([]);

      abortRef.current = runCanvasChat({
        mode,
        sources: effectiveSources,
        history: prior,
        userMessage: wireMessage,
        onTextDelta: (delta) => setStreamingText((c) => c + delta),
        onWebSearch: (query) =>
          setStreamingToolUses((c) => [
            ...c,
            { id: crypto.randomUUID(), name: "web_search", rationale: query || null },
          ]),
        onCreateArtifact: (req) => {
          if (!session) return;
          promoteToArtifact(editor, session, { focus: req.focus });
        },
        onDone: (finalText, webSearches: WebSearch[]) => {
          const assistant: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: finalText,
            createdAt: Date.now(),
            ...(webSearches.length ? { webSearches } : {}),
          };
          const next = [...display, assistant];
          setMessages(next);
          saveCanvasChatMessages(id, next);
          setStreamingText("");
          setStreamingToolUses([]);
          setBusy(false);
          abortRef.current = null;
        },
        onError: (msg) => {
          const assistant: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "",
            error: msg,
            createdAt: Date.now(),
          };
          const next = [...display, assistant];
          setMessages(next);
          saveCanvasChatMessages(id, next);
          setStreamingText("");
          setStreamingToolUses([]);
          setBusy(false);
          abortRef.current = null;
        },
      });
    },
    [editor, hasKey, id, quotedContext, stagedSources, session],
  );

  // Explicit promote from the composer's "Create artifact" mode: echo the
  // focus as a user bubble, drop a confirmation, and spawn the document.
  const promoteFromComposer = useCallback(
    (focus: string | undefined) => {
      if (!session) return;
      const trimmed = focus?.trim() || undefined;
      // Fold any staged attachments into the session so the artifact is written
      // with them, and show them on the echo bubble.
      const staged = stagedSources;
      if (staged.length) {
        addSourcesToCanvasChat(
          id,
          staged,
          staged.map((s) => s.id),
        );
      }
      const effectiveSession = staged.length
        ? {
            ...session,
            sources: [...session.sources, ...staged],
            sourceIds: [...session.sourceIds, ...staged.map((s) => s.id)],
          }
        : session;
      const attachmentIds = staged.map((s) => s.id);
      const userEcho: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed ?? "Write this up as a document.",
        createdAt: Date.now(),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      };
      const note: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Created a document on the canvas. It's writing now — open it to read or edit.",
        createdAt: Date.now(),
      };
      const next = [...messages, userEcho, note];
      setMessages(next);
      saveCanvasChatMessages(id, next);
      if (staged.length) clearStagedSources();
      promoteToArtifact(editor, effectiveSession, { focus: trimmed });
    },
    [editor, id, messages, session, stagedSources],
  );

  const submit = useCallback(() => {
    if (busy) return;
    const text = value.trim();
    if (composerMode === "create-artifact") {
      promoteFromComposer(text);
      setValue("");
      setComposerMode("chat"); // one-shot
      setCanvasChatMode(id, resolveTurnMode("chat", startedMode.current));
      return;
    }
    if (!text && !quotedContext) return;
    sendChatTurn(text, resolveTurnMode(composerMode, startedMode.current), messages);
    setValue("");
  }, [
    busy,
    composerMode,
    id,
    messages,
    promoteFromComposer,
    quotedContext,
    sendChatTurn,
    value,
  ]);

  const selectMode = useCallback(
    (next: ComposerMode) => {
      setComposerMode(next);
      setMenuOpen(false);
      if (next === "deepsearch") setCanvasChatMode(id, "deepsearch");
      else if (next === "chat")
        setCanvasChatMode(id, resolveTurnMode("chat", startedMode.current));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [id],
  );

  // Auto-send the opening prompt once, on mount. Deferred to a timeout and the
  // prompt is consumed INSIDE it, so React StrictMode's mount→cleanup→mount
  // cycle can't abort the stream: the throwaway first mount clears its pending
  // timer before it fires, and only the surviving mount consumes + sends.
  useEffect(() => {
    const t = setTimeout(() => {
      const auto = consumeAutoSend();
      if (auto && auto.trim()) {
        sendChatTurn(auto.trim(), startedMode.current, []);
      }
    }, 0);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // Mount-only: seeding/auto-send belong to this dock instance (keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Close the mode menu only on clicks OUTSIDE the composer (so clicking a menu
  // item applies it instead of being eaten by an unconditional close).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!composerBoxRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menuOpen]);

  // If the session vanishes (e.g. deleted while open), clear the open-state so
  // the dock and the shifted top-right cluster reset together.
  useEffect(() => {
    if (!session) closeChat();
  }, [session]);

  if (!session) return null;

  const placeholder =
    composerMode === "create-artifact"
      ? "What should it focus on? (optional)"
      : composerMode === "deepsearch"
        ? "Ask — I'll search the web…"
        : "Ask a follow-up…";

  return (
    <aside
      className="pointer-events-auto fixed right-0 top-0 z-30 flex h-full flex-col overflow-hidden border-l border-hairline bg-elevated"
      style={{ width }}
      aria-label="Canvas chat"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        title="Drag to resize"
        className="group absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize"
      >
        <div className="absolute inset-y-0 left-0 w-[2px] bg-transparent transition-colors duration-100 group-hover:bg-accent/40" />
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="truncate text-[13px] font-medium text-text-primary">
          {session.title}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            aria-label={contextOpen ? "Back to chat" : "View context"}
            title={contextOpen ? "Back to chat" : "Context"}
            className={
              "grid h-6 w-6 place-items-center rounded-button " +
              (contextOpen
                ? "bg-accent text-on-accent"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
            }
          >
            <Files className="h-3.5 w-3.5" aria-hidden />
            {session.sources.length > 0 ? (
              <span className="sr-only">{session.sources.length} sources</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              closeChat();
            }}
            aria-label="Close chat"
            className="grid h-6 w-6 place-items-center rounded-button text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {contextOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
              Content · {session.sources.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {session.sources.length === 0 ? (
              <div className="mt-8 text-center text-[12px] text-text-tertiary">
                No documents in this chat yet.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {session.sources.map((s) => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={threadWrapRef}
            className="flex min-h-0 flex-1 flex-col"
            onMouseUp={onThreadMouseUp}
          >
            <ChatThread
              messages={messages}
              streamingAssistantText={streamingText}
              streamingToolUses={streamingToolUses}
              liveStatus={EMPTY_STATUS}
              onAccept={noop}
              onReject={noop}
              resolveAttachments={resolveAttachments}
            />
          </div>

          <div className="border-t border-hairline bg-elevated p-3">
            {!hasKey ? (
              <div className="mb-2 text-[11px] text-text-tertiary">
                Set an API key in Settings to chat.
              </div>
            ) : null}

            {/* staged attachments (cards) above the message box. Adding from the
                canvas happens via the FloatingPrompt's "Add to chat" pill. */}
            {stagedSources.length > 0 ? (
              <div className="mb-2 flex flex-wrap items-end gap-1.5">
                {stagedSources.map((s) => (
                  <SourceCard
                    key={s.id}
                    source={s}
                    onRemove={() => removeStagedSource(s.id)}
                  />
                ))}
              </div>
            ) : null}

        <div
          ref={composerBoxRef}
          className="relative rounded-button border border-hairline bg-app px-3 py-2"
        >
          {quotedContext ? (
            <div className="mb-2 flex items-start gap-2 rounded-button border border-hairline bg-elevated px-2 py-1.5">
              <div
                className="my-0.5 w-[2px] shrink-0 self-stretch rounded-sm"
                style={{ background: "var(--color-text-tertiary)" }}
                aria-hidden
              />
              <div
                className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-snug text-text-secondary"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {quotedContext}
              </div>
              <button
                type="button"
                onClick={() => setQuotedContext(null)}
                aria-label="Remove quote"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-button text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ) : null}
          {menuOpen ? (
            <div className="absolute bottom-[46px] left-2 z-10 w-[200px] rounded-panel border border-hairline bg-elevated p-1 shadow-[var(--shadow-floating)]">
              {(["chat", "deepsearch", "create-artifact"] as ComposerMode[]).map(
                (m, i) => (
                  <div key={m}>
                    {i === 1 ? (
                      <div className="my-1 border-t border-hairline" />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectMode(m)}
                      className={
                        "block w-full rounded-button px-2.5 py-1.5 text-left text-[12px] " +
                        (composerMode === m
                          ? "bg-accent text-on-accent"
                          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
                      }
                    >
                      {MODE_LABEL[m]}
                    </button>
                  </div>
                ),
              )}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={!hasKey}
            rows={1}
            placeholder={placeholder}
            className="w-full resize-none bg-transparent text-[13px] leading-snug text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-button border border-hairline px-2.5 py-1 text-[11px] font-medium text-text-primary hover:border-hairline-hover"
            >
              {MODE_LABEL[composerMode]}
              <ChevronDown className="h-3 w-3 text-text-tertiary" aria-hidden />
            </button>
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop"
                className="grid h-7 w-7 place-items-center rounded-button bg-surface-hover text-text-secondary hover:text-text-primary"
              >
                <Square className="h-3 w-3" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={
                  !hasKey ||
                  (composerMode !== "create-artifact" &&
                    !value.trim() &&
                    !quotedContext)
                }
                aria-label={
                  composerMode === "create-artifact" ? "Create artifact" : "Send"
                }
                className="grid h-7 w-7 place-items-center rounded-button bg-accent text-on-accent disabled:opacity-40"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
        </>
      )}

      {quoteBtn ? (
        <button
          type="button"
          // Keep the text selection alive through the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQuotedContext(quoteBtn.text);
            setQuoteBtn(null);
            window.getSelection()?.removeAllRanges();
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          style={{
            position: "fixed",
            left: quoteBtn.x,
            top: quoteBtn.y,
            transform: "translate(-50%, -100%)",
          }}
          className="z-50 inline-flex items-center gap-1 rounded-button border border-hairline bg-elevated px-2.5 py-1 text-[11px] font-medium text-text-primary shadow-[var(--shadow-floating)]"
        >
          Reply
        </button>
      ) : null}
    </aside>
  );
}
