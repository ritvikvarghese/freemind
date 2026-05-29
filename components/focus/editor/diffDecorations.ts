"use client";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";
import type { Proposal } from "@/lib/storage/chatTypes";

const KEY = new PluginKey<{ proposals: Proposal[]; decos: DecorationSet }>(
  "canvas-ai-diff-decorations",
);

/**
 * Register a ProseMirror plugin that paints inline diff decorations for
 * pending propose_edit / propose_replace_section proposals. The plugin reads
 * proposals from a mutable ref so callers can update without rebuilding the
 * plugin (re-registration would reset cursor state).
 *
 * Resolution strategy: walk the doc's text content, find `old_text` (or the
 * heading line for section replaces) — the cheapest stable matching layer.
 * If the anchor triple is ambiguous in plain text we skip the decoration; the
 * application path uses the same logic and will mark the proposal stale.
 */
export function installDiffDecorationsPlugin(
  editor: Editor,
  getProposals: () => Proposal[],
): () => void {
  const plugin = new Plugin({
    key: KEY,
    state: {
      init() {
        return {
          proposals: getProposals(),
          decos: DecorationSet.empty,
        };
      },
      apply(_tr, value, _oldState, newState) {
        const proposals = getProposals();
        const decos = buildDecorations(newState.doc, proposals);
        return { proposals, decos };
      },
    },
    props: {
      decorations(state) {
        return KEY.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
  editor.registerPlugin(plugin);
  return () => {
    editor.unregisterPlugin(KEY);
  };
}

/**
 * Trigger a re-render of the decoration plugin. Dispatch an empty transaction
 * — the plugin's `apply` re-reads from the ref-style `getProposals` getter and
 * rebuilds its DecorationSet from the current doc + proposals snapshot.
 */
export function refreshDiffDecorations(editor: Editor): void {
  if (!editor.isEditable && editor.isDestroyed) return;
  const tr = editor.state.tr.setMeta("canvas-ai-diff-refresh", true);
  editor.view.dispatch(tr);
}

function buildDecorations(doc: PMNode, proposals: Proposal[]): DecorationSet {
  const ranges: Decoration[] = [];
  const docText = collectText(doc);
  const claimed: Array<[number, number]> = [];

  for (const p of proposals) {
    if (p.status === "accepted" || p.status === "rejected") continue;

    let match: { from: number; to: number; replacement: string } | null = null;
    if (p.kind === "propose_edit") {
      match = findPlainTextRange(
        docText.text,
        p.anchor_before,
        p.old_text,
        p.anchor_after,
      );
      if (match) match.replacement = p.new_text;
    } else {
      match = findHeadingRange(docText.text, p.heading);
      if (match) match.replacement = previewReplacementSection(p.new_markdown);
    }
    if (!match) continue;

    const pmFrom = mapTextOffsetToPos(docText, match.from);
    const pmTo = mapTextOffsetToPos(docText, match.to);
    if (pmFrom == null || pmTo == null) continue;
    if (claimed.some(([a, b]) => !(pmTo <= a || pmFrom >= b))) continue;
    claimed.push([pmFrom, pmTo]);

    ranges.push(
      Decoration.inline(pmFrom, pmTo, { class: "diff-del" }),
    );
    ranges.push(
      Decoration.widget(
        pmTo,
        () => {
          const el = document.createElement("span");
          el.className = "diff-ins";
          el.textContent = match!.replacement;
          return el;
        },
        { side: 1, key: `ins-${p.id}` },
      ),
    );
  }

  return DecorationSet.create(doc, ranges);
}

function previewReplacementSection(markdown: string): string {
  // Decoration widgets can't render block-level markdown safely inline; clip
  // to the first 200 chars + ellipsis for the visual diff. Acceptance still
  // applies the full replacement via the editor command.
  const trimmed = markdown.replace(/\s+/g, " ").trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
}

type DocText = {
  /** Flat text content of the doc, with PM positions mapped per character. */
  text: string;
  /** Map character-index → PM position. */
  positions: number[];
};

function collectText(doc: PMNode): DocText {
  let text = "";
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text ?? "";
      for (let i = 0; i < t.length; i++) {
        positions.push(pos + i);
      }
      text += t;
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      // Visual block boundary — no PM position maps to this newline. Use the
      // node's `pos` as a best-effort marker; mapTextOffsetToPos returns null
      // for indices outside the positions array.
      positions.push(pos);
      text += "\n";
    }
    return true;
  });
  return { text, positions };
}

function mapTextOffsetToPos(docText: DocText, idx: number): number | null {
  if (idx < 0) return null;
  if (idx < docText.positions.length) return docText.positions[idx];
  // End-of-text: PM end position is one past the last char.
  const last = docText.positions[docText.positions.length - 1];
  return last != null ? last + 1 : null;
}

function findPlainTextRange(
  text: string,
  anchorBefore: string,
  oldText: string,
  anchorAfter: string,
): { from: number; to: number; replacement: string } | null {
  if (!oldText) return null;
  const needle = anchorBefore + oldText + anchorAfter;
  const first = text.indexOf(needle);
  if (first < 0) {
    // Plain text content drops the markdown formatting; if the anchor triple
    // doesn't match, fall back to a unique-only search for old_text alone.
    const a = text.indexOf(oldText);
    const b = a >= 0 ? text.indexOf(oldText, a + 1) : -1;
    if (a >= 0 && b < 0) return { from: a, to: a + oldText.length, replacement: "" };
    return null;
  }
  if (text.indexOf(needle, first + 1) >= 0) return null;
  const from = first + anchorBefore.length;
  return { from, to: from + oldText.length, replacement: "" };
}

function findHeadingRange(
  text: string,
  heading: string,
): { from: number; to: number; replacement: string } | null {
  const headingText = heading.replace(/^#+\s+/, "").trim();
  if (!headingText) return null;
  const start = text.indexOf(headingText);
  if (start < 0) return null;
  // We can't easily know where the section ends in the plain-text projection,
  // so highlight just the heading line as a "this will be replaced" marker.
  // The full section is replaced on accept via `resolveSectionRange`.
  return { from: start, to: start + headingText.length, replacement: "" };
}
