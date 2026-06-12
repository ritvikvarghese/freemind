"use client";

import {
  Tldraw,
  createShapeId,
  defaultHandleExternalFileContent,
  tipTapDefaultExtensions,
  defaultAddFontsFromNode,
  type Editor,
  type TLComponents,
  type TLDefaultExternalContentHandlerOpts,
  type TLShapePartial,
  type TLTextOptions,
} from "tldraw";
import TextAlign from "@tiptap/extension-text-align";
import { useCallback, useEffect } from "react";
import { setCurrentBoardPersistenceKey } from "@/lib/storage/currentBoard";
import { TextNodeUtil } from "./shapes/TextNode";
import { UploadNodeUtil } from "./shapes/UploadNode";
import { ImageNodeUtil } from "./shapes/ImageNode";
import { LinkNodeUtil } from "./shapes/LinkNode";
import { DocumentNodeUtil } from "./shapes/DocumentNode";
import { NotesNodeUtil } from "./shapes/NotesNode";
import { ResizableNoteUtil } from "./shapes/ResizableNoteUtil";
import { CanvasOverlay } from "./CanvasOverlay";
import { BoardSidebar } from "./BoardSidebar";
import { ShapeContextMenu } from "./ShapeContextMenu";
import { CanvasRichTextToolbar } from "./toolbar/CanvasRichTextToolbar";
import { WorldOverlay } from "./overlay/WorldOverlay";
import { CanvasBackground } from "./overlay/CanvasBackground";
import { ToastProvider, ToastBridge, toast } from "./toast";
import { BoardProvider } from "./BoardContext";
import { ingestFiles } from "./ingestFiles";
import { ingestImages } from "./ingestImages";
import { ingestLink } from "./ingestLink";
import { findClearRegion } from "./copyToCanvas";
import { useTheme } from "@/lib/storage/theme";
import { takeShapeTransfers } from "@/lib/storage/shapeTransfers";
import { restoreFocus } from "@/lib/focus/openFocus";

const shapeUtils = [
  TextNodeUtil,
  UploadNodeUtil,
  ImageNodeUtil,
  LinkNodeUtil,
  DocumentNodeUtil,
  NotesNodeUtil,
  // Replaces the default `note` util so sticky notes can be resized (scaled).
  ResizableNoteUtil,
];

// Hide every default tldraw UI surface; we render our own minimal toolbar.
const components: TLComponents = {
  Toolbar: null,
  StylePanel: null,
  PageMenu: null,
  MainMenu: null,
  ActionsMenu: null,
  HelpMenu: null,
  QuickActions: null,
  HelperButtons: null,
  KeyboardShortcutsDialog: null,
  NavigationPanel: null,
  Minimap: null,
  DebugPanel: null,
  MenuPanel: null,
  TopPanel: null,
  SharePanel: null,
  InFrontOfTheCanvas: CanvasOverlay,
  OnTheCanvas: WorldOverlay,
  Background: CanvasBackground,
  // Custom right-click menu for Freemind nodes (default menu for everything else).
  ContextMenu: ShapeContextMenu,
  // Our button row inside tldraw's contextual toolbar (safe positioning), so
  // canvas text shapes get the same formatting as focus mode.
  RichTextToolbar: CanvasRichTextToolbar,
};

// Add paragraph/heading alignment to tldraw's text editor (its defaults cover
// bold/italic/underline/strike/code/highlight/headings/lists/link but not
// alignment), so the toolbar's align buttons work on canvas text too.
const textOptions: TLTextOptions = {
  tipTapConfig: {
    extensions: [
      ...tipTapDefaultExtensions,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
  },
  addFontsFromNode: defaultAddFontsFromNode,
};

// Inter is loaded by Next.js (app/layout.tsx) and exposed as --font-inter.
// We re-use it for tldraw native text/draw fonts so the canvas font matches the
// app shell — see gotcha #20 in agent_docs/session-brief.md (font-family is
// applied inline from the theme; `--tl-font-*` CSS vars are dead code in v5).
const SANS_STACK = "var(--font-inter), system-ui, -apple-system, sans-serif";

// Minimal options bag for tldraw's default file handler. We call it directly
// from our custom "files" external content handler (see onMount below) and so
// we have to provide the toast + i18n surfaces that tldraw's UI normally wires
// for it. We forward tldraw's error toasts into our own toast(), and the msg
// translator is identity — fine for English-only.
const DEFAULT_FILE_OPTS: TLDefaultExternalContentHandlerOpts = {
  toasts: {
    addToast: (t: { title?: string; description?: string; severity?: string }) => {
      const text = [t.title, t.description].filter(Boolean).join(" — ");
      if (text) toast(text, t.severity === "error" ? "error" : "info");
      return "" as never;
    },
    removeToast: () => "" as never,
    toasts: [],
    clearToasts: () => {},
  } as unknown as TLDefaultExternalContentHandlerOpts["toasts"],
  msg: ((key: string) => key) as TLDefaultExternalContentHandlerOpts["msg"],
};

export function CanvasRoot({
  persistenceKey,
}: {
  persistenceKey: string;
}) {
  const theme = useTheme();
  useEffect(() => {
    setCurrentBoardPersistenceKey(persistenceKey);
    return () => setCurrentBoardPersistenceKey(null);
  }, [persistenceKey]);
  const onMount = useCallback((editor: Editor) => {
    const base = editor.getTheme("default");
    if (base) {
      editor.updateTheme({
        ...base,
        fonts: {
          ...base.fonts,
          draw: { ...base.fonts.draw, fontFamily: SANS_STACK },
          sans: { ...base.fonts.sans, fontFamily: SANS_STACK },
        },
      });
    }

    // Sticky notes in dark mode use tldraw's desaturated dark fills, which read
    // as muddy on our dark canvas. Borrow the vibrant LIGHT-mode note fills (and
    // their black ink) so notes pop while staying legible — these are values
    // tldraw already ships and vets for the light theme. Only noteFill/noteText
    // change, so nothing else about dark mode is affected.
    editor.updateThemes((themes) => {
      const colors = themes.default?.colors as unknown as
        | {
            light: Record<string, unknown>;
            dark: Record<string, unknown>;
          }
        | undefined;
      if (colors) {
        for (const name of Object.keys(colors.dark)) {
          const light = colors.light[name];
          const dark = colors.dark[name];
          // Skip scalar theme fields (e.g. `text`); only recolor note entries.
          if (!isNoteColor(light) || !isNoteColor(dark)) continue;
          dark.noteFill = light.noteFill;
          dark.noteText = light.noteText;
        }
      }
      return themes;
    });

    editor.registerExternalContentHandler("files", async ({ files, point }) => {
      const docs: File[] = [];
      const images: File[] = [];
      const rejected: File[] = [];
      for (const f of files) {
        const name = f.name.toLowerCase();
        const isDoc =
          f.type === "application/pdf" ||
          name.endsWith(".pdf") ||
          f.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          name.endsWith(".docx") ||
          f.type === "text/markdown" ||
          f.type === "text/plain" ||
          name.endsWith(".md") ||
          name.endsWith(".markdown");
        if (isDoc) docs.push(f);
        else if (f.type.startsWith("image/")) images.push(f);
        else rejected.push(f);
      }
      if (docs.length > 0) await ingestFiles(editor, docs, point);
      if (images.length > 0) await ingestImages(editor, images, point);
      if (rejected.length > 0) {
        // Hand anything left to tldraw's default handler directly. We can't
        // loop back through putExternalContent — it would dispatch to this
        // same registered handler and recurse until the stack blows.
        await defaultHandleExternalFileContent(
          editor,
          { files: rejected, point },
          DEFAULT_FILE_OPTS,
        );
      }
    });

    // Pasted/dropped URLs become our link card (scraped metadata + body text
    // for AI context) instead of tldraw's default bookmark, which can't carry
    // the page text.
    editor.registerExternalContentHandler("url", async ({ url, point }) => {
      await ingestLink(editor, url, point);
    });

    // Materialize any shapes "duplicated to" this canvas while it was closed.
    // Lay them out in a tidy grid sized to the shapes (a fixed diagonal offset
    // just piles big documents on top of each other), then drop that grid into
    // empty space so it never lands on whatever is already on the board.
    const transfers = takeShapeTransfers(persistenceKey);
    if (transfers.length) {
      const ids = transfers.map(() => createShapeId());
      editor.run(() => {
        // Capture existing shapes as obstacles BEFORE creating the batch.
        const obstacles = editor
          .getCurrentPageShapes()
          .map((s) => editor.getShapePageBounds(s.id))
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
          .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
        // Create at the origin first, then measure + place.
        transfers.forEach((t, i) => {
          editor.createShape({
            id: ids[i],
            type: t.type as TLShapePartial["type"],
            x: 0,
            y: 0,
            props: t.props,
          });
        });
        const sizes = ids.map((id) => {
          const b = editor.getShapePageBounds(id);
          return { w: b?.width ?? 320, h: b?.height ?? 220 };
        });
        const GAP = 56;
        const cols = Math.ceil(Math.sqrt(ids.length));
        const colW = Math.max(...sizes.map((s) => s.w)) + GAP;
        const rowH = Math.max(...sizes.map((s) => s.h)) + GAP;
        const rows = Math.ceil(ids.length / cols);
        const origin = findClearRegion(
          obstacles,
          cols * colW - GAP,
          rows * rowH - GAP,
          editor.getViewportPageBounds().center,
        );
        ids.forEach((id, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          editor.updateShape({
            id,
            type: transfers[i].type as TLShapePartial["type"],
            x: origin.x + col * colW,
            y: origin.y + row * rowH,
          });
        });
      });
    }

    // Pasted text can arrive colored "white" (from the source's styling), which
    // is invisible on the light canvas. Force any white text shape to tldraw's
    // theme-aware "black" (dark on light, light on dark) so it's always legible.
    // Future pastes: rewrite on create. Existing white text: sweep once the
    // persisted store has loaded (can land just after onMount).
    editor.sideEffects.registerBeforeCreateHandler("shape", (shape) => {
      if (
        shape.type === "text" &&
        (shape.props as { color?: string }).color === "white"
      ) {
        return { ...shape, props: { ...shape.props, color: "black" } };
      }
      return shape;
    });
    const sweepWhiteText = () => {
      const whites = editor
        .getCurrentPageShapes()
        .filter(
          (s) =>
            s.type === "text" &&
            (s.props as { color?: string }).color === "white",
        );
      if (whites.length === 0) return;
      editor.run(
        () => {
          editor.updateShapes(
            whites.map((s) => ({
              id: s.id,
              type: "text" as const,
              props: { color: "black" },
            })),
          );
        },
        { history: "ignore" },
      );
    };
    sweepWhiteText();
    setTimeout(sweepWhiteText, 600);

    // Reopen the focus view the user was on before a reload. Persisted shapes
    // can land just after onMount, so poll briefly until the shape exists.
    let tries = 0;
    const tryRestore = () => {
      if (restoreFocus(editor) !== "retry") return;
      if (tries++ > 20) return; // ~3s ceiling, then give up
      setTimeout(tryRestore, 150);
    };
    tryRestore();
  }, [persistenceKey]);

  return (
    <ToastProvider>
      <ToastBridge />
      <div className="fixed inset-0">
        <BoardProvider persistenceKey={persistenceKey}>
          <Tldraw
            persistenceKey={persistenceKey}
            // tldraw runs free without a key in dev (localhost/HTTP), but a
            // production domain needs a license or the editor degrades after a
            // few seconds. The key is domain-locked and meant to ship in the
            // client, so a NEXT_PUBLIC_ env is correct (unlike the API key).
            // Unset locally -> undefined -> dev mode, which is fine.
            licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
            colorScheme={theme}
            shapeUtils={shapeUtils}
            components={components}
            textOptions={textOptions}
            // The FloatingToolbar owns empty-canvas clicks, so suppress
            // tldraw's default "double-click creates a text shape" (a fast
            // double click would otherwise drop a stray text box).
            options={{ createTextOnCanvasDoubleClick: false }}
            onMount={onMount}
          />
          {/* Rendered OUTSIDE <Tldraw> so the canvas container's drag/contextmenu
              listeners can't hijack the sidebar's native DnD. It needs no editor,
              only BoardContext. */}
          <BoardSidebar />
        </BoardProvider>
      </div>
    </ToastProvider>
  );
}

/** A theme palette entry is a note color iff it carries noteFill/noteText. */
function isNoteColor(
  v: unknown,
): v is { noteFill: string; noteText: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { noteFill?: unknown }).noteFill === "string" &&
    typeof (v as { noteText?: unknown }).noteText === "string"
  );
}
