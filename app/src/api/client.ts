// Typed HTTP client for the Making Minds API server (server/).
//
// This is the browser half of the server seams: every function maps 1:1 to a
// server endpoint (see server/src/app.ts). The Remote* stores
// (storage/remoteStores.ts) and the remote AuthProvider (src/auth) are its
// consumers, selected by `backendMode` (storage/backend.ts):
//
//   RemoteWorkbookStore   → getWorkbook / putWorkbook
//   RemoteAssignmentStore → listAssignments / getAssignment / putAssignment / deleteAssignment
//   RemoteSubmissionStore → submitAssignment / listSubmissions / reviewSubmission
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
  FeedbackCategory,
  FeedbackScreenshot,
  FeedbackStatus,
  InstructorNote,
  PlatformFeedback,
  SubmissionData,
  SubmissionRecord,
} from '../types';

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
  email: string;
  name: string;
  role: 'student' | 'instructor';
  studentId: string;
  registered: boolean;
  registeredAt: string | null;
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
}

export interface RosterImportReport {
  added: number;
  updated: number;
  total: number;
  issues: { line: number; reason: string }[];
  columns: { email: string | null; name: string | null; studentId: string | null; role: string | null };
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

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
    throw new ApiError(res.status, typeof json.error === 'string' ? json.error : res.statusText);
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
 * Create an account for a roster member. The server checks the email against
 * the roster (and the student ID against the one on file, when it has one) and
 * signs the caller straight in on success.
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

export async function addRosterEntry(input: {
  email: string;
  name?: string;
  role?: 'student' | 'instructor';
  studentId?: string;
}): Promise<void> {
  await request('POST', '/roster', input);
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

/** Approving adds them to the roster; they then create an account normally. */
export async function approveAccessRequest(
  id: number,
  role: 'student' | 'instructor' = 'student',
): Promise<void> {
  await request('POST', `/access-requests/${id}/approve`, { role });
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
  const { state } = await request<{ state: AssignmentState | null }>(
    'GET',
    `/workbooks/${encodeURIComponent(assignmentId)}`,
  );
  return state;
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
 * Submit answers; the server stamps identity + timestamp, grades, and returns
 * the record (per-case detail already stripped for students).
 */
export async function submitAssignment(
  assignmentId: string,
  answers: SubmissionData['answers'],
): Promise<SubmissionRecord> {
  const { record } = await request<{ record: SubmissionRecord }>(
    'POST',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions`,
    { answers },
  );
  return record;
}

/** Student: own attempts. Instructor: every student's attempts (gradebook). */
export async function listSubmissions(assignmentId: string): Promise<SubmissionRecord[]> {
  const { records } = await request<{ records: SubmissionRecord[] }>(
    'GET',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions`,
  );
  return records;
}

/**
 * Instructor only: record (or overwrite) a manual verdict on a pending open
 * question of one stored attempt. `student` identifies whose attempt — server
 * attempt numbers count per (assignment, student), so the attempt alone is
 * ambiguous. The server stamps `reviewedAt` and applies the same pure
 * `applyManualReview` the local store uses; returns the updated (full,
 * instructor-view) record.
 */
export async function reviewSubmission(
  assignmentId: string,
  student: string,
  attempt: number,
  questionId: number,
  review: { pass: boolean; note?: string },
): Promise<SubmissionRecord> {
  const { record } = await request<{ record: SubmissionRecord }>(
    'POST',
    `/assignments/${encodeURIComponent(assignmentId)}/submissions/${attempt}/review`,
    { student, questionId, pass: review.pass, note: review.note },
  );
  return record;
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
