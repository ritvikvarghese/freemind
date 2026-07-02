"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  Trash2,
  GripVertical,
  FolderPlus,
  Folder as FolderIcon,
  ChevronRight,
  Upload,
  Loader2,
} from "lucide-react";
import { importBackupFile } from "@/lib/storage/backup";
import { hasApiKey } from "@/lib/storage/apiKey";
import { isOnboarded, markOnboarded } from "@/lib/storage/onboarding";
import { ApiKeyPanel } from "@/components/settings/ApiKeyPanel";
import { NameFolderDialog } from "@/components/folders/NameFolderDialog";
import { FolderSelect } from "@/components/folders/FolderSelect";
import { ToastProvider, ToastBridge } from "@/components/canvas/toast";
import {
  createBoard,
  deleteBoard,
  renameBoard,
  dropBoardOnBoard,
  useBoards,
  createFolder,
  renameFolder,
  deleteFolder,
  moveBoardToFolder,
  placeFolderBefore,
  moveFolderToParent,
  useFolders,
  type Board,
  type Folder,
} from "@/lib/storage/boards";

// Drag-and-drop context shared by the home page and its (recursive) folder rows.
// Two drag kinds coexist: dragging a board (`draggingId`) and dragging a folder
// (`draggingFolderId`). At most one is set at a time; handlers branch on which.
type FolderDnd = {
  draggingId: string | null; // board being dragged
  draggingFolderId: string | null; // folder being dragged
  draggingFolderHasChildren: boolean; // dragged folder has subfolders (2-level cap)
  overId: string | null; // board hovered (reorder target)
  overFolderId: string | null; // folder hovered by a dragged board (drop-in)
  overFolderRowId: string | null; // folder hovered by a dragged folder
  // Where a dropped folder lands relative to the hovered folder: "before" =
  // reorder above it (top edge), "inside" = nest within it (middle).
  folderDropMode: "before" | "inside" | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
  // boards
  onBoardDragStart: (id: string) => void;
  onBoardDragEnter: (id: string) => void;
  onBoardDragEnd: () => void;
  onBoardReorder: (id: string) => void;
  onBoardRequestDelete: (b: Board) => void;
  onBoardDropInFolder: (folderId: string) => void;
  onBoardDragEnterFolder: (folderId: string) => void;
  // folders
  onFolderDragStart: (id: string) => void;
  onFolderDragEnd: () => void;
  onFolderDragOverRow: (id: string, mode: "before" | "inside") => void;
  onFolderDrop: (id: string) => void;
  // data lookups (for recursion)
  folderBoards: (fid: string) => Board[];
  subfoldersOf: (fid: string) => Folder[];
};

// Home page body. Rendered via dynamic(() => ..., { ssr: false }) so the
// localStorage-backed board list reads safely on the client only — no SSR
// hydration dance.
export function HomeInner() {
  const boards = useBoards();
  const folders = useFolders();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  // The composer is a single resting line; it grows the context field while
  // focused or once either field has content. Tracked via focus events (not an
  // effect) to respect the set-state-in-effect lint rule.
  const [composerFocused, setComposerFocused] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);
  const [overFolderRowId, setOverFolderRowId] = useState<string | null>(null);
  const [folderDropMode, setFolderDropMode] = useState<
    "before" | "inside" | null
  >(null);
  const [overHeader, setOverHeader] = useState(false);
  // Folders start collapsed for a clean home screen. Expand state is
  // session-local (a Set of expanded ids) so a reload resets to all-closed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<Board | null>(null);
  // Open folder-naming modal. `null` = closed; `{ parentId }` carries the parent
  // when creating a subfolder (undefined parentId = top-level folder).
  const [namingFolder, setNamingFolder] = useState<{
    parentId?: string;
  } | null>(null);
  const router = useRouter();

  // First run only: send a brand-new, keyless visitor straight into the seeded
  // "welcome" canvas (with the welcome/key modal via ?welcome=1), exactly once
  // per browser. A user who already has a key, or who has been here before, is
  // marked onboarded and lands on this list as usual. Computed at mount so we
  // can render nothing while redirecting (no flash of the list).
  const [redirectingToWelcome] = useState(
    () => typeof window !== "undefined" && !isOnboarded() && !hasApiKey(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isOnboarded()) markOnboarded();
    if (redirectingToWelcome) router.replace("/b/legacy?welcome=1");
  }, [redirectingToWelcome, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const board = createBoard(title, context, newFolderId);
    router.push(`/b/${board.id}`);
  }

  const composerOpen =
    composerFocused || title.trim().length > 0 || context.trim().length > 0;

  // Restore from a backup file. Home has no toast bridge (it lives in-canvas),
  // and importBackup writes localStorage directly without notifying the in-tab
  // board store, so on success we reload to mount the restored boards cleanly.
  // Surfaces errors inline. This is the first-run migration path for users
  // coming from a self-hosted / cloned copy, who otherwise can't reach Import
  // (Settings only exists inside a canvas).
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleImport(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      await importBackupFile(file);
      window.location.reload();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  }

  function clearDrag() {
    setDraggingId(null);
    setDraggingFolderId(null);
    setOverId(null);
    setOverFolderId(null);
    setOverFolderRowId(null);
    setFolderDropMode(null);
    setOverHeader(false);
  }

  // Drop a canvas onto another canvas: reorder within the same folder, or move it
  // into the target's folder (top level included) and place it next to the
  // target. One write, handled by dropBoardOnBoard.
  function handleReorder(targetId: string) {
    const sourceId = draggingId;
    clearDrag();
    if (!sourceId) return;
    dropBoardOnBoard(sourceId, targetId);
  }

  function moveTo(folderId: string | null) {
    const sourceId = draggingId;
    clearDrag();
    if (sourceId) moveBoardToFolder(sourceId, folderId);
  }

  // Drop a folder onto another folder. "inside" (hovered the middle) nests it
  // within the target; "before" (hovered the top edge) makes it a sibling placed
  // before the target. See boards.ts for the 2-level cap.
  function handleFolderDrop(targetId: string) {
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
  }

  // Drop a folder onto the CANVASES header → promote it to the top level.
  function handleHeaderDrop() {
    const folderId = draggingFolderId;
    const boardWasDragged = draggingId;
    clearDrag();
    if (folderId) moveFolderToParent(folderId, null);
    else if (boardWasDragged) moveBoardToFolder(boardWasDragged, null);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleNewSubfolder(parentId: string) {
    setNamingFolder({ parentId });
  }

  function handleCreateFolder(name: string) {
    const parentId = namingFolder?.parentId;
    createFolder(name, parentId);
    setNamingFolder(null);
    // Reveal a new subfolder by expanding its parent.
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
  }

  const topFolders = folders.filter((f) => !f.parentId);
  // Show boards at top level when they have no folder OR their folder no longer
  // exists, so a board can never silently vanish if a folder delete half-failed.
  const folderIds = new Set(folders.map((f) => f.id));
  const topLevel = boards.filter((b) => !b.folderId || !folderIds.has(b.folderId));
  const draggingFolderHasChildren =
    draggingFolderId !== null &&
    folders.some((f) => f.parentId === draggingFolderId);

  const onFolderDragOverRow = (id: string, mode: "before" | "inside") => {
    setOverFolderRowId(id);
    setFolderDropMode(mode);
  };

  const dnd: FolderDnd = {
    draggingId,
    draggingFolderId,
    draggingFolderHasChildren,
    overId,
    overFolderId,
    overFolderRowId,
    folderDropMode,
    expanded,
    onToggle: toggleExpand,
    onDeleteFolder: deleteFolder,
    onNewSubfolder: handleNewSubfolder,
    onBoardDragStart: setDraggingId,
    onBoardDragEnter: setOverId,
    onBoardDragEnd: clearDrag,
    onBoardReorder: handleReorder,
    onBoardRequestDelete: setPendingDelete,
    onBoardDropInFolder: (folderId) => moveTo(folderId),
    onBoardDragEnterFolder: setOverFolderId,
    onFolderDragStart: setDraggingFolderId,
    onFolderDragEnd: clearDrag,
    onFolderDragOverRow,
    onFolderDrop: handleFolderDrop,
    folderBoards: (fid) => boards.filter((b) => b.folderId === fid),
    subfoldersOf: (fid) => folders.filter((f) => f.parentId === fid),
  };

  // Render nothing while the first-run redirect is in flight (the effect above
  // fires router.replace), so the board list never flashes for a new visitor.
  if (redirectingToWelcome) return null;

  return (
    <ToastProvider>
      {/* Settings (API key, theme, export/import) reuses the in-canvas panel
          without its Clear-canvas section. ToastBridge powers its toasts here,
          since the toast UI normally only mounts in-canvas. */}
      <ApiKeyPanel />
      <ToastBridge />
      <main className="mx-auto max-w-xl px-6 pt-24 pb-12">
      <div className="mb-10 text-center">
        <h1 className="text-[28px] tracking-tight font-medium text-text-primary">
          Freemind
        </h1>
        <p className="mt-1 text-[13px] text-text-tertiary">
          A canvas for the mind
        </p>
      </div>

      <form
        onSubmit={submit}
        onFocus={() => setComposerFocused(true)}
        onBlur={(e) => {
          // Stay open while focus moves between the title, the context field,
          // and the Create button (all inside the form); collapse only when
          // focus truly leaves and nothing has been typed.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setComposerFocused(false);
        }}
        className={
          "mb-10 overflow-hidden rounded-panel border bg-elevated transition-colors duration-100 " +
          (composerOpen ? "border-hairline-hover" : "border-hairline")
        }
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Open a new canvas…"
          className="w-full bg-transparent px-4 py-3 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none"
        />
        <div
          className={
            "grid transition-all duration-200 ease-out " +
            (composerOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0")
          }
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-hairline">
              <textarea
                value={context}
                onChange={(e) => setContext(e.currentTarget.value)}
                placeholder="What's this canvas about? (optional)"
                rows={2}
                className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[13px] leading-relaxed text-text-primary placeholder:text-text-tertiary outline-none"
              />
              <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-1">
                <div className="w-44">
                  <FolderSelect
                    folders={folders}
                    value={newFolderId}
                    onChange={setNewFolderId}
                  />
                </div>
                <button
                  type="submit"
                  // Keep focus on click so the composer doesn't collapse out
                  // from under the press (and Safari, which won't focus a
                  // button on click, still submits).
                  onMouseDown={(e) => e.preventDefault()}
                  className="shrink-0 rounded-button bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent transition-opacity duration-100 hover:opacity-90"
                >
                  Create canvas
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>

      <div
        onDragOver={(e) => {
          if (draggingId || draggingFolderId) {
            e.preventDefault();
            setOverHeader(true);
          }
        }}
        onDragLeave={() => setOverHeader(false)}
        onDrop={(e) => {
          e.preventDefault();
          handleHeaderDrop();
        }}
        className={
          "mb-3 flex items-center justify-between rounded-button px-3 py-1 transition-colors duration-100 " +
          (overHeader && (draggingId || draggingFolderId)
            ? "bg-surface-hover ring-1 ring-accent/60"
            : "")
        }
      >
        <span className="text-text-tertiary text-[11px] tracking-wider uppercase">
          Canvases
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title="Import a backup file (restores canvases that are missing)"
            className="flex items-center gap-1.5 rounded-button px-2 py-1 text-[11px] text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden />
            )}
            Import backup
          </button>
          <button
            type="button"
            onClick={() => setNamingFolder({})}
            title="New folder"
            className="flex items-center gap-1.5 rounded-button px-2 py-1 text-[11px] text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            New folder
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void handleImport(file);
          }}
        />
      </div>

      {importError ? (
        <div className="mb-3 rounded-button border border-hairline bg-surface-hover px-3 py-2 text-[12px] text-red-500">
          Import failed: {importError}
        </div>
      ) : null}

      {boards.length === 0 && folders.length === 0 ? (
        <div className="text-text-tertiary text-[13px] px-3 py-2">
          No canvases yet. Type a name above and press Enter.
        </div>
      ) : (
        <ul className="space-y-0.5">
          {topFolders.map((f) => (
            <FolderRow key={f.id} folder={f} isSubfolder={false} dnd={dnd} />
          ))}
          {topLevel.map((b) => (
            <BoardRow
              key={b.id}
              board={b}
              isDragging={draggingId === b.id}
              isDragOver={overId === b.id && draggingId !== b.id}
              onDragStart={() => setDraggingId(b.id)}
              onDragEnter={() => setOverId(b.id)}
              onDragEnd={clearDrag}
              onDrop={() => handleReorder(b.id)}
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

      {namingFolder ? (
        <NameFolderDialog
          onCancel={() => setNamingFolder(null)}
          onCreate={handleCreateFolder}
        />
      ) : null}
      </main>
    </ToastProvider>
  );
}

function FolderRow({
  folder,
  isSubfolder,
  dnd,
}: {
  folder: Folder;
  isSubfolder: boolean;
  dnd: FolderDnd;
}) {
  const [editing, setEditing] = useState(false);

  const collapsed = !dnd.expanded.has(folder.id);
  const boards = dnd.folderBoards(folder.id);
  const subfolders = isSubfolder ? [] : dnd.subfoldersOf(folder.id);
  // Total canvases under this folder, including those nested in its subfolders
  // (nesting is capped at 2 levels, so subfolders have no further children).
  const childCount =
    boards.length +
    subfolders.reduce((n, sf) => n + dnd.folderBoards(sf.id).length, 0);

  const isDraggingSelf = dnd.draggingFolderId === folder.id;
  const isBoardDropTarget =
    dnd.overFolderId === folder.id && dnd.draggingId !== null;
  const isFolderHovered =
    dnd.overFolderRowId === folder.id &&
    dnd.draggingFolderId !== null &&
    dnd.draggingFolderId !== folder.id;
  // Nesting is only allowed into a top-level folder by a childless folder
  // (2-level cap). The middle zone reads as "inside" only when that holds.
  const canNest =
    folder.parentId === undefined && !dnd.draggingFolderHasChildren;
  const folderInside =
    isFolderHovered && dnd.folderDropMode === "inside" && canNest;
  const folderBefore = isFolderHovered && !folderInside;
  const insideHighlight = isBoardDropTarget || folderInside;

  return (
    <li>
      <div
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          dnd.onFolderDragStart(folder.id);
        }}
        onDragEnd={dnd.onFolderDragEnd}
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
        style={{ opacity: isDraggingSelf ? 0.4 : 1 }}
        className={
          "group flex items-center gap-1 rounded-button border-t-2 px-1 transition-colors duration-100 " +
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
          aria-label={collapsed ? "Expand folder" : "Collapse folder"}
          className="grid h-7 w-5 shrink-0 place-items-center text-text-tertiary hover:text-text-primary"
        >
          <ChevronRight
            className={
              "h-3.5 w-3.5 transition-transform duration-100 " +
              (collapsed ? "" : "rotate-90")
            }
            aria-hidden
          />
        </button>
        {editing ? (
          <div className="flex-1 py-1">
            <FolderRenameForm folder={folder} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => dnd.onToggle(folder.id)}
            className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left"
          >
            <FolderIcon
              className="h-4 w-4 shrink-0 text-text-tertiary"
              aria-hidden
            />
            <span className="flex-1 truncate text-[14px] text-text-primary">
              {folder.name}
            </span>
          </button>
        )}
        {!isSubfolder ? (
          <button
            type="button"
            aria-label={`New subfolder in ${folder.name}`}
            title="New subfolder"
            onClick={() => dnd.onNewSubfolder(folder.id)}
            className="grid h-7 w-7 place-items-center rounded-button text-text-tertiary opacity-0 transition-opacity duration-100 hover:bg-surface-hover hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Rename ${folder.name}`}
          title="Rename folder"
          onClick={() => setEditing(true)}
          className="grid h-7 w-7 place-items-center rounded-button text-text-tertiary opacity-0 transition-opacity duration-100 hover:bg-surface-hover hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Delete folder ${folder.name}`}
          title="Delete folder (canvases inside are kept)"
          onClick={() => dnd.onDeleteFolder(folder.id)}
          className="grid h-7 w-7 place-items-center rounded-button text-text-tertiary opacity-0 transition-opacity duration-100 hover:bg-surface-hover hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span className="shrink-0 w-14 pr-4 text-right text-[11px] text-text-tertiary tabular-nums">
          {childCount}
        </span>
      </div>

      {!collapsed ? (
        subfolders.length + boards.length > 0 ? (
          <ul className="ml-[14px] mt-0.5 space-y-0.5 border-l border-hairline pl-1">
            {subfolders.map((sf) => (
              <FolderRow key={sf.id} folder={sf} isSubfolder dnd={dnd} />
            ))}
            {boards.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                isDragging={dnd.draggingId === b.id}
                isDragOver={dnd.overId === b.id && dnd.draggingId !== b.id}
                onDragStart={() => dnd.onBoardDragStart(b.id)}
                onDragEnter={() => dnd.onBoardDragEnter(b.id)}
                onDragEnd={dnd.onBoardDragEnd}
                onDrop={() => dnd.onBoardReorder(b.id)}
                onRequestDelete={() => dnd.onBoardRequestDelete(b)}
              />
            ))}
          </ul>
        ) : (
          <div className="ml-[14px] mt-0.5 border-l border-hairline py-1 pl-3 text-[12px] text-text-tertiary">
            Drag a canvas here
          </div>
        )
      ) : null}
    </li>
  );
}

function FolderRenameForm({
  folder,
  onDone,
}: {
  folder: Folder;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function commit() {
    renameFolder(folder.id, draft);
    onDone();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
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
        className="w-full rounded-button border border-hairline-hover bg-elevated px-3 py-1.5 text-[14px] text-text-primary outline-none"
      />
    </form>
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
        <span className="shrink-0 w-14 pr-4 text-right text-[11px] text-text-tertiary tabular-nums">
          {formatCreatedAt(board.createdAt)}
        </span>
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
