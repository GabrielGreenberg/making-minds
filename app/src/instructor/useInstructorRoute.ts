// Instructor routing hook.
//
// The instructor views bypass the student Zustand store entirely: instead of
// threading instructor state through store.ts, they read the URL hash directly
// (useRoute). This hook returns the active instructor route, or null when the
// hash is not an instructor route.

import { useRoute } from '../useRoute';
import type { Route } from '../routing';

export type InstructorRoute = Extract<Route, { kind: `instructor${string}` }>;

function isInstructorRoute(route: Route): route is InstructorRoute {
  return route.kind.startsWith('instructor');
}

export function useInstructorRoute(): InstructorRoute | null {
  const route = useRoute();
  return isInstructorRoute(route) ? route : null;
}
