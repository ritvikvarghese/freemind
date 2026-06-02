import type { AgentMode } from "@/lib/agent/modes";
import type { SourceSnapshot } from "@/components/canvas/shapes/DocumentNode";
import type { ChatMessage } from "./chatTypes";

/**
 * A canvas-scoped chat session — the non-modal, right-docked chat that runs over
 * a snapshot of selected sources (distinct from the artifact-bound chat in
 * `chatHistory.ts`). One record per session, board-scoped via
 * `boardPersistenceKey`, persisted in the `canvas-ai-canvas-chats-v1` IDB store.
 *
 * `sources` embeds the full snapshots captured at creation (exactly how
 * `DocumentNode.props.sources` stores them on a shape) so the session is stable
 * even if the underlying shapes are later edited or deleted. `mode` is the
 * chat's reasoning mode; it can change across the session (e.g. switching to
 * Deepsearch) and reflects the most recent choice.
 */
export type CanvasChatRecord = {
  id: string;
  boardPersistenceKey: string;
  title: string;
  mode: AgentMode;
  sources: SourceSnapshot[];
  sourceIds: string[];
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};
