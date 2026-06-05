"use client";

import { useCallback, useEffect, useState } from "react";
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
  Pencil,
  Trash2,
  GripVertical,
  FolderPlus,
  ExternalLink,
} from "lucide-react";
import {
  useBoards,
  useFolders,
  createBoard,
  renameBoard,
  deleteBoard,
  reorderBoards,
  createFolder,
  renameFolder,
  deleteFolder,
  moveBoardToFolder,
  placeFolderBefore,
  moveFolderToParent,
  type Board,
  type Folder,
} from "@/lib/storage/boards";
import { useBoardKey } from "./BoardContext";
import { useFocusShapeId } from "@/lib/focus/openFocus";

// Drag-and-drop context shared by the sidebar and its (recursive) folder rows.
// Mirrors the home page (components/home/HomeInner.tsx) so the two stay in sync:
// two drag kinds coexist (a board or a folder); handlers branch on which is set.
type SidebarDnd = {
  draggingId: string | null; // board being dragged
  draggingFolderId: string | null; // folder being dragged
  draggingFolderHasChildren: boolean; // dragged folder has subfolders (2-level cap)
  overId: string | null; // board hovered (reorder target)
  overFolderId: string | null; // folder hovered by a dragged board (drop-in)
  overFolderRowId: string | null; // folder hovered by a dragged folder
  // "before" = reorder above the hovered folder (top edge); "inside" = nest
  // within it (middle).
  folderDropMode: "before" | "inside" | null;
  currentId: string | undefined;
  expanded: Set<string>;
  renamingBoardId: string | null;
  renamingFolderId: string | null;
  onToggle: (id: string) => void;
  // boards
  onBoardDragStart: (id: string) => void;
  onBoardDragEnter: (id: string) => void;
  onBoardReorder: (id: string) => void;
  onBoardDropInFolder: (folderId: string) => void;
  onBoardDragEnterFolder: (folderId: string) => void;
  onClearDrag: () => void;
  onSelect: (id: string) => void;
  onOpenNewTab: (id: string) => void;
  onRenameBoard: (id: string | null) => void;
  onCommitBoardRename: (board: Board, name: string) => void;
  onDeleteBoard: (board: Board) => void;
  // folders
  onFolderDragStart: (id: string) => void;
  onFolderDragOverRow: (id: string, mode: "before" | "inside") => void;
  onFolderDrop: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
  onRenameFolder: (id: string | null) => void;
  onCommitFolderRename: (folder: Folder, name: string) => void;
  onDeleteFolder: (folder: Folder) => void;
  // data lookups (for recursion)
  folderBoards: (fid: string) => Board[];
  subfoldersOf: (fid: string) => Folder[];
};

/**
 * Collapsed-by-default left sidebar for navigating folders + canvases from
 * inside a board (Miro-style). A hamburger sits top-left; clicking it slides
 * out a drawer with the folder/canvas tree, the current canvas highlighted.
 *
 * Full home-page parity: drag to reorder canvases and folders, drag a canvas
 * into/out of a folder, rename/delete both, and create subfolders. Actions are
 * hover buttons (not a right-click menu — the canvas eats contextmenu events).
 */
export function BoardSidebar() {
  const boards = useBoards();
  const folders = useFolders();
  const boardKey = useBoardKey();
  const router = useRouter();
  // The sidebar now renders OUTSIDE the tldraw container (so its native DnD and
  // right-clicks aren't hijacked by the canvas), which also puts it above the
  // full-screen FocusMode (fixed inset-0 inside the container). Hide it while
  // focus mode is open so it doesn't float over the focused document.
  const focusShapeId = useFocusShapeId();

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);
  const [overFolderRowId, setOverFolderRowId] = useState<string | null>(null);
  const [folderDropMode, setFolderDropMode] = useState<
    "before" | "inside" | null
  >(null);
  const [overHome, setOverHome] = useState(false);

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

  const clearDrag = useCallback(() => {
    setDraggingId(null);
    setDraggingFolderId(null);
    setOverId(null);
    setOverFolderId(null);
    setOverFolderRowId(null);
    setFolderDropMode(null);
    setOverHome(false);
  }, []);

  // Reorder within a single container (top level or one folder). Cross-container
  // moves go through the folder / home drop targets. Reordering the master array
  // works per-folder because each folder view is a stable filter of it.
  const handleReorder = useCallback(
    (targetId: string) => {
      const sourceId = draggingId;
      clearDrag();
      if (!sourceId || sourceId === targetId) return;
      const source = boards.find((b) => b.id === sourceId);
      const target = boards.find((b) => b.id === targetId);
      if (!source || !target || source.folderId !== target.folderId) return;
      const ids = boards.map((b) => b.id);
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(targetId);
      if (from === -1 || to === -1) return;
      ids.splice(from, 1);
      ids.splice(to, 0, sourceId);
      reorderBoards(ids);
    },
    [boards, draggingId, clearDrag],
  );

  const moveBoardInto = useCallback(
    (folderId: string | null) => {
      const sourceId = draggingId;
      clearDrag();
      if (sourceId) moveBoardToFolder(sourceId, folderId);
    },
    [draggingId, clearDrag],
  );

  // Drop a folder onto another folder. "inside" nests it within the target;
  // "before" makes it a sibling placed before the target.
  const handleFolderDrop = useCallback(
    (targetId: string) => {
      const sourceId = draggingFolderId;
      const mode = folderDropMode;
      clearDrag();
      if (!sourceId) return;
      if (mode === "inside") {
        moveFolderToParent(sourceId, targetId);
        setExpanded((prev) => new Set(prev).add(targetId)); // reveal the nested folder
      } else {
        placeFolderBefore(sourceId, targetId);
      }
    },
    [draggingFolderId, folderDropMode, clearDrag],
  );

  const onFolderDragOverRow = useCallback(
    (id: string, mode: "before" | "inside") => {
      setOverFolderRowId(id);
      setFolderDropMode(mode);
    },
    [],
  );

  // Drop onto the Home header → promote a folder, or move a board, to top level.
  const handleHomeDrop = useCallback(() => {
    const folderId = draggingFolderId;
    const boardId = draggingId;
    clearDrag();
    if (folderId) moveFolderToParent(folderId, null);
    else if (boardId) moveBoardToFolder(boardId, null);
  }, [draggingFolderId, draggingId, clearDrag]);

  const goTo = useCallback(
    (boardId: string) => {
      setOpen(false);
      router.push(`/b/${boardId}`);
    },
    [router],
  );

  const openNewTab = useCallback((boardId: string) => {
    window.open(`/b/${boardId}`, "_blank", "noopener,noreferrer");
  }, []);

  const newCanvas = useCallback(() => {
    const board = createBoard("");
    setOpen(false);
    router.push(`/b/${board.id}`);
  }, [router]);

  const newSubfolder = useCallback((parentId: string) => {
    createFolder("New folder", parentId);
    setExpanded((prev) => new Set(prev).add(parentId));
  }, []);

  const commitBoardRename = useCallback((board: Board, name: string) => {
    renameBoard(board.id, name);
    setRenamingBoardId(null);
  }, []);

  const commitFolderRename = useCallback((folder: Folder, name: string) => {
    renameFolder(folder.id, name);
    setRenamingFolderId(null);
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

  const deleteFolderById = useCallback((folder: Folder) => {
    // Folders own no canvas data — deleting one ungroups its canvases (they
    // move to top level), so no confirm needed, matching the home page.
    deleteFolder(folder.id);
  }, []);

  // All hooks above; safe to bail before rendering once focus mode owns the
  // screen.
  if (focusShapeId) return null;

  const draggingFolderHasChildren =
    draggingFolderId !== null &&
    folders.some((f) => f.parentId === draggingFolderId);

  const dnd: SidebarDnd = {
    draggingId,
    draggingFolderId,
    draggingFolderHasChildren,
    overId,
    overFolderId,
    overFolderRowId,
    folderDropMode,
    currentId,
    expanded,
    renamingBoardId,
    renamingFolderId,
    onToggle: toggleFolder,
    onBoardDragStart: setDraggingId,
    onBoardDragEnter: setOverId,
    onBoardReorder: handleReorder,
    onBoardDropInFolder: moveBoardInto,
    onBoardDragEnterFolder: setOverFolderId,
    onClearDrag: clearDrag,
    onSelect: goTo,
    onOpenNewTab: openNewTab,
    onRenameBoard: setRenamingBoardId,
    onCommitBoardRename: commitBoardRename,
    onDeleteBoard: deleteCanvas,
    onFolderDragStart: setDraggingFolderId,
    onFolderDragOverRow,
    onFolderDrop: handleFolderDrop,
    onNewSubfolder: newSubfolder,
    onRenameFolder: setRenamingFolderId,
    onCommitFolderRename: commitFolderRename,
    onDeleteFolder: deleteFolderById,
    folderBoards: boardsInFolder,
    subfoldersOf,
  };

  const dragging = draggingId !== null || draggingFolderId !== null;

  // The sidebar floats above the canvas; keep its own pointer/right-click events
  // to itself (no native menu, no bubbling to window-level canvas listeners).
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();
  const blockContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <div
        className="pointer-events-auto fixed left-4 top-4 z-[600] flex items-center gap-1.5"
        onPointerDown={stopPointer}
        onContextMenu={blockContextMenu}
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
            className="pointer-events-auto fixed inset-0 z-[600] bg-black/20"
            onClick={() => setOpen(false)}
            onPointerDown={stopPointer}
            onContextMenu={blockContextMenu}
            aria-hidden
          />
          <aside
            className="pointer-events-auto fixed left-0 top-0 z-[610] flex h-full w-[300px] flex-col border-r border-hairline bg-elevated shadow-[var(--shadow-floating)]"
            aria-label="Canvas navigation"
            onPointerDown={stopPointer}
            onContextMenu={blockContextMenu}
          >
            <div
              className={
                "flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5 transition-colors duration-100 " +
                (overHome && dragging ? "bg-surface-hover ring-1 ring-accent/60" : "")
              }
              onDragOver={(e) => {
                if (dragging) {
                  e.preventDefault();
                  setOverHome(true);
                }
              }}
              onDragLeave={() => setOverHome(false)}
              onDrop={(e) => {
                e.preventDefault();
                handleHomeDrop();
              }}
              title={dragging ? "Drop here to move to the top level" : undefined}
            >
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

            <div className="flex items-center gap-1.5 px-3 pt-3">
              <button
                type="button"
                onClick={newCanvas}
                className="flex flex-1 items-center gap-2 rounded-button border border-hairline px-2.5 py-2 text-[13px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
              >
                <Plus className="h-4 w-4" aria-hidden />
                New canvas
              </button>
              <button
                type="button"
                onClick={() => createFolder("New folder")}
                title="New folder"
                aria-label="New folder"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-button border border-hairline text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
              >
                <FolderPlus className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
              {topFolders.map((f) => (
                <FolderNode
                  key={f.id}
                  folder={f}
                  depth={0}
                  isSubfolder={false}
                  dnd={dnd}
                />
              ))}
              {topBoards.map((b) => (
                <BoardRow key={b.id} board={b} depth={0} dnd={dnd} />
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
    </>
  );
}

function FolderNode({
  folder,
  depth,
  isSubfolder,
  dnd,
}: {
  folder: Folder;
  depth: number;
  isSubfolder: boolean;
  dnd: SidebarDnd;
}) {
  const isOpen = dnd.expanded.has(folder.id);
  const subs = isSubfolder ? [] : dnd.subfoldersOf(folder.id);
  const fboards = dnd.folderBoards(folder.id);
  const editing = dnd.renamingFolderId === folder.id;

  const isDraggingSelf = dnd.draggingFolderId === folder.id;
  const isBoardDropTarget =
    dnd.overFolderId === folder.id && dnd.draggingId !== null;
  const isFolderHovered =
    dnd.overFolderRowId === folder.id &&
    dnd.draggingFolderId !== null &&
    dnd.draggingFolderId !== folder.id;
  // 2-level cap: nest only into a top-level folder, and only a childless folder.
  const canNest = !isSubfolder && !dnd.draggingFolderHasChildren;
  const folderInside =
    isFolderHovered && dnd.folderDropMode === "inside" && canNest;
  const folderBefore = isFolderHovered && !folderInside;
  const insideHighlight = isBoardDropTarget || folderInside;

  return (
    <div>
      <div
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          dnd.onFolderDragStart(folder.id);
        }}
        onDragEnd={dnd.onClearDrag}
        onDragEnter={() => {
          if (dnd.draggingId) dnd.onBoardDragEnterFolder(folder.id);
        }}
        onDragOver={(e) => {
          if (dnd.draggingFolderId && dnd.draggingFolderId !== folder.id) {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const inTopZone = e.clientY - rect.top < rect.height * 0.4;
            dnd.onFolderDragOverRow(folder.id, inTopZone ? "before" : "inside");
          } else if (dnd.draggingId) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dnd.draggingFolderId) dnd.onFolderDrop(folder.id);
          else if (dnd.draggingId) dnd.onBoardDropInFolder(folder.id);
        }}
        style={{ opacity: isDraggingSelf ? 0.4 : 1, paddingLeft: 8 + depth * 14 }}
        className={
          "group flex items-center gap-1.5 rounded-button border-t-2 py-1.5 pr-2 transition-colors duration-100 " +
          (insideHighlight
            ? "border-transparent bg-surface-hover ring-1 ring-accent/60"
            : folderBefore
              ? "border-accent"
              : "border-transparent hover:bg-surface-hover")
        }
      >
        <button
          type="button"
          onClick={() => dnd.onToggle(folder.id)}
          aria-label={isOpen ? "Collapse folder" : "Expand folder"}
          className="grid h-5 w-4 shrink-0 place-items-center text-text-tertiary hover:text-text-primary"
        >
          <ChevronRight
            className="h-3.5 w-3.5 transition-transform duration-100"
            style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
            aria-hidden
          />
        </button>
        <FolderIcon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        {editing ? (
          <input
            autoFocus
            defaultValue={folder.name}
            onBlur={(e) => dnd.onCommitFolderRename(folder, e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                dnd.onCommitFolderRename(folder, e.currentTarget.value);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                dnd.onRenameFolder(null);
              }
            }}
            onFocus={(e) => e.currentTarget.select()}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => dnd.onToggle(folder.id)}
            className="min-w-0 flex-1 truncate text-left text-[13px] text-text-secondary transition-colors duration-100 group-hover:text-text-primary"
          >
            {folder.name || "Untitled folder"}
          </button>
        )}
        {!editing ? (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
            {!isSubfolder ? (
              <RowIconButton
                label="New subfolder"
                onClick={() => dnd.onNewSubfolder(folder.id)}
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              </RowIconButton>
            ) : null}
            <RowIconButton
              label="Rename folder"
              onClick={() => dnd.onRenameFolder(folder.id)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </RowIconButton>
            <RowIconButton
              label="Delete folder"
              danger
              onClick={() => dnd.onDeleteFolder(folder)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </RowIconButton>
          </div>
        ) : null}
      </div>
      {isOpen ? (
        <>
          {subs.map((sf) => (
            <FolderNode
              key={sf.id}
              folder={sf}
              depth={depth + 1}
              isSubfolder
              dnd={dnd}
            />
          ))}
          {fboards.map((b) => (
            <BoardRow key={b.id} board={b} depth={depth + 1} dnd={dnd} />
          ))}
          {subs.length + fboards.length === 0 ? (
            <div
              className="py-1 text-[12px] text-text-tertiary"
              style={{ paddingLeft: 8 + (depth + 1) * 14 + 18 }}
            >
              Drag a canvas here
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function BoardRow({
  board,
  depth,
  dnd,
}: {
  board: Board;
  depth: number;
  dnd: SidebarDnd;
}) {
  const padLeft = 8 + depth * 14 + 18;
  const current = board.id === dnd.currentId;
  const renaming = dnd.renamingBoardId === board.id;
  const isDragging = dnd.draggingId === board.id;
  const isDragOver = dnd.overId === board.id && dnd.draggingId !== board.id;

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
          onBlur={(e) => dnd.onCommitBoardRename(board, e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              dnd.onCommitBoardRename(board, e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              dnd.onRenameBoard(null);
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
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        dnd.onBoardDragStart(board.id);
      }}
      onDragEnter={() => dnd.onBoardDragEnter(board.id)}
      onDragOver={(e) => {
        if (dnd.draggingId) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        dnd.onBoardReorder(board.id);
      }}
      onDragEnd={dnd.onClearDrag}
      style={{ opacity: isDragging ? 0.4 : 1, paddingLeft: padLeft }}
      className={
        "group flex w-full items-center gap-1.5 rounded-button py-1.5 pr-2 text-[13px] transition-colors duration-100 " +
        (isDragOver
          ? "bg-surface-hover ring-1 ring-accent/60"
          : current
            ? "bg-surface-hover"
            : "hover:bg-surface-hover")
      }
      aria-current={current ? "page" : undefined}
    >
      <span
        aria-hidden
        title="Drag to reorder"
        className="-ml-1 grid h-5 w-4 shrink-0 cursor-grab place-items-center text-text-tertiary opacity-0 transition-opacity duration-100 group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
      <Link
        href={`/b/${board.id}`}
        draggable={false}
        onClick={(e) => {
          // Let Cmd/Ctrl/Shift-click open a new tab/window natively.
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          dnd.onSelect(board.id);
        }}
        className={
          "min-w-0 flex-1 truncate text-left " +
          (current
            ? "text-text-primary"
            : "text-text-secondary group-hover:text-text-primary")
        }
      >
        {board.title || "Untitled canvas"}
      </Link>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
        <RowIconButton
          label="Open in new tab"
          onClick={() => dnd.onOpenNewTab(board.id)}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </RowIconButton>
        <RowIconButton
          label="Rename"
          onClick={() => dnd.onRenameBoard(board.id)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </RowIconButton>
        <RowIconButton
          label="Delete"
          danger
          onClick={() => dnd.onDeleteBoard(board)}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </RowIconButton>
      </div>
    </div>
  );
}

function RowIconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        "grid h-7 w-7 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover " +
        (danger ? "hover:text-red-500" : "hover:text-text-primary")
      }
    >
      {children}
    </button>
  );
}
