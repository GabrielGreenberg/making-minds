// The robot's state seam (task 083): what the Dashboard's Robot tab and the
// strip over its tabs read. Remote: GET /api/robot/status
// (remoteStores.ts RemoteRobotStatusStore) — the server looks at its own
// clone, a mirror of GitHub main and the release gate (the pure builder is
// ./robotStatus.ts). Local: there is no server, no clone and no robot to
// ask, so the answer is "not available", and nothing is fetched (law 5:
// local mode makes zero /api calls). Mirrors the Local/Remote pattern of
// every other seam; storage/backend.ts picks one.

import type { RobotStatus } from './robotStatus';

export interface RobotStatusStore {
  /** The robot's state. `refresh`: ask the server to look again now rather
   *  than answer from its cache (≤ 10 minutes old). */
  get(refresh?: boolean): Promise<RobotStatus>;
}

export const LOCAL_ROBOT_REASON = 'Not available in local mode';

class LocalRobotStatusStore implements RobotStatusStore {
  async get(): Promise<RobotStatus> {
    return { available: false, reason: LOCAL_ROBOT_REASON };
  }
}

export const localRobotStatusStore: RobotStatusStore = new LocalRobotStatusStore();
