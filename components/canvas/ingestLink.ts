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

// Client-side backstop for the enrichment fetch. The server route already aborts
// its upstream at 10s, so in a live session it returns (ok:false) well before
// this fires; this only catches a hung connection to our own route so a card can
// never spin forever. Kept above the server timeout so the route's nicer error
// wins the race in the common case.
const ENRICH_TIMEOUT_MS = 15_000;

// Shape ids currently being enriched, so an active ingest and the on-load
// recovery sweep (which runs twice) never fetch the same card concurrently.
const inFlight = new Set<string>();

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

  await enrichLink(editor, id, url);
}

/**
 * Re-resolve any link cards left in "loading" — typically because the page
 * reloaded (or the dev server restarted) mid-fetch, which kills the in-flight
 * `ingestLink` but leaves the persisted card stranded with nothing to finish it.
 * Re-running the fetch lands each one on a terminal state (a real preview, or
 * "error" with the link still saved). Safe to call repeatedly: the in-flight
 * guard dedupes, and "done"/"error" cards are skipped.
 */
export function recoverPendingLinks(editor: Editor): void {
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "canvas-ai-link") continue;
    const props = shape.props as LinkNodeShape["props"];
    if (props.status !== "loading") continue;
    if (inFlight.has(shape.id)) continue;
    // Silent: a reload that strands several cards shouldn't fire a toast storm.
    void enrichLink(editor, shape.id, props.url, { silent: true });
  }
}

/**
 * Fetch metadata + body text for a link card and write the terminal state onto
 * the shape. Used both for a fresh paste and for on-load recovery.
 */
async function enrichLink(
  editor: Editor,
  id: string,
  url: string,
  opts: { silent?: boolean } = {},
): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    let data: FetchUrlResponse;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENRICH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });
      data = (await res.json()) as FetchUrlResponse;
    } catch {
      data = { ok: false, error: "network error" };
    } finally {
      clearTimeout(timer);
    }

    // The shape may have been deleted while we were fetching.
    if (!editor.getShape(id as LinkNodeShape["id"])) return;

    if (!data.ok) {
      editor.updateShape<LinkNodeShape>({
        id: id as LinkNodeShape["id"],
        type: "canvas-ai-link",
        props: { status: "error" },
      });
      if (!opts.silent) {
        toast(
          `Couldn't read "${hostnameOf(url)}" — link saved without preview.`,
          "error",
        );
      }
      return;
    }

    editor.updateShape<LinkNodeShape>({
      id: id as LinkNodeShape["id"],
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
  } finally {
    inFlight.delete(id);
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
