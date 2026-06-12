"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";
import { SlashMenu } from "./SlashMenu";
import { BubbleToolbar, FONT_OPTIONS, type DocFont } from "./BubbleToolbar";

type Props = {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  onGenerate?: (selectionText: string) => void;
  onComment?: () => void;
  /** Each installer returns a teardown function so we can clean up on unmount
   *  (and on React Strict Mode's double-invoke in dev). */
  extraPlugins?: Array<(editor: Editor) => () => void>;
  /** Absolutely-positioned overlay rendered inside the editor wrapper. Useful
   *  for column-side adornments (e.g. right-margin comment badges). */
  overlay?: (args: {
    editor: Editor;
    wrapperRef: React.RefObject<HTMLDivElement | null>;
  }) => React.ReactNode;
  /** Document-level font; applied as `--doc-font` on the editor surface so the
   *  whole document renders in the chosen family. Defaults to "sans". */
  docFont?: DocFont;
  /** Font picker rendered in the toolbar (owned by the caller, which writes the
   *  choice back to the document's font prop). */
  fontControl?: React.ReactNode;
};

export type RichEditorHandle = {
  editor: Editor | null;
  setMarkdown: (md: string) => void;
  focus: () => void;
  /** Serialize the current document to markdown on demand. Used by the save
   *  path so persistence doesn't depend on the debounced onChange having fired. */
  getMarkdown: () => string;
  /** DOM wrapper for the editor surface — used by side overlays (comment
   *  badges) that need wrapper-relative positioning. */
  getWrapper: () => HTMLDivElement | null;
};

// Serializing the whole doc to markdown is O(doc size), and an inserted image
// lives inline as a large base64 data URL — so doing it on every keystroke (and
// pushing the result into React state) makes typing near an image lag. Serialize
// only after a brief typing pause; the save path reads markdown directly via the
// handle so nothing is lost on close.
const SERIALIZE_DEBOUNCE_MS = 200;

/**
 * Tiptap-backed rich editor. Markdown is the canonical persisted format —
 * the editor parses it on mount and serializes back on every change.
 *
 * Image paste from the clipboard converts to a data URL (consistent with the
 * canvas "Add image" flow which also stores images base64 in IndexedDB).
 */
export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  {
    initialMarkdown,
    onChange,
    editable = true,
    placeholder,
    onGenerate,
    onComment,
    extraPlugins,
    overlay,
    docFont = "sans",
    fontControl,
  },
  ref,
) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const extensions = useMemo(
    () => buildExtensions({ placeholder, slashSuggestion: SlashMenu }),
    [placeholder],
  );

  const serializeTimer = useRef<number | null>(null);

  const editor = useEditor(
    {
      extensions,
      content: initialMarkdown,
      // Required because Markdown parsing runs on the initial `content` field.
      // Without this, useEditor treats the raw string as JSON.
      // (Markdown extension installs `contentType` into EditorOptions.)
      contentType: "markdown",
      editable,
      // Focus the top of the doc on open so it scrolls to the start, not the
      // end (ProseMirror scrolls the focused position into view on mount).
      autofocus: editable ? "start" : false,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "canvas-ai-prose focus:outline-none",
          spellcheck: "true",
        },
        handlePaste: (view, event) => {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (const it of Array.from(items)) {
            if (it.kind === "file" && it.type.startsWith("image/")) {
              event.preventDefault();
              const file = it.getAsFile();
              if (!file) return true;
              fileToDataUrl(file).then((dataUrl) => {
                const { state, dispatch } = view;
                const node = state.schema.nodes.image?.create({
                  src: dataUrl,
                  alt: file.name,
                });
                if (!node) return;
                dispatch(state.tr.replaceSelectionWith(node));
              });
              return true;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (serializeTimer.current !== null) {
          window.clearTimeout(serializeTimer.current);
        }
        serializeTimer.current = window.setTimeout(() => {
          serializeTimer.current = null;
          onChangeRef.current(ed.getMarkdown());
        }, SERIALIZE_DEBOUNCE_MS);
      },
    },
    [extensions, editable],
  );

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (serializeTimer.current !== null) {
        window.clearTimeout(serializeTimer.current);
      }
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      editor: editor ?? null,
      setMarkdown: (md: string) => {
        editor?.commands.setContent(md, {
          contentType: "markdown",
          emitUpdate: false,
        });
      },
      focus: () => editor?.commands.focus("end"),
      getMarkdown: () => editor?.getMarkdown() ?? "",
      getWrapper: () => wrapperRef.current,
    }),
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const teardowns = extraPlugins?.map((install) => install(editor)) ?? [];
    return () => {
      for (const t of teardowns) t();
    };
  }, [editor, extraPlugins]);

  if (!editor) return null;

  const docFontCss =
    FONT_OPTIONS.find((o) => o.value === docFont)?.css ?? "var(--font-sans)";

  return (
    <div
      ref={wrapperRef}
      className="canvas-ai-rich-editor relative"
      style={{ "--doc-font": docFontCss } as React.CSSProperties}
    >
      <BubbleToolbar
        editor={editor}
        onGenerate={onGenerate}
        onComment={onComment}
        fontControl={fontControl}
      />
      <EditorContent editor={editor} />
      {overlay ? overlay({ editor, wrapperRef }) : null}
    </div>
  );
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
