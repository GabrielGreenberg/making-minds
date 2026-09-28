// The course calendar as the client knows it (task 068): the repo's copy,
// app/src/devData/courseCalendar.json, bundled — both modes' student and
// instructor UI price lateness with it (the submit dialog's warning, the
// released grade sheet), and local mode's GradingStore scores with it. The
// server reads its own copy (course_settings.calendar, written by the
// release's sync from the same file). Class meetings, not answers: safe to
// ship to every client.

import type { CourseCalendar } from './engine/score';
import { toCourseCalendar, type CourseCalendarFile } from './engine/calendar';
import file from './devData/courseCalendar.json';

export const COURSE_CALENDAR_FILE = file as CourseCalendarFile;
export const COURSE_CALENDAR: CourseCalendar = toCourseCalendar(COURSE_CALENDAR_FILE);
