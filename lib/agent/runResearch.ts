"use client";

import Anthropic, {
  APIError,
  APIUserAbortError,
  AuthenticationError,
} from "@anthropic-ai/sdk";
import type { Editor, TLShapeId } from "tldraw";
import type { DocumentNodeShape } from "@/components/canvas/shapes/DocumentNode";
import { type AgentMode, systemPromptFor } from "./modes";
import { buildContext, snapshotSource, type SourceShape } from "./buildContext";
import { beginRun, endRun } from "./abortRegistry";
import { getApiKey } from "@/lib/storage/apiKey";

// Freeform mode: fast, cheap, chat-style. Sonnet handles synthesis well and
// 8k tokens is plenty for a summary or quick comparison.
const FREEFORM_MODEL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CLAUDE_MODEL) ||
  "claude-sonnet-4-6";

// Deep research mode: aim for Claude.ai's research-tier quality. Opus 4.7 has
// the best deep agentic-search score in Anthropic's lineup. Extended thinking
// + many more searches + much larger output budget. Costs ~10x freeform per
// run and takes 2-6 min instead of 30s — that's the deal.
const DEEP_MODEL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CLAUDE_DEEP_MODEL) ||
  "claude-opus-4-7";

const FLUSH_INTERVAL_MS = 120;

function paramsForMode(mode: AgentMode): {
  model: string;
  maxTokens: number;
  webSearchMaxUses: number;
  thinking?: { type: "enabled"; budget_tokens: number };
} {
  if (mode === "deepsearch") {
    return {
      model: DEEP_MODEL,
      // 32k total budget: ~16k for thinking, ~16k for the doc itself. A serious
      // research doc (1500-4000 words) easily fits in 16k output tokens.
      maxTokens: 32_000,
      webSearchMaxUses: 25,
      thinking: { type: "enabled", budget_tokens: 16_000 },
    };
  }
  if (mode === "deepsynth") {
    // Closed-corpus reasoning: extended thinking on, no web search. Sonnet 4.6
    // is the sweet spot — Opus's web-agent edge doesn't help here, and output
    // targets 300-700 words so 6k is plenty.
    return {
      model: FREEFORM_MODEL,
      maxTokens: 14_000,
      webSearchMaxUses: 0,
      thinking: { type: "enabled", budget_tokens: 8_000 },
    };
  }
  return {
    model: FREEFORM_MODEL,
    maxTokens: 8_000,
    webSearchMaxUses: 5,
  };
}

export type RunResearchInput = {
  editor: Editor;
  docShapeId: TLShapeId;
  sources: SourceShape[];
  userPrompt: string;
  mode: AgentMode;
};

export async function runResearch({
  editor,
  docShapeId,
  sources,
  userPrompt,
  mode,
}: RunResearchInput): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    finalize(editor, docShapeId, {
      status: "error",
      errorMessage: "No API key set. Open Settings to paste one.",
    });
    return;
  }

  const controller = beginRun(docShapeId);
  const { content } = buildContext(sources, userPrompt);

  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  // Buffer of text deltas; flushed to the shape on a debounced interval.
  let buffer = "";
  let pendingFlush: ReturnType<typeof setTimeout> | null = null;
  // Track web_search tool_use → query mapping by tool_use_id so we can pair
  // queries to their results when the result block arrives.
  const queryByToolUseId = new Map<string, string>();
  const sourcesUsed: { query: string; urls: string[] }[] = [];
  let firstTextSeen = false;

  function flush() {
    pendingFlush = null;
    if (buffer.length === 0) return;
    const text = buffer;
    buffer = "";
    editor.run(() => {
      const shape = editor.getShape<DocumentNodeShape>(docShapeId);
      if (!shape) return;
      editor.updateShape<DocumentNodeShape>({
        id: docShapeId,
        type: "canvas-ai-document",
        props: { markdown: shape.props.markdown + text, status: "streaming" },
      });
    });
  }

  function scheduleFlush() {
    if (pendingFlush !== null) return;
    pendingFlush = setTimeout(flush, FLUSH_INTERVAL_MS);
  }

  function flushNow() {
    if (pendingFlush !== null) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    flush();
  }

  try {
    const cfg = paramsForMode(mode);
    const stream = client.messages.stream(
      {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        ...(cfg.thinking ? { thinking: cfg.thinking } : {}),
        system: systemPromptFor(mode),
        messages: [{ role: "user", content }],
        tools:
          cfg.webSearchMaxUses > 0
            ? [
                {
                  type: "web_search_20250305",
                  name: "web_search",
                  max_uses: cfg.webSearchMaxUses,
                },
              ]
            : [],
      },
      { signal: controller.signal },
    );

    stream.on("text", (delta: string) => {
      if (!firstTextSeen) {
        firstTextSeen = true;
        editor.updateShape<DocumentNodeShape>({
          id: docShapeId,
          type: "canvas-ai-document",
          props: { status: "streaming" },
        });
      }
      buffer += delta;
      // Flush on paragraph break for snappier UX on long generations.
      if (delta.includes("\n\n")) {
        flushNow();
      } else {
        scheduleFlush();
      }
    });

    stream.on("contentBlock", (block) => {
      if (
        block.type === "server_tool_use" &&
        block.name === "web_search"
      ) {
        const input = block.input as { query?: string } | undefined;
        if (input?.query) queryByToolUseId.set(block.id, input.query);
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
          sourcesUsed.push({ query, urls });
          editor.updateShape<DocumentNodeShape>({
            id: docShapeId,
            type: "canvas-ai-document",
            props: { sourcesUsed: [...sourcesUsed] },
          });
        }
      }
    });

    const final = await stream.finalMessage();
    flushNow();

    const shape = editor.getShape<DocumentNodeShape>(docShapeId);
    const finalMarkdown =
      (shape?.props.markdown ?? "") +
      // Some final whitespace can sit in our buffer if no terminating newline.
      "";
    const title = deriveTitle(finalMarkdown);

    const capturedAt = Date.now();
    const sourceSnapshots = sources.map((s) => snapshotSource(s, capturedAt));

    editor.updateShape<DocumentNodeShape>({
      id: docShapeId,
      type: "canvas-ai-document",
      props: {
        status: "done",
        title,
        sources: sourceSnapshots,
      },
    });

    // Catch any sourcesUsed that arrived in the final synthesized message
    // but were missed by the streaming events (rare, but defensive).
    const finalCitations = extractCitations(final.content, queryByToolUseId);
    if (
      finalCitations.length > 0 &&
      finalCitations.length !== sourcesUsed.length
    ) {
      editor.updateShape<DocumentNodeShape>({
        id: docShapeId,
        type: "canvas-ai-document",
        props: { sourcesUsed: finalCitations },
      });
    }
  } catch (err) {
    flushNow();
    if (err instanceof APIUserAbortError || controller.signal.aborted) {
      finalize(editor, docShapeId, { status: "stopped", errorMessage: "" });
      return;
    }
    finalize(editor, docShapeId, {
      status: "error",
      errorMessage: describeError(err),
    });
  } finally {
    endRun(docShapeId);
  }
}

function finalize(
  editor: Editor,
  docShapeId: TLShapeId,
  patch: Partial<DocumentNodeShape["props"]>,
) {
  editor.updateShape<DocumentNodeShape>({
    id: docShapeId,
    type: "canvas-ai-document",
    props: patch,
  });
  endRun(docShapeId);
}

function deriveTitle(markdown: string): string {
  const h1 = markdown.match(/^\s*#\s+(.+)$/m);
  if (h1) return h1[1].trim().slice(0, 80);
  const firstLine = markdown.trim().split(/\s+/).slice(0, 6).join(" ");
  return firstLine.slice(0, 80) || "Untitled document";
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

type AnyContentBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
};

function extractCitations(
  content: unknown,
  queries: Map<string, string>,
): { query: string; urls: string[] }[] {
  if (!Array.isArray(content)) return [];
  const out: { query: string; urls: string[] }[] = [];
  // First pass: pick up any queries we missed.
  for (const block of content as AnyContentBlock[]) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      const q = (block.input as { query?: string } | undefined)?.query;
      if (block.id && q) queries.set(block.id, q);
    }
  }
  for (const block of content as AnyContentBlock[]) {
    if (block.type !== "web_search_tool_result") continue;
    const query = block.tool_use_id ? (queries.get(block.tool_use_id) ?? "") : "";
    const items = Array.isArray(block.content) ? block.content : [];
    const urls = (items as Array<{ type?: string; url?: string }>)
      .filter(
        (b) => b.type === "web_search_result" && typeof b.url === "string",
      )
      .map((b) => b.url as string);
    if (urls.length > 0 || query) {
      out.push({ query, urls });
    }
  }
  return out;
}
