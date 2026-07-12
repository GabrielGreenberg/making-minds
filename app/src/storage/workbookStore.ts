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

import type { AssignmentData, AssignmentState, QuestionCircuit } from '../types';

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
}

/** Fresh, empty canvas state for one question. */
export function emptyQuestionCircuit(): QuestionCircuit {
  return { components: [], wires: [], textElements: [], comments: [], boxes: [], confirmedBoxes: [] };
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
): { questionCircuits: Map<number, QuestionCircuit>; currentQuestionIndex: number } {
  const questionCircuits = new Map<number, QuestionCircuit>();
  for (const q of def.questions) {
    const sc = saved?.questionCircuits[q.id];
    questionCircuits.set(q.id, sc ?? emptyQuestionCircuit());
  }
  const lastIndex = Math.max(def.questions.length - 1, 0);
  const currentQuestionIndex = saved
    ? Math.min(Math.max(saved.currentQuestionIndex, 0), lastIndex)
    : 0;
  return { questionCircuits, currentQuestionIndex };
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
      };
      // JSON object keys are strings; coerce back to numeric question ids.
      const questionCircuits: Record<number, QuestionCircuit> = {};
      for (const [k, v] of Object.entries(data.questionCircuits ?? {})) {
        questionCircuits[Number(k)] = v;
      }
      return {
        currentQuestionIndex: data.currentQuestionIndex ?? 0,
        questionCircuits,
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
}

export const localWorkbookStore: WorkbookStore = new LocalWorkbookStore();
