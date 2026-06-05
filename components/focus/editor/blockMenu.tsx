"use client";

import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Code2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  Image as ImageIcon,
} from "lucide-react";
import type { Editor, Range } from "@tiptap/core";

/**
 * A single block command. `apply` transforms the document: when invoked from
 * the slash menu it receives the `/query` range to delete first; when invoked
 * from the left-gutter handle it receives no range and just transforms the
 * current block. `shortcut` is the markdown input-rule hint shown on the right
 * (e.g. typing "# " already produces a Heading 1 via StarterKit input rules),
 * so it's a truthful discoverability cue, not a fake keybinding.
 */
export type BlockItem = {
  title: string;
  description?: string;
  icon: React.ReactNode;
  keywords?: string[];
  /** Markdown hint rendered right-aligned (e.g. "#", "- ", "```"). */
  shortcut?: string;
  /** Render a thin separator above this item to group related commands. */
  groupStart?: boolean;
  apply: (editor: Editor, range?: Range) => void;
};

/** Build a chain that optionally deletes the slash range before transforming. */
function chain(editor: Editor, range?: Range) {
  const c = editor.chain().focus();
  return range ? c.deleteRange(range) : c;
}

/**
 * Inline-format chain: select the whole current text block first so the mark
 * toggles across the entire block (the gutter handle gives us a collapsed
 * cursor, not a range). Used by the Bold/Italic/etc. items.
 */
function formatChain(editor: Editor, range?: Range) {
  const c = chain(editor, range);
  const { $from } = editor.state.selection;
  return c.setTextSelection({ from: $from.start(), to: $from.end() });
}

export const BLOCK_ITEMS: BlockItem[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    icon: <Type className="h-3.5 w-3.5" />,
    keywords: ["text", "paragraph", "body", "normal"],
    apply: (editor, range) => chain(editor, range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Top-level section title",
    icon: <Heading1 className="h-3.5 w-3.5" />,
    keywords: ["h1", "title", "heading"],
    shortcut: "#",
    apply: (editor, range) =>
      chain(editor, range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Section heading",
    icon: <Heading2 className="h-3.5 w-3.5" />,
    keywords: ["h2", "heading"],
    shortcut: "##",
    apply: (editor, range) =>
      chain(editor, range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Sub-section heading",
    icon: <Heading3 className="h-3.5 w-3.5" />,
    keywords: ["h3", "subheading"],
    shortcut: "###",
    apply: (editor, range) =>
      chain(editor, range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bold",
    description: "Make the block bold",
    icon: <Bold className="h-3.5 w-3.5" />,
    keywords: ["bold", "strong", "format"],
    shortcut: "**",
    groupStart: true,
    apply: (editor, range) => formatChain(editor, range).toggleBold().run(),
  },
  {
    title: "Italic",
    description: "Make the block italic",
    icon: <Italic className="h-3.5 w-3.5" />,
    keywords: ["italic", "emphasis", "format"],
    shortcut: "*",
    apply: (editor, range) => formatChain(editor, range).toggleItalic().run(),
  },
  {
    title: "Strikethrough",
    description: "Cross out the block",
    icon: <Strikethrough className="h-3.5 w-3.5" />,
    keywords: ["strike", "strikethrough", "format"],
    shortcut: "~~",
    apply: (editor, range) => formatChain(editor, range).toggleStrike().run(),
  },
  {
    title: "Inline code",
    description: "Format the block as code",
    icon: <Code2 className="h-3.5 w-3.5" />,
    keywords: ["code", "inline", "mono", "format"],
    shortcut: "`",
    apply: (editor, range) => formatChain(editor, range).toggleCode().run(),
  },
  {
    title: "Bullet list",
    description: "Unordered list of items",
    icon: <List className="h-3.5 w-3.5" />,
    keywords: ["bullet", "ul", "list"],
    shortcut: "-",
    groupStart: true,
    apply: (editor, range) => chain(editor, range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    icon: <ListOrdered className="h-3.5 w-3.5" />,
    keywords: ["ordered", "ol", "numbered", "list"],
    shortcut: "1.",
    apply: (editor, range) => chain(editor, range).toggleOrderedList().run(),
  },
  {
    title: "Task list",
    description: "Checklist with checkboxes",
    icon: <ListChecks className="h-3.5 w-3.5" />,
    keywords: ["todo", "task", "checkbox"],
    shortcut: "[ ]",
    apply: (editor, range) => chain(editor, range).toggleTaskList().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: <Quote className="h-3.5 w-3.5" />,
    keywords: ["blockquote", "quote"],
    shortcut: ">",
    groupStart: true,
    apply: (editor, range) => chain(editor, range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    description: "Multi-line code",
    icon: <Code className="h-3.5 w-3.5" />,
    keywords: ["code", "pre", "fence"],
    shortcut: "```",
    apply: (editor, range) => chain(editor, range).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: <Minus className="h-3.5 w-3.5" />,
    keywords: ["hr", "divider", "rule"],
    shortcut: "---",
    apply: (editor, range) => chain(editor, range).setHorizontalRule().run(),
  },
  {
    title: "Image",
    description: "Upload from your computer",
    icon: <ImageIcon className="h-3.5 w-3.5" />,
    keywords: ["image", "picture", "upload"],
    apply: async (editor, range) => {
      chain(editor, range).run();
      const file = await pickImageFile();
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
    },
  },
];

export function filterBlockItems(items: BlockItem[], query: string): BlockItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    if (it.title.toLowerCase().includes(q)) return true;
    if (it.keywords?.some((k) => k.includes(q))) return true;
    return false;
  });
}

/**
 * Restyled, presentational block-command list shared by the slash popover and
 * the left-gutter handle menu. Keyboard state lives in the consumer; this just
 * renders rows and reports hover/click.
 */
export function BlockMenuList({
  items,
  selectedIndex,
  onSelect,
  onHover,
  emptyLabel = "No matches",
  fitWidth = false,
}: {
  items: BlockItem[];
  selectedIndex: number;
  onSelect: (item: BlockItem) => void;
  onHover: (index: number) => void;
  emptyLabel?: string;
  /** Fill the parent's width (set by an outward-positioned handle) instead of
   *  imposing a min-width. The slash popover leaves this off. */
  fitWidth?: boolean;
}) {
  const widthClass = fitWidth ? "w-full" : "min-w-[248px]";
  if (items.length === 0) {
    return (
      <div className="min-w-[240px] rounded-button border border-hairline bg-elevated p-2 text-[12px] text-text-tertiary shadow-floating">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className={`max-h-[320px] ${widthClass} overflow-auto rounded-button border border-hairline bg-elevated p-1 shadow-floating`}
    >
      {items.map((item, i) => (
        <div key={item.title}>
          {/* Only show group separators in the unfiltered (full) list. */}
          {item.groupStart && i !== 0 && items.length === BLOCK_ITEMS.length ? (
            <div className="my-1 h-px bg-hairline" aria-hidden />
          ) : null}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(i)}
            className={
              "flex w-full items-center gap-2.5 rounded-button px-2 py-1.5 text-left text-[12px] transition-colors duration-75 " +
              (i === selectedIndex
                ? "bg-surface-hover text-text-primary"
                : "text-text-secondary")
            }
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center text-text-tertiary">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.title}</span>
              {item.description ? (
                <span className="block truncate text-[11px] text-text-tertiary">
                  {item.description}
                </span>
              ) : null}
            </span>
            {item.shortcut ? (
              <span className="ml-2 shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] leading-none text-text-tertiary">
                {item.shortcut}
              </span>
            ) : null}
          </button>
        </div>
      ))}
    </div>
  );
}

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0] ?? null;
      resolve(f);
    };
    input.click();
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
