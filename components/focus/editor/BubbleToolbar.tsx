"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Code,
  Link as LinkIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  MessagesSquare,
  MessageSquarePlus,
} from "lucide-react";

type ContentProps = {
  editor: Editor;
  /** Optional: clicking the "Add to chat" button opens chat with the selection. */
  onGenerate?: (selectionText: string) => void;
  /** Optional: clicking the "Comment" button opens the comment composer. */
  onComment?: () => void;
  /** Show the heading (paragraph/H1-H3) menu. Off for canvas text shapes,
   *  where tldraw doesn't render headings. Defaults on (focus mode). */
  showHeadings?: boolean;
};

type Props = ContentProps;

/**
 * Selection toolbar for the focus-mode editor. Built directly on
 * `BubbleMenuPlugin` so it positions itself at the selection. The button row is
 * factored into `EditorToolbarContent` so it can be reused inside tldraw's own
 * contextual toolbar for canvas text shapes (which provides its own positioning,
 * avoiding the DOM-reparenting conflict the Tiptap plugin causes there).
 */
export function BubbleToolbar({ editor, onGenerate, onComment }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // The plugin toggles visibility/opacity (not display). Start hidden via the
    // same axis it uses so the menu doesn't briefly render at (0, 0) on mount.
    el.style.visibility = "hidden";
    el.style.opacity = "0";
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "0";
    const plugin = BubbleMenuPlugin({
      pluginKey: "canvas-ai-bubble-menu",
      editor,
      element: el,
      updateDelay: 100,
      shouldShow: ({ editor: ed, from, to }) => {
        if (from === to) return false;
        if (!ed.isEditable) return false;
        // Hide on image-only selection.
        const node = ed.state.doc.nodeAt(from);
        if (node && node.type.name === "image") return false;
        return true;
      },
      options: {
        // `fixed` so Floating UI's coords resolve against the viewport rather
        // than the nearest positioned ancestor (which would shift the menu
        // by the editor's offset from the page origin).
        strategy: "fixed",
        placement: "top",
        offset: 8,
      },
    });
    editor.registerPlugin(plugin);
    return () => {
      // On canvas, tldraw destroys its text editor when editing ends (which
      // unmounts this toolbar); unregistering on a destroyed editor throws.
      if (!editor.isDestroyed) editor.unregisterPlugin("canvas-ai-bubble-menu");
    };
  }, [editor]);

  return (
    <div
      ref={elRef}
      onPointerDown={(e) => e.stopPropagation()}
      className="z-50 rounded-button border border-hairline bg-elevated p-1 shadow-floating"
      style={{ boxShadow: "var(--shadow-floating)" }}
    >
      <EditorToolbarContent
        editor={editor}
        onGenerate={onGenerate}
        onComment={onComment}
      />
    </div>
  );
}

/**
 * The toolbar's button row (no positioning). Used by the focus-mode
 * BubbleToolbar and by the canvas text toolbar (inside tldraw's contextual
 * toolbar container).
 */
export function EditorToolbarContent({
  editor,
  onGenerate,
  onComment,
  showHeadings = true,
}: ContentProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const linkInputRef = useRef<HTMLInputElement | null>(null);

  const openLink = () => {
    const existing = editor.getAttributes("link")?.href as string | undefined;
    setLinkInput(existing ?? "");
    setLinkOpen(true);
  };

  useEffect(() => {
    if (linkOpen) {
      const id = requestAnimationFrame(() => linkInputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [linkOpen]);

  // The link editor must only open when the user clicks the link button, not
  // linger across selections. Reset it whenever the selection changes (a new
  // selection re-shows the toolbar's buttons); clicking the link button keeps
  // the selection, so it stays open then.
  useEffect(() => {
    const reset = () => setLinkOpen(false);
    editor.on("selectionUpdate", reset);
    return () => {
      editor.off("selectionUpdate", reset);
    };
  }, [editor]);

  const applyLink = () => {
    const href = linkInput.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  const setHeading = (level: 0 | 1 | 2 | 3) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level }).run();
    }
  };

  const activeHeading = (): 0 | 1 | 2 | 3 => {
    if (editor.isActive("heading", { level: 1 })) return 1;
    if (editor.isActive("heading", { level: 2 })) return 2;
    if (editor.isActive("heading", { level: 3 })) return 3;
    return 0;
  };

  return (
    <div
      className="flex items-center gap-0.5"
      // Prevent selection collapse when clicking toolbar buttons.
      onMouseDown={(e) => e.preventDefault()}
    >
      {linkOpen ? (
        <div className="flex items-center gap-1 px-1">
          <input
            ref={linkInputRef}
            type="url"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyLink();
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://…"
            className="w-56 rounded-button bg-app px-2 py-1 text-[12px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <button
            type="button"
            onClick={applyLink}
            className="rounded-button px-2 py-1 text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            Apply
          </button>
        </div>
      ) : (
        <>
          {showHeadings ? (
            <>
              <HeadingMenu
                current={activeHeading()}
                onSelect={(lvl) => setHeading(lvl)}
              />
              <Divider />
            </>
          ) : null}
          <BtnToggle
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Underline"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Highlight"
            active={editor.isActive("highlight")}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          >
            <Highlighter className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Inline code"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className="h-3.5 w-3.5" />
          </BtnToggle>
          <Divider />
          <BtnToggle
            label="Align left"
            active={editor.isActive({ textAlign: "left" })}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Align center"
            active={editor.isActive({ textAlign: "center" })}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Align right"
            active={editor.isActive({ textAlign: "right" })}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          >
            <AlignRight className="h-3.5 w-3.5" />
          </BtnToggle>
          <Divider />
          <BtnToggle
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-3.5 w-3.5" />
          </BtnToggle>
          <BtnToggle
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </BtnToggle>
          <Divider />
          <BtnToggle label="Link" active={editor.isActive("link")} onClick={openLink}>
            <LinkIcon className="h-3.5 w-3.5" />
          </BtnToggle>
          {onComment ? (
            <>
              <Divider />
              <BtnToggle label="Comment" active={false} onClick={onComment}>
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </BtnToggle>
            </>
          ) : null}
          {onGenerate ? (
            <>
              {onComment ? null : <Divider />}
              <BtnToggle
                label="Add to chat"
                active={false}
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  const selectionText = editor.state.doc.textBetween(from, to, " ");
                  onGenerate(selectionText);
                }}
              >
                <MessagesSquare className="h-3.5 w-3.5" />
              </BtnToggle>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-hairline" />;
}

function BtnToggle({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={
        "group/tt relative grid h-6 w-6 place-items-center rounded-button transition-colors duration-100 " +
        (active
          ? "bg-surface-hover text-text-primary"
          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
      }
    >
      {children}
      {/* Instant hover label (replaces the slow native title tooltip). */}
      <span className="pointer-events-none absolute left-1/2 top-full z-[80] mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-button border border-hairline bg-elevated px-2 py-1 text-[11px] font-medium text-text-secondary shadow-floating group-hover/tt:block">
        {label}
      </span>
    </button>
  );
}

function HeadingMenu({
  current,
  onSelect,
}: {
  current: 0 | 1 | 2 | 3;
  onSelect: (level: 0 | 1 | 2 | 3) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4 });
    }
    setOpen((o) => !o);
  };

  const choose = (level: 0 | 1 | 2 | 3) => {
    onSelect(level);
    setOpen(false);
  };

  const label =
    current === 1 ? "H1" : current === 2 ? "H2" : current === 3 ? "H3" : "Text";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="flex h-6 items-center gap-1 rounded-button px-2 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      >
        {label}
      </button>
      {/* Portaled + fixed so tldraw's contextual-toolbar container can't clip it. */}
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              onMouseDown={(e) => e.preventDefault()}
              style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 80 }}
              className="min-w-[120px] rounded-button border border-hairline bg-elevated p-1 shadow-floating"
            >
              <MenuItem icon={null} onClick={() => choose(0)}>Paragraph</MenuItem>
              <MenuItem icon={<Heading1 className="h-3.5 w-3.5" />} onClick={() => choose(1)}>Heading 1</MenuItem>
              <MenuItem icon={<Heading2 className="h-3.5 w-3.5" />} onClick={() => choose(2)}>Heading 2</MenuItem>
              <MenuItem icon={<Heading3 className="h-3.5 w-3.5" />} onClick={() => choose(3)}>Heading 3</MenuItem>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-button px-2 py-1 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
    >
      <span className="grid h-4 w-4 place-items-center text-text-tertiary">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}
