import { createShapeId, type Editor, type VecLike } from "tldraw";
import { toast } from "./toast";
import {
  LINK_NODE_DEFAULT_W,
  LINK_NODE_DEFAULT_H,
  type LinkNodeShape,
} from "./shapes/LinkNode";

type FetchUrlResponse =
  | {
      ok: true;
      url: string;
      title: string;
      description: string;
      image: string;
      siteName: string;
      text: string;
    }
  | { ok: false; error: string };

/**
 * Drop a pasted URL on the canvas as a link card and enrich it in the
 * background. The card appears immediately (status "loading") so paste feels
 * instant; we then fetch OG metadata (title/description/image) for the card and
 * the page's body text — stored on `props.text` — which becomes the AI context
 * when the link is used as a source. Pure HTTP fetch, no model cost.
 */
export async function ingestLink(
  editor: Editor,
  url: string,
  anchor?: VecLike,
): Promise<void> {
  const start = anchor ?? editor.getViewportPageBounds().center;
  const id = createShapeId();
  editor.createShape<LinkNodeShape>({
    id,
    type: "canvas-ai-link",
    x: start.x - LINK_NODE_DEFAULT_W / 2,
    y: start.y - LINK_NODE_DEFAULT_H / 2,
    props: {
      url,
      title: url,
      siteName: hostnameOf(url),
      status: "loading",
    },
  });
  editor.select(id);

  let data: FetchUrlResponse;
  try {
    const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
    data = (await res.json()) as FetchUrlResponse;
  } catch {
    data = { ok: false, error: "network error" };
  }

  // The shape may have been deleted while we were fetching.
  if (!editor.getShape(id)) return;

  if (!data.ok) {
    editor.updateShape<LinkNodeShape>({
      id,
      type: "canvas-ai-link",
      props: { status: "error" },
    });
    toast(`Couldn't read "${hostnameOf(url)}" — link saved without preview.`, "error");
    return;
  }

  editor.updateShape<LinkNodeShape>({
    id,
    type: "canvas-ai-link",
    props: {
      url: data.url,
      title: data.title,
      description: data.description,
      image: data.image,
      siteName: data.siteName,
      text: data.text,
      status: "done",
    },
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
