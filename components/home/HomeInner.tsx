"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2, GripVertical } from "lucide-react";
import {
  createBoard,
  deleteBoard,
  renameBoard,
  reorderBoards,
  useBoards,
  type Board,
} from "@/lib/storage/boards";

// Home page body. Rendered via dynamic(() => ..., { ssr: false }) so the
// localStorage-backed board list reads safely on the client only — no SSR
// hydration dance.
export function HomeInner() {
  const boards = useBoards();
  const [title, setTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Board | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const board = createBoard(title);
    router.push(`/b/${board.id}`);
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = boards.map((b) => b.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    reorderBoards(ids);
  }

  return (
    <main className="mx-auto max-w-xl px-6 pt-24 pb-12">
      <div className="mb-10 text-center">
        <h1 className="text-[28px] tracking-tight font-medium text-text-primary">
          Freemind
        </h1>
        <p className="mt-1 text-[13px] text-text-tertiary">
          A canvas for the mind
        </p>
      </div>

      <form onSubmit={submit} className="mb-10">
        <input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Open a new canvas…"
          autoFocus
          className="w-full bg-elevated border border-hairline rounded-panel px-4 py-3 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-hairline-hover transition-colors duration-100"
        />
      </form>

      <div className="text-text-tertiary text-[11px] tracking-wider uppercase mb-3 px-3">
        Canvases
      </div>

      {boards.length === 0 ? (
        <div className="text-text-tertiary text-[13px] px-3 py-2">
          No canvases yet. Type a name above and press Enter.
        </div>
      ) : (
        <ul className="space-y-0.5">
          {boards.map((b) => (
            <BoardRow
              key={b.id}
              board={b}
              isDragging={draggingId === b.id}
              isDragOver={overId === b.id && draggingId !== b.id}
              onDragStart={() => setDraggingId(b.id)}
              onDragEnter={() => setOverId(b.id)}
              onDragEnd={() => {
                setDraggingId(null);
                setOverId(null);
              }}
              onDrop={() => handleDrop(b.id)}
              onRequestDelete={() => setPendingDelete(b)}
            />
          ))}
        </ul>
      )}

      {pendingDelete ? (
        <ConfirmDeleteDialog
          board={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteBoard(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      ) : null}
    </main>
  );
}

function ConfirmDeleteDialog({
  board,
  onCancel,
  onConfirm,
}: {
  board: Board;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
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
      aria-label="Confirm delete"
      onClick={onCancel}
      className="fixed inset-0 z-50 grid place-items-center bg-overlay px-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-panel border border-hairline bg-elevated p-5 shadow-[var(--shadow-panel)]"
      >
        <div className="text-[15px] font-medium tracking-tight text-text-primary">
          Delete this canvas?
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          You sure? &ldquo;{board.title}&rdquo; and everything on it will be
          permanently removed. This can&apos;t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-button px-3 text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="h-8 rounded-button bg-red-500/10 px-3 text-[13px] font-medium text-red-500 transition-colors duration-100 hover:bg-red-500/20"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return dialog;
  return createPortal(dialog, document.body);
}

function BoardRow({
  board,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onRequestDelete,
}: {
  board: Board;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRequestDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <RenameForm board={board} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li
      className="group"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div
        className={
          "flex items-center gap-1 px-1 rounded-button transition-colors duration-100 " +
          (isDragOver
            ? "bg-surface-hover ring-1 ring-accent/60"
            : "hover:bg-surface-hover")
        }
      >
        <span
          aria-hidden
          title="Drag to reorder"
          className="grid h-7 w-5 shrink-0 cursor-grab place-items-center text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <Link
          href={`/b/${board.id}`}
          draggable={false}
          className="flex-1 flex items-baseline gap-3 px-2 py-2 min-w-0"
        >
          <span className="flex-1 text-[14px] text-text-primary truncate">
            {board.title}
          </span>
          <span className="text-[11px] text-text-tertiary tabular-nums shrink-0">
            {formatCreatedAt(board.createdAt)}
          </span>
        </Link>
        <button
          type="button"
          aria-label={`Rename ${board.title}`}
          title="Rename"
          onClick={() => setEditing(true)}
          className="h-7 w-7 grid place-items-center rounded-button text-text-tertiary hover:text-text-primary hover:bg-surface-hover opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-100"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Delete ${board.title}`}
          title="Delete"
          onClick={onRequestDelete}
          className="h-7 w-7 grid place-items-center rounded-button text-text-tertiary hover:text-red-500 hover:bg-surface-hover opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-100"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}

// DD/MM/YY. Returns "" for the legacy seed (createdAt === 0) so it stays blank.
function formatCreatedAt(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function RenameForm({
  board,
  onDone,
}: {
  board: Board;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(board.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Select all on mount so typing replaces the existing title (Figma-style).
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function commit() {
    renameBoard(board.id, draft);
    onDone();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="px-1"
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        className="w-full bg-elevated border border-hairline-hover rounded-button px-3 py-2 text-[14px] text-text-primary outline-none"
      />
    </form>
  );
}
