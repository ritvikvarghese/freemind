"use client";

// .docx is a zip of XML; mammoth unpacks it and pulls the document text.
// We use the prebuilt browser bundle so no Node-only deps leak into the client.
export const MAX_DOCX_BYTES = 10 * 1024 * 1024; // 10 MB

export type DocxExtractError =
  | { kind: "too-large"; bytes: number }
  | { kind: "read-failed"; message: string };

export type DocxExtractResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; error: DocxExtractError };

export async function extractDocx(file: File): Promise<DocxExtractResult> {
  if (file.size > MAX_DOCX_BYTES) {
    return { ok: false, error: { kind: "too-large", bytes: file.size } };
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const mod = await import("mammoth/mammoth.browser");
    const mammoth = (mod as { default?: unknown }).default ?? mod;
    const result = await (
      mammoth as {
        extractRawText: (input: {
          arrayBuffer: ArrayBuffer;
        }) => Promise<{ value: string }>;
      }
    ).extractRawText({ arrayBuffer });
    return { ok: true, text: (result?.value ?? "").trim(), bytes: file.size };
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
