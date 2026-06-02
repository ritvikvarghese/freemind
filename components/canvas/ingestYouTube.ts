import { createShapeId, type Editor, type VecLike } from "tldraw";
import { toast } from "./toast";
import {
  DOCUMENT_NODE_DEFAULT_W,
  DOCUMENT_NODE_DEFAULT_H,
  type DocumentNodeShape,
} from "./shapes/DocumentNode";

type TranscriptResponse =
  | { ok: true; videoId: string; title: string; url: string; transcript: string }
  | { ok: false; error: string };

/**
 * Fetch a YouTube transcript via our same-origin route and drop it on the
 * canvas as a fully-editable Document (status "done") seeded with the
 * transcript — so it gets editing, chat, export, and the sources panel like any
 * other artifact, plus a "Watch" link back to the video via `sourceUrl`. It's
 * still source-eligible for other research (documents are sources when done).
 * Returns true on success so the caller can clear its input.
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
  // Remaining props (sources, comments, sourceSnapshots, etc.) fall back to
  // DocumentNode's getDefaultProps — same as a hand-made "New document".
  editor.createShape<DocumentNodeShape>({
    id,
    type: "canvas-ai-document",
    x: start.x - DOCUMENT_NODE_DEFAULT_W / 2,
    y: start.y - DOCUMENT_NODE_DEFAULT_H / 2,
    props: {
      w: DOCUMENT_NODE_DEFAULT_W,
      h: DOCUMENT_NODE_DEFAULT_H,
      title: data.title,
      markdown: data.transcript,
      status: "done",
      sourceUrl: data.url,
    },
  });
  editor.select(id);
  toast(`Added transcript: ${data.title}`, "info");
  return true;
}
