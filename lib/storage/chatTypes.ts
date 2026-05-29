import type { TLShapeId } from "tldraw";

/** Stable id of a single proposed edit; persisted in chat history. */
export type ProposalId = string;

export type ProposeEditInput = {
  anchor_before: string;
  old_text: string;
  anchor_after: string;
  new_text: string;
  rationale: string;
};

export type ProposeReplaceSectionInput = {
  heading: string;
  new_markdown: string;
  rationale: string;
};

export type ProposalKind = "propose_edit" | "propose_replace_section";

export type Proposal =
  | ({
      id: ProposalId;
      kind: "propose_edit";
      status: ProposalStatus;
    } & ProposeEditInput)
  | ({
      id: ProposalId;
      kind: "propose_replace_section";
      status: ProposalStatus;
    } & ProposeReplaceSectionInput);

export type ProposalStatus = "pending" | "accepted" | "rejected" | "stale" | "blocked";

export type ChatRole = "user" | "assistant";

/**
 * Persisted chat message. Tool calls live as a flat list of `proposals` on the
 * assistant message rather than nested content blocks — the on-disk format
 * stays trivially serializable and replay is just "render the proposals."
 */
export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  proposals?: Proposal[];
  createdAt: number;
  error?: string;
};

export type ChatRecord = {
  artifactId: TLShapeId;
  boardPersistenceKey: string;
  messages: ChatMessage[];
  updatedAt: number;
};
