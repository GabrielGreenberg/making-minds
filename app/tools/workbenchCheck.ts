// workbenchCheck — the editor workbench (task 2026-09-25-052; the design memo
// is docs/buildout/designs/editor-workbench.md). Pins the frame's pure parts
// (src/workbench.ts) against the real homeworks, and the frame's wiring in
// the source:
//
//   [columns]        widths clamp to their ranges (a stored pref too), both
//                    panels open unless a pref says exactly false, the old
//                    data panel's width carries over.
//   [question split] (task 078) the problem's share of the question panel:
//                    the range and default (about the old look), the clamp
//                    (junk → the default, rounded), both floors at a real
//                    height (the fraction range alone on a panel too short
//                    for both), a drag; the pref read from a fresh, old or
//                    bad bag; every layout field stored under its own key.
//   [question list]  the document's sections and numbering, a row per
//                    problem in each (a multi-part problem one row, marked
//                    over its parts; task 048), empty sections left out, the
//                    student's own marks only (done / started — never a
//                    grade), the list tags, the heading, the short name, the
//                    notes links; problemPages for Prev / Next.
//   [top bar labels] the save state's every branch, the submitted time.
//   [one frame]      every question kind and the sandbox render inside
//                    EditorShell; the sandbox has no question panel; the
//                    retired MenuBar is gone; the question text left the data
//                    panel; nothing in the frame reads the answer key; the
//                    Worksheet replaced the two answer panels and is one
//                    connector over the store-free WorksheetSheet (whose
//                    render navResetCheck [worksheet] pins), ProblemContext
//                    is retired; ONE panel divider (PanelDivider.tsx) for
//                    both columns and the question panel's row, the split
//                    threaded from EditorShell, the problem's pane a fixed
//                    share (never its content's height) with the done mark
//                    outside its scroll (task 078).
//   [output panel]   (task 053) a circuit's truth table (engine
//                    truthTableCC) against a reference circuit, EARNED (task
//                    075: ccTable.ts's cells — blank until run, a dash where
//                    the circuit drives nothing); ONE control
//                    row — the retired toolbar is gone, no panel builds a
//                    Run/Step of its own for CC, FSM, TM or turbot, the row
//                    renders the store's one descriptor; the canvas's action
//                    group calls the store's (locked) actions.
//   [palette]        (task 054) the parts each canvas offers, dimmed (never
//                    hidden) when a question excludes them, boxes likewise;
//                    the box rows, their meta line and pins (unresolved pins
//                    skipped); the position clamp and prefs; the way it
//                    runs (the student's choice, unless only the other way
//                    fits the canvas); placement
//                    centred; the retired parts column and its HTML drag gone,
//                    the canvas's one placement path, the Shift rule, the
//                    pop-out closing on empty canvas and Esc.
//   [canvas]         (task 055) the one zoom range and a step about a point;
//                    the circuit's bounds (an INPUT's tab included); the
//                    area the palette leaves free; Fit (centred, 80–140%, a
//                    wide circuit left-aligned, an empty canvas at 100%);
//                    the hint line's states and the empty-canvas message;
//                    the canvas's wiring: the zoom group with Fit, no
//                    slider, the dot grid, the selected wire's halo, Fit on
//                    every canvas swap through the store's counter.
//   [shortcuts]      (task 058) the key → command table: case-free (Shift,
//                    Caps Lock), Ctrl+Y redo (not ⌘Y), non-Latin layouts by
//                    physical key; no shortcut while a text field, select or
//                    contentEditable has focus; the canvas dispatches the
//                    table's commands to the store's (locked) undo/redo.
//
// Run from app/: npx tsx tools/workbenchCheck.ts   (part of `npm run check`).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssignmentData, CircuitData, QuestionCircuit } from '../src/types';
import { truthTableCC, TRUTH_TABLE_MAX_INPUTS } from '../src/engine';
import type { ConfirmedBoxDef, CircuitComponent } from '../src/types';
import { getPortsForType } from '../src/types';
import { getComponentSize } from '../src/componentGeometry';
import {
  PALETTE_DEFAULT,
  boxMetaLine,
  boxRows,
  clampPalette,
  clearOf,
  clientToCanvas,
  paletteHasBoxes,
  paletteLength,
  paletteOrientation,
  paletteParts,
  palettePlacementFromPrefs,
  partRefusal,
  pinnedRows,
  pinsFromPrefs,
  pinsPrefKey,
  placementOrigin,
  sameTool,
  togglePin,
  toolComponent,
  toolKey,
} from '../src/palette';
import { editorShortcut, isTextEntryTarget, type KeyPress } from '../src/shortcuts';
import {
  EMPTY_CANVAS_MESSAGE, FIT_MAX, FIT_MIN, ZOOM_MAX, ZOOM_MIN,
  canvasHint, circuitBounds, clampZoom, fitView, freeArea, zoomAbout, type HintState,
} from '../src/canvasView';
import { toolLabel } from '../src/palette';
import { signalColor, type CanvasColors } from '../src/canvasTheme';
import { ccOutputCell, ccRowKey, ccTableView } from '../src/ccTable';
import { documentSections, pageIndexOf, problemPages } from '../src/problemSet';
import {
  COLLAPSED_STRIP,
  EDITOR_PREF_KEYS,
  LEFT_PANEL,
  QUESTION_SPLIT,
  QUESTION_SPLIT_FLOOR,
  RIGHT_PANEL,
  assignmentShortName,
  clampPanelWidth,
  clampQuestionSplit,
  editorLayoutFromPrefs,
  problemMark,
  questionHeading,
  questionList,
  questionListTag,
  questionMark,
  questionSplitFromDrag,
  questionSplitFromStep,
  questionSplitRange,
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

console.log('\n[question split]');
{
  const { min, max, initial, step } = QUESTION_SPLIT;
  check('the range is sane and the default about the old look (≈ 55–60% of the panel)',
    0 < min && min < initial && initial < max && max < 1 && initial >= 0.55 && initial <= 0.6 && step > 0);
  // The list's floor, from workbench.css itself: the header's height, a
  // section label's padding plus its line (10.5px text, ~16px) — a sectioned
  // homework's list opens with one — and two rows' min-height.
  {
    const css = read('workbench.css');
    const px = (sel: string, prop: string) => {
      const body = new RegExp(`(?:^|[\\s}/])${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      return new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? '';
    };
    const head = parseFloat(px('.qp-list-head', 'height'));
    const labelPad = px('.qp-list-label', 'padding').split(/\s+/).map(parseFloat);
    const labelLine = Math.ceil(parseFloat(px('.qp-list-label', 'font-size')) * 1.5);
    const row = parseFloat(px('.qp .qp-row', 'min-height'));
    const floor = head + (labelPad[0] + labelPad[2] + labelLine) + 2 * row;
    check('the list\'s floor is its header, a section label and two rows (34 + 32 + 2 × 36px, as workbench.css draws them); the problem keeps a usable floor',
      QUESTION_SPLIT_FLOOR.list === 34 + 32 + 2 * 36 && Math.abs(QUESTION_SPLIT_FLOOR.list - floor) <= 1 &&
        QUESTION_SPLIT_FLOOR.statement >= 150,
      `css: ${head} + ${labelPad[0]}+${labelPad[2]}+${labelLine} + 2 × ${row} = ${floor}`);
  }
  check('a split clamps into the range, rounded to 0.001',
    clampQuestionSplit(0.5) === 0.5 && clampQuestionSplit(0.5678901) === 0.568 &&
      clampQuestionSplit(0.05) === min && clampQuestionSplit(5) === max);
  check('a missing or junk split falls back to the default',
    [undefined, null, 'tall', NaN, Infinity, -Infinity, {}].every((v) => clampQuestionSplit(v) === initial));
  // At 600px the problem's floor binds (200 / 600 > min); at 400px both do.
  const ends = (h: number) => [clampQuestionSplit(0.01, h), clampQuestionSplit(0.99, h)];
  const [top6, bottom6] = ends(600);
  const [top4, bottom4] = ends(400);
  check('at a real height, the problem keeps its floor (dragged all the way up)',
    [[top6, 600], [top4, 400]].every(([s, h]) => s * h >= QUESTION_SPLIT_FLOOR.statement - 0.5) && top6 > min && top4 > min,
    `${top6} × 600, ${top4} × 400`);
  check('…and the list keeps its header, a section label and two rows (dragged all the way down)',
    [[bottom6, 600], [bottom4, 400]].every(([s, h]) => (1 - s) * h >= QUESTION_SPLIT_FLOOR.list - 0.5) && bottom4 < max,
    `${bottom6} × 600, ${bottom4} × 400`);
  check('…a split between the floors is left alone', clampQuestionSplit(0.5, 600) === 0.5 && clampQuestionSplit(initial, 600) === initial);
  check('a panel too short for both floors: the fraction range alone (the CSS floors decide)',
    [0.05, 0.3, 0.5, 0.95, 'x'].every((v) => clampQuestionSplit(v, 250) === clampQuestionSplit(v)) &&
      [0.05, 0.95].every((v) => clampQuestionSplit(v, 0) === clampQuestionSplit(v)));
  check('a drag moves the split by its share of the height, clamped',
    questionSplitFromDrag(0.5, 60, 600) === 0.6 && questionSplitFromDrag(0.5, -30, 600) === 0.45 &&
      questionSplitFromDrag(0.5, 5000, 600) === clampQuestionSplit(1, 600) &&
      questionSplitFromDrag(0.5, -5000, 600) === clampQuestionSplit(0, 600));
  check('…a panel not laid out (height 0) leaves the start, clamped',
    questionSplitFromDrag(0.5, 60, 0) === 0.5 && questionSplitFromDrag(0.95, 60, 0) === max);
  // A split stored on a taller window: at 600px, 0.25 shows at the problem's
  // floor (200 / 600), 0.8 at the list's; drags and keys start from THAT.
  const shownTop = clampQuestionSplit(0.25, 600);
  const shownBottom = clampQuestionSplit(0.8, 600);
  check('a stored split outside the height\'s range shows at its end (the split on screen)',
    shownTop > 0.25 && Math.abs(shownTop * 600 - QUESTION_SPLIT_FLOOR.statement) < 1 &&
      shownBottom < 0.8 && Math.abs((1 - shownBottom) * 600 - QUESTION_SPLIT_FLOOR.list) < 1,
    `${shownTop}, ${shownBottom}`);
  check('…a drag starts from the split on screen: the divider follows the pointer from its first pixel, no dead zone',
    [1, 20, 40].every((dy) => questionSplitFromDrag(0.25, dy, 600) > shownTop) &&
      Math.abs(questionSplitFromDrag(0.25, 60, 600) - (shownTop + 0.1)) < 0.002 &&
      [-1, -20].every((dy) => questionSplitFromDrag(0.8, dy, 600) < shownBottom) &&
      questionSplitFromDrag(0.25, 0, 600) === shownTop,
    `${questionSplitFromDrag(0.25, 1, 600)}, ${questionSplitFromDrag(0.25, 60, 600)}`);
  check('an arrow key steps the split on screen by the step, clamped — so every press shows',
    questionSplitFromStep(0.5, 1, 600) === 0.54 && questionSplitFromStep(0.5, -1, 600) === 0.46 &&
      questionSplitFromStep(0.25, 1, 600) === clampQuestionSplit(shownTop + step, 600) &&
      questionSplitFromStep(0.25, 1, 600) > shownTop && questionSplitFromStep(0.8, -1, 600) < shownBottom &&
      questionSplitFromStep(0.25, -1, 600) === shownTop && questionSplitFromStep(0.8, 1, 600) === shownBottom &&
      questionSplitFromStep(0.5, 1, 0) === 0.54);
  const r600 = questionSplitRange(600);
  check('the divider\'s range is the height\'s (both floors), the fraction range alone when unmeasured or too short',
    r600.min === QUESTION_SPLIT_FLOOR.statement / 600 && r600.max === 1 - QUESTION_SPLIT_FLOOR.list / 600 &&
      [undefined, 0, 250].every((h) => { const r = questionSplitRange(h); return r.min === min && r.max === max; }) &&
      questionSplitRange(2000).min === min && questionSplitRange(2000).max === max);
  check('the pref: none, an old bag (widths only) or junk → the default; a stored split clamped',
    editorLayoutFromPrefs({}).qpSplit === initial &&
      editorLayoutFromPrefs({ 'editor.leftW': 300 }).qpSplit === initial &&
      editorLayoutFromPrefs({ 'editor.qpSplit': 'tall' }).qpSplit === initial &&
      editorLayoutFromPrefs({ 'editor.qpSplit': 0.05 }).qpSplit === min &&
      editorLayoutFromPrefs({ 'editor.qpSplit': 5 }).qpSplit === max &&
      editorLayoutFromPrefs({ 'editor.qpSplit': 0.5 }).qpSplit === 0.5);
  const keys = Object.values(EDITOR_PREF_KEYS);
  check('the split\'s key is editor.qpSplit; every key distinct and editor.-prefixed',
    EDITOR_PREF_KEYS.qpSplit === 'editor.qpSplit' && new Set(keys).size === keys.length && keys.every((k) => k.startsWith('editor.')));
  // useEditorLayout stores each changed field under EDITOR_PREF_KEYS[field].
  check('every layout field is stored under its own key (and no key names a field that is not)',
    Object.keys(EDITOR_PREF_KEYS).sort().join() === Object.keys(editorLayoutFromPrefs({})).sort().join());
}

console.log('\n[question list]');
{
  const hw1 = hw(1);
  const doc = documentSections(hw1);
  const at = (id: number) => hw1.questions.findIndex((q) => q.id === id);
  const marks = new Map<number, QuestionCircuit>([
    [hw1.questions[0].id, circuit({ done: true })],
    [hw1.questions[1].id, circuit({ components: [{ id: 'c', type: 'AND', x: 0, y: 0, ports: [], rotation: 0, label: '' } as unknown as QuestionCircuit['components'][number]] })],
    // Problem 6 (task 048: parts 6, 18, 19): a blank part a, an answered b.
    [6, circuit({ responseText: '   ' })],
    [18, circuit({ responseText: 'An answer.' })],
    // Problem 7: blank text.
    [7, circuit({ responseText: '   ' })],
    // Problem 9 (parts 9, 20): both marked done. Problem 10 (10, 21, 22): two of three.
    [9, circuit({ done: true })],
    [20, circuit({ done: true })],
    [10, circuit({ done: true })],
    [21, circuit({ done: true })],
  ]);
  const list = questionList(hw1, (id) => marks.get(id), 3);
  check('HW1: the document\'s four sections, in order', list.map((s) => s.heading).join(' | ') === doc.map((s) => s.heading).join(' | ') && list.length === 4);
  const rows = list.flatMap((s) => s.rows);
  const row = (n: string) => rows.find((r) => r.number === n)!;
  check('HW1: one row per PROBLEM (17 — 6, 9, 10 and 13 have parts), each index once',
    rows.length === 17 && new Set(rows.map((r) => r.index)).size === 17);
  check('HW1: the document\'s numbering, a multi-part problem numbered once (1…17)',
    rows.map((r) => r.number).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17');
  check('a multi-part problem\'s row opens its first part and names the problem ("Problem 6")',
    row('6').index === at(6) && row('6').label === 'Problem 6' && row('13').index === at(13) && row('13').label === 'Problem 13');
  check('exactly the open question is current', rows.filter((r) => r.current).map((r) => r.index).join() === '3');
  check('…and a later part\'s index makes its problem\'s row current',
    questionList(hw1, () => undefined, at(19)).flatMap((s) => s.rows).filter((r) => r.current).map((r) => r.number).join() === '6');
  check('marks are the student\'s own: done, started (a part), none (blank text)',
    rows[0].mark === 'done' && rows[1].mark === 'started' && row('7').mark === null && rows[2].mark === null);
  check('a multi-part problem is started when any part is, done only when every part is',
    row('6').mark === 'started' && row('9').mark === 'done' && row('10').mark === 'started' && row('13').mark === null);
  check('problemMark over parts: all done → done; any work → started; none → null',
    problemMark(['done', 'done']) === 'done' && problemMark(['done', null]) === 'started' &&
      problemMark([null, 'started']) === 'started' && problemMark([null, null]) === null && problemMark(['done']) === 'done');
  check('a titled row shows its title; an untitled one its label',
    rows[0].title === 'NAND' && row('7').title === null && row('7').label === 'Problem 7');
  check('HW1 tags: the circuits CC (accent), the prose "Written"; parts of mixed kinds "Written", one kind shared',
    rows[0].tag.text === 'CC' && rows[0].tag.machine && row('7').tag.text === 'Written' && !row('7').tag.machine &&
      row('6').tag.text === 'Written' && row('13').tag.text === 'Number');
  check('HW1 P12, an invented numeral (task 080), is tagged "Fill-in" — its boxes take symbols, not digits',
    row('12').tag.text === 'Fill-in' && !row('12').tag.machine);
  // Prev / Next and "k of M" walk problemPages: a multi-part problem is ONE page.
  const pages = problemPages(hw1);
  check('problemPages: HW1\'s 17 pages, the rows\' indices, in document order',
    pages.length === 17 && pages.join() === rows.map((r) => r.index).join());
  check('every part\'s index opens its problem\'s page (Prev / Next and the position read it)',
    [6, 18, 19].every((id) => pageIndexOf(hw1, at(id)) === at(6)) && pageIndexOf(hw1, at(23)) === at(13) &&
      pages.indexOf(pageIndexOf(hw1, at(18))) === 5 && pages[6] === at(7));
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
  check('a fill-in table (task 079) is tagged "Table", digits-only or not',
    questionListTag({ buildMode: 'open', fill_in: { table: { columns: ['x', 'y', 'j(x, y)'], argColumns: 2, rows: 9 }, numericOnly: true } }).text === 'Table' &&
      questionListTag({ buildMode: 'open', fill_in: { table: { columns: ['Argument', 'Value'], argColumns: 1, rows: 2 } } }).text === 'Table');
  check('a table\'s row-major cells start a question like blanks do',
    questionMark(circuit({ fillAnswers: ['', '', '#', ''] })) === 'started' && questionMark(circuit({ fillAnswers: ['', '', '', ''] })) === null);
  check('machine tags name the mode (turbot with its brain, perception)',
    questionListTag({ buildMode: 'turbot', innerMode: 'FSM' }).text === 'turbot - FSM' &&
      questionListTag({ buildMode: 'SC', perception: { rule: { kind: 'change' }, width: 8 } } as never).text === 'SC - perception');

  check('the heading: "Problem 1 · NAND", or just the label',
    questionHeading(hw1.questions[0]) === 'Problem 1 · NAND' && questionHeading(hw1.questions[5]) === 'Problem 6a' &&
      questionHeading({ label: 'Problem 6' }) === 'Problem 6');
  check('the list header\'s short name: "HW1" from the title; none without a code',
    assignmentShortName(hw1.title) === 'HW1' && assignmentShortName('HW12a. Later') === 'HW12a' && assignmentShortName('Practice set') === null);
  check('section notes are named by what is behind them',
    sectionNotesLabel(doc[0]) === 'Hint for this section' &&
      sectionNotesLabel(doc[2]) === 'Challenge problem (optional)' &&
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
    left.startsWith('{inAssignment &&') && /<QuestionPanel\s/.test(left) && left.includes('<QuestionPanelStrip ') &&
      (shell.match(/<QuestionPanel(Strip)?\b/g) ?? []).length === 2);
  const table = code('components/DataTable.tsx');
  check('the data panel no longer renders the question (it is in the question panel)',
    !/ProblemBody|ProblemContext|QuestionStatement/.test(table));
  check('…and no longer sizes itself (the frame\'s column does)', !/panelWidth|panel-resize-handle/.test(table));
  // F1 (law 1): the goal table comes from the statement's own profile —
  // students never receive test_cases in remote mode.
  // The fill-in panel draws a table from its headers and row count (task
  // 079), never from the key, so a student's key-less copy renders the same.
  // So does the Worksheet (task 048) — and it never asks a key-reading
  // question (isReviewTable) of a student's key-less copy.
  for (const rel of ['workbench.ts', 'components/QuestionPanel.tsx', 'components/EditorShell.tsx', 'components/PanelDivider.tsx', 'components/EditorTopBar.tsx', 'components/Worksheet.tsx']) {
    check(`${rel} reads no answer key`, !/test_cases|perception_cases|fill_in_answers|isReviewTable/.test(read(rel)));
  }
  check('the old answer panels are gone (the Worksheet replaces them)',
    !existsSync(join(SRC, 'components/OpenResponsePanel.tsx')) && !existsSync(join(SRC, 'components/FillInPanel.tsx')) &&
      /<Worksheet \/>/.test(app));
  // The rendered order (stem, prompt → field per part, closing) is pinned by
  // a real render of WorksheetSheet in navResetCheck [worksheet]; here, that
  // the app shows that same sheet, fed straight from the store.
  const ws = code('components/Worksheet.tsx');
  const sheetAt = ws.indexOf('export function WorksheetSheet');
  const sheetOnward = sheetAt < 0 ? '' : ws.slice(sheetAt);
  check('the Worksheet is one connector: the store\'s page, live text, lock, save state and setters and the one paste guard go straight into WorksheetSheet',
    /<WorksheetSheet\b/.test(ws) &&
      ['assignment', 'index', 'liveText', 'lockNotice', 'pasteNotice', 'saveFailing', 'pasteGuardRef'].every((p) => ws.includes(`${p}={${p}}`)) &&
      ws.includes('onText={setOpenResponse}') && ws.includes('onFill={setFillAnswer}') &&
      (ws.match(/usePasteGuard\(/g) ?? []).length === 1);
  check('…and the sheet reads nothing from the store (it draws from its props alone, as rendered)',
    sheetAt > ws.indexOf('export function Worksheet()') && ws.indexOf('export function Worksheet()') >= 0 &&
      !/useStore|getState/.test(sheetOnward));
  check('ProblemContext is retired (the question panel renders the whole problem through ProblemBody)',
    !/ProblemContext/.test(read('components/ProblemSetDocument.tsx')) && /<ProblemBody problem=\{problem\}/.test(code('components/QuestionPanel.tsx')));
  const panel = code('components/QuestionPanel.tsx');
  check('the done mark goes through the store\'s toggle (the lock stays the store\'s, law 3)',
    /toggleCurrentQuestionDone/.test(panel) && !/isCurrentQuestionLocked/.test(panel));
  check('the done mark is a checkbox-role button, not an <input> (the canvas\'s shortcuts stand down while an input has focus)',
    /role="checkbox"/.test(panel) && !/<input\b/.test(panel));
  // The route comes from routing's editorRoute (the attempt on show and,
  // task 067, whose it is), pinned in routingCheck [viewer route].
  check('navigation goes through navigate() with the viewed attempt (and its owner) carried along',
    /editorRoute\(useStore\.getState\(\), i\)/.test(panel) && /navigate\(route, \{ replace: true \}\)/.test(panel));
  // Task 078: one divider for both axes, the question panel's split.
  const divider = existsSync(join(SRC, 'components/PanelDivider.tsx')) ? code('components/PanelDivider.tsx') : '';
  check('ONE panel divider: PanelDivider is a separator with its orientation and value, dragged on either axis, stepped by the keys along it',
    ['role="separator"', 'aria-orientation', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'clientX', 'clientY',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'setPointerCapture'].every((t) => divider.includes(t)));
  check('…the frame and the question panel draw no divider of their own',
    [shell, panel].every((src) => !/onPointerMove|setPointerCapture|role="separator"/.test(src)));
  check('…the columns are two vertical ones, the problem / list split one horizontal one',
    (shell.match(/<PanelDivider\s+orientation="vertical"/g) ?? []).length === 2 &&
      (shell.match(/<PanelDivider\b/g) ?? []).length === 2 &&
      (panel.match(/<PanelDivider\s+orientation="horizontal"/g) ?? []).length === 1 &&
      (panel.match(/<PanelDivider\b/g) ?? []).length === 1);
  check('the split is the layout\'s: EditorShell hands it to the question panel and stores a change like a width',
    shell.includes('split={layout.qpSplit}') && shell.includes('update({ qpSplit'));
  const css = read('workbench.css');
  // A rule's body, its selector standing alone (after a rule, a comment or a line break).
  const rule = (sel: string) => new RegExp(`(?:^|[\\s}/])${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
  const current = rule('.qp-current');
  check('the problem\'s pane is a fixed share, never its content\'s height: no max-height; its basis the split, its floor the constant',
    current !== null && !/max-height|flex-shrink:\s*0/.test(current) &&
      /className="qp-current" style=\{\{ flex: `0 1 \$\{split \* 100\}%`, minHeight: QUESTION_SPLIT_FLOOR\.statement \}\}/.test(panel) &&
      /minHeight: QUESTION_SPLIT_FLOOR\.list/.test(panel));
  const bodyAt = panel.indexOf('<div className="qp-current-body"');
  const doneAt = panel.indexOf('<DoneMark', bodyAt);
  const between = bodyAt < 0 || doneAt < 0 ? '' : panel.slice(bodyAt, doneAt);
  const count = (re: RegExp) => (between.match(re) ?? []).length;
  check('the done mark sits outside the scroll: the body closes before it (so it never moves)',
    between !== '' && count(/<div\b/g) === count(/<\/div>/g) &&
      /overflow-y:\s*auto/.test(rule('.qp-current-body') ?? '') && /flex-shrink:\s*0/.test(rule('.qp-done') ?? ''));
  // Pinned to the pane's bottom, the foot grows upward: a lock note below the
  // checkbox would lift it (done vs open problems, and out from under the
  // pointer that just ticked it), so the note comes first.
  const doneMark = panel.slice(panel.indexOf('function DoneMark'), panel.indexOf('function QuestionList'));
  const noteAt = doneMark.indexOf('className="qp-done-note"');
  const boxAt = doneMark.indexOf('className="qp-done-label"');
  check('…and holds still when ticked: the lock note renders above the checkbox, never below it',
    noteAt > 0 && boxAt > 0 && noteAt < boxAt && doneMark.lastIndexOf('qp-done-note') < boxAt);
}

console.log('\n[output panel]');
{
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/reference', name), 'utf8')) as { correct: CircuitData };
  // HW1 P3: OUT1 = IN1 AND IN2, OUT2 = its NOT.
  const p3 = fixture('hw1-p3.json').correct;
  const t = truthTableCC(p3.components, p3.wires);
  check('the table\'s rows: every row computed (shown once earned), IN1 most significant, 00 first',
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

  // Task 075: the table is EARNED. What each output cell shows is ccTable.ts's
  // (pure), so the reveal rule itself is pinned here, not just its tokens.
  check('a cell: unwired blank; unrun blank and marked (never a 0), whatever the bit',
    ccOutputCell(false, true, 1).text === '' && ccOutputCell(false, true, 1).state === 'unwired' &&
      [0, 1, undefined].every((b) => { const c = ccOutputCell(true, false, b); return c.text === '' && c.state === 'unrun' && c.title === 'Not run yet'; }));
  check('…a run row its bit; run but undriven a dash, not 0',
    ccOutputCell(true, true, 0).text === '0' && ccOutputCell(true, true, 1).text === '1' && ccOutputCell(true, true, 1).bit === 1 &&
      ccOutputCell(true, true, undefined).text === '–' && ccOutputCell(true, true, undefined).state === 'unset');
  const texts = (v: ReturnType<typeof ccTableView>) =>
    v !== null && v !== 'too-many' ? v.rows.map((r) => r.cells.map((c) => c.text || '.').join('')).join(' ') : String(v);
  check('a table no one has run lists every row and shows no output at all',
    texts(ccTableView(p3.components, p3.wires, [])) === '.. .. .. ..');
  check('…a run row shows the grader\'s bits, every other row stays blank (HW1 P3, 01 and 11 run)',
    texts(ccTableView(p3.components, p3.wires, ['0,1', '1,1'])) === '.. 01 .. 10');
  {
    const v = ccTableView(p3.components, p3.wires, ['1,0']);
    check('…row keys are the store\'s spelling (ccRowKey), and only the run row is earned',
      ccRowKey([1, 0]) === '1,0' && v !== null && v !== 'too-many' &&
        v.rows.map((r) => `${r.key}${r.earned ? '*' : ''}`).join(' ') === '0,0 0,1 1,0* 1,1');
  }
  {
    // AND's second input unwired: the canvas leaves OUT1/OUT2 undriven (blank);
    // the grader would read 0. A run row shows the canvas's "no value".
    const open = { ...p3, wires: p3.wires.filter((w) => w.id !== 'hw1-p3-w2') };
    const g = truthTableCC(open.components, open.wires);
    check('…a run row the circuit leaves undriven shows "–", never the 0 the grader reads',
      g !== null && g !== 'too-many' && g.rows[2].outputBits.join('') === '00' &&
        texts(ccTableView(open.components, open.wires, ['1,0'])) === '.. .. –– ..');
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
  // Task 075: the CC table is EARNED — an output shows only for a row the
  // student has run. The store records the rows (ccRunRows, its machine-key
  // subscriber; navResetCheck [earned CC table]); the table only reads them.
  const live = code('components/LiveTruthTable.tsx');
  check('the CC table is the live one', /<LiveTruthTable \/>/.test(table) && /truthTableCC/.test(read('ccTable.ts')));
  check('…drawn from ccTableView over the store\'s earned rows — each output cell its text, no bit of its own',
    /useStore\(\(s\) => s\.ccRunRows\)/.test(live) && /ccTableView\(components, wires, ccRunRows\)/.test(live) &&
      /\{cell\.text\}/.test(live) && !/truthTableCC|evaluateCC|outputBits/.test(live) && /op-unrun/.test(live) && /op-unset/.test(live));
  check('…which it never writes (the reveal is the store\'s)',
    !/setState/.test(live) && !/ccRunRows\s*:/.test(live));
  check('…and the grader never reads them (the table is UI only)',
    ['engine/caseRun.ts', 'engine/grader.ts', 'engine/cc.ts'].every((rel) => !/ccRunRows/.test(read(rel))));
  const actions = code('components/CanvasActions.tsx');
  check('the canvas\'s action group: Undo · Redo · Delete · Rotate · Clear through the store\'s own actions',
    ['undo()', 'redo()', 'deleteSelected()', 'rotateComponent(id)', 'clearWorkspace()', 'toggleStateKind(id)'].every((a) => actions.includes(a)) &&
      !/isCurrentQuestionLocked/.test(actions));
}

console.log('\n[signal colour]');
{
  // Unset is not 0 (task 075): a signal nobody computed draws faint.
  const fake = { signal0: 'ink', signal1: 'red', faint: 'faint' } as CanvasColors;
  check('signalColor: 0 the ink, 1 red', signalColor(fake, 0) === 'ink' && signalColor(fake, 1) === 'red');
  check('signalColor: unset (undefined, null, a wire\'s -1) the faint stroke, never the 0 ink',
    [undefined, null, -1].every((v) => signalColor(fake, v) === 'faint'));
  check('the canvas no longer draws a blank wire as a 0', !/isBlankWire \? 0/.test(code('components/CircuitCanvas.tsx')));
}

console.log('\n[palette]');
{
  const types = (mode: string, mem: boolean) => paletteParts(mode, mem).map((p) => p.type).join(' ');
  check('a CC canvas offers Input · Output · AND · OR · NOT (no MEM: it holds no memory)',
    types('CC', false) === 'INPUT OUTPUT AND OR NOT');
  check('a canvas that may hold memory adds MEM', types('SC', true) === 'INPUT OUTPUT AND OR NOT MEM');
  check('FSM and TM offer STATE only', types('FSM', false) === 'STATE' && types('TM', false) === 'STATE');
  check('boxing (New box, the Boxes group) on circuit canvases only',
    paletteHasBoxes('CC') && paletteHasBoxes('SC') && !paletteHasBoxes('FSM') && !paletteHasBoxes('TM'));
  const or = paletteParts('CC', false).find((p) => p.type === 'OR')!;
  const input = paletteParts('CC', false).find((p) => p.type === 'INPUT')!;
  check('decision 3: an excluded part is dimmed with "OR is not used in this problem"',
    partRefusal(or, ['AND', 'NOT']) === 'OR is not used in this problem');
  check('…INPUT/OUTPUT are always allowed; no restriction dims nothing',
    partRefusal(input, ['AND']) === null && partRefusal(or, null) === null);

  const part = (type: CircuitComponent['type'], id: string): CircuitComponent =>
    ({ id, type, x: 0, y: 0, label: type, ports: getPortsForType(type), value: 0 });
  const box = (id: string, name: string, inner: CircuitComponent['type'][], extra: Partial<ConfirmedBoxDef> = {}): ConfirmedBoxDef => ({
    id, name, inputPortIds: ['a:out', 'b:out'], outputPortIds: ['c:in'],
    internalComponents: inner.map((t, i) => part(t, `${id}-${i}`)), internalWires: [], ...extra,
  });
  const lib = [
    box('b1', 'Box 1', ['AND'], { kind: 'CC', origin: 7 }),
    box('b2', 'OR box', ['OR']),
    box('b3', 'Delay', ['MEM'], { kind: 'SC' }),
    box('b4', 'Old FSM', ['STATE'], { kind: 'FSM' }),
  ];
  const problemOf = (origin: number | undefined) => (origin === 7 ? '1' : null);
  const onCC = boxRows(lib, ['CC'], ['AND', 'NOT'], ['b2'], problemOf);
  check('rows: the kinds this canvas may place, in library order (an SC box not on CC; a retired FSM box never)',
    onCC.map((r) => r.box.id).join() === 'b1,b2' && boxRows(lib, ['CC', 'SC'], null, [], problemOf).map((r) => r.box.id).join() === 'b1,b2,b3');
  check('F11: the meta line "2 in · 1 out · Problem 1" when the origin is known, no suffix when not',
    onCC[0].meta === '2 in · 1 out · Problem 1' && onCC[1].meta === '2 in · 1 out' && boxMetaLine(3, 2, null) === '3 in · 2 out');
  check('decision 3: a box using an excluded part is dimmed (not hidden), saying which',
    onCC[0].refusal === null && onCC[1].refusal === 'This box uses OR, which is not used in this problem');
  check('rows know whether they are pinned', !onCC[0].pinned && onCC[1].pinned);
  check('pinned tiles in pin order; a pin that resolves to nothing is skipped silently (F12)',
    pinnedRows(['gone', 'b2', 'b1', 'b2'], onCC).map((r) => r.box.id).join() === 'b2,b1');
  check('pinning appends once; unpinning removes',
    togglePin(['b1'], 'b2', true).join() === 'b1,b2' && togglePin(['b1', 'b2'], 'b1', true).join() === 'b2,b1' &&
      togglePin(['b1', 'b2'], 'b1', false).join() === 'b2');
  check('pins are kept per homework, per tab in the sandbox',
    pinsPrefKey({ assignmentId: 'hw1' }) === 'pinnedBoxes:hw1' && pinsPrefKey({ tabId: 't2' }) === 'pinnedBoxes:tab:t2' &&
      pinsFromPrefs({ 'pinnedBoxes:hw1': ['b1', 3, 'b2'] }, 'pinnedBoxes:hw1').join() === 'b1,b2' && pinsFromPrefs({}, 'x').length === 0);

  check('the palette starts at (14,14), vertical; a stored placement is read back, junk falls back',
    palettePlacementFromPrefs({}) === PALETTE_DEFAULT && PALETTE_DEFAULT.x === 14 && PALETTE_DEFAULT.y === 14 && !PALETTE_DEFAULT.horiz &&
      JSON.stringify(palettePlacementFromPrefs({ 'editor.palette': { x: 300, y: 40, horiz: true } })) === '{"x":300,"y":40,"horiz":true}' &&
      JSON.stringify(palettePlacementFromPrefs({ 'editor.palette': { x: 'left', horiz: 1 } })) === '{"x":14,"y":14,"horiz":false}');
  const canvas = { w: 800, h: 600 };
  const size = { w: 60, h: 400 };
  check('it stays 8px inside the canvas',
    JSON.stringify(clampPalette({ x: -50, y: -5 }, size, canvas)) === '{"x":8,"y":8}' &&
      JSON.stringify(clampPalette({ x: 900, y: 500 }, size, canvas)) === '{"x":732,"y":192}' &&
      JSON.stringify(clampPalette({ x: 100, y: 100 }, size, canvas)) === '{"x":100,"y":100}');
  {
    // 7 tiles, 3 hairlines: the CC palette with its Boxes tile.
    const len = paletteLength(7, 3);
    check('the palette\'s run: grip 16 + turn 24 + border 2 + hairlines + 58 per tile', len === 16 + 24 + 2 + 3 + 7 * 58);
    check('it runs the way the student chose when that fits',
      paletteOrientation(true, len, { w: 900, h: 700 }) === true && paletteOrientation(false, len, { w: 900, h: 700 }) === false);
    check('a flat palette that would clip in a narrow canvas stands up instead (never loses its turn button)',
      paletteOrientation(true, len, { w: 300, h: 700 }) === false);
    check('…and a standing one that would clip in a short canvas lies flat',
      paletteOrientation(false, len, { w: 900, h: 300 }) === true);
    check('neither fitting, or an unknown canvas, keeps the choice',
      paletteOrientation(true, len, { w: 200, h: 200 }) === true && paletteOrientation(false, len, { w: 0, h: 0 }) === false);
  }
  {
    // Task 057: the palette keeps clear of the canvas's action group (top right).
    const group = { x0: 100, y0: 12, x1: 390, y1: 70 };
    const pal = { w: 60, h: 372 };
    check('clear of the action group: no overlap leaves the palette where it is',
      JSON.stringify(clearOf({ x: 14, y: 14 }, pal, { x0: 300, y0: 12, x1: 640, y1: 70 }, { w: 660, h: 716 })) === '{"x":14,"y":14}');
    check('…an overlap drops it below the group (8px clear)',
      JSON.stringify(clearOf({ x: 120, y: 14 }, pal, group, { w: 400, h: 716 })) === '{"x":120,"y":78}');
    check('…a canvas too short for that keeps the clamped spot',
      JSON.stringify(clearOf({ x: 120, y: 14 }, pal, group, { w: 400, h: 420 })) === '{"x":120,"y":14}');
    check('…and the palette measures the real group (.cv-actions) and applies it after the clamp',
      /querySelector<HTMLElement>\('\.cv-actions'\)/.test(code('components/Palette.tsx')) &&
        /clearOf\(clampPalette\(placement, size, canvas\), size, actions, canvas\)/.test(code('components/Palette.tsx')));
  }
  check('a canvas smaller than the palette pins it to the top-left margin',
    JSON.stringify(clampPalette({ x: 50, y: 50 }, size, { w: 40, h: 300 })) === '{"x":8,"y":8}');

  check('the armed tool is one tagged value: a part, NEW_BOX, or a box',
    toolKey('AND') === 'AND' && toolKey('NEW_BOX') === 'NEW_BOX' && toolKey({ box: 'b1' }) === 'box:b1' &&
      sameTool({ box: 'b1' }, { box: 'b1' }) && !sameTool({ box: 'b1' }, { box: 'b2' }) && !sameTool('AND', null) && sameTool(null, null));
  const and = toolComponent('AND', lib)!;
  const at = placementOrigin(and, 300, 200);
  const { w, h } = getComponentSize(and);
  check('a part lands centred on the pointer', at.x === 300 - w / 2 && at.y === 200 - h / 2);
  const b1 = toolComponent({ box: 'b1' }, lib);
  check('a box tool draws the box as it lands: BOXED, its name, its port counts',
    b1?.type === 'BOXED' && b1.label === 'Box 1' && b1.boxedCircuitId === 'b1' &&
      b1.ports.filter((p) => p.side === 'left').length === 2 && b1.ports.filter((p) => p.side === 'right').length === 1);
  check('the drag ghost is unset like the part that lands — no 0 on an INPUT, OUTPUT, gate or box (task 075)',
    (['INPUT', 'OUTPUT', 'AND'] as const).every((t) => toolComponent(t, lib)!.value === undefined) && b1?.value === undefined);
  check('NEW_BOX and a vanished box place nothing', toolComponent('NEW_BOX', lib) === null && toolComponent({ box: 'gone' }, lib) === null);
  check('screen → canvas through the pan and zoom',
    JSON.stringify(clientToCanvas({ x: 250, y: 150 }, { left: 50, top: 50 }, { panX: 100, panY: 0, zoom: 2 })) === '{"x":50,"y":50}');

  const app = code('App.tsx');
  const canvasSrc = code('components/CircuitCanvas.tsx');
  const paletteSrc = code('components/Palette.tsx');
  check('the parts column is gone (no ComponentLibrary), the palette floats in the canvas',
    !existsSync(join(SRC, 'components/ComponentLibrary.tsx')) && !/ComponentLibrary/.test(app) &&
      /<Palette canvasW=\{containerSize\.width\} canvasH=\{containerSize\.height\} \/>/.test(canvasSrc));
  check('no HTML drag-and-drop left: the palette\'s pointer drag and the canvas\'s ghost replace it',
    !/onDrop=|dataTransfer|draggable/.test(canvasSrc + paletteSrc) && /<PaletteGhost /.test(canvasSrc));
  check('ONE placement path: the canvas click and the palette drop both call the store\'s placeTool',
    /state\.placeTool\(state\.selectedTool, canvasPos\.x, canvasPos\.y\)/.test(canvasSrc) && /s\.placeTool\(tool, at\.x, at\.y\)/.test(paletteSrc) &&
      !/addComponent\(|placeBoxInstance\(/.test(canvasSrc + paletteSrc));
  check('Shift keeps the tool armed; a plain click places one and disarms',
    /if \(!e\.shiftKey\) state\.setSelectedTool\(null\);/.test(canvasSrc));
  check('a click on empty canvas and Esc close the Boxes pop-out',
    (canvasSrc.match(/setBoxesPopoutOpen\(false\)/g) ?? []).length >= 2);
  check('the palette holds no lock of its own (law 3) and its rename wears the paste guard (law 8)',
    !/isCurrentQuestionLocked|selectQuestionLocked/.test(paletteSrc) && /ref=\{pasteGuardRef\}/.test(paletteSrc));
}

console.log('\n[canvas]');
{
  check('one zoom range, 25%–300%, and everything clamps to it',
    ZOOM_MIN === 0.25 && ZOOM_MAX === 3 && clampZoom(0.1) === 0.25 && clampZoom(9) === 3 && clampZoom(1.5) === 1.5 && clampZoom(NaN) === 1);
  {
    const v = zoomAbout({ zoom: 1, panX: 0, panY: 0 }, 2, 100, 100);
    check('a zoom step keeps the canvas point under the anchor where it is',
      v.zoom === 2 && v.panX === -100 && v.panY === -100 && zoomAbout({ zoom: 3, panX: 0, panY: 0 }, 2, 0, 0).zoom === 3);
  }
  const part = (type: CircuitComponent['type'], x: number, y: number): CircuitComponent =>
    ({ id: `${type}${x}`, type, x, y, label: type, ports: getPortsForType(type), value: 0 });
  {
    const b = circuitBounds([part('INPUT', 100, 100), part('AND', 300, 100)]);
    check('the circuit\'s bounds: every footprint (an INPUT\'s toggle tab too), padded for labels',
      b !== null && b.x0 < 100 - 14 && b.x1 > 300 + getComponentSize(part('AND', 0, 0)).w && b.y0 < 100);
    check('an empty canvas has no bounds', circuitBounds([]) === null);
  }
  const canvas = { w: 1000, h: 700 };
  {
    const standing = freeArea(canvas, { x: 14, y: 14, w: 60, h: 400, horiz: false });
    check('a standing palette at the left: the area to its right', standing.x0 === 14 + 60 + 16 && standing.x1 === 1000 - 30);
    const onRight = freeArea(canvas, { x: 900, y: 14, w: 60, h: 400, horiz: false });
    check('…at the right: the area to its left', onRight.x0 === 16 && onRight.x1 === 900 - 16);
    const flat = freeArea(canvas, { x: 14, y: 14, w: 450, h: 56, horiz: true });
    check('a flat palette at the top: the area below it', flat.y0 === 14 + 56 + 16 && flat.y1 === 700 - 50);
    check('no palette: the canvas less its corners', JSON.stringify(freeArea(canvas, null)) === '{"x0":16,"y0":48,"x1":970,"y1":650}');
  }
  {
    const area = { x0: 100, y0: 50, x1: 900, y1: 650 };
    const small = fitView({ x0: 0, y0: 0, x1: 200, y1: 100 }, area);
    check('Fit centres a small circuit, zoomed no further than 140%',
      small.zoom === FIT_MAX && small.panX === Math.round(100 + (800 - 200 * FIT_MAX) / 2) && small.panY === Math.round(50 + (600 - 100 * FIT_MAX) / 2));
    const mid = fitView({ x0: 0, y0: 0, x1: 800, y1: 300 }, area);
    check('…a circuit that fits at 100% fills the width', mid.zoom === 1 && mid.panX === 100);
    const wide = fitView({ x0: 40, y0: 0, x1: 3040, y1: 200 }, area);
    check('…never below 80%: a wider circuit left-aligns in the free area (and the student pans)',
      FIT_MIN === 0.8 && wide.zoom === 0.8 && wide.panX === Math.round(100 - 40 * 0.8));
    const empty = fitView(null, area);
    check('…an empty canvas: 100%, its origin at the free area\'s corner', empty.zoom === 1 && empty.panX === 100 && empty.panY === 50);
  }
  {
    const base: HintState = { tool: null, selectedParts: 0, selectedWires: 0, parts: 3, wires: 2, stateMachine: false, locked: false };
    const hint = (over: Partial<HintState>) => canvasHint({ ...base, ...over });
    check('hint: a tool armed', hint({ tool: 'AND' }) === 'Click the canvas to place AND. Shift-click to place several. Esc cancels.');
    check('hint: a part selected', hint({ selectedParts: 1 }) === 'Drag to move. Delete removes it.');
    check('hint: a wire selected', hint({ selectedWires: 1 }) === 'Delete removes this wire.');
    check('hint: parts but no wires', hint({ wires: 0 }) === 'Drag from one dot to another to connect parts.');
    check('hint: otherwise', hint({}) === 'Click an input to switch it between 0 and 1.');
    check('hint: none on an empty canvas', hint({ parts: 0, wires: 0 }) === null);
    check('hint: the New box tool, a state machine, a locked question say what applies there',
      hint({ tool: 'NEW_BOX' })!.startsWith('Drag a rectangle') && hint({ stateMachine: true, wires: 0 })!.includes('state') &&
        hint({ locked: true, selectedParts: 1 })!.startsWith('This question is locked'));
    check('the empty canvas\'s message, as the memo words it',
      EMPTY_CANVAS_MESSAGE === 'Drag parts from the toolbar onto the canvas, or click a part and then click here.');
    check('the hint names a tool as its tile does', toolLabel('INPUT', []) === 'Input' && toolLabel('AND', []) === 'AND');
  }
  const canvasSrc = code('components/CircuitCanvas.tsx');
  const store = code('store.ts');
  check('the zoom group: − · % · + · Fit, and no slider',
    /className="cv-zoom"/.test(canvasSrc) && /onClick=\{fitCanvas\}/.test(canvasSrc) && !/zoom-slider|type="range"/.test(canvasSrc));
  check('the dot grid follows pan and zoom (the container\'s background, cell = GRID_SIZE × zoom)',
    /radial-gradient\(circle, var\(--mm-canvas-dot\)/.test(canvasSrc) && /const cell = GRID_SIZE \* zoom/.test(canvasSrc) && !/grid-pattern/.test(canvasSrc));
  check('a wire is 2px in its signal\'s colour; a selected one gets the lavender halo under it',
    /stroke=\{C\.halo\}\s+strokeWidth=\{8\}/.test(canvasSrc) && /stroke=\{color\}\s+strokeWidth=\{2\}/.test(canvasSrc));
  check('Fit runs on every canvas swap: the store\'s counter, bumped by resetAllSimState, answered by the canvas',
    /canvasSwapSeq: s\.canvasSwapSeq \+ 1/.test(store) && /\[canvasSwapSeq, fitCanvas\]/.test(canvasSrc));
  check('setZoom clamps to the one range', /setZoom: \(z\) => set\(\{ zoom: clampZoom\(z\) \}\)/.test(store));
}

console.log('\n[shortcuts]');
{
  const k = (key: string, mods: Partial<KeyPress> = {}): KeyPress =>
    ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
  const table: [string, KeyPress, string | null][] = [
    ['⌘Z', k('z', { metaKey: true }), 'undo'],
    ['Ctrl+Z', k('z', { ctrlKey: true }), 'undo'],
    ['⌘⇧Z reported lower-case (Chrome, macOS)', k('z', { metaKey: true, shiftKey: true }), 'redo'],
    ['Ctrl+Shift+Z reported "Z" (Windows, Linux)', k('Z', { ctrlKey: true, shiftKey: true }), 'redo'],
    ['⌘⇧Z reported "Z" (macOS, some browsers)', k('Z', { metaKey: true, shiftKey: true }), 'redo'],
    ['Ctrl+Z under Caps Lock ("Z", no Shift)', k('Z', { ctrlKey: true }), 'undo'],
    ['Ctrl+Y (Windows redo)', k('y', { ctrlKey: true }), 'redo'],
    ['Ctrl+Y under Caps Lock', k('Y', { ctrlKey: true }), 'redo'],
    ['⌘Y is the browser\'s History, not redo', k('y', { metaKey: true }), null],
    ['⌘C / Ctrl+C under Caps Lock', k('C', { ctrlKey: true }), 'copy'],
    ['⌘V', k('v', { metaKey: true }), 'paste'],
    ['Ctrl+A under Caps Lock', k('A', { ctrlKey: true }), 'selectAll'],
    ['Ctrl+Shift+C stays the browser\'s', k('C', { ctrlKey: true, shiftKey: true }), null],
    ['a Cyrillic layout: Ctrl+"я" on the Z key', k('я', { ctrlKey: true, code: 'KeyZ' }), 'undo'],
    ['…and with Shift', k('Я', { ctrlKey: true, shiftKey: true, code: 'KeyZ' }), 'redo'],
    ['AZERTY: the Z key reports "z" (physical KeyW) — the letter wins', k('z', { ctrlKey: true, code: 'KeyW' }), 'undo'],
    ['AltGr (Ctrl+Alt) is typing, not a shortcut', k('z', { ctrlKey: true, altKey: true }), null],
    ['a plain "z" is typing', k('z'), null],
    ['Delete', k('Delete'), 'delete'],
    ['Backspace', k('Backspace'), 'delete'],
    ['Escape', k('Escape'), 'escape'],
  ];
  for (const [name, press, want] of table) check(`${name} → ${want ?? 'nothing'}`, editorShortcut(press) === want, `got ${editorShortcut(press)}`);
  check('no shortcut while a text field, textarea, select or contentEditable has focus',
    isTextEntryTarget({ tagName: 'INPUT' }) && isTextEntryTarget({ tagName: 'textarea' }) && isTextEntryTarget({ tagName: 'SELECT' }) &&
      isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }) && !isTextEntryTarget({ tagName: 'BUTTON' }) &&
      !isTextEntryTarget({ tagName: 'BODY', isContentEditable: false }) && !isTextEntryTarget(null));
  const canvasSrc = code('components/CircuitCanvas.tsx');
  check('the canvas asks the table and dispatches — undo/redo through the store\'s own (locked) actions',
    /const command = editorShortcut\(e\)/.test(canvasSrc) && /isTextEntryTarget\(document\.activeElement/.test(canvasSrc) &&
      /case 'undo':[\s\S]*?state\.undo\(\)/.test(canvasSrc) && /case 'redo':[\s\S]*?state\.redo\(\)/.test(canvasSrc) &&
      !/e\.key === 'z'|e\.key === 'c'|e\.key === 'v'|e\.key === 'a'/.test(canvasSrc));
}

console.log(failures === 0 ? '\nworkbenchCheck: all checks passed' : `\nworkbenchCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
