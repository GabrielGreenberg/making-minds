// The course calendar's import (task 068; engine/calendar.ts): the course
// website's data/course.json → the repo's copy, app/src/devData/courseCalendar.json
// (dates and lecture times only — no people). Commit the result; the
// release's homework sync carries it into the server (course_settings).
//
//   npm run calendar -- import "<website>/data/course.json"
//   npm run calendar -- show            # the committed file's meetings

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCourseCalendar, isCourseCalendarFile, toCourseCalendar } from '../src/engine/calendar';

const OUT = fileURLToPath(new URL('../src/devData/courseCalendar.json', import.meta.url));
const [command, source] = process.argv.slice(2);

if (command === 'import' && source) {
  const file = importCourseCalendar(JSON.parse(readFileSync(source, 'utf8')));
  writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n');
  const counts = file.meetings.reduce((n, m) => ({ ...n, [m.kind]: (n[m.kind] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`calendar: ${file.meetings.length} meetings (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), ${file.timezone} → ${OUT}`);
} else if (command === 'show') {
  const file: unknown = JSON.parse(readFileSync(OUT, 'utf8'));
  if (!isCourseCalendarFile(file)) {
    console.error(`calendar: ${OUT} is not a calendar file`);
    process.exit(1);
  }
  const instants = toCourseCalendar(file).meetings;
  file.meetings.forEach((m, i) => console.log(`  ${m.date} ${m.kind.padEnd(6)} ${instants[i].start} → ${instants[i].end}`));
} else {
  console.error('usage: npm run calendar -- import <website data/course.json> | show');
  process.exit(2);
}
