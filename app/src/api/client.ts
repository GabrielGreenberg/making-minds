// Typed HTTP client for the Making Minds API server (server/).
//
// This is the browser half of the server seams: every function maps 1:1 to a
// server endpoint (see server/src/app.ts). The Remote* stores
// (storage/remoteStores.ts) and the remote AuthProvider (src/auth) are its
// consumers, selected by `backendMode` (storage/backend.ts):
//
//   RemoteWorkbookStore   → getWorkbook / getWorkbookFull / putWorkbook
//   RemoteAssignmentStore → listAssignments / getAssignment / putAssignment / deleteAssignment
//   RemoteSubmissionStore → submitAssignment / listSubmissions / listAllSubmissions / getClassmates
//   RemoteGradingStore    → putGrade / deleteGrade / getGradingSummary / getCourseGrading /
//                           getStudentGrading / getGradingAttempt /
//                           getQuestionResponses / postGradingClaim /
//                           putExtension / putWaiver /
//                           putGradingSettings / postStudentNote
//   remote auth           → login / logout / me
//
// Configuration: VITE_API_BASE (e.g. "https://api.phil133.example.edu") set at
// build time on Cloudflare Pages; empty default means same-origin "/api", which
// works when the API is reverse-proxied under the frontend's domain.
//
// The session token lives in localStorage under `mm:auth:token`. That's the
// standard bearer-token trade-off (readable by JS on our own origin) and is in
// line with the prototype's threat model; revisit (httpOnly cookie + CSRF) if
// the stakes rise.

import type {
  AssignmentData,
  AssignmentState,
  Classmate,
  HumanGrade,
  LateExtension,
  LateWaiver,
  Points,
  FeedbackCategory,
  FeedbackScreenshot,
  FeedbackStatus,
  InstructorNote,
  PlatformFeedback,
  StudentNote,
  SubmissionData,
  SubmissionRecord,
} from '../types';
import type { FlagThresholds } from '../storage/gradingFlags';
import type {
  AssignmentGradingSummary,
  AttemptDetail,
  CourseGrading,
  QuestionResponses,
  StudentGrading,
} from '../storage/gradingSummary';
import type { ClaimOutcome } from '../storage/gradingClaims';
import type { RegradeOutcome } from '../storage/regrade';

export interface ApiUser {
  email: string;
  name: string;
  role: 'student' | 'instructor';
  /** Campus ID from the roster; absent when the import had no ID column. */
  studentId?: string;
  registered?: boolean;
}

/**
 * What this server's sign-in system offers (GET /api/auth/config,
 * unauthenticated). The login screen renders from THIS, not from a build-time
 * constant, so switching the server to UCLA SSO — or to passwordless dev mode
 * — changes the UI without rebuilding the frontend.
 */
export interface AuthCapabilities {
  mode: 'password' | 'dev' | 'sso';
  usesPassword: boolean;
  allowsRegistration: boolean;
  allowsAccessRequests: boolean;
  passwordMinLength: number;
  ssoLoginUrl?: string;
}

/** One roster row with its account state — the instructor's roster screen. */
export interface RosterEntryView {
  /** A student's opaque key (`users.public_id`) — their student page's path
   *  (task 070); absent for an instructor. */
  key?: string;
  /** The account's key: the email it was first rostered under. */
  email: string;
  name: string;
  role: 'student' | 'instructor';
  /** The student ID as written. */
  studentId: string;
  /** The same ID normalised when VERIFIED (class list, instructor, SSO); ''
   *  when the ID on file was only typed into an access request. */
  uid: string;
  /** Discussion section from the class list; null when none was imported. */
  section: string | null;
  registered: boolean;
  registeredAt: string | null;
  /** The account's other sign-in addresses (a UCLA one beside a personal
   *  class-list one, a registrar change), oldest first. */
  aliases: string[];
}

export interface AccessRequestView {
  id: number;
  email: string;
  name: string;
  studentId: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** The roster account the request's student ID or email already names —
   *  approving then adds the email to it — or null for someone new. */
  match: { email: string; name: string } | null;
  /** Why approving would be refused (the ID and email name different
   *  people, …), or null. */
  conflict: string | null;
}

/** Where an add or an approval landed: a new account, or an existing one
 *  (`aliasAdded`: the email, now one of its sign-in addresses). */
export interface RosterPlacement {
  added: number;
  updated: number;
  account: string;
  aliasAdded: string | null;
}

/** What a roster import did (server/src/rosterImport.ts). It never removes
 *  anyone: `noLongerListed` is a list for the instructor to review. */
export interface RosterImportReport {
  added: number;
  updated: number;
  total: number;
  /** Physical line of the header row (a registrar preamble is skipped); null when none was found. */
  headerLine: number | null;
  /** Non-enrolled statuses seen: waitlisted/held imported, dropped/cancelled/withdrawn not. */
  statusCounts: { label: string; count: number; imported: boolean }[];
  /** Students a class list no longer carries: reason "status dropped" or "not in this file". */
  noLongerListed: { email: string; name: string; reason: string }[];
  issues: { line: number; reason: string }[];
  columns: {
    email: string | null;
    name: string | null;
    studentId: string | null;
    role: string | null;
    section: string | null;
    status: string | null;
  };
}

export interface AssignmentSummary {
  id: string;
  title: string;
  questionCount: number;
  gradesReleased: boolean;
  /** Whether students can see this assignment at all. Students only ever
   *  receive visible ones, so it is always true in a student's list. */
  visible: boolean;
  dueDate?: string;
  order?: number;
}

let apiBase: string = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';

/**
 * Harness-only override: point the client at an ephemeral test server
 * (tools/remoteStoreCheck.ts boots the real server on port 0 and injects its
 * URL here). The browser build never calls this — the base comes from
 * VITE_API_BASE at build time.
 */
export function setApiBase(url: string): void {
  apiBase = url;
}

const TOKEN_KEY = 'mm:auth:token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable — the session just won't persist across reloads.
  }
}

/** Thrown for any non-2xx response; `status` 401 means the session is gone. */
export class ApiError extends Error {
  status: number;
  /** The response's JSON body, for a refusal that carries more than a
   *  message (a 409's current grade). */
  body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Invoked on ANY 401 response (expired/revoked session, cleared roster row…)
// before the ApiError is thrown. The remote AuthProvider registers a handler
// that clears the token and drops back to the login screen, so a dead session
// can't leave the app half-working.
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { keepalive?: boolean },
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${apiBase}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Unload-time saves only: lets the request outlive the page. Browsers cap
    // keepalive bodies (~64KB), so this is best-effort — the crash-buffer
    // journal (storage/journal.ts) is the real safety net.
    ...(opts?.keepalive ? { keepalive: true } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, typeof json.error === 'string' ? json.error : res.statusText, json);
  }
  return json as T;
}

// ── health ───────────────────────────────────────────────────────

/**
 * Boot-time liveness probe (unauthenticated). True only for a 2xx from
 * GET /api/health; any network failure, timeout, or error status is `false` —
 * the caller (auth/HealthGate.tsx) shows the retry screen, never a white
 * screen or a silent local fallback.
 */
export async function health(timeoutMs = 4000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiBase}/api/health`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

// ── auth ─────────────────────────────────────────────────────────

/**
 * What the login screen should offer. Unauthenticated, and safe to call before
 * anything else — a server that is up always answers.
 */
export async function authConfig(): Promise<AuthCapabilities> {
  return request<AuthCapabilities>('GET', '/auth/config');
}

/**
 * Sign in and store the returned session token. `password` is omitted only
 * against a dev-mode server (passwordless roster login).
 */
export async function login(email: string, password?: string): Promise<ApiUser> {
  const { token, user } = await request<{ token: string; user: ApiUser }>('POST', '/auth/login', {
    email,
    ...(password != null ? { password } : {}),
  });
  setToken(token);
  return user;
}

/**
 * Create an account for a roster member. The student ID says which roster seat
 * (with none, the email must name an account that has no ID on file); the
 * email — the class-list one or a UCLA address — becomes one they sign in
 * with. The server signs the caller straight in on success.
 */
export async function register(input: {
  email: string;
  password: string;
  studentId?: string;
}): Promise<ApiUser> {
  const { token, user } = await request<{ token: string; user: ApiUser }>(
    'POST',
    '/auth/register',
    input,
  );
  setToken(token);
  return user;
}

/**
 * Change your own password. The server ends every other session and re-issues
 * this one, so the caller stays signed in here and nowhere else.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { token } = await request<{ ok: true; token: string | null }>('POST', '/auth/password', {
    currentPassword,
    newPassword,
  });
  if (token) setToken(token);
}

/**
 * "My email isn't the one on file" — files a request for an instructor to
 * review. Unauthenticated, and deliberately always succeeds: the response says
 * nothing about whether the email is already known.
 */
export async function requestAccess(input: {
  email: string;
  name: string;
  studentId?: string;
  message?: string;
}): Promise<void> {
  await request('POST', '/auth/access-requests', input);
}

export async function logout(): Promise<void> {
  try {
    await request('POST', '/auth/logout');
  } finally {
    setToken(null);
  }
}

export async function me(): Promise<ApiUser> {
  const { user } = await request<{ user: ApiUser }>('GET', '/auth/me');
  return user;
}

// ── roster + access requests (instructor) ────────────────────────

export async function getRoster(): Promise<RosterEntryView[]> {
  const { roster } = await request<{ roster: RosterEntryView[] }>('GET', '/roster');
  return roster;
}

/** Upsert roster rows from CSV text. Never removes anyone, never touches a
 *  password — a mid-quarter refresh must not sign the class out. */
export async function importRoster(
  csv: string,
  defaultRole: 'student' | 'instructor' = 'student',
): Promise<RosterImportReport> {
  return request<RosterImportReport>('POST', '/roster/import', { csv, defaultRole });
}

/** Add one person — or, when the ID or email is already on the roster,
 *  update them (a new email becoming one of their sign-in addresses). */
export async function addRosterEntry(input: {
  email: string;
  name?: string;
  role?: 'student' | 'instructor';
  studentId?: string;
}): Promise<RosterPlacement> {
  return request<RosterPlacement>('POST', '/roster', input);
}

/** Drop one of an account's extra sign-in addresses (never its key). When it
 *  is the address the account was set up through, the server also clears that
 *  password and ends its sessions (`credentialCleared`). */
export async function removeRosterAlias(email: string, alias: string): Promise<{ credentialCleared: boolean }> {
  return request('DELETE', `/roster/${encodeURIComponent(email)}/aliases/${encodeURIComponent(alias)}`);
}

export async function removeRosterEntry(email: string): Promise<void> {
  await request('DELETE', `/roster/${encodeURIComponent(email)}`);
}

/** Forgotten password: clears the credential so they can register again. */
export async function resetRosterPassword(email: string): Promise<void> {
  await request('POST', `/roster/${encodeURIComponent(email)}/reset-password`);
}

export async function listAccessRequests(
  status?: 'pending' | 'approved' | 'rejected',
): Promise<AccessRequestView[]> {
  const { requests } = await request<{ requests: AccessRequestView[] }>(
    'GET',
    `/access-requests${status ? `?status=${status}` : ''}`,
  );
  return requests;
}

/** Approving adds them to the roster (or, when the request names someone on
 *  it, adds the email to that account); they then create an account normally. */
export async function approveAccessRequest(
  id: number,
  role: 'student' | 'instructor' = 'student',
): Promise<{ email: string; account: string; accountName: string; aliasAdded: string | null }> {
  return request('POST', `/access-requests/${id}/approve`, { role });
}

export async function rejectAccessRequest(id: number): Promise<void> {
  await request('POST', `/access-requests/${id}/reject`);
}

// ── assignments ──────────────────────────────────────────────────

export async function listAssignments(): Promise<AssignmentSummary[]> {
  const { assignments } = await request<{ assignments: AssignmentSummary[] }>(
    'GET',
    '/assignments',
  );
  return assignments;
}

/** Students receive the assignment with `test_cases` stripped server-side. */
export async function getAssignment(
  id: string,
): Promise<{ assignment: AssignmentData; gradesReleased: boolean; visible: boolean }> {
  return request<{ assignment: AssignmentData; gradesReleased: boolean; visible: boolean }>(
    'GET',
    `/assignments/${encodeURIComponent(id)}`,
  );
}

export async function putAssignment(assignment: AssignmentData): Promise<void> {
  await request('PUT', `/assignments/${encodeURIComponent(assignment.id)}`, assignment);
}

export async function deleteAssignment(id: string): Promise<void> {
  await request('DELETE', `/assignments/${encodeURIComponent(id)}`);
}

/**
 * Instructor only: release (or hide again) grades for an assignment. Students
 * see no grades at all — including on submit — until this is flipped on.
 */
export async function setGradesReleased(id: string, released: boolean): Promise<void> {
  await request('PUT', `/assignments/${encodeURIComponent(id)}/grades-release`, { released });
}

/**
 * Instructor only: publish an assignment to students, or hide it again. A
 * hidden assignment is absent from a student's list and 404s on fetch — they
 * are not told it exists.
 */
export async function setVisible(id: string, visible: boolean): Promise<void> {
  await request('PUT', `/assignments/${encodeURIComponent(id)}/visibility`, { visible });
}

// ── workbooks (autosave) ─────────────────────────────────────────

export async function getWorkbook(assignmentId: string): Promise<AssignmentState | null> {
  return (await getWorkbookFull(assignmentId)).state;
}

/** The workbook fetch in full: the saved state plus the caller's mint key for
 *  the assignment (task 034; absent from a server that predates it). */
export async function getWorkbookFull(
  assignmentId: string,
): Promise<{ state: AssignmentState | null; mintKey?: string }> {
  return request<{ state: AssignmentState | null; mintKey?: string }>(
    'GET',
    `/workbooks/${encodeURIComponent(assignmentId)}`,
  );
}

export async function putWorkbook(
  assignmentId: string,
  state: AssignmentState,
  opts?: { keepalive?: boolean },
): Promise<void> {
  await request('PUT', `/workbooks/${encodeURIComponent(assignmentId)}`, state, opts);
}

// ── submissions ──────────────────────────────────────────────────

/**
 * Submit answers (+ the listed group, task 062); the server stamps identity +
 * timestamp, checks the group, grades, and returns the record (per-case
 * detail already stripped for students). A refused group is a 400.
 */
export async function submitAssignment(
  assignmentId: string,
  answers: SubmissionData['answers'],
  group?: string[],
): Promise<SubmissionRecord> {
  const { record } = await request<{ record: SubmissionRecord }>(
    'POST',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions`,
    group?.length ? { answers, group } : { answers },
  );
  return record;
}

/** The roster's students as the caller may see them — names + opaque keys,
 *  the caller left out (task 062: the submit dialog's group picker). */
export async function getClassmates(): Promise<Classmate[]> {
  const { classmates } = await request<{ classmates: Classmate[] }>('GET', '/classmates');
  return classmates;
}

/**
 * The caller's own attempts, any role — the session names the person (an
 * instructor's Student view sees only the instructor's own; task 037).
 */
export async function listSubmissions(assignmentId: string): Promise<SubmissionRecord[]> {
  const { records } = await request<{ records: SubmissionRecord[] }>(
    'GET',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions`,
  );
  return records;
}

/** Instructor only: every student's attempts, full detail (the gradebook). */
export async function listAllSubmissions(assignmentId: string): Promise<SubmissionRecord[]> {
  const { records } = await request<{ records: SubmissionRecord[] }>(
    'GET',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions/all`,
  );
  return records;
}

/**
 * Instructor only: write one human grade (task 063) — a hand grade, or an
 * override of an autograde (note required) — on the student's latest
 * attempt. `version` is the grade's version as read (null = none); a stale
 * one is a 409 whose body carries the `current` grade. `studentKey` is the
 * student's opaque key (`SubmissionRecord.studentKey`), never an email.
 */
export async function putGrade(
  assignmentId: string,
  studentKey: string,
  questionId: number,
  write: { points: Points; note?: string; version: number | null },
): Promise<HumanGrade> {
  const { grade } = await request<{ grade: HumanGrade }>(
    'PUT',
    `/assignments/${encodeURIComponent(assignmentId)}/grades/${encodeURIComponent(studentKey)}/${questionId}`,
    write,
  );
  return grade;
}

/** Instructor only: clear one human grade (the autograde, or pending, again). */
export async function deleteGrade(
  assignmentId: string,
  studentKey: string,
  questionId: number,
  version: number,
): Promise<void> {
  await request(
    'DELETE',
    `/assignments/${encodeURIComponent(assignmentId)}/grades/${encodeURIComponent(studentKey)}/${questionId}`,
    { version },
  );
}

/** Instructor only: give one student their own due date on an assignment
 *  (task 068), or clear it (null). Returns the stored extension (null =
 *  cleared); a bad body is a 400, an unknown student a 404. */
export async function putExtension(assignmentId: string, studentKey: string, dueDate: string | null): Promise<LateExtension | null> {
  const { extension } = await request<{ extension: LateExtension | null }>(
    'PUT',
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentKey)}/extension`,
    { dueDate },
  );
  return extension;
}

/** Instructor only: waive late points for one student ({points, note?}), or
 *  clear the waiver (null). Returns the stored waiver (null = cleared). */
export async function putWaiver(
  assignmentId: string,
  studentKey: string,
  write: { points: number; note?: string } | null,
): Promise<LateWaiver | null> {
  const { waiver } = await request<{ waiver: LateWaiver | null }>(
    'PUT',
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentKey)}/waiver`,
    write ?? { clear: true },
  );
  return waiver;
}

/** Instructor only: one assignment's grading summary (task 064) — a row per
 *  roster student and per other submitter, no circuits. */
export function getGradingSummary(assignmentId: string): Promise<AssignmentGradingSummary> {
  return request<AssignmentGradingSummary>('GET', `/assignments/${encodeURIComponent(assignmentId)}/summary`);
}

/** Instructor only: re-grade an assignment's stale latest attempts against
 *  its current version (task 069) — `dryRun` returns the plan and writes
 *  nothing; a commit naming `expectHash` is a 409 (body: the fresh `plan`)
 *  when the assignment changed since. */
export function postRegrade(assignmentId: string, body: { dryRun: boolean; expectHash?: string }): Promise<RegradeOutcome> {
  return request<RegradeOutcome>('POST', `/assignments/${encodeURIComponent(assignmentId)}/regrade`, body);
}

/** Instructor only: every assignment's grading progress + course-wide counts. */
export function getCourseGrading(): Promise<CourseGrading> {
  return request<CourseGrading>('GET', '/grading');
}

/** Instructor only: one student (by opaque key) across assignments. */
export function getStudentGrading(studentKey: string): Promise<StudentGrading> {
  return request<StudentGrading>('GET', `/students/${encodeURIComponent(studentKey)}`);
}

/** Instructor only: store the course's flag thresholds (task 070) — the
 *  server normalizes them and returns what it stored. */
export async function putGradingSettings(thresholds: Partial<FlagThresholds>): Promise<FlagThresholds> {
  const { thresholds: stored } = await request<{ thresholds: FlagThresholds }>('PUT', '/grading/settings', { thresholds });
  return stored;
}

/** Instructor only: add one private note to a student's log (append-only). */
export async function postStudentNote(studentKey: string, body: string): Promise<StudentNote> {
  const { note } = await request<{ note: StudentNote }>('POST', `/students/${encodeURIComponent(studentKey)}/notes`, { body });
  return note;
}

/** Instructor only: one attempt in full (circuits, expected/got, integrity,
 *  grades, that student's grade log). */
export function getGradingAttempt(assignmentId: string, studentKey: string, attempt: number): Promise<AttemptDetail> {
  return request<AttemptDetail>(
    'GET',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(studentKey)}/${encodeURIComponent(String(attempt))}`,
  );
}

/** Instructor only: the hand-grading queue's feed (task 066) — one problem
 *  across every submitter's latest attempt, with grades and live claims. */
export function getQuestionResponses(assignmentId: string, questionId: number): Promise<QuestionResponses> {
  return request<QuestionResponses>(
    'GET',
    `/assignments/${encodeURIComponent(assignmentId)}/questions/${encodeURIComponent(String(questionId))}/responses`,
  );
}

/** Instructor only: claim (renew) or release a soft claim on one response.
 *  The student is named by their opaque key in the body, never in a path. */
export function postGradingClaim(input: {
  assignmentId: string;
  studentKey: string;
  questionId: number;
  release?: boolean;
}): Promise<ClaimOutcome> {
  return request<ClaimOutcome>('POST', '/grading/claims', input);
}

// ── feedback ─────────────────────────────────────────────────────

/** File a report. The server stamps `student`/`createdAt`/`status`. */
export async function submitFeedback(input: {
  category: FeedbackCategory;
  message: string;
  screenshots: FeedbackScreenshot[];
  context?: { assignmentId?: string; questionId?: number };
}): Promise<PlatformFeedback> {
  const { feedback } = await request<{ feedback: PlatformFeedback }>('POST', '/feedback', input);
  return feedback;
}

/** Instructor only: the full queue, newest first. */
export async function listFeedback(): Promise<PlatformFeedback[]> {
  const { feedback } = await request<{ feedback: PlatformFeedback[] }>('GET', '/feedback');
  return feedback;
}

/** Instructor only: mark a report resolved, or reopen it. */
export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  await request('PUT', `/feedback/${encodeURIComponent(id)}/status`, { status });
}

// ── instructor notes ─────────────────────────────────────────────

export async function getInstructorNote(): Promise<InstructorNote | null> {
  const { note } = await request<{ note: InstructorNote | null }>('GET', '/instructor-notes');
  return note;
}

/** The server stamps `updatedBy` from the session and `updatedAt` from its
 *  own clock — the same identity/time discipline as submissions. */
export async function saveInstructorNote(content: string): Promise<InstructorNote> {
  const { note } = await request<{ note: InstructorNote }>('PUT', '/instructor-notes', { content });
  return note;
}
