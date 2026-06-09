"use client";

import { useEditor, useValue, type TLShape } from "tldraw";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, CornerDownLeft, Info, Loader2, Plus } from "lucide-react";
import { useActiveRun } from "@/lib/agent/abortRegistry";
import { useApiKey } from "@/lib/storage/apiKey";
import { useBoardKey } from "@/components/canvas/BoardContext";
import {
  stageSourcesToOpenChat,
  useOpenChatId,
  useStagedSources,
} from "@/lib/chat/openChat";
import { useCanvasChat } from "@/lib/storage/canvasChats";
import {
  estimateTokens,
  fmtTokens,
  MAX_INPUT_TOKENS_SOFT,
} from "@/lib/agent/tokenEstimate";
import { launchResearch } from "./launchResearch";
import { launchCanvasChat } from "./launchCanvasChat";
import {
  isSourceShape,
  snapshotSource,
  sourceText,
  type SourceShape,
} from "@/lib/agent/buildContext";
import { isVisionPdf } from "@/lib/extract/pdf";
import { type AgentMode } from "@/lib/agent/modes";

// The prompt's primary control: pick a chat mode, or make a document directly.
type PromptSelection = AgentMode | "create-artifact";

const SELECTION_STORAGE_KEY = "canvas-ai:agent-mode";

const OPTIONS: { id: PromptSelection; label: string; description: string }[] = [
  {
    id: "freeform",
    label: "Freeform",
    description: "Chats with you about your sources, in whatever format you ask.",
  },
  {
    id: "deepsynth",
    label: "Deepsynth",
    description:
      "Reasons across only your sources and writes a synthesis document. No web.",
  },
  {
    id: "deepsearch",
    label: "Deepsearch",
    description: "Searches the web and writes a long, cited research document.",
  },
  {
    id: "create-artifact",
    label: "Create artifact",
    description: "Turns your sources straight into a document, no back and forth.",
  },
];

// Depth used when "Create artifact" is chosen at the prompt (no chat). Freeform
// lets the user's prompt drive the document's shape and length, with minimal web
// use — the least surprising default. (Web-heavy research docs are still one
// click away: chat in Deepsearch, then Create artifact.)
const CREATE_ARTIFACT_DEPTH: AgentMode = "freeform";

function loadStoredSelection(): PromptSelection {
  if (typeof window === "undefined") return "freeform";
  try {
    const v = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (
      v === "freeform" ||
      v === "deepsynth" ||
      v === "deepsearch" ||
      v === "create-artifact"
    )
      return v;
    if (v === "deep-research") return "deepsearch";
  } catch {
    /* ignored */
  }
  return "freeform";
}

function storeSelection(s: PromptSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, s);
  } catch (err) {
    import("@/lib/storage/quotaToast").then((mod) => mod.reportStorageError(err));
  }
}

const PROMPT_WIDTH = 480;
const BOTTOM_OFFSET = 56;
const RIGHT_OFFSET = 16;
// "Add to chat" pill geometry (screen space).
const DOCK_WIDTH = 400;
const PILL_MARGIN = 16;
const PILL_GAP = 10;
const PILL_HALF = 80; // ~half the pill's width, for edge clamping
const TEXTAREA_MIN_HEIGHT = 22;
const TEXTAREA_MAX_HEIGHT = 320;

export function FloatingPrompt() {
  const editor = useEditor();
  const { hasKey } = useApiKey();
  const { isActive } = useActiveRun();
  const boardKey = useBoardKey();
  const openChatId = useOpenChatId();
  const [prompt, setPrompt] = useState("");
  const [selection, setSelectionState] = useState<PromptSelection>(() =>
    loadStoredSelection(),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function setSelection(next: PromptSelection) {
    setSelectionState(next);
    storeSelection(next);
    setMenuOpen(false);
  }

  const selectedSources = useValue<SourceShape[]>(
    "canvas-ai-selected-sources",
    () => {
      const shapes = editor.getSelectedShapes() as TLShape[];
      return shapes.filter(isSourceShape) as SourceShape[];
    },
    [editor],
  );

  // When a chat dock is open, the canvas selection feeds an "Add to chat"
  // affordance instead of a competing prompt. Dedup against docs already in
  // that chat so the count is accurate.
  const openChatSession = useCanvasChat(openChatId);
  const stagedSources = useStagedSources();
  const addableForChat = useValue<SourceShape[]>(
    "canvas-ai-addable-for-chat",
    () => {
      if (!openChatId) return [];
      const have = new Set([
        ...(openChatSession?.sourceIds ?? []),
        ...stagedSources.map((s) => s.id),
      ]);
      const shapes = editor.getSelectedShapes() as TLShape[];
      return (shapes.filter(isSourceShape) as SourceShape[]).filter(
        (s) => !have.has(s.id as string),
      );
    },
    [editor, openChatId, openChatSession?.sourceIds, stagedSources],
  );

  // Screen-space anchor for the "Add to chat" pill: centered just above the
  // selection's bounds, clamped to stay on-canvas (left of the 400px dock).
  // Returns null when the selection is offscreen/behind the dock — the caller
  // then pins the pill to a fixed fallback spot so the action is never lost.
  const pillAnchor = useValue(
    "canvas-ai-add-pill-anchor",
    () => {
      const b = editor.getSelectionRotatedScreenBounds();
      if (!b) return null;
      const vp = editor.getViewportScreenBounds();
      const usableRight = vp.maxX - DOCK_WIDTH - PILL_MARGIN;
      const visible =
        b.maxX > vp.minX + PILL_MARGIN &&
        b.minX < usableRight &&
        b.maxY > vp.minY &&
        b.minY < vp.maxY;
      if (!visible) return null;
      const left = Math.min(
        Math.max(b.minX + b.w / 2, vp.minX + PILL_HALF),
        usableRight - PILL_HALF,
      );
      const above = b.minY - PILL_GAP;
      return above > vp.minY + PILL_MARGIN
        ? { left, top: above, placement: "above" as const }
        : { left, top: b.maxY + PILL_GAP, placement: "below" as const };
    },
    [editor],
  );

  const hasSources = selectedSources.length > 0;
  const tokenEstimate = useTokenEstimate(selectedSources, prompt);
  const isOverBudget = tokenEstimate > MAX_INPUT_TOKENS_SOFT;
  const isArtifact = selection === "create-artifact";
  const canSubmit =
    hasSources &&
    hasKey &&
    !isOverBudget &&
    prompt.trim().length > 0 &&
    // Artifacts hold a single-run lock; chat runs independently so it ignores it.
    (isArtifact ? !isActive : true) &&
    (isArtifact || !!boardKey);

  useEffect(() => {
    if (hasSources) textareaRef.current?.focus();
  }, [hasSources]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(
      TEXTAREA_MAX_HEIGHT,
      Math.max(TEXTAREA_MIN_HEIGHT, el.scrollHeight),
    );
    el.style.height = `${next}px`;
  }, [prompt]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  // While a chat dock is open, render a compact "Add to chat" pill floating
  // just above the selection (instead of the full prompt). Nothing addable → hide.
  if (openChatId) {
    if (addableForChat.length === 0) return null;
    const pill = (
      <button
        type="button"
        onClick={() => {
          const capturedAt = Date.now();
          stageSourcesToOpenChat(
            addableForChat.map((s) => snapshotSource(s, capturedAt)),
          );
          editor.setSelectedShapes([]);
        }}
        className="flex items-center gap-1.5 rounded-button border border-hairline bg-elevated px-3 py-2 text-[12px] font-medium text-text-primary shadow-[var(--shadow-floating)] hover:border-hairline-hover transition-colors duration-100"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add {addableForChat.length} to chat
      </button>
    );
    return (
      <div
        className="fixed pointer-events-auto z-30"
        style={
          pillAnchor
            ? {
                left: pillAnchor.left,
                top: pillAnchor.top,
                transform:
                  pillAnchor.placement === "above"
                    ? "translate(-50%, -100%)"
                    : "translate(-50%, 0)",
              }
            : { right: DOCK_WIDTH + RIGHT_OFFSET * 2, bottom: BOTTOM_OFFSET }
        }
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {pill}
      </div>
    );
  }

  if (!hasSources) return null;

  function handleSubmit() {
    if (!canSubmit) return;
    const trimmed = prompt.trim();
    setPrompt("");
    if (selection === "freeform") {
      // Freeform is the only conversational mode — open a chat.
      if (boardKey) launchCanvasChat(editor, selectedSources, trimmed, selection, boardKey);
    } else {
      // Deepsynth / Deepsearch / Create artifact all produce a document on the
      // canvas, differing only in research depth.
      const depth: AgentMode =
        selection === "create-artifact" ? CREATE_ARTIFACT_DEPTH : selection;
      launchResearch(editor, selectedSources, trimmed, depth);
    }
  }

  const disabledReason = !hasKey
    ? "Add an Anthropic API key in Settings to run."
    : isArtifact && isActive
      ? "A research run is already in progress."
      : isOverBudget
        ? `Context too large (~${fmtTokens(tokenEstimate)}). Deselect some sources.`
        : null;

  const currentLabel =
    OPTIONS.find((o) => o.id === selection)?.label ?? "Freeform";

  return (
    <div
      className="fixed pointer-events-auto z-30"
      style={{
        right: openChatId ? 400 + RIGHT_OFFSET * 2 : RIGHT_OFFSET,
        bottom: BOTTOM_OFFSET,
        width: PROMPT_WIDTH,
        transition: "right 140ms var(--ease-out-fast)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-panel border border-hairline bg-elevated p-3 shadow-[var(--shadow-floating)]"
        style={{
          transition:
            "transform 140ms var(--ease-out-fast), opacity 140ms var(--ease-out-fast)",
        }}
      >
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Enter submits; Shift+Enter inserts a newline (standard chat UX).
            // Cmd/Ctrl+Enter still submits too.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSubmit) handleSubmit();
            }
          }}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder="what are we cooking?"
          spellCheck={false}
          rows={1}
          className="w-full resize-none bg-transparent outline-none text-[14px] leading-[1.5] text-text-primary placeholder:text-text-tertiary font-sans overflow-y-auto"
          style={{
            letterSpacing: "-0.01em",
            minHeight: TEXTAREA_MIN_HEIGHT,
            maxHeight: TEXTAREA_MAX_HEIGHT,
          }}
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative" ref={menuRef}>
              {menuOpen ? (
                <div className="absolute bottom-9 left-0 w-[184px] rounded-panel border border-hairline bg-elevated p-1 shadow-[var(--shadow-floating)]">
                  {OPTIONS.map((o) => (
                    <div key={o.id}>
                      <button
                        type="button"
                        onClick={() => setSelection(o.id)}
                        className={
                          "flex w-full items-center gap-2 rounded-button px-2.5 py-1.5 text-left text-[12px] " +
                          (selection === o.id
                            ? "bg-accent text-on-accent"
                            : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
                        }
                      >
                        <span className="flex-1">{o.label}</span>
                        <span
                          className="group/info relative flex items-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Info
                            className={
                              "h-3 w-3 shrink-0 " +
                              (selection === o.id
                                ? "text-on-accent/70"
                                : "text-text-tertiary")
                            }
                            aria-hidden
                          />
                          <span className="pointer-events-none absolute left-full top-1/2 z-[80] ml-2 hidden w-[214px] -translate-y-1/2 rounded-button border border-hairline bg-elevated px-2.5 py-1.5 text-[11px] leading-snug text-text-secondary shadow-[var(--shadow-floating)] group-hover/info:block">
                            {o.description}
                          </span>
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-button border border-hairline px-2.5 py-1 text-[11px] font-medium tracking-tight text-text-primary hover:border-hairline-hover transition-colors duration-100"
              >
                {currentLabel}
                <ChevronDown className="h-3 w-3 text-text-tertiary" aria-hidden />
              </button>
            </div>
            <div className="min-w-0 truncate text-[11px] text-text-tertiary">
              {disabledReason ? (
                <span
                  style={isOverBudget ? { color: "var(--color-error)" } : undefined}
                >
                  {disabledReason}
                </span>
              ) : (
                <>
                  <span>
                    {selectedSources.length} source
                    {selectedSources.length === 1 ? "" : "s"}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span>~{fmtTokens(tokenEstimate)}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex shrink-0 items-center gap-1.5 rounded-button bg-accent text-on-accent px-2.5 py-1 text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isArtifact && isActive ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            {isArtifact ? "Create" : "Chat"}
            <span className="text-on-accent/60 flex items-center ml-0.5">
              <CornerDownLeft className="h-2.5 w-2.5" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Rough vision cost of one scanned PDF page sent as a document block.
const TOKENS_PER_PDF_PAGE = 1_500;

function useTokenEstimate(sources: SourceShape[], userPrompt: string): number {
  let visionTokens = 0;
  const sourceChars = sources.reduce((acc, s) => {
    if (s.type === "canvas-ai-text") return acc + s.props.text.length;
    if (s.type === "canvas-ai-document") return acc + s.props.markdown.length;
    if (s.type === "canvas-ai-image") {
      visionTokens += Math.ceil((s.props.naturalW * s.props.naturalH) / 750);
      return acc + s.props.ocrText.length;
    }
    if (s.type === "canvas-ai-upload" && isVisionPdf(s.props)) {
      // Only scanned PDFs are sent as vision; text PDFs count via fullText below.
      visionTokens += s.props.pageCount * TOKENS_PER_PDF_PAGE;
      return acc;
    }
    if (s.type === "canvas-ai-link") return acc + sourceText(s).length;
    if (s.type === "canvas-ai-notes") return acc + sourceText(s).length;
    if (s.type === "text" || s.type === "note") return acc + sourceText(s).length;
    if (s.type === "bookmark") return acc + s.props.url.length;
    return acc + s.props.fullText.length;
  }, 0);
  return estimateTokens(sourceChars + userPrompt.length) + visionTokens;
}
