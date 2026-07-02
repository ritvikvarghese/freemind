"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder as FolderIcon, ChevronDown, Check } from "lucide-react";
import { type Folder } from "@/lib/storage/boards";

type Option = { id: string | null; label: string; depth: number };

/**
 * Compact folder picker for choosing where a new canvas lands. Lists "No folder"
 * plus every folder, with subfolders indented under their parent (nesting is
 * capped at two levels). Modeled on the toolbar's FontMenu: a button that opens
 * a portaled, fixed-position menu so it can't be clipped by a dialog's overflow.
 */
export function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: Folder[];
  value: string | null;
  onChange: (folderId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // "No folder" first, then each top-level folder followed by its subfolders.
  const options: Option[] = [{ id: null, label: "No folder", depth: 0 }];
  for (const top of folders.filter((f) => !f.parentId)) {
    options.push({ id: top.id, label: top.name || "Untitled folder", depth: 0 });
    for (const sub of folders.filter((f) => f.parentId === top.id)) {
      options.push({
        id: sub.id,
        label: sub.name || "Untitled folder",
        depth: 1,
      });
    }
  }

  const current = options.find((o) => o.id === value) ?? options[0];

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
      setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    setOpen((o) => !o);
  };

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-button border border-hairline bg-elevated px-3 py-2 text-left text-[14px] text-text-primary outline-none transition-colors duration-100 hover:border-hairline-hover focus:border-hairline-hover"
      >
        <FolderIcon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        <span className="flex-1 truncate">{current.label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                width: pos.width,
                zIndex: 800,
              }}
              className="max-h-64 overflow-auto rounded-button border border-hairline bg-elevated p-1 shadow-floating"
            >
              {options.map((opt) => (
                <button
                  key={opt.id ?? "__none__"}
                  type="button"
                  role="option"
                  aria-selected={opt.id === value}
                  // Keep focus on the field that opened us so a host form that
                  // collapses on blur (the home composer) stays open through the
                  // pick.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(opt.id)}
                  style={{ paddingLeft: 8 + opt.depth * 16 }}
                  className="flex w-full items-center gap-2 rounded-button py-1.5 pr-2 text-left text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
                >
                  <FolderIcon
                    className={
                      "h-3.5 w-3.5 shrink-0 " +
                      (opt.id === null ? "text-text-tertiary/50" : "text-text-tertiary")
                    }
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.id === value ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
