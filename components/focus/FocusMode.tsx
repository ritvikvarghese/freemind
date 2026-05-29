"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import {
  X,
  ChevronDown,
  ChevronRight,
  FileText,
  StickyNote,
  FileType2,
  Image as ImageIcon,
  MonitorPlay,
  MessageSquare,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrlTransform } from "@/lib/markdown/urlTransform";
import type {
  DocumentNodeShape,
  SourceSnapshot,
} from "@/components/canvas/shapes/DocumentNode";
import { RichEditor, type RichEditorHandle } from "./editor/RichEditor";
import { StreamingView } from "./editor/StreamingView";
import { ExportButtons } from "./ExportButtons";
import { UploadFocusMode } from "./UploadFocusMode";
import { ImageFocusMode } from "./ImageFocusMode";
import { ChatPanel, type ChatPanelHandle } from "./chat/ChatPanel";
import { getCurrentBoardPersistenceKey } from "@/lib/storage/currentBoard";
import { installDiffDecorationsPlugin } from "./editor/diffDecorations";
import { getProposals } from "@/lib/agent/chat/proposalRegistry";
import { CommentLayer, type CommentLayerHandle } from "./comments/CommentLayer";
import { CommentMargin } from "./comments/CommentMargin";
import {
  installCommentDecorationsPlugin,
  resolveComments,
} from "./editor/commentDecorations";
import type { Comment } from "@/lib/storage/commentTypes";

type Props = {
  shapeId: TLShapeId;
  onClose: () => void;
};

const AUTOSAVE_MS = 250;

/**
 * Routes the focused shape to the right focus-mode UI. Documents get the
 * editable view with autosave + export; uploads get the read-only view.
 */
export function FocusMode({ shapeId, onClose }: Props) {
  const editor = useEditor();
  const shape = editor.getShape(shapeId);
  if (!shape) return null;
  if (shape.type === "canvas-ai-upload") {
    return <UploadFocusMode shapeId={shapeId} onClose={onClose} />;
  }
  if (shape.type === "canvas-ai-image") {
    return <ImageFocusMode shapeId={shapeId} onClose={onClose} />;
  }
  if (shape.type === "canvas-ai-document") {
    return <DocumentFocusMode shapeId={shapeId} onClose={onClose} />;
  }
  return null;
}

function DocumentFocusMode({ shapeId, onClose }: Props) {
  const editor = useEditor();
  // Subscribe to the shape so external mutations (e.g. comments added via
  // popover, AI proposals accepted, snapshots written by runResearch) trigger
  // a React re-render. Reading via editor.getShape alone wouldn't subscribe.
  const shape = useValue(
    `focus-shape-${shapeId}`,
    () => editor.getShape(shapeId) as DocumentNodeShape | undefined,
    [editor, shapeId],
  );

  const [title, setTitle] = useState(shape?.props.title ?? "");
  const [markdown, setMarkdown] = useState(shape?.props.markdown ?? "");
  const [mounted, setMounted] = useState(false);

  // Track latest values for the debounced flush without re-creating timers.
  const latestTitle = useRef(title);
  const latestMarkdown = useRef(markdown);
  useEffect(() => {
    latestTitle.current = title;
  }, [title]);
  useEffect(() => {
    latestMarkdown.current = markdown;
  }, [markdown]);

  const flushTimer = useRef<number | null>(null);
  const editorHandleRef = useRef<RichEditorHandle | null>(null);

  const flush = useCallback(() => {
    const current = editor.getShape(shapeId) as DocumentNodeShape | undefined;
    if (!current) return;
    const nextTitle = latestTitle.current;
    // Serialize from the editor on demand so a close/Esc within the editor's
    // serialize-debounce window still saves the latest keystrokes. Falls back to
    // the last emitted markdown when the editor is gone (external unmount).
    const nextMarkdown =
      editorHandleRef.current?.getMarkdown() ?? latestMarkdown.current;
    if (
      current.props.title === nextTitle &&
      current.props.markdown === nextMarkdown
    ) {
      return;
    }
    latestMarkdown.current = nextMarkdown;
    editor.updateShape<DocumentNodeShape>({
      id: shapeId,
      type: "canvas-ai-document",
      props: { ...current.props, title: nextTitle, markdown: nextMarkdown },
    });
  }, [editor, shapeId]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
    }
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      flush();
    }, AUTOSAVE_MS);
  }, [flush]);

  // Previously we set tldraw to readonly here to suppress canvas shortcuts.
  // That silently blocks ALL programmatic shape mutations in tldraw v5 (see
  // Editor#updateShapes: `if (this.getIsReadonly()) return;`), which killed
  // autosave + comment writes. The fullscreen overlay already covers the
  // canvas, so readonly mode isn't needed for input isolation.

  // Mount marker for the entry transition + portal target gating.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Esc to close — always flush before exit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        flush();
        onClose();
      }
    }
    // Capture phase so we beat tldraw's window-level listener.
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [flush, onClose]);

  // Flush on unmount in case the user closed via X without an intervening
  // debounce tick.
  useEffect(() => {
    return () => {
      if (flushTimer.current !== null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      flush();
    };
  }, [flush]);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.currentTarget.value);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const handleMarkdownChange = useCallback(
    (next: string) => {
      setMarkdown(next);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const handleClose = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  // If the shape disappeared (e.g. deleted from another surface), exit cleanly.
  useEffect(() => {
    if (!shape) onClose();
  }, [shape, onClose]);

  const sourcesUsed = shape?.props.sourcesUsed ?? [];
  const sourceSnapshots = shape?.props.sources ?? [];
  const comments = shape?.props.comments ?? [];
  const userPrompt = shape?.props.userPrompt ?? "";
  const status = shape?.props.status ?? "done";
  const isStreaming = status === "researching" || status === "streaming";

  // Chat-open state, persisted per artifact in localStorage so toggling
  // survives reload. Default closed.
  const [isChatOpen, setIsChatOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(`canvas-ai:chat-open:${shapeId}`) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        `canvas-ai:chat-open:${shapeId}`,
        isChatOpen ? "1" : "0",
      );
    } catch {
      /* quota — fine, in-memory state still correct */
    }
  }, [shapeId, isChatOpen]);

  const chatPanelRef = useRef<ChatPanelHandle | null>(null);
  // Tracks the live Tiptap editor instance so ChatPanel re-renders when it
  // becomes available. The ref alone doesn't trigger a re-render.
  const [liveEditor, setLiveEditor] = useState<import("@tiptap/core").Editor | null>(null);
  const onEditorReady = useCallback((handle: RichEditorHandle | null) => {
    editorHandleRef.current = handle;
    setLiveEditor(handle?.editor ?? null);
  }, []);

  const handleGenerate = useCallback((selectionText: string) => {
    setIsChatOpen(true);
    // Defer until ChatPanel mounts.
    requestAnimationFrame(() => {
      chatPanelRef.current?.openWithContext(selectionText);
    });
  }, []);

  const commentLayerRef = useRef<CommentLayerHandle | null>(null);

  const getComments = useCallback((): Comment[] => {
    const cur = editor.getShape<DocumentNodeShape>(shapeId);
    return cur?.props.comments ?? [];
  }, [editor, shapeId]);

  const setComments = useCallback(
    (next: Comment[]) => {
      const cur = editor.getShape<DocumentNodeShape>(shapeId);
      if (!cur) return;
      editor.updateShape<DocumentNodeShape>({
        id: shapeId,
        type: "canvas-ai-document",
        props: { comments: next },
      });
    },
    [editor, shapeId],
  );

  const diffPluginInstall = useCallback(
    (ed: import("@tiptap/core").Editor) =>
      installDiffDecorationsPlugin(ed, () => getProposals(shapeId)),
    [shapeId],
  );

  const commentPluginInstall = useCallback(
    (ed: import("@tiptap/core").Editor) =>
      installCommentDecorationsPlugin(ed, () => getComments()),
    [getComments],
  );

  // Memoize the array reference so RichEditor's useEffect doesn't thrash and
  // tear down/reinstall plugins on every parent re-render.
  const extraPlugins = useMemo(
    () => [diffPluginInstall, commentPluginInstall],
    [diffPluginInstall, commentPluginInstall],
  );

  const handleComment = useCallback(() => {
    commentLayerRef.current?.beginCommentFromSelection();
  }, []);

  const handleOpenComment = useCallback(
    (commentId: string, anchorRect: DOMRect) => {
      commentLayerRef.current?.openComment(commentId, anchorRect);
    },
    [],
  );

  const boardPersistenceKey =
    getCurrentBoardPersistenceKey() ?? "canvas-ai-v1";

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Document focus mode"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onKeyPress={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="canvas-ai-focus-root fixed inset-0 z-50 flex flex-col bg-overlay"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(4px)",
        transition:
          "opacity 200ms var(--ease-out-fast), transform 200ms var(--ease-out-fast)",
      }}
    >
      <Header
        title={title}
        onTitleChange={handleTitleChange}
        markdown={markdown}
        onClose={handleClose}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((v) => !v)}
        openCommentCount={comments.filter((c) => !c.resolved).length}
      />

      <div
        className="flex-1 min-h-0 grid"
        style={{
          gridTemplateColumns: isChatOpen ? "1fr 400px" : "1fr",
        }}
      >
        <ScrollColumn>
          {isStreaming ? (
            <StreamingView markdown={markdown} />
          ) : (
            <RichEditor
              ref={onEditorReady}
              // Remount on shape change so initialMarkdown is honored, but stay
              // mounted across debounced flushes within the same artifact.
              key={shapeId}
              initialMarkdown={shape?.props.markdown ?? ""}
              onChange={handleMarkdownChange}
              onGenerate={handleGenerate}
              onComment={handleComment}
              extraPlugins={extraPlugins}
              overlay={({ editor: ed, wrapperRef }) => (
                <CommentMargin
                  editor={ed}
                  wrapperRef={wrapperRef}
                  comments={comments}
                  onOpen={handleOpenComment}
                />
              )}
            />
          )}
          <CommentsPanel
            comments={comments}
            editor={liveEditor}
            onChange={setComments}
            onOpen={handleOpenComment}
          />
          <SourcesPanel
            sourcesUsed={sourcesUsed}
            sourceSnapshots={sourceSnapshots}
            userPrompt={userPrompt}
          />
        </ScrollColumn>
        {isChatOpen ? (
          <ChatPanel
            ref={chatPanelRef}
            artifactId={shapeId}
            boardPersistenceKey={boardPersistenceKey}
            doc={{
              markdown: shape?.props.markdown ?? "",
              sources: sourceSnapshots,
            }}
            editor={liveEditor}
            onClose={() => setIsChatOpen(false)}
          />
        ) : null}
      </div>

      <CommentLayer
        ref={commentLayerRef}
        editor={liveEditor}
        comments={comments}
        onChange={setComments}
      />


      {/*
        Hidden render of the document for printing. The print stylesheet hides
        everything else and shows only `.canvas-ai-print-target`.
       */}
      <PrintTarget title={title} markdown={markdown} />
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return overlay;
  }
  return createPortal(overlay, document.body);
}

function Header({
  title,
  onTitleChange,
  markdown,
  onClose,
  isChatOpen,
  onToggleChat,
  openCommentCount,
}: {
  title: string;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  markdown: string;
  onClose: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  openCommentCount: number;
}) {
  return (
    <div className="canvas-ai-focus-paper border-b border-hairline bg-elevated">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-6 py-3">
        <input
          type="text"
          value={title}
          onChange={onTitleChange}
          placeholder="Untitled document"
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-[15px] font-medium tracking-tight text-text-primary outline-none placeholder:text-text-tertiary"
        />
        <ExportButtons title={title} markdown={markdown} />
        {openCommentCount > 0 ? (
          <button
            type="button"
            title={`${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} — scroll to the Comments panel below`}
            aria-label={`${openCommentCount} open comments`}
            onClick={() => {
              // Scroll to the in-doc Comments panel.
              document
                .querySelector(".canvas-ai-comments-panel")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="flex h-7 items-center gap-1 rounded-button px-2 text-[12px] font-medium text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            <span>{openCommentCount}</span>
          </button>
        ) : null}
        <button
          type="button"
          title={isChatOpen ? "Close chat" : "Open chat"}
          aria-label={isChatOpen ? "Close chat" : "Open chat"}
          aria-pressed={isChatOpen}
          onClick={onToggleChat}
          className={
            "grid h-7 w-7 place-items-center rounded-button transition-colors duration-100 " +
            (isChatOpen
              ? "bg-surface-hover text-text-primary"
              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary")
          }
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          title="Close (Esc)"
          aria-label="Close focus mode"
          onClick={onClose}
          className="ml-1 grid h-7 w-7 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function ScrollColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="canvas-ai-focus-paper flex-1 overflow-auto bg-app">
      <div className="mx-auto w-full max-w-[760px] px-6">{children}</div>
    </div>
  );
}

function CommentsPanel({
  comments,
  editor,
  onChange,
  onOpen,
}: {
  comments: Comment[];
  editor: import("@tiptap/core").Editor | null;
  onChange: (next: Comment[]) => void;
  onOpen: (commentId: string, anchorRect: DOMRect) => void;
}) {
  if (comments.length === 0) return null;
  const resolutions = resolveComments(editor, comments);
  const anchored = resolutions.filter(
    (r) => r.range !== null && !r.comment.resolved,
  );
  const orphaned = resolutions.filter(
    (r) => r.range === null && !r.comment.resolved,
  );
  const resolved = resolutions.filter((r) => r.comment.resolved);

  return (
    <div className="canvas-ai-comments-panel mt-8 border-t border-hairline pt-6">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          Comments ({anchored.length + orphaned.length})
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {anchored.map((r) => (
          <CommentRow
            key={r.comment.id}
            comment={r.comment}
            orphaned={false}
            onScrollTo={(e) => {
              if (!editor || !r.range) return;
              editor.commands.setTextSelection(r.range);
              try {
                const coords = editor.view.coordsAtPos(r.range.from);
                // Open the viewer popover anchored at the highlighted text.
                const rect = new DOMRect(
                  coords.left,
                  coords.top,
                  0,
                  coords.bottom - coords.top,
                );
                onOpen(r.comment.id, rect);
              } catch {
                const rect = (
                  e?.currentTarget as HTMLElement | undefined
                )?.getBoundingClientRect();
                if (rect) onOpen(r.comment.id, rect);
              }
            }}
            onDelete={() =>
              onChange(comments.filter((c) => c.id !== r.comment.id))
            }
            onResolveToggle={() =>
              onChange(
                comments.map((c) =>
                  c.id === r.comment.id
                    ? { ...c, resolved: !c.resolved }
                    : c,
                ),
              )
            }
          />
        ))}
        {orphaned.map((r) => (
          <CommentRow
            key={r.comment.id}
            comment={r.comment}
            orphaned
            onScrollTo={null}
            onDelete={() =>
              onChange(comments.filter((c) => c.id !== r.comment.id))
            }
            onResolveToggle={() =>
              onChange(
                comments.map((c) =>
                  c.id === r.comment.id
                    ? { ...c, resolved: !c.resolved }
                    : c,
                ),
              )
            }
          />
        ))}
      </ul>
      {resolved.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-text-tertiary hover:text-text-secondary">
            Resolved ({resolved.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((r) => (
              <CommentRow
                key={r.comment.id}
                comment={r.comment}
                orphaned={r.range === null}
                onScrollTo={null}
                onDelete={() =>
                  onChange(comments.filter((c) => c.id !== r.comment.id))
                }
                onResolveToggle={() =>
                  onChange(
                    comments.map((c) =>
                      c.id === r.comment.id
                        ? { ...c, resolved: !c.resolved }
                        : c,
                    ),
                  )
                }
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CommentRow({
  comment,
  orphaned,
  onScrollTo,
  onDelete,
  onResolveToggle,
}: {
  comment: Comment;
  orphaned: boolean;
  onScrollTo:
    | ((e?: React.MouseEvent<HTMLButtonElement>) => void)
    | null;
  onDelete: () => void;
  onResolveToggle: () => void;
}) {
  const truncatedQuote =
    comment.anchor_text.length > 80
      ? comment.anchor_text.slice(0, 80) + "…"
      : comment.anchor_text;
  return (
    <li className="rounded-button border border-hairline p-2">
      <div className="flex items-start gap-2">
        <div
          className="my-0.5 w-[2px] shrink-0 self-stretch rounded-sm"
          style={{
            background: orphaned
              ? "var(--color-error)"
              : "var(--color-text-tertiary)",
          }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => onScrollTo?.(e)}
            disabled={!onScrollTo}
            className="block w-full truncate text-left text-[11px] text-text-tertiary disabled:cursor-default"
            title={onScrollTo ? "Jump to this passage" : undefined}
          >
            {truncatedQuote}
          </button>
          <div
            className={
              "mt-1 whitespace-pre-wrap text-[12px] " +
              (comment.resolved ? "text-text-tertiary line-through" : "text-text-primary")
            }
          >
            {comment.body}
          </div>
          {orphaned ? (
            <div
              className="mt-1 text-[10px] uppercase tracking-wide"
              style={{ color: "var(--color-error)" }}
            >
              Orphaned — original text changed
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onResolveToggle}
            title={comment.resolved ? "Reopen" : "Resolve"}
            aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"}
            className="grid h-5 w-5 place-items-center rounded-button text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
          >
            <ChevronDown className="h-3 w-3 -rotate-90" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            aria-label="Delete comment"
            className="grid h-5 w-5 place-items-center rounded-button text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

function SourcesPanel({
  sourcesUsed,
  sourceSnapshots,
  userPrompt,
}: {
  sourcesUsed: { query: string; urls: string[] }[];
  sourceSnapshots: SourceSnapshot[];
  userPrompt: string;
}) {
  const hasWebSources = sourcesUsed.length > 0;
  const hasSnapshots = sourceSnapshots.length > 0;
  const hasPrompt = userPrompt.trim().length > 0;
  if (!hasWebSources && !hasSnapshots && !hasPrompt) return null;

  return (
    <div className="mt-8 mb-12 border-t border-hairline pt-6">
      {hasPrompt ? (
        <div className="mb-6">
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            Original prompt
          </div>
          <div className="mt-1 text-[13px] text-text-secondary whitespace-pre-wrap">
            {userPrompt}
          </div>
        </div>
      ) : null}
      {hasSnapshots ? (
        <div className="mb-6">
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            Sources
          </div>
          <ul className="mt-2 space-y-1">
            {sourceSnapshots.map((s) => (
              <SnapshotRow key={s.id} snapshot={s} />
            ))}
          </ul>
        </div>
      ) : null}
      {hasWebSources ? (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            Web sources
          </div>
          <ul className="mt-2 space-y-2">
            {sourcesUsed.map((s, i) => (
              <li key={i} className="text-[12px]">
                <div className="text-text-secondary">
                  <span className="text-text-tertiary">Query:</span> {s.query}
                </div>
                {s.urls.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {s.urls.map((u) => (
                      <li
                        key={u}
                        className="truncate font-mono text-[11px] text-text-tertiary"
                      >
                        <a
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-text-secondary"
                        >
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SnapshotRow({ snapshot }: { snapshot: SourceSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-button border border-hairline">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      >
        <span className="grid h-4 w-4 place-items-center text-text-tertiary">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        <KindIcon kind={snapshot.kind} />
        <span className="flex-1 truncate">{snapshot.title}</span>
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          {labelForKind(snapshot.kind)}
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-hairline px-3 py-2">
          <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-text-secondary">
            {snapshot.text || "(empty)"}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

function KindIcon({ kind }: { kind: SourceSnapshot["kind"] }) {
  const className = "h-3.5 w-3.5 shrink-0 text-text-tertiary";
  if (kind === "upload-pdf")
    return <FileText className={className} aria-hidden />;
  if (kind === "upload-markdown")
    return <FileType2 className={className} aria-hidden />;
  if (kind === "document")
    return <FileText className={className} aria-hidden />;
  if (kind === "image")
    return <ImageIcon className={className} aria-hidden />;
  if (kind === "youtube")
    return <MonitorPlay className={className} aria-hidden />;
  return <StickyNote className={className} aria-hidden />;
}

function labelForKind(kind: SourceSnapshot["kind"]): string {
  if (kind === "upload-pdf") return "PDF";
  if (kind === "upload-markdown") return "MD";
  if (kind === "document") return "DOC";
  if (kind === "image") return "IMG";
  if (kind === "youtube") return "YT";
  return "TEXT";
}

function PrintTarget({
  title,
  markdown,
}: {
  title: string;
  markdown: string;
}) {
  const components = useMemo(
    () => ({
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} target="_blank" rel="noreferrer" />
      ),
    }),
    [],
  );
  return (
    <div className="canvas-ai-print-target" aria-hidden>
      {title.trim().length > 0 ? <h1>{title}</h1> : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
