// Server-side link fetcher. The browser can't fetch arbitrary pages (CORS), so
// when the user pastes a URL onto the canvas the client calls this same-origin
// route. We pull Open Graph metadata (title / description / image) for the card
// and a plain-text extraction of the page body for AI context. No LLM involved
// — this is a dumb HTTP fetch + regex strip, so it's free; the page text only
// costs tokens later, when the link is actually used as a source in a prompt.

import {
  assertSameOrigin,
  safeFetch,
  GuardError,
} from "@/lib/server/guardFetch";

export const dynamic = "force-dynamic";
// node:dns in the guard requires the Node runtime (not Edge).
export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024; // stop reading runaway pages
const MAX_TEXT_CHARS = 50_000; // cap stored body text
// A real browser UA — many sites 403 the default fetch agent.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

export async function GET(request: Request): Promise<Response> {
  // Only our own front-end may call this open fetcher.
  try {
    assertSameOrigin(request);
  } catch {
    return Response.json(
      { ok: false, error: "Forbidden." } satisfies FetchUrlResponse,
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("url") ?? "").trim();

  let target: URL;
  try {
    target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("protocol");
    }
  } catch {
    return Response.json(
      { ok: false, error: "Not a valid http(s) URL." } satisfies FetchUrlResponse,
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    // safeFetch validates the host (and every redirect hop) against the SSRF
    // blocklist after DNS resolution, and follows redirects manually so an
    // allowed host cannot bounce us to an internal target.
    res = await safeFetch(
      target.toString(),
      {
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      { maxRedirects: 5 },
    );
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof GuardError) {
      return Response.json(
        { ok: false, error: "That URL is not allowed." } satisfies FetchUrlResponse,
        { status: 400 },
      );
    }
    const aborted = err instanceof Error && err.name === "AbortError";
    return Response.json(
      {
        ok: false,
        error: aborted ? "The page took too long to load." : "Could not reach the page.",
      } satisfies FetchUrlResponse,
      { status: 502 },
    );
  }
  clearTimeout(timer);

  const finalUrl = res.url || target.toString();
  const siteName = hostnameOf(finalUrl);

  // Non-HTML (PDF, image, etc.): we can't extract text, but still return a
  // usable card titled by the hostname so the paste doesn't fail.
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/html")) {
    return Response.json({
      ok: true,
      url: finalUrl,
      title: siteName,
      description: "",
      image: "",
      siteName,
      text: "",
    } satisfies FetchUrlResponse);
  }

  const html = await readCapped(res, MAX_HTML_BYTES);
  const head = sliceHead(html);

  const title =
    metaContent(head, "og:title") ||
    metaContent(head, "twitter:title") ||
    tagText(head, "title") ||
    siteName;
  const description =
    metaContent(head, "og:description") ||
    metaContent(head, "twitter:description") ||
    metaName(head, "description") ||
    "";
  const rawImage =
    metaContent(head, "og:image") ||
    metaContent(head, "twitter:image") ||
    metaContent(head, "og:image:url") ||
    "";
  const image = rawImage ? absolutize(rawImage, finalUrl) : "";

  return Response.json({
    ok: true,
    url: finalUrl,
    title: decodeEntities(title).trim() || siteName,
    description: decodeEntities(description).trim(),
    image,
    siteName,
    text: extractBodyText(html),
  } satisfies FetchUrlResponse);
}

/** Read a response body as text, but stop after `maxBytes` to bound memory. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  out += decoder.decode();
  return out;
}

function sliceHead(html: string): string {
  const end = html.search(/<\/head>/i);
  return end >= 0 ? html.slice(0, end) : html.slice(0, 50_000);
}

/** `<meta property="og:x" content="...">` (property OR name, attrs either order). */
function metaContent(html: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${esc}["'][^>]*\\bcontent=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return "";
}

function metaName(html: string, name: string): string {
  return metaContent(html, name);
}

function tagText(html: string, tag: string): string {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1]?.trim() ?? "";
}

/** Strip scripts/styles/tags from the HTML body and collapse to plain text. */
function extractBodyText(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let s = bodyMatch ? bodyMatch[1] : html;
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Turn block-ish closers into newlines so paragraphs survive.
    .replace(/<\/(p|div|section|article|li|h[1-6]|br|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Collapse runs of spaces/newlines.
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n").trim();
  return s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + "…" : s;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, d) => safeFromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCharCode(parseInt(h, 16)));
}

function safeFromCharCode(code: number): string {
  return Number.isFinite(code) && code > 0 && code < 0x110000
    ? String.fromCodePoint(code)
    : "";
}

function absolutize(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
