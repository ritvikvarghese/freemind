"use client";

import { useEditor, useValue, type TLShape } from "tldraw";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2 } from "lucide-react";
import { useActiveRun } from "@/lib/agent/abortRegistry";
import { useApiKey } from "@/lib/storage/apiKey";
import {
  estimateTokens,
  fmtTokens,
  MAX_INPUT_TOKENS_SOFT,
} from "@/lib/agent/tokenEstimate";
import { launchResearch } from "./launchResearch";
import {
  isSourceShape,
  sourceText,
  type SourceShape,
} from "@/lib/agent/buildContext";
import {
  AGENT_MODES,
  DEFAULT_AGENT_MODE,
  type AgentMode,
} from "@/lib/agent/modes";

const MODE_STORAGE_KEY = "canvas-ai:agent-mode";

function loadStoredMode(): AgentMode {
  if (typeof window === "undefined") return DEFAULT_AGENT_MODE;
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "freeform" || v === "deepsynth" || v === "deepsearch") return v;
    if (v === "deep-research") return "deepsearch";
  } catch {
    /* ignored */
  }
  return DEFAULT_AGENT_MODE;
}

function storeMode(m: AgentMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, m);
  } catch (err) {
    // Mode-toggle quota errors are unlikely (small string) but surface anyway.
    import("@/lib/storage/quotaToast").then((mod) =>
      mod.reportStorageError(err),
    );
  }
}

const PROMPT_WIDTH = 480;
// Leaves room above the tldraw watermark + page-menu pill at the bottom.
const BOTTOM_OFFSET = 56;
const RIGHT_OFFSET = 16;
const TEXTAREA_MIN_HEIGHT = 22;
const TEXTAREA_MAX_HEIGHT = 320;

export function FloatingPrompt() {
  const editor = useEditor();
  const { hasKey } = useApiKey();
  const { isActive } = useActiveRun();
  const [prompt, setPrompt] = useState("");
  const [mode, setModeState] = useState<AgentMode>(() => loadStoredMode());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function setMode(next: AgentMode) {
    setModeState(next);
    storeMode(next);
  }

  // Track selection of OUR source shape types (text + upload).
  const selectedSources = useValue<SourceShape[]>(
    "canvas-ai-selected-sources",
    () => {
      const shapes = editor.getSelectedShapes() as TLShape[];
      return shapes.filter(isSourceShape) as SourceShape[];
    },
    [editor],
  );

  const hasSources = selectedSources.length > 0;
  const tokenEstimate = useTokenEstimate(selectedSources, prompt);
  const isOverBudget = tokenEstimate > MAX_INPUT_TOKENS_SOFT;
  const canSubmit =
    hasSources &&
    hasKey &&
    !isActive &&
    !isOverBudget &&
    prompt.trim().length > 0;

  // Auto-focus the textarea when sources become selected. We deliberately
  // don't clear the prompt here — if the user briefly clicks away and back,
  // their draft is preserved.
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

  if (!hasSources) return null;

  function handleSubmit() {
    if (!canSubmit) return;
    const trimmed = prompt.trim();
    setPrompt("");
    launchResearch(editor, selectedSources, trimmed, mode);
  }

  const disabledReason = !hasKey
    ? "Add an Anthropic API key in Settings to run."
    : isActive
      ? "A research run is already in progress."
      : isOverBudget
        ? `Context too large (~${fmtTokens(tokenEstimate)}). Deselect some sources.`
        : null;

  return (
    <div
      className="fixed pointer-events-auto z-30"
      style={{
        right: RIGHT_OFFSET,
        bottom: BOTTOM_OFFSET,
        width: PROMPT_WIDTH,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-panel border border-hairline bg-elevated p-3 shadow-[var(--shadow-floating)]"
        style={{
          transition:
            "transform 140ms var(--ease-out-fast), opacity 140ms var(--ease-out-fast)",
        }}
      >
        <div className="flex items-center gap-1 mb-2">
          {AGENT_MODES.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                title={m.hint}
                className={
                  "px-2 py-0.5 rounded-button text-[11px] font-medium tracking-tight transition-colors duration-100 " +
                  (active
                    ? "bg-accent text-on-accent"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-hover")
                }
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              canSubmit
            ) {
              e.preventDefault();
              handleSubmit();
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
          <div className="text-[11px] text-text-tertiary truncate">
            {disabledReason ? (
              <span style={isOverBudget ? { color: "var(--color-error)" } : undefined}>
                {disabledReason}
              </span>
            ) : (
              <>
                <span>{selectedSources.length} source{selectedSources.length === 1 ? "" : "s"}</span>
                <span className="mx-1.5">·</span>
                <span>~{fmtTokens(tokenEstimate)}</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-button bg-accent text-on-accent px-2.5 py-1 text-[12px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isActive ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            Run
            <span className="text-on-accent/60 flex items-center gap-0.5 ml-0.5">
              <span className="text-[10px]">⌘</span>
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
  // Don't bother building the full XML envelope; estimate from raw lengths.
  // Images add their OCR text (chars) plus a vision cost of ~(w*h)/750 tokens.
  // Scanned PDFs add ~1.5k tokens per page (sent as a vision document).
  let visionTokens = 0;
  const sourceChars = sources.reduce((acc, s) => {
    if (s.type === "canvas-ai-text") return acc + s.props.text.length;
    if (s.type === "canvas-ai-document") return acc + s.props.markdown.length;
    if (s.type === "canvas-ai-image") {
      visionTokens += Math.ceil((s.props.naturalW * s.props.naturalH) / 750);
      return acc + s.props.ocrText.length;
    }
    if (s.type === "canvas-ai-upload" && s.props.pdfData) {
      visionTokens += s.props.pageCount * TOKENS_PER_PDF_PAGE;
      return acc;
    }
    if (s.type === "text") return acc + sourceText(s).length;
    return acc + s.props.fullText.length;
  }, 0);
  return estimateTokens(sourceChars + userPrompt.length) + visionTokens;
}
