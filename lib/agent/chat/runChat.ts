"use client";

import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { ChatMessage } from "@/lib/storage/chatTypes";
import { getApiKey } from "@/lib/storage/apiKey";
import { buildChatSystemPrompt } from "./systemPrompt";
import { canvasContextPreamble } from "@/lib/agent/canvasContext";
import { CHAT_TOOLS } from "./tools";
import {
  buildMediaPrefix,
  toApiMessages,
  markLastCacheable,
  describeError,
} from "./chatStream";
import { logUsage } from "@/lib/agent/cacheDebug";

const MODEL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLAUDE_CHAT_MODEL) ||
  "claude-sonnet-4-6";

// Output ceiling (not a target — only spent if the model writes that much).
// Generous so creating/rewriting a full-length artifact never truncates
// mid-document. Sonnet 4.6's ceiling is far higher, so 16k is comfortable.
const MAX_TOKENS = 16_000;

export type WebSearch = { query: string; urls: string[] };

export type ToolUseCallbacks = {
  onTextDelta: (text: string) => void;
  onToolUseStart: (id: string, name: string) => void;
  onToolUseInputDelta: (id: string, partialJson: string) => void;
  onToolUseEnd: (id: string, name: string, finalInputJson: string) => void;
  /** Fired when a web_search result block arrives (Deepsearch turns only). */
  onWebSearch?: (query: string, urls: string[]) => void;
  /** stopReason is the API `stop_reason` ("end_turn", "max_tokens", "tool_use",
   *  …) or null when we finished via abort. "max_tokens" means the reply was
   *  truncated, so any trailing tool_use JSON is incomplete and won't parse. */
  onDone: (
    text: string,
    webSearches: WebSearch[],
    stopReason: string | null,
  ) => void;
  onError: (message: string) => void;
};

export type RunChatInput = {
  doc: { markdown: string; sources: SourceSnapshot[] };
  history: ChatMessage[];
  userMessage: string;
  /** > 0 turns on the web_search server tool for this turn (Freeform/Deepsearch).
   *  The propose_edit / propose_replace_section tools are ALWAYS available, so a
   *  web turn can both search and write results into the document. */
  webSearchMaxUses?: number;
  /** When true (Deepsearch), the model is told to deliver web findings INTO the
   *  document by default rather than answering at length in chat. */
  webSearchWritesDoc?: boolean;
} & ToolUseCallbacks;

export function runChat(input: RunChatInput): AbortController {
  const controller = new AbortController();
  const apiKey = getApiKey();
  if (!apiKey) {
    input.onError("No API key set. Open Settings to paste one.");
    return controller;
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const webSearchMaxUses = input.webSearchMaxUses ?? 0;

  // Stable, prefix-cached system prompt block holds the doc + sources. The
  // canvas purpose is folded into this same cached block (no extra breakpoint,
  // cache read after turn one); empty when the canvas has no context.
  const systemBlocks = [
    {
      type: "text" as const,
      text:
        canvasContextPreamble() +
        buildChatSystemPrompt(input.doc.markdown, input.doc.sources, {
          webSearch: webSearchMaxUses > 0,
          writeToDocDefault: input.webSearchWritesDoc ?? false,
        }),
      cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    },
  ];

  const messages: MessageParam[] = [];

  // Image and scanned-PDF sources can't live in the (text-only) system block,
  // so they go in a stable user-message prefix at the front of the
  // conversation. Caching the last block keeps multi-turn chats from re-billing
  // the media every turn.
  const mediaPrefix = buildMediaPrefix(input.doc.sources);
  if (mediaPrefix) messages.push(...mediaPrefix);

  const apiHistory = toApiMessages(input.history);
  messages.push(...apiHistory);
  // Cache the conversation prefix so multi-turn chats and Redo (which resends
  // the whole transcript, including each proposal's full old/new text) read the
  // history back instead of re-billing it every turn. Only when there IS prior
  // history; the new user message below stays outside the cached prefix.
  if (apiHistory.length > 0) markLastCacheable(messages);
  messages.push({ role: "user", content: input.userMessage });

  // Per-block scratch state: aggregate partial_json by content_block index.
  const toolUseState = new Map<
    number,
    { id: string; name: string; partialJson: string }
  >();

  let finalText = "";

  // web_search is a server tool; pair queries to their result URLs by id.
  const queryByToolUseId = new Map<string, string>();
  const webSearches: WebSearch[] = [];

  // Edit-proposal tools are always present (so any mode can write into the doc);
  // web_search is added only when this is a Deepsearch turn.
  const tools = [
    ...CHAT_TOOLS,
    ...(webSearchMaxUses > 0
      ? [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: webSearchMaxUses,
          },
        ]
      : []),
  ];

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
          tools: tools as unknown as Parameters<
            typeof client.messages.stream
          >[0]["tools"],
        },
        { signal: controller.signal },
      );

      // Higher-level event for complete web_search blocks (server tool). The
      // raw streamEvent handler below still drives text + client tool_use; the
      // two don't overlap (server_tool_use / web_search_tool_result aren't
      // "tool_use", so streamEvent ignores them).
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") {
          const q = (block.input as { query?: string } | undefined)?.query;
          if (q) queryByToolUseId.set(block.id, q);
          return;
        }
        if (block.type === "web_search_tool_result") {
          const query = queryByToolUseId.get(block.tool_use_id) ?? "";
          const items = Array.isArray(block.content) ? block.content : [];
          const urls = items
            .filter(
              (b: { type?: string; url?: string }) =>
                b.type === "web_search_result" && typeof b.url === "string",
            )
            .map((b) => b.url as string);
          if (urls.length > 0 || query) {
            webSearches.push({ query, urls });
            input.onWebSearch?.(query, urls);
          }
        }
      });

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

      const final = await stream.finalMessage();
      logUsage("chat", final.usage);
      input.onDone(finalText, webSearches, final.stop_reason ?? null);
    } catch (err) {
      if (err instanceof APIUserAbortError || controller.signal.aborted) {
        // Treat abort as a clean stop with whatever text we have so far.
        input.onDone(finalText, webSearches, null);
        return;
      }
      input.onError(describeError(err));
    }
  })();

  return controller;
}
