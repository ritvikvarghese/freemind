"use client";

import Anthropic, {
  APIError,
  APIUserAbortError,
  AuthenticationError,
} from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { ChatMessage } from "@/lib/storage/chatTypes";
import { getApiKey } from "@/lib/storage/apiKey";
import { imageBlock, pdfBlock } from "@/lib/agent/buildContext";
import { buildChatSystemPrompt } from "./systemPrompt";
import { CHAT_TOOLS } from "./tools";

const MODEL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLAUDE_CHAT_MODEL) ||
  "claude-sonnet-4-6";

const MAX_TOKENS = 8_000;

export type ToolUseCallbacks = {
  onTextDelta: (text: string) => void;
  onToolUseStart: (id: string, name: string) => void;
  onToolUseInputDelta: (id: string, partialJson: string) => void;
  onToolUseEnd: (id: string, name: string, finalInputJson: string) => void;
  onDone: (text: string) => void;
  onError: (message: string) => void;
};

export type RunChatInput = {
  doc: { markdown: string; sources: SourceSnapshot[] };
  history: ChatMessage[];
  userMessage: string;
} & ToolUseCallbacks;

export function runChat(input: RunChatInput): AbortController {
  const controller = new AbortController();
  const apiKey = getApiKey();
  if (!apiKey) {
    input.onError("No API key set. Open Settings to paste one.");
    return controller;
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // Stable, prefix-cached system prompt block holds the doc + sources.
  const systemBlocks = [
    {
      type: "text" as const,
      text: buildChatSystemPrompt(input.doc.markdown, input.doc.sources),
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const messages: MessageParam[] = [];

  // Image and scanned-PDF sources can't live in the (text-only) system block,
  // so they go in a stable user-message prefix at the front of the
  // conversation. Caching the last block keeps multi-turn chats from re-billing
  // the media every turn.
  const mediaPrefix = buildMediaPrefix(input.doc.sources);
  if (mediaPrefix) messages.push(...mediaPrefix);

  messages.push(...toApiMessages(input.history));
  messages.push({ role: "user", content: input.userMessage });

  // Per-block scratch state: aggregate partial_json by content_block index.
  const toolUseState = new Map<
    number,
    { id: string; name: string; partialJson: string }
  >();

  let finalText = "";

  (async () => {
    try {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemBlocks,
          messages,
          // Cast: tool schemas use `as const` for compile-time literal types,
          // which produces readonly arrays; Anthropic's SDK types want mutable.
          tools: CHAT_TOOLS as unknown as Parameters<
            typeof client.messages.stream
          >[0]["tools"],
        },
        { signal: controller.signal },
      );

      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start") {
          const block = event.content_block as ContentBlock;
          if (block.type === "tool_use") {
            toolUseState.set(event.index, {
              id: block.id,
              name: block.name,
              partialJson: "",
            });
            input.onToolUseStart(block.id, block.name);
          }
          return;
        }
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            finalText += delta.text;
            input.onTextDelta(delta.text);
            return;
          }
          if (delta.type === "input_json_delta") {
            const slot = toolUseState.get(event.index);
            if (!slot) return;
            slot.partialJson += delta.partial_json;
            input.onToolUseInputDelta(slot.id, slot.partialJson);
            return;
          }
          return;
        }
        if (event.type === "content_block_stop") {
          const slot = toolUseState.get(event.index);
          if (!slot) return;
          input.onToolUseEnd(slot.id, slot.name, slot.partialJson);
          toolUseState.delete(event.index);
        }
      });

      await stream.finalMessage();
      input.onDone(finalText);
    } catch (err) {
      if (err instanceof APIUserAbortError || controller.signal.aborted) {
        // Treat abort as a clean stop with whatever text we have so far.
        input.onDone(finalText);
        return;
      }
      input.onError(describeError(err));
    }
  })();

  return controller;
}

// Build the cached media-prefix message pair for any image or scanned-PDF
// sources on the doc (they can't live in the text-only system block). Returns
// null when there are none.
function buildMediaPrefix(sources: SourceSnapshot[]): MessageParam[] | null {
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
  // Cache breakpoint on the final block so the whole media prefix is reused.
  const last = blocks[blocks.length - 1] as ContentBlockParam & {
    cache_control?: { type: "ephemeral" };
  };
  last.cache_control = { type: "ephemeral" };

  return [
    { role: "user", content: blocks },
    {
      role: "assistant",
      content: "Understood — I can see the source image(s) and document(s) above.",
    },
  ];
}

function toApiMessages(history: ChatMessage[]): MessageParam[] {
  // Persist a flat text-only transcript on the wire. Proposals are rendered
  // client-side and don't need to round-trip through the API as tool_use blocks
  // because the next turn re-assembles the system prompt with the latest doc.
  // This keeps the request shape simple and the cache prefix maximally stable.
  const out: MessageParam[] = [];
  for (const m of history) {
    const text = m.text || (m.proposals?.length ? "(proposed edits)" : "");
    if (!text) continue;
    out.push({ role: m.role, content: text });
  }
  return out;
}

function describeError(err: unknown): string {
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
