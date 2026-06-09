"use client";

import { APIError, AuthenticationError } from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { ChatMessage } from "@/lib/storage/chatTypes";
import { imageBlock, pdfBlock } from "@/lib/agent/buildContext";

/**
 * Streaming helpers shared by the artifact chat (`runChat`) and the canvas chat
 * (`runCanvasChat`). Pure functions — no editor/shape coupling.
 */

// Build the cached media-prefix message pair for any image or scanned-PDF
// sources (they can't live in the text-only system block). Returns null when
// there are none. Caching the last block keeps multi-turn chats from re-billing
// the media every turn.
export function buildMediaPrefix(
  sources: SourceSnapshot[],
): MessageParam[] | null {
  const images = sources.filter((s) => s.image);
  const pdfs = sources.filter((s) => s.pdf);
  if (images.length === 0 && pdfs.length === 0) return null;

  const blocks: ContentBlockParam[] = [];
  images.forEach((s, i) => {
    blocks.push({ type: "text", text: `Source image ${i + 1} ("${s.title}"):` });
    blocks.push(imageBlock(s.image!));
  });
  pdfs.forEach((s, i) => {
    blocks.push({ type: "text", text: `Scanned PDF source ${i + 1} ("${s.title}"):` });
    blocks.push(pdfBlock(s.pdf!.data));
  });
  const last = blocks[blocks.length - 1] as ContentBlockParam & {
    cache_control?: { type: "ephemeral"; ttl?: "1h" };
  };
  last.cache_control = { type: "ephemeral", ttl: "1h" };

  return [
    { role: "user", content: blocks },
    {
      role: "assistant",
      content: "Understood — I can see the source image(s) and document(s) above.",
    },
  ];
}

// Flatten a persisted transcript onto the wire. Text-only: tool calls /
// proposals are rendered client-side and don't round-trip as content blocks,
// keeping the request shape simple and the cache prefix maximally stable.
export function toApiMessages(history: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of history) {
    const text = m.text || (m.proposals?.length ? "(proposed edits)" : "");
    if (!text) continue;
    out.push({ role: m.role, content: text });
  }
  return out;
}

export function describeError(err: unknown): string {
  if (err instanceof AuthenticationError) {
    return "Invalid API key. Update it in Settings.";
  }
  if (err instanceof APIError) {
    if (err.status === 429) return "Rate limited — wait a moment and retry.";
    if (err.status === 400) return `Bad request: ${err.message}`;
    if (err.status === 529) return "Anthropic is overloaded — retry shortly.";
    return `API error ${err.status ?? ""}: ${err.message}`;
  }
  if (err instanceof Error) {
    if (err.message.toLowerCase().includes("failed to fetch")) {
      return "Network blocked — cannot reach api.anthropic.com.";
    }
    return err.message;
  }
  return String(err);
}
