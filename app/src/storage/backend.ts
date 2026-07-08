// Backend mode seam — the ONE place the app decides local vs. remote storage,
// and (since S3 of docs/buildout/designs/remote-stores.md) the sole exporter
// of the store INSTANCES. Consumers import `workbookStore` /
// `assignmentStore` / `submissionStore` from here and never construct a
// Local*/Remote* store themselves, so the whole app switches backends on this
// one constant. (Two deliberate exceptions pin the concrete LOCAL stores
// directly: devData/seed.ts, which needs the off-seam dev-only
// `clearSubmissions`, and tools/navResetCheck.ts, which asserts the Node
// harness resolves to 'local'.)
//
// The `import.meta.env?.` guard (same pattern as api/client.ts) keeps Node/tsx
// harness runs resolving to 'local' — import.meta.env only exists under Vite.
// tools/navResetCheck.ts pins this so drift fails loudly.

import { localWorkbookStore, type WorkbookStore } from './workbookStore';
import { localAssignmentStore, type AssignmentStore } from './AssignmentStore';
import { localSubmissionStore, type SubmissionStore } from './submissionStore';
import { remoteWorkbookStore, remoteAssignmentStore, remoteSubmissionStore } from './remoteStores';

export const backendMode: 'local' | 'remote' = import.meta.env?.VITE_API_BASE
  ? 'remote'
  : 'local';

const remote = backendMode === 'remote';

export const workbookStore: WorkbookStore = remote ? remoteWorkbookStore : localWorkbookStore;
export const assignmentStore: AssignmentStore = remote
  ? remoteAssignmentStore
  : localAssignmentStore;
export const submissionStore: SubmissionStore = remote
  ? remoteSubmissionStore
  : localSubmissionStore;
