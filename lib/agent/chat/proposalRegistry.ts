"use client";

import { useSyncExternalStore } from "react";
import type { Proposal, ProposalId } from "@/lib/storage/chatTypes";

/**
 * In-memory pending-proposal store keyed by artifact id. Lives only for the
 * lifetime of the focus-mode session — by design. Closing focus mode discards
 * pending proposals; the user re-prompts if needed.
 */

type State = Map<string, Map<ProposalId, Proposal>>;

const state: State = new Map();
const listeners = new Map<string, Set<() => void>>();

// Cached snapshot arrays per artifact. useSyncExternalStore requires
// getSnapshot to return the SAME reference between renders until the data
// actually changes — otherwise React re-renders without end. We rebuild a
// bucket's array only when it's mutated (invalidate clears the cache entry).
const snapshotCache = new Map<string, Proposal[]>();

function notify(artifactId: string) {
  snapshotCache.delete(artifactId);
  const set = listeners.get(artifactId);
  if (!set) return;
  for (const cb of set) cb();
}

function bucket(artifactId: string): Map<ProposalId, Proposal> {
  let b = state.get(artifactId);
  if (!b) {
    b = new Map();
    state.set(artifactId, b);
  }
  return b;
}

export function addProposal(artifactId: string, proposal: Proposal): void {
  bucket(artifactId).set(proposal.id, proposal);
  notify(artifactId);
}

export function updateProposal(
  artifactId: string,
  id: ProposalId,
  patch: Partial<Proposal>,
): void {
  const b = bucket(artifactId);
  const cur = b.get(id);
  if (!cur) return;
  // Two proposal shapes share Proposal union but identical `id`/`kind`/`status`
  // so the spread is safe.
  b.set(id, { ...cur, ...patch } as Proposal);
  notify(artifactId);
}

export function removeProposal(
  artifactId: string,
  id: ProposalId,
): void {
  bucket(artifactId).delete(id);
  notify(artifactId);
}

export function clearProposals(artifactId: string): void {
  state.delete(artifactId);
  notify(artifactId);
}

export function getProposals(artifactId: string): Proposal[] {
  const cached = snapshotCache.get(artifactId);
  if (cached) return cached;
  const b = state.get(artifactId);
  const snap = b && b.size > 0 ? Array.from(b.values()) : EMPTY;
  snapshotCache.set(artifactId, snap);
  return snap;
}

const EMPTY: Proposal[] = [];

export function subscribeProposals(
  artifactId: string,
  cb: () => void,
): () => void {
  let set = listeners.get(artifactId);
  if (!set) {
    set = new Set();
    listeners.set(artifactId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(artifactId);
  };
}

export function useProposals(artifactId: string): Proposal[] {
  return useSyncExternalStore(
    (cb) => subscribeProposals(artifactId, cb),
    () => getProposals(artifactId),
    () => EMPTY,
  );
}
