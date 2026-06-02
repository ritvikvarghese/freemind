import { parse as parsePartialJson } from "partial-json";
import type {
  ProposeEditInput,
  ProposeReplaceSectionInput,
} from "@/lib/storage/chatTypes";

export const PROPOSE_EDIT_TOOL = {
  name: "propose_edit",
  description:
    "Propose a precise, targeted edit to the document. Use this for any change " +
    "of one paragraph or smaller. The user reviews each proposal and explicitly " +
    "accepts or rejects it.",
  input_schema: {
    type: "object" as const,
    required: [
      "anchor_before",
      "old_text",
      "anchor_after",
      "new_text",
      "rationale",
    ],
    properties: {
      anchor_before: {
        type: "string",
        description:
          "20-40 chars immediately before old_text in the current doc. Used to disambiguate repeated text. Use empty string only if old_text starts at the document.",
      },
      old_text: {
        type: "string",
        description: "Exact substring of the current doc to replace.",
      },
      anchor_after: {
        type: "string",
        description:
          "20-40 chars immediately after old_text in the current doc. Empty if old_text ends the doc.",
      },
      new_text: {
        type: "string",
        description: "Replacement markdown. Pure markdown, no HTML except <u>.",
      },
      rationale: {
        type: "string",
        description: "One-sentence reason shown to the user.",
      },
    },
  },
} as const;

export const PROPOSE_REPLACE_SECTION_TOOL = {
  name: "propose_replace_section",
  description:
    "Propose a wholesale rewrite of a markdown section identified by its heading. " +
    "Use this when the change is larger than a paragraph.",
  input_schema: {
    type: "object" as const,
    required: ["heading", "new_markdown", "rationale"],
    properties: {
      heading: {
        type: "string",
        description:
          "Exact heading text including '##' / '###' prefix as it appears in the doc.",
      },
      new_markdown: {
        type: "string",
        description:
          "Replacement markdown for the entire section (heading + body until the next heading at the same or higher level).",
      },
      rationale: {
        type: "string",
        description: "One-sentence reason.",
      },
    },
  },
} as const;

export const CHAT_TOOLS = [PROPOSE_EDIT_TOOL, PROPOSE_REPLACE_SECTION_TOOL];

/**
 * Best-effort parse of a streaming tool_use partial JSON buffer. Returns the
 * `rationale` field if present so the UI can render it optimistically before
 * the block closes (per Anthropic streaming guidance: don't parse the whole
 * thing mid-stream, just peek at stable string fields).
 */
export function peekPartialRationale(partialJson: string): string | null {
  if (!partialJson) return null;
  try {
    const obj = parsePartialJson(partialJson) as
      | { rationale?: unknown }
      | null
      | undefined;
    if (obj && typeof obj.rationale === "string") return obj.rationale;
  } catch {
    return null;
  }
  return null;
}

export function parseProposeEdit(json: string): ProposeEditInput | null {
  try {
    const obj = JSON.parse(json) as Partial<ProposeEditInput>;
    if (
      typeof obj.old_text === "string" &&
      typeof obj.new_text === "string" &&
      typeof obj.rationale === "string"
    ) {
      return {
        anchor_before: obj.anchor_before ?? "",
        old_text: obj.old_text,
        anchor_after: obj.anchor_after ?? "",
        new_text: obj.new_text,
        rationale: obj.rationale,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseProposeReplaceSection(
  json: string,
): ProposeReplaceSectionInput | null {
  try {
    const obj = JSON.parse(json) as Partial<ProposeReplaceSectionInput>;
    if (
      typeof obj.heading === "string" &&
      typeof obj.new_markdown === "string" &&
      typeof obj.rationale === "string"
    ) {
      return {
        heading: obj.heading,
        new_markdown: obj.new_markdown,
        rationale: obj.rationale,
      };
    }
  } catch {
    return null;
  }
  return null;
}
