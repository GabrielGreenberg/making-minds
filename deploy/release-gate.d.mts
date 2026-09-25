// Types for deploy/release-gate.mjs (plain JS, run by node from release.sh),
// so server/tools/releaseGateCheck.ts can import it type-checked.

export type Verdict = 'release' | 'hold' | 'wait' | 'current';

export interface Reason {
  verdict: Verdict;
  rule: string;
  /** The full reason, for the console. */
  detail: string;
  /** What the one-line note says. */
  brief: string;
}

export interface GateResult {
  verdict: Verdict;
  reasons: Reason[];
  summary: string;
  note: string;
}

export interface AssignmentFact {
  id: string;
  title: string;
  visible: boolean;
  dueDate?: string;
}

export interface BoxFacts {
  head: string;
  timerActive: boolean;
  newestAt: Date | null;
}

export interface Facts {
  head: string;
  lastReleased: string | null;
  changedFiles: string[] | null;
  landed: { id: string; title: string }[];
  now: Date;
  assignments: AssignmentFact[] | null;
  apiProblem: string | null;
  boxProblem: string | null;
  backup: { timerActive: boolean; newestAt: Date | null } | null;
  /** HEAD's CI run on main; status 'none' = no run yet; null = gh couldn't say. */
  ci: CiRun | null;
  ciProblem: string | null;
}

export interface CiRun {
  status: string; // 'completed' | 'in_progress' | 'queued' | … | 'none'
  conclusion: string; // 'success' | 'failure' | 'cancelled' | … | ''
}

export const HOLD_PATHS: [string, string][];
export const QUIET_PATHS: [string, string][];
export const RELEASE_HOURS: { start: number; end: number; timeZone: string };
export const FREEZE_HOURS: number;
export const BACKUP_MAX_AGE_HOURS: number;

export function heldPaths(changedFiles: string[]): { path: string; why: string }[];
export function quietOnly(changedFiles: string[]): boolean;
export function decide(facts: Facts): GateResult;
export function noteKey(result: GateResult, head: string): string;
export function sshProbeBox(root: string): BoxFacts;
export function ghCiRun(root: string, head: string): CiRun;
export function listPilotAssignments(envPath: string): Promise<AssignmentFact[]>;
export function gatherFacts(opts?: {
  root?: string;
  envPath?: string;
  now?: Date;
  probeBox?: (root: string) => BoxFacts | Promise<BoxFacts>;
  listAssignments?: (envPath: string) => Promise<AssignmentFact[]>;
  probeCi?: (root: string, head: string) => CiRun | Promise<CiRun>;
}): Promise<Facts>;
