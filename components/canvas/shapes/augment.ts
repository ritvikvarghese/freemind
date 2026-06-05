// Register our custom shapes in tldraw's type system so that
// TLShape, TLBaseBoxShape, ExtractShapeByProps<...> include them.
//
// Why the dummy `_Check*` types below: without them, TypeScript's lazy
// type evaluation can let `BaseBoxShapeUtil<MyShape>` constraint checks
// fail at the consumer site even though the augmentation is in scope.
// Forcing the augmented constraint to be evaluated here propagates it.
import type { TLBaseShape, TLBaseBoxShape, TLShape } from "tldraw";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "canvas-ai-text": {
      w: number;
      h: number;
      text: string;
    };
    "canvas-ai-upload": {
      w: number;
      h: number;
      filename: string;
      kind: "pdf" | "markdown" | "youtube";
      preview: string;
      fullText: string;
      pageCount: number;
      bytes: number;
      lowText: boolean;
      ocr: boolean;
      sourceUrl: string;
      pdfData: string;
      notes: {
        id: string;
        quote: string;
        comment: string;
        start: number;
        end: number;
        createdAt: number;
      }[];
    };
    "canvas-ai-image": {
      w: number;
      h: number;
      filename: string;
      dataUrl: string;
      mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      naturalW: number;
      naturalH: number;
      bytes: number;
      ocrText: string;
      status: "idle" | "ocr" | "done" | "error";
    };
    "canvas-ai-link": {
      w: number;
      h: number;
      url: string;
      title: string;
      description: string;
      image: string;
      siteName: string;
      text: string;
      status: "loading" | "done" | "error";
    };
    "canvas-ai-document": {
      w: number;
      h: number;
      title: string;
      markdown: string;
      status:
        | "researching"
        | "streaming"
        | "done"
        | "stopped"
        | "error";
      userPrompt: string;
      sourceIds: string[];
      /**
       * Per-source fingerprint at run time. Keyed by source TLShapeId.
       * `len` is character count, `head` is the first 200 chars. Re-rendering
       * compares against the current source text to detect drift without
       * storing full copies. (Intentionally tiny — read on every shape replication.)
       */
      sourceSnapshots: { id: string; len: number; head: string }[];
      /**
       * Full-text snapshot of every feeding source at completion time. Powers
       * the in-doc Sources panel and the side-panel chat's system prompt, both
       * of which need to survive deletion or edits to the source shapes.
       */
      sources: {
        id: string;
        kind:
          | "text"
          | "upload-pdf"
          | "upload-markdown"
          | "document"
          | "image"
          | "youtube";
        title: string;
        text: string;
        capturedAt: number;
        image?: {
          dataUrl: string;
          mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        };
        pdf?: { data: string };
      }[];
      /**
       * User-added inline comments. Each anchors to a span of doc text via the
       * same triple scheme as AI propose_edit. Comments whose anchors no
       * longer match uniquely render as "orphaned" in the sidebar list.
       */
      comments: {
        id: string;
        anchor_before: string;
        anchor_text: string;
        anchor_after: string;
        body: string;
        createdAt: number;
        resolved: boolean;
      }[];
      sourcesUsed: {
        query: string;
        urls: string[];
      }[];
      errorMessage: string;
    };
    "canvas-ai-notes": {
      w: number;
      h: number;
      sourceId: string;
      title: string;
      notes: {
        id: string;
        quote: string;
        comment: string;
        start: number;
        end: number;
        createdAt: number;
      }[];
    };
  }
}

type _CheckText = TLBaseShape<
  "canvas-ai-text",
  { w: number; h: number; text: string }
> extends TLBaseBoxShape & TLShape
  ? true
  : never;

type _CheckUpload = TLBaseShape<
  "canvas-ai-upload",
  {
    w: number;
    h: number;
    filename: string;
    kind: "pdf" | "markdown" | "youtube";
    preview: string;
    fullText: string;
    pageCount: number;
    bytes: number;
    lowText: boolean;
    ocr: boolean;
    sourceUrl: string;
    pdfData: string;
    notes: {
      id: string;
      quote: string;
      comment: string;
      start: number;
      end: number;
      createdAt: number;
    }[];
  }
> extends TLBaseBoxShape & TLShape
  ? true
  : never;

type _CheckImage = TLBaseShape<
  "canvas-ai-image",
  {
    w: number;
    h: number;
    filename: string;
    dataUrl: string;
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    naturalW: number;
    naturalH: number;
    bytes: number;
    ocrText: string;
    status: "idle" | "ocr" | "done" | "error";
  }
> extends TLBaseBoxShape & TLShape
  ? true
  : never;

type _CheckLink = TLBaseShape<
  "canvas-ai-link",
  {
    w: number;
    h: number;
    url: string;
    title: string;
    description: string;
    image: string;
    siteName: string;
    text: string;
    status: "loading" | "done" | "error";
  }
> extends TLBaseBoxShape & TLShape
  ? true
  : never;

type _CheckDocument = TLBaseShape<
  "canvas-ai-document",
  {
    w: number;
    h: number;
    title: string;
    markdown: string;
    status: "researching" | "streaming" | "done" | "stopped" | "error";
    userPrompt: string;
    sourceIds: string[];
    sourceSnapshots: { id: string; len: number; head: string }[];
    sources: {
      id: string;
      kind: "text" | "upload-pdf" | "upload-markdown" | "document";
      title: string;
      text: string;
      capturedAt: number;
    }[];
    comments: {
      id: string;
      anchor_before: string;
      anchor_text: string;
      anchor_after: string;
      body: string;
      createdAt: number;
      resolved: boolean;
    }[];
    sourcesUsed: { query: string; urls: string[] }[];
    errorMessage: string;
  }
> extends TLBaseBoxShape & TLShape
  ? true
  : never;

type _CheckNotes = TLBaseShape<
  "canvas-ai-notes",
  {
    w: number;
    h: number;
    sourceId: string;
    title: string;
    notes: {
      id: string;
      quote: string;
      comment: string;
      start: number;
      end: number;
      createdAt: number;
    }[];
  }
> extends TLBaseBoxShape & TLShape
  ? true
  : never;

export type {
  _CheckText,
  _CheckUpload,
  _CheckImage,
  _CheckLink,
  _CheckDocument,
  _CheckNotes,
};
