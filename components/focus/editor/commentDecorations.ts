"use client";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";
import type { Comment } from "@/lib/storage/commentTypes";

const KEY = new PluginKey<{ decos: DecorationSet }>(
  "canvas-ai-comment-decorations",
);

export type CommentResolution = {
  comment: Comment;
  /** PM positions of the highlighted span, or null for orphaned comments. */
  range: { from: number; to: number } | null;
};

/**
 * Highlight every commented span. Clicks on a highlight bubble up via a
 * standard DOM event from the wrapping span (`data-comment-id`), so the
 * orchestrating React layer can listen with one event handler at the editor
 * root rather than wiring per-decoration callbacks.
 */
export function installCommentDecorationsPlugin(
  editor: Editor,
  getComments: () => Comment[],
): () => void {
  const plugin = new Plugin({
    key: KEY,
    state: {
      init(_, state) {
        return { decos: buildDecos(state.doc, getComments()) };
      },
      apply(_tr, _value, _oldState, newState) {
        return { decos: buildDecos(newState.doc, getComments()) };
      },
    },
    props: {
      decorations(state) {
        return KEY.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
  editor.registerPlugin(plugin);
  return () => editor.unregisterPlugin(KEY);
}

export function refreshCommentDecorations(editor: Editor): void {
  if (editor.isDestroyed) return;
  const tr = editor.state.tr.setMeta("canvas-ai-comment-refresh", true);
  editor.view.dispatch(tr);
}

/**
 * Resolve every comment against the current doc. Returns the comment + range
 * (or null when orphaned). Callers use this for both the decoration plugin
 * input and the sidebar list.
 */
export function resolveComments(
  editor: Editor | null,
  comments: Comment[],
): CommentResolution[] {
  if (!editor) return comments.map((c) => ({ comment: c, range: null }));
  const docText = collectText(editor.state.doc);
  return comments.map((c) => {
    if (c.resolved) return { comment: c, range: null };
    const m = findRange(
      docText.text,
      c.anchor_before,
      c.anchor_text,
      c.anchor_after,
    );
    if (!m) return { comment: c, range: null };
    const from = mapTextToPos(docText, m.from);
    const to = mapTextToPos(docText, m.to);
    if (from == null || to == null) return { comment: c, range: null };
    return { comment: c, range: { from, to } };
  });
}

function buildDecos(doc: PMNode, comments: Comment[]): DecorationSet {
  const docText = collectText(doc);
  const decos: Decoration[] = [];
  for (const c of comments) {
    if (c.resolved) continue;
    const m = findRange(
      docText.text,
      c.anchor_before,
      c.anchor_text,
      c.anchor_after,
    );
    if (!m) continue;
    const from = mapTextToPos(docText, m.from);
    const to = mapTextToPos(docText, m.to);
    if (from == null || to == null) continue;
    decos.push(
      Decoration.inline(from, to, {
        class: "comment-highlight",
        "data-comment-id": c.id,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

type DocText = { text: string; positions: number[] };

function collectText(doc: PMNode): DocText {
  let text = "";
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text ?? "";
      for (let i = 0; i < t.length; i++) positions.push(pos + i);
      text += t;
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      positions.push(pos);
      text += "\n";
    }
    return true;
  });
  return { text, positions };
}

function mapTextToPos(docText: DocText, idx: number): number | null {
  if (idx < 0) return null;
  if (idx < docText.positions.length) return docText.positions[idx];
  const last = docText.positions[docText.positions.length - 1];
  return last != null ? last + 1 : null;
}

function findRange(
  text: string,
  before: string,
  middle: string,
  after: string,
): { from: number; to: number } | null {
  if (!middle) return null;
  const needle = before + middle + after;
  const first = text.indexOf(needle);
  if (first < 0) {
    const a = text.indexOf(middle);
    const b = a >= 0 ? text.indexOf(middle, a + 1) : -1;
    if (a >= 0 && b < 0) return { from: a, to: a + middle.length };
    return null;
  }
  if (text.indexOf(needle, first + 1) >= 0) return null;
  const from = first + before.length;
  return { from, to: from + middle.length };
}

/**
 * Capture an anchor triple from the current selection. Width of the before/
 * after windows is 30 chars by default — wide enough to disambiguate, short
 * enough to survive nearby edits.
 *
 * Uses PM's `textBetween` (with "\n" as the block separator, matching the
 * format `collectText` produces) so the captured text is always exactly the
 * selected range, never accidentally extending past it. The earlier approach
 * used `positions.indexOf` and silently fell back to the end of the doc when
 * the selection endpoint landed on a non-text PM position (block boundary),
 * which made selections include every line below.
 */
export function captureAnchorAtSelection(
  editor: Editor,
  windowWidth = 30,
): { anchor_before: string; anchor_text: string; anchor_after: string } | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  const doc = editor.state.doc;
  const docSize = doc.content.size;
  const middle = doc.textBetween(from, to, "\n");
  if (!middle.trim()) return null;
  const before = doc.textBetween(Math.max(0, from - windowWidth * 2), from, "\n");
  const after = doc.textBetween(to, Math.min(docSize, to + windowWidth * 2), "\n");
  return {
    anchor_before: before.slice(-windowWidth),
    anchor_text: middle,
    anchor_after: after.slice(0, windowWidth),
  };
}
