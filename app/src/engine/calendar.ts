// The course calendar (task 068; design memo
// docs/buildout/designs/grading-interface.md §4.6, §7.4): which class
// meetings there are, so a late deduction can count the ones that have ended
// since a due date (engine/score.ts lateDeduction).
//
// One source, one copy, one sync path — the homeworks' shape: the course
// website's `data/course.json` is the source; `npm run calendar -- import
// <path>` (app/tools/calendar.ts) turns it into the repo's copy,
// app/src/devData/courseCalendar.json, as local dates and times in the
// course's time zone; the release's homework sync writes that copy into the
// server's `course_settings.calendar`; local mode bundles it
// (app/src/courseCalendar.ts). It is not an answer key.
//
// A meeting is a lecture or an in-class exam, at the course's lecture slot.
// Holidays simply have no meeting; the finals-week exam is not a meeting (it
// falls after the last day of instruction, which is how it is told apart).
//
// Pure: no DOM, no storage, no clock — `Intl` only, for the time-zone offset.

import type { CourseCalendar } from './score';

/** The repo's calendar file: local dates and HH:MM times in `timezone`. */
export interface CourseCalendarFile {
  timezone: string;
  meetings: { date: string; start: string; end: string; kind: 'lesson' | 'exam' }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/**
 * The website's course.json → the calendar file. Reads `course.timezone`,
 * `course.lecture.start`/`end`, `course.calendar.instructionEnd` and
 * `schedule[]`: every `lesson`, and every `exam` on or before the last day
 * of instruction, is a meeting at the lecture slot; anything else (holidays,
 * homework due dates, the finals slot) is not. One meeting per date, sorted.
 * Throws on a file missing what it needs.
 */
export function importCourseCalendar(courseJson: unknown): CourseCalendarFile {
  const root = courseJson as {
    course?: { timezone?: unknown; lecture?: { start?: unknown; end?: unknown }; calendar?: { instructionEnd?: unknown } };
    schedule?: unknown;
  };
  const course = root?.course;
  const timezone = course?.timezone;
  const start = course?.lecture?.start;
  const end = course?.lecture?.end;
  const instructionEnd = course?.calendar?.instructionEnd;
  if (typeof timezone !== 'string' || !timezone) throw new Error('course.timezone is missing');
  if (!isTimeZone(timezone)) throw new Error(`course.timezone ${JSON.stringify(timezone)} is not a known IANA time zone`);
  if (typeof start !== 'string' || !TIME.test(start) || typeof end !== 'string' || !TIME.test(end)) {
    throw new Error('course.lecture.start / end must be HH:MM');
  }
  if (typeof instructionEnd !== 'string' || !DATE.test(instructionEnd)) {
    throw new Error('course.calendar.instructionEnd must be YYYY-MM-DD');
  }
  if (!Array.isArray(root.schedule)) throw new Error('schedule[] is missing');
  const byDate = new Map<string, CourseCalendarFile['meetings'][number]>();
  for (const entry of root.schedule as { date?: unknown; type?: unknown }[]) {
    const date = entry?.date;
    if (typeof date !== 'string' || !DATE.test(date)) continue;
    const kind = entry.type === 'lesson' ? 'lesson' : entry.type === 'exam' && date <= instructionEnd ? 'exam' : null;
    if (!kind || byDate.has(date)) continue;
    byDate.set(date, { date, start, end, kind });
  }
  return { timezone, meetings: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
}

/** `timeZone`'s offset from UTC at the instant `ms`, in milliseconds. */
function zoneOffset(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(ms / 1000) * 1000;
}

/** A local wall-clock date and HH:MM in `timeZone` → its ISO instant
 *  (DST-correct: the offset is taken at the instant itself). */
export function zonedInstant(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let ms = wall - zoneOffset(wall, timeZone);
  // Once more at the guess itself: near a DST change the first offset can be the other side's.
  ms = wall - zoneOffset(ms, timeZone);
  return new Date(ms).toISOString();
}

/** The calendar file → the instants engine/score.ts counts. */
export function toCourseCalendar(file: CourseCalendarFile): CourseCalendar {
  return {
    meetings: file.meetings.map((m) => ({
      start: zonedInstant(m.date, m.start, file.timezone),
      end: zonedInstant(m.date, m.end, file.timezone),
    })),
  };
}

/** Is this an IANA time zone this runtime knows? (toCourseCalendar throws a
 *  RangeError on any other, so a file naming one is not a usable calendar.) */
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Is this a usable calendar file? (What the server trusts from its settings.) */
export function isCourseCalendarFile(x: unknown): x is CourseCalendarFile {
  const f = x as CourseCalendarFile;
  return (
    !!f &&
    typeof f.timezone === 'string' &&
    isTimeZone(f.timezone) &&
    Array.isArray(f.meetings) &&
    f.meetings.every(
      (m) => !!m && typeof m.date === 'string' && DATE.test(m.date) && TIME.test(m.start) && TIME.test(m.end) && (m.kind === 'lesson' || m.kind === 'exam'),
    )
  );
}
