import type { TextItem } from "pdfjs-dist/types/src/display/api";

export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_PDF_PAGES = 200;
export const LOW_TEXT_THRESHOLD = 200; // chars

// Anthropic's vision document block tops out at 100 pages per request.
export const MAX_VISION_PDF_PAGES = 100;

/**
 * Whether a stored PDF should ride along to the AI as a *vision* document
 * (scanned, no usable text layer, within the page cap). NOTE: every PDF now
 * stores its raw bytes (`pdfData`) so it can render in focus mode — bytes
 * present does NOT mean "send as vision." Use this predicate for the AI path;
 * use `pdfData` presence only for rendering.
 */
export function isVisionPdf(p: {
  lowText: boolean;
  pageCount: number;
  pdfData: string;
}): boolean {
  return p.lowText && p.pdfData.length > 0 && p.pageCount <= MAX_VISION_PDF_PAGES;
}

export type PdfExtractError =
  | { kind: "too-large"; bytes: number }
  | { kind: "too-many-pages"; pages: number }
  | { kind: "read-failed"; message: string };

export type PdfExtractResult =
  | {
      ok: true;
      text: string;
      pageCount: number;
      bytes: number;
      lowText: boolean;
    }
  | { ok: false; error: PdfExtractError };

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

// WebKit/Safari (through at least 26.x) still does not implement async
// iteration over a ReadableStream — `ReadableStream.prototype[Symbol.asyncIterator]`
// is undefined. pdf.js v5's getTextContent() does `for await (const v of
// readableStream)`, so reading any PDF throws
// `undefined is not a function (near '...value of readableStream...')` on Safari
// while working in Chromium (Dia, which implements it). Install the standard
// getReader-based async iterator. No-op on engines that already provide it.
function ensureReadableStreamAsyncIterator() {
  if (typeof ReadableStream === "undefined") return;
  const proto = ReadableStream.prototype as ReadableStream &
    Record<symbol, unknown>;
  if (proto[Symbol.asyncIterator]) return;

  function values(this: ReadableStream<unknown>) {
    const reader = this.getReader();
    return {
      next() {
        return reader.read().then((result) => {
          if (result.done) reader.releaseLock();
          return result;
        });
      },
      return(value?: unknown) {
        const cancelPromise = reader.cancel();
        reader.releaseLock();
        return cancelPromise.then(() => ({ done: true as const, value }));
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  Object.defineProperty(proto, "values", {
    value: values,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(proto, Symbol.asyncIterator, {
    value: values,
    writable: true,
    configurable: true,
  });
}

function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    ensureReadableStreamAsyncIterator();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  })();
  return pdfjsPromise;
}

export async function extractPdf(file: File): Promise<PdfExtractResult> {
  if (file.size > MAX_PDF_BYTES) {
    return { ok: false, error: { kind: "too-large", bytes: file.size } };
  }

  try {
    const pdfjs = await loadPdfjs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;

    if (doc.numPages > MAX_PDF_PAGES) {
      await doc.destroy();
      return {
        ok: false,
        error: { kind: "too-many-pages", pages: doc.numPages },
      };
    }

    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? (item as TextItem).str : ""))
        .join(" ");
      parts.push(pageText);
    }
    await doc.destroy();

    const text = parts.join("\n\n").trim();
    return {
      ok: true,
      text,
      pageCount: doc.numPages,
      bytes: file.size,
      lowText: doc.numPages > 1 && text.length < LOW_TEXT_THRESHOLD,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "read-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function describePdfError(err: PdfExtractError): string {
  switch (err.kind) {
    case "too-large":
      return `PDF is ${(err.bytes / 1024 / 1024).toFixed(1)} MB — max is ${MAX_PDF_BYTES / 1024 / 1024} MB.`;
    case "too-many-pages":
      return `PDF has ${err.pages} pages — max is ${MAX_PDF_PAGES}.`;
    case "read-failed":
      return `Could not read PDF: ${err.message}`;
  }
}
