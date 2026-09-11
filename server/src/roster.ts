// CSV roster ingestion — pure, so it is unit-checkable (tools/authCheck.ts)
// and usable from both the CLI (src/importRoster.ts) and the instructor's
// roster screen (POST /api/roster/import).
//
// The roster is the gate on account creation: a student may only create an
// account for an email that appears here. Everything else about them (name,
// student ID, role) comes from this file too, so a registrar export drops in
// unedited.
//
// Column detection is header-driven and tolerant, because campus exports do
// not agree on spelling. We look for:
//
//   email      — "email", "email address", "ucla email", "e-mail", "mail"
//   name       — "name", "student name", "full name"; or "first"/"last" pair
//   studentId  — "student id", "uid", "university id", "id number", "sid", "id"
//   role       — "role" (student | instructor); absent = the caller's default
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
}

export interface RosterIssue {
  /** 1-based line number in the source CSV, counting the header. */
  line: number;
  reason: string;
}

export interface RosterColumns {
  email: string | null;
  name: string | null;
  studentId: string | null;
  role: string | null;
}

export interface RosterParse {
  entries: RosterEntry[];
  issues: RosterIssue[];
  /** Which source columns were recognised, for the import report. */
  columns: RosterColumns;
}

/** Split CSV text into rows of fields: RFC-4180 quoting, CRLF or LF, BOM-tolerant. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
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
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

const normalizeHeader = (h: string): string => h.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

function findColumn(headers: string[], candidates: string[], exclude: number[] = []): number {
  const usable = (idx: number) => idx >= 0 && !exclude.includes(idx);
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate);
    if (usable(idx)) return idx;
  }
  // Fall back to a containment match ("Preferred Email Address").
  for (const candidate of candidates) {
    const idx = headers.findIndex((h, i) => !exclude.includes(i) && h.includes(candidate));
    if (usable(idx)) return idx;
  }
  return -1;
}

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
 * FIRST row for an email wins, so a re-export appended to a file cannot
 * silently demote someone.
 */
export function parseRoster(csv: string, defaultRole: Role = 'student'): RosterParse {
  const rows = parseCsv(csv).filter((r) => r.some((f) => f.trim() !== ''));
  const noColumns: RosterColumns = { email: null, name: null, studentId: null, role: null };
  if (rows.length === 0) {
    return { entries: [], issues: [{ line: 1, reason: 'the file is empty' }], columns: noColumns };
  }
  const rawHeaders = rows[0];
  const headers = rawHeaders.map(normalizeHeader);
  const emailIdx = findColumn(headers, ['email', 'email address', 'ucla email', 'e mail', 'mail']);
  // First/last are resolved BEFORE the single name column and excluded from
  // it: otherwise a "Last Name, First Name" export matches "Last Name" on the
  // bare "name" containment rule and everyone loses their given name.
  const firstIdx = findColumn(headers, ['first name', 'first', 'given name']);
  const lastIdx = findColumn(headers, ['last name', 'last', 'surname', 'family name']);
  const nameIdx = findColumn(headers, ['name', 'student name', 'full name'], [firstIdx, lastIdx]);
  const idIdx = findColumn(headers, ['student id', 'uid', 'university id', 'id number', 'sid', 'id']);
  const roleIdx = findColumn(headers, ['role', 'type']);

  const columns: RosterColumns = {
    email: emailIdx >= 0 ? rawHeaders[emailIdx] : null,
    name:
      nameIdx >= 0
        ? rawHeaders[nameIdx]
        : firstIdx >= 0 || lastIdx >= 0
          ? [firstIdx >= 0 ? rawHeaders[firstIdx] : null, lastIdx >= 0 ? rawHeaders[lastIdx] : null]
              .filter(Boolean)
              .join(' + ')
          : null,
    studentId: idIdx >= 0 ? rawHeaders[idIdx] : null,
    role: roleIdx >= 0 ? rawHeaders[roleIdx] : null,
  };

  const issues: RosterIssue[] = [];
  if (emailIdx < 0) {
    issues.push({
      line: 1,
      reason: 'no email column found (looked for "Email", "Email Address", ...)',
    });
    return { entries: [], issues, columns };
  }

  const entries: RosterEntry[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;
    const cells = rows[r];
    const at = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');
    const email = normalizeEmail(at(emailIdx));
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

    let name = at(nameIdx);
    if (!name) name = [at(firstIdx), at(lastIdx)].filter(Boolean).join(' ').trim();
    // A nameless roster row is still a usable account; the email local part is
    // a better placeholder than a blank in the gradebook.
    if (!name) name = email.split('@')[0];

    const roleCell = at(roleIdx).toLowerCase();
    const role: Role =
      roleCell === 'instructor' || roleCell === 'ta'
        ? 'instructor'
        : roleCell === 'student'
          ? 'student'
          : defaultRole;

    entries.push({ email, name, studentId: at(idIdx), role });
  }

  return { entries, issues, columns };
}
