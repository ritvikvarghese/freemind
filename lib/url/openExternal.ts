// Open a user-supplied URL in a new tab, but only if it's http(s). Link cards
// carry whatever string the user pasted (or whatever a fetched page redirected
// to), so a `javascript:` URL here would run script in our origin on click and
// could read the BYOK key out of localStorage. Mirror the markdown link
// allow-list: anything that isn't http(s) is ignored.
export function openExternalUrl(url: string | undefined | null): void {
  if (!url || typeof window === "undefined") return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}
