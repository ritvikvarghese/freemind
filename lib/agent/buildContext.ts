import type { TLShape, TLTextShape } from "tldraw";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { TextNodeShape } from "@/components/canvas/shapes/TextNode";
import type { UploadNodeShape } from "@/components/canvas/shapes/UploadNode";
import type { ImageNodeShape } from "@/components/canvas/shapes/ImageNode";
import type {
  DocumentNodeShape,
  SourceSnapshot,
  SourceImagePayload,
} from "@/components/canvas/shapes/DocumentNode";

export type SourceShape =
  | TextNodeShape
  | UploadNodeShape
  | ImageNodeShape
  | DocumentNodeShape
  | TLTextShape;

/** Raw text payload for a source shape — what the agent sees and what we snapshot. */
export function sourceText(shape: SourceShape): string {
  if (shape.type === "canvas-ai-text") return shape.props.text;
  if (shape.type === "canvas-ai-document") return shape.props.markdown;
  if (shape.type === "canvas-ai-image") return shape.props.ocrText;
  if (shape.type === "text") return richTextToPlain(shape.props.richText);
  return shape.props.fullText;
}

/** Split a `data:<mime>;base64,<data>` URL into the bare base64 payload. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** An Anthropic image block built from a stored image source payload. */
export function imageBlock(image: SourceImagePayload): ContentBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: dataUrlToBase64(image.dataUrl),
    },
  };
}

/** An Anthropic document (PDF) block built from stored base64 PDF bytes. */
export function pdfBlock(base64: string): ContentBlockParam {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: base64 },
  };
}

// Walk a TipTap richText doc and concatenate text leaves with paragraph breaks.
// Avoids needing the tldraw Editor instance just to read plain text.
function richTextToPlain(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content)
    ? n.content.map(richTextToPlain).join("")
    : "";
  // Block-level nodes (paragraph, heading, etc.) get a trailing newline.
  const isBlock = n.type && n.type !== "text" && n.type !== "doc";
  return isBlock ? `${inner}\n` : inner;
}

export type BuiltContext = {
  /** Final user-message content blocks (text + image) to send to the model. */
  content: ContentBlockParam[];
  /** Per-source descriptors for UI display (token estimate, provenance) */
  sources: { id: string; sourceId: string; title: string; text: string }[];
};

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildContext(
  selected: SourceShape[],
  userPrompt: string,
): BuiltContext {
  const sources = selected.map((shape, i) => {
    const id = `s${i + 1}`;
    const sourceId = shape.id;
    if (shape.type === "canvas-ai-text") {
      const text = shape.props.text.trim();
      return {
        id,
        sourceId,
        title: text ? truncate(text, 60) : "text note",
        text,
      };
    }
    if (shape.type === "canvas-ai-document") {
      const title =
        shape.props.title.trim() ||
        (shape.props.userPrompt.trim()
          ? truncate(shape.props.userPrompt, 60)
          : "document");
      return {
        id,
        sourceId,
        title,
        text: shape.props.markdown,
      };
    }
    if (shape.type === "canvas-ai-image") {
      return {
        id,
        sourceId,
        title: shape.props.filename || "image",
        text: shape.props.ocrText,
      };
    }
    if (shape.type === "text") {
      const text = richTextToPlain(shape.props.richText).trim();
      return {
        id,
        sourceId,
        title: text ? truncate(text, 60) : "text note",
        text,
      };
    }
    // upload
    return {
      id,
      sourceId,
      title: shape.props.filename,
      text: shape.props.fullText,
    };
  });

  // Text context block: every source's text (image sources contribute their
  // OCR transcription, tagged so the model can pair it with the picture below).
  const ctxXml = sources
    .map((s, i) => {
      const kind = selected[i].type === "canvas-ai-image" ? " kind=\"image\"" : "";
      return `  <source id="${s.id}" title="${escapeXml(s.title)}"${kind}>\n${escapeXml(s.text)}\n  </source>`;
    })
    .join("\n");

  const content: ContentBlockParam[] = [
    { type: "text", text: `<context>\n${ctxXml}\n</context>` },
  ];

  // Append the actual images so Claude can see them, not just their OCR text.
  selected.forEach((shape, i) => {
    if (shape.type !== "canvas-ai-image" || !shape.props.dataUrl) return;
    content.push({
      type: "text",
      text: `Image source ${sources[i].id} ("${sources[i].title}"):`,
    });
    content.push(
      imageBlock({
        dataUrl: shape.props.dataUrl,
        mediaType: shape.props.mediaType,
      }),
    );
  });

  // Scanned PDFs ride along as vision document blocks (no usable text layer).
  selected.forEach((shape, i) => {
    if (shape.type !== "canvas-ai-upload" || !shape.props.pdfData) return;
    content.push({
      type: "text",
      text: `Scanned PDF source ${sources[i].id} ("${sources[i].title}"):`,
    });
    content.push(pdfBlock(shape.props.pdfData));
  });

  content.push({ type: "text", text: `User prompt:\n${userPrompt.trim()}` });

  return { content, sources };
}

export function isSourceShape(shape: TLShape): shape is SourceShape {
  if (
    shape.type === "canvas-ai-text" ||
    shape.type === "canvas-ai-upload" ||
    shape.type === "canvas-ai-image" ||
    shape.type === "text"
  ) {
    return true;
  }
  if (shape.type === "canvas-ai-document") {
    // Only finished docs (with stable content) can feed another research run.
    const status = (shape as DocumentNodeShape).props.status;
    return status === "done" || status === "stopped";
  }
  return false;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Capture a full-text snapshot of a source shape for persistence onto the
 * generated document. Snapshots survive deletion or edits to the original
 * source shape — they become the document's read-only provenance and the
 * material the side-panel chat reasons over.
 *
 * Document-typed sources are snapshotted as their markdown only; nested
 * `sources` arrays are intentionally not deep-copied (avoids unbounded fan-out
 * when chaining documents).
 */
export function snapshotSource(
  shape: SourceShape,
  capturedAt: number = Date.now(),
): SourceSnapshot {
  if (shape.type === "canvas-ai-text") {
    const text = shape.props.text;
    return {
      id: shape.id,
      kind: "text",
      title: text.trim() ? truncate(text.trim(), 80) : "Text note",
      text,
      capturedAt,
    };
  }
  if (shape.type === "canvas-ai-document") {
    return {
      id: shape.id,
      kind: "document",
      title:
        shape.props.title.trim() ||
        (shape.props.userPrompt.trim()
          ? truncate(shape.props.userPrompt, 80)
          : "Document"),
      text: shape.props.markdown,
      capturedAt,
    };
  }
  if (shape.type === "canvas-ai-image") {
    return {
      id: shape.id,
      kind: "image",
      title: shape.props.filename || "Image",
      text: shape.props.ocrText,
      capturedAt,
      image: shape.props.dataUrl
        ? { dataUrl: shape.props.dataUrl, mediaType: shape.props.mediaType }
        : undefined,
    };
  }
  if (shape.type === "text") {
    const text = richTextToPlain(shape.props.richText).trim();
    return {
      id: shape.id,
      kind: "text",
      title: text ? truncate(text, 80) : "Text note",
      text,
      capturedAt,
    };
  }
  // upload (pdf / markdown / youtube)
  return {
    id: shape.id,
    kind:
      shape.props.kind === "pdf"
        ? "upload-pdf"
        : shape.props.kind === "youtube"
          ? "youtube"
          : "upload-markdown",
    title: shape.props.filename || "Upload",
    text: shape.props.fullText,
    capturedAt,
    // Scanned PDF: carry the bytes so the chat can re-send it for vision.
    pdf: shape.props.pdfData ? { data: shape.props.pdfData } : undefined,
  };
}
