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
import type { AnyExtension } from "@tiptap/core";

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
    Placeholder.configure({
      placeholder: opts.placeholder ?? "Write or press ‘/’ for commands…",
      emptyEditorClass: "is-editor-empty",
    }),
  ];
  if (opts.slashSuggestion) exts.push(opts.slashSuggestion);
  return exts;
}
