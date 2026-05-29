"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { ArrowUp, Square, X } from "lucide-react";

type Props = {
  disabled?: boolean;
  disabledHint?: string;
  busy: boolean;
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
  function ChatComposer({ disabled, disabledHint, busy, onSubmit, onStop }, ref) {
    const [value, setValue] = useState("");
    const [quotedContext, setQuotedContext] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
        <div className="rounded-button border border-hairline bg-app px-3 py-2">
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
          <div className="flex items-end gap-2">
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
                    : "Ask or request an edit…"
              }
              className="flex-1 resize-none bg-transparent text-[13px] leading-snug text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
            />
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
