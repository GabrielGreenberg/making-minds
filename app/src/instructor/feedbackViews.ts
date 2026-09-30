// The Feedback tab's words for a report the pipeline resolved (task 086) —
// pure, so server/tools/feedbackCheck.ts pins them and the view only renders.
// The stamp is the server's (server/src/feedbackResolution.ts); a local-mode
// report never carries one, so these are null there.

import { autoResolveStands, type PlatformFeedback } from '../types';

/** `2026-09-28-085` → `085`: the number the queue and the commits say. */
export function taskNumber(id: string): string {
  return id.slice(id.lastIndexOf('-') + 1);
}

/** "Resolved: fixed by 085" or "Resolved: dismissed by the pipeline" while
 *  the pipeline's resolve stands; once the instructor reopened it, "Reopened
 *  after the pipeline resolved it (fixed by 085)" / "(dismissed)" while it
 *  is open, and nothing once resolved again (that resolve is the
 *  instructor's, not the pipeline's). Null too when the pipeline never
 *  resolved it. */
export function autoResolveLabel({ status, triage }: Pick<PlatformFeedback, 'status' | 'triage'>): string | null {
  const auto = triage?.autoResolved;
  if (!auto) return null;
  const fixed = auto.reason === 'filed' ? `fixed by ${(auto.tasks ?? []).map(taskNumber).join(', ')}` : null;
  if (autoResolveStands({ status, triage })) return `Resolved: ${fixed ?? 'dismissed by the pipeline'}`;
  return status === 'open' ? `Reopened after the pipeline resolved it (${fixed ?? 'dismissed'})` : null;
}
