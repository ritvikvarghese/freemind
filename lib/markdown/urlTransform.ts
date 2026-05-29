import { defaultUrlTransform } from "react-markdown";

/**
 * react-markdown's default URL sanitizer only allows http/https/mailto/xmpp/irc,
 * so it rewrites embedded `data:` image URLs to "" — which blanks out any image
 * inserted into a document and triggers the browser's empty-src warning. Allow
 * `data:image/*` for image `src`, and defer to the default safe-list for
 * everything else (so `javascript:` links etc. stay blocked).
 */
export function markdownUrlTransform(url: string, key: string): string {
  if (key === "src" && url.startsWith("data:image/")) return url;
  return defaultUrlTransform(url);
}
