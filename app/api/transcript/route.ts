// Server-side YouTube transcript fetcher. The browser can't do this directly
// (YouTube's caption endpoints aren't CORS-enabled), so the client calls this
// same-origin route. Runs on the user's own machine in dev, so requests come
// from a residential IP — far less likely to be throttled than a cloud IP.
//
// We use YouTube's InnerTube "player" API with the ANDROID client. The older
// trick of scraping captionTracks out of the watch-page HTML still yields the
// track list, but those baseUrls now return empty bodies; the ANDROID-client
// baseUrls serve the actual timedtext (format 3, <p> tags).

export const dynamic = "force-dynamic";

// Public InnerTube web key — not a secret; ships in YouTube's own client.
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";

type CaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
};

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url") ?? searchParams.get("v") ?? "";
  const videoId = extractVideoId(raw.trim());
  if (!videoId) {
    return Response.json(
      { ok: false, error: "Not a valid YouTube URL." },
      { status: 400 },
    );
  }

  try {
    const player = await fetchPlayer(videoId);
    const status = player?.playabilityStatus?.status;
    if (status && status !== "OK") {
      const reason =
        player?.playabilityStatus?.reason ||
        "Video is unavailable, private, or age-restricted.";
      return Response.json({ ok: false, error: reason }, { status: 422 });
    }

    const tracks: CaptionTrack[] | undefined =
      player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) {
      return Response.json(
        { ok: false, error: "No captions/transcript available for this video." },
        { status: 404 },
      );
    }

    const track = pickTrack(tracks);
    const xmlRes = await fetch(track.baseUrl, {
      headers: { "User-Agent": ANDROID_UA },
    });
    if (!xmlRes.ok) {
      return Response.json(
        { ok: false, error: "Could not fetch the caption track." },
        { status: 502 },
      );
    }
    const transcript = parseTimedText(await xmlRes.text());
    if (!transcript.trim()) {
      return Response.json(
        { ok: false, error: "Transcript was empty." },
        { status: 404 },
      );
    }

    const title: string =
      player?.videoDetails?.title || `YouTube video ${videoId}`;

    return Response.json({
      ok: true,
      videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      language: track.languageCode ?? "",
      transcript,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Fetch failed." },
      { status: 500 },
    );
  }
}

async function fetchPlayer(videoId: string): Promise<Record<string, unknown> & {
  playabilityStatus?: { status?: string; reason?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
  videoDetails?: { title?: string };
}> {
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ANDROID_UA,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            hl: "en",
          },
        },
        videoId,
      }),
    },
  );
  return res.json();
}

function extractVideoId(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|v|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

// Prefer a manually-authored English track, then any English, then any manual,
// then whatever's first. (kind === "asr" means auto-generated.)
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  const isEn = (t: CaptionTrack) => (t.languageCode ?? "").startsWith("en");
  return (
    tracks.find((t) => isEn(t) && t.kind !== "asr") ??
    tracks.find((t) => isEn(t)) ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0]
  );
}

// Handles both legacy srv1 (<text> tags) and format-3 (<p> tags, optional <s>
// word segments) timedtext payloads.
function parseTimedText(xml: string): string {
  const tag = xml.includes("<text") ? "text" : "p";
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  return [...xml.matchAll(re)]
    .map((m) => m[1])
    // Drop word-segment tags but keep their text content.
    .map((s) => s.replace(/<\/?s\b[^>]*>/g, ""))
    .map((s) => decodeEntities(s))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

// Caption text is often double-encoded (e.g. &amp;#39;), so decode twice.
function decodeEntities(s: string): string {
  return decodeOnce(decodeOnce(s));
}

function decodeOnce(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    );
}
