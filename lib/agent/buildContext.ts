import type { TLShape, TLTextShape, TLNoteShape, TLBookmarkShape } from "tldraw";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { isVisionPdf } from "@/lib/extract/pdf";
import { escapeXml, truncate } from "@/lib/string-utils";
import type { TextNodeShape } from "@/components/canvas/shapes/TextNode";
import type { UploadNodeShape } from "@/components/canvas/shapes/UploadNode";
import type { ImageNodeShape } from "@/components/canvas/shapes/ImageNode";
import type { LinkNodeShape } from "@/components/canvas/shapes/LinkNode";
import type {
  DocumentNodeShape,
  SourceSnapshot,
  SourceImagePayload,
} from "@/components/canvas/shapes/DocumentNode";
import type { NotesNodeShape } from "@/components/canvas/shapes/NotesNode";
import { notesToText } from "@/lib/notes/format";

export type SourceShape =
  | TextNodeShape
  | UploadNodeShape
  | ImageNodeShape
  | LinkNodeShape
  | DocumentNodeShape
  | NotesNodeShape
  | TLTextShape
  | TLNoteShape
  | TLBookmarkShape;

/** Raw text payload for a source shape — what the agent sees and what we snapshot. */
export function sourceText(shape: SourceShape): string {
  if (shape.type === "canvas-ai-text") return shape.props.text;
  if (shape.type === "canvas-ai-document") return shape.props.markdown;
  if (shape.type === "canvas-ai-image") return shape.props.ocrText;
  if (shape.type === "canvas-ai-link") return linkText(shape);
  if (shape.type === "canvas-ai-notes") return notesToText(shape.props.notes);
  if (shape.type === "text" || shape.type === "note")
    return richTextToPlain(shape.props.richText);
  // Pasted-link bookmark: the URL is the context (research mode can web_search it).
  if (shape.type === "bookmark") return shape.props.url;
  return shape.props.fullText;
}

/**
 * Context text for a pasted link: the scraped page body, falling back to the
 * metadata + URL when the fetch returned no body (non-HTML, blocked, or still
 * loading). A short header keeps the model oriented on where the text is from.
 */
function linkText(shape: LinkNodeShape): string {
  const { url, title, description, text } = shape.props;
  const header = [title, url].filter(Boolean).join(" — ");
  if (text.trim()) return `${header}\n\n${text}`;
  return [header, description].filter(Boolean).join("\n");
}

/** Short, human label for a pasted-link bookmark — its hostname, else the URL. */
function bookmarkTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
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
    if (shape.type === "text" || shape.type === "note") {
      const text = richTextToPlain(shape.props.richText).trim();
      const fallback = shape.type === "note" ? "sticky note" : "text note";
      return {
        id,
        sourceId,
        title: text ? truncate(text, 60) : fallback,
        text,
      };
    }
    if (shape.type === "canvas-ai-link") {
      return {
        id,
        sourceId,
        title: shape.props.title || shape.props.siteName || "link",
        text: linkText(shape),
      };
    }
    if (shape.type === "bookmark") {
      return {
        id,
        sourceId,
        title: bookmarkTitle(shape.props.url),
        text: shape.props.url,
      };
    }
    if (shape.type === "canvas-ai-notes") {
      return {
        id,
        sourceId,
        title: shape.props.title || "notes",
        text: notesToText(shape.props.notes),
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
      const shape = selected[i];
      const isImage = shape.type === "canvas-ai-image";
      const isScannedPdf =
        shape.type === "canvas-ai-upload" && isVisionPdf(shape.props);
      const kind = isImage ? " kind=\"image\"" : "";
      // Images and scanned PDFs are attached as vision blocks below. When they
      // carry no extracted text (image OCR is opt-in), point the model at the
      // attached picture instead of emitting an empty, broken-looking source.
      let body = s.text;
      if (!body.trim()) {
        if (isImage) {
          body = `(This source is an image attached below as ${s.id}. Read the attached picture directly.)`;
        } else if (isScannedPdf) {
          body = `(This source is a scanned PDF attached below as ${s.id}. Read the attached pages directly.)`;
        }
      }
      return `  <source id="${s.id}" title="${escapeXml(s.title)}"${kind}>\n${escapeXml(body)}\n  </source>`;
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
  // Every PDF now stores bytes for rendering, so gate on isVisionPdf — NOT on
  // pdfData presence — or text PDFs would bill as vision on top of their text.
  selected.forEach((shape, i) => {
    if (shape.type !== "canvas-ai-upload" || !isVisionPdf(shape.props)) return;
    content.push({
      type: "text",
      text: `Scanned PDF source ${sources[i].id} ("${sources[i].title}"):`,
    });
    content.push(pdfBlock(shape.props.pdfData));
  });

  // Cache the source prefix (context text + any image / PDF blocks). The user
  // prompt is the only volatile part, so it stays LAST and unmarked: a retry or
  // sibling run with the same selection reuses everything up to here instead of
  // re-billing the whole payload. Mark the last source block, then append the
  // prompt. (Below the model's min cacheable prefix this is a silent no-op.)
  const lastSource = content[content.length - 1] as ContentBlockParam & {
    cache_control?: { type: "ephemeral"; ttl?: "5m" };
  };
  // 5m TTL (cheaper 1.25x write): research is one-shot or a fast retry, so a
  // short window covers the reuse case without the 1h write premium.
  lastSource.cache_control = { type: "ephemeral", ttl: "5m" };

  content.push({ type: "text", text: `User prompt:\n${userPrompt.trim()}` });

  return { content, sources };
}

export function isSourceShape(shape: TLShape): shape is SourceShape {
  if (
    shape.type === "canvas-ai-text" ||
    shape.type === "canvas-ai-upload" ||
    shape.type === "canvas-ai-image" ||
    shape.type === "canvas-ai-link" ||
    shape.type === "canvas-ai-notes" ||
    shape.type === "text" ||
    shape.type === "note" ||
    shape.type === "bookmark"
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
  if (shape.type === "text" || shape.type === "note") {
    const text = richTextToPlain(shape.props.richText).trim();
    const fallback = shape.type === "note" ? "Sticky note" : "Text note";
    return {
      id: shape.id,
      kind: "text",
      title: text ? truncate(text, 80) : fallback,
      text,
      capturedAt,
    };
  }
  if (shape.type === "canvas-ai-link") {
    // Snapshot as plain text carrying the scraped page body (+ a header). No new
    // SourceSnapshot kind needed, so no DocumentNode migration.
    return {
      id: shape.id,
      kind: "text",
      title: shape.props.title || shape.props.siteName || "Link",
      text: linkText(shape),
      capturedAt,
    };
  }
  if (shape.type === "bookmark") {
    // Snapshot as a plain-text source carrying the URL (no new snapshot kind
    // needed). The chat sees the link; research mode can web_search it.
    return {
      id: shape.id,
      kind: "text",
      title: bookmarkTitle(shape.props.url),
      text: shape.props.url,
      capturedAt,
    };
  }
  if (shape.type === "canvas-ai-notes") {
    return {
      id: shape.id,
      kind: "text",
      title: shape.props.title || "Notes",
      text: notesToText(shape.props.notes),
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
    // Only scanned (vision-eligible) PDFs — every PDF stores bytes now, but a
    // text PDF must not be re-sent as vision.
    pdf: isVisionPdf(shape.props) ? { data: shape.props.pdfData } : undefined,
  };
}
