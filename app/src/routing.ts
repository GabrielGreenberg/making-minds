// Hash-based routing seam.
//
// The URL hash is the single record of *where* you are (Home / Sandbox /
// which assignment + question). Persistence (`WorkbookStore`) already keeps the
// *work* safe across reloads; routing restores the *location* so a reload or the
// Back button drops you back into the assignment instead of on Home.
//
// We use the History API (push/replaceState + popstate) with hash URLs so no
// server config is needed under the `/making-minds/` base path. UI intents call
// `navigate(...)`; that updates history and applies the route. Back/Forward fire
// `popstate`, which re-applies. pushState/replaceState do NOT fire popstate, so
// there is no feedback loop and we never listen to `hashchange`.

import { useStore } from './store';
import { instructorRole } from './auth/instructorRole';
import type { FeedbackContext } from './types';

export type Route =
  | { kind: 'home' }
  | { kind: 'sandbox' }
  | { kind: 'grades'; id?: string }
  // attempt: a submitted attempt shown read-only instead of the live
  // workbook (task 003, store viewSubmission) — absent = the live workbook
  // (or, frozen, the latest submission). caseIndex: a graded case to load
  // into the question's run ("Run this input" on the grade sheet) — only
  // meaningful with a questionIndex. student: ANOTHER person's attempt on
  // show (task 067 — an instructor viewing a student's, store
  // openSubmissionOf; `attempt` is then required), keyed like the Grading
  // tab's routes; absent = the principal's own.
  | { kind: 'assignment'; id: string; attempt?: number; questionIndex?: number; caseIndex?: number; student?: string }
  | { kind: 'instructor' }
  | { kind: 'instructor-new-assignment' }
  | { kind: 'instructor-edit'; id: string }
  // The Grading tab (task 065; memo grading-interface.md §6): the course
  // list, one assignment's Overview · Matrix · Queue (`questionId`: the queue
  // for one problem, by problem; `student`: the queue by student, task 066),
  // one student's submission on an assignment, and one student across
  // assignments. `student` is always GradingIdentity.key —
  // opaque (remote: the account's public_id), never an email or a UID.
  | { kind: 'instructor-grading' }
  | { kind: 'instructor-grading-assignment'; id: string; view: GradingView; questionId?: number; student?: string }
  | { kind: 'instructor-grading-student'; id: string; student: string }
  | { kind: 'instructor-student'; student: string }
  | { kind: 'instructor-roster' }
  | { kind: 'instructor-feedback' }
  | { kind: 'instructor-notes' }
  // The robot's state (task 083): what the pilot runs, what waits for
  // release, what waits for an answer, the queue's recent activity.
  | { kind: 'instructor-robot' };

/** An assignment's grading views (the segmented control; the URL keeps it). */
export type GradingView = 'overview' | 'matrix' | 'queue';

/** A hash's path segments, still URI-encoded. */
function hashParts(hash: string): string[] {
  return hash.replace(/^#/, '').replace(/^\/+/, '').split('/').filter(Boolean);
}

/** A non-negative integer URL segment, or undefined. */
function indexSegment(part: string | undefined): number | undefined {
  if (part == null) return undefined;
  const n = Number(part);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** An attempt number URL segment (an integer ≥ 1), or undefined. */
function attemptSegment(part: string | undefined): number | undefined {
  const n = indexSegment(part);
  return n !== undefined && n >= 1 ? n : undefined;
}

/** Parse a location hash (e.g. "#/a/hw1/q/2") into a Route. Pure. */
export function parseHash(hash: string): Route {
  const parts = hashParts(hash);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'sandbox') return { kind: 'sandbox' };
  // #/grades | #/grades/:id — Home's Grades tab, optionally with one sheet open
  if (parts[0] === 'grades') {
    return parts[1] ? { kind: 'grades', id: decodeURIComponent(parts[1]) } : { kind: 'grades' };
  }
  if (parts[0] === 'instructor') {
    // #/instructor/roster
    // #/instructor/assignments/new | .../:id/edit
    // #/instructor/grading[/:asg[/matrix | /queue[/:qid | /student/:sid] | /student/:sid[/submission/:n[/q/:i[/case/:k]]]]]
    // #/instructor/students/:sid
    if (parts[1] === 'grading') {
      if (!parts[2]) return { kind: 'instructor-grading' };
      const id = decodeURIComponent(parts[2]);
      if (parts[3] === 'matrix') return { kind: 'instructor-grading-assignment', id, view: 'matrix' };
      if (parts[3] === 'queue') {
        // By student (task 066): one student's pending problems.
        if (parts[4] === 'student' && parts[5]) {
          return { kind: 'instructor-grading-assignment', id, view: 'queue', student: decodeURIComponent(parts[5]) };
        }
        // A malformed problem id is dropped; the queue is kept.
        const questionId = indexSegment(parts[4]);
        return questionId !== undefined
          ? { kind: 'instructor-grading-assignment', id, view: 'queue', questionId }
          : { kind: 'instructor-grading-assignment', id, view: 'queue' };
      }
      if (parts[3] === 'student' && parts[4]) {
        const student = decodeURIComponent(parts[4]);
        // The viewer (task 067): that student's attempt n in the read-only
        // editor. A malformed or missing attempt is their submission page.
        if (parts[5] === 'submission') {
          const attempt = attemptSegment(parts[6]);
          if (attempt !== undefined) {
            return withQuestion({ kind: 'assignment', id, student, attempt }, parts.slice(7));
          }
        }
        return { kind: 'instructor-grading-student', id, student };
      }
      // No view, or one we don't know: the Overview.
      return { kind: 'instructor-grading-assignment', id, view: 'overview' };
    }
    if (parts[1] === 'students') {
      return parts[2] ? { kind: 'instructor-student', student: decodeURIComponent(parts[2]) } : { kind: 'instructor-grading' };
    }
    if (parts[1] === 'roster') return { kind: 'instructor-roster' };
    if (parts[1] === 'feedback') return { kind: 'instructor-feedback' };
    if (parts[1] === 'notes') return { kind: 'instructor-notes' };
    if (parts[1] === 'robot') return { kind: 'instructor-robot' };
    if (parts[1] === 'assignments') {
      if (parts[2] === 'new') return { kind: 'instructor-new-assignment' };
      if (parts[2]) {
        const id = decodeURIComponent(parts[2]);
        if (parts[3] === 'edit') return { kind: 'instructor-edit', id };
        // The retired gradebook's URL: its assignment's grading Overview
        // (initRouting rewrites the URL — canonicalHash).
        if (parts[3] === 'submissions') return { kind: 'instructor-grading-assignment', id, view: 'overview' };
      }
    }
    return { kind: 'instructor' };
  }
  if (parts[0] === 'a' && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    // #/a/:id[/submission/:n][/q/:i[/case/:k]] — a malformed attempt or case
    // segment is dropped, the rest kept.
    let rest = parts.slice(2);
    let attempt: number | undefined;
    if (rest[0] === 'submission') {
      attempt = attemptSegment(rest[1]);
      rest = rest.slice(2);
    }
    return withQuestion(attempt !== undefined ? { kind: 'assignment', id, attempt } : { kind: 'assignment', id }, rest);
  }
  return { kind: 'home' };
}

/** An assignment route's `[/q/:i[/case/:k]]` tail — a malformed question or
 *  case segment is dropped, the rest kept. */
function withQuestion(route: Extract<Route, { kind: 'assignment' }>, rest: string[]): Route {
  const qi = rest[0] === 'q' ? indexSegment(rest[1]) : undefined;
  if (qi === undefined) return route;
  const k = rest[2] === 'case' ? indexSegment(rest[3]) : undefined;
  return k !== undefined ? { ...route, questionIndex: qi, caseIndex: k } : { ...route, questionIndex: qi };
}

/** Serialize a Route to a location hash. Pure. Inverse of parseHash. */
export function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'sandbox':
      return '#/sandbox';
    case 'grades':
      return route.id ? `#/grades/${encodeURIComponent(route.id)}` : '#/grades';
    case 'assignment': {
      const base =
        route.student != null
          ? `#/instructor/grading/${encodeURIComponent(route.id)}/student/${encodeURIComponent(route.student)}/submission/${route.attempt ?? 1}`
          : `#/a/${encodeURIComponent(route.id)}` + (route.attempt != null ? `/submission/${route.attempt}` : '');
      if (route.questionIndex == null) return base;
      return route.caseIndex != null
        ? `${base}/q/${route.questionIndex}/case/${route.caseIndex}`
        : `${base}/q/${route.questionIndex}`;
    }
    case 'instructor':
      return '#/instructor';
    case 'instructor-roster':
      return '#/instructor/roster';
    case 'instructor-feedback':
      return '#/instructor/feedback';
    case 'instructor-notes':
      return '#/instructor/notes';
    case 'instructor-robot':
      return '#/instructor/robot';
    case 'instructor-new-assignment':
      return '#/instructor/assignments/new';
    case 'instructor-edit':
      return `#/instructor/assignments/${encodeURIComponent(route.id)}/edit`;
    case 'instructor-grading':
      return '#/instructor/grading';
    case 'instructor-grading-assignment': {
      const base = `#/instructor/grading/${encodeURIComponent(route.id)}`;
      if (route.view === 'matrix') return `${base}/matrix`;
      if (route.view === 'queue') {
        if (route.student != null) return `${base}/queue/student/${encodeURIComponent(route.student)}`;
        return route.questionId != null ? `${base}/queue/${route.questionId}` : `${base}/queue`;
      }
      return base;
    }
    case 'instructor-grading-student':
      return `#/instructor/grading/${encodeURIComponent(route.id)}/student/${encodeURIComponent(route.student)}`;
    case 'instructor-student':
      return `#/instructor/students/${encodeURIComponent(route.student)}`;
  }
}

/**
 * The hash a location should show. A retired URL — the old gradebook's
 * `#/instructor/assignments/:id/submissions` — becomes its route's own hash
 * (`#/instructor/grading/:id`); every other hash is left exactly as typed
 * (rewriting all of them would mangle a deep link mid-edit). Pure.
 */
export function canonicalHash(hash: string): string {
  const parts = hashParts(hash);
  const legacy = parts[0] === 'instructor' && parts[1] === 'assignments' && !!parts[2] && parts[2] !== 'new' && parts[3] === 'submissions';
  return legacy ? routeToHash(parseHash(hash)) : hash;
}

// Monotonic token bumped per applyRoute call: the assignment branch resolves
// asynchronously (openAssignment awaits the storage seams), and its
// continuation must not apply view state if a newer navigation has since been
// applied.
let applySeq = 0;

// ── Access: who may enter a route ────────────────────────────────────────
//
// Access is a property of the ROUTE, not a wall in front of the app: a
// visitor (nobody signed in) may use the public surfaces — today the sandbox,
// which needs no identity and no server — while everything that reads the
// storage seams needs a signed-in user, and the instructor area the
// instructor role. A new public surface is one line here.
//
// One front door: the bare site (`#/`) is Home, which needs sign-in, so
// anyone not signed in who opens it meets the sign-in screen — whatever the
// browser's history — and that screen offers the sandbox as its second
// choice. Only an explicit `#/sandbox` (the website's link) skips it.

export type RouteAccess = 'public' | 'signed-in' | 'instructor';

/** Who may enter a route. Pure. */
export function routeAccess(route: Route): RouteAccess {
  switch (route.kind) {
    case 'sandbox':
      return 'public';
    case 'assignment':
      // Another person's attempt is the instructor's to see (task 067).
      return route.student != null ? 'instructor' : 'signed-in';
    case 'home':
    case 'grades':
      return 'signed-in';
    case 'instructor':
    case 'instructor-new-assignment':
    case 'instructor-edit':
    case 'instructor-grading':
    case 'instructor-grading-assignment':
    case 'instructor-grading-student':
    case 'instructor-student':
    case 'instructor-roster':
    case 'instructor-feedback':
    case 'instructor-notes':
    case 'instructor-robot':
      return 'instructor';
  }
}

// Who is signed in, as far as applying routes is concerned (set by AuthGate
// from the auth provider; null = nobody, the visitor). A route that needs
// sign-in is NOT applied to the store while nobody is (a deep link must not
// fire an unauthenticated openAssignment — in remote mode it would just 401);
// it is HELD: the URL stays, and the gate shows the sign-in screen.
//
// Every principal change re-applies the current URL. The auth provider has
// just reset the whole editor store for the new person (store.ts
// resetForPrincipal), so the store no longer matches the URL: re-applying
// releases a held route on sign-in (`#/a/hw1` opened logged-out lands on hw1
// right after the sign-in screen), holds a signed-in route on sign-out or a
// 401, and enters the sandbox on `#/sandbox` — the new person's own — unless
// one is already open (the store keeps an open sandbox open across its reset).
let principal: string | null = null;
let signedIn = false;

/** Tell routing who is signed in (null = nobody); a change re-applies the URL. */
export function setRoutingPrincipal(email: string | null): void {
  if (email === principal) return;
  principal = email;
  signedIn = email != null;
  if (!routingStarted) return;
  const route = parseHash(location.hash);
  // A sandbox already on screen is already the right person's: the store
  // keeps it open across its own reset (resetForPrincipal), and a restored
  // session that confirms the person the store was booted for (the auth
  // provider's token hint) resets nothing. Re-entering would reload the
  // active tab's last save over the live canvas.
  const { workbookOpen, assignment } = useStore.getState();
  if (route.kind === 'sandbox' && workbookOpen && assignment === null) return;
  applyRoute(route);
}

/** Drive the store to match a route. The only place navigation state is applied. */
function applyRoute(route: Route): void {
  applySeq++;
  if (routeAccess(route) !== 'public' && !signedIn) {
    // The gate renders the sign-in screen (or the server-health screen) for
    // this route; the store is left alone until someone signs in.
    return;
  }
  const store = useStore.getState();
  // Leaving another person's attempt (task 067) for any other route: the
  // view closes — nothing in it is this person's to keep in memory, and the
  // editor must not come back to it (leaving resets).
  if (store.viewingOwner && !(route.kind === 'assignment' && route.student != null)) store.leaveForeignView();
  switch (route.kind) {
    case 'instructor':
    case 'instructor-new-assignment':
    case 'instructor-edit':
    case 'instructor-grading':
    case 'instructor-grading-assignment':
    case 'instructor-grading-student':
    case 'instructor-student':
    case 'instructor-roster':
    case 'instructor-feedback':
    case 'instructor-notes':
    case 'instructor-robot':
      // Instructor routes bypass the student Zustand store entirely — the
      // instructor UI reads the hash directly (see useInstructorRoute). Role
      // gating is handled by <InstructorGate> (which shows an unlock screen when
      // the user is not in instructor mode), so there is nothing to do here.
      return;
    case 'home':
      store.goHome();
      return;
    case 'grades':
      // Home's Grades tab: close any open workbook exactly as Home does. Which
      // tab shows, and which sheet is open, HomeScreen reads from the hash
      // (useRoute) — the store has no notion of a tab.
      store.goHome();
      return;
    case 'sandbox':
      store.enterSandbox();
      return;
    case 'assignment': {
      const seq = applySeq;
      if (route.student != null) {
        applyForeignView(route, route.student, seq);
        return;
      }
      void store.openAssignment(route.id).then(async (ok) => {
        // A newer navigation was applied while the open was in flight — it
        // owns the UI now; applying this route's view state would clobber it.
        if (seq !== applySeq) return;
        if (!ok) {
          // Unknown assignment id (e.g. a stale deep link) — repair the URL to
          // Home without leaving a broken entry in history.
          navigate({ kind: 'home' }, { replace: true });
          return;
        }
        // Which workbook the canvas shows — a submitted attempt, or the live
        // one — BEFORE the question opens and any case loads, so both land on
        // it. An unknown attempt repairs the URL to the live route.
        const shown = await useStore.getState().viewSubmission(route.attempt ?? null);
        if (seq !== applySeq) return;
        if (route.attempt != null && !shown) {
          navigate({ ...route, attempt: undefined }, { replace: true });
          return;
        }
        if (route.questionIndex != null) {
          const { assignment, currentQuestionIndex, switchQuestion } = useStore.getState();
          if (
            assignment &&
            route.questionIndex < assignment.questions.length &&
            route.questionIndex !== currentQuestionIndex
          ) {
            switchQuestion(route.questionIndex);
          }
          useStore.setState({ assignmentView: 'question' });
          // A graded case to replay: load its input into the (now open)
          // question's run. The question may have been open all along — the
          // load restarts the run itself.
          const q = assignment?.questions[route.questionIndex];
          if (route.caseIndex != null && q) void useStore.getState().loadCaseInput(q.id, route.caseIndex);
        } else {
          // No question in the URL → the assignment's question list.
          useStore.setState({ assignmentView: 'overview' });
        }
      });
      return;
    }
  }
}

/**
 * The route of the editor as it stands — the open assignment, the attempt on
 * show and whose it is — at `questionIndex` (absent = the document). Every
 * in-editor navigation (the question arrows, the case banner's close, the
 * crumb) builds on it, so another person's attempt stays theirs. Pure.
 */
export function editorRoute(
  s: {
    assignment: { id: string } | null;
    viewingSubmission: { attempt: number } | null;
    viewingOwner: { key: string } | null;
  },
  questionIndex?: number,
): Route | null {
  if (!s.assignment) return null;
  const attempt = s.viewingSubmission?.attempt;
  const route: Route = s.viewingOwner
    ? { kind: 'assignment', id: s.assignment.id, student: s.viewingOwner.key, attempt }
    : { kind: 'assignment', id: s.assignment.id, attempt };
  return questionIndex != null ? { ...route, questionIndex } : route;
}

/**
 * A Feedback report's context (task 076): where the reporter is, read from
 * the ROUTE — never from whatever the editor store last held, since leaving
 * the editor keeps its assignment in memory (store goHome) and the instructor
 * routes never touch the store. Only an assignment route whose assignment is
 * the one actually open gives a context: its id, plus the question's id when
 * the URL names a question in range (the document page: the assignment
 * alone). The viewer route (another's attempt, `student` set) follows the
 * same rule, and only ids go out — never the student's key. Home, Grades,
 * the sandbox and every Dashboard page, or an assignment still opening (the
 * store behind the URL): none. Pure.
 */
export function feedbackContextFor(
  route: Route,
  assignment: { id: string; questions: readonly { id: number }[] } | null,
): FeedbackContext | undefined {
  if (route.kind !== 'assignment' || !assignment || assignment.id !== route.id) return undefined;
  const questionId = route.questionIndex != null ? assignment.questions[route.questionIndex]?.id : undefined;
  return questionId != null ? { assignmentId: route.id, questionId } : { assignmentId: route.id };
}

/** The viewer route (task 067): `student`'s attempt in the read-only editor.
 *  Only an instructor opens it (anyone else is sent Home); an unknown
 *  assignment or attempt repairs the URL to the student's submission page. */
function applyForeignView(route: Extract<Route, { kind: 'assignment' }>, student: string, seq: number): void {
  if (!instructorRole.isInstructor()) {
    navigate({ kind: 'home' }, { replace: true });
    return;
  }
  const { viewingOwner, viewingSubmission, assignment, openSubmissionOf } = useStore.getState();
  // Already on show (a question arrow, a case, the banner's close): no
  // reload — the canvas and a run stay; only the question/case apply.
  const shown =
    viewingOwner?.key === student && viewingSubmission?.attempt === route.attempt && assignment?.id === route.id;
  const opened = shown ? Promise.resolve(true) : openSubmissionOf(route.id, student, route.attempt ?? 1);
  void opened.then((ok) => {
    if (seq !== applySeq) return;
    if (!ok) {
      navigate({ kind: 'instructor-grading-student', id: route.id, student }, { replace: true });
      return;
    }
    const { assignment: a, currentQuestionIndex, switchQuestion } = useStore.getState();
    const qi = route.questionIndex ?? 0;
    if (a && qi < a.questions.length && qi !== currentQuestionIndex) switchQuestion(qi);
    useStore.setState({ assignmentView: 'question' });
    const q = a?.questions[qi];
    if (route.caseIndex != null && q) void useStore.getState().loadCaseInput(q.id, route.caseIndex);
  });
}

/**
 * Navigate to a route: update history, then apply it. Use `replace` for minor
 * in-place changes (switching question) so Back doesn't accumulate them; push
 * (default) for major transitions (Home ↔ assignment ↔ sandbox).
 */
export function navigate(route: Route, opts?: { replace?: boolean }): void {
  const url = `${location.pathname}${location.search}${routeToHash(route)}`;
  if (opts?.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  applyRoute(route);
  // pushState/replaceState do not fire popstate, and instructor routes don't
  // change the Zustand store, so the instructor UI would not otherwise re-render
  // on navigation. Notify it explicitly (see useInstructorRoute). Harmless for
  // student routes, which already re-render via the store.
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** Custom event fired by `navigate` so hash-reading hooks can re-render. */
export const ROUTE_EVENT = 'mm:route';

// initRouting runs once per page load, from an AuthGate effect at boot — for
// everyone, visitor or user (routes that need sign-in are held, above).
// Guarded against re-entry: StrictMode double-fires effects.
let routingStarted = false;

/**
 * Wire up Back/Forward and apply the initial URL, as it is — there is no
 * landing redirect (one front door, above). Idempotent; called by AuthGate
 * once, at boot.
 */
export function initRouting(): void {
  if (routingStarted) return;
  routingStarted = true;
  window.addEventListener('popstate', applyLocation);
  applyLocation();
}

/** Apply the current URL — first rewriting a retired one in place
 *  (canonicalHash), so the address bar and Back show where you are. */
function applyLocation(): void {
  const hash = canonicalHash(location.hash);
  if (hash !== location.hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  applyRoute(parseHash(hash));
}
