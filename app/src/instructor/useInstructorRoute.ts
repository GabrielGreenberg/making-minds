// Instructor routing hook.
//
// The instructor views bypass the student Zustand store entirely: instead of
// threading instructor state through store.ts, they read the URL hash directly.
// This hook parses the current hash and returns the active instructor route, or
// null when the hash is not an instructor route. It re-renders on Back/Forward
// (popstate) and on programmatic navigation (the ROUTE_EVENT that `navigate`
// dispatches, since pushState does not fire popstate).

import { useSyncExternalStore } from 'react';
import { parseHash, ROUTE_EVENT, type Route } from '../routing';

export type InstructorRoute = Extract<Route, { kind: `instructor${string}` }>;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

function isInstructorRoute(route: Route): route is InstructorRoute {
  return route.kind.startsWith('instructor');
}

export function useInstructorRoute(): InstructorRoute | null {
  // Re-read the hash whenever the location changes. We snapshot the raw hash
  // string (a stable primitive) so useSyncExternalStore's identity check works;
  // parsing happens on render.
  const hash = useSyncExternalStore(
    subscribe,
    () => location.hash,
    () => '',
  );
  const route = parseHash(hash);
  return isInstructorRoute(route) ? route : null;
}
