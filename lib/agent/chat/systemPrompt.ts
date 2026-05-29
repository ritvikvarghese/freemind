import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildChatSystemPrompt(
  markdown: string,
  sources: SourceSnapshot[],
): string {
  const sourceBlocks = sources
    .map(
      (s, i) =>
        `  <source id="s${i + 1}" title="${escapeXml(s.title)}" kind="${s.kind}">\n${escapeXml(s.text)}\n  </source>`,
    )
    .join("\n");

  const sourcesXml = sources.length
    ? `<sources>\n${sourceBlocks}\n</sources>`
    : "<sources></sources>";

  return [
    "You are an editing assistant for a markdown document on the user's canvas.",
    "",
    "You have two jobs:",
    "",
    "1. ANSWER questions about the document or its sources.",
    "2. PROPOSE precise edits using the propose_edit / propose_replace_section tools.",
    "   You MUST NOT describe changes in prose — every change goes through a tool call.",
    "   The user reviews and accepts/rejects each proposal.",
    "",
    "The document below is the current authoritative version. The sources below are",
    "snapshots captured at the time the document was generated — they are read-only",
    "context for your suggestions.",
    "",
    `<document>\n${markdown}\n</document>`,
    "",
    sourcesXml,
    "",
    "Rules:",
    "- For anchor_before / anchor_after use 20–40 chars of EXACT text from <document>.",
    "- old_text must be an EXACT substring of <document>.",
    "- Output pure markdown in new_text / new_markdown. No HTML except raw <u> if underline is meant.",
    "- One tool call per change. Multiple tool calls per turn allowed.",
    "- If a user asks an open-ended question, answer in prose. Only propose edits when the user clearly asks for a change.",
    "- Do not use em dashes or en dashes, in either prose answers or proposed edits. Rephrase, or use commas, periods, or parentheses instead. Plain hyphens in compound words are fine.",
    "- Do not use emojis.",
  ].join("\n");
}
