"use client";

import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { AgentMode } from "@/lib/agent/modes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { ChatMessage } from "@/lib/storage/chatTypes";
import { getApiKey } from "@/lib/storage/apiKey";
import { buildMediaPrefix, toApiMessages, describeError } from "./chatStream";
import { chatSystemPromptFor, chatWebSearchMaxUses } from "./chatModes";
import { canvasContextPreamble } from "@/lib/agent/canvasContext";
import { logUsage } from "@/lib/agent/cacheDebug";

const MODEL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLAUDE_CHAT_MODEL) ||
  "claude-sonnet-4-6";

// Output ceiling (not a target). Generous so create_artifact can write a
// full-length document in one turn without truncating. See runChat.ts.
const MAX_TOKENS = 16_000;

export type CreateArtifactRequest = { title?: string; focus?: string };

export type WebSearch = { query: string; urls: string[] };

export type RunCanvasChatInput = {
  mode: AgentMode;
  sources: SourceSnapshot[];
  history: ChatMessage[];
  userMessage: string;
  onTextDelta: (text: string) => void;
  onWebSearch: (query: string, urls: string[]) => void;
  /** Fired when the model calls the create_artifact tool ("write this up"). */
  onCreateArtifact: (req: CreateArtifactRequest) => void;
  onDone: (text: string, webSearches: WebSearch[]) => void;
  onError: (message: string) => void;
};

// Client tool: the model emits this to ask the app to spawn a DocumentNode.
// We do not return a tool_result (it's a terminal action for the turn); the
// dock fires `promoteToArtifact` and renders a "Created ..." card.
const CREATE_ARTIFACT_TOOL = {
  name: "create_artifact",
  description:
    "Create a document artifact on the canvas from this conversation and its sources. Call this when the user asks to write something up, draft, or produce a document, doc, essay, report, or artifact. Do not paste a long document into the chat — call this tool instead.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "A short, concrete title for the document.",
      },
      focus: {
        type: "string",
        description:
          "What the document should focus on or emphasize. Optional — omit to write from the whole conversation.",
      },
    },
    required: [] as string[],
  },
};

export function runCanvasChat(input: RunCanvasChatInput): AbortController {
  const controller = new AbortController();
  const apiKey = getApiKey();
  if (!apiKey) {
    input.onError("No API key set. Open Settings to paste one.");
    return controller;
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // Stable, prefix-cached system block holds the conversational rules + the
  // (text) sources. Image / scanned-PDF sources ride in the media prefix. The
  // canvas purpose is folded into this same cached block (no extra breakpoint,
  // cache read after turn one); empty when the canvas has no context.
  const systemBlocks = [
    {
      type: "text" as const,
      text: canvasContextPreamble() + chatSystemPromptFor(input.mode, input.sources),
      cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    },
  ];

  const messages: MessageParam[] = [];
  const mediaPrefix = buildMediaPrefix(input.sources);
  if (mediaPrefix) messages.push(...mediaPrefix);
  messages.push(...toApiMessages(input.history));
  messages.push({ role: "user", content: input.userMessage });

  const maxUses = chatWebSearchMaxUses(input.mode);
  const tools = [
    CREATE_ARTIFACT_TOOL,
    ...(maxUses > 0
      ? [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }]
      : []),
  ];

  // Pair web_search queries to their results by tool_use_id (ported from
  // runResearch.ts).
  const queryByToolUseId = new Map<string, string>();
  const webSearches: WebSearch[] = [];
  let finalText = "";

  (async () => {
    try {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemBlocks,
          messages,
          tools: tools as unknown as Parameters<
            typeof client.messages.stream
          >[0]["tools"],
        },
        { signal: controller.signal },
      );

      stream.on("text", (delta: string) => {
        finalText += delta;
        input.onTextDelta(delta);
      });

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
            input.onWebSearch(query, urls);
          }
          return;
        }
        if (block.type === "tool_use" && block.name === "create_artifact") {
          const args = (block.input ?? {}) as CreateArtifactRequest;
          input.onCreateArtifact({ title: args.title, focus: args.focus });
        }
      });

      const final = await stream.finalMessage();
      logUsage("canvasChat", final.usage);
      input.onDone(finalText, webSearches);
    } catch (err) {
      if (err instanceof APIUserAbortError || controller.signal.aborted) {
        input.onDone(finalText, webSearches);
        return;
      }
      input.onError(describeError(err));
    }
  })();

  return controller;
}
