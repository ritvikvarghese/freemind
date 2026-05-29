import { createShapeId, type Editor, type VecLike } from "tldraw";
import { toast } from "./toast";
import type { UploadNodeShape } from "./shapes/UploadNode";

const PREVIEW_LEN = 400;
const UPLOAD_W = 280;
const UPLOAD_H = 200;

type TranscriptResponse =
  | { ok: true; videoId: string; title: string; url: string; transcript: string }
  | { ok: false; error: string };

/**
 * Fetch a YouTube transcript via our same-origin route and drop it on the
 * canvas as a youtube-kind UploadNode (a normal AI source). Returns true on
 * success so the caller can clear its input.
 */
export async function ingestYouTube(
  editor: Editor,
  url: string,
  anchor?: VecLike,
): Promise<boolean> {
  let data: TranscriptResponse;
  try {
    const res = await fetch(`/api/transcript?url=${encodeURIComponent(url)}`);
    data = (await res.json()) as TranscriptResponse;
  } catch (err) {
    toast(
      `Could not fetch transcript: ${err instanceof Error ? err.message : "network error"}`,
      "error",
    );
    return false;
  }

  if (!data.ok) {
    toast(data.error, "error");
    return false;
  }

  const start = anchor ?? editor.getViewportPageBounds().center;
  const id = createShapeId();
  editor.createShape<UploadNodeShape>({
    id,
    type: "canvas-ai-upload",
    x: start.x - UPLOAD_W / 2,
    y: start.y - UPLOAD_H / 2,
    props: {
      w: UPLOAD_W,
      h: UPLOAD_H,
      filename: data.title,
      kind: "youtube",
      preview: data.transcript.slice(0, PREVIEW_LEN),
      fullText: data.transcript,
      pageCount: 0,
      bytes: 0,
      lowText: false,
      ocr: false,
      sourceUrl: data.url,
    },
  });
  editor.select(id);
  toast(`Added transcript: ${data.title}`, "info");
  return true;
}
