// Typed HTTP client for the Making Minds API server (server/).
//
// This is the browser half of the server seams: every function maps 1:1 to a
// server endpoint (see server/src/app.ts). Nothing imports it yet — the app
// still runs on the Local* stores — but it is the ready-made building block for
// the Remote* store implementations when we cut over:
//
//   RemoteWorkbookStore   → getWorkbook / putWorkbook
//   RemoteAssignmentStore → listAssignments / getAssignment / putAssignment / deleteAssignment
//   RemoteSubmissionStore → submitAssignment / listSubmissions
//   real auth             → login / logout / me (replacing src/auth/stubAuth)
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
  SubmissionData,
  SubmissionRecord,
} from '../types';

export interface ApiUser {
  email: string;
  name: string;
  role: 'student' | 'instructor';
}

export interface AssignmentSummary {
  id: string;
  title: string;
  questionCount: number;
  gradesReleased: boolean;
}

const API_BASE: string = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, typeof json.error === 'string' ? json.error : res.statusText);
  }
  return json as T;
}

// ── auth ─────────────────────────────────────────────────────────

/** Dev-mode login by roster email; stores the returned token for later calls. */
export async function login(email: string): Promise<ApiUser> {
  const { token, user } = await request<{ token: string; user: ApiUser }>('POST', '/auth/login', {
    email,
  });
  setToken(token);
  return user;
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
): Promise<{ assignment: AssignmentData; gradesReleased: boolean }> {
  return request<{ assignment: AssignmentData; gradesReleased: boolean }>(
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

// ── workbooks (autosave) ─────────────────────────────────────────

export async function getWorkbook(assignmentId: string): Promise<AssignmentState | null> {
  const { state } = await request<{ state: AssignmentState | null }>(
    'GET',
    `/workbooks/${encodeURIComponent(assignmentId)}`,
  );
  return state;
}

export async function putWorkbook(assignmentId: string, state: AssignmentState): Promise<void> {
  await request('PUT', `/workbooks/${encodeURIComponent(assignmentId)}`, state);
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
