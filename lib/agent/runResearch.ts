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
import { logUsage } from "./cacheDebug";

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
  thinking?: { type: "adaptive"; display?: "summarized" };
  effort?: "low" | "medium" | "high";
} {
  if (mode === "deepsearch") {
    // Opus 4.7 is adaptive-thinking only (budget_tokens is removed and 400s),
    // so depth is set with effort, not a fixed budget. display:"summarized" is
    // required: Opus 4.7 omits thinking text by default, and the doc streams the
    // chain-of-thought from it, so without this the "Thinking" block renders empty.
    return {
      model: DEEP_MODEL,
      maxTokens: 32_000,
      webSearchMaxUses: 25,
      thinking: { type: "adaptive", display: "summarized" },
      effort: "high",
    };
  }
  if (mode === "deepsynth") {
    // Closed-corpus reasoning: adaptive thinking on, no web search. Sonnet 4.6
    // is the sweet spot, since Opus's web-agent edge doesn't help here. A generous
    // output ceiling so a long synthesis never truncates (the ceiling is a cap,
    // not a target — only spent if the doc actually runs long). Sonnet 4.6
    // returns summarized thinking by default, so no display flag needed.
    return {
      model: FREEFORM_MODEL,
      maxTokens: 20_000,
      webSearchMaxUses: 0,
      thinking: { type: "adaptive" },
    };
  }
  return {
    model: FREEFORM_MODEL,
    // Output ceiling (not a target). Generous so writing findings into the doc
    // doesn't truncate; Sonnet 4.6's real ceiling is far higher.
    maxTokens: 16_000,
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

  // Track web_search tool_use → query mapping by tool_use_id so we can pair
  // queries to their results when the result block arrives.
  const queryByToolUseId = new Map<string, string>();
  const sourcesUsed: { query: string; urls: string[] }[] = [];
  let firstTextSeen = false;
  // Once the run ends (done / error / abort) no buffered flush may land — a
  // late debounce timer would otherwise write onto an already-finalized doc.
  let ended = false;

  // Debounced appender for a streamed string prop on the doc. Both the markdown
  // and the extended-thinking trace stream through one of these, so the model's
  // chain-of-thought shows live (collapsible in the reader) rather than a silent
  // "thinking…" wait. `cancel()` drops a pending timer without writing.
  const appenders: { flushNow: () => void; cancel: () => void }[] = [];
  function streamAppender(
    apply: (
      props: DocumentNodeShape["props"],
      text: string,
    ) => Partial<DocumentNodeShape["props"]>,
  ) {
    let buffer = "";
    let pending: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      pending = null;
      if (ended || buffer.length === 0) return;
      const text = buffer;
      buffer = "";
      editor.run(() => {
        const shape = editor.getShape<DocumentNodeShape>(docShapeId);
        if (!shape) return;
        editor.updateShape<DocumentNodeShape>({
          id: docShapeId,
          type: "canvas-ai-document",
          props: apply(shape.props, text),
        });
      });
    };
    const cancel = () => {
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
    };
    const api = {
      push: (delta: string) => {
        buffer += delta;
      },
      schedule: () => {
        if (pending === null) pending = setTimeout(flush, FLUSH_INTERVAL_MS);
      },
      flushNow: () => {
        cancel();
        flush();
      },
      cancel,
    };
    appenders.push(api);
    return api;
  }

  // markdown flush also marks the doc "streaming"; thinking is content-only.
  const md = streamAppender((p, t) => ({
    markdown: p.markdown + t,
    status: "streaming",
  }));
  const think = streamAppender((p, t) => ({ thinking: p.thinking + t }));

  try {
    const cfg = paramsForMode(mode);
    const stream = client.messages.stream(
      {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        ...(cfg.thinking ? { thinking: cfg.thinking } : {}),
        ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
        // Cache the (large, per-mode) system prompt. Render order is tools ->
        // system -> messages, so this plus the source-prefix breakpoint in
        // buildContext lets a retry / same-config rerun reuse the whole prefix.
        system: [
          {
            type: "text",
            text: systemPromptFor(mode),
            // 5m TTL: research is one-shot or a fast retry, so the cheaper
            // 1.25x write (vs 2x for 1h) breaks even sooner. 1h only helps the
            // chat paths, where a human leaves gaps between turns.
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
        ],
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

    stream.on("thinking", (delta: string) => {
      think.push(delta);
      think.schedule();
    });

    stream.on("text", (delta: string) => {
      if (!firstTextSeen) {
        firstTextSeen = true;
        editor.updateShape<DocumentNodeShape>({
          id: docShapeId,
          type: "canvas-ai-document",
          props: { status: "streaming" },
        });
      }
      md.push(delta);
      // Flush on paragraph break for snappier UX on long generations.
      if (delta.includes("\n\n")) {
        md.flushNow();
      } else {
        md.schedule();
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
    logUsage(`research:${mode}`, final.usage);
    md.flushNow();
    think.flushNow();

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
    md.flushNow();
    if (err instanceof APIUserAbortError || controller.signal.aborted) {
      finalize(editor, docShapeId, { status: "stopped", errorMessage: "" });
      return;
    }
    finalize(editor, docShapeId, {
      status: "error",
      errorMessage: describeError(err),
    });
  } finally {
    // The run is over: forbid further flushes and cancel any armed timers so a
    // late delta can't write onto the finalized doc.
    ended = true;
    for (const a of appenders) a.cancel();
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
