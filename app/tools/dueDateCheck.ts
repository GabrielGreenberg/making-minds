// Headless unit checks for the due-date display policy (src/dueDates.ts).
//
//   cd app && npx tsx tools/dueDateCheck.ts
//
// Covers: the three-band dueStatus (green >3 days out, amber <3 days, red past
// due) including the exact-3-days boundary; lateBy's on-time-means-zero "no
// signal" contract (early, exact-deadline, and late submissions); and
// formatDuration's largest-unit-plus-refinement wording.

import { DUE_SOON_MS, dueStatus, formatDuration, lateBy } from '../src/dueDates';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const now = Date.parse('2026-07-19T12:00:00Z');
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

console.log('[dueStatus]');
check('4 days out → due-later', dueStatus(at(4 * DAY), now) === 'due-later');
check('2 days out → due-soon', dueStatus(at(2 * DAY), now) === 'due-soon');
check('exactly 3 days out → due-later (band is "less than 3 days")', dueStatus(at(DUE_SOON_MS), now) === 'due-later');
check('1 minute out → due-soon', dueStatus(at(MINUTE), now) === 'due-soon');
check('1 minute past → overdue', dueStatus(at(-MINUTE), now) === 'overdue');
check('exactly at the deadline → not overdue', dueStatus(at(0), now) === 'due-soon');

console.log('[lateBy — on time is silent]');
const due = at(0);
check('submitted a day early → 0', lateBy(due, at(-DAY)) === 0);
check('submitted exactly at the deadline → 0', lateBy(due, due) === 0);
check('submitted 90 minutes late → 90 minutes', lateBy(due, at(90 * MINUTE)) === 90 * MINUTE);
check('submitted 2.5 days late → exact ms', lateBy(due, at(2 * DAY + 12 * HOUR)) === 2 * DAY + 12 * HOUR);

console.log('[formatDuration]');
check('sub-minute → "less than a minute"', formatDuration(30 * 1000) === 'less than a minute');
check('45 minutes', formatDuration(45 * MINUTE) === '45 minutes');
check('1 minute singular', formatDuration(MINUTE) === '1 minute');
check('exactly 3 hours (no minutes tail)', formatDuration(3 * HOUR) === '3 hours');
check('3 hours, 12 minutes', formatDuration(3 * HOUR + 12 * MINUTE) === '3 hours, 12 minutes');
check('exactly 2 days (no hours tail)', formatDuration(2 * DAY) === '2 days');
check('2 days, 4 hours (minutes dropped past a day)', formatDuration(2 * DAY + 4 * HOUR + 30 * MINUTE) === '2 days, 4 hours');
check('1 day, 1 hour singulars', formatDuration(DAY + HOUR) === '1 day, 1 hour');

console.log(failures === 0 ? '\nAll dueDate checks passed.' : `\n${failures} dueDate check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
