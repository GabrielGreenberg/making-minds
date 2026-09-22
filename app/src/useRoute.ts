// The current route as React state.
//
// Student navigation drives the Zustand store (routing.ts applyRoute), so most
// student surfaces re-render through the store. Two things read the hash
// directly instead: the instructor views (which bypass the store entirely) and
// the student Home, whose tabs (Assignments · Grades) are a matter of WHERE you
// are, not of which workbook is open. This hook re-renders on Back/Forward
// (popstate) and on programmatic navigation (the ROUTE_EVENT that `navigate`
// dispatches, since pushState does not fire popstate).

import { useSyncExternalStore } from 'react';
import { parseHash, ROUTE_EVENT } from './routing';
import type { Route } from './routing';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

export function useRoute(): Route {
  // Snapshot the raw hash string (a stable primitive) so useSyncExternalStore's
  // identity check works; parsing happens on render.
  const hash = useSyncExternalStore(
    subscribe,
    () => location.hash,
    () => '',
  );
  return parseHash(hash);
}
