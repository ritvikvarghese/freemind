"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { type Folder } from "@/lib/storage/boards";
import { FolderSelect } from "@/components/folders/FolderSelect";

// New-canvas dialog: a name, the canvas's purpose ("what's this about", fed into
// every AI interaction on the canvas, see lib/agent/canvasContext.ts), and the
// folder it lands in (defaulting to the current canvas's folder). Context is
// optional; Enter in the name field or the Create button commits. Portaled to
// body so it floats above the canvas, over a light scrim (not a full fade).
export function NewCanvasDialog({
  folders,
  defaultFolderId,
  onCancel,
  onCreate,
}: {
  folders: Folder[];
  defaultFolderId: string | null;
  onCancel: () => void;
  onCreate: (name: string, context: string, folderId: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New canvas"
      onClick={onCancel}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto fixed inset-0 z-[700] grid place-items-center bg-black/30 px-6"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name, context, folderId);
        }}
        className="w-full max-w-md rounded-panel border border-hairline bg-elevated p-5 shadow-[var(--shadow-panel)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-medium tracking-tight text-text-primary">
            New canvas
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

        <label className="mb-1.5 block text-[12px] font-medium text-text-primary">
          Name
        </label>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Name your canvas"
          className="mb-4 w-full rounded-button border border-hairline bg-elevated px-3 py-2 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-hairline-hover transition-colors duration-100"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-text-primary">
          What&apos;s this canvas about?{" "}
          <span className="font-normal text-text-tertiary">optional</span>
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.currentTarget.value)}
          placeholder="Goals, the question you're chasing, who it's for."
          rows={3}
          className="w-full resize-y rounded-button border border-hairline bg-elevated px-3 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-tertiary outline-none focus:border-hairline-hover transition-colors duration-100"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">
          Fed to the AI on every chat and artifact in this canvas, so you do not
          have to restate it.
        </p>

        <label className="mb-1.5 mt-4 block text-[12px] font-medium text-text-primary">
          Folder
        </label>
        <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />

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
            className="h-8 rounded-button bg-accent px-3.5 text-[13px] font-medium text-on-accent transition-opacity duration-100 hover:opacity-90"
          >
            Create canvas
          </button>
        </div>
      </form>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return dialog;
  return createPortal(dialog, document.body);
}
