// The Dashboard's one read of the robot's state (task 083). InstructorLayout
// — mounted across every Dashboard tab — owns it (`useRobotStatusSource`)
// and shares it through RobotStatusContext, so the strip over the tabs and
// the Robot tab show the same answer from ONE fetch per Dashboard visit, and
// the tab's Refresh updates the strip too. Refresh asks the server to look
// again now (`robotStatusStore.get(true)`); a failed refresh keeps the last
// good answer beside the error (useAsyncValue keeps the previous value).

import { createContext, useCallback, useContext, useRef } from 'react';
import { robotStatusStore } from '../storage/backend';
import type { RobotStatus } from '../storage/robotStatus';
import { useAsyncValue } from '../useAsyncValue';

export interface RobotStatusState {
  /** The last good answer; undefined until the first one. */
  value: RobotStatus | undefined;
  loading: boolean;
  error: Error | null;
  /** Ask the server to look again now, not answer from its cache. */
  refresh: () => void;
}

export const RobotStatusContext = createContext<RobotStatusState | null>(null);

/** The layout's hook: fetches once on mount; `refresh` re-fetches fresh. */
export function useRobotStatusSource(): RobotStatusState {
  const refreshNext = useRef(false);
  const { value, loading, error, reload } = useAsyncValue(() => {
    const refresh = refreshNext.current;
    refreshNext.current = false;
    return robotStatusStore.get(refresh);
  }, []);
  const refresh = useCallback(() => {
    refreshNext.current = true;
    reload();
  }, [reload]);
  return { value, loading, error, refresh };
}

const OUTSIDE: RobotStatusState = {
  value: undefined,
  loading: false,
  error: new Error('the robot’s state is read inside the Dashboard'),
  refresh: () => {},
};

/** The views' hook: the layout's shared state (never throws). */
export function useRobotStatus(): RobotStatusState {
  return useContext(RobotStatusContext) ?? OUTSIDE;
}
