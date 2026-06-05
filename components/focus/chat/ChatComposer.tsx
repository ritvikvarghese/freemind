"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { ArrowUp, ChevronDown, Info, Square, X } from "lucide-react";

type ComposerMode = "chat" | "freeform" | "deepsearch";

const MODE_LABEL: Record<ComposerMode, string> = {
  chat: "Chat",
  freeform: "Freeform",
  deepsearch: "Deepsearch",
};

const MODE_DESC: Record<ComposerMode, string> = {
  chat: "Answers from this document and its sources only. No web.",
  freeform: "Can search the web when useful and answers in the chat.",
  deepsearch: "Researches the web and writes the result into the document.",
};

type Props = {
  disabled?: boolean;
  disabledHint?: string;
  busy: boolean;
  /** Current composer mode. When provided (with onSelectMode), a Chat /
   *  Deepsearch dropdown renders in the composer. */
  mode?: ComposerMode;
  onSelectMode?: (mode: ComposerMode) => void;
  /** `quotedContext` is the user-selected document text shown as a pill above
   *  the input. The handler is free to combine it with the typed instruction
   *  before sending to the model. */
  onSubmit: (args: { text: string; quotedContext: string | null }) => void;
  onStop: () => void;
};

export type ChatComposerHandle = {
  insertContext: (text: string) => void;
  focus: () => void;
};

const MAX_QUOTE_LEN = 600;

export const ChatComposer = forwardRef<ChatComposerHandle, Props>(
  function ChatComposer(
    { disabled, disabledHint, busy, mode, onSelectMode, onSubmit, onStop },
    ref,
  ) {
    const [value, setValue] = useState("");
    const [quotedContext, setQuotedContext] = useState<string | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const boxRef = useRef<HTMLDivElement | null>(null);
    const showModes = !!mode && !!onSelectMode;

    useImperativeHandle(ref, () => ({
      insertContext: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setQuotedContext(trimmed);
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
      focus: () => textareaRef.current?.focus(),
    }));

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    }, [value]);

    // Close the mode menu on clicks outside the composer box (a delayed listener
    // so the opening click doesn't immediately close it).
    useEffect(() => {
      if (!menuOpen) return;
      const onDown = (e: PointerEvent) => {
        if (!boxRef.current?.contains(e.target as Node)) setMenuOpen(false);
      };
      const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
      return () => {
        clearTimeout(t);
        document.removeEventListener("pointerdown", onDown);
      };
    }, [menuOpen]);

    const submit = () => {
      const trimmed = value.trim();
      if (busy || disabled) return;
      if (!trimmed && !quotedContext) return;
      onSubmit({ text: trimmed, quotedContext });
      setValue("");
      setQuotedContext(null);
    };

    const truncatedQuote =
      quotedContext && quotedContext.length > MAX_QUOTE_LEN
        ? quotedContext.slice(0, MAX_QUOTE_LEN) + "…"
        : quotedContext;

    return (
      <div className="border-t border-hairline bg-elevated p-3">
        {disabled && disabledHint ? (
          <div className="mb-2 text-[11px] text-text-tertiary">
            {disabledHint}
          </div>
        ) : null}
        <div
          ref={boxRef}
          className="relative rounded-button border border-hairline bg-app px-3 py-2"
        >
          {truncatedQuote ? (
            <div className="mb-2 flex items-start gap-2 rounded-button border border-hairline bg-elevated px-2 py-1.5">
              <div
                className="my-0.5 w-[2px] shrink-0 self-stretch rounded-sm"
                style={{ background: "var(--color-text-tertiary)" }}
                aria-hidden
              />
              <div className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-snug text-text-secondary">
                {truncatedQuote}
              </div>
              <button
                type="button"
                onClick={() => setQuotedContext(null)}
                aria-label="Remove quoted selection"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-button text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ) : null}
          {menuOpen && showModes ? (
            <div className="absolute bottom-[46px] left-2 z-10 w-[200px] rounded-panel border border-hairline bg-elevated p-1 shadow-[var(--shadow-floating)]">
              {(["chat", "freeform", "deepsearch"] as ComposerMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onSelectMode?.(m);
                    setMenuOpen(false);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  className={
                    "flex w-full items-center gap-2 rounded-button px-2.5 py-1.5 text-left text-[12px] " +
                    (mode === m
                      ? "bg-accent text-on-accent"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
                  }
                >
                  <span className="flex-1">{MODE_LABEL[m]}</span>
                  <span
                    className="group/info relative flex items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Info
                      className={
                        "h-3 w-3 shrink-0 " +
                        (mode === m ? "text-on-accent/70" : "text-text-tertiary")
                      }
                      aria-hidden
                    />
                    <span className="pointer-events-none absolute left-full top-1/2 z-[80] ml-2 hidden w-[160px] -translate-y-1/2 rounded-button border border-hairline bg-elevated px-2.5 py-1.5 text-[11px] leading-snug text-text-secondary shadow-[var(--shadow-floating)] group-hover/info:block">
                      {MODE_DESC[m]}
                    </span>
                  </span>
                </button>
              ))}
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
            disabled={disabled}
            rows={1}
            placeholder={
              disabled
                ? "Chat disabled"
                : quotedContext
                  ? "Ask about or edit the selection…"
                  : mode === "deepsearch"
                    ? "Search the web and add it to the document…"
                    : mode === "freeform"
                      ? "Ask anything (can search the web)…"
                      : "Ask or request an edit…"
            }
            className="w-full resize-none bg-transparent text-[13px] leading-snug text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            {showModes ? (
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-button border border-hairline px-2.5 py-1 text-[11px] font-medium text-text-primary hover:border-hairline-hover"
              >
                {MODE_LABEL[mode]}
                <ChevronDown className="h-3 w-3 text-text-tertiary" aria-hidden />
              </button>
            ) : (
              <span />
            )}
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                className="grid h-7 w-7 place-items-center rounded-button bg-surface-hover text-text-secondary hover:text-text-primary"
              >
                <Square className="h-3 w-3" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || (!value.trim() && !quotedContext)}
                aria-label="Send"
                className="grid h-7 w-7 place-items-center rounded-button bg-accent text-on-accent disabled:opacity-40"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);
