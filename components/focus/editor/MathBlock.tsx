"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BlockMath } from "@tiptap/extension-mathematics";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { renderLatex } from "@/lib/markdown/renderLatex";

/**
 * Display equation: the typeset result on top and a collapsible LaTeX source
 * pane below. Persists as a `$$ ... $$` block in the document markdown.
 * Inline `$...$` math is deliberately not registered (see extensions.ts).
 */
export const MathBlock = BlockMath.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },
});

function MathBlockView({
  node,
  editor,
  getPos,
  selected,
  updateAttributes,
}: ReactNodeViewProps) {
  const latex = node.attrs.latex as string;
  // A fresh (empty) equation opens ready to type into.
  const [open, setOpen] = useState(latex.trim() === "");
  // Local draft keeps the caret stable while typing; resync when the node
  // changes from outside (undo, an AI edit) during render, not in an effect.
  const [draft, setDraft] = useState(latex);
  const [synced, setSynced] = useState(latex);
  if (latex !== synced) {
    setSynced(latex);
    setDraft(latex);
  }

  const rendered = useMemo(
    () =>
      draft.trim() ? renderLatex(draft, true) : null,
    [draft],
  );

  const editable = editor.isEditable;

  // A fresh equation takes the caret. Deferred a frame because the insert
  // command's own `focus()` hands focus back to ProseMirror in the same tick,
  // which would leave the node selected and let the next keystroke replace it.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusOnMount = useRef(editable && latex.trim() === "");
  useEffect(() => {
    if (!focusOnMount.current) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const exitBelow = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const after = pos + node.nodeSize;
    const next = editor.state.doc.nodeAt(after);
    const chain = editor.chain().focus();
    if (next?.type.name === "paragraph") {
      chain.setTextSelection(after + 1).run();
    } else {
      chain.insertContentAt(after, { type: "paragraph" }).setTextSelection(after + 1).run();
    }
  };

  return (
    <NodeViewWrapper
      className={`canvas-ai-math my-3 overflow-hidden rounded-[var(--radius-panel)] border ${
        selected ? "border-text-tertiary" : "border-hairline"
      }`}
      data-type="block-math"
    >
      <div contentEditable={false}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 px-3 pt-2 text-[12px] text-text-tertiary hover:text-text-secondary"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
          Source
        </button>
        <div
          className="overflow-x-auto px-4 pb-3 pt-1 text-text-primary"
          onClick={() => editable && setOpen(true)}
        >
          {rendered ? (
            <div dangerouslySetInnerHTML={{ __html: rendered }} />
          ) : (
            <p className="py-3 text-center text-[13px] text-text-tertiary">
              Empty equation
            </p>
          )}
        </div>
        {open ? (
          <div className="relative border-t border-hairline bg-code-block-bg">
            <span className="pointer-events-none absolute right-2 top-2 rounded-md border border-hairline px-1.5 py-0.5 text-[11px] text-text-tertiary">
              LaTeX
            </span>
            <textarea
              ref={textareaRef}
              data-local-escape
              value={draft}
              readOnly={!editable}
              spellCheck={false}
              rows={Math.max(2, draft.split("\n").length)}
              placeholder="\frac{a}{b}"
              onChange={(e) => {
                setDraft(e.target.value);
                setSynced(e.target.value);
                updateAttributes({ latex: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault();
                  setOpen(false);
                  exitBelow();
                }
              }}
              // Grow with wrapped lines too, where supported; `rows` is the fallback.
              style={{ fieldSizing: "content" } as React.CSSProperties}
              className="block w-full resize-none bg-transparent px-4 py-3 pr-16 font-mono text-[13px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
