// Headless unit checks for the due-date display policy (src/dueDates.ts).
//
//   cd app && npx tsx tools/dueDateCheck.ts
//
// Covers: the three-band dueStatus (green >3 days out, amber <3 days, red past
// due) including the exact-3-days boundary; lateBy's on-time-means-zero "no
// signal" contract (early, exact-deadline, and late submissions); and
// formatDuration's largest-unit-plus-refinement wording. Task 068: the
// course calendar's import (engine/calendar.ts) on a synthetic course.json,
// its DST-correct instants, the committed app/src/devData/courseCalendar.json,
// lateLabel / submitLateWarning wording, and isFrozen following an extension.

import { readFileSync } from 'node:fs';
import { DUE_SOON_MS, dueStatus, formatDuration, isFrozen, lateBy, lateLabel, submitLateWarning } from '../src/dueDates';
import { importCourseCalendar, isCourseCalendarFile, toCourseCalendar } from '../src/engine/calendar';
import { studentCopy } from '../src/lateContext';

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

console.log('[calendar import]');
{
  const fixture: unknown = JSON.parse(readFileSync(new URL('./fixtures/course-calendar/course.json', import.meta.url), 'utf8'));
  const file = importCourseCalendar(fixture);
  const slot = { start: '12:30', end: '13:45' };
  const expected = {
    timezone: 'America/Los_Angeles',
    meetings: [
      { date: '2026-10-27', ...slot, kind: 'lesson' },
      { date: '2026-10-29', ...slot, kind: 'exam' },
      { date: '2026-11-03', ...slot, kind: 'lesson' },
      { date: '2026-11-10', ...slot, kind: 'lesson' },
      { date: '2026-11-12', ...slot, kind: 'lesson' },
    ],
  };
  check('lessons + the in-class exam at the lecture slot; no holiday, hw or finals slot; one per date; sorted',
    JSON.stringify(file) === JSON.stringify(expected));
  let threw = false;
  try {
    importCourseCalendar({ course: { timezone: 'UTC' }, schedule: [] });
  } catch {
    threw = true;
  }
  check('a course.json without the lecture slot is refused, not guessed', threw);
  const cal = toCourseCalendar(file).meetings;
  check('2026-10-27 12:30 PDT = 19:30Z (daylight time)', cal[0].start === '2026-10-27T19:30:00.000Z' && cal[0].end === '2026-10-27T20:45:00.000Z');
  check('2026-11-03 12:30 PST = 20:30Z (standard time, after the change)', cal[2].start === '2026-11-03T20:30:00.000Z');

  const badZone = { ...file, timezone: 'America/LosAngeles' };
  check('a calendar naming an unknown time zone is not a usable calendar (toCourseCalendar would throw)',
    isCourseCalendarFile(file) && !isCourseCalendarFile(badZone));
  let zoneThrew = false;
  const fx = fixture as { course: Record<string, unknown> };
  try { importCourseCalendar({ ...fx, course: { ...fx.course, timezone: 'America/LosAngeles' } }); } catch { zoneThrew = true; }
  check('…and the import refuses one', zoneThrew);

  const committed: unknown = JSON.parse(readFileSync(new URL('../src/devData/courseCalendar.json', import.meta.url), 'utf8'));
  const dates = isCourseCalendarFile(committed) ? committed.meetings.map((m) => m.date) : [];
  check('the committed calendar: 20 meetings, America/Los_Angeles, the midterm on 10-29 among them',
    isCourseCalendarFile(committed) && committed.timezone === 'America/Los_Angeles' && dates.length === 20 &&
      committed.meetings.find((m) => m.date === '2026-10-29')?.kind === 'exam');
  check('…no meeting on Veterans Day, Thanksgiving or the finals slot',
    !dates.includes('2026-11-11') && !dates.includes('2026-11-26') && !dates.includes('2026-12-09'));
  check('…dates only — nothing personal in it', !/@|name|email|uid/i.test(JSON.stringify(committed)));
}

console.log('[lateLabel]');
check('per-meeting, 2 units, 5 waived', lateLabel({ units: 2, deduction: 15, waived: 5 }, 'per-meeting') === 'late by 2 class meetings: −15; 5 waived');
check('1 class meeting (singular), no waiver', lateLabel({ units: 1, deduction: 10, waived: 0 }) === 'late by 1 class meeting: −10');
check('per-day', lateLabel({ units: 3, deduction: 20 }, 'per-day') === 'late by 3 days: −20');
check('no meeting passed yet → "late: −5"', lateLabel({ units: 0, deduction: 5 }) === 'late: −5');

console.log('[submitLateWarning]');
{
  const due = '2026-10-05T06:59:00.000Z';
  const cal = toCourseCalendar({ timezone: 'America/Los_Angeles', meetings: [{ date: '2026-10-06', start: '12:30', end: '13:45', kind: 'lesson' }] });
  const now = Date.parse('2026-10-06T22:00:00Z'); // after that lecture ended
  const w = (previousSubmittedAt: string | null) => submitLateWarning({ now, dueDate: due, calendar: cal, previousSubmittedAt });
  check('on time → nothing', submitLateWarning({ now: Date.parse(due) - 1000, dueDate: due, calendar: cal }) === null);
  check('late, no earlier attempt → the cost only', w(null) === 'Submitting now is late by 1 class meeting: −10.');
  check('late over an on-time attempt → it will no longer count',
    w('2026-10-04T12:00:00.000Z') === 'Submitting now is late by 1 class meeting: −10. Your earlier on-time submission will no longer count.');
  check('late over a late attempt → no such sentence', w('2026-10-05T12:00:00.000Z') === 'Submitting now is late by 1 class meeting: −10.');
  check('no due date → nothing', submitLateWarning({ now, dueDate: undefined }) === null);
}

console.log('[isFrozen with an extension]');
{
  const asg = { dueDate: '2026-10-05T06:59:00.000Z' };
  const now = Date.parse('2026-10-07T12:00:00Z');
  const extended = studentCopy(asg, { dueDate: '2026-10-09T06:59:00.000Z' });
  check('past the assignment date but before the extension → not frozen',
    isFrozen(asg.dueDate, now, true) && !isFrozen(extended.dueDate, now, true) && extended.dueExtended === true);
  check('no extension → the copy is the assignment itself', studentCopy(asg) === asg);
}

console.log(failures === 0 ? '\nAll dueDate checks passed.' : `\n${failures} dueDate check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
