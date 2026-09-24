// Persistence seam for student workbook state.
//
// The UI/store talk to the `WorkbookStore` interface, never to localStorage
// directly, so a server-backed implementation can be dropped in later without
// touching the store. Mirrors the headless-engine/grader seam pattern.
//
// The interface is Promise-returning (a remote backend is intrinsically
// async); the local implementation resolves immediately — its bodies run
// synchronously before the first suspension, so an unload-time flush still
// lands the localStorage write.

import type { AssignmentData, AssignmentState, ConfirmedBoxDef, QuestionCircuit } from '../types';
import { deriveMintKey, DEV_MINT_SECRET } from '../provenance/ids';

export interface WorkbookStore {
  loadAssignmentState(id: string): Promise<AssignmentState | null>;
  /**
   * `opts.keepalive` marks an unload-time save: the remote impl lets the
   * request outlive the page (browser keepalive fetch, ~64KB body cap). The
   * local impl ignores it — its write is synchronous anyway.
   */
  saveAssignmentState(
    id: string,
    state: AssignmentState,
    opts?: { keepalive?: boolean },
  ): Promise<void>;
  /**
   * Opening an assignment: the saved state (as `loadAssignmentState`) AND this
   * person's mint key (hex) for it (task 034, provenance/ids.ts), in ONE
   * fetch. The server derives the key from its secret and returns it with the
   * workbook (the session names the person; `email` is ignored); local mode
   * derives it from the dev secret, with no /api call. `mintKey` is null when
   * there is none (a visitor; an older server).
   */
  loadForOpen(id: string, email: string | null): Promise<{ state: AssignmentState | null; mintKey: string | null }>;
}

/** Fresh, empty canvas state for one question. */
export function emptyQuestionCircuit(): QuestionCircuit {
  return { components: [], wires: [], boxes: [], confirmedBoxes: [] };
}

/**
 * Build the `questionCircuits` map for an assignment definition from saved state.
 * Pure (no storage), so the drift handling is unit-testable: circuits are kept
 * only for question ids that still exist in the definition; new/unknown ids get
 * an empty circuit; a saved id no longer present is dropped; the saved index is
 * clamped into range.
 */
export function restoreQuestionCircuits(
  def: AssignmentData,
  saved: AssignmentState | null,
): {
  questionCircuits: Map<number, QuestionCircuit>;
  currentQuestionIndex: number;
  boxLibrary: ConfirmedBoxDef[];
} {
  const questionCircuits = new Map<number, QuestionCircuit>();
  for (const q of def.questions) {
    const sc = saved?.questionCircuits[q.id];
    questionCircuits.set(q.id, sc ?? emptyQuestionCircuit());
  }
  const lastIndex = Math.max(def.questions.length - 1, 0);
  const currentQuestionIndex = saved
    ? Math.min(Math.max(saved.currentQuestionIndex, 0), lastIndex)
    : 0;
  return {
    questionCircuits,
    currentQuestionIndex,
    boxLibrary: restoreBoxLibrary(saved, questionCircuits),
  };
}

/**
 * The assignment-wide confirmed-box library. `boxLibrary` is authoritative
 * when present; a save that predates it kept one library PER QUESTION, so
 * those are merged (first occurrence of each id wins, in question order) —
 * which is exactly the sharing the student now gets, applied retroactively to
 * work they already have.
 */
export function restoreBoxLibrary(
  saved: AssignmentState | null,
  questionCircuits: Map<number, QuestionCircuit>,
): ConfirmedBoxDef[] {
  if (saved?.boxLibrary) return saved.boxLibrary;
  const merged: ConfirmedBoxDef[] = [];
  const seen = new Set<string>();
  for (const qc of questionCircuits.values()) {
    for (const box of qc.confirmedBoxes ?? []) {
      if (seen.has(box.id)) continue;
      seen.add(box.id);
      merged.push(box);
    }
  }
  return merged;
}

// Exported for the fill-empty migration (migrateLocal.ts), which scans
// localStorage for existing prototype workbooks on first remote login.
export const WORKBOOK_KEY_PREFIX = 'mm:asg:';
const KEY_PREFIX = WORKBOOK_KEY_PREFIX;

class LocalWorkbookStore implements WorkbookStore {
  async loadAssignmentState(id: string): Promise<AssignmentState | null> {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      if (!raw) return null;
      const data = JSON.parse(raw) as {
        currentQuestionIndex?: number;
        questionCircuits?: Record<string, QuestionCircuit>;
        boxLibrary?: ConfirmedBoxDef[];
      };
      // JSON object keys are strings; coerce back to numeric question ids.
      const questionCircuits: Record<number, QuestionCircuit> = {};
      for (const [k, v] of Object.entries(data.questionCircuits ?? {})) {
        questionCircuits[Number(k)] = v;
      }
      return {
        currentQuestionIndex: data.currentQuestionIndex ?? 0,
        questionCircuits,
        boxLibrary: data.boxLibrary,
      };
    } catch {
      return null;
    }
  }

  async saveAssignmentState(id: string, state: AssignmentState): Promise<void> {
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — silent fail (matches sandbox autosave).
    }
  }

  async loadForOpen(id: string, email: string | null): Promise<{ state: AssignmentState | null; mintKey: string | null }> {
    return {
      state: await this.loadAssignmentState(id),
      mintKey: email ? deriveMintKey(DEV_MINT_SECRET, email, id) : null,
    };
  }
}

export const localWorkbookStore: WorkbookStore = new LocalWorkbookStore();
