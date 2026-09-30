// Headless end-to-end check of the autograding pipeline for CC, SC, FSM, TM,
// turbot, perception, open, and fill-in-the-blank questions, plus the pure
// display policies both sides read a result through.
//
//   npx tsx tools/pipelineCheck.ts
//
// Builds the sample assignment and grades a known-correct and a known-incorrect
// submission per mode, asserting the correct one scores 100% and the incorrect
// one scores below 100%. This validates the grader + the per-mode codec
// adapters against real circuits, independent of the browser/UI. The open
// question is asserted to come back `pending` (not autogradeable) with the
// student's response attached for manual review.
//
//   [fill-in authoring]  (task 005) the question creator's fill-in blanks:
//                        drafts → saved fields round-trip HW1 P11 exactly,
//                        the canonical per-blank digits-only flag, reorder
//                        moves label + answer + flag together, which saved
//                        blanks an edit strips of students' answers (they
//                        are stored by position), the defects
//                        that block a save, the student copy stripped
//                        (server/src/sanitize.ts — no answer rides inside
//                        `fill_in`), submit → graded, the questionTask
//                        classifier, and a grep pin: one reader and one
//                        writer of `numericOnly`.
//
//   [fill-in tables]     (task 079) an argument–value table graded as a
//                        function: HW1 P14 / P9b's shape and key, order-free
//                        (rows in any order pass), a wrong value or a
//                        repeated argument fails that key row, empty rows and
//                        cells past the table ignored, normalisation, stale
//                        positional answers harmless, labels = arguments
//                        only, submit from the stripped copy → graded, the
//                        student copy's `fill_in.table` layout-only; the
//                        creator's table draft (round-trips P14 / P9b, each
//                        defect named, which edits misplace answers); and a
//                        grep pin: `.labels` is read only in engine/fillIn.ts.
//
//   [fill-in numerals]   (task 080) HW1 P12's invented base-6 system, graded
//                        BY RULE against the student's own symbols (no key):
//                        the shape (6 symbol boxes zero…five, one short box
//                        "thirty-two", 7 cases), a sound set + the right
//                        numeral 7/7, a repeat fails both copies, a digit
//                        (even disguised: keycap 5️⃣, fullwidth ５, 5+VS16,
//                        5+accent, ⑤, another script's) or a two-character
//                        symbol fails, the numeral in the
//                        wrong order fails, whitespace ignored, an emoji is
//                        one character, NFC, case matters, an unsound symbol
//                        fails the numeral using it, labels never an answer,
//                        submit from the stripped copy → 7/7 with the spec
//                        whole; the HW1 demo seed answers P12 in its boxes
//                        (7/7 and 5/7); the creator's numeral draft (round-trips P12,
//                        each defect named, which edits misplace answers);
//                        and a grep pin: `.numeral` is read only in
//                        engine/fillIn.ts.
//
//   [multi-part problems] (task 048) the HW1 fold changed no grading unit:
//                        question ids, sections and the grading projection
//                        (everything but display fields) equal what they were
//                        before it; the new fields reach the student copy and
//                        carry no key; a review table (a table with no key)
//                        grades pending and keeps its cells, a keyed one still
//                        grades by script, blanks with no key still skip.
//                        (P12's `fill_in`, task 080's on purpose, sits
//                        outside the projection; [fill-in numerals] pins it.)
//
//   [perception films]   (task 013) an SC perception question authored with
//                        films (instructor/perceptionAuthoring.ts): submit →
//                        grade counts generated + authored cases, the right
//                        detector passes all, a wrong one fails an authored
//                        film; the student copy carries no case.
//
//   [turbot arena authoring]  (task 010) the question creator's arena family:
//                        drafts → `turbot_cases` round-trips every sample and
//                        HW1–HW7 turbot question exactly (the homework sync
//                        keeps them pristine), add / duplicate (a deep copy)
//                        / remove (never the last) / reorder move an arena
//                        with its criterion and budget, the saved arenas an
//                        edit would shift (graded runs are positional: warned
//                        and confirmed at save), the per-arena defects
//                        that block a save, an authored 2-arena question kept
//                        whole in the student copy and graded per arena in
//                        order (`turbotCases[k]` is `turbot_cases[k]`), and a
//                        grep pin: no single-arena path left in the creator.
//
//   [local extensions/waivers]  (task 068) the local GradingStore's
//                        setExtension / setWaiver over a shimmed
//                        localStorage: the summary row priced by the bundled
//                        calendar and netted by the waiver, an extension
//                        clearing lateness and Missing, both logged with no
//                        questionId, the student's served copy (never the
//                        instructor's) carrying the extended date, a released
//                        own record carrying `lateWaived` — and no fetch at all.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssignmentData, AssignmentQuestion, CircuitData, HumanGrade, QuestionResult, SubmissionData, SubmissionRecord } from '../src/types';
import { QUESTION_TASKS, questionModeLabel, questionTask } from '../src/types';
import {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
  ccCorrect,
  scCorrect,
  turbotCorrect,
  turbotIncorrect,
  perceptionMotionDetector,
} from '../src/devData/sampleData';
import { perceptionFields, type PerceptionDraft } from '../src/instructor/perceptionAuthoring';
import { buildPerceptionCases, expectedPerceptionOutputs, objectFrame } from '../src/engine/perception';
import { boxAcross, boxWhole } from './builder';
import { gradeQuestion, gradeSubmission } from '../src/engine/grader';
import { answerKey, autoPoints, scoreRecord, type ProblemScore } from '../src/engine/score';
import { buildSubmission } from '../src/storage/submissionStore';
import { legacyGradesByStudent, planGradeWrite, studentGrade, type GradeWrite } from '../src/storage/gradeWrites';
import { checkGroup, MAX_GROUP_OTHERS } from '../src/submissionGroup';
import { emptyQuestionCircuit } from '../src/storage/workbookStore';
import { buildAssignmentSummary } from '../src/storage/gradingSummary';
import { problemVerdict } from '../src/gradeDisplay';
import {
  FILL_IN_TABLE_MAX_ROWS,
  fillInBlanks,
  fillInCaseCount,
  fillInKeyProblem,
  fillInShape,
  isReviewTable,
} from '../src/engine/fillIn';
import { sha256, toHex, utf8 } from '../src/provenance/sha256';
import { problemGroups } from '../src/problemSet';
import {
  addTableColumn,
  blankDraftsOf,
  fillInFields,
  fillInNumeralFields,
  fillInNumeralProblems,
  fillInProblems,
  fillInTableFields,
  fillInTableProblems,
  misplacedAnswersWarning,
  misplacedBlanks,
  misplacedNumeralWarning,
  misplacedTableWarning,
  moveTableColumn,
  newBlankDraft,
  newNumeralDraft,
  newNumeralNumber,
  newTableDraft,
  newTableKeyRow,
  numeralCaseCount,
  numeralDraftOf,
  removeTableColumn,
  tableDraftOf,
  tableRowCount,
  type FillInBlankDraft,
  type FillInNumeralDraft,
  type FillInTableDraft,
} from '../src/instructor/fillInAuthoring';
import { moveItem } from '../src/instructor/dragReorder';
import {
  describeTurbotCase,
  duplicateTurbotCase,
  misplacedArenas,
  misplacedArenasWarning,
  newTurbotCaseDraft,
  removeTurbotCase,
  turbotCaseDraftsOf,
  turbotCaseIndexOf,
  turbotCaseProblems,
  turbotCasesField,
  DEFAULT_CRITERION,
  DEFAULT_MAX_STEPS,
  type TurbotCaseDraft,
} from '../src/instructor/turbotCaseAuthoring';
import { resizeArena, setArenaCell } from '../src/arenaEditing';
import { canonicalJson } from '../src/devData/homeworkSync';
import { stripAnswers } from '../../server/src/sanitize';

const NOW_ISO = '2026-09-10T00:00:00.000Z';

const assignment = buildSampleAssignment();

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

console.log('Assignment:', assignment.title);
for (const q of assignment.questions) {
  if (q.buildMode === 'open') {
    console.log(`  ${q.label}: open question (manual review)`);
    continue;
  }
  const n = q.buildMode === 'turbot' ? q.turbot_cases?.length
    : q.perception ? q.perception_cases?.length
    : q.test_cases?.length;
  const unit = q.buildMode === 'turbot' ? 'arenas' : q.perception ? 'perception cases' : 'test cases';
  console.log(`  ${q.label}: ${n ?? 0} ${unit}`);
}

console.log('\n[correct submission]');
const correct = gradeSubmission(assignment, buildCorrectSubmission());
for (const q of correct.questions) {
  const def = assignment.questions.find((x) => x.id === q.questionId);
  console.log(`  ${def?.label}: ${q.status} ${q.passed}/${q.total}`);
  if (def?.buildMode === 'open') {
    check(`${def.label} is pending with the response attached`,
      q.status === 'pending' && q.total === 0 && (q.response ?? '').length > 0);
  } else {
    check(`${def?.label} all vectors pass`, q.status === 'graded' && q.total > 0 && q.passed === q.total);
  }
}
const fullPoints = (r: typeof correct) =>
  assignment.questions.filter((q) => autoPoints(q, r.questions.find((x) => x.questionId === q.id)) === 1).length;
const autograded = (r: typeof correct) =>
  assignment.questions.filter((q) => autoPoints(q, r.questions.find((x) => x.questionId === q.id)) !== null).length;
check('correct: 13/13 autograded questions earn their point', fullPoints(correct) === 13 && autograded(correct) === 13);

console.log('\n[incorrect submission]');
const wrong = gradeSubmission(assignment, buildIncorrectSubmission());
for (const q of wrong.questions) {
  const def = assignment.questions.find((x) => x.id === q.questionId);
  console.log(`  ${def?.label}: ${q.status} ${q.passed}/${q.total}`);
  if (def?.buildMode === 'open') {
    check(`${def.label} is pending with an empty response`,
      q.status === 'pending' && q.response === '');
  } else {
    check(`${def?.label} fails at least one vector`, q.status === 'graded' && q.passed < q.total);
  }
}
check('incorrect: 0/13 autograded questions earn a point', fullPoints(wrong) === 0 && autograded(wrong) === 13);

// A sequential sub-circuit boxed (task 004): the SC answer with its whole
// circuit — MEM included — inside one placed box grades exactly as unboxed,
// through the same submit path.
console.log('\n[boxed SC answer]');
{
  const boxedSub = buildCorrectSubmission('boxed@example.com');
  boxedSub.answers = boxedSub.answers.map((a) =>
    a.questionId === 2 ? { ...a, circuit: boxWhole(scCorrect()) } : a);
  const boxedResult = gradeSubmission(assignment, boxedSub);
  const boxedQ = boxedResult.questions.find((q) => q.questionId === 2)!;
  const plainQ = correct.questions.find((q) => q.questionId === 2)!;
  check(`the SC answer boxed whole grades 100% (${boxedQ.passed}/${boxedQ.total})`,
    boxedQ.status === 'graded' && boxedQ.total > 0 && boxedQ.passed === boxedQ.total);
  check('...its per-case results equal the unboxed grade',
    JSON.stringify(boxedQ) === JSON.stringify(plainQ));
}

// A box drawn across wires (task 038): the CC and SC answers with everything
// but their INs/OUTs in one box, its ports bound to the wires it cuts (no
// IN/OUT inside), grade exactly as unboxed through the same submit path.
console.log('\n[boxed-across answers]');
{
  const acrossSub = buildCorrectSubmission('across@example.com');
  acrossSub.answers = acrossSub.answers.map((a) =>
    a.questionId === 1 ? { ...a, circuit: boxAcross(ccCorrect()) }
      : a.questionId === 2 ? { ...a, circuit: boxAcross(scCorrect()) }
      : a);
  const acrossResult = gradeSubmission(assignment, acrossSub);
  for (const [id, mode] of [[1, 'CC'], [2, 'SC']] as const) {
    const acrossQ = acrossResult.questions.find((q) => q.questionId === id)!;
    const plainQ = correct.questions.find((q) => q.questionId === id)!;
    const box = acrossSub.answers.find((a) => a.questionId === id)!.circuit.components.find((c) => c.type === 'BOXED');
    check(`the ${mode} answer boxed across (no IN/OUT inside) grades 100% (${acrossQ.passed}/${acrossQ.total})`,
      box != null && !box.internalCircuit!.components.some((c) => c.type === 'INPUT' || c.type === 'OUTPUT') &&
      acrossQ.status === 'graded' && acrossQ.total > 0 && acrossQ.passed === acrossQ.total);
    check(`...its per-case results equal the unboxed ${mode} grade`,
      JSON.stringify(acrossQ) === JSON.stringify(plainQ));
  }
}

// An SC perception question carrying the instructor's own films (task 013):
// the same submit → grade path, the films graded after the battery. Film 1
// is flagged "Example for students" (task 059): it reaches the student copy
// as `perception_examples`, film 2 never does, and the grade ignores it.
console.log('\n[perception films]');
{
  const film1 = [objectFrame(8, 3, 0), objectFrame(8, 3, 1), objectFrame(8, 3, 2)];
  const film2 = [[1, 1, 1, 0, 0, 0, 0, 1], [0, 1, 1, 1, 0, 0, 0, 1]];
  const draft: PerceptionDraft = {
    kind: 'motion', width: 8, runLength: 3, pattern: '', direction: 'down', scene: 'multi',
    films: [{ frames: film1, example: true }, { frames: film2, example: false }],
  };
  const q: AssignmentQuestion = {
    id: 1, label: 'Films', statement: 'Detect downward motion.', buildMode: 'SC', representation: 'binary',
    ...perceptionFields(draft, 'SC'),
  };
  const asg: AssignmentData = { id: 'perception-films', title: 'Perception films', questions: [q] };
  const generated = buildPerceptionCases(q.perception!).length;
  const submit = (circuit: CircuitData, on: AssignmentData = asg) =>
    gradeSubmission(on, { assignmentTitle: asg.title, submittedAt: NOW_ISO, answers: [{ questionId: 1, circuit }] }).questions[0];
  const good = submit(perceptionMotionDetector({ width: 8, k: 3, direction: 'down', scene: 'multi' }));
  const bad = submit(perceptionMotionDetector({ width: 8, k: 3, direction: 'down', scene: 'single' }));
  check(`total = ${generated} generated + 2 authored`, good.total === generated + 2 && q.perception_cases!.filter((c) => c.authored).length === 2);
  check(`the down/multi detector passes all (${good.passed}/${good.total})`, good.status === 'graded' && good.passed === good.total);
  check('a down/single detector fails the authored clutter film',
    bad.passed < bad.total && bad.perceptionCases![generated + 1].pass === false && bad.perceptionCases![generated].pass === true);
  const served = stripAnswers(asg).questions[0];
  check('the student copy carries no perception case (films included) and the rule unchanged',
    (served.perception_cases ?? []).length === 0 && JSON.stringify(served.perception) === JSON.stringify(q.perception) &&
    !JSON.stringify(served).includes('authored'));
  check('the student copy carries perception_examples: film 1 + its rule expected, nothing else',
    JSON.stringify(served.perception_examples) === JSON.stringify([{ frames: film1, expected: expectedPerceptionOutputs(q.perception!.rule, film1) }]));
  check("the unflagged film's frames and the flag keys never reach the student copy",
    !JSON.stringify(served).includes(JSON.stringify(film2)) && !/"(authored|example)"/.test(JSON.stringify(served)));
  // The grader never reads the field: tampered or missing examples grade the same.
  const withQ = (patch: Partial<AssignmentQuestion>): AssignmentData => ({ ...asg, questions: [{ ...q, ...patch }] });
  const { perception_examples: _dropped, ...noExamples } = q;
  const tampered = [
    withQ({ perception_examples: [{ frames: film1, expected: [1, 0, 0] }, { frames: film2, expected: [1, 1] }] }),
    { ...asg, questions: [noExamples] },
  ];
  for (const circuit of [perceptionMotionDetector({ width: 8, k: 3, direction: 'down', scene: 'multi' }), perceptionMotionDetector({ width: 8, k: 3, direction: 'down', scene: 'single' })]) {
    const base = JSON.stringify(submit(circuit));
    check('a grade with tampered / missing perception_examples ≡ the untampered grade',
      tampered.every((t) => JSON.stringify(submit(circuit, t)) === base));
  }
}

// Human grades (task 063): the ONE write planner both GradingStores run
// (storage/gradeWrites.ts). A grade is stored apart from the result, anchored
// to the latest attempt's answer, versioned, logged; the grading summary then
// counts the problem like any other.
console.log('\n[human grades]');
const openQ = assignment.questions.find((q) => q.buildMode === 'open')!;
const machineQ = assignment.questions.find((q) => q.buildMode !== 'open')!;
const records: SubmissionRecord[] = [
  {
    assignmentId: 'sample',
    attempt: 1,
    submittedAt: '2026-07-07T00:00:00.000Z',
    submission: buildCorrectSubmission(),
    result: correct,
  },
];
{
  const plan = (question: typeof openQ, write: GradeWrite, existing: HumanGrade | null = null) =>
    planGradeWrite({ question, latest: records[0], student: 's@x', existing, write, actor: 'prof@x', now: '2026-07-08T00:00:00.000Z' });
  const first = plan(openQ, { points: 1, note: ' well argued ', version: null });
  check('a first grade on an open problem: version 1, anchored to the answer, stamped, logged as "grade"',
    first.ok && first.grade?.version === 1 && first.grade.points === 1 && first.grade.note === 'well argued' &&
    first.grade.answerKey === answerKey(openQ, records[0].submission.answers.find((a) => a.questionId === openQ.id)) &&
    first.grade.grader === 'prof@x' && first.grade.attempt === 1 &&
    first.event.kind === 'grade' && first.event.before === null);
  const g1 = first.ok ? first.grade! : null;
  check('a write that read no grade, where there is one, is a conflict carrying it',
    (() => { const r = plan(openQ, { points: 0, version: null }, g1); return !r.ok && r.conflict && r.current === g1; })());
  check('a write naming the current version replaces it: version 2, before/after logged',
    (() => { const r = plan(openQ, { points: 0.5, version: 1 }, g1); return r.ok && r.grade?.version === 2 && r.event.before === g1; })());
  check('points outside 0 / ½ / 1 are refused',
    (() => { const r = plan(openQ, { points: 0.7 as never, version: null }); return !r.ok && !r.conflict; })());
  check('overriding an autograded problem needs a note; with one it is an "override"',
    (() => { const r = plan(machineQ, { points: 0.5, version: null }); return !r.ok && !r.conflict && /note/.test(r.error); })() &&
    (() => { const r = plan(machineQ, { points: 0.5, note: 'one wire off', version: null }); return r.ok && r.event.kind === 'override'; })());
  check('clearing names the version too, and is logged; clearing what someone already cleared is a conflict carrying nothing',
    (() => { const r = plan(openQ, { clear: true, version: 1 }, g1); return r.ok && r.grade === null && r.event.kind === 'clear'; })() &&
    (() => { const r = plan(openQ, { clear: true, version: 1 }); return !r.ok && r.conflict && r.current === null; })());
  check('no submission, no grade', (() => {
    const r = planGradeWrite({ question: openQ, latest: null, student: 's@x', existing: null, write: { points: 1, version: null }, actor: 'p', now: 'n' });
    return !r.ok && !r.conflict;
  })());
  const legacy: SubmissionRecord[] = [
    { ...records[0], result: { ...correct, questions: correct.questions.map((q) => q.questionId === openQ.id ? { ...q, manual: { pass: false, reviewedAt: '2026-07-01T00:00:00.000Z' } } : q) } },
    { ...records[0], attempt: 2, result: { ...correct, questions: correct.questions.map((q) => q.questionId === openQ.id ? { ...q, manual: { pass: true, note: 'ok', reviewedAt: '2026-07-02T00:00:00.000Z' } } : q) } },
  ];
  const migrated = legacyGradesByStudent(assignment.questions, legacy, () => 's@x').get('s@x') ?? [];
  check("the legacy migration carries the LATEST attempt's review only (✓ = 1), version 1, grader null",
    migrated.length === 1 && migrated[0].points === 1 && migrated[0].attempt === 2 && migrated[0].version === 1 &&
    migrated[0].grader === null && migrated[0].note === 'ok');

  if (g1) {
    // What the grading views read (task 065): the one summary builder's row.
    const rowOf = (grades: HumanGrade[]) => buildAssignmentSummary({
      assignment,
      roster: [{ key: 's@x', name: 'S', sortName: 'S', uid: '', section: null, hasAccount: true }],
      latest: [{ ...records[0], studentKey: 's@x', grades }],
      identify: (key) => ({ key, name: key, sortName: key, uid: '', section: null, hasAccount: true }),
      released: false,
      now: Date.now(),
    }).rows[0];
    const before = rowOf([]);
    const after = rowOf([g1]);
    const cell = after.problems[assignment.questions.findIndex((q) => q.id === openQ.id)];
    check('the grading summary counts the graded problem: source "human", 1 point', cell?.source === 'human' && cell.points === 1);
    check('the grade now includes it: provisional before, 100 after',
      before.grade.provisional && before.grade.final! < 100 && !after.grade.provisional && after.grade.final === 100);
    check("the student's sheet (scoreRecord, a student-safe copy) and the grading summary agree",
      scoreRecord(assignment.questions, { ...records[0], grades: [studentGrade(g1)] }, Date.now()).final === after.grade.final &&
      !('grader' in studentGrade(g1)) && !('version' in studentGrade(g1)));
  }
}

// ── Fill-in-the-blank questions (HW1 P11) ──────────────────────────
// An open question with a `fill_in` spec IS autogradable: string answers,
// leading zeros normalised away, no machine to run (engine/fillIn.ts).
console.log('\n[fill-in blanks]');
{
  const hw1 = JSON.parse(
    readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8'),
  ) as AssignmentData;
  const q = hw1.questions.find((x) => x.id === 11)!;
  check('HW1 P11 carries a fill-in spec and a same-length answer key',
    !!q.fill_in && fillInBlanks(q.fill_in).length === 11 &&
    q.fill_in_answers?.length === 11);
  check('the boxes are labelled zero through ten, in words (task 046)',
    fillInBlanks(q.fill_in!).map((b) => b.label).join(',') === 'zero,one,two,three,four,five,six,seven,eight,nine,ten');

  const correct = Array.from({ length: 11 }, (_, n) => n.toString(2));
  const graded = gradeQuestion(q, undefined, undefined, correct);
  check('correct binary numerals score 11/11',
    graded.status === 'graded' && graded.passed === 11 && graded.total === 11);
  check('leading zeros are ignored ("0011" === "11")',
    gradeQuestion(q, undefined, undefined, correct.map((a) => '00' + a)).passed === 11);
  check('surrounding whitespace is ignored',
    gradeQuestion(q, undefined, undefined, correct.map((a) => ` ${a} `)).passed === 11);
  check('"000" still reads as zero, not as blank',
    (gradeQuestion(q, undefined, undefined, ['000', ...correct.slice(1)]).fillCases ?? [])[0]?.pass === true);

  const oneWrong = gradeQuestion(q, undefined, undefined, correct.map((a, i) => (i === 4 ? '1000' : a)));
  check('one wrong numeral scores 10/11 and names the blank',
    oneWrong.passed === 10 &&
    (oneWrong.fillCases ?? []).filter((c) => !c.pass).map((c) => c.label).join('') === 'four');

  const blank = gradeQuestion(q, undefined, undefined, []);
  check('no answers at all fails every blank (never "pending")',
    blank.status === 'graded' && blank.passed === 0 && blank.total === 11);
  check('a blank box is a failure, not a match against the empty string',
    (blank.fillCases ?? []).every((c) => !c.pass && c.got === ''));

  // Through the whole submit path, exactly as a student's Submit does.
  const circuits = new Map<number, ReturnType<typeof emptyQuestionCircuit>>();
  circuits.set(11, { ...emptyQuestionCircuit(), fillAnswers: correct });
  const built = buildSubmission(hw1, circuits, {
    student: 'fill@example.com',
    submittedAt: NOW_ISO,
  });
  const answer = built.answers.find((a) => a.questionId === 11);
  check('buildSubmission carries the blanks, not a responseText',
    answer?.fillAnswers?.length === 11 && answer.responseText === undefined);
  const wholeHw = gradeSubmission(hw1, built);
  check('the fill-in question grades 11/11 through gradeSubmission',
    wholeHw.questions.find((r) => r.questionId === 11)?.passed === 11);
}

// ── Authoring a fill-in question (task 005) ────────────────────────
// The creator's blanks are drafts (instructor/fillInAuthoring.ts) saved as
// `fill_in` + `fill_in_answers`; the server strips the answers for students
// and keeps the spec whole, so nothing that is a key may live in the spec.
console.log('\n[fill-in authoring]');
{
  const readHw = (n: number) => JSON.parse(
    readFileSync(new URL(`../src/devData/homeworks/hw${n}.json`, import.meta.url), 'utf8'),
  ) as AssignmentData;
  const hw1 = readHw(1);
  const p11 = hw1.questions.find((x) => x.id === 11)!;

  // (1) A no-op creator edit reproduces the hand-written question exactly —
  // canonicalJson is the homework sync's own comparison, so P11 stays pristine.
  const p11Drafts = blankDraftsOf(p11);
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  check('HW1 P11 loads as 11 drafts, each with its answer and the digits-only flag',
    p11Drafts.length === 11 && p11Drafts.every((d, i) =>
      d.label === WORDS[i] && d.answer === p11.fill_in_answers![i] && d.digitsOnly));
  check('drafts → fields round-trips HW1 P11 byte-for-byte (canonicalJson)',
    canonicalJson(fillInFields(p11Drafts)) ===
      canonicalJson({ fill_in: p11.fill_in, fill_in_answers: p11.fill_in_answers }));
  check('...and keeps P11 in its `numericOnly: true` form',
    fillInFields(p11Drafts).fill_in.numericOnly === true);
  const numbered = p11Drafts.map((d, i) => ({ ...d, label: String(i) }));
  const added = newBlankDraft(numbered);
  check('a new blank after blanks labelled 0–10 is labelled "11" and inherits digits-only',
    added.label === '11' && added.digitsOnly && added.answer === '' &&
      !numbered.some((d) => d.key === added.key));
  check('...and after P11\'s word labels takes the first unused number, "1"',
    newBlankDraft(p11Drafts).label === '1');
  check('a question without a spec (new, or free response) has no drafts',
    blankDraftsOf(undefined).length === 0 &&
      blankDraftsOf(hw1.questions.find((x) => x.id === 10)).length === 0);

  // An authored question with a MIX of digits-only and free-text blanks.
  const draft = (label: string, digitsOnly: boolean, answer: string): FillInBlankDraft =>
    ({ ...newBlankDraft([]), label, digitsOnly, answer });
  const drafts = [
    draft(' seven in binary ', true, ' 111 '),
    draft('the capital of France', false, 'Paris'),
    draft('four in binary', true, '100'),
  ];
  const fields = fillInFields(drafts);

  // (2) numericOnly: all → true, none → absent, mixed → one flag per blank.
  check('mixed blanks save one flag per blank [true, false, true]',
    JSON.stringify(fields.fill_in.numericOnly) === '[true,false,true]');
  check('...read back per blank by fillInBlanks',
    fillInBlanks(fields.fill_in).map((b) => b.digitsOnly).join() === 'true,false,true');
  check('all digits-only saves `numericOnly: true`',
    fillInFields(drafts.map((d) => ({ ...d, digitsOnly: true }))).fill_in.numericOnly === true);
  check('no digits-only blank omits the key',
    !('numericOnly' in fillInFields(drafts.map((d) => ({ ...d, digitsOnly: false }))).fill_in));
  check('labels and answers are saved trimmed, parallel, in row order',
    fields.fill_in.labels!.join('|') === 'seven in binary|the capital of France|four in binary' &&
      fields.fill_in_answers.join('|') === '111|Paris|100');
  check('a lone array entry that is not true reads as a free-text blank',
    fillInBlanks({ labels: ['a', 'b'], numericOnly: [true] }).map((b) => b.digitsOnly).join() === 'true,false');

  // (3) Reordering moves a whole row: label, answer and flag stay together.
  const moved = fillInFields(moveItem(drafts, 0, 2));
  check('moving blank #1 to the end moves its label, answer and flag together',
    moved.fill_in.labels!.join('|') === 'the capital of France|four in binary|seven in binary' &&
      moved.fill_in_answers.join('|') === 'Paris|100|111' &&
      JSON.stringify(moved.fill_in.numericOnly) === '[false,true,true]');

  // (3b) Students' answers are stored by position, so the creator warns (and
  // confirms at save) exactly when a saved blank loses its slot.
  const labelsOf = (ls: string[]) => ls.join('|');
  const edited = p11Drafts.map((d, i) =>
    i === 4 ? { ...d, label: 'the number four', answer: '0100', digitsOnly: false } : d);
  check('relabelling a saved blank, or changing its answer or flag, misplaces nothing',
    misplacedBlanks(p11Drafts, edited).length === 0);
  check('appending blanks misplaces nothing',
    misplacedBlanks(p11Drafts, [...p11Drafts, newBlankDraft(p11Drafts)]).length === 0);
  check('removing blank "three" misplaces the answers to "three" and every blank after it',
    labelsOf(misplacedBlanks(p11Drafts, p11Drafts.filter((_, i) => i !== 3))) ===
      'three|four|five|six|seven|eight|nine|ten');
  check('swapping two blanks misplaces exactly those two',
    labelsOf(misplacedBlanks(p11Drafts, moveItem(p11Drafts, 0, 1))) === 'zero|one');
  check('inserting a new blank first misplaces every saved one',
    misplacedBlanks(p11Drafts, [newBlankDraft(p11Drafts), ...p11Drafts]).length === 11);
  check('saving no blanks (the question stops being fill-in) misplaces every saved one',
    misplacedBlanks(p11Drafts, []).length === 11);
  check('a new question has no saved blanks to misplace',
    misplacedBlanks([], [newBlankDraft([])]).length === 0);
  const warning = misplacedAnswersWarning(['3', '4', '5', '6', '7', '8', '9', '10']);
  check('the warning names the first five blanks and counts the rest',
    warning.includes('blanks "3", "4", "5", "6", "7" and 3 more') &&
      misplacedAnswersWarning(['0']).includes('blank "0" will'));

  // (4) What blocks a save, each named by its blank.
  const problems = (ds: FillInBlankDraft[]) => fillInProblems(ds);
  check('a sound list has no problems', problems(drafts).length === 0);
  check('zero blanks cannot be saved', problems([]).length === 1);
  check('an empty label is named',
    problems([draft('  ', false, 'x')]).includes('Blank #1 needs a label.'));
  check('a repeated label is named, pointing at the first',
    problems([draft('a', false, 'x'), draft(' a ', false, 'y')])
      .includes('Blank #2 repeats the label "a" of blank #1.'));
  check('an empty answer is named (the grader never passes an empty box)',
    problems([draft('a', false, '   ')]).includes('Blank #1 needs an answer.'));
  check('letters in a digits-only answer are named (the student could never type them)',
    problems([draft('a', false, 'x'), draft('b', true, '1O1')])
      .some((p) => p.startsWith('Blank #2 is digits-only')));

  // (5) The student's copy: the key is gone and the spec carries nothing else.
  const authoredQ: AssignmentQuestion = {
    id: 1,
    label: 'Problem 1',
    statement: 'Fill in the blanks.',
    buildMode: 'open',
    representation: 'binary',
    ...fields,
  };
  const authored: AssignmentData = { id: 'authored-fill-in', title: 'Authored', questions: [authoredQ] };
  const studentQ = stripAnswers(authored).questions[0];
  check('the student copy has an empty answer key', studentQ.fill_in_answers?.length === 0);
  check('the student copy\'s fill_in has only labels / table and numericOnly',
    Object.keys(studentQ.fill_in ?? {}).every((k) => k === 'labels' || k === 'table' || k === 'numericOnly'));
  check('...and is the authored spec unchanged (the prompts and per-blank flags)',
    canonicalJson(studentQ.fill_in) === canonicalJson(authoredQ.fill_in));
  check('no answer appears anywhere in the student copy',
    !['111', 'Paris'].some((a) => JSON.stringify(studentQ).includes(a)));

  // (6) Submit → graded, as one pipeline: the student builds the submission from
  // the STRIPPED copy they were sent, and the key-holding side grades it.
  const studentCopy = stripAnswers(authored);
  const submitWith = (fillAnswers: string[]) => {
    const circuits = new Map([[1, { ...emptyQuestionCircuit(), fillAnswers }]]);
    const built = buildSubmission(studentCopy, circuits, { student: 'author@example.com', submittedAt: NOW_ISO });
    return gradeSubmission(authored, built).questions[0];
  };
  const right = submitWith(['111', ' Paris ', '0100']);
  check('the right answers grade 3/3 through buildSubmission → gradeSubmission',
    right.status === 'graded' && right.passed === 3 && right.total === 3);
  const oneOff = submitWith(['111', 'London', '100']);
  check('one wrong answer grades 2/3 and names that blank',
    oneOff.passed === 2 && (oneOff.fillCases ?? []).filter((c) => !c.pass).map((c) => c.label).join() === 'the capital of France');
  check('letters on a digits-only blank fail',
    (submitWith(['seven', 'Paris', '100']).fillCases ?? [])[0]?.pass === false);

  // (7) One classifier decides the panel, the grader branch and the answer.
  check('HW1 P11 is a fill-in task, chipped "open - fill-in"',
    questionTask(p11) === 'fill-in' && questionModeLabel(p11) === 'open - fill-in');
  const prose = hw1.questions.find((x) => x.id === 10)!;
  check('a prose open question is an open task, graded pending',
    questionTask(prose) === 'open' && gradeQuestion(prose, undefined, 'my answer').status === 'pending');
  const everyQ = [assignment, ...[1, 2, 3, 4, 5, 6, 7].map(readHw)].flatMap((a) => a.questions);
  const offMode = everyQ.filter((q) => !QUESTION_TASKS[q.buildMode].includes(questionTask(q)));
  check(`every sample + HW1–HW7 question's task is one its mode offers (${everyQ.length} questions)`,
    offMode.length === 0);
  const ccWithBlanks: AssignmentQuestion = {
    id: 99, label: 'x', statement: '', buildMode: 'CC', representation: 'binary',
    fill_in: { labels: ['a'] }, fill_in_answers: ['1'],
  };
  check('a fill_in on a CC question is NOT a fill-in task (nor graded as one)',
    questionTask(ccWithBlanks) === 'function' &&
      gradeQuestion(ccWithBlanks, undefined, undefined, ['1']).fillCases === undefined);

  // (8) One reader (engine/fillIn.ts fillInBlanks) and one writer
  // (instructor/fillInAuthoring.ts fillInFields) of `numericOnly`: an array
  // is truthy, so any other `if (spec.numericOnly)` would lock every blank.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  const allowed = ['app/src/types.ts', 'app/src/engine/fillIn.ts', 'app/src/instructor/fillInAuthoring.ts'];
  const mentions = [...walk(join(root, 'app/src')), ...walk(join(root, 'server/src'))]
    .filter((f) => readFileSync(f, 'utf8').includes('numericOnly'))
    .map((f) => relative(root, f).split('\\').join('/'));
  const strays = mentions.filter((f) => !allowed.includes(f));
  check('`numericOnly` is named only in types.ts, engine/fillIn.ts and instructor/fillInAuthoring.ts',
    strays.length === 0 && allowed.every((f) => mentions.includes(f)));
  for (const f of strays) console.log(`        → ${f}`);
}

// ── Fill-in tables (task 079) ──────────────────────────────────────
// A "define it with a table" problem is a blank argument–value table the
// student fills whole — arguments too — graded as a FUNCTION: each key row is
// one case, passed iff exactly one student row has its arguments and that
// row's values match (engine/fillIn.ts). Answers and key both stay row-major
// string lists, so nothing new travels or persists.
console.log('\n[fill-in tables]');
{
  const hw1 = JSON.parse(
    readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8'),
  ) as AssignmentData;
  const p14 = hw1.questions.find((x) => x.id === 14)!;
  const p9b = hw1.questions.find((x) => x.id === 20)!;
  const grade = (q: AssignmentQuestion, cells: string[]) => gradeQuestion(q, undefined, undefined, cells);
  const score = (r: QuestionResult) => `${r.passed}/${r.total}`;
  const failedLabels = (r: QuestionResult) => (r.fillCases ?? []).filter((c) => !c.pass).map((c) => c.label);
  // P9b's function j(x, y) = x·y on {0, 1, 2}², as rows in the key's order.
  const J_ROWS: [number, number][] = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) J_ROWS.push([x, y]);
  const jCells = (rows: [number, number][]) => rows.flatMap(([x, y]) => [String(x), String(y), String(x * y)]);

  // (a) HW1 P14 and P9b are tables, their keys whole rows.
  const s14 = fillInShape(p14.fill_in!);
  const s9 = fillInShape(p9b.fill_in!);
  check('HW1 P14 is a 2-row table: Argument | Value, one argument column, a 4-cell key',
    s14.kind === 'table' && s14.argColumns === 1 && s14.rows === 2 &&
      s14.columns.map((c) => c.header).join('|') === 'Argument|Value' &&
      s14.columns.map((c) => c.digitsOnly).join() === 'false,true' && p14.fill_in_answers?.length === 4);
  check('HW1 P9b is a 9-row table: x | y | j(x, y), two argument columns, a 27-cell key',
    s9.kind === 'table' && s9.argColumns === 2 && s9.rows === 9 &&
      s9.columns.map((c) => c.header).join('|') === 'x|y|j(x, y)' &&
      s9.columns.every((c) => c.digitsOnly) && p9b.fill_in_answers?.length === 27);
  check('both keys fit their tables (fillInKeyProblem null) and are blank-free (fillInBlanks [])',
    fillInKeyProblem(p14.fill_in!, p14.fill_in_answers!) === null &&
      fillInKeyProblem(p9b.fill_in!, p9b.fill_in_answers!) === null &&
      fillInBlanks(p14.fill_in!).length === 0);

  // (b) Order-free.
  const right14 = grade(p14, ['@', '0', '#', '1']);
  check('P14 in key order grades 2/2', right14.status === 'graded' && score(right14) === '2/2');
  check('P14 with its rows reversed still grades 2/2', score(grade(p14, ['#', '1', '@', '0'])) === '2/2');
  const shuffled = [8, 3, 0, 5, 1, 7, 2, 6, 4].map((i) => J_ROWS[i]);
  check('P9b with its rows shuffled grades 9/9', score(grade(p9b, jCells(shuffled))) === '9/9');

  // (c) A wrong value fails exactly its key row, named by the arguments.
  const swapped = grade(p14, ['@', '1', '#', '0']);
  check('P14 with the values swapped grades 0/2', score(swapped) === '0/2');
  const oneWrong = jCells(J_ROWS);
  oneWrong[5 * 3 + 2] = '3'; // j(1, 2) = 2, written 3
  const r9 = grade(p9b, oneWrong);
  check('P9b with one wrong value grades 8/9 and names that row "(1, 2)"',
    score(r9) === '8/9' && failedLabels(r9).join() === '(1, 2)');
  const bad = (r9.fillCases ?? []).find((c) => !c.pass)!;
  check('...its expected / got are the values, not the arguments', bad.expected === '2' && bad.got === '3');

  // (d) A repeated argument is not a function: that key row fails.
  const dup14 = grade(p14, ['@', '0', '@', '0']);
  check('P14 with "@" twice grades 0/2 ("@" repeated, "#" missing)', score(dup14) === '0/2');
  const dup9 = jCells(J_ROWS.map(([x, y]) => (x === 2 && y === 2 ? [0, 0] : [x, y])));
  check('P9b with row (2, 2) replaced by (0, 0, 0) grades 7/9',
    score(grade(p9b, dup9)) === '7/9' && failedLabels(grade(p9b, dup9)).join('|') === '(0, 0)|(2, 2)');

  // (e) An empty table fails every key row.
  const empty = grade(p14, []);
  check('an empty table is graded (never pending) 0/2, every got ""',
    empty.status === 'graded' && score(empty) === '0/2' && (empty.fillCases ?? []).every((c) => c.got === ''));

  // (f) Empty rows are no rows; cells past the table are not in it.
  const fourRows: AssignmentQuestion = {
    ...p14, fill_in: { ...p14.fill_in!, table: { ...p14.fill_in!.table!, rows: 4 } },
  };
  check('a 4-row table with a 2-row key, answered in rows 1 and 3, grades 2/2',
    score(grade(fourRows, ['#', '1', '', '', '@', '0', '', ''])) === '2/2');
  const dupGot = grade(fourRows, ['@', '0', '@', '1', '#', '1']);
  check('a repeated argument fails even when one repeat is right; got lists every repeat',
    failedLabels(dupGot).join() === '@' && (dupGot.fillCases ?? [])[0].got === '0 / 1');
  check('cells past rows × columns are ignored (a stale longer answer adds no repeat)',
    score(grade(p14, ['@', '0', '#', '1', '@', '5'])) === '2/2');

  // (f2) The row cap: an authored count past FILL_IN_TABLE_MAX_ROWS (a typo in
  // the creator's rows field) never has the grader or the panel build rows by
  // the million, and the grader builds only the rows an answer has cells for.
  const MAX_ROWS = FILL_IN_TABLE_MAX_ROWS;
  const withRows = (rows: number): AssignmentQuestion => ({
    ...p14, fill_in: { ...p14.fill_in!, table: { ...p14.fill_in!.table!, rows } },
  });
  check(`a ${MAX_ROWS}-row table is gradeable; ${MAX_ROWS + 1} rows is named by fillInKeyProblem`,
    fillInKeyProblem(withRows(MAX_ROWS).fill_in!, p14.fill_in_answers!) === null &&
      new RegExp(`most it may give is ${MAX_ROWS}$`).test(
        fillInKeyProblem(withRows(MAX_ROWS + 1).fill_in!, p14.fill_in_answers!) ?? ''));
  const huge = withRows(5_000_000);
  const hugeShape = fillInShape(huge.fill_in!);
  check('an authored 5,000,000 rows renders only the cap (fillInShape), and its grading is skipped',
    hugeShape.kind === 'table' && hugeShape.rows === MAX_ROWS &&
      grade(huge, ['@', '0', '#', '1']).status === 'skipped');
  const lastRow = ['@', '0', ...Array<string>(2 * (MAX_ROWS - 2)).fill(''), '#', '1'];
  check(`a ${MAX_ROWS}-row table answered in rows 1 and ${MAX_ROWS} grades 2/2 (the last row reached)`,
    lastRow.length === 2 * MAX_ROWS && score(grade(withRows(MAX_ROWS), lastRow)) === '2/2');

  // (g) Normalisation: as blanks — surrounding spaces, leading zeros.
  check('" @ " and "00" match "@" and "0"', score(grade(p14, [' @ ', '00', '#', '01'])) === '2/2');

  // (h) Stale positional answers (the old f(@) / f(#) boxes) load harmlessly.
  const stale = grade(p14, ['0', '1']);
  check('the old boxes\' answers read as one row ("0", "1") and grade 0/2, no throw',
    stale.status === 'graded' && score(stale) === '0/2');

  // (i) A result's label names the key row's arguments, never a value.
  check('P14 case labels are its arguments ["@", "#"]',
    (right14.fillCases ?? []).map((c) => c.label).join() === '@,#');
  check('P9b case labels are the argument pairs "(0, 0)" … "(2, 2)", in key order',
    (grade(p9b, []).fillCases ?? []).map((c) => c.label).join('|') ===
      J_ROWS.map(([x, y]) => `(${x}, ${y})`).join('|'));

  // (j) Submit → graded, from the copy a student is sent.
  const studentHw1 = stripAnswers(hw1);
  const built = buildSubmission(studentHw1, new Map([
    [14, { ...emptyQuestionCircuit(), fillAnswers: ['#', '1', '@', '0'] }],
    [20, { ...emptyQuestionCircuit(), fillAnswers: jCells(shuffled) }],
  ]), { student: 'table@example.com', submittedAt: NOW_ISO });
  const whole = gradeSubmission(hw1, built);
  check('buildSubmission from the stripped HW1 → gradeSubmission grades P14 2/2 and P9b 9/9',
    whole.questions.find((r) => r.questionId === 14)?.passed === 2 &&
      whole.questions.find((r) => r.questionId === 20)?.passed === 9);

  // (k) The student copy: the layout, never the key.
  const s14q = studentHw1.questions.find((x) => x.id === 14)!;
  const s9q = studentHw1.questions.find((x) => x.id === 20)!;
  check('the student copy keeps fill_in.table with exactly columns / argColumns / rows',
    [s14q, s9q].every((q) => Object.keys(q.fill_in?.table ?? {}).sort().join() === 'argColumns,columns,rows'));
  check('...the authored layout unchanged, and an empty fill_in_answers',
    canonicalJson(s14q.fill_in) === canonicalJson(p14.fill_in) &&
      canonicalJson(s9q.fill_in) === canonicalJson(p9b.fill_in) &&
      s14q.fill_in_answers?.length === 0 && s9q.fill_in_answers?.length === 0);

  // (l) Authoring: the creator's table draft.
  const d14 = tableDraftOf(p14)!;
  const d9 = tableDraftOf(p9b)!;
  check('tableDraftOf → fillInTableFields round-trips HW1 P14 and P9b byte-for-byte (canonicalJson)',
    canonicalJson(fillInTableFields(d14)) === canonicalJson({ fill_in: p14.fill_in, fill_in_answers: p14.fill_in_answers }) &&
      canonicalJson(fillInTableFields(d9)) === canonicalJson({ fill_in: p9b.fill_in, fill_in_answers: p9b.fill_in_answers }));
  check('a table has no blank drafts; blanks have no table draft',
    blankDraftsOf(p14).length === 0 && tableDraftOf(hw1.questions.find((x) => x.id === 11)) === null &&
      tableDraftOf(undefined) === null);
  check('P9b loads as 9 key rows of 3 cells, rows "9"',
    d9.keyRows.length === 9 && d9.keyRows.every((r) => r.cells.length === 3) && d9.rows === '9');
  const fresh = newTableDraft();
  check('a new table: Argument | Value, one argument column, one empty key row, rows following the key',
    fresh.columns.map((c) => c.header).join('|') === 'Argument|Value' && fresh.argColumns === 1 &&
      fresh.keyRows.length === 1 && fresh.rows === '' && tableRowCount(fresh) === 1 &&
      tableRowCount({ ...fresh, keyRows: [...fresh.keyRows, newTableKeyRow(fresh), newTableKeyRow(fresh)] }) === 3);
  const filled: FillInTableDraft = {
    ...fresh,
    keyRows: [{ ...fresh.keyRows[0], cells: [' a ', '1'] }, { ...newTableKeyRow(fresh), cells: ['b', '0'] }],
  };
  const ff = fillInTableFields(filled);
  check('fields: trimmed headers and key, rows = the key\'s count, no numericOnly when none is digits-only',
    canonicalJson(ff) === canonicalJson({
      fill_in: { table: { columns: ['Argument', 'Value'], argColumns: 1, rows: 2 } },
      fill_in_answers: ['a', '1', 'b', '0'],
    }));
  check('numericOnly per column in the blanks\' canonical form (mixed → flags, all → true)',
    JSON.stringify(fillInTableFields({ ...filled, columns: [filled.columns[0], { ...filled.columns[1], digitsOnly: true }] }).fill_in.numericOnly) === '[false,true]' &&
      fillInTableFields({ ...filled, columns: filled.columns.map((c) => ({ ...c, digitsOnly: true })) }).fill_in.numericOnly === true);
  const wide = addTableColumn(d9);
  check('adding a column adds an empty key cell to every row',
    wide.columns.length === 4 && wide.keyRows.every((r) => r.cells.length === 4 && r.cells[3] === ''));
  const narrowed = removeTableColumn(d9, 0);
  check('removing an argument column takes its cells and one argument',
    narrowed.argColumns === 1 && narrowed.keyRows[5].cells.join() === '2,2');
  const movedCol = moveTableColumn(d9, 2, 0);
  check('moving a column moves its key cells with it',
    movedCol.columns[0].header === 'j(x, y)' && movedCol.keyRows[8].cells.join() === '4,2,2');

  // Each defect, named.
  const probs = (d: FillInTableDraft) => fillInTableProblems(d);
  check('a sound table (P14, P9b, a filled new one) has no problems',
    probs(d14).length === 0 && probs(d9).length === 0 && probs(filled).length === 0);
  check('0 argument columns, or all of them, is named',
    probs({ ...d14, argColumns: 0 }).includes('Make 1 to 1 of the columns arguments.') &&
      probs({ ...d14, argColumns: 2 }).includes('Make 1 to 1 of the columns arguments.'));
  check('an empty header is named',
    probs({ ...d14, columns: [{ ...d14.columns[0], header: ' ' }, d14.columns[1]] }).includes('Column #1 needs a header.'));
  check('a repeated header is named, pointing at the first',
    probs({ ...d14, columns: [d14.columns[0], { ...d14.columns[1], header: 'Argument' }] })
      .includes('Column #2 repeats the header "Argument" of column #1.'));
  const withKey = (d: FillInTableDraft, cells: string[][]) =>
    ({ ...d, keyRows: cells.map((c) => ({ ...newTableKeyRow(d), cells: c })) });
  check('an empty key cell is named by its column',
    probs(withKey(d14, [['@', ' '], ['#', '1']])).includes('Key row #1 needs a "Value" cell.'));
  check('repeated key arguments are named (after normalising)',
    probs(withKey(d9, [['0', '1', '0'], ['00', ' 1', '0']])).includes('Key row #2 repeats the arguments (00, 1) of key row #1.'));
  check('letters in a digits-only column are named',
    probs(withKey(d14, [['@', 'zero'], ['#', '1']])).some((p) => p.startsWith('Key row #1 has "zero" in the digits-only "Value"')));
  check('fewer rows than key rows is named',
    probs({ ...d14, rows: '1' }).includes('Students need at least 2 rows (one for each key row).'));
  check('rows that are not a whole number ≥ 1 are named',
    ['0', '1.5', 'x', '-2'].every((rows) => probs({ ...d14, rows }).includes('The rows students see must be a whole number, at least 1.')));
  check(`more than ${FILL_IN_TABLE_MAX_ROWS} rows for students is named (a typo in the rows field)`,
    ['101', '5000000'].every((rows) => probs({ ...d14, rows }).includes('The rows students see can be at most 100.')) &&
      probs({ ...d14, rows: '100' }).length === 0);
  check(`a key of more than ${FILL_IN_TABLE_MAX_ROWS} rows is named as such`,
    probs({ ...withKey(d14, Array.from({ length: 101 }, (_, i) => [`a${i}`, '1'])), rows: '' })
      .includes('A table\'s key can have at most 100 rows.'));
  // Zero key rows is a REVIEW table (task 048), graded by hand: sound, once
  // the rows students see are typed (the key can't size them).
  check('zero key rows is a review table: no defect with the rows typed; left to the key, the count is named',
    probs({ ...d14, keyRows: [] }).length === 0 &&
      probs({ ...d14, keyRows: [], rows: '' }).includes('The rows students see must be a whole number, at least 1.'));
  check('…and it saves with an empty key', fillInTableFields({ ...d14, keyRows: [] }).fill_in_answers.length === 0);
  check('fewer than two columns is named',
    probs({ ...removeTableColumn(d14, 1), argColumns: 1 }).includes('Give the table at least two columns (an argument and a value).'));

  // Which edits misplace answers already given (stored row-major).
  const edited9: FillInTableDraft = {
    ...d9,
    columns: d9.columns.map((c, j) => (j === 2 ? { ...c, header: 'x·y', digitsOnly: false } : c)),
    keyRows: [...d9.keyRows.slice(1).map((r, i) => (i === 0 ? { ...r, cells: ['0', '1', '7'] } : r)), newTableKeyRow(d9)],
  };
  check('renaming a column, changing its flag, or editing / adding / removing key rows misplaces nothing',
    misplacedTableWarning(d9, d9) === null && misplacedTableWarning(d9, edited9) === null);
  check('giving students more rows misplaces nothing', misplacedTableWarning(d9, { ...d9, rows: '12' }) === null);
  check('removing, adding or reordering a column warns',
    [removeTableColumn(d9, 1), addTableColumn(d9), moveTableColumn(d9, 0, 1)].every((d) =>
      /shift into other columns/.test(misplacedTableWarning(d9, d) ?? '')));
  check('fewer rows warns', /past row 8 will be dropped/.test(misplacedTableWarning(d9, { ...d9, rows: '8' }) ?? ''));
  check('switching the shape away from a saved table warns', misplacedTableWarning(d9, null) !== null);
  check('a question that was no table has nothing to misplace', misplacedTableWarning(null, fresh) === null);

  // (m) One reader of `labels`: every other file goes through engine/fillIn.ts
  // (fillInShape), so none can miss that a table has no labels.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  const labelReaders = [...walk(join(root, 'app/src')), ...walk(join(root, 'server/src'))]
    .filter((f) => /\.labels\b/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f).split('\\').join('/'));
  check('`.labels` is read only in engine/fillIn.ts',
    labelReaders.length === 1 && labelReaders[0] === 'app/src/engine/fillIn.ts');
  for (const f of labelReaders.filter((x) => x !== 'app/src/engine/fillIn.ts')) console.log(`        → ${f}`);
}

// ── Fill-in numerals (task 080) ────────────────────────────────────
// HW1 P12: invent a base-6 counting system — a symbol for each digit, then
// thirty-two in it. No fixed key can exist (the right numeral is the
// student's OWN symbol for five, then for two), so the shape is graded BY
// RULE (engine/fillIn.ts gradeInventedNumeral), one case per box, and
// carries no `fill_in_answers` at all.
console.log('\n[fill-in numerals]');
{
  const hw1 = JSON.parse(
    readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8'),
  ) as AssignmentData;
  const p12 = hw1.questions.find((x) => x.id === 12)!;
  const p11 = hw1.questions.find((x) => x.id === 11)!;
  const p14 = hw1.questions.find((x) => x.id === 14)!;
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
  const SYMBOL_LABELS = WORDS.map((w) => `symbol for ${w}`);

  // (a) The shape: 6 compact symbol boxes named by meaning, then one short
  // box for thirty-two; no key, 7 cases.
  const shape = fillInShape(p12.fill_in!);
  const boxes = shape.kind === 'numeral' ? shape.blanks : [];
  check('HW1 P12 is a numeral: base 6, boxes zero … five then "thirty-two"',
    shape.kind === 'numeral' && shape.base === 6 &&
      boxes.map((b) => b.label).join() === [...WORDS, 'thirty-two'].join());
  check('…sized symbol ×6 then short, none digits-only; plain blanks (P11) stay size "blank"',
    boxes.map((b) => b.size).join() === 'symbol,symbol,symbol,symbol,symbol,symbol,short' &&
      boxes.every((b) => !b.digitsOnly) &&
      fillInShape(p11.fill_in!).kind === 'blanks' && fillInBlanks(p11.fill_in!).every((b) => b.size === 'blank'));
  check('it needs no key (fillInKeyProblem null with none) and refuses one',
    fillInKeyProblem(p12.fill_in!, []) === null && p12.fill_in_answers === undefined &&
      /takes no answer key/.test(fillInKeyProblem(p12.fill_in!, ['x']) ?? ''));
  check('it is no review table, and is graded on 7 cases (with or without a key)',
    !isReviewTable(p12.fill_in, []) && fillInCaseCount(p12.fill_in, []) === 7 && fillInCaseCount(p12.fill_in, undefined) === 7);
  check('the creator drafts it as neither blanks nor a table',
    blankDraftsOf(p12).length === 0 && tableDraftOf(p12) === null && fillInBlanks(p12.fill_in!).length === 0);

  const grade = (answers: string[]) => gradeQuestion(p12, undefined, undefined, answers);
  const score = (r: QuestionResult) => `${r.passed}/${r.total}`;
  const failed = (r: QuestionResult) => (r.fillCases ?? []).filter((c) => !c.pass).map((c) => c.label).join('|');
  const reasonOf = (r: QuestionResult, label: string) => (r.fillCases ?? []).find((c) => c.label === label)?.reason;
  const SYMS = ['a', 'b', 'c', 'd', 'e', 'f'];

  // (b) A sound set and the right numeral: five then two.
  const right = grade([...SYMS, 'fc']);
  check('a sound set and the right numeral ("f" for five, then "c" for two) grade 7/7',
    right.status === 'graded' && score(right) === '7/7' && (right.fillCases ?? []).every((c) => c.reason === undefined));
  check('case labels name the box: "symbol for zero" … "symbol for five", then "thirty-two"',
    (right.fillCases ?? []).map((c) => c.label).join('|') === [...SYMBOL_LABELS, 'thirty-two'].join('|'));

  // (c) A repeated symbol fails both copies; the numeral does not use them.
  const twice = grade(['a', 'a', 'c', 'd', 'e', 'f', 'fc']);
  check('a repeated symbol (zero = one) fails both copies, each naming the other; the numeral still passes',
    score(twice) === '5/7' && failed(twice) === 'symbol for zero|symbol for one' &&
      reasonOf(twice, 'symbol for zero') === 'repeats the symbol for one' &&
      reasonOf(twice, 'symbol for one') === 'repeats the symbol for zero');

  // (d) A digit, (e) two characters.
  const digit = grade(['a', 'b', 'c', '3', 'e', 'f', 'fc']);
  check('"3" as the symbol for three fails: a digit',
    failed(digit) === 'symbol for three' && reasonOf(digit, 'symbol for three') === 'is a digit');
  // A digit in disguise is still a digit: the keycap emoji (5 + VS16 +
  // U+20E3), fullwidth (what a CJK IME types), 5 + an invisible variation
  // selector, 5 + a combining accent, circled, mathematical bold, and another
  // script's five (Arabic-Indic) — each fails as the symbol for five.
  const DISGUISED = ['5\uFE0F\u20E3', '\uFF15', '5\uFE0F', '5\u0301', '\u2464', '\u{1D7D3}', '\u0665'];
  const disguisedOk = DISGUISED.map((five) => grade(['a', 'b', 'c', 'd', 'e', five, `${five}c`]))
    .every((r) => failed(r) === 'symbol for five|thirty-two' && reasonOf(r, 'symbol for five') === 'is a digit' &&
      reasonOf(r, 'thirty-two') === 'uses the invalid symbol for five');
  check('a disguised digit fails as a symbol: keycap 5\uFE0F\u20E3, fullwidth \uFF15, 5+VS16, 5+accent, \u2464, \u{1D7D3}, Arabic-Indic \u0665',
    disguisedOk);
  const fullwidth = grade(['\uFF10', '\uFF11', '\uFF12', '\uFF13', '\uFF14', '\uFF15', '\uFF15\uFF12']);
  const keycaps = grade([0, 1, 2, 3, 4, 5].map((d) => `${d}\uFE0F\u20E3`).concat('5\uFE0F\u20E32\uFE0F\u20E3'));
  check('the digits 0\u20135 handed in fullwidth or as keycap emoji grade 0/7, not 7/7',
    score(fullwidth) === '0/7' && score(keycaps) === '0/7');
  check('\u2026while a non-digit keycap (#\uFE0F\u20E3), an accented letter (\u00E9) and a digit-like letter (O) stay sound symbols',
    score(grade(['#\uFE0F\u20E3', '\u00E9', 'O', 'd', 'e', 'f', 'fO'])) === '7/7');
  const pair = grade(['a', 'b', 'c', 'ab', 'e', 'f', 'fc']);
  check('"ab" as a symbol fails: two characters',
    failed(pair) === 'symbol for three' && reasonOf(pair, 'symbol for three') === 'is 2 characters');

  // (f) The numeral in the wrong order.
  const swapped = grade([...SYMS, 'cf']);
  check('the numeral in the wrong order (two then five) fails',
    failed(swapped) === 'thirty-two' && reasonOf(swapped, 'thirty-two') === 'is not your five then two');
  check('…as does a different numeral, or the digits "52"',
    failed(grade([...SYMS, 'fcc'])) === 'thirty-two' && failed(grade([...SYMS, '52'])) === 'thirty-two');

  // (g) Whitespace.
  check('whitespace inside the numeral is ignored (" f  c ", "f\tc")',
    score(grade([...SYMS, ' f  c '])) === '7/7' && score(grade([...SYMS, 'f\tc'])) === '7/7');
  check('surrounding spaces on a symbol are ignored', score(grade([' a ', 'b ', ' c', 'd', 'e', ' f', 'fc'])) === '7/7');

  // (h) One character = one grapheme: emoji with a skin tone, a ZWJ family.
  const EMOJI = ['a', 'b', '👨‍👩‍👧', 'd', 'e', '👍🏽'];
  const emoji = grade([...EMOJI, '👍🏽 👨‍👩‍👧']);
  check('"👍🏽" and "👨‍👩‍👧" are one character each, and a numeral built of them passes 7/7',
    score(emoji) === '7/7');
  check('…while two emoji in one box are two characters',
    reasonOf(grade(['a', 'b', 'c', 'd', 'e', '👍🏽👍🏽', '']), 'symbol for five') === 'is 2 characters');
  check('a decomposed "é" symbol matches a precomposed "é" in the numeral (NFC, joined)',
    score(grade(['a', 'b', 'c', 'd', 'e', 'e\u0301', '\u00e9c'])) === '7/7');

  // (i) Empty boxes fail, never pending.
  const none = grade([]);
  check('no answers at all: graded 0/7, every box "is empty" but the numeral, whose symbols are unsound',
    none.status === 'graded' && score(none) === '0/7' &&
      SYMBOL_LABELS.every((l) => reasonOf(none, l) === 'is empty') &&
      reasonOf(none, 'thirty-two') === 'uses the invalid symbol for five');
  check('a short answer array (no numeral typed) fails the numeral: "is empty"',
    score(grade(SYMS)) === '6/7' && reasonOf(grade(SYMS), 'thirty-two') === 'is empty');
  check('an empty symbol box fails', failed(grade(['', 'b', 'c', 'd', 'e', 'f', 'fc'])) === 'symbol for zero');

  // (j) The numeral needs its symbols sound, whatever it says.
  const unsound = grade(['a', 'b', 'c', 'd', 'e', 'ab', 'abc']);
  const unsoundCase = (unsound.fillCases ?? []).find((c) => c.label === 'thirty-two')!;
  check('with "ab" for five, "abc" (literally ab then c) still fails the numeral, expecting nothing',
    failed(unsound) === 'symbol for five|thirty-two' && unsoundCase.expected === '' &&
      unsoundCase.reason === 'uses the invalid symbol for five');

  // (k) Case matters.
  check('"a" and "A" are two different symbols', score(grade(['a', 'A', 'c', 'd', 'e', 'f', 'fc'])) === '7/7');
  check('…so "FC" is not "fc"', failed(grade([...SYMS, 'FC'])) === 'thirty-two');

  // (l) A label names a box, never an answer.
  const typed = [...SYMS, 'fc'];
  check('no case label equals anything typed',
    (right.fillCases ?? []).every((c) => !typed.includes(c.label)));
  check('instructor detail: a symbol expects "a new symbol", the numeral the student\'s own spelling',
    (right.fillCases ?? []).slice(0, 6).every((c, i) => c.expected === 'a new symbol' && c.got === SYMS[i]) &&
      (right.fillCases ?? [])[6].expected === 'fc' && (right.fillCases ?? [])[6].got === 'fc');

  // (m) Submit → graded, from the copy a student is sent.
  const studentHw1 = stripAnswers(hw1);
  const s12 = studentHw1.questions.find((x) => x.id === 12)!;
  check('the student copy keeps the numeral whole (base and numbers are prompts) and an empty key',
    canonicalJson(s12.fill_in) === canonicalJson(p12.fill_in) && s12.fill_in_answers?.length === 0 &&
      fillInCaseCount(s12.fill_in, s12.fill_in_answers) === 7);
  const built = buildSubmission(studentHw1, new Map([[12, { ...emptyQuestionCircuit(), fillAnswers: [...EMOJI, '👍🏽👨‍👩‍👧'] }]]),
    { student: 'numeral@example.com', submittedAt: NOW_ISO });
  check('buildSubmission from the stripped HW1 → gradeSubmission grades P12 7/7',
    built.answers.find((a) => a.questionId === 12)?.fillAnswers?.length === 7 &&
      gradeSubmission(hw1, built).questions.find((r) => r.questionId === 12)?.passed === 7);

  // The demo seed follows the shape: its P12 answers are boxes, not prose —
  // the worked one (! ? & % $ ~, "~&") 7/7, the ran-out-of-time one partial.
  const seedSubs = JSON.parse(
    readFileSync(new URL('../src/devData/homeworks/submissions/hw1.json', import.meta.url), 'utf8'),
  ) as SubmissionData[];
  const seedP12 = seedSubs.flatMap((s) => {
    const a = s.answers.find((x) => x.questionId === 12);
    return a ? [{ a, r: gradeSubmission(hw1, s).questions.find((r) => r.questionId === 12)! }] : [];
  });
  check('the HW1 sample submissions answer P12 in its boxes (no responseText): the worked one 7/7, the other 5/7',
    seedP12.length === 2 && seedP12.every(({ a }) => a.responseText === undefined && a.fillAnswers?.length === 7) &&
      seedP12.map(({ r }) => score(r)).join() === '7/7,5/7');

  // (n) Authoring: the creator's numeral draft.
  const d12 = numeralDraftOf(p12)!;
  const fields12 = fillInNumeralFields(d12);
  check('numeralDraftOf → fillInNumeralFields round-trips HW1 P12 byte-for-byte (canonicalJson), with no key',
    canonicalJson(fields12) === canonicalJson({ fill_in: p12.fill_in }) && !('fill_in_answers' in fields12));
  check('P12 loads as base "6" and one number, 32 "thirty-two"; its N is 7',
    d12.base === '6' && d12.numbers.length === 1 && d12.numbers[0].value === '32' &&
      d12.numbers[0].label === 'thirty-two' && numeralCaseCount(d12) === 7);
  check('a numeral has no blank or table draft; blanks and tables have no numeral draft',
    numeralDraftOf(p11) === null && numeralDraftOf(p14) === null && numeralDraftOf(undefined) === null);
  const nprobs = (d: FillInNumeralDraft) => fillInNumeralProblems(d);
  const withNumber = (d: FillInNumeralDraft, value: string, label: string): FillInNumeralDraft =>
    ({ ...d, numbers: [{ ...newNumeralNumber(), value, label }] });
  check('a sound numeral (P12, a new one filled in) has no problems',
    nprobs(d12).length === 0 && nprobs(withNumber(newNumeralDraft(), '7', ' seven ')).length === 0 &&
      canonicalJson(fillInNumeralFields(withNumber(newNumeralDraft(), ' 7 ', ' seven '))) ===
        canonicalJson({ fill_in: { numeral: { base: 6, numbers: [{ value: 7, label: 'seven' }] } } }));
  check('a base of 1, 17, 6.5, "x" or nothing is named',
    ['1', '17', '6.5', 'x', ' '].every((base) => nprobs({ ...d12, base }).includes('The base must be a whole number from 2 to 16.')));
  check('no numbers is named', nprobs({ ...d12, numbers: [] }).includes('Add at least one number to write.'));
  check('an empty label is named', nprobs(withNumber(d12, '32', ' ')).includes('Number #1 needs a label.'));
  check('a repeated label is named, pointing at the first',
    nprobs({ ...d12, numbers: [d12.numbers[0], { ...newNumeralNumber(), value: '7', label: ' thirty-two ' }] })
      .includes('Number #2 repeats the label "thirty-two" of number #1.'));
  check('a value of -1, 2.5, "x" or nothing is named',
    ['-1', '2.5', 'x', ''].every((value) => nprobs(withNumber(d12, value, 'n')).includes('Number #1 needs a value (a whole number, 0 or more).')));

  // Which edits misplace answers already given (stored box by box).
  check('relabelling a number, changing its value, or appending one misplaces nothing',
    misplacedNumeralWarning(d12, d12) === null &&
      misplacedNumeralWarning(d12, { ...d12, numbers: [{ ...d12.numbers[0], label: '32', value: '33' }, newNumeralNumber()] }) === null &&
      misplacedNumeralWarning(d12, { ...d12, base: ' 6 ' }) === null);
  check('changing the base warns', /Keep the base/.test(misplacedNumeralWarning(d12, { ...d12, base: '5' }) ?? ''));
  check('removing, or moving, a saved number warns, naming it',
    /for "thirty-two" will now sit/.test(misplacedNumeralWarning(d12, { ...d12, numbers: [] }) ?? '') &&
      /for "thirty-two"/.test(misplacedNumeralWarning(d12, { ...d12, numbers: [newNumeralNumber(), d12.numbers[0]] }) ?? ''));
  check('switching the shape away from a saved numeral warns; one that was no numeral has nothing to misplace',
    misplacedNumeralWarning(d12, null) !== null && misplacedNumeralWarning(null, d12) === null);

  // (o) One reader of `numeral`: every other file goes through
  // engine/fillIn.ts (fillInShape), so none can grade it as blanks.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  const numeralReaders = [...walk(join(root, 'app/src')), ...walk(join(root, 'server/src'))]
    .filter((f) => /\.numeral\b/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f).split('\\').join('/'));
  check('`.numeral` is read only in engine/fillIn.ts',
    numeralReaders.length === 1 && numeralReaders[0] === 'app/src/engine/fillIn.ts');
  for (const f of numeralReaders.filter((x) => x !== 'app/src/engine/fillIn.ts')) console.log(`        → ${f}`);
}

// ── Multi-part problems (task 048) ────────────────────────────────
// A problem's parts are questions grouped for display (problemSet.ts
// problemGroups): every part keeps its id, its grading and its 1 point. So
// folding HW1's lettered questions back into problems changed display fields
// only — pinned against the grading projection recorded BEFORE the fold.
console.log('\n[multi-part problems]');
{
  const hw1 = JSON.parse(
    readFileSync(new URL('../src/devData/homeworks/hw1.json', import.meta.url), 'utf8'),
  ) as AssignmentData;
  // Recorded from hw1.json at 3949bc9, before the fold.
  const IDS_BEFORE = '1,2,3,4,5,6,18,19,7,8,9,20,10,21,22,11,12,13,23,14,15,16,17';
  const PROJECTION_BEFORE = '6a9e4d2e1eb25f7bed8f8887ccf345c1280a0a1f63e993fd1c41ff79eb6b016c';
  const SECTIONS_BEFORE = '1,2,3,4,5|6,18,19,7,8,9,20,10,21,22|11,12,13,23,14,15|16,17';
  const DISPLAY = new Set(['statement', 'title', 'hint', 'callouts', 'figures', 'notes', 'label', 'stem', 'closing', 'partOf', 'answerField']);
  // Task 080 made P12 (id 12) an invented-numeral fill-in ON PURPOSE — a new
  // grading field, not fold drift — so its `fill_in` stays out of the
  // projection recorded before the fold ([fill-in numerals] pins it).
  const projection = hw1.questions.map((q) =>
    Object.fromEntries(Object.entries(q).filter(([k]) => !DISPLAY.has(k) && !(q.id === 12 && k === 'fill_in'))));
  check('the HW1 fold kept every question id, in order', hw1.questions.map((q) => q.id).join() === IDS_BEFORE);
  check('…every grading field byte-for-byte (the projection without display fields)',
    toHex(sha256(utf8(canonicalJson(projection)))) === PROJECTION_BEFORE);
  check('…and every section\'s ids', (hw1.sections ?? []).map((x) => x.questionIds.join()).join('|') === SECTIONS_BEFORE);
  const p12 = hw1.questions.find((x) => x.id === 12)!;
  check('…the one grading field since: P12\'s invented numeral (task 080), no key',
    !!p12.fill_in && fillInShape(p12.fill_in).kind === 'numeral' && p12.fill_in_answers === undefined);
  check('…while 23 questions read as 17 problems', problemGroups(hw1).length === 17 && hw1.questions.length === 23);
  check('the new fields carry no answer (the student copy keeps them, minus nothing new)',
    (() => {
      const student = stripAnswers(hw1).questions;
      return hw1.questions.every((q, i) =>
        student[i].partOf === q.partOf && student[i].stem === q.stem && student[i].closing === q.closing && student[i].answerField === q.answerField);
    })());

  // A REVIEW table: a table authored with no key is graded by hand.
  const p9b = hw1.questions.find((x) => x.id === 20)!;
  const review: AssignmentQuestion = { ...p9b, id: 90, fill_in_answers: [] };
  const cells = ['0', '0', '0', '2', '2', '4'];
  check('fillInKeyProblem accepts an empty table key (a review table), isReviewTable names it',
    fillInKeyProblem(review.fill_in!, []) === null && isReviewTable(review.fill_in, []) &&
      !isReviewTable(p9b.fill_in, p9b.fill_in_answers) && !isReviewTable({ labels: ['a'] }, []) && !isReviewTable(undefined, []));
  const pending = gradeQuestion(review, undefined, undefined, cells);
  check('a review table grades pending (0/0, no case, no key to leak)',
    pending.status === 'pending' && pending.total === 0 && pending.cases.length === 0 && pending.fillCases === undefined);
  const reviewAsg: AssignmentData = { id: 'review', title: 'Review', questions: [review] };
  const sub = buildSubmission(reviewAsg, new Map([[90, { ...emptyQuestionCircuit(), fillAnswers: cells }]]), { submittedAt: NOW_ISO });
  const reviewRecord: SubmissionRecord = { assignmentId: 'review', attempt: 1, submittedAt: NOW_ISO, submission: sub, result: gradeSubmission(reviewAsg, sub) };
  const reviewScore = scoreRecord(reviewAsg.questions, reviewRecord, Date.now()).problems[0];
  check('…the submission keeps its cells for the person grading it',
    sub.answers[0].fillAnswers?.join() === cells.join() && reviewRecord.result?.questions[0].status === 'pending');
  check('…and it counts as pending until a person grades it (score.ts untouched)',
    reviewScore.points === null && reviewScore.source === 'pending');
  const keyed = gradeQuestion(p9b, undefined, undefined, ['0', '0', '0', '2', '2', '4']);
  check('a keyed table still grades by script (2 of its 9 key rows here)', keyed.status === 'graded' && keyed.passed === 2 && keyed.total === 9);
  const p11 = hw1.questions.find((x) => x.id === 11)!;
  check('blanks with no key still skip (never pending)',
    gradeQuestion({ ...p11, fill_in_answers: [] }, undefined, undefined, ['0']).status === 'skipped');
}

// ── Authoring a turbot arena family (task 010) ─────────────────────
// The creator's arenas are drafts (instructor/turbotCaseAuthoring.ts), one per
// `turbot_cases` entry, each with its own criterion and step budget. Arenas are
// the problem statement (the server keeps them whole for students); grading
// requires every one to pass, and results are positional.
console.log('\n[turbot arena authoring]');
{
  const readHw = (n: number) => JSON.parse(
    readFileSync(new URL(`../src/devData/homeworks/hw${n}.json`, import.meta.url), 'utf8'),
  ) as AssignmentData;
  const hws = [1, 2, 3, 4, 5, 6, 7].map(readHw);

  // (1) A no-op creator edit reproduces every arena family exactly —
  // canonicalJson is the homework sync's own comparison. (The old creator
  // kept only turbot_cases[0], so saving any HW family dropped arenas 2+.)
  const hwTurbots = hws.flatMap((a) => a.questions.filter((q) => q.buildMode === 'turbot'));
  const allTurbots = [...assignment.questions.filter((q) => q.buildMode === 'turbot'), ...hwTurbots];
  const drifted = allTurbots.filter((q) => {
    const drafts = turbotCaseDraftsOf(q);
    return drafts.length !== q.turbot_cases!.length ||
      new Set(drafts.map((d) => d.key)).size !== drafts.length ||
      canonicalJson(turbotCasesField(drafts)) !== canonicalJson(q.turbot_cases);
  });
  check(`drafts → turbot_cases round-trips every sample + HW turbot question (${allTurbots.length}; ${hwTurbots.length} HW families)`,
    hwTurbots.length === 10 && drifted.length === 0);
  for (const q of drifted) console.log(`        → ${q.label}`);
  check('every HW family has at least two arenas (none may silently shrink)',
    hwTurbots.every((q) => turbotCaseDraftsOf(q).length >= 2));
  const hw3p14 = hws[2].questions.find((q) => q.id === 14)!;
  check('HW3 P14 loads as three drafts, each with its own arena',
    turbotCaseDraftsOf(hw3p14).length === 3 &&
      turbotCaseDraftsOf(hw3p14).every((d, i) => d.arena === hw3p14.turbot_cases![i].arena));
  check('each saved case is exactly {arena, maxSteps, criterion} (no row key leaks)',
    turbotCasesField(turbotCaseDraftsOf(hw3p14)).every((c) =>
      Object.keys(c).join() === 'arena,maxSteps,criterion'));

  // (2) A new question (or one of another mode) starts with one default arena.
  const isDefault = (ds: TurbotCaseDraft[]) =>
    ds.length === 1 && ds[0].arena.width === 5 && ds[0].arena.height === 5 &&
    ds[0].arena.cells.flat().every((c) => c === 'empty') &&
    ds[0].criterion === 'reach-and-stop' && DEFAULT_CRITERION === 'reach-and-stop' &&
    ds[0].maxSteps === 100 && DEFAULT_MAX_STEPS === 100;
  check('a new question gets one blank 5×5 arena, reach-and-stop, 100 steps',
    isDefault(turbotCaseDraftsOf(undefined)));
  check('...and so does a non-turbot question (or one with an empty family)',
    isDefault(turbotCaseDraftsOf(assignment.questions[0])) &&
      isDefault(turbotCaseDraftsOf({ turbot_cases: [] })));

  // (3) The list operations.
  const family = turbotCaseDraftsOf(hw3p14);
  const tail = { ...family[2], criterion: 'pass-through' as const, maxSteps: 37 };
  const withTail = [family[0], family[1], tail];
  const added = newTurbotCaseDraft(withTail);
  check('a new arena is a blank 5×5 graded like the last arena (criterion + budget)',
    added.arena.width === 5 && added.arena.height === 5 &&
      added.arena.cells.flat().every((c) => c === 'empty') &&
      added.criterion === 'pass-through' && added.maxSteps === 37 &&
      withTail.every((d) => d.key !== added.key));
  const dup = duplicateTurbotCase(family, 0);
  check('duplicate inserts a copy right after the original, with a fresh key',
    dup.drafts.length === 4 && dup.drafts[1].key === dup.key &&
      dup.key !== family[0].key && dup.drafts[0] === family[0] && dup.drafts[2] === family[1] &&
      canonicalJson(turbotCasesField([dup.drafts[1]])) === canonicalJson(turbotCasesField([family[0]])));
  const before = canonicalJson(family[0].arena);
  const copy = dup.drafts[1];
  const free = copy.arena.cells.flatMap((row, y) =>
    row.map((c, x) => ({ c, x, y }))).find((p) =>
    p.c === 'empty' && !(p.x === copy.arena.start.x && p.y === copy.arena.start.y))!;
  const painted = setArenaCell(copy.arena, free.x, free.y, 'block');
  copy.arena.cells[free.y][free.x] = 'goal'; // even a stray in-place write
  copy.arena.start.facing = copy.arena.start.facing === 'N' ? 'S' : 'N';
  check('the copy owns its cells and start: painting or mutating it leaves the original untouched',
    painted.cells[free.y][free.x] === 'block' && canonicalJson(family[0].arena) === before);
  check('removing an arena drops exactly that one',
    removeTurbotCase(family, 1).map((d) => d.key).join() === [family[0].key, family[2].key].join());
  const one = turbotCaseDraftsOf(undefined);
  check('the last arena cannot be removed',
    removeTurbotCase(one, 0).length === 1 && removeTurbotCase(one, 0)[0] === one[0]);
  const moved = moveItem(withTail, 2, 0);
  check('reordering moves an arena with its criterion and budget',
    moved[0] === tail && moved[0].criterion === 'pass-through' && moved[0].maxSteps === 37 &&
      canonicalJson(turbotCasesField(moved)) ===
        canonicalJson(turbotCasesField([tail, family[0], family[1]])));
  check('the active arena is found by key after a reorder, and a stale key falls back to #1',
    turbotCaseIndexOf(moved, tail.key) === 0 && turbotCaseIndexOf(moved, family[0].key) === 1 &&
      turbotCaseIndexOf(moved, -1) === 0);
  check('a row summary reads "W×H · criterion · N steps"',
    describeTurbotCase(tail) === `${tail.arena.width}×${tail.arena.height} · Pass through goal · 37 steps`);

  // (3b) Graded runs are positional (the gradebook's "#k", a student's replay
  // of run k in the CURRENT turbot_cases[k]), so the creator warns — and
  // confirms at save — exactly when a saved arena loses its slot.
  const painted0 = { ...family[0], arena: setArenaCell(family[0].arena, 0, 0, 'block'), maxSteps: 7 };
  check('painting, re-budgeting or re-judging a saved arena where it stands misplaces nothing',
    misplacedArenas(family, [painted0, { ...family[1], criterion: 'pass-through' }, family[2]]).length === 0);
  check('appending an arena (Add, or duplicating the last) misplaces nothing',
    misplacedArenas(family, [...family, newTurbotCaseDraft(family)]).length === 0 &&
      misplacedArenas(family, duplicateTurbotCase(family, 2).drafts).length === 0);
  check('moving arena #3 to the top (↑↑) misplaces all three saved arenas',
    misplacedArenas(family, moveItem(family, 2, 0)).join() === '0,1,2');
  check('swapping arenas #2 and #3 misplaces exactly those two',
    misplacedArenas(family, moveItem(family, 1, 2)).join() === '1,2');
  check('removing arena #2 misplaces it and every arena after it',
    misplacedArenas(family, removeTurbotCase(family, 1)).join() === '1,2');
  check('duplicating arena #1 (an insert before #2) misplaces #2 and #3',
    misplacedArenas(family, duplicateTurbotCase(family, 0).drafts).join() === '1,2');
  check('saving no arenas (the question stops being a turbot) misplaces every saved one',
    misplacedArenas(family, []).join() === '0,1,2');
  check('a new question has no saved arenas to misplace',
    misplacedArenas([], turbotCaseDraftsOf(undefined)).length === 0);
  const arenaWarning = misplacedArenasWarning([1, 2]);
  check('the warning names the saved arenas by number, and counts past five',
    arenaWarning.includes('graded in arenas #2, #3 will') &&
      arenaWarning.includes('"Run this input"') &&
      misplacedArenasWarning([0]).includes('graded in arena #1 will') &&
      misplacedArenasWarning([0, 1, 2, 3, 4, 5, 6]).includes('#1, #2, #3, #4, #5 and 2 more'));

  // (4) What blocks a save, each named by its arena.
  const goalless = { ...one[0] };
  const withGoal = { ...one[0], arena: setArenaCell(one[0].arena, 4, 4, 'goal') };
  check('a sound family has no problems', turbotCaseProblems(family).length === 0);
  check('a goal-less reach-and-stop arena is named by its number',
    turbotCaseProblems([withGoal, { ...goalless, criterion: 'reach-and-stop' }])
      .includes('Arena #2: this success criterion needs at least one goal cell.'));
  check('...and so is a goal-less pass-through arena',
    turbotCaseProblems([withGoal, { ...goalless, criterion: 'pass-through' }])
      .some((p) => p.startsWith('Arena #2:')));
  check('a goal-less return-to-start arena is sound',
    turbotCaseProblems([withGoal, { ...goalless, criterion: 'return-to-start' }]).length === 0);
  check('zero arenas cannot be saved',
    turbotCaseProblems([]).join() === 'A turbot question needs at least one arena.');
  check('a step budget below 1 (or fractional) is named',
    turbotCaseProblems([withGoal, { ...withGoal, maxSteps: 0 }])
      .includes('Arena #2: max steps must be a whole number of at least 1.') &&
      turbotCaseProblems([{ ...withGoal, maxSteps: 2.5 }]).length === 1);

  // (5) An authored 2-arena CC question, built the way the creator builds it
  // (arenaEditing on the drafts): a 1×5 and a 1×3 corridor, goal against the
  // east wall, reach-and-stop.
  const corridor = (d: TurbotCaseDraft, w: number, goalX: number): TurbotCaseDraft =>
    ({ ...d, maxSteps: 20, arena: setArenaCell(resizeArena(d.arena, w, 1), goalX, 0, 'goal') });
  const first = corridor(turbotCaseDraftsOf(undefined)[0], 5, 4);
  const authoredDrafts = [first, corridor(newTurbotCaseDraft([first]), 3, 2)];
  const turbotQ = (cases: TurbotCaseDraft[]): AssignmentQuestion => ({
    id: 1,
    label: 'Problem 1',
    statement: 'Walk forward until blocked, then stop.',
    buildMode: 'turbot',
    representation: 'binary',
    innerMode: 'CC',
    turbot_cases: turbotCasesField(cases),
  });
  const authoredOf = (cases: TurbotCaseDraft[]): AssignmentData =>
    ({ id: 'authored-turbot', title: 'Authored', questions: [turbotQ(cases)] });
  const authored = authoredOf(authoredDrafts);
  check('the authored family is two corridors graded reach-and-stop in 20 steps',
    canonicalJson(authored.questions[0].turbot_cases!.map((c) => [c.arena.width, c.arena.height, c.criterion, c.maxSteps])) ===
      canonicalJson([[5, 1, 'reach-and-stop', 20], [3, 1, 'reach-and-stop', 20]]));
  const studentCopy = stripAnswers(authored);
  check('the student copy keeps both arenas unchanged (they are the statement, not a key)',
    canonicalJson(studentCopy.questions[0].turbot_cases) ===
      canonicalJson(authored.questions[0].turbot_cases));

  const gradeAgainst = (def: AssignmentData, brain: ReturnType<typeof turbotCorrect>) => {
    const circuits = new Map([[1, { ...emptyQuestionCircuit(), ...brain }]]);
    const built = buildSubmission(stripAnswers(def), circuits, { student: 'turbot@example.com', submittedAt: NOW_ISO });
    return gradeSubmission(def, built);
  };
  const right = gradeAgainst(authored, turbotCorrect()).questions[0];
  check('the reference brain passes both arenas (2/2, one result per arena)',
    right.status === 'graded' && right.passed === 2 && right.total === 2 &&
      right.turbotCases?.length === 2 && right.turbotCases.every((c) => c.pass));

  // Arena 2's goal moved mid-corridor: the brain walks past it to the wall.
  const midGoal = [authoredDrafts[0], corridor(authoredDrafts[1], 3, 1)];
  midGoal[1] = { ...midGoal[1], arena: setArenaCell(midGoal[1].arena, 2, 0, 'empty') };
  const halfDef = authoredOf(midGoal);
  const half = gradeAgainst(halfDef, turbotCorrect());
  const halfQ = half.questions[0];
  check('with arena 2\'s goal mid-corridor the brain grades 1/2, failing arena 2',
    halfQ.passed === 1 && halfQ.total === 2 &&
      halfQ.turbotCases?.[0].pass === true && halfQ.turbotCases?.[1].pass === false);
  check('...and the question fails as a whole (every arena must pass)',
    autoPoints(halfDef.questions[0], halfQ) === 0);
  check('...unless it sets a ½ rule at 1 of 2 arenas (engine/score.ts)',
    autoPoints({ ...halfDef.questions[0], half_credit_at: 1 }, halfQ) === 0.5);
  const wrong = gradeAgainst(authored, turbotIncorrect()).questions[0];
  check('a brain that never leaves the start fails both arenas (0/2)',
    wrong.passed === 0 && wrong.total === 2 && wrong.turbotCases?.length === 2);
  const reversed = gradeAgainst(authoredOf([...midGoal].reverse()), turbotCorrect()).questions[0];
  check('reversing the arenas reverses the results (turbotCases[k] is turbot_cases[k])',
    canonicalJson(reversed.turbotCases) === canonicalJson([...(halfQ.turbotCases ?? [])].reverse()) &&
      reversed.turbotCases?.[0].pass === false && reversed.turbotCases?.[1].pass === true);

  // (6) No single-arena path may come back into the creator: every case goes
  // through the drafts, in and out.
  const creator = readFileSync(new URL('../src/instructor/QuestionCreator.tsx', import.meta.url), 'utf8');
  check('QuestionCreator reads and writes turbot_cases only through the drafts',
    !creator.includes('turbot_cases?.[') && !creator.includes('turbot_cases: [') &&
      creator.includes('turbotCaseDraftsOf(existingQuestion)') &&
      creator.includes('turbot_cases: turbotCasesField(caseDrafts)'));
  check('...and guards the saved arenas\' slots: warned in the list, confirmed at save',
    creator.includes('misplacedArenas(savedArenas, isTurbot ? caseDrafts : [])') &&
      creator.includes('misplacedArenasWarning(misplacedRuns)') &&
      creator.includes('saved={savedArenas}'));
}

// ── The student's own grade sheet (gradeDisplay.problemVerdict) ────
// What a student is told about each problem: its points (engine/score.ts)
// and how they came about. The load-bearing cases are the ones that must NOT
// read as a failure: no result at all, and a problem still awaiting review.
console.log('\n[student grade sheet]');
{
  const q = (over: Partial<QuestionResult>): QuestionResult =>
    ({ questionId: 1, status: 'graded', passed: 0, total: 0, cases: [], ...over });
  const p = (over: Partial<ProblemScore>): ProblemScore =>
    ({ questionId: 1, points: null, source: 'pending', autoPoints: null, ...over });

  check('no result at all is not a failure', problemVerdict(undefined, undefined).tone === 'none');
  check('awaiting review is pending, not failed',
    problemVerdict(p({}), q({ status: 'pending' })).tone === 'pending' &&
    problemVerdict(p({}), q({ status: 'pending' })).text === 'Awaiting review');
  check('full credit reads with its points and the count',
    problemVerdict(p({ points: 1, source: 'auto', autoPoints: 1 }), q({ passed: 4, total: 4 })).tone === 'pass' &&
    problemVerdict(p({ points: 1, source: 'auto', autoPoints: 1 }), q({ passed: 4, total: 4 })).text === '1 point — 4/4');
  check('half credit by the rule reads as ½',
    problemVerdict(p({ points: 0.5, source: 'auto-half', autoPoints: 0.5 }), q({ passed: 1, total: 2 })).tone === 'half' &&
    problemVerdict(p({ points: 0.5, source: 'auto-half', autoPoints: 0.5 }), q({ passed: 1, total: 2 })).text === '½ point — 1/2');
  check('some cases failed shows 0 points and the count',
    problemVerdict(p({ points: 0, source: 'auto', autoPoints: 0 }), q({ passed: 3, total: 4 })).tone === 'fail' &&
    problemVerdict(p({ points: 0, source: 'auto', autoPoints: 0 }), q({ passed: 3, total: 4 })).text === '0 points — 3/4');
  check('a reviewed problem says so',
    problemVerdict(p({ points: 1, source: 'human' }), q({ status: 'pending' })).text === '1 point (reviewed)' &&
    problemVerdict(p({ points: 0, source: 'human' }), q({ status: 'pending' })).tone === 'fail');
}

// ─── The group listing at submit (task 062): the one rule, submissionGroup.ts ───
console.log('\n[group listing]');
{
  const roster = new Set(['k-ann', 'k-bo', 'k-cy', 'k-self']);
  const ok = (raw: unknown) => { const r = checkGroup(raw, roster, 'k-self'); return r.ok ? r.group : null; };
  check('absent, null or empty is "no group"', JSON.stringify([ok(undefined), ok(null), ok([])]) === '[[],[],[]]');
  check('one or two roster students are accepted, in order', JSON.stringify(ok(['k-bo', 'k-ann'])) === '["k-bo","k-ann"]');
  check(`more than ${MAX_GROUP_OTHERS} is refused (groups are at most 3, the submitter included)`,
    MAX_GROUP_OTHERS === 2 && ok(['k-ann', 'k-bo', 'k-cy']) === null);
  check('self, a duplicate, a non-roster key, a non-string and a non-list are each refused',
    [['k-self'], ['k-ann', 'k-ann'], ['k-zed'], [7], 'k-ann'].every((raw) => ok(raw) === null));
  const refusal = checkGroup(['k-self'], roster, 'k-self');
  check('a refusal carries a reason a student can act on', !refusal.ok && /yourself/.test(refusal.error));
  const def = buildSampleAssignment();
  const empty = new Map<number, ReturnType<typeof emptyQuestionCircuit>>();
  check('buildSubmission carries a listed group, and omits the field when none is listed',
    JSON.stringify(buildSubmission(def, empty, { submittedAt: NOW_ISO, group: ['k-ann'] }).group) === '["k-ann"]' &&
    !('group' in buildSubmission(def, empty, { submittedAt: NOW_ISO, group: [] })));
  check('the grader never reads the group: a listed group grades identically',
    JSON.stringify(gradeSubmission(def, buildSubmission(def, empty, { submittedAt: NOW_ISO, group: ['k-ann'] }))) ===
    JSON.stringify(gradeSubmission(def, buildSubmission(def, empty, { submittedAt: NOW_ISO }))));
}

// ─── Extensions and waivers, local mode (task 068) ───────────────────────
console.log('\n[local extensions/waivers]');
{
  const mem = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
  let fetches = 0;
  (globalThis as unknown as Record<string, unknown>).fetch = () => {
    fetches++;
    return Promise.reject(new Error('local mode must not fetch'));
  };
  const { backendMode, assignmentStore, gradingStore, submissionStore } = await import('../src/storage/backend');
  const { localSubmissionStore } = await import('../src/storage/submissionStore');
  const { SESSION_KEY, TOY_ACCOUNTS } = await import('../src/auth/accounts');
  check('the harness resolves to the local backend', backendMode === 'local');
  const [john, jane] = TOY_ACCOUNTS.filter((a) => a.role === 'student').map((a) => a.email.toLowerCase());
  const ada = TOY_ACCOUNTS.find((a) => a.role === 'instructor')!.email.toLowerCase();
  const signIn = (email: string) => mem.set(SESSION_KEY, TOY_ACCOUNTS.find((a) => a.email.toLowerCase() === email)!.id);
  signIn(ada);
  // HW1's real due date; John submits Tue Oct 6 at 14:00 — after that lecture ended.
  const DUE = '2026-10-05T06:59:00.000Z';
  const def: AssignmentData = { ...buildSampleAssignment(), id: 'late-local', dueDate: DUE };
  const old: AssignmentData = { ...def, id: 'late-local-past', dueDate: '2026-01-01T00:00:00.000Z' };
  await assignmentStore.save(def);
  await assignmentStore.save(old);
  const sub = { ...buildCorrectSubmission(john), submittedAt: '2026-10-06T21:00:00.000Z' };
  const record: SubmissionRecord = { assignmentId: def.id, attempt: 1, submittedAt: sub.submittedAt, submission: sub, result: gradeSubmission(def, sub) };
  mem.set(`mm:sub:${def.id}`, JSON.stringify([record]));
  const rowOf = async (id: string, key: string) => (await gradingStore.summary(id))!.rows.find((r) => r.student.key === key)!;

  const priced = await rowOf(def.id, john);
  check('the row is priced by the bundled calendar: 1 meeting ended → −10',
    priced.latest?.late.late === true && priced.latest.late.units === 1 && priced.latest.late.deduction === 10);
  check('Jane, past an old due date with nothing submitted, is Missing', (await rowOf(old.id, jane)).grade.missing);

  const w = await gradingStore.setWaiver(def.id, john, { points: 5, note: 'granted' });
  const netted = await rowOf(def.id, john);
  check('a waiver nets the deduction to −5', w.ok && netted.latest?.late.deduction === 5 && netted.waived === 5);
  const bad = await gradingStore.setWaiver(def.id, john, { points: 0 });
  const unknown = await gradingStore.setExtension(def.id, 'nobody@example.com', DUE);
  check('bad points and an unknown student are refused', !bad.ok && !unknown.ok);

  const e = await gradingStore.setExtension(def.id, john, '2026-10-09T06:59:00.000Z');
  const onTime = await rowOf(def.id, john);
  check('an extension: the row is on time against it', e.ok && onTime.extendedTo === '2026-10-09T06:59:00.000Z' &&
    onTime.latest?.late.late === false && onTime.latest.late.deduction === null);
  await gradingStore.setExtension(old.id, jane, '2099-01-01T00:00:00.000Z');
  check('…and clears Missing', !(await rowOf(old.id, jane)).grade.missing);
  const detail = (await gradingStore.attempt(def.id, john, 1))!;
  check('the attempt detail carries the effective due date, the extension and the waiver',
    detail.due === '2026-10-09T06:59:00.000Z' && detail.extension?.setBy === ada && detail.waiver?.note === 'granted');
  const events = localSubmissionStore.gradeLog(def.id);
  check('each write is logged — waiver, extension — with no questionId, the grader as actor',
    events.map((x) => x.kind).join() === 'waiver,extension' && events.every((x) => x.questionId === undefined && x.actor === ada && x.student === john));

  const instructorCopy = (await assignmentStore.get(def.id))!.assignment;
  signIn(john);
  const studentOne = (await assignmentStore.get(def.id))!.assignment;
  const studentRow = (await assignmentStore.list()).find((a) => a.id === def.id)!;
  check("the student's copy and row carry their extended date, marked dueExtended",
    studentOne.dueDate === '2026-10-09T06:59:00.000Z' && studentOne.dueExtended === true &&
      studentRow.dueDate === '2026-10-09T06:59:00.000Z' && studentRow.dueExtended === true);
  check("the instructor's copy is the stored one", instructorCopy.dueDate === DUE && !('dueExtended' in instructorCopy));
  check('before release, no waiver reaches the student', (await submissionStore.listOwn(def.id, john)).every((r) => r.lateWaived === undefined));
  await assignmentStore.setGradesReleased(def.id, true);
  const own = await submissionStore.listOwn(def.id, john);
  check('a released own record carries lateWaived (the points only)',
    own.length === 1 && own[0].lateWaived === 5 && !JSON.stringify(own).includes('granted'));
  check('law 5: no fetch in local mode', fetches === 0);
}

console.log(`\n${failures === 0 ? 'PIPELINE OK' : `PIPELINE FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
