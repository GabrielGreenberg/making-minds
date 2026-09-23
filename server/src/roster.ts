// CSV roster ingestion — pure, so it is unit-checkable (tools/rosterCheck.ts,
// tools/authCheck.ts) and shared by the CLI (src/roster-cli.ts) and the
// instructor's roster screen (POST /api/roster/import), both through
// src/rosterImport.ts.
//
// The roster is the gate on account creation: a student may only create an
// account for an email that appears here. Everything else about them (name,
// student ID, role, section) comes from this file too, and the registrar's
// class-list export drops in UNEDITED:
//
//   Term: 26F                      ← a preamble of "Key: value" lines and
//   …                                blanks: the header is the first row (of
//                                    the first 20) that yields an email column
//   UID,Name,E-mail,Major,Classification,Grade Type,Status,Section
//   999-999-999,"LAST, FIRST MIDDLE",…
//
// Column detection is header-driven: an exact header match first, then a
// whole-word one ("Preferred Email Address"). There is NO substring match, so
// "Grade Type" never claims role and "Section ID" never claims the ID.
//
//   email      — "email", "email address", "ucla email", "e-mail"; "mail" exact
//   name       — "name", "student name", "full name", "preferred name"; or a
//                "first"/"last" pair (the bare words exact only)
//   studentId  — "student id", "university id", "id number"; "uid"/"sid"/"id" exact
//   role       — "role", "user role" (student | instructor | ta); absent = the caller's default
//   section    — "section", "discussion section"; "sec" exact
//   status     — "status", "enrollment status", "enrl status" — read through STATUS_TABLE
//
// Names in registrar form ("LAST, FIRST MIDDLE[, SUFFIX]") become display form
// ("First Middle Last Suffix", title-cased when the source is all one case)
// plus a "Last, First" sort key; any other name passes through as written.
//
// Data classification: UID, name, email and section — nothing else. Major,
// Classification and Grade Type are never read into an entry or echoed.
//
// Rows without a usable email are reported as issues, not silently dropped —
// an instructor importing 80 students must be told about the 3 that failed.

import type { Role } from '../../app/src/auth/accounts';

export interface RosterEntry {
  email: string;
  name: string;
  /** Campus ID as written in the export; '' when the CSV has no ID column. */
  studentId: string;
  role: Role;
  /** Discussion section as written ("1A"); null when the CSV has none. */
  section: string | null;
  /** "Last, First" for sorting; null when the name gave no surname. */
  sortName: string | null;
}

export interface RosterIssue {
  /** 1-based PHYSICAL line in the source CSV (preamble and blanks count). */
  line: number;
  reason: string;
}

export interface RosterColumns {
  email: string | null;
  name: string | null;
  studentId: string | null;
  role: string | null;
  section: string | null;
  status: string | null;
}

/** How one enrollment status is treated. */
export interface StatusMeaning {
  label: string;
  imported: boolean;
}

/** A row whose status is recognised and is not "enrolled". */
export interface RosterStatusRow {
  line: number;
  email: string;
  name: string;
  label: string;
  imported: boolean;
}

export interface RosterStatusCount {
  label: string;
  count: number;
  imported: boolean;
}

export interface RosterParse {
  entries: RosterEntry[];
  issues: RosterIssue[];
  /** Which source columns were recognised, for the import report. */
  columns: RosterColumns;
  /** Physical line of the header row; null when none was found. */
  headerLine: number | null;
  /** The file has a status column — it is a class list, so who is NOT on it
   *  is worth a review (see rosterReview). */
  statusColumn: boolean;
  /** Rows with a recognised status other than enrolled, imported or not. */
  statusRows: RosterStatusRow[];
  /** statusRows counted per label, in order of first appearance. */
  statusCounts: RosterStatusCount[];
}

/** One CSV record and the physical 1-based line it starts on. */
export interface CsvRow {
  cells: string[];
  line: number;
}

/**
 * Split CSV text into records: RFC-4180 quoting, CRLF or LF, BOM-tolerant.
 * Each record carries the line it STARTS on, counting every newline in the
 * file — including one inside a quoted field — so an issue names the line the
 * instructor sees in their editor.
 */
export function parseCsvRows(text: string): CsvRow[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push({ cells: row, line: rowLine });
    row = [];
  };
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (c === '\n') line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      line++;
      rowLine = line;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/** Split CSV text into rows of fields (parseCsvRows without the line numbers). */
export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((r) => r.cells);
}

// ── column matching ─────────────────────────────────────────────

interface Candidate {
  name: string;
  /** Generic short words ("id", "mail") match only a header that IS the word. */
  exactOnly?: boolean;
}
const word = (name: string): Candidate => ({ name });
const exact = (name: string): Candidate => ({ name, exactOnly: true });

const EMAIL_COLUMN = [word('email'), word('email address'), word('ucla email'), word('e mail'), exact('mail')];
const FIRST_COLUMN = [word('first name'), exact('first'), word('given name')];
const LAST_COLUMN = [word('last name'), exact('last'), word('surname'), word('family name')];
const NAME_COLUMN = [word('name'), word('student name'), word('full name'), word('preferred name')];
const ID_COLUMN = [
  word('student id'),
  exact('uid'),
  word('university id'),
  word('id number'),
  exact('sid'),
  exact('id'),
];
const ROLE_COLUMN = [word('role'), word('user role')];
const SECTION_COLUMN = [word('section'), word('discussion section'), exact('sec')];
const STATUS_COLUMN = [word('status'), word('enrollment status'), word('enrl status')];

/** The header is looked for among this many non-blank rows. */
const HEADER_SCAN_ROWS = 20;

const normalizeHeader = (h: string): string =>
  h
    .trim()
    .toLowerCase()
    .replace(/[:#.?]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim();

/** "Term: 26F", "Title: Making Minds, …" — a key, a colon, then a value. */
const PREAMBLE_LINE = /^[^:]+:\s*\S/;

/**
 * A row's cells as header keys. A preamble row — its first cell a "Key:
 * value" line ("Term: 26F", "Time & Location: …, …") — is never the header
 * and yields no keys, so a comma-split title ("Title: Making Minds, Machines
 * and Email") cannot claim a column by whole word. Any other row keeps every
 * cell: "Email:" (colon, no value) or "What is your UCLA email address?" is
 * still a header.
 */
function headerKeys(cells: string[]): string[] {
  const first = cells.find((c) => c.trim() !== '') ?? '';
  if (PREAMBLE_LINE.test(first.trim())) return cells.map(() => '');
  return cells.map(normalizeHeader);
}

/** True when `phrase`'s words appear, contiguous and whole, in `header`. */
function hasWords(header: string, phrase: string): boolean {
  const words = header.split(' ').filter(Boolean);
  const want = phrase.split(' ');
  for (let i = 0; i + want.length <= words.length; i++) {
    if (want.every((w, k) => words[i + k] === w)) return true;
  }
  return false;
}

function findColumn(headers: string[], candidates: Candidate[], exclude: number[] = []): number {
  const usable = (i: number) => headers[i] !== '' && !exclude.includes(i);
  for (const candidate of candidates) {
    const idx = headers.findIndex((h, i) => usable(i) && h === candidate.name);
    if (idx >= 0) return idx;
  }
  for (const candidate of candidates) {
    if (candidate.exactOnly) continue;
    const idx = headers.findIndex((h, i) => usable(i) && hasWords(h, candidate.name));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── enrollment status ───────────────────────────────────────────

const ENROLLED: StatusMeaning = { label: 'enrolled', imported: true };
const WAITLISTED: StatusMeaning = { label: 'waitlisted', imported: true };
const HELD: StatusMeaning = { label: 'held', imported: true };
const DROPPED: StatusMeaning = { label: 'dropped', imported: false };
const CANCELLED: StatusMeaning = { label: 'cancelled', imported: false };
const WITHDRAWN: StatusMeaning = { label: 'withdrawn', imported: false };

/**
 * The ONE table of enrollment statuses: a code or a word, lowercased. UCLA's
 * registrar codes are E Enrolled, D Dropped, W Wait List, H Held (Extension:
 * P Pending, A Approved, C Cancelled). A blank status counts as enrolled; any
 * other code is imported WITH an issue, so an unfamiliar export never silently
 * loses students.
 */
const STATUS_TABLE: Readonly<Record<string, StatusMeaning>> = {
  e: ENROLLED,
  enrolled: ENROLLED,
  w: WAITLISTED, // UCLA W = Wait List; imported — Gabriel, 2026-09-23
  waitlisted: WAITLISTED,
  'wait listed': WAITLISTED,
  'wait list': WAITLISTED,
  waitlist: WAITLISTED,
  h: HELD,
  held: HELD,
  d: DROPPED,
  dropped: DROPPED,
  c: CANCELLED,
  cancelled: CANCELLED,
  canceled: CANCELLED,
  withdrawn: WITHDRAWN,
};

const statusKey = (cell: string): string => cell.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/** The table's meaning of a status cell — own keys only, so a cell like "constructor"
 *  is an unknown code (imported with an issue), never an inherited property. */
const statusMeaning = (cell: string): StatusMeaning | undefined => {
  const key = statusKey(cell);
  return Object.hasOwn(STATUS_TABLE, key) ? STATUS_TABLE[key] : undefined;
};

// ── names ───────────────────────────────────────────────────────

/** Lowercased between surname words ("Nunez de la O"), never first or last. */
const SURNAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'van', 'von', 'der', 'da', 'di', 'du', 'dos', 'le', 'y']);
const ROMAN_SUFFIX = /^(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i;

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One lowercase hyphen/apostrophe-free segment of a name word. */
function capitalizeSegment(segment: string, surname: boolean): string {
  if (surname && segment.length > 2 && segment.startsWith('mc')) return `Mc${capitalize(segment.slice(2))}`;
  // Mac + capital only for a Gaelic-looking remainder: ≥ 3 letters, starting
  // with a consonant other than h/y — so Machado, Macias, Macaraeg and Macon
  // stay as they are while MacDonald and MacLeod get their capital.
  if (surname && segment.startsWith('mac')) {
    const rest = segment.slice(3);
    if (rest.length >= 3 && !/^[aeiouhy]/.test(rest)) return `Mac${capitalize(rest)}`;
  }
  return capitalize(segment);
}

/** Title-case one word: every hyphenated part; after an apostrophe only
 *  behind a one-letter prefix (O'Brien, D'Angelo — but Ka'iulani). */
function capitalizeWord(raw: string, surname: boolean): string {
  const parts = raw.toLowerCase().split(/([-'’])/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1 || part === '') return part;
      const afterApostrophe = i >= 2 && parts[i - 1] !== '-';
      if (afterApostrophe && parts[i - 2].length > 1) return part;
      return capitalizeSegment(part, surname);
    })
    .join('');
}

/**
 * Title-case a name written all in one case. `surname` turns on Mc/Mac and
 * the lowercase particles between surname words — best effort, not a
 * genealogy: "DE ANDA" → "De Anda", "NUNEZ DE LA O" → "Nunez de la O".
 */
export function titleCaseName(text: string, surname = false): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (surname && i > 0 && i < words.length - 1 && SURNAME_PARTICLES.has(lower)) return lower;
      return capitalizeWord(w, surname);
    })
    .join(' ');
}

/** A name written entirely in capitals or entirely in lowercase. */
function isSingleCase(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters !== '' && (letters === letters.toUpperCase() || letters === letters.toLowerCase());
}

/** Never a registrar given name, so "…, Jr." is display form with a suffix. */
const NAME_SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'phd', 'esq']);
/** Also a given name or initial ("RAHMAN, MD" — Md = Mohammad; "LEE, V"), so
 *  a suffix only in a mixed-case name: the registrar writes all capitals. */
const AMBIGUOUS_SUFFIX = new Set(['md', 'v', 'x']);

/** "Martin Luther King, Jr." / "Jane Doe, PhD": the text after the FIRST
 *  comma is a suffix, not a given name — display form, not registrar form. */
function isDisplayWithSuffix(text: string): boolean {
  const afterComma = text.split(',')[1] ?? '';
  const key = afterComma.trim().toLowerCase().replace(/\./g, '');
  return NAME_SUFFIX.has(key) || (AMBIGUOUS_SUFFIX.has(key) && !isSingleCase(text));
}

/**
 * A name cell to display form + sort key. "LAST, GIVEN[, SUFFIX…]" becomes
 * "Given Last Suffix" / "Last, Given" (title-cased when the source is all one
 * case; Roman-numeral suffixes stay capitals). A name already in display form
 * — no comma, or a comma before a suffix ("Martin Luther King, Jr.") — passes
 * through unchanged, with no sort key.
 */
export function normalizeRosterName(raw: string): { display: string; sortName: string | null } {
  const text = raw.trim();
  if (!text.includes(',') || isDisplayWithSuffix(text)) return { display: text, sortName: null };
  const [lastRaw, givenRaw = '', ...suffixRaw] = text.split(',').map((p) => p.trim().replace(/\s+/g, ' '));
  const recase = isSingleCase(text);
  const given = recase ? titleCaseName(givenRaw) : givenRaw;
  const suffixes = suffixRaw
    .filter(Boolean)
    .map((s) => (ROMAN_SUFFIX.test(s) ? s.toUpperCase() : recase ? titleCaseName(s) : s));
  if (!lastRaw) return { display: [given, ...suffixes].filter(Boolean).join(' '), sortName: null };
  const last = recase ? titleCaseName(lastRaw, true) : lastRaw;
  return {
    display: [given, last, ...suffixes].filter(Boolean).join(' '),
    sortName: given ? `${last}, ${given}` : last,
  };
}

/** Split first/last columns, as written: "First Last" / "Last, First". */
function composeName(first: string, last: string): { display: string; sortName: string | null } {
  return {
    display: [first, last].filter(Boolean).join(' '),
    sortName: last ? (first ? `${last}, ${first}` : last) : null,
  };
}

// ── the reader ──────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@,;]+\.[^\s@,;]+$/;

/** True for a syntactically plausible email address. */
export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Canonical storage form for an email: trimmed and lowercased. */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Parse a roster CSV into entries plus per-row issues. `defaultRole` applies
 * to rows with no role column (an instructor importing a TA list can pass
 * 'instructor'). Later duplicates of an email are reported and dropped — the
 * FIRST imported row for an email wins, so a re-export appended to a file
 * cannot silently demote someone. A row whose status is not imported
 * (dropped, cancelled, withdrawn) is never imported and never blocks a later
 * row for the same email; it is counted in statusRows only when no row for
 * that email was imported, once per email.
 */
export function parseRoster(csv: string, defaultRole: Role = 'student'): RosterParse {
  // Blank rows are dropped AFTER each row's line is captured, so every issue
  // names the physical line in the file the instructor has open.
  const rows = parseCsvRows(csv).filter((r) => r.cells.some((f) => f.trim() !== ''));
  const noColumns: RosterColumns = { email: null, name: null, studentId: null, role: null, section: null, status: null };
  const nothing = { entries: [], columns: noColumns, headerLine: null, statusColumn: false, statusRows: [], statusCounts: [] };
  if (rows.length === 0) return { ...nothing, issues: [{ line: 1, reason: 'the file is empty' }] };

  let headerAt = -1;
  let headers: string[] = [];
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const keys = headerKeys(rows[r].cells);
    if (findColumn(keys, EMAIL_COLUMN) >= 0) {
      headerAt = r;
      headers = keys;
      break;
    }
  }
  if (headerAt < 0) {
    return {
      ...nothing,
      issues: [
        {
          line: 1,
          reason: `no email column found (looked for "Email", "E-mail", "Email Address", ... in the first ${HEADER_SCAN_ROWS} rows)`,
        },
      ],
    };
  }
  const rawHeaders = rows[headerAt].cells.map((h) => h.trim());
  const emailIdx = findColumn(headers, EMAIL_COLUMN);
  // First/last are resolved BEFORE the single name column and excluded from
  // it; with either present, only an exact full-name header ("Name") beats
  // them — otherwise "Middle Name" would claim the name by whole word.
  const firstIdx = findColumn(headers, FIRST_COLUMN);
  const lastIdx = findColumn(headers, LAST_COLUMN);
  const splitName = firstIdx >= 0 || lastIdx >= 0;
  const nameIdx = findColumn(
    headers,
    splitName ? NAME_COLUMN.map((c) => exact(c.name)) : NAME_COLUMN,
    [firstIdx, lastIdx],
  );
  const idIdx = findColumn(headers, ID_COLUMN);
  const roleIdx = findColumn(headers, ROLE_COLUMN);
  const sectionIdx = findColumn(headers, SECTION_COLUMN);
  const statusIdx = findColumn(headers, STATUS_COLUMN);
  const header = (idx: number) => (idx >= 0 ? rawHeaders[idx] : null);

  const columns: RosterColumns = {
    email: header(emailIdx),
    name:
      nameIdx >= 0
        ? rawHeaders[nameIdx]
        : splitName
          ? [header(firstIdx), header(lastIdx)].filter(Boolean).join(' + ')
          : null,
    studentId: header(idIdx),
    role: header(roleIdx),
    section: header(sectionIdx),
    status: header(statusIdx),
  };

  const entries: RosterEntry[] = [];
  const issues: RosterIssue[] = [];
  // Status rows are gathered in file order and counted AFTER the loop, once
  // it is known who was imported (see below).
  const gathered: RosterStatusRow[] = [];
  const seen = new Set<string>();
  for (const { cells, line } of rows.slice(headerAt + 1)) {
    const at = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');
    const email = normalizeEmail(at(emailIdx));
    const named = at(nameIdx) ? normalizeRosterName(at(nameIdx)) : composeName(at(firstIdx), at(lastIdx));
    const statusCell = at(statusIdx);
    const status: StatusMeaning | undefined = statusCell ? statusMeaning(statusCell) : ENROLLED;
    if (status && !status.imported) {
      gathered.push({ line, email, name: named.display, label: status.label, imported: false });
      continue;
    }

    if (!email) {
      issues.push({ line, reason: 'no email address' });
      continue;
    }
    if (!isEmail(email)) {
      issues.push({ line, reason: `"${email}" is not a valid email address` });
      continue;
    }
    if (seen.has(email)) {
      issues.push({ line, reason: `duplicate of an earlier row for ${email} (kept the first)` });
      continue;
    }
    seen.add(email);

    // A nameless roster row is still a usable account; the email local part is
    // a better placeholder than a blank in the gradebook.
    const name = named.display || email.split('@')[0];
    if (!status) issues.push({ line, reason: `unrecognised status "${statusCell}" — imported` });
    else if (status !== ENROLLED) gathered.push({ line, email, name, label: status.label, imported: true });

    const roleCell = at(roleIdx).toLowerCase();
    const role: Role =
      roleCell === 'instructor' || roleCell === 'ta'
        ? 'instructor'
        : roleCell === 'student'
          ? 'student'
          : defaultRole;

    entries.push({
      email,
      name,
      studentId: at(idIdx),
      role,
      section: at(sectionIdx) || null,
      sortName: named.display ? named.sortName : null,
    });
  }

  // A not-imported row counts only for someone left out: a student listed D
  // in one section and E in another was imported, and a second D row for the
  // same email is the same person — neither is "1 more dropped".
  const skippedEmails = new Set<string>();
  const statusRows = gathered.filter((row) => {
    if (row.imported || !row.email) return true;
    if (seen.has(row.email) || skippedEmails.has(row.email)) return false;
    skippedEmails.add(row.email);
    return true;
  });
  const statusCounts: RosterStatusCount[] = [];
  for (const row of statusRows) {
    const count = statusCounts.find((c) => c.label === row.label && c.imported === row.imported);
    if (count) count.count++;
    else statusCounts.push({ label: row.label, count: 1, imported: row.imported });
  }

  return {
    entries,
    issues,
    columns,
    headerLine: rows[headerAt].line,
    statusColumn: statusIdx >= 0,
    statusRows,
    statusCounts,
  };
}

export interface RosterReviewItem {
  email: string;
  name: string;
  /** "status <label>" (e.g. "status dropped") or "not in this file". */
  reason: string;
}

/**
 * Who on the platform a class list no longer carries: a STUDENT whose row now
 * has a status that is not imported (dropped, cancelled, withdrawn) or who is
 * missing from the file. Only a file with a status column is a class list —
 * a TA list or a three-row add-on says nothing about who has left — so any
 * other file reviews nobody. Nobody is removed: this is a list for a human.
 */
export function rosterReview(
  users: readonly { email: string; name: string; role: Role }[],
  parse: RosterParse,
): RosterReviewItem[] {
  if (!parse.statusColumn) return [];
  const listed = new Set(parse.entries.map((e) => e.email));
  const skipped = new Map<string, string>();
  for (const row of parse.statusRows) {
    if (!row.imported && !skipped.has(row.email)) skipped.set(row.email, row.label);
  }
  return users
    .filter((u) => u.role === 'student' && !listed.has(u.email))
    .map((u) => ({
      email: u.email,
      name: u.name,
      reason: skipped.has(u.email) ? `status ${skipped.get(u.email)}` : 'not in this file',
    }));
}
