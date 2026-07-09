// The per-email crash buffer — remote mode's unload-time safety net
// (docs/buildout/designs/remote-stores.md §2 "Durability without a cache").
//
// A graft, not a sync engine: the debounced seam save is the PRIMARY path.
// This module only buffers an open assignment's workbook state at the moments
// a remote save might die with the tab (unload-time flush, or a save that
// failed outright), and replays that buffer once, on the next
// `openAssignment` for the same (user, assignment). It is write-only in the
// steady state — never a read path, never a cache the UI consults.
//
// Keying is per EMAIL (`mm:journal:<email>:<assignmentId>`): shared lab
// browsers must not leak one student's circuits into another's session.
//
// Replay semantics (`reconcileJournal`): a buffer exists only if it was
// written AFTER the last confirmed server save from this browser (every
// confirmed save clears it), so on this browser it is at least as new as the
// server copy — replay uploads it and restores it into memory. If the same
// student also edited on ANOTHER device since, replay is last-write-wins,
// the memo's accepted pilot trade-off (§5): single-device is the norm, and a
// visible LWW beats silently dropping a crash's work. If the replay upload
// itself fails, the buffer is KEPT (next open retries) but still restored
// into memory — it is the student's newest work either way.
//
// GRADER-FREE ZONE (like remoteStores.ts): tools/remoteStoreCheck.ts
// grep-gates this module against engine-grader imports.

import type { AssignmentState } from '../types';
import type { WorkbookStore } from './workbookStore';

const JOURNAL_PREFIX = 'mm:journal:';

function journalKey(email: string, assignmentId: string): string {
  return `${JOURNAL_PREFIX}${email.toLowerCase()}:${assignmentId}`;
}

/** Synchronous by design: must land even mid-`pagehide`. */
export function writeJournal(email: string, assignmentId: string, state: AssignmentState): void {
  try {
    localStorage.setItem(journalKey(email, assignmentId), JSON.stringify(state));
  } catch {
    // localStorage full/unavailable — the keepalive fetch is still in flight;
    // same residual-loss class as the documented local-mode silent fail.
  }
}

export function readJournal(email: string, assignmentId: string): AssignmentState | null {
  try {
    const raw = localStorage.getItem(journalKey(email, assignmentId));
    if (!raw) return null;
    const data = JSON.parse(raw) as AssignmentState;
    if (typeof data?.currentQuestionIndex !== 'number' || !data.questionCircuits) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearJournal(email: string, assignmentId: string): void {
  try {
    localStorage.removeItem(journalKey(email, assignmentId));
  } catch {
    // ignore
  }
}

/**
 * The replay step of `openAssignment` (remote mode only): if a crash buffer
 * exists for this (user, assignment), it supersedes the fetched server state —
 * upload it, clear the buffer on confirmed upload, and return it as the state
 * to restore. No buffer → the server state passes through untouched.
 */
export async function reconcileJournal(
  email: string,
  assignmentId: string,
  saved: AssignmentState | null,
  store: WorkbookStore,
): Promise<AssignmentState | null> {
  const buffered = readJournal(email, assignmentId);
  if (!buffered) return saved;
  try {
    await store.saveAssignmentState(assignmentId, buffered);
    clearJournal(email, assignmentId);
  } catch {
    // Upload failed (server hiccup): keep the buffer for the next open —
    // but still restore it into memory; it is the newest local work.
  }
  return buffered;
}
