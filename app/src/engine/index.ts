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
export {
  sortStateComponents,
  evaluateFSMSymbolStep,
  evaluateFSMSymbolSequence,
  evaluateFSMSingleStep,
  evaluateFSMSequence,
} from './fsm';
export type {
  FSMStepResult,
  FSMEvalResult,
  FSMSymbolStepResult,
  FSMSymbolEvalResult,
} from './fsm';
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
  TMMoveDir,
  TMTape,
  TMStepResult,
  TMEvalResult,
  ParsedTMTransition,
} from './tm';
export {
  fsmNotation,
  turbotFsmNotation,
  tmDualNotation,
  turbotInternalNotation,
  turbotExternalNotation,
  inputCharTokens,
  validateTransitionTable,
} from './notation';
export type {
  TransitionNotation,
  ParsedTransition as ParsedTransitionLabel,
  OutputField,
  TableError,
} from './notation';
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
  timeOutputBits,
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
export {
  senseAhead,
  senseAheadSymbol,
  decodeMotorCommand,
  applyMotorCommand,
  initialBrainState,
  runBrainStep,
  runTurbot,
  evaluateTurbotCriterion,
  stateKindOf,
  parseTurbotInternalLabel,
  parseTurbotExternalLabel,
  applyTurbotTapeAction,
  validateTurbotTM,
  TURBOT_FORWARD,
  TURBOT_TURN_RIGHT,
  TURBOT_TURN_LEFT,
  TURBOT_TM_READ_SYMBOLS,
  TURBOT_TM_INTERNAL_ACTIONS,
  TURBOT_TM_SENSES,
  TURBOT_TM_EXTERNAL_ACTIONS,
} from './turbot';
export type {
  BrainState,
  BrainStepResult,
  TurbotRunResult,
  TurbotTMInternalAction,
  TurbotTMInternalTransition,
  TurbotTMExternalTransition,
  TurbotTMValidationError,
} from './turbot';
