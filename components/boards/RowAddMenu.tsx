"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SquarePlus, FolderPlus, FilePlus } from "lucide-react";

const MENU_WIDTH = 168;

/**
 * The single "add" affordance on a folder row: one button that opens a small
 * menu directly beneath it offering "New folder" and "New canvas". Replaces the
 * two separate icon buttons those rows used to carry, which read as a pair of
 * near-identical rectangles at 14px.
 *
 * Portaled and fixed-positioned (like FolderSelect) so it can't be clipped by
 * the folder tree's overflow or the sidebar drawer. Flips above the trigger when
 * there isn't room below, and clamps to the viewport horizontally.
 */
export function RowAddMenu({
  folderName,
  onNewFolder,
  onNewCanvas,
  className,
}: {
  folderName: string;
  onNewFolder: () => void;
  onNewCanvas: () => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Two items plus the 1px border and 4px padding; enough to know whether
      // the menu fits under the trigger without measuring it first.
      const estHeight = 80;
      const below = r.bottom + 4;
      const top =
        below + estHeight > window.innerHeight ? r.top - estHeight - 4 : below;
      const left = Math.min(
        Math.max(8, r.left),
        Math.max(8, window.innerWidth - MENU_WIDTH - 8),
      );
      setPos({ left, top });
    }
    setOpen((o) => !o);
  };

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Add to ${folderName || "this folder"}`}
        title="Add to this folder"
        aria-haspopup="menu"
        aria-expanded={open}
        // The row itself is draggable and toggles on click; keep both out of it.
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={className}
        // Row action buttons fade in on hover. While the menu is open the
        // pointer has usually left the row, so pin the trigger visible or it
        // disappears out from under its own menu.
        style={open ? { opacity: 1 } : undefined}
      >
        <SquarePlus className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                width: MENU_WIDTH,
                zIndex: 800,
              }}
              className="rounded-button border border-hairline bg-elevated p-1 shadow-floating"
            >
              <MenuItem
                label="New folder"
                onClick={() => pick(onNewFolder)}
                icon={<FolderPlus className="h-3.5 w-3.5" aria-hidden />}
              />
              <MenuItem
                label="New canvas"
                onClick={() => pick(onNewCanvas)}
                icon={<FilePlus className="h-3.5 w-3.5" aria-hidden />}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex w-full items-center gap-2 rounded-button px-2 py-1.5 text-left text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
    >
      <span className="shrink-0 text-text-tertiary">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
