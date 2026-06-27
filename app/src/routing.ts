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
  | { kind: 'assignment'; id: string; questionIndex?: number };

/** Parse a location hash (e.g. "#/a/cc-basics/q/2") into a Route. Pure. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'home' };
  if (parts[0] === 'sandbox') return { kind: 'sandbox' };
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
  }
}

/** Drive the store to match a route. The only place navigation state is applied. */
function applyRoute(route: Route): void {
  const store = useStore.getState();
  switch (route.kind) {
    case 'home':
      store.goHome();
      return;
    case 'sandbox':
      store.enterSandbox();
      return;
    case 'assignment': {
      const ok = store.openAssignment(route.id);
      if (!ok) {
        // Unknown assignment id (e.g. a stale deep link) — repair the URL to Home
        // without leaving a broken entry in history.
        navigate({ kind: 'home' }, { replace: true });
        return;
      }
      if (route.questionIndex != null) {
        const { assignment, currentQuestionIndex } = useStore.getState();
        if (
          assignment &&
          route.questionIndex < assignment.questions.length &&
          route.questionIndex !== currentQuestionIndex
        ) {
          store.switchQuestion(route.questionIndex);
        }
      }
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
}

/** Wire up Back/Forward and apply the initial URL. Call once at startup. */
export function initRouting(): void {
  window.addEventListener('popstate', () => applyRoute(parseHash(location.hash)));
  applyRoute(parseHash(location.hash));
}
