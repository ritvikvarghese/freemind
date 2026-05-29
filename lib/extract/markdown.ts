export const MAX_MD_BYTES = 2 * 1024 * 1024; // 2 MB

export type MarkdownExtractError =
  | { kind: "too-large"; bytes: number }
  | { kind: "read-failed"; message: string };

export type MarkdownExtractResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; error: MarkdownExtractError };

export async function extractMarkdown(file: File): Promise<MarkdownExtractResult> {
  if (file.size > MAX_MD_BYTES) {
    return { ok: false, error: { kind: "too-large", bytes: file.size } };
  }
  try {
    const text = await file.text();
    return { ok: true, text, bytes: file.size };
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
