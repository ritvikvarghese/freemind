import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
  renderTableToMarkdown,
} from "@tiptap/extension-table";
import type { AnyExtension } from "@tiptap/core";
import { MathBlock } from "./MathBlock";
import { DocumentClipboard } from "./clipboard";

/**
 * GFM table cells can't hold a raw `|`, and the stock serializer doesn't escape
 * one, so a cell like "a | b" would split into two columns on reload. Escape
 * pipes in each cell's rendered text, and join a cell's paragraphs with a space
 * (a markdown cell is one line).
 */
const DocTable = Table.extend({
  renderMarkdown: (node, h) => {
    const helpers = Object.create(h) as typeof h;
    helpers.renderChildren = (...args: Parameters<typeof h.renderChildren>) =>
      h.renderChildren(...args).replace(/(?<!\\)\|/g, "\\|");
    return renderTableToMarkdown(node, helpers, { cellLineSeparator: " " });
  },
});

export function buildExtensions(opts: {
  placeholder?: string;
  slashSuggestion?: AnyExtension | null;
} = {}): AnyExtension[] {
  const exts: AnyExtension[] = [
    StarterKit.configure({
      // We provide our own Link via @tiptap/extension-link (configured below);
      // disable the StarterKit-bundled mark to avoid duplicate registration.
      link: false,
      // Underline ships separately too.
      underline: false,
    }),
    Markdown,
    Underline,
    Highlight,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Link.configure({
      openOnClick: true,
      autolink: true,
      HTMLAttributes: { rel: "noreferrer", target: "_blank" },
    }),
    Image.configure({
      inline: false,
      allowBase64: true,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Column widths can't be stored in a markdown table, so no resizing:
    // dragged widths would silently vanish on reload.
    DocTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    // Display equations only. InlineMath's `$...$` syntax would turn prose
    // like "$3,200 vs $2,963" into math.
    MathBlock,
    DocumentClipboard,
    Placeholder.configure({
      placeholder: opts.placeholder ?? "Write or press ‘/’ for commands…",
      emptyEditorClass: "is-editor-empty",
    }),
  ];
  if (opts.slashSuggestion) exts.push(opts.slashSuggestion);
  return exts;
}
