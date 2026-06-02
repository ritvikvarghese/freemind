import type { Editor } from "tldraw";
import { snapshotSource, type SourceShape } from "@/lib/agent/buildContext";
import type { AgentMode } from "@/lib/agent/modes";
import { createCanvasChat } from "@/lib/storage/canvasChats";
import { openChat } from "@/lib/chat/openChat";

/**
 * Start a canvas chat from the FloatingPrompt: snapshot the selected sources,
 * create a persisted session, open the dock, and auto-send the first message.
 * Mirrors `launchResearch` (the artifact path), but opens a chat instead of
 * spawning a DocumentNode.
 */
export function launchCanvasChat(
  editor: Editor,
  sources: SourceShape[],
  firstPrompt: string,
  mode: AgentMode,
  boardKey: string,
): string {
  const capturedAt = Date.now();
  const snapshots = sources.map((s) => snapshotSource(s, capturedAt));
  const sourceIds = sources.map((s) => s.id as string);
  const title =
    truncate(firstPrompt, 60) ||
    `Chat over ${sources.length} source${sources.length === 1 ? "" : "s"}`;

  const rec = createCanvasChat({
    boardPersistenceKey: boardKey,
    title,
    mode,
    sources: snapshots,
    sourceIds,
  });

  openChat(rec.id, { autoSend: firstPrompt });
  // Deselect so the FloatingPrompt dismisses; the dock takes over.
  editor.setSelectedShapes([]);
  return rec.id;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}
