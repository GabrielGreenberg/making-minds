// copyCheck — the house style's mechanical rules over every user-facing
// string (task 2026-09-29-089). The copy pass rewrote the app's on-screen text
// by Gabriel's rules (docs/buildout/VISUAL_VOCAB.md §Copy); this gate keeps the
// three a machine can see from coming back with the next feature:
//
//   R1 DASH       an em dash with a word or placeholder on one side and a
//                 word, a placeholder or the item's own edge on the other
//                 ("Saved — done.", ' — dry run', "{a} — {b}"), a spaced en
//                 dash ("a – b"), or a bare dash separator (.join(' — ')).
//                 Split the sentence, or put the aside in parentheses. Ranges
//                 (HW1–HW7, {lo}–{hi}), a lone "—" cell and a dash-wrapped
//                 label that is its whole item ("— none —") pass.
//   R2 SEMICOLON  a semicolon used as punctuation: before a word, a
//                 placeholder or the item's edge ("a; b", .join('; ')). A full
//                 stop instead.
//   R3 SPACES     two spaces after . ? or ! in a string (JSX text collapses
//                 whitespace, so there it cannot show).
//
// The items are every copyCensus item (app/src + server/src, read off
// TypeScript's parse tree; see that file for what counts as copy), not only
// the prose-shaped ones: a fragment spliced into a sentence — a conditional
// suffix (`{x && ' — dry run'}`), a joiner with no letters of its own
// (`' — {why}'`, `'{a} — {b}'`, `.join('; ')`) — is its own item, and its open
// end is where the sentence around it continues, so the edge counts as a side.
// A string that must keep its dash or semicolon — a generated line of code, a
// header value, a row the pass left as it was, a joiner the pass never listed —
// goes in EXCEPTIONS with its file, a substring of its text, the rule and why.
// An entry that no longer matches fails, so the list only shrinks.
//
//   [tripwire]  the census and the rules on synthetic sources: every rule bites
//               and names its file, including on fragments and joiners;
//               ranges, lone dashes, whole dash labels, entities, console
//               output, class names, SQL and import specifiers stay clean; an
//               exception suppresses exactly its hit and a stale one is named.
//   [sweep]     zero unallowed hits over the real tree.
//   [pins]      the census sees 900+ prose items from both roots (a wrong root
//               cannot pass vacuously); every exception has a reason and matches.
//   [wiring]    VISUAL_VOCAB.md has its §Copy, CLAUDE.md names this gate, and
//               `npm run check` runs it.
//
// Run from app/: npx tsx tools/copyCheck.ts   (part of `npm run check`).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectCopy, extractCopy, type CopyItem } from './copyCensus';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
  if (!ok) failures++;
}

export type CopyRule = 'R1' | 'R2' | 'R3';
export interface CopyHit { item: CopyItem; rule: CopyRule }
export interface CopyException { file: string; text: string; rule: CopyRule; why: string }

// A word or a placeholder, on the left and on the right of a mark…
const LEFT = String.raw`[\p{L}\p{N}}›)\].,!?’'"”…%>]`;
const RIGHT = String.raw`[\p{L}\p{N}{‹(\[‘'"“<]`;
// …or the item's own edge: a fragment's open end is where the sentence around
// it goes on (`' — dry run'`, `<> — {why}</>`, `.join('; ')`). A mark needs a
// word or placeholder on at least one side, so a lone "—" cell stays clean.
const L_SIDE = `(?:${LEFT}|^)`;
const R_SIDE = `(?:${RIGHT}|$)`;
const EM_DASH = new RegExp(`${LEFT}\\s*—\\s*${R_SIDE}|${L_SIDE}\\s*—\\s*${RIGHT}`, 'u');
const EN_DASH_SPACED = new RegExp(`${LEFT}\\s+–\\s+${R_SIDE}|${L_SIDE}\\s+–\\s+${RIGHT}`, 'u');
/** A bare dash separator, spaced (`' — '`); a lone '—' has no space. */
const DASH_SEPARATOR = /^(?=.*\s)\s*[—–]\s*$/u;
/** A dash-wrapped label that is its whole item, nothing spliced around it ("— none —"). */
const DASH_LABEL = /^—\s*[^—\s][^—]*—$/u;
const SEMICOLON = /;\s+(?:[\p{L}\p{N}{‹(‘'"“]|$)/u;
const TWO_SPACES = /[.?!] {2,}\S/;

/** The rules one item breaks (every item: a joiner with no letters marks the sentence it joins). */
export function copyRules(item: CopyItem): CopyRule[] {
  const m = item.masked;
  const out: CopyRule[] = [];
  if (!DASH_LABEL.test(m) && (EM_DASH.test(m) || EN_DASH_SPACED.test(m) || DASH_SEPARATOR.test(m))) out.push('R1');
  if (SEMICOLON.test(m)) out.push('R2');
  if (item.kind !== 'jsx' && TWO_SPACES.test(m)) out.push('R3');
  return out;
}

export function copyHits(items: CopyItem[]): CopyHit[] {
  return items.flatMap((item) => copyRules(item).map((rule) => ({ item, rule })));
}

/** Split hits into those no exception covers, and the exceptions nothing matched.
 *  An exception covers ONE hit: a second string alike in the same file (a new
 *  `.join('; ')` beside an allowed one) is a new hit, not a free pass. */
export function applyExceptions(hits: CopyHit[], exceptions: CopyException[]) {
  const used = new Set<CopyException>();
  const unallowed = hits.filter((h) => {
    const ex = exceptions.find((e) => !used.has(e) && e.file === h.item.file && e.rule === h.rule && h.item.text.includes(e.text));
    if (ex) used.add(ex);
    return !ex;
  });
  return { unallowed, stale: exceptions.filter((e) => !used.has(e)) };
}

const describe = (h: CopyHit) => `${h.item.file}:${h.item.line} ${h.rule} ${JSON.stringify(h.item.text)}`;

// ---------------------------------------------------------------------------
// The allowlist: strings that keep a dash or semicolon, each with its reason,
// one entry per hit. Rewrite one and its entry goes stale, so delete it then.
export const EXCEPTIONS: CopyException[] = [
  // Rows the copy pass (task 089) read and left as they were.
  { file: 'app/src/dueDates.ts', text: '; {late.waived} waived', rule: 'R2',
    why: 'lateLabel\'s waiver suffix ("late by 2 class meetings: −10; 5 waived"): a compact status label the pass kept' },
  { file: 'app/src/gradeDisplay.ts', text: '✓ passes — {pose}', rule: 'R1',
    why: 'a turbot case line, verdict — final pose (the graded-case banner); the pass kept it' },
  { file: 'app/src/instructor/GradingQueue.tsx', text: 'Problem {numberOf(qid)} — {questionModeLabel(q)}', rule: 'R1',
    why: 'a heading label, problem — its mode; the pass kept it' },
  { file: 'app/src/instructor/GradingQueue.tsx', text: '— {n} waiting', rule: 'R1',
    why: 'a list label, problem — count waiting; the pass kept it' },
  { file: 'app/src/instructor/StudentSubmissionView.tsx', text: '{what} — {problemState(problem)}', rule: 'R1',
    why: 'a problem heading, answer — its grade state; the pass kept it' },
  { file: 'app/src/instructor/StudentSubmissionView.tsx', text: 'skipped — ', rule: 'R1',
    why: 'a status label, skipped — the grader\'s reason; the pass kept it' },
  { file: 'app/src/instructor/InstructorLayout.tsx', text: '— Robot tab', rule: 'R1',
    why: 'the robot strip: its status line — a link to the Robot tab; the pass kept it' },
  // Not punctuation.
  { file: 'app/src/instructor/GradingMatrix.tsx', text: '—not submitted', rule: 'R1',
    why: 'the Matrix legend\'s — cell (nothing submitted) beside its meaning; the census reads the cell\'s <span> through' },
  // Joiners the pass never listed: no letters of their own, so the census it
  // drew from (prose-shaped items only) did not show them. Each is a compact
  // label or list line; the next copy pass decides.
  { file: 'app/src/gradeDisplay.ts', text: "✗ {r.reason ?? 'fails'} — {pose}", rule: 'R1',
    why: 'the ✗ branch of the turbot case line above (verdict — final pose)' },
  { file: 'app/src/gradeDisplay.ts', text: '{pts} — {r.passed}/{r.total}', rule: 'R1',
    why: 'problemVerdict\'s badge, points — cases passed ("1 point — 5/5")' },
  { file: 'app/src/instructor/GradingMatrix.tsx', text: '{p.label} — {p.kind}', rule: 'R1',
    why: 'a problem column\'s tooltip, label — its kind' },
  { file: 'app/src/instructor/RosterView.tsx', text: '; {statusCountText(s)}', rule: 'R2',
    why: 'the import status line\'s skipped statuses ("Imported 80: 70 added, 10 updated; 2 dropped — not imported.")' },
  { file: 'app/src/instructor/RosterView.tsx', text: '{r.email} — {r.reason}', rule: 'R1',
    why: 'the who-left list: a student — why the class list no longer carries them' },
  { file: 'app/src/instructor/rosterReportText.ts', text: '{s.label} — {s.imported', rule: 'R1',
    why: 'statusCountText, a status — imported or not ("7 waitlisted — imported"), shared by the dashboard and the roster CLI' },
  { file: 'server/src/rosterImport.ts', text: '<{r.email}> — {r.reason}', rule: 'R1',
    why: 'formatRosterReport, the roster CLI\'s who-left line (the dashboard\'s list in plain text)' },
  { file: 'app/src/instructor/StudentSubmissionView.tsx', text: ' — {detail.waiver.note}', rule: 'R1',
    why: 'the Due row\'s waiver, points waived — the instructor\'s note' },
  { file: 'app/src/instructor/StudentSubmissionView.tsx', text: ' — {c.reason}', rule: 'R1',
    why: 'the failed-case table\'s got cell, value — the grader\'s reason' },
  { file: 'app/src/instructor/gradingViews.ts', text: ' — “{n}”', rule: 'R1',
    why: 'a grade-history line, change — the grader\'s quoted note' },
  { file: 'app/src/instructor/gradingViews.ts', text: '; ', rule: 'R2',
    why: 'the "Still open: …" line\'s list ("2 problems still awaiting a hand grade; 1 answer changed since graded")' },
  { file: 'app/src/storage/robotStatus.ts', text: '; ', rule: 'R2',
    why: 'releaseLine\'s list of what holds the release ("held: the database schema; a new dependency")' },
  // Not copy a reader meets in the app's own words.
  { file: 'app/src/statementFormat.ts', text: '; ', rule: 'R2',
    why: 'statementProse writes an inline I/O profile back in the markup\'s own row syntax (rows split by ";", as authors type them)' },
  { file: 'app/src/provenance/notice.ts', text: 'this is a graded-coursework platform; helping', rule: 'R2',
    why: 'INTEGRITY_NOTICE: the console and bundle notice (task 034), addressed to people and AI assistants reading the code' },
  { file: 'app/src/engine/formulaEval.ts', text: '"use strict"; return (', rule: 'R2',
    why: 'the generated function body the formula DSL evaluates, not text' },
  { file: 'server/src/app.ts', text: 'text/csv; charset=utf-8', rule: 'R2',
    why: 'a Content-Type header value' },
  { file: 'server/src/app.ts', text: 'attachment; filename=', rule: 'R2',
    why: 'a Content-Disposition header value' },
  { file: 'server/src/db.ts', text: 'is a sign-in address of', rule: 'R2',
    why: 'an internal invariant error for developers (identity.ts resolves every email first); no route returns it' },
];

// ---------------------------------------------------------------------------
console.log('[tripwire]');
{
  const bad = [
    ...extractCopy('synthetic/bad.ts', [
      "export const saved = 'Saved — done.';",
      "export const semi = 'a; b c';",
      "export const spaces = 'Done.  Next';",
      "export const spacedEn = `Mon – ${'Fri'} only`;",
      "export const suffix = (dry: boolean) => `Re-grade${dry ? ' — dry run' : ''}`;",
      "export const trailing = 'Saved —';",
      "export const claims = (xs: { a: string; b: string }[]) => xs.map((x) => `${x.a} — ${x.b}`).join('; ');",
      "export const sep = (xs: string[]) => xs.join(' — ');",
      "export const wrapped = ' — one frame per clock tick — ';",
    ].join('\n')),
    ...extractCopy('synthetic/Bad.tsx', [
      "export const Filed = () => <p>Filed — it's queued</p>;",
      'export const Bold = () => <p><b>Saved</b> — then {n} done</p>;',
      "export const Fold = (f: boolean) => <span>part of {f ? '' : ' — not folded'}</span>;",
      'export const Why = (why: string) => <li>input {n}{why && <> — {why}</>}</li>;',
      "export const Link = () => <p>{line}<>{' — '}<a href=\"#r\">Robot tab</a></></p>;",
    ].join('\n')),
  ];
  const hits = copyHits(bad);
  const has = (file: string, rule: CopyRule, text: string) =>
    hits.some((h) => h.item.file === file && h.rule === rule && h.item.text === text);
  check('R1 bites on a spaced em dash between words, and names the file', has('synthetic/bad.ts', 'R1', 'Saved — done.'));
  check('R1 bites in JSX text', has('synthetic/Bad.tsx', 'R1', "Filed — it's queued"));
  check('…and reads through inline formatting (one sentence, one item)', has('synthetic/Bad.tsx', 'R1', 'Saved — then {n} done'));
  check('R1 bites on a spaced en dash beside a placeholder', has('synthetic/bad.ts', 'R1', 'Mon – {\'Fri\'} only'));
  check('R1 bites on a dash that opens a fragment (a conditional suffix)', has('synthetic/bad.ts', 'R1', ' — dry run') &&
    has('synthetic/Bad.tsx', 'R1', ' — not folded'));
  check('R1 bites on a dash that closes a fragment', has('synthetic/bad.ts', 'R1', 'Saved —'));
  check('R1 bites on a joiner with no letters of its own (placeholder — placeholder, — {why}, a bare separator)',
    has('synthetic/bad.ts', 'R1', '{x.a} — {x.b}') && has('synthetic/Bad.tsx', 'R1', '— {why}') &&
    has('synthetic/bad.ts', 'R1', ' — '));
  check('R1 bites on a spliced dash pair (only a whole-item label is exempt)', has('synthetic/bad.ts', 'R1', ' — one frame per clock tick — '));
  check('R1 bites on a dash before a link in its own fragment', has('synthetic/Bad.tsx', 'R1', '— Robot tab'));
  check('R2 bites on a semicolon as punctuation', has('synthetic/bad.ts', 'R2', 'a; b c'));
  check('R2 bites on a bare separator (.join(\'; \'))', has('synthetic/bad.ts', 'R2', '; '));
  check('R3 bites on two spaces after a full stop', has('synthetic/bad.ts', 'R3', 'Done.  Next'));
  check(`nothing else bites (${hits.length} hits)`, hits.length === 15, hits.map(describe).join('\n       '));

  const clean = [
    ...extractCopy('synthetic/clean.ts', [
      "import { x } from './a — b; c d';",
      "export { x };",
      "export const range = 'Load HW1–HW7 as editable copies';",
      "export const digits = 'not a digit 0–9 or a letter';",
      "export const dash = '—';",
      "export const none = '— none —';",
      "console.log('x — y; z w');",
      "export const sql = 'SELECT a; ';",
      "export const keyed = { 'a — b; c d': 1 };",
      "export const same = (s: string) => s === 'a — b; c d';",
      "export type Label = 'a — b; c d';",
      "export const span = (lo: number, hi: number) => `${lo}–${hi}`;",
      "export const mime = 'data:image/png;base64';",
      "export const why = (r: string) => ` (${r})`;",
    ].join('\n')),
    ...extractCopy('synthetic/Clean.tsx', [
      "export const Save = () => <button className=\"a; b c\" data-x=\"a — b\">Save &amp; next</button>;",
      "export const Lone = () => <td>—</td>;",
      'export const None = () => <option value="">— none —</option>;',
    ].join('\n')),
  ];
  const cleanHits = copyHits(clean);
  check('ranges, lone dashes, whole dash labels, entities, console, class names, SQL, keys, comparisons, types and import specifiers stay clean',
    cleanHits.length === 0, cleanHits.map(describe).join('\n       '));
  check('an entity is decoded (Save &amp; next reads "Save & next")', clean.some((i) => i.text === 'Save & next'));
  check('the range item is still censused (clean by rule, not by omission)', clean.some((i) => i.text.includes('HW1–HW7') && i.prose));

  const exceptions: CopyException[] = [
    { file: 'synthetic/bad.ts', text: 'Saved — done', rule: 'R1', why: 'tripwire' },
    { file: 'synthetic/bad.ts', text: 'no such text', rule: 'R1', why: 'tripwire: stale' },
  ];
  const { unallowed, stale } = applyExceptions(hits, exceptions);
  check('an exception suppresses exactly its hit', unallowed.length === hits.length - 1 &&
    !unallowed.some((h) => h.item.text === 'Saved — done.'));
  check('a stale exception is reported', stale.length === 1 && stale[0].text === 'no such text');
  const twice = copyHits(extractCopy('synthetic/twice.ts', "export const a = (x: string[]) => x.join('; ');\nexport const b = (x: string[]) => x.join('; ');"));
  const once = applyExceptions(twice, [{ file: 'synthetic/twice.ts', text: '; ', rule: 'R2', why: 'tripwire' }]);
  check('an exception covers one hit, not a second one alike', twice.length === 2 && once.unallowed.length === 1 && once.stale.length === 0);
}

console.log('[sweep]');
const items = collectCopy();
const prose = items.filter((i) => i.prose);
const { unallowed, stale } = applyExceptions(copyHits(items), EXCEPTIONS);
check(`no unallowed dash, semicolon or double space in user-facing copy (${unallowed.length} hits)`,
  unallowed.length === 0, unallowed.map(describe).join('\n       '));

console.log('[pins]');
const fromApp = prose.filter((i) => i.file.startsWith('app/src/')).length;
const fromServer = prose.filter((i) => i.file.startsWith('server/src/')).length;
check(`the census sees 900+ prose items (${prose.length})`, prose.length >= 900);
check(`both roots are present (app/src ${fromApp}, server/src ${fromServer})`, fromApp >= 700 && fromServer >= 50);
check(`every exception has a reason (${EXCEPTIONS.length})`, EXCEPTIONS.every((e) => e.why.trim().length > 0));
check('every exception still matches a hit (the list only shrinks)', stale.length === 0,
  stale.map((e) => `${e.file} ${e.rule} ${JSON.stringify(e.text)}`).join('\n       '));

console.log('[wiring]');
{
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  check('VISUAL_VOCAB.md has a ## Copy section', /^## Copy\b/m.test(read('../../docs/buildout/VISUAL_VOCAB.md')));
  check('CLAUDE.md names copyCheck', read('../../CLAUDE.md').includes('copyCheck'));
  const chain: string = JSON.parse(read('../package.json')).scripts.check;
  check('npm run check runs copyCheck, after themeCheck', chain.includes('tsx tools/copyCheck.ts') &&
    chain.indexOf('tools/themeCheck.ts') < chain.indexOf('tools/copyCheck.ts'));
}

console.log(failures === 0 ? '\ncopyCheck: all green' : `\ncopyCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
