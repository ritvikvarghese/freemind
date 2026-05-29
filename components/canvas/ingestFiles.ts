import { createShapeId, type Editor, type VecLike } from "tldraw";
import { extractPdf, describePdfError, type PdfExtractResult } from "@/lib/extract/pdf";
import { extractMarkdown, MAX_MD_BYTES } from "@/lib/extract/markdown";
import { toast } from "./toast";
import type { UploadNodeShape } from "./shapes/UploadNode";

const PREVIEW_LEN = 400;
const UPLOAD_W = 280;
const UPLOAD_H = 200;
const STAGGER = 24;

// Anthropic's vision document block tops out at 100 pages per request. Scanned
// PDFs beyond this still upload but will fail when used as an AI source.
const MAX_VISION_PDF_PAGES = 100;

export async function ingestFiles(
  editor: Editor,
  files: File[],
  anchor?: VecLike,
): Promise<void> {
  const start = anchor ?? editor.getViewportPageBounds().center;

  let offset = 0;
  for (const file of files) {
    const kind = classify(file);
    if (kind === "skip") {
      toast(`Skipped "${file.name}" — only PDF and markdown supported.`, "error");
      continue;
    }

    const result =
      kind === "pdf" ? await extractPdf(file) : await extractMarkdown(file);

    if (!result.ok) {
      const err = result.error;
      if (err.kind === "too-large") {
        const limitMb =
          kind === "pdf"
            ? "20"
            : (MAX_MD_BYTES / 1024 / 1024).toFixed(0);
        toast(
          `"${file.name}" is ${(err.bytes / 1024 / 1024).toFixed(1)} MB — max is ${limitMb} MB.`,
          "error",
        );
      } else if (err.kind === "too-many-pages") {
        toast(describePdfError(err), "error");
      } else {
        toast(`Could not read "${file.name}": ${err.message}`, "error");
      }
      continue;
    }

    // Scanned PDF (no usable text layer): store the raw bytes so the AI can
    // read it as a vision document. Verbatim OCR-to-text is blocked by
    // Anthropic's copyright filter for published works, but reading/analysis
    // is fine — so we hand Claude the PDF itself at research/chat time.
    let pdfData = "";
    if (
      kind === "pdf" &&
      (result as Extract<PdfExtractResult, { ok: true }>).lowText
    ) {
      const pdfRes = result as Extract<PdfExtractResult, { ok: true }>;
      if (pdfRes.pageCount > MAX_VISION_PDF_PAGES) {
        toast(
          `"${file.name}" has ${pdfRes.pageCount} pages — too long for the AI to read as a scanned source (max ${MAX_VISION_PDF_PAGES}).`,
          "error",
        );
      } else {
        pdfData = await fileToBase64(file);
      }
    }

    const id = createShapeId();
    const props: UploadNodeShape["props"] =
      kind === "pdf"
        ? buildPdfProps(file.name, result as Extract<PdfExtractResult, { ok: true }>, pdfData)
        : buildMdProps(file.name, result.text, result.bytes);

    editor.createShape<UploadNodeShape>({
      id,
      type: "canvas-ai-upload",
      x: start.x - UPLOAD_W / 2 + offset,
      y: start.y - UPLOAD_H / 2 + offset,
      props,
    });
    offset += STAGGER;
  }
}

/** Base64-encode a File without the `data:` prefix. */
async function fileToBase64(file: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function classify(file: File): "pdf" | "markdown" | "skip" {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    file.type === "text/markdown" ||
    file.type === "text/plain" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return "markdown";
  }
  return "skip";
}

function buildPdfProps(
  filename: string,
  res: Extract<PdfExtractResult, { ok: true }>,
  pdfData: string,
): UploadNodeShape["props"] {
  return {
    w: UPLOAD_W,
    h: UPLOAD_H,
    filename,
    kind: "pdf",
    preview: res.text.slice(0, PREVIEW_LEN),
    fullText: res.text,
    pageCount: res.pageCount,
    bytes: res.bytes,
    lowText: res.lowText,
    ocr: false,
    sourceUrl: "",
    pdfData,
  };
}

function buildMdProps(
  filename: string,
  text: string,
  bytes: number,
): UploadNodeShape["props"] {
  return {
    w: UPLOAD_W,
    h: UPLOAD_H,
    filename,
    kind: "markdown",
    preview: text.slice(0, PREVIEW_LEN),
    fullText: text,
    pageCount: 0,
    bytes,
    lowText: false,
    ocr: false,
    sourceUrl: "",
    pdfData: "",
  };
}
