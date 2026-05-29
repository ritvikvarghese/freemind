"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  createBoard,
  deleteBoard,
  renameBoard,
  useBoards,
  type Board,
} from "@/lib/storage/boards";

// Home page body. Rendered via dynamic(() => ..., { ssr: false }) so the
// localStorage-backed board list reads safely on the client only — no SSR
// hydration dance.
export function HomeInner() {
  const boards = useBoards();
  const [title, setTitle] = useState("");
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const board = createBoard(title);
    router.push(`/b/${board.id}`);
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
            <BoardRow key={b.id} board={b} />
          ))}
        </ul>
      )}
    </main>
  );
}

function BoardRow({ board }: { board: Board }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <RenameForm board={board} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="group">
      <div className="flex items-center gap-1 px-1 rounded-button hover:bg-surface-hover transition-colors duration-100">
        <Link
          href={`/b/${board.id}`}
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
          onClick={() => {
            if (
              window.confirm(
                `Delete "${board.title}"? This will permanently remove the canvas and everything on it.`,
              )
            ) {
              deleteBoard(board.id);
            }
          }}
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
