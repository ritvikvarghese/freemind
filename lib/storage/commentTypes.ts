export type Comment = {
  id: string;
  /** Anchor triple — same scheme as AI propose_edit. Used to re-locate the
   *  commented span when the doc changes. If the triple no longer matches
   *  uniquely the comment becomes "orphaned" and renders in the sidebar list. */
  anchor_before: string;
  anchor_text: string;
  anchor_after: string;
  body: string;
  createdAt: number;
  resolved: boolean;
};
