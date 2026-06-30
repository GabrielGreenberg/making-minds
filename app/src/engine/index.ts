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
export { evaluateSCSingleStep, evaluateSCSequence } from './sc';
export type { SCSingleStepResult } from './sc';
export { sortStateComponents, evaluateFSMSingleStep, evaluateFSMSequence } from './fsm';
export type { FSMStepResult, FSMEvalResult } from './fsm';
export {
  readCell,
  isSymbolForNotation,
  parseTMAction,
  parseTMTransition,
  applyAction,
  evaluateTMSingleStep,
  evaluateTMSequence,
  DEFAULT_TM_MAX_STEPS,
} from './tm';
export type {
  TMAction,
  TMActionToken,
  TMTape,
  TMStepResult,
  TMEvalResult,
  ParsedTMTransition,
} from './tm';
export { validateTMTable } from './tmValidate';
export type { TMValidationError, TMValidationKind } from './tmValidate';
export { encodeTM, acceptTM, decodeTM, notationForRepresentation } from './tmCodec';
export type { TMReject, AcceptOptions } from './tmCodec';
export {
  bitsToTally,
  bitsToBinary,
  interpretBits,
  valueToBits,
  isValidCodeword,
  bitsToValue,
} from './representation';
export {
  axisForMode,
  stepCountFor,
  encodeInput,
  decodeOutput,
  outputAccepted,
} from './codec';
export type { Axis, CodecLayout, EncodedInput, RawOutput } from './codec';
export { validateMachine } from './machineValidation';
export type { MachineValidation } from './machineValidation';
export { generateTestCases } from './testVectorGen';
export { gradeQuestion, gradeSubmission, summarizeResult } from './grader';
export type { CaseResult, QuestionResult, SubmissionResult } from './grader';
