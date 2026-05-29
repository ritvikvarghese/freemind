"use client";

import {
  Tldraw,
  defaultHandleExternalFileContent,
  type Editor,
  type TLComponents,
  type TLDefaultExternalContentHandlerOpts,
} from "tldraw";
import { useCallback, useEffect } from "react";
import { setCurrentBoardPersistenceKey } from "@/lib/storage/currentBoard";
import { TextNodeUtil } from "./shapes/TextNode";
import { UploadNodeUtil } from "./shapes/UploadNode";
import { ImageNodeUtil } from "./shapes/ImageNode";
import { DocumentNodeUtil } from "./shapes/DocumentNode";
import { CanvasOverlay } from "./CanvasOverlay";
import { WorldOverlay } from "./overlay/WorldOverlay";
import { CanvasBackground } from "./overlay/CanvasBackground";
import { ToastProvider, ToastBridge, toast } from "./toast";
import { BoardHeader } from "./BoardHeader";
import { BoardProvider } from "./BoardContext";
import { ingestFiles } from "./ingestFiles";
import { ingestImages } from "./ingestImages";
import { useTheme } from "@/lib/storage/theme";

const shapeUtils = [
  TextNodeUtil,
  UploadNodeUtil,
  ImageNodeUtil,
  DocumentNodeUtil,
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
  boardTitle,
}: {
  persistenceKey: string;
  boardTitle?: string;
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

    editor.registerExternalContentHandler("files", async ({ files, point }) => {
      const docs: File[] = [];
      const images: File[] = [];
      const rejected: File[] = [];
      for (const f of files) {
        const name = f.name.toLowerCase();
        const isDoc =
          f.type === "application/pdf" ||
          name.endsWith(".pdf") ||
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
  }, []);

  return (
    <ToastProvider>
      <ToastBridge />
      <div className="fixed inset-0">
        <BoardProvider persistenceKey={persistenceKey}>
          <Tldraw
            persistenceKey={persistenceKey}
            colorScheme={theme}
            shapeUtils={shapeUtils}
            components={components}
            onMount={onMount}
          />
        </BoardProvider>
      </div>
      {boardTitle ? <BoardHeader title={boardTitle} /> : null}
    </ToastProvider>
  );
}
