import type { AgentMode } from "@/lib/agent/modes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";

/**
 * Conversational, source-grounded system prompts for the canvas chat (distinct
 * from `modes.ts`, whose prompts instruct the model to PRODUCE a titled
 * document). Canvas chat answers conversationally; when the user wants a
 * document, the model calls the `create_artifact` tool instead.
 */

// Web-search budget per mode (chat turns). Deepsynth is closed-corpus.
export function chatWebSearchMaxUses(mode: AgentMode): number {
  if (mode === "deepsearch") return 15;
  if (mode === "deepsynth") return 0;
  return 5; // freeform: only to follow URLs that appear in the sources
}

const SHARED_RULES = `Output rules that always apply:
- Answer conversationally. Do NOT emit a titled document (no leading H1). This is a chat, not an artifact.
- Output pure markdown. No HTML, no preamble like "Here is...".
- Do not use em dashes or en dashes. Rephrase, or use commas, periods, or parentheses instead. Plain hyphens in compound words are fine.
- Do not use emojis.
- When you use a provided source, cite it inline by its id, e.g. (source: s1).
- If a turn begins with a <focus> block, the user just added those sources and this message is primarily about them: build your answer mainly from the focused sources and treat all other sources as background context only.
- When you use the web, cite the URL inline.
- If the sources cannot support what is asked, say so plainly rather than guessing.
- If the user asks you to write something up, draft, or produce a document / doc / essay / report / artifact, call the create_artifact tool. Do not paste a long document into the chat.`;

const MODE_INTRO: Record<AgentMode, string> = {
  freeform: `You are a thinking partner on a spatial research canvas. The user has selected one or more sources and is chatting with you about them. Let the user's message drive the format and length. Be concise and direct.`,
  deepsynth: `You are a careful synthesizer on a spatial research canvas. The user has selected one or more sources and is chatting with you about them. Reason hard inside the provided sources (closed-corpus) and give tight, well-reasoned answers. Do not run web_search; the user's own sources are the world. When asked for recommendations, structure them clearly.`,
  deepsearch: `You are a research-minded thinking partner on a spatial research canvas. The user has selected one or more sources and is chatting with you about them. Use the web_search tool aggressively to verify claims and pull in current evidence, and cite the URLs you use inline. Cross-check provided sources against what you find.`,
};

function sourcesContext(sources: SourceSnapshot[]): string {
  if (sources.length === 0) {
    return `\n\nThe user has not attached any sources to this chat.`;
  }
  const blocks = sources.map((s, i) => {
    const sid = `s${i + 1}`;
    const note =
      s.image ? " (image shown above)" : s.pdf ? " (scanned PDF shown above)" : "";
    const body = s.text?.trim() ? s.text : "(no extractable text)";
    return `<source id="${sid}" title="${escapeAttr(s.title)}"${note ? ` note="${note.trim()}"` : ""}>\n${body}\n</source>`;
  });
  return `\n\nThe user's selected sources are below. Treat them as authoritative excerpts.\n<context>\n${blocks.join("\n")}\n</context>`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'");
}

export function chatSystemPromptFor(
  mode: AgentMode,
  sources: SourceSnapshot[],
): string {
  return `${MODE_INTRO[mode]}\n\n${SHARED_RULES}${sourcesContext(sources)}`;
}
