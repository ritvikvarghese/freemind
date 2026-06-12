"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Single-field modal for naming a folder at creation. Shared by the home page
// and the in-canvas sidebar so both entry points behave identically. No
// subtitle or helper text by design: the only question is what to call it.
export function NameFolderDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canCreate = name.trim().length > 0;

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Name folder"
      onClick={onCancel}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto fixed inset-0 z-[700] grid place-items-center bg-black/30 px-6"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) onCreate(name.trim());
        }}
        className="w-full max-w-sm rounded-panel border border-hairline bg-elevated p-5 shadow-[var(--shadow-panel)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-medium tracking-tight text-text-primary">
            Name your folder
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Folder name"
          className="w-full rounded-button border border-hairline bg-elevated px-3 py-2 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-hairline-hover transition-colors duration-100"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-button px-3 text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canCreate}
            className="h-8 rounded-button bg-accent px-3.5 text-[13px] font-medium text-on-accent transition-opacity duration-100 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create folder
          </button>
        </div>
      </form>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return dialog;
  return createPortal(dialog, document.body);
}
