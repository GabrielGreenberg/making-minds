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
  sortByLabel,
} from './cc';
export type { CCEvalResult } from './cc';
export {
  scNetlist,
  evaluateSCStep,
  evaluateSCSequence,
  boxMemoryOutputs,
  stepBoxedMemory,
} from './sc';
export type { SCNetlist, SCStepResult } from './sc';
export {
  inlineSequentialBoxes,
  memorySlots,
  withMemState,
  zeroMemState,
  hasMemory,
  isSequentialBox,
  hasCombinationalLoop,
} from './netlist';
export type { Netlist, MemSlot } from './netlist';
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
} from './tm';
export {
  fsmNotation,
  turbotFsmNotation,
  tmNotation,
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
export {
  validateMachine,
  validateAllowedComponents,
  disallowedComponentTypes,
  isComponentTypeAllowed,
} from './machineValidation';
export type { MachineValidation } from './machineValidation';
export { generateTestCases } from './testVectorGen';
export {
  questionLayout,
  gradingCircuit,
  validateQuestionMachine,
  caseStimulus,
  recordedCaseSeparations,
  runValueCase,
  runTurbotCase,
  gradedMachineKey,
} from './caseRun';
export type { StageOne, ValueCaseRun, CaseStimulus } from './caseRun';
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
  criterionRequiresStop,
  stateKindOf,
  parseTurbotInternalLabel,
  parseTurbotExternalLabel,
  applyTurbotTapeAction,
  validateTurbotTM,
  validateTurbotFSM,
  TURBOT_FORWARD,
  TURBOT_TURN_RIGHT,
  TURBOT_TURN_LEFT,
  turbotTMReadSymbols,
  turbotTMInternalActions,
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
