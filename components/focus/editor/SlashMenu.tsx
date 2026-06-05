"use client";

import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";
import { useImperativeHandle, useState, forwardRef } from "react";
import type { Editor, Range } from "@tiptap/core";
import {
  BLOCK_ITEMS,
  BlockMenuList,
  filterBlockItems,
  type BlockItem,
} from "./blockMenu";

type SlashMenuRef = { onKeyDown: (e: KeyboardEvent) => boolean };

const SlashMenuList = forwardRef<
  SlashMenuRef,
  {
    items: BlockItem[];
    command: (item: BlockItem) => void;
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

  return (
    <BlockMenuList
      items={items}
      selectedIndex={selectedIndex}
      onSelect={command}
      onHover={setSelectedIndex}
    />
  );
});

/**
 * Tiptap Extension that wires `@tiptap/suggestion` to render a slash-command
 * popover. Items are the shared `BLOCK_ITEMS`, also used by the left-gutter
 * BlockHandle so the two entry points stay in sync.
 */
export const SlashMenu = Extension.create<{
  suggestion: Partial<SuggestionOptions<BlockItem, BlockItem>>;
}>({
  name: "slashMenu",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: BlockItem;
        }) => {
          props.apply(editor, range);
        },
        items: ({ query }) => filterBlockItems(BLOCK_ITEMS, query),
        render: renderSlashSuggestion,
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

function renderSlashSuggestion() {
  let component: ReactRenderer<SlashMenuRef> | null = null;
  let popup: HTMLDivElement | null = null;

  function position(props: SuggestionProps<BlockItem, BlockItem>) {
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
    onStart: (props: SuggestionProps<BlockItem, BlockItem>) => {
      component = new ReactRenderer(SlashMenuList, {
        props: {
          items: props.items,
          command: (item: BlockItem) => props.command(item),
        },
        editor: props.editor,
      });
      popup = document.createElement("div");
      popup.style.zIndex = "60";
      popup.appendChild(component.element);
      document.body.appendChild(popup);
      position(props);
    },
    onUpdate: (props: SuggestionProps<BlockItem, BlockItem>) => {
      component?.updateProps({
        items: props.items,
        command: (item: BlockItem) => props.command(item),
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
