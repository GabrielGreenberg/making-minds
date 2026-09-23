// The roster-import report's words — ONE copy, shared by the dashboard's
// import panel (RosterView) and the admin CLI (server/src/rosterImport.ts
// formatRosterReport), and pinned by server/tools/rosterCheck.ts. Pure (no
// React), so the server imports it as it does devData/homeworkSync.

/** "skipped 8 lines before the header"; null when the header is line 1 or absent. */
export function skippedLinesText(headerLine: number | null): string | null {
  if (headerLine == null || headerLine <= 1) return null;
  const n = headerLine - 1;
  return `skipped ${n} ${n === 1 ? 'line' : 'lines'} before the header`;
}

/** One non-enrolled status: "7 waitlisted — imported", "1 dropped — not imported". */
export function statusCountText(s: { count: number; label: string; imported: boolean }): string {
  return `${s.count} ${s.label} — ${s.imported ? 'imported' : 'not imported'}`;
}

/** The heading over the students a class list no longer carries (nobody is removed). */
export const NO_LONGER_LISTED_TEXT = 'no longer on the class list — review';

/** The same words starting a sentence, as the dashboard shows them. */
export const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
