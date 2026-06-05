"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Menu,
  X,
  Home,
  Plus,
  ChevronRight,
  Folder as FolderIcon,
  FileText,
} from "lucide-react";
import {
  useBoards,
  useFolders,
  createBoard,
  renameBoard,
  deleteBoard,
  type Board,
  type Folder,
} from "@/lib/storage/boards";
import { useBoardKey } from "./BoardContext";

type RowMenu = { x: number; y: number; board: Board };

/**
 * Collapsed-by-default left sidebar for navigating folders + canvases from
 * inside a board (Miro-style). A hamburger sits top-left; clicking it slides
 * out a drawer with the folder/canvas tree, the current canvas highlighted.
 * v1 is navigate + new-canvas only — folder management stays on the home page.
 */
export function BoardSidebar() {
  const boards = useBoards();
  const folders = useFolders();
  const boardKey = useBoardKey();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const currentBoard = boards.find((b) => b.persistenceKey === boardKey);
  const currentId = currentBoard?.id;

  const topFolders = folders.filter((f) => !f.parentId);
  const topBoards = boards.filter((b) => !b.folderId);
  const subfoldersOf = (fid: string) =>
    folders.filter((f) => f.parentId === fid);
  const boardsInFolder = (fid: string) =>
    boards.filter((b) => b.folderId === fid);

  // Open the drawer, revealing the folder chain that contains the current
  // canvas so it's visible without hunting.
  const openSidebar = useCallback(() => {
    const chain = new Set<string>();
    let fid = currentBoard?.folderId;
    let guard = 0; // 2-level cap, but loop defensively
    while (fid && guard++ < 8) {
      chain.add(fid);
      fid = folders.find((f) => f.id === fid)?.parentId;
    }
    if (chain.size) setExpanded((prev) => new Set([...prev, ...chain]));
    setOpen(true);
  }, [currentBoard?.folderId, folders]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleFolder = useCallback((fid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });
  }, []);

  const goTo = useCallback(
    (boardId: string) => {
      setOpen(false);
      router.push(`/b/${boardId}`);
    },
    [router],
  );

  const newCanvas = useCallback(() => {
    const board = createBoard("");
    setOpen(false);
    router.push(`/b/${board.id}`);
  }, [router]);

  const onRowContext = useCallback(
    (e: React.MouseEvent, board: Board) => {
      e.preventDefault();
      e.stopPropagation();
      setRowMenu({ x: e.clientX, y: e.clientY, board });
    },
    [],
  );

  const commitRename = useCallback((board: Board, name: string) => {
    renameBoard(board.id, name);
    setRenamingId(null);
  }, []);

  const deleteCanvas = useCallback(
    (board: Board) => {
      if (
        !window.confirm(
          `Delete "${board.title || "Untitled canvas"}"? This can't be undone.`,
        )
      )
        return;
      const wasCurrent = board.persistenceKey === boardKey;
      deleteBoard(board.id);
      if (wasCurrent) router.push("/");
    },
    [boardKey, router],
  );

  return (
    <>
      <div
        className="pointer-events-auto fixed left-4 top-4 z-30 flex items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <button
          type="button"
          onClick={openSidebar}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="grid h-9 w-9 place-items-center rounded-panel border border-hairline bg-elevated text-text-secondary shadow-[var(--shadow-panel)] transition-colors duration-100 hover:text-text-primary"
        >
          <Menu className="h-4 w-4" aria-hidden />
        </button>
        {currentBoard ? (
          <div className="max-w-[220px] truncate rounded-panel border border-hairline bg-elevated px-3 py-2 text-[13px] text-text-secondary shadow-[var(--shadow-panel)]">
            {currentBoard.title || "Untitled canvas"}
          </div>
        ) : null}
      </div>

      {open ? (
        <>
          <div
            className="pointer-events-auto fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
            aria-hidden
          />
          <aside
            className="pointer-events-auto fixed left-0 top-0 z-40 flex h-full w-[300px] flex-col border-r border-hairline bg-elevated shadow-[var(--shadow-floating)]"
            aria-label="Canvas navigation"
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
              <Link
                href="/"
                title="All canvases (home)"
                className="flex items-center gap-2 rounded-button px-1.5 py-1 text-[13px] font-medium text-text-primary transition-colors duration-100 hover:bg-surface-hover"
              >
                <Home className="h-4 w-4 text-text-secondary" aria-hidden />
                Home
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close sidebar"
                className="grid h-7 w-7 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <button
              type="button"
              onClick={newCanvas}
              className="mx-3 mt-3 flex items-center gap-2 rounded-button border border-hairline px-2.5 py-2 text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New canvas
            </button>

            <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
              {topFolders.map((f) => (
                <FolderNode
                  key={f.id}
                  folder={f}
                  depth={0}
                  expanded={expanded}
                  currentId={currentId}
                  renamingId={renamingId}
                  onToggle={toggleFolder}
                  onSelect={goTo}
                  onContext={onRowContext}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                  subfoldersOf={subfoldersOf}
                  boardsInFolder={boardsInFolder}
                />
              ))}
              {topBoards.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  depth={0}
                  current={b.id === currentId}
                  renaming={renamingId === b.id}
                  onSelect={goTo}
                  onContext={onRowContext}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                />
              ))}
              {topFolders.length === 0 && topBoards.length === 0 ? (
                <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
                  No canvases yet.
                </div>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}

      {rowMenu ? (
        <RowContextMenu
          menu={rowMenu}
          onClose={() => setRowMenu(null)}
          onOpenNewTab={(b) =>
            window.open(`/b/${b.id}`, "_blank", "noopener,noreferrer")
          }
          onRename={(b) => setRenamingId(b.id)}
          onDelete={deleteCanvas}
        />
      ) : null}
    </>
  );
}

function RowContextMenu({
  menu,
  onClose,
  onOpenNewTab,
  onRename,
  onDelete,
}: {
  menu: RowMenu;
  onClose: () => void;
  onOpenNewTab: (b: Board) => void;
  onRename: (b: Board) => void;
  onDelete: (b: Board) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 196);
  const top = Math.min(menu.y, window.innerHeight - 132);

  const item =
    "block w-full rounded-button px-2.5 py-1.5 text-left text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary";

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[70] min-w-[180px] rounded-panel border border-hairline bg-elevated p-1 shadow-[var(--shadow-floating)]"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={item}
        onClick={() => {
          onOpenNewTab(menu.board);
          onClose();
        }}
      >
        Open in new tab
      </button>
      <button
        type="button"
        className={item}
        onClick={() => {
          onRename(menu.board);
          onClose();
        }}
      >
        Rename
      </button>
      <div className="my-1 h-px bg-hairline" />
      <button
        type="button"
        className="block w-full rounded-button px-2.5 py-1.5 text-left text-[13px] text-[var(--color-error)] transition-colors duration-100 hover:bg-surface-hover"
        onClick={() => {
          onDelete(menu.board);
          onClose();
        }}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}

function FolderNode({
  folder,
  depth,
  expanded,
  currentId,
  renamingId,
  onToggle,
  onSelect,
  onContext,
  onCommitRename,
  onCancelRename,
  subfoldersOf,
  boardsInFolder,
}: {
  folder: Folder;
  depth: number;
  expanded: Set<string>;
  currentId: string | undefined;
  renamingId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContext: (e: React.MouseEvent, board: Board) => void;
  onCommitRename: (board: Board, name: string) => void;
  onCancelRename: () => void;
  subfoldersOf: (id: string) => Folder[];
  boardsInFolder: (id: string) => Board[];
}) {
  const isOpen = expanded.has(folder.id);
  const subs = subfoldersOf(folder.id);
  const fboards = boardsInFolder(folder.id);

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(folder.id)}
        className="flex w-full items-center gap-1.5 rounded-button py-1.5 pr-2 text-left text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-100"
          style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
          aria-hidden
        />
        <FolderIcon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        <span className="truncate">{folder.name || "Untitled folder"}</span>
      </button>
      {isOpen ? (
        <>
          {subs.map((sf) => (
            <FolderNode
              key={sf.id}
              folder={sf}
              depth={depth + 1}
              expanded={expanded}
              currentId={currentId}
              renamingId={renamingId}
              onToggle={onToggle}
              onSelect={onSelect}
              onContext={onContext}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              subfoldersOf={subfoldersOf}
              boardsInFolder={boardsInFolder}
            />
          ))}
          {fboards.map((b) => (
            <BoardRow
              key={b.id}
              board={b}
              depth={depth + 1}
              current={b.id === currentId}
              renaming={renamingId === b.id}
              onSelect={onSelect}
              onContext={onContext}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function BoardRow({
  board,
  depth,
  current,
  renaming,
  onSelect,
  onContext,
  onCommitRename,
  onCancelRename,
}: {
  board: Board;
  depth: number;
  current: boolean;
  renaming: boolean;
  onSelect: (id: string) => void;
  onContext: (e: React.MouseEvent, board: Board) => void;
  onCommitRename: (board: Board, name: string) => void;
  onCancelRename: () => void;
}) {
  const padLeft = 8 + depth * 14 + 18;

  if (renaming) {
    return (
      <div
        className="flex w-full items-center gap-1.5 rounded-button py-1.5 pr-2"
        style={{ paddingLeft: padLeft }}
      >
        <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        <input
          autoFocus
          defaultValue={board.title}
          onBlur={(e) => onCommitRename(board, e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitRename(board, e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancelRename();
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(board.id)}
      onContextMenu={(e) => onContext(e, board)}
      aria-current={current ? "page" : undefined}
      className={
        "flex w-full items-center gap-1.5 rounded-button py-1.5 pr-2 text-left text-[13px] transition-colors duration-100 " +
        (current
          ? "bg-surface-hover text-text-primary"
          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
      }
      style={{ paddingLeft: padLeft }}
    >
      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
      <span className="truncate">{board.title || "Untitled canvas"}</span>
    </button>
  );
}
