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

export type Route =
  | { kind: 'home' }
  | { kind: 'sandbox' }
  | { kind: 'grades'; id?: string }
  // caseIndex: a graded case to load into the question's run ("Run this
  // input" on the grade sheet) — only meaningful with a questionIndex.
  | { kind: 'assignment'; id: string; questionIndex?: number; caseIndex?: number }
  | { kind: 'instructor' }
  | { kind: 'instructor-new-assignment' }
  | { kind: 'instructor-edit'; id: string }
  | { kind: 'instructor-submissions'; id: string }
  | { kind: 'instructor-roster' }
  | { kind: 'instructor-feedback' }
  | { kind: 'instructor-notes' };

/** A non-negative integer URL segment, or undefined. */
function indexSegment(part: string | undefined): number | undefined {
  if (part == null) return undefined;
  const n = Number(part);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Parse a location hash (e.g. "#/a/hw1/q/2") into a Route. Pure. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'sandbox') return { kind: 'sandbox' };
  // #/grades | #/grades/:id — Home's Grades tab, optionally with one sheet open
  if (parts[0] === 'grades') {
    return parts[1] ? { kind: 'grades', id: decodeURIComponent(parts[1]) } : { kind: 'grades' };
  }
  if (parts[0] === 'instructor') {
    // #/instructor/roster
    // #/instructor/assignments/new | .../:id/edit | .../:id/submissions
    if (parts[1] === 'roster') return { kind: 'instructor-roster' };
    if (parts[1] === 'feedback') return { kind: 'instructor-feedback' };
    if (parts[1] === 'notes') return { kind: 'instructor-notes' };
    if (parts[1] === 'assignments') {
      if (parts[2] === 'new') return { kind: 'instructor-new-assignment' };
      if (parts[2]) {
        const id = decodeURIComponent(parts[2]);
        if (parts[3] === 'edit') return { kind: 'instructor-edit', id };
        if (parts[3] === 'submissions') return { kind: 'instructor-submissions', id };
      }
    }
    return { kind: 'instructor' };
  }
  if (parts[0] === 'a' && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    // #/a/:id/q/:i[/case/:k] — a malformed case segment is dropped, the
    // question kept.
    const qi = parts[2] === 'q' ? indexSegment(parts[3]) : undefined;
    if (qi !== undefined) {
      const k = parts[4] === 'case' ? indexSegment(parts[5]) : undefined;
      return k !== undefined
        ? { kind: 'assignment', id, questionIndex: qi, caseIndex: k }
        : { kind: 'assignment', id, questionIndex: qi };
    }
    return { kind: 'assignment', id };
  }
  return { kind: 'home' };
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
    case 'assignment':
      if (route.questionIndex == null) return `#/a/${encodeURIComponent(route.id)}`;
      return route.caseIndex != null
        ? `#/a/${encodeURIComponent(route.id)}/q/${route.questionIndex}/case/${route.caseIndex}`
        : `#/a/${encodeURIComponent(route.id)}/q/${route.questionIndex}`;
    case 'instructor':
      return '#/instructor';
    case 'instructor-roster':
      return '#/instructor/roster';
    case 'instructor-feedback':
      return '#/instructor/feedback';
    case 'instructor-notes':
      return '#/instructor/notes';
    case 'instructor-new-assignment':
      return '#/instructor/assignments/new';
    case 'instructor-edit':
      return `#/instructor/assignments/${encodeURIComponent(route.id)}/edit`;
    case 'instructor-submissions':
      return `#/instructor/assignments/${encodeURIComponent(route.id)}/submissions`;
  }
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

export type RouteAccess = 'public' | 'signed-in' | 'instructor';

/** Who may enter a route. Pure. */
export function routeAccess(route: Route): RouteAccess {
  switch (route.kind) {
    case 'sandbox':
      return 'public';
    case 'home':
    case 'grades':
    case 'assignment':
      return 'signed-in';
    case 'instructor':
    case 'instructor-new-assignment':
    case 'instructor-edit':
    case 'instructor-submissions':
    case 'instructor-roster':
    case 'instructor-feedback':
    case 'instructor-notes':
      return 'instructor';
  }
}

/**
 * The boot landing rule. Pure. A browser with no trace of any previous
 * sign-in that opens the bare site (`#/`) is a newcomer — most of them want
 * to try the machines, not sign in — so it lands in the sandbox as a visitor.
 * A browser that HAS signed in before stays where it asked to go (Home
 * restores the session, or shows the sign-in screen if it no longer
 * restores); any explicit deep link is honoured for everyone. Returns the
 * route to replace the initial URL with, or null to leave it alone.
 */
export function landingRoute(route: Route, hasSignInTrace: boolean): Route | null {
  if (route.kind === 'home' && !hasSignInTrace) return { kind: 'sandbox' };
  return null;
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
  switch (route.kind) {
    case 'instructor':
    case 'instructor-new-assignment':
    case 'instructor-edit':
    case 'instructor-submissions':
    case 'instructor-roster':
    case 'instructor-feedback':
    case 'instructor-notes':
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
      void store.openAssignment(route.id).then((ok) => {
        // A newer navigation was applied while the open was in flight — it
        // owns the UI now; applying this route's view state would clobber it.
        if (seq !== applySeq) return;
        if (!ok) {
          // Unknown assignment id (e.g. a stale deep link) — repair the URL to
          // Home without leaving a broken entry in history.
          navigate({ kind: 'home' }, { replace: true });
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
 * Wire up Back/Forward, apply the boot landing rule, and apply the initial
 * URL. Idempotent; called by AuthGate once, at boot.
 */
export function initRouting(opts: { hasSignInTrace: boolean }): void {
  if (routingStarted) return;
  routingStarted = true;
  window.addEventListener('popstate', () => applyRoute(parseHash(location.hash)));
  const landed = landingRoute(parseHash(location.hash), opts.hasSignInTrace);
  if (landed) {
    navigate(landed, { replace: true });
    return;
  }
  applyRoute(parseHash(location.hash));
}
