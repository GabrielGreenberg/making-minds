// Roster-reader check (`npm run check`, beside authCheck) — pure and fast.
//
// Pins the registrar's class-list export as a first-class input to
// src/roster.ts: header discovery past a preamble, strict column matching,
// registrar names to display form, enrollment status (W = Wait List is
// imported; D/C/withdrawn are not), the "no longer on the class list"
// review (matched by student ID or any sign-in address — task 036), the UID
// and campus-address rules, and the report's words (shared with the dashboard through
// app/src/instructor/rosterReportText.ts). The HTTP half (import report, section on GET /roster, the review
// through the real server) is in authCheck's [http: roster administration].
//
// The fixture is SYNTHETIC — invented names, @example.com addresses — and
// INLINE, never a .csv file: a real class list is a student record and never
// enters git (.gitignore: rosters/, *-csv.csv).
//
// Exits non-zero on any failed assertion (like every other tool here).

import { readFileSync } from 'node:fs';
import {
  parseRoster,
  parseCsvRows,
  normalizeRosterName,
  titleCaseName,
  rosterReview,
  normalizeUid,
  isCampusEmail,
  type RosterEntry,
} from '../src/roster';
import { formatRosterReport } from '../src/rosterImport';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function section(name: string) {
  console.log(`\n${name}`);
}

/** A registrar-shaped export: 6 preamble lines, 2 blanks, the header on line 9. */
const REGISTRAR_HEADER = 'UID,Name,E-mail,Major,Classification,Grade Type,Status,Section';
const PREAMBLE = [
  'Term: 26F',
  'Class: PHIL 133 LEC 1',
  // A comma-split title whose second cell is short and says "Email": the
  // preamble rule, not luck, keeps it from being taken for the header.
  'Title: Making Minds, Machines and Email',
  'SRS: 000000000',
  'Time & Location: MW 2:00pm-3:15pm, Example Hall 100',
  'Students: 13',
  '',
  '',
];
const ROWS = [
  /* 10 */ '999-000-001,"DOE, JANE ANN",Jane.Doe@Example.COM,Philosophy,Junior,LG,E,1A',
  /* 11 */ `999-000-002,"O'BRIEN-SMITH, PAT",pat.obs@example.com,Cognitive Science,Senior,LG,E,1B`,
  /* 12 */ '999-000-003,"MCDONALD, RORY",rory.mcd@example.com,Linguistics,Senior,LG,E,1A',
  /* 13 */ '999-000-004,"MACHADO, LUIS",luis.machado@example.com,Philosophy,Sophomore,PN,E,1B',
  /* 14 */ '999-000-005,"DE ANDA, SOFIA",sofia.deanda@example.com,Mathematics,Junior,LG,E,1A',
  /* 15 */ '999-000-006,"NUNEZ DE LA O, MARIA ELENA",maria.nunez@example.com,Psychology,Senior,LG,E,1B',
  /* 16 */ '999-000-007,"ROE, JOHN, III",john.roe@example.com,Computer Science,Junior,LG,E,1A',
  /* 17 */ '999-000-008,"MACDONALD, ALEX",alex.macd@example.com,Philosophy,Junior,LG,E,1B',
  /* 18 */ '999-000-009,"WAITE, WILLA",willa.waite@example.com,Economics,Sophomore,LG,W,1A',
  /* 19 */ '999-000-010,"LISTER, WES",wes.lister@example.com,History,Junior,LG,W,1B',
  /* 20 */ '999-000-011,"DROPP, DANA",dana.dropp@example.com,Physics,Senior,LG,D,1A',
  /* 21 */ '999-000-012,"ODDCODE, OTTO",otto.oddcode@example.com,Philosophy,Junior,LG,X,1B',
  /* 22 */ '999-000-013,"BADMAIL, BO",not-an-email,Philosophy,Junior,LG,E,1A',
];
const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';
const REGISTRAR = crlf([...PREAMBLE, REGISTRAR_HEADER, ...ROWS]);

// ═══ [registrar export] ══════════════════════════════════════════
section('[registrar export]');

const reg = parseRoster(REGISTRAR);
const byEmail = (email: string, entries: RosterEntry[] = reg.entries) => entries.find((e) => e.email === email);

check('the header is found past the preamble (physical line 9)', reg.headerLine === 9, `got ${reg.headerLine}`);
check(
  'every enrolled, waitlisted and unknown-code row with a valid email is imported (11)',
  reg.entries.length === 11,
  `got ${reg.entries.length}`,
);
check(
  'W = Wait List rows ARE imported',
  byEmail('willa.waite@example.com') != null && byEmail('wes.lister@example.com') != null,
);
check('D (dropped) rows are NOT imported', byEmail('dana.dropp@example.com') == null);
check(
  'the report counts statuses: 2 waitlisted imported, 1 dropped not imported',
  JSON.stringify(reg.statusCounts) ===
    JSON.stringify([
      { label: 'waitlisted', count: 2, imported: true },
      { label: 'dropped', count: 1, imported: false },
    ]),
  JSON.stringify(reg.statusCounts),
);
check('the file is read as a class list (it has a status column)', reg.statusColumn);
check(
  'an unknown status code is imported, with an issue on its physical line',
  byEmail('otto.oddcode@example.com') != null &&
    reg.issues.some((i) => i.line === 21 && i.reason === 'unrecognised status "X" — imported'),
  JSON.stringify(reg.issues),
);
check(
  'a bad row is reported on its physical line (22)',
  reg.issues.some((i) => i.line === 22 && i.reason.includes('not a valid email')),
  JSON.stringify(reg.issues),
);
check('exactly those two issues', reg.issues.length === 2, JSON.stringify(reg.issues));
check(
  'columns used: E-mail, Name, UID, Section, Status — and NO role (not Grade Type)',
  reg.columns.email === 'E-mail' &&
    reg.columns.name === 'Name' &&
    reg.columns.studentId === 'UID' &&
    reg.columns.section === 'Section' &&
    reg.columns.status === 'Status' &&
    reg.columns.role === null,
  JSON.stringify(reg.columns),
);
check('everyone gets the default role', reg.entries.every((e) => e.role === 'student'));

const jane = byEmail('jane.doe@example.com');
check('the mixed-case email is lowercased', jane != null);
check('"DOE, JANE ANN" → "Jane Ann Doe"', jane?.name === 'Jane Ann Doe', jane?.name);
check('…sorted as "Doe, Jane Ann"', jane?.sortName === 'Doe, Jane Ann', String(jane?.sortName));
check('the UID is kept as written', jane?.studentId === '999-000-001');
check('the section is kept', jane?.section === '1A' && byEmail('pat.obs@example.com')?.section === '1B');
const names: [string, string][] = [
  ['pat.obs@example.com', "Pat O'Brien-Smith"],
  ['rory.mcd@example.com', 'Rory McDonald'],
  ['luis.machado@example.com', 'Luis Machado'],
  ['sofia.deanda@example.com', 'Sofia De Anda'],
  ['maria.nunez@example.com', 'Maria Elena Nunez de la O'],
  ['john.roe@example.com', 'John Roe III'],
  ['alex.macd@example.com', 'Alex MacDonald'],
];
for (const [email, want] of names) {
  const got = byEmail(email)?.name;
  check(`display name "${want}"`, got === want, got);
}
check('the suffix row sorts by surname', byEmail('john.roe@example.com')?.sortName === 'Roe, John');
check(
  'Major, Classification and Grade Type are never read into an entry',
  reg.entries.every(
    (e) => Object.keys(e).sort().join(',') === 'email,line,name,role,section,sortName,studentId',
  ),
);
check('each entry names its physical line (Jane: 10)', byEmail('jane.doe@example.com')?.line === 10);
check(
  '…nor echoed anywhere in the parse',
  !['Philosophy', 'Cognitive Science', 'Junior', 'Senior', 'Sophomore'].some((v) => JSON.stringify(reg).includes(v)),
);

// ═══ [header discovery] ══════════════════════════════════════════
section('[header discovery]');

check(
  'a preamble-only file reports no email column',
  parseRoster(crlf(PREAMBLE.slice(0, 6))).issues[0]?.reason.includes('no email column') === true,
);
check('"Name\\nX" reports no email column', parseRoster('Name\nX\n').issues[0]?.reason.includes('no email column') === true);
check('an ordinary header on line 1 is line 1', parseRoster('Email,Name\na@example.com,A\n').headerLine === 1);
check(
  'a plain file has no status column, so it is not a class list',
  parseRoster('Email,Name\na@example.com,A\n').statusColumn === false,
);
check(
  'a header cell with a trailing colon ("Email:") is still the header',
  parseRoster('Email:,Name\na@example.com,A\n').entries[0]?.email === 'a@example.com',
);
check(
  'a question-style header ("What is your UCLA email address?") is still found by whole word',
  parseRoster('What is your UCLA email address?,Name\na@example.com,A\n').entries[0]?.email === 'a@example.com',
);
const multiline = parseRoster('Email,Name\na@example.com,"Two\nLines"\nbad,Row\n');
check(
  'a newline inside a quoted field still counts as a line',
  multiline.issues[0]?.line === 4 && parseCsvRows('a\n"b\nc"\nd\n').map((r) => r.line).join() === '1,2,4',
  JSON.stringify(multiline.issues),
);

// ═══ [columns] ═══════════════════════════════════════════════════
section('[columns]');

const gradeType = parseRoster('Email,Grade Type\na@example.com,instructor\n');
check('"Grade Type" never claims role', gradeType.columns.role === null && gradeType.entries[0]?.role === 'student');
const srs = parseRoster('Email,SRS,Section ID\na@example.com,123,456\n');
check('"SRS" and "Section ID" never claim the student ID', srs.columns.studentId === null);
const preferred = parseRoster('Preferred Email Address,Name\nb@example.com,B\n');
check('"Preferred Email Address" is found by whole word', preferred.entries[0]?.email === 'b@example.com');
const split = parseRoster('Last Name,First Name,Email Address,UID\nHopper,Grace,grace@example.com,987\n');
check('"Last Name,First Name" is still split', split.entries[0]?.name === 'Grace Hopper');
check('…and sorted by the last name', split.entries[0]?.sortName === 'Hopper, Grace');
const middle = parseRoster('First Name,Middle Name,Last Name,Email\nGrace,Brewster,Hopper,g@example.com\n');
check('"Middle Name" never claims the name', middle.entries[0]?.name === 'Grace Hopper', middle.entries[0]?.name);
check(
  '"Enrollment Status" and "Discussion Section" are found',
  parseRoster('Email,Enrollment Status,Discussion Section\nc@example.com,Enrolled,2B\n').entries[0]?.section === '2B',
);

// ═══ [status] ════════════════════════════════════════════════════
section('[status]');

const words = parseRoster(
  'Email,Status\nw@example.com,Wait List\nh@example.com,Held\nd@example.com,Dropped\nx@example.com,Withdrawn\nc@example.com,Cancelled\ne@example.com,\n',
);
check(
  'words: wait list + held + blank imported; dropped, withdrawn, cancelled not',
  words.entries.map((e) => e.email).join() === 'w@example.com,h@example.com,e@example.com',
  words.entries.map((e) => e.email).join(),
);
check(
  '…each skipped status counted under its own label',
  ['dropped', 'withdrawn', 'cancelled'].every((l) =>
    words.statusCounts.some((c) => c.label === l && c.count === 1 && !c.imported),
  ),
  JSON.stringify(words.statusCounts),
);
const dThenE = parseRoster('Email,Status,Section\nsame@example.com,D,1A\nsame@example.com,E,1B\n');
check(
  'a skipped row never blocks a later enrolled row for the same email',
  dThenE.entries.length === 1 && dThenE.entries[0].section === '1B' && dThenE.issues.length === 0,
);
check(
  '…and is not counted as "dropped" — that student was imported',
  dThenE.statusCounts.length === 0 && dThenE.statusRows.length === 0,
  JSON.stringify(dThenE.statusCounts),
);
const eThenD = parseRoster('Email,Status\nsame@example.com,E\nsame@example.com,D\n');
check(
  'an enrolled row then a dropped one for the same email: imported, not counted as dropped',
  eThenD.entries.length === 1 && eThenD.statusCounts.length === 0,
  JSON.stringify(eThenD.statusCounts),
);
const twoDrops = parseRoster('Email,Status\nsame@example.com,D\nsame@example.com,D\nother@example.com,D\n');
check(
  'two dropped rows for one email count one student (3 rows, 2 students)',
  JSON.stringify(twoDrops.statusCounts) === JSON.stringify([{ label: 'dropped', count: 2, imported: false }]),
  JSON.stringify(twoDrops.statusCounts),
);
const inherited = parseRoster('Email,Status\nproto@example.com,constructor\n');
check(
  'a status named like an Object property ("constructor") is an unknown code: imported with an issue',
  inherited.entries.length === 1 && inherited.issues.some((i) => i.reason === 'unrecognised status "constructor" — imported'),
  JSON.stringify(inherited.issues),
);

// ═══ [names] ═════════════════════════════════════════════════════
section('[names]');

check('"Ada Lovelace" passes through unchanged', normalizeRosterName('Ada Lovelace').display === 'Ada Lovelace');
check('…with no sort key', normalizeRosterName('Ada Lovelace').sortName === null);
check(
  'a mixed-case "Last, First" is reordered, not recased',
  normalizeRosterName('de Anda, Sofía').display === 'Sofía de Anda',
);
check(
  'Mac + vowel/h stays as written (Macias, Macon, Macaraeg)',
  titleCaseName('MACIAS', true) === 'Macias' &&
    titleCaseName('MACON', true) === 'Macon' &&
    titleCaseName('MACARAEG', true) === 'Macaraeg',
);
check('a particle is never the last surname word ("Nguyen Le")', titleCaseName('NGUYEN LE', true) === 'Nguyen Le');
check("an apostrophe capitalises only after one letter (Ka'iulani)", titleCaseName("KA'IULANI") === "Ka'iulani");
check('hyphenated given names', titleCaseName('JEAN-LUC') === 'Jean-Luc');
const passThrough = (name: string) => {
  const n = normalizeRosterName(name);
  return n.display === name && n.sortName === null;
};
check('"Martin Luther King, Jr." (display form + suffix) passes through unchanged', passThrough('Martin Luther King, Jr.'));
check('"Jane Doe, PhD" and "Jane Doe, MD" pass through unchanged', passThrough('Jane Doe, PhD') && passThrough('Jane Doe, MD'));
check('…in capitals too ("MARTIN LUTHER KING, JR")', passThrough('MARTIN LUTHER KING, JR'));
check(
  'but a registrar "RAHMAN, MD" (Md = a given name, all capitals) is reordered',
  normalizeRosterName('RAHMAN, MD').display === 'Md Rahman',
  normalizeRosterName('RAHMAN, MD').display,
);
const mlk = parseRoster('Name,Email\n"Martin Luther King, Jr.",mlk@example.com\n').entries[0];
check('…end to end: the stored name is "Martin Luther King, Jr."', mlk?.name === 'Martin Luther King, Jr.', mlk?.name);

// ═══ [review] ════════════════════════════════════════════════════
section('[review]');

// Everyone the first import put on the platform, plus an instructor.
const onPlatform = [
  ...reg.entries.map((e) => ({ email: e.email, name: e.name, role: e.role })),
  { email: 'prof@example.com', name: 'Prof', role: 'instructor' as const },
];
// The next export: Willa went from W to D, Wes from W to E, Pat is gone.
const nextRows = ROWS.filter((r) => !r.includes('pat.obs@'))
  .map((r) => (r.includes('willa.waite@') ? r.replace(',W,', ',D,') : r))
  .map((r) => (r.includes('wes.lister@') ? r.replace(',W,', ',E,') : r));
const next = parseRoster(crlf([...PREAMBLE, REGISTRAR_HEADER, ...nextRows]));
const review = rosterReview(onPlatform, next);
check(
  'a student now dropped is listed as "status dropped"',
  review.some((r) => r.email === 'willa.waite@example.com' && r.reason === 'status dropped'),
  JSON.stringify(review),
);
check(
  'a student missing from the file is listed as "not in this file"',
  review.some((r) => r.email === 'pat.obs@example.com' && r.reason === 'not in this file'),
);
check('a student moved from W to E is simply updated, not listed', !review.some((r) => r.email === 'wes.lister@example.com'));
check('an instructor is never listed', !review.some((r) => r.email === 'prof@example.com'));
check('nobody else is listed', review.length === 2, JSON.stringify(review));
check(
  'a file without a status column reviews nobody',
  rosterReview(onPlatform, parseRoster('Email,Name\njane.doe@example.com,Jane Ann Doe\n')).length === 0,
);

// Task 036: a person is their student ID; the email is only how they sign in.
// The export after that: Jane's registrar email changed (same UID), Rory is
// listed under an address that is one of his aliases, and Dana-style: Luis
// shows up DROPPED under a new email — his UID still says it is him.
const onPlatformWithIds = [
  ...reg.entries.map((e) => ({
    email: e.email,
    name: e.name,
    role: e.role,
    // Rory has no ID on file here, so only his alias can match him.
    studentId: e.email === 'rory.mcd@example.com' ? '' : e.studentId,
    aliases: e.email === 'rory.mcd@example.com' ? ['rory@g.ucla.edu'] : [],
  })),
];
const movedRows = ROWS.map((r) => r.replace('Jane.Doe@Example.COM', 'jane.doe@g.ucla.edu'))
  .map((r) => r.replace('999-000-003,"MCDONALD, RORY",rory.mcd@example.com', '999-000-003,"MCDONALD, RORY",rory@g.ucla.edu'))
  .map((r) => (r.includes('luis.machado@') ? r.replace('luis.machado@example.com', 'luis@new.example.com').replace(',E,', ',D,') : r));
const moved = rosterReview(onPlatformWithIds, parseRoster(crlf([...PREAMBLE, REGISTRAR_HEADER, ...movedRows])));
check('a registrar email change (same UID) is not "no longer listed"', !moved.some((r) => r.email === 'jane.doe@example.com'), JSON.stringify(moved));
check('a row under one of their aliases counts as theirs', !moved.some((r) => r.email === 'rory.mcd@example.com'));
check(
  'a dropped row under a new email is matched by UID ("status dropped")',
  moved.some((r) => r.email === 'luis.machado@example.com' && r.reason === 'status dropped'),
  JSON.stringify(moved),
);
check('…and nobody else is listed', moved.length === 1, JSON.stringify(moved));

// ═══ [uid] ═══════════════════════════════════════════════════════
section('[uid]');

check('normalizeUid: dashes, spaces and leading zeros are one UID', normalizeUid('004-125-678') === '4125678' && normalizeUid(' 004 125 678 ') === '4125678' && normalizeUid('4125678') === '4125678');
check('normalizeUid: blank or missing is empty', normalizeUid('  ') === '' && normalizeUid(undefined) === '');
check('normalizeUid: a non-numeric ID compares case-insensitively', normalizeUid('AB-12x') === 'ab12x');
check('isCampusEmail: ucla.edu and its subdomains', isCampusEmail('a@ucla.edu') && isCampusEmail('a@g.ucla.edu') && isCampusEmail('A@Math.UCLA.edu'));
check(
  'isCampusEmail: nothing else',
  !isCampusEmail('a@gmail.com') && !isCampusEmail('a@notucla.edu') && !isCampusEmail('a@ucla.edu.example.com') && !isCampusEmail('ucla.edu'),
);
const twinIds = parseRoster('UID,Name,Email\n999-000-001,Jane,jane@example.com\n999000001,Jane Again,jane@g.ucla.edu\n');
check('a later row repeating a student ID is dropped (the first wins)', twinIds.entries.length === 1 && twinIds.entries[0].email === 'jane@example.com');
check(
  '…and reported on its line, naming the ID',
  twinIds.issues.length === 1 && twinIds.issues[0].line === 3 && twinIds.issues[0].reason.includes('999000001'),
  JSON.stringify(twinIds.issues),
);

// ═══ [report] ════════════════════════════════════════════════════
section('[report]');

// The words the Done-whens name, as the CLI prints them — and the dashboard
// shows the same words, because both take them from rosterReportText.ts.
const lines = formatRosterReport({
  added: reg.entries.length,
  updated: 0,
  total: reg.entries.length,
  headerLine: reg.headerLine,
  statusCounts: reg.statusCounts,
  noLongerListed: review,
  issues: reg.issues,
  columns: reg.columns,
});
const hasLine = (want: string) => lines.some((l) => l.trim() === want);
check('"skipped 8 lines before the header"', hasLine('skipped 8 lines before the header'), lines.join(' | '));
check('"2 waitlisted — imported"', hasLine('2 waitlisted — imported'), lines.join(' | '));
check('"1 dropped — not imported"', hasLine('1 dropped — not imported'), lines.join(' | '));
check(
  '"no longer on the class list — review", then each student with the reason',
  hasLine('no longer on the class list — review (nobody was removed):') &&
    hasLine('Willa Waite <willa.waite@example.com> — status dropped'),
  lines.join(' | '),
);
const plain = formatRosterReport({
  added: 0,
  updated: 0,
  total: 0,
  headerLine: 1,
  statusCounts: [],
  noLongerListed: [],
  issues: [],
  columns: reg.columns,
});
check('a header on line 1 skips nothing', !plain.some((l) => l.includes('before the header')), plain.join(' | '));
const rosterView = readFileSync(new URL('../../app/src/instructor/RosterView.tsx', import.meta.url), 'utf8');
check(
  'the dashboard takes the same words from rosterReportText.ts (no copy of its own)',
  rosterView.includes("from './rosterReportText'") &&
    !/not imported|before the header|no longer on the class list/i.test(rosterView),
);

console.log(`\n${failures === 0 ? 'all roster checks passed' : `${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
