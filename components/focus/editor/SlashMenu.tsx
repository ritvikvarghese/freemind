"use client";

import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { useImperativeHandle, useState, forwardRef } from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  Image as ImageIcon,
} from "lucide-react";
import type { Editor, Range } from "@tiptap/core";

export type SlashItem = {
  title: string;
  description?: string;
  icon: React.ReactNode;
  keywords?: string[];
  command: (ctx: { editor: Editor; range: Range }) => void;
};

const DEFAULT_ITEMS: SlashItem[] = [
  {
    title: "Heading 1",
    description: "Top-level section title",
    icon: <Heading1 className="h-3.5 w-3.5" />,
    keywords: ["h1", "title", "heading"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Section heading",
    icon: <Heading2 className="h-3.5 w-3.5" />,
    keywords: ["h2", "heading"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Sub-section heading",
    icon: <Heading3 className="h-3.5 w-3.5" />,
    keywords: ["h3", "subheading"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet list",
    description: "Unordered list of items",
    icon: <List className="h-3.5 w-3.5" />,
    keywords: ["bullet", "ul", "list"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    icon: <ListOrdered className="h-3.5 w-3.5" />,
    keywords: ["ordered", "ol", "numbered", "list"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Task list",
    description: "Checklist with checkboxes",
    icon: <ListChecks className="h-3.5 w-3.5" />,
    keywords: ["todo", "task", "checkbox"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: <Quote className="h-3.5 w-3.5" />,
    keywords: ["blockquote", "quote"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    description: "Multi-line code",
    icon: <Code className="h-3.5 w-3.5" />,
    keywords: ["code", "pre", "fence"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: <Minus className="h-3.5 w-3.5" />,
    keywords: ["hr", "divider", "rule"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "Image",
    description: "Upload from your computer",
    icon: <ImageIcon className="h-3.5 w-3.5" />,
    keywords: ["image", "picture", "upload"],
    command: async ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const file = await pickImageFile();
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
    },
  },
];

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

type SlashMenuRef = { onKeyDown: (e: KeyboardEvent) => boolean };

const SlashMenuList = forwardRef<
  SlashMenuRef,
  {
    items: SlashItem[];
    command: (item: SlashItem) => void;
  }
>(function SlashMenuList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (e.key === "ArrowUp") {
        setSelectedIndex((i) =>
          (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1),
        );
        return true;
      }
      if (e.key === "Enter") {
        const item = items[selectedIndex];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="min-w-[220px] rounded-button border border-hairline bg-elevated p-2 text-[12px] text-text-tertiary shadow-floating">
        No matches
      </div>
    );
  }

  return (
    <div className="max-h-[260px] min-w-[240px] overflow-auto rounded-button border border-hairline bg-elevated p-1 shadow-floating">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            command(item);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
          className={
            "flex w-full items-center gap-2 rounded-button px-2 py-1.5 text-left text-[12px] transition-colors duration-75 " +
            (i === selectedIndex
              ? "bg-surface-hover text-text-primary"
              : "text-text-secondary")
          }
        >
          <span className="grid h-5 w-5 place-items-center text-text-tertiary">
            {item.icon}
          </span>
          <span className="flex-1">
            <span className="block font-medium">{item.title}</span>
            {item.description ? (
              <span className="block text-[11px] text-text-tertiary">
                {item.description}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
});

/**
 * Tiptap Extension that wires `@tiptap/suggestion` to render a slash-command
 * popover positioned via Floating UI's `computePosition`. Items defined here
 * are the v1 set; the extension supports overriding via options if we ever
 * need to surface context-specific commands.
 */
export const SlashMenu = Extension.create<{
  suggestion: Partial<SuggestionOptions<SlashItem, SlashItem>>;
}>({
  name: "slashMenu",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        items: ({ query }) => filterItems(DEFAULT_ITEMS, query),
        render: renderSlashSuggestion,
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

function filterItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    if (it.title.toLowerCase().includes(q)) return true;
    if (it.keywords?.some((k) => k.includes(q))) return true;
    return false;
  });
}

function renderSlashSuggestion() {
  let component: ReactRenderer<SlashMenuRef> | null = null;
  let popup: HTMLDivElement | null = null;

  function position(props: SuggestionProps<SlashItem, SlashItem>) {
    if (!popup) return;
    const rect = props.clientRect?.();
    if (!rect) {
      popup.style.display = "none";
      return;
    }
    popup.style.display = "";
    popup.style.position = "absolute";
    popup.style.top = `${window.scrollY + rect.bottom + 6}px`;
    popup.style.left = `${window.scrollX + rect.left}px`;
  }

  return {
    onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
      component = new ReactRenderer(SlashMenuList, {
        props: {
          items: props.items,
          command: (item: SlashItem) => props.command(item),
        },
        editor: props.editor,
      });
      popup = document.createElement("div");
      popup.style.zIndex = "60";
      popup.appendChild(component.element);
      document.body.appendChild(popup);
      position(props);
    },
    onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
      component?.updateProps({
        items: props.items,
        command: (item: SlashItem) => props.command(item),
      });
      position(props);
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === "Escape") {
        popup?.remove();
        popup = null;
        component?.destroy();
        component = null;
        return true;
      }
      return component?.ref?.onKeyDown(props.event) ?? false;
    },
    onExit: () => {
      popup?.remove();
      popup = null;
      component?.destroy();
      component = null;
    },
  };
}
