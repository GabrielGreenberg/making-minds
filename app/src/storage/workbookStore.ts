// Persistence seam for student workbook state.
//
// The UI/store talk to the `WorkbookStore` interface, never to localStorage
// directly, so a server-backed implementation can be dropped in later without
// touching the store. Mirrors the headless-engine/grader seam pattern.

import type { AssignmentData, AssignmentState, QuestionCircuit } from '../types';

export interface WorkbookStore {
  loadAssignmentState(id: string): AssignmentState | null;
  saveAssignmentState(id: string, state: AssignmentState): void;
}

/** Fresh, empty canvas state for one question. */
export function emptyQuestionCircuit(): QuestionCircuit {
  return { components: [], wires: [], textElements: [], comments: [], boxes: [] };
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

const KEY_PREFIX = 'mm:asg:';

class LocalWorkbookStore implements WorkbookStore {
  loadAssignmentState(id: string): AssignmentState | null {
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

  saveAssignmentState(id: string, state: AssignmentState): void {
    try {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — silent fail (matches sandbox autosave).
    }
  }
}

export const localWorkbookStore: WorkbookStore = new LocalWorkbookStore();
