// One shared fetch-on-mount hook for the async storage seams.
//
// The five views that used to read the stores synchronously at render time
// (HomeScreen, InstructorDashboard, AssignmentEditor, GradebookView, and the
// gradebook's review flow) all fetch through this instead. `reload()` re-runs
// the fetcher — it replaces the ad-hoc force-rerender ceremony those views
// used to carry. Stale resolves are dropped (a re-run or dep change bumps the
// sequence token), and the previous value is kept while a reload is in flight
// so lists don't flash empty.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncValue<T> {
  /** Last successfully fetched value; undefined until the first resolve. */
  value: T | undefined;
  loading: boolean;
  error: Error | null;
  /** Re-run the fetcher (e.g. after a mutation through a seam). */
  reload: () => void;
}

export function useAsyncValue<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): AsyncValue<T> {
  const [state, setState] = useState<{
    value: T | undefined;
    loading: boolean;
    error: Error | null;
  }>({ value: undefined, loading: true, error: null });
  const [version, setVersion] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mySeq = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher().then(
      (value) => {
        if (seq.current === mySeq) setState({ value, loading: false, error: null });
      },
      (e: unknown) => {
        if (seq.current === mySeq) {
          setState((s) => ({
            ...s,
            loading: false,
            error: e instanceof Error ? e : new Error(String(e)),
          }));
        }
      },
    );
    // The fetcher's identity changes every render (inline closures); its real
    // dependencies are the caller-supplied deps plus the reload version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
