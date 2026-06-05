"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { BLOCK_ITEMS, BlockMenuList, type BlockItem } from "./blockMenu";

type Target = {
  /** Top-level block element under the cursor. */
  el: HTMLElement;
  /** Y offset of the block's top relative to the editor wrapper. */
  y: number;
  /** First-line height of the block, used to vertically center the handle. */
  lineH: number;
};

type MenuState = {
  /** Document position at the start of the target block. */
  pos: number;
  /** Viewport rect of the handle button, used to anchor the popover. */
  anchor: DOMRect;
};

type Props = {
  editor: Editor;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
};

const MENU_EST_HEIGHT = 332;
/** Approx width of the block menu (min-w 248 + border), for outward placement. */
const MENU_WIDTH = 256;
/** How far left of the text (and right past it) the pointer can be while the
 *  handle still tracks — covers the gutter where the handle lives. */
const GUTTER_REACH_PX = 56;

/**
 * Notion-style left-gutter handle. A subtle two-dot pill appears next to
 * whichever block the pointer is aligned with; clicking it opens the shared
 * block menu anchored at that block — a discoverable alternative to typing "/".
 */
export function BlockHandle({ editor, wrapperRef }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const targetElRef = useRef<HTMLElement | null>(null);
  // Mirror of `menu !== null` for use inside event listeners without
  // re-subscribing them on every open/close.
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = menu !== null;
  }, [menu]);

  // Resolve the top-level block whose vertical span contains (or is nearest to)
  // the pointer's Y. Matching by Y keeps the handle anchored even while the
  // pointer hovers the handle itself out in the gutter.
  const blockAtY = useCallback(
    (clientY: number): HTMLElement | null => {
      const root = editor.view.dom;
      const children = Array.from(root.children) as HTMLElement[];
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      for (const el of children) {
        const r = el.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) return el;
        const dist = clientY < r.top ? r.top - clientY : clientY - r.bottom;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      return bestDist < 36 ? best : null;
    },
    [editor],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    // Track across the whole scroll surface (text + left gutter) so reaching
    // for the handle doesn't fire mouseleave on the narrow editor box.
    const scroller =
      (wrapper?.closest(".canvas-ai-focus-paper") as HTMLElement | null) ??
      wrapper;
    if (!wrapper || !scroller) return;

    const onMove = (e: MouseEvent) => {
      const wrapperRect = wrapper.getBoundingClientRect();
      // Ignore the far-right margin (comment chips, chat) — only the column
      // band plus its left gutter should surface the handle.
      const withinBand =
        e.clientX >= wrapperRect.left - GUTTER_REACH_PX &&
        e.clientX <= wrapperRect.right + 8;
      const el = withinBand ? blockAtY(e.clientY) : null;
      if (!el) {
        if (!menuOpenRef.current) {
          targetElRef.current = null;
          setTarget(null);
        }
        return;
      }
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      let lineH = parseFloat(cs.lineHeight);
      if (!lineH || Number.isNaN(lineH)) {
        lineH = parseFloat(cs.fontSize) * 1.4;
      }
      lineH = Math.min(lineH, r.height);
      targetElRef.current = el;
      setTarget({ el, y: r.top - wrapperRect.top, lineH });
    };

    const onLeave = () => {
      if (menuOpenRef.current) return;
      targetElRef.current = null;
      setTarget(null);
    };

    scroller.addEventListener("mousemove", onMove);
    scroller.addEventListener("mouseleave", onLeave);
    return () => {
      scroller.removeEventListener("mousemove", onMove);
      scroller.removeEventListener("mouseleave", onLeave);
    };
  }, [wrapperRef, blockAtY]);

  // Close the menu (and drop the handle) on scroll — positions would go stale.
  useEffect(() => {
    const scroller = wrapperRef.current?.closest(".canvas-ai-focus-paper");
    if (!scroller) return;
    const onScroll = () => {
      setMenu(null);
      setTarget(null);
      targetElRef.current = null;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [wrapperRef]);

  // Hide the handle the moment the user types — it's distracting while writing.
  // It reappears when the pointer next moves to a block (onMove above).
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = () => {
      if (menuOpenRef.current) return;
      targetElRef.current = null;
      setTarget(null);
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  const openMenu = useCallback(
    (anchor: DOMRect) => {
      const el = targetElRef.current;
      if (!el) return;
      let pos: number;
      try {
        pos = editor.view.posAtDOM(el, 0);
      } catch {
        return;
      }
      // Put the cursor in the target block so the chosen command transforms it.
      editor.chain().focus().setTextSelection(pos).run();
      setMenu({ pos, anchor });
    },
    [editor],
  );

  const runItem = useCallback(
    (item: BlockItem) => {
      setMenu(null);
      item.apply(editor);
    },
    [editor],
  );

  if (!target && !menu) return null;

  return (
    <>
      {target ? (
        <div
          className="pointer-events-none absolute left-0 top-0"
          style={{ transform: `translateY(${target.y}px)` }}
        >
          <button
            type="button"
            aria-label="Insert or change block"
            title="Insert or change block"
            onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect())}
            className="pointer-events-auto flex h-7 w-8 -translate-x-[calc(100%+8px)] items-center justify-center gap-[3px] rounded-xl bg-surface-hover text-text-tertiary transition-colors duration-100 hover:text-text-secondary"
            style={{ marginTop: target.lineH / 2 - 14 }}
          >
            <span className="h-[3px] w-[3px] rounded-full bg-current" aria-hidden />
            <span className="h-[3px] w-[3px] rounded-full bg-current" aria-hidden />
          </button>
        </div>
      ) : null}
      {menu ? (
        <HandleMenu
          anchor={menu.anchor}
          onSelect={runItem}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}

function HandleMenu({
  anchor,
  onSelect,
  onClose,
}: {
  anchor: DOMRect;
  onSelect: (item: BlockItem) => void;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Open OUTWARD into the left gutter, never over the text: pin the menu's
  // right edge just left of the handle and grow leftward, clamped to the
  // viewport. On a narrow window the menu just gets narrower (down to a floor)
  // instead of flipping back over the text. Flip up near the viewport bottom.
  const rightEdge = anchor.left - 6;
  const left = Math.max(8, rightEdge - MENU_WIDTH);
  const width = Math.max(180, rightEdge - left);
  const top =
    anchor.top + MENU_EST_HEIGHT > window.innerHeight
      ? Math.max(8, window.innerHeight - MENU_EST_HEIGHT - 8)
      : anchor.top;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % BLOCK_ITEMS.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(
          (i) => (i - 1 + BLOCK_ITEMS.length) % BLOCK_ITEMS.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const item = BLOCK_ITEMS[selectedIndex];
        if (item) onSelect(item);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [selectedIndex, onSelect, onClose]);

  return createPortal(
    <div ref={menuRef} className="fixed z-[70]" style={{ left, top, width }}>
      <BlockMenuList
        items={BLOCK_ITEMS}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        onHover={setSelectedIndex}
        fitWidth
      />
    </div>,
    document.body,
  );
}
