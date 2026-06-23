// Bundled assignment registry.
//
// The single source of built-in assignments and the swap point for a future
// server fetch: keep `listAssignments`/`getAssignment` stable and only their
// implementation changes when assignments move server-side.

import type { AssignmentData } from '../types';
import ccBasics from './cc-basics.json';

// JSON is inferred with widened types (e.g. buildMode: string), so assert to
// the domain type. Add new assignments by importing their JSON here.
const ASSIGNMENTS: AssignmentData[] = [ccBasics as unknown as AssignmentData];

export interface AssignmentSummary {
  id: string;
  title: string;
  questionCount: number;
}

/** Lightweight list for a catalog/home screen — no question details. */
export function listAssignments(): AssignmentSummary[] {
  return ASSIGNMENTS.map((a) => ({
    id: a.id,
    title: a.title,
    questionCount: a.questions.length,
  }));
}

/** Full definition for one assignment, or undefined if the id is unknown. */
export function getAssignment(id: string): AssignmentData | undefined {
  return ASSIGNMENTS.find((a) => a.id === id);
}
