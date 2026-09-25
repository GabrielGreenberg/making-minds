// Roster import — the ONE path from a CSV to roster rows, shared by the
// instructor's screen (POST /api/roster/import) and the admin CLI
// (`npm run roster -- import`), so both produce the same report.
//
// Importing only adds and updates. It never removes anyone and never touches
// a password: a mid-quarter re-import must not delete a student's work or sign
// them out. Who a class list no longer carries is REPORTED (noLongerListed)
// for a human to act on; removal is the explicit DELETE /api/roster/:email.
//
// Each row lands through src/identity.ts: matched by student ID first, so a
// registrar email change updates the same person (the new address becomes an
// alias) and a row that would rebind an account is an issue, never a write.

import type { Role } from '../../app/src/auth/accounts';
import { NO_LONGER_LISTED_TEXT, skippedLinesText, statusCountText } from '../../app/src/instructor/rosterReportText';
import type { Db } from './db';
import { placeRosterEntry } from './identity';
import {
  parseRoster,
  rosterReview,
  type RosterColumns,
  type RosterIssue,
  type RosterReviewItem,
  type RosterStatusCount,
} from './roster';

export interface RosterImportReport {
  added: number;
  updated: number;
  /** Rows imported (added + updated); a conflicting row is an issue instead. */
  total: number;
  /** Physical line of the header row; null when none was found. */
  headerLine: number | null;
  /** Non-enrolled statuses seen, imported or not ("1 dropped — not imported"). */
  statusCounts: RosterStatusCount[];
  /** Students on the platform a class list no longer carries — to review. */
  noLongerListed: RosterReviewItem[];
  issues: RosterIssue[];
  columns: RosterColumns;
}

export function importRosterCsv(db: Db, csv: string, defaultRole: Role): RosterImportReport {
  const parsed = parseRoster(csv, defaultRole);
  const before = db.listUsers();
  let added = 0;
  let updated = 0;
  const issues = [...parsed.issues];
  for (const entry of parsed.entries) {
    const placed = placeRosterEntry(db, entry);
    if (placed.kind === 'added') added++;
    else if (placed.kind === 'updated') updated++;
    else issues.push({ line: entry.line, reason: `${placed.reason} — row not imported` });
  }
  issues.sort((a, b) => a.line - b.line);
  return {
    added,
    updated,
    total: added + updated,
    headerLine: parsed.headerLine,
    statusCounts: parsed.statusCounts,
    noLongerListed: rosterReview(before, parsed),
    issues,
    columns: parsed.columns,
  };
}

/** The report as plain lines — the CLI prints them. The words are the
 *  dashboard's (app/src/instructor/rosterReportText.ts). */
export function formatRosterReport(report: RosterImportReport): string[] {
  const c = report.columns;
  const lines = [
    `columns: email=${c.email ?? '-'} name=${c.name ?? '-'} id=${c.studentId ?? '-'} role=${c.role ?? '-'} ` +
      `section=${c.section ?? '-'} status=${c.status ?? '-'}`,
  ];
  const skipped = skippedLinesText(report.headerLine);
  if (skipped) lines.push(skipped);
  lines.push(`imported ${report.total}: ${report.added} added, ${report.updated} updated`);
  for (const s of report.statusCounts) lines.push(`  ${statusCountText(s)}`);
  for (const issue of report.issues) lines.push(`  line ${issue.line}: ${issue.reason}`);
  if (report.noLongerListed.length > 0) {
    lines.push(`${NO_LONGER_LISTED_TEXT} (nobody was removed):`);
    for (const r of report.noLongerListed) lines.push(`  ${r.name} <${r.email}> — ${r.reason}`);
  }
  return lines;
}
