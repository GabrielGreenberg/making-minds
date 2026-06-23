// Public surface of the framework-agnostic simulation engine.
//
// Nothing under `engine/` may import React, Zustand, the store, or the DOM.
// Currently covers Combinatorial Circuits (CC); SC and FSM extraction follow
// the same pattern.

export {
  topologicalSort,
  evaluateGate,
  evaluateBoxedCircuit,
  evaluateCC,
  evaluateCCInputs,
} from './cc';
export type { CCEvalResult } from './cc';
export { bitsToTally, bitsToBinary, interpretBits } from './representation';
export { gradeQuestion, gradeSubmission } from './grader';
export type { CaseResult, QuestionResult, SubmissionResult } from './grader';
