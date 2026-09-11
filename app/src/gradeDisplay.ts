// Student-facing grade display policy (pure — no React, so a headless check
// can pin it). The instructor's Gradebook has its own richer mapping; this one
// answers the only question a student's grade sheet asks of a result: did this
// question come out right, and if not, how much of it did.

import type { QuestionResult } from './types';

/** One question's verdict, in the student's terms. */
export function questionVerdict(r: QuestionResult | undefined): {
  text: string;
  tone: 'pass' | 'fail' | 'pending' | 'none';
} {
  if (!r) return { text: 'Not graded', tone: 'none' };
  if (r.status === 'pending') {
    if (!r.manual) return { text: 'Awaiting review', tone: 'pending' };
    return r.manual.pass
      ? { text: 'Correct (reviewed)', tone: 'pass' }
      : { text: 'Incorrect (reviewed)', tone: 'fail' };
  }
  if (r.status === 'skipped') return { text: 'Not attempted', tone: 'none' };
  if (r.total === 0) return { text: 'Not graded', tone: 'none' };
  return r.passed === r.total
    ? { text: `Correct — ${r.passed}/${r.total}`, tone: 'pass' }
    : { text: `${r.passed}/${r.total}`, tone: 'fail' };
}
