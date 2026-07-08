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
  | { kind: 'assignment'; id: string; questionIndex?: number }
  | { kind: 'instructor' }
  | { kind: 'instructor-new-assignment' }
  | { kind: 'instructor-edit'; id: string }
  | { kind: 'instructor-submissions'; id: string };

/** Parse a location hash (e.g. "#/a/cc-basics/q/2") into a Route. Pure. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'sandbox') return { kind: 'sandbox' };
  if (parts[0] === 'instructor') {
    // #/instructor/assignments/new | .../:id/edit | .../:id/submissions
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
    if (parts[2] === 'q' && parts[3] != null) {
      const qi = Number(parts[3]);
      if (Number.isInteger(qi) && qi >= 0) return { kind: 'assignment', id, questionIndex: qi };
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
    case 'assignment':
      return route.questionIndex != null
        ? `#/a/${encodeURIComponent(route.id)}/q/${route.questionIndex}`
        : `#/a/${encodeURIComponent(route.id)}`;
    case 'instructor':
      return '#/instructor';
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

/** Drive the store to match a route. The only place navigation state is applied. */
function applyRoute(route: Route): void {
  applySeq++;
  const store = useStore.getState();
  switch (route.kind) {
    case 'instructor':
    case 'instructor-new-assignment':
    case 'instructor-edit':
    case 'instructor-submissions':
      // Instructor routes bypass the student Zustand store entirely — the
      // instructor UI reads the hash directly (see useInstructorRoute). Role
      // gating is handled by <InstructorGate> (which shows an unlock screen when
      // the user is not in instructor mode), so there is nothing to do here.
      return;
    case 'home':
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

/** Wire up Back/Forward and apply the initial URL. Call once at startup. */
export function initRouting(): void {
  window.addEventListener('popstate', () => applyRoute(parseHash(location.hash)));
  applyRoute(parseHash(location.hash));
}
