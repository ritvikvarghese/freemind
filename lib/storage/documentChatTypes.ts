import type { AgentMode } from "@/lib/agent/modes";
import type { ChatMessage } from "./chatTypes";

/**
 * A document-scoped chat session. The focus-view document chat used to be a
 * single thread per artifact (`chatHistory.ts`); this record makes it many
 * threads per document, mirroring the per-board `CanvasChatRecord`.
 *
 * Scoped by `documentId` (the document shape's TLShapeId as a string).
 * `boardPersistenceKey` is carried only so deleting a board can cascade-delete
 * its document chats. `mode` is the reasoning mode: `freeform` is plain Chat,
 * `deepsearch` is the composer's web toggle. The whole document is always the
 * primary context (passed in at run time); a selected passage rides along on a
 * message's `quote` field as focused context, so no `sources` array is needed.
 */
export type DocumentChatRecord = {
  id: string;
  documentId: string;
  boardPersistenceKey: string;
  title: string;
  mode: AgentMode;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};
