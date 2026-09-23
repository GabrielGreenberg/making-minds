// Roster import — the ONE path from a CSV to roster rows, shared by the
// instructor's screen (POST /api/roster/import) and the admin CLI
// (`npm run roster -- import`), so both produce the same report.
//
// Importing only adds and updates. It never removes anyone and never touches
// a password: a mid-quarter re-import must not delete a student's work or sign
// them out. Who a class list no longer carries is REPORTED (noLongerListed)
// for a human to act on; removal is the explicit DELETE /api/roster/:email.

import type { Role } from '../../app/src/auth/accounts';
import { NO_LONGER_LISTED_TEXT, skippedLinesText, statusCountText } from '../../app/src/instructor/rosterReportText';
import type { Db } from './db';
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
  /** Rows imported (added + updated). */
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
  for (const entry of parsed.entries) {
    if (db.getUser(entry.email)) updated++;
    else added++;
    db.upsertUser(entry);
  }
  return {
    added,
    updated,
    total: parsed.entries.length,
    headerLine: parsed.headerLine,
    statusCounts: parsed.statusCounts,
    noLongerListed: rosterReview(before, parsed),
    issues: parsed.issues,
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
