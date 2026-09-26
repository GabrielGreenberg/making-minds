// workbenchCheck — the editor workbench (task 2026-09-25-052; the design memo
// is docs/buildout/designs/editor-workbench.md). Pins the frame's pure parts
// (src/workbench.ts) against the real homeworks, and the frame's wiring in
// the source:
//
//   [columns]        widths clamp to their ranges (a stored pref too), both
//                    panels open unless a pref says exactly false, the old
//                    data panel's width carries over.
//   [question list]  the document's sections and numbering, a row per
//                    problem in each, empty sections left out, the student's
//                    own marks only (done / started — never a grade), the
//                    list tags, the heading, the short name, the notes links.
//   [top bar labels] the save state's every branch, the submitted time.
//   [one frame]      every question kind and the sandbox render inside
//                    EditorShell; the sandbox has no question panel; the
//                    retired MenuBar is gone; the question text left the data
//                    panel; nothing in the frame reads the answer key.
//   [output panel]   (task 053) a circuit's live truth table (engine
//                    truthTableCC) against a reference circuit; ONE control
//                    row — the retired toolbar is gone, no panel builds a
//                    Run/Step of its own for CC, FSM, TM or turbot, the row
//                    renders the store's one descriptor; the canvas's action
//                    group calls the store's (locked) actions.
//
// Run from app/: npx tsx tools/workbenchCheck.ts   (part of `npm run check`).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssignmentData, CircuitData, QuestionCircuit } from '../src/types';
import { truthTableCC, TRUTH_TABLE_MAX_INPUTS } from '../src/engine';
import { documentSections } from '../src/problemSet';
import {
  COLLAPSED_STRIP,
  LEFT_PANEL,
  RIGHT_PANEL,
  assignmentShortName,
  clampPanelWidth,
  editorLayoutFromPrefs,
  questionHeading,
  questionList,
  questionListTag,
  questionMark,
  saveLabel,
  sectionNotesLabel,
  submittedLabel,
} from '../src/workbench';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
  if (!ok) failures++;
}

const SRC = join(import.meta.dirname, '../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
/** The source without its comments — a pin reads the code, not the prose. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\/|(?<=^|\s)\/\/[^\n]*/gm, '');
const hw = (n: number) => JSON.parse(read(`devData/homeworks/hw${n}.json`)) as AssignmentData;
const circuit = (over: Partial<QuestionCircuit> = {}): QuestionCircuit => ({ components: [], wires: [], boxes: [], ...over });

console.log('[columns]');
check('the memo\'s ranges: left 260–480 (320), right 240–480 (300), strips 40',
  LEFT_PANEL.min === 260 && LEFT_PANEL.max === 480 && LEFT_PANEL.initial === 320 &&
    RIGHT_PANEL.min === 240 && RIGHT_PANEL.max === 480 && RIGHT_PANEL.initial === 300 && COLLAPSED_STRIP === 40);
check('a width clamps into its range',
  clampPanelWidth(100, LEFT_PANEL) === 260 && clampPanelWidth(900, LEFT_PANEL) === 480 && clampPanelWidth(333.4, LEFT_PANEL) === 333);
check('a missing or junk width falls back to the initial one',
  clampPanelWidth(undefined, RIGHT_PANEL) === 300 && clampPanelWidth('wide', RIGHT_PANEL) === 300 && clampPanelWidth(NaN, RIGHT_PANEL) === 300);
{
  const fresh = editorLayoutFromPrefs({});
  check('no prefs: both panels open at their initial widths',
    fresh.leftOpen && fresh.rightOpen && fresh.leftW === 320 && fresh.rightW === 300);
  const stored = editorLayoutFromPrefs({ 'editor.leftW': 1000, 'editor.rightW': 250, 'editor.leftOpen': false, 'editor.rightOpen': 'no' });
  check('stored prefs: widths clamped, closed only on exactly false',
    stored.leftW === 480 && stored.rightW === 250 && !stored.leftOpen && stored.rightOpen);
  check('the old data panel\'s width carries over until the column has its own',
    editorLayoutFromPrefs({ panelWidth: 420 }).rightW === 420 &&
      editorLayoutFromPrefs({ panelWidth: 100 }).rightW === 240 &&
      editorLayoutFromPrefs({ panelWidth: 420, 'editor.rightW': 360 }).rightW === 360);
}

console.log('\n[question list]');
{
  const hw1 = hw(1);
  const doc = documentSections(hw1);
  const marks = new Map<number, QuestionCircuit>([
    [hw1.questions[0].id, circuit({ done: true })],
    [hw1.questions[1].id, circuit({ components: [{ id: 'c', type: 'AND', x: 0, y: 0, ports: [], rotation: 0, label: '' } as unknown as QuestionCircuit['components'][number]] })],
    [hw1.questions[5].id, circuit({ responseText: '   ' })],
    [hw1.questions[6].id, circuit({ responseText: 'An answer.' })],
  ]);
  const list = questionList(hw1, (id) => marks.get(id), 3);
  check('HW1: the document\'s four sections, in order', list.map((s) => s.heading).join(' | ') === doc.map((s) => s.heading).join(' | ') && list.length === 4);
  const rows = list.flatMap((s) => s.rows);
  check('HW1: one row per problem (23), each index once', rows.length === 23 && new Set(rows.map((r) => r.index)).size === 23);
  check('HW1: the document\'s numbering (1…5, 6a, 6b, 6c, 7 …)',
    rows.slice(0, 8).map((r) => r.number).join(',') === '1,2,3,4,5,6a,6b,6c');
  check('exactly the open question is current', rows.filter((r) => r.current).map((r) => r.index).join() === '3');
  check('marks are the student\'s own: done, started (a part), none (blank text), started (text)',
    rows[0].mark === 'done' && rows[1].mark === 'started' && rows[5].mark === null && rows[6].mark === 'started' && rows[2].mark === null);
  check('a titled row shows its title; an untitled one its label',
    rows[0].title === 'NAND' && rows[5].title === null && rows[5].label === 'Problem 6a');
  check('HW1 tags: the circuits CC (accent), the prose "Written"',
    rows[0].tag.text === 'CC' && rows[0].tag.machine && rows[5].tag.text === 'Written' && !rows[5].tag.machine);
  check('done outranks started', questionMark(circuit({ done: true, responseText: 'x' })) === 'done');
  check('a filled blank starts a question; an empty map entry does not',
    questionMark(circuit({ fillAnswers: ['', '42'] })) === 'started' && questionMark(circuit({ fillAnswers: ['', ' '] })) === null && questionMark(undefined) === null);

  const hw5 = hw(5);
  const hasEmptySection = documentSections(hw5).some((s) => s.problems.length === 0);
  const hw5List = questionList(hw5, () => undefined, 0);
  check('HW5: a section with no problems (its rules preamble) is left out of the list',
    hasEmptySection && hw5List.every((s) => s.rows.length > 0) && hw5List.flatMap((s) => s.rows).length === hw5.questions.length);

  check('fill-in tags: every blank digits-only → "Number", else "Fill-in"',
    questionListTag({ buildMode: 'open', fill_in: { labels: ['a', 'b'], numericOnly: true } }).text === 'Number' &&
      questionListTag({ buildMode: 'open', fill_in: { labels: ['a', 'b'], numericOnly: [true, false] } }).text === 'Fill-in' &&
      questionListTag({ buildMode: 'open', fill_in: { labels: ['a'] } }).text === 'Fill-in');
  check('machine tags name the mode (turbot with its brain, perception)',
    questionListTag({ buildMode: 'turbot', innerMode: 'FSM' }).text === 'turbot - FSM' &&
      questionListTag({ buildMode: 'SC', perception: { rule: { kind: 'change' }, width: 8 } } as never).text === 'SC - perception');

  check('the heading: "Problem 1 · NAND", or just the label',
    questionHeading(hw1.questions[0]) === 'Problem 1 · NAND' && questionHeading(hw1.questions[5]) === 'Problem 6a');
  check('the list header\'s short name: "HW1" from the title; none without a code',
    assignmentShortName(hw1.title) === 'HW1' && assignmentShortName('HW12a. Later') === 'HW12a' && assignmentShortName('Practice set') === null);
  check('section notes are named by what is behind them',
    sectionNotesLabel(doc[0]) === 'Hint for this section' &&
      sectionNotesLabel(doc[2]) === 'Challenge problem (optional, not collected)' &&
      sectionNotesLabel(doc[1]) === null &&
      sectionNotesLabel({ callouts: [], figures: [{ src: 'x.svg', alt: 'x' }] }) === 'Figure for this section' &&
      sectionNotesLabel({ callouts: [doc[0].callouts[0]], figures: [{ src: 'x.svg', alt: 'x' }] }) === 'Notes for this section (2)');
}

console.log('\n[top bar labels]');
{
  const now = Date.UTC(2026, 8, 25, 22, 0, 0);
  check('error → "Not saved — retrying", flagged', saveLabel('error', now, now).text === 'Not saved — retrying' && saveLabel('error', null, now).error);
  check('pending or in flight → "Saving…"', saveLabel('unsaved', now, now).text === 'Saving…' && saveLabel('saving', null, now).text === 'Saving…');
  check('saved, nothing confirmed since opening → "Saved"', saveLabel('saved', null, now).text === 'Saved');
  check('under a minute → "Saved just now"', saveLabel('saved', now - 59_000, now).text === 'Saved just now');
  check('minutes → "Saved N min ago"', saveLabel('saved', now - 3 * 60_000 - 5_000, now).text === 'Saved 3 min ago' && saveLabel('saved', now - 59 * 60_000, now).text === 'Saved 59 min ago');
  check('an hour or more → "Saved at <time>"', saveLabel('saved', now - 2 * 3600_000, now).text.startsWith('Saved at '));
  check('a clock running backwards never reads as the future', saveLabel('saved', now + 5_000, now).text === 'Saved just now');
  const today = new Date(now - 3600_000).toISOString();
  const earlier = new Date(now - 3 * 86400_000).toISOString();
  check('submitted today → the time; another day → the date too',
    /^Submitted \d/.test(submittedLabel(today, now)) && /^Submitted [A-Z][a-z]{2} \d+, /.test(submittedLabel(earlier, now)));
}

console.log('\n[one frame]');
{
  const app = code('App.tsx');
  check('App renders every question kind and the sandbox inside EditorShell (two uses, no other chrome)',
    (app.match(/<EditorShell\b/g) ?? []).length === 2 && !/MenuBar|<TabBar \/>\s*<SimulationToolbar/.test(app.replace(/\{!assignment && <TabBar \/>\}/, '')));
  check('the sandbox keeps its worksheet tabs over the canvas, only outside an assignment', /\{!assignment && <TabBar \/>\}/.test(app));
  check('the retired MenuBar is gone', !existsSync(join(SRC, 'components/MenuBar.tsx')));
  const shell = code('components/EditorShell.tsx');
  // The left column is the one `{inAssignment && …}` block before <main>;
  // the panel and its collapsed strip render nowhere else.
  const left = shell.slice(Math.max(0, shell.indexOf('{inAssignment &&')), shell.indexOf('<main'));
  check('the question panel renders only in an assignment (the sandbox has none)',
    left.startsWith('{inAssignment &&') && left.includes('<QuestionPanel ') && left.includes('<QuestionPanelStrip ') &&
      (shell.match(/<QuestionPanel(Strip)?\b/g) ?? []).length === 2);
  const table = code('components/DataTable.tsx');
  check('the data panel no longer renders the question (it is in the question panel)',
    !/ProblemBody|ProblemContext|QuestionStatement/.test(table));
  check('…and no longer sizes itself (the frame\'s column does)', !/panelWidth|panel-resize-handle/.test(table));
  // F1 (law 1): the goal table comes from the statement's own profile —
  // students never receive test_cases in remote mode.
  for (const rel of ['workbench.ts', 'components/QuestionPanel.tsx', 'components/EditorShell.tsx', 'components/EditorTopBar.tsx']) {
    check(`${rel} reads no answer key`, !/test_cases|perception_cases|fill_in_answers/.test(read(rel)));
  }
  const panel = code('components/QuestionPanel.tsx');
  check('the done mark goes through the store\'s toggle (the lock stays the store\'s, law 3)',
    /toggleCurrentQuestionDone/.test(panel) && !/isCurrentQuestionLocked/.test(panel));
  check('the done mark is a checkbox-role button, not an <input> (the canvas\'s shortcuts stand down while an input has focus)',
    /role="checkbox"/.test(panel) && !/<input\b/.test(panel));
  check('navigation goes through navigate() with the viewed attempt carried along',
    /navigate\(\{ kind: 'assignment', id: assignment\.id, attempt, questionIndex: i \}, \{ replace: true \}\)/.test(panel));
}

console.log('\n[output panel]');
{
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/reference', name), 'utf8')) as { correct: CircuitData };
  // HW1 P3: OUT1 = IN1 AND IN2, OUT2 = its NOT.
  const p3 = fixture('hw1-p3.json').correct;
  const t = truthTableCC(p3.components, p3.wires);
  check('the live table: every row at once, IN1 most significant, 00 first',
    t !== null && t !== 'too-many' && t.rows.map((r) => r.inputBits.join('')).join(' ') === '00 01 10 11');
  check('…each row the grader\'s evaluation (HW1 P3: AND and NAND)',
    t !== null && t !== 'too-many' && t.rows.map((r) => r.outputBits.join('')).join(' ') === '01 01 01 10' &&
      t.inputLabels.join() === 'IN1,IN2' && t.outputLabels.join() === 'OUT1,OUT2' && t.wired.every(Boolean));
  {
    const unwired = { ...p3, wires: p3.wires.filter((w) => w.targetComponentId !== p3.components.find((c) => c.label === 'OUT2')!.id) };
    const u = truthTableCC(unwired.components, unwired.wires);
    check('an output no wire reaches is marked unwired (the panel shows it blank)', u !== null && u !== 'too-many' && u.wired.join() === 'true,false');
  }
  check('no INPUT or no OUTPUT → no table',
    truthTableCC(p3.components.filter((c) => c.type !== 'OUTPUT'), []) === null &&
      truthTableCC(p3.components.filter((c) => c.type !== 'INPUT'), []) === null);
  {
    const many = Array.from({ length: TRUTH_TABLE_MAX_INPUTS + 1 }, (_, i) => ({ ...p3.components[0], id: `in${i}`, label: `IN${i + 1}` }));
    check(`more than ${TRUTH_TABLE_MAX_INPUTS} inputs → 'too-many'`, truthTableCC([...many, p3.components.find((c) => c.type === 'OUTPUT')!], []) === 'too-many');
  }

  const app = code('App.tsx');
  check('the retired simulation toolbar is gone', !existsSync(join(SRC, 'components/SimulationPanel.tsx')) && !/SimulationToolbar/.test(app));
  check('the output panel is OutputPanel', /<EditorShell output=\{<OutputPanel \/>\}>/.test(app));
  const out = code('components/OutputPanel.tsx');
  check('ONE control row, rendered from the store\'s descriptor and dispatched through runControl',
    /selectRunControls/.test(out) && /runControl\('run'/.test(out) && /runControl\('step'\)/.test(out) &&
      /runControl\('reset'\)/.test(out) && /runControl\('stop'\)/.test(out) && !/setInterval|setTimeout/.test(out));
  const table = code('components/DataTable.tsx');
  const map = code('components/TurbotArenaPanel.tsx');
  check('no panel builds a Run/Step of its own for CC, FSM, TM or turbot',
    !/\b(fsmRun|fsmStep|tmRun|tmStep|scSequenceRun|scSequenceStep)\b/.test(table) && !/\b(turbotRun|turbotStep)\b/.test(map) &&
      !/setInterval/.test(table));
  check('the CC table is the live one', /<LiveTruthTable \/>/.test(table) && /truthTableCC/.test(code('components/LiveTruthTable.tsx')));
  const actions = code('components/CanvasActions.tsx');
  check('the canvas\'s action group: Undo · Redo · Delete · Rotate · Clear through the store\'s own actions',
    ['undo()', 'redo()', 'deleteSelected()', 'rotateComponent(id)', 'clearWorkspace()', 'toggleStateKind(id)'].every((a) => actions.includes(a)) &&
      !/isCurrentQuestionLocked/.test(actions));
}

console.log(failures === 0 ? '\nworkbenchCheck: all checks passed' : `\nworkbenchCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
