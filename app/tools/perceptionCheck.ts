// Smoke test for the perception engine + grader (engine/perception.ts,
// gradePerception in engine/grader.ts).
//
//   npx tsx tools/perceptionCheck.ts
//
// Covers: the rule evaluators on known stimuli, case-bank generation shape and
// determinism, and bit-level grading of the sample correct/incorrect circuits
// for all five perception problems (edge, object, landmark, change, motion).
//
// And the SC perception frame player (task 012): a film of frames is the
// store's scInputSequence as lanes (framesToLanes), and the REAL store's
// clocked run of it — scStep/scRun, headless — IS the grader's run of the
// same frames: the same bits fed, the same output bit per step, from MEMs at
// 0, stopping after the last frame (no sandbox drain step), never reading the
// answer key, never locked.
//
// And task 013: motion rules by direction (up / down / either) and scene
// (single object / any number), their generated banks — today's specs'
// banks byte-for-byte the committed HW2/HW3 ones — the instructor's authored
// films (appended, expected from the rule; perceptionAuthoring's draft),
// grading of the new rules, and "Run this input" for a perception film
// (store loadCaseInput, from a stripped copy too).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  AssignmentData,
  AssignmentQuestion,
  CircuitData,
  MotionDirection,
  MotionScene,
  PerceptionRule,
  QuestionResult,
  SubmissionRecord,
} from '../src/types';
import {
  hasRunAtLeast,
  hasRunExactly,
  singleObjectAt,
  objectStarts,
  describePerceptionRule,
  MAX_FILM_FRAMES,
  expectedPerceptionOutputs,
  buildPerceptionCases,
  perceptionModeFor,
  objectFrame,
  framesToLanes,
  lanesToFrames,
  shiftFrame,
  runPerceptionCase,
  perceptionExamples,
  matchingPerceptionExample,
} from '../src/engine/perception';
import { gradeQuestion } from '../src/engine/grader';
import { gradingCircuit, gradedMachineKey } from '../src/engine/caseRun';
import { gradedCaseView } from '../src/gradeDisplay';
import { stripAnswers, studentRecord } from '../../server/src/sanitize';
import {
  draftFromQuestion,
  draftProblems,
  perceptionFields,
  ruleFromDraft,
  bankSummary,
  newFilm,
  addFilmFrame,
  toggleFilmBit,
  shiftFilmFrame,
  duplicateFilm,
  removeFilm,
  fitFilmToWidth,
  type PerceptionDraft,
} from '../src/instructor/perceptionAuthoring';
import { memorySlots } from '../src/engine/netlist';
import { boxWhole, comp } from './builder';
import { sortByLabel } from '../src/engine';
import {
  perceptionEdgeCorrect, perceptionEdgeIncorrect,
  perceptionObjectCorrect, perceptionObjectIncorrect,
  perceptionLandmarkCorrect, perceptionLandmarkIncorrect,
  perceptionChangeCorrect, perceptionChangeIncorrect,
  perceptionMotionCorrect, perceptionMotionIncorrect,
  perceptionMotionDetector,
} from '../src/devData/sampleData';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const bits = (s: string) => s.split('').map((c) => (c === '1' ? 1 : 0));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── rule evaluators ────────────────────────────────────────────────
console.log('[rule evaluators]');
check('min-run: 00111000 has ≥3', hasRunAtLeast(bits('00111000'), 3));
check('min-run: 11110000 has ≥3', hasRunAtLeast(bits('11110000'), 3));
check('min-run: 00110100 lacks ≥3', !hasRunAtLeast(bits('00110100'), 3));
check('min-run: run at the very end counts', hasRunAtLeast(bits('00000111'), 3));
check('exact-run: 00111000 has =3', hasRunExactly(bits('00111000'), 3));
check('exact-run: 11110000 lacks =3', !hasRunExactly(bits('11110000'), 3));
check('exact-run: 11101110 has =3', hasRunExactly(bits('11101110'), 3));
check('exact-run: 01111011 lacks =3 (runs of 4 and 2)', !hasRunExactly(bits('01111011'), 3));
check('object: 00111000 is one object at 2', singleObjectAt(bits('00111000'), 3) === 2);
check('object: 00111001 is not a single object', singleObjectAt(bits('00111001'), 3) === null);
check('object: 01111000 is not a 3-object', singleObjectAt(bits('01111000'), 3) === null);

const pattern: PerceptionRule = { kind: 'pattern', pattern: '110010111' };
check('pattern: exact match → 1',
  expectedPerceptionOutputs(pattern, [bits('110010111')])[0] === 1);
check('pattern: one bit off → 0',
  expectedPerceptionOutputs(pattern, [bits('110010110')])[0] === 0);

const change: PerceptionRule = { kind: 'change' };
const A = bits('10100000');
const B = bits('10100001');
check('change: [A,A,B,B] → 1,0,1,0 (onset from blank counts)',
  expectedPerceptionOutputs(change, [A, A, B, B]).join('') === '1010');
check('change: blank first frame → 0',
  expectedPerceptionOutputs(change, [bits('00000000'), A]).join('') === '01');

const motion: PerceptionRule = { kind: 'motion', objectLength: 3 };
const up = [objectFrame(8, 3, 5), objectFrame(8, 3, 4), objectFrame(8, 3, 3)];
check('motion: upward climb → 0 then 1s',
  expectedPerceptionOutputs(motion, up).join('') === '011');
check('motion: downward drift → all 0',
  expectedPerceptionOutputs(motion, [...up].reverse()).join('') === '000');
check('motion: static object → all 0',
  expectedPerceptionOutputs(motion, [objectFrame(8, 3, 4), objectFrame(8, 3, 4)]).join('') === '00');

// ── case generation ────────────────────────────────────────────────
console.log('\n[case generation]');
const edgeCases = buildPerceptionCases({ rule: { kind: 'min-run', runLength: 3 }, width: 8 });
check('CC bank enumerates all 2^8 frames', edgeCases.length === 256);
check('CC cases are single-frame', edgeCases.every((c) => c.frames.length === 1 && c.expected.length === 1));
check('CC bank has both classes',
  edgeCases.some((c) => c.expected[0] === 1) && edgeCases.some((c) => c.expected[0] === 0));

const changeCases = buildPerceptionCases({ rule: change, width: 8 });
check('SC bank is multi-frame', changeCases.length > 0 && changeCases.every((c) => c.frames.length >= 2));
check('SC expected parallels frames', changeCases.every((c) => c.expected.length === c.frames.length));
const changeCases2 = buildPerceptionCases({ rule: change, width: 8 });
check('SC bank is deterministic', JSON.stringify(changeCases) === JSON.stringify(changeCases2));

const motionCases = buildPerceptionCases({ rule: motion, width: 8 });
check('motion bank has a passing sequence', motionCases.some((c) => c.expected.includes(1)));
check('motion bank has all-negative sequences', motionCases.some((c) => !c.expected.includes(1)));

check('perceptionModeFor: runs/pattern → CC, change/motion → SC',
  perceptionModeFor({ kind: 'min-run', runLength: 3 }) === 'CC' &&
  perceptionModeFor(pattern) === 'CC' &&
  perceptionModeFor(change) === 'SC' &&
  perceptionModeFor(motion) === 'SC');

let threw = false;
try {
  buildPerceptionCases({ rule: { kind: 'pattern', pattern: '11' }, width: 8 });
} catch {
  threw = true;
}
check('pattern length must equal width', threw);

// ── task 013: motion by direction and scene ────────────────────────
console.log('\n[motion variants]');
check('objectStarts: maximal runs of exactly k only', same(objectStarts(bits('01110000'), 3), [1]));
check('objectStarts: a k+1 run is not an object', same(objectStarts(bits('11110000'), 3), []));
check('objectStarts: two objects → two starts (top first)', same(objectStarts(bits('11101110'), 3), [0, 4]));
check('objectStarts: an object beside clutter still counts', same(objectStarts(bits('10011100'), 3), [3]));
{
  const m = (direction?: MotionDirection, scene?: MotionScene): PerceptionRule =>
    ({ kind: 'motion', objectLength: 3, ...(direction ? { direction } : {}), ...(scene ? { scene } : {}) });
  const down = [...up].reverse();
  const out = (r: PerceptionRule, f: number[][]) => expectedPerceptionOutputs(r, f).join('');
  check('absent direction/scene reads as up/single (HW3 P12)',
    out(m(), up) === out(m('up', 'single'), up) && out(m(), down) === out(m('up', 'single'), down));
  check('down: a downward drift → 0 then 1s', out(m('down'), down) === '011');
  check('down: an upward climb → all 0', out(m('down'), up) === '000');
  check('either: catches both ways', out(m('either'), up) === '011' && out(m('either'), down) === '011');
  const bounce = [5, 4, 3, 4, 5].map((s) => objectFrame(8, 3, s));
  check('either: a bounce → 1 after t1, every step', out(m('either'), bounce) === '01111');
  check('up / down read the bounce by halves', out(m('up'), bounce) === '01100' && out(m('down'), bounce) === '00011');
  const withClutter = up.map((f) => { const g = [...f]; g[0] = 1; return g; }); // stray bit at IN1; objects at 5,4,3
  check('single scene: an object climbing beside a stray bit → 0', out(m('up', 'single'), withClutter) === '000');
  check('multi scene: the same film → 1 (whatever else is in view)', out(m('up', 'multi'), withClutter) === '011');
  const pairs = [bits('11001100'), bits('01100110')]; // runs of 2: not 3-objects
  check('multi: runs that are not k long never move', out(m('either', 'multi'), pairs) === '00');
  const twoWays = [
    [...objectFrame(9, 3, 0)].map((b, i) => (i >= 6 ? 1 : b)), // objects at 0 and 6
    [...objectFrame(9, 3, 1)].map((b, i) => (i >= 5 && i < 8 ? 1 : b)), // objects at 1 and 5
  ];
  check('multi: two objects moving opposite ways → 1 under up (the one climbing)',
    out(m('up', 'multi'), twoWays) === '01' && out(m('down', 'multi'), twoWays) === '01');
  check('single: the same two objects → 0', out(m('either', 'single'), twoWays) === '00');
  check('describe: direction and scene in words',
    /upwards/.test(describePerceptionRule(m())) && !/whatever/.test(describePerceptionRule(m())) &&
    /downwards/.test(describePerceptionRule(m('down'))) &&
    /up or down 1 unit per unit of time, whatever else is in view/.test(describePerceptionRule(m('either', 'multi'))));
}

// ── bank identity: today's specs build today's banks, byte for byte ─
console.log('\n[bank identity]');
{
  const hwFile = (n: number) =>
    JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../src/devData/homeworks/hw${n}.json`), 'utf8')) as AssignmentData;
  for (const n of [2, 3]) {
    for (const q of hwFile(n).questions.filter((x) => x.perception)) {
      check(`hw${n} #${q.id} (${q.perception!.rule.kind}): buildPerceptionCases(spec) ≡ the committed bank`,
        same(buildPerceptionCases(q.perception!), q.perception_cases));
    }
  }
  const plain = buildPerceptionCases({ rule: { kind: 'motion', objectLength: 3 }, width: 8 });
  check('explicit up/single ≡ absent (the same bank)',
    same(plain, buildPerceptionCases({ rule: { kind: 'motion', objectLength: 3, direction: 'up', scene: 'single' }, width: 8 })));
  for (const direction of ['up', 'down', 'either'] as MotionDirection[]) {
    for (const scene of ['single', 'multi'] as MotionScene[]) {
      for (const [width, k] of [[8, 3], [5, 1], [10, 2], [4, 2]]) {
        const spec = { rule: { kind: 'motion' as const, objectLength: k, direction, scene }, width };
        const bank = buildPerceptionCases(spec);
        const tag = `${direction}/${scene} w${width} k${k}`;
        check(`${tag}: deterministic, positive and all-negative films, ≤ ${MAX_FILM_FRAMES} frames, frames ${width} wide`,
          same(bank, buildPerceptionCases(spec)) &&
          bank.some((c) => c.expected.includes(1)) && bank.some((c) => !c.expected.includes(1)) &&
          bank.every((c) => c.frames.length <= MAX_FILM_FRAMES && c.frames.every((f) => f.length === width)) &&
          bank.every((c) => same(c.expected, expectedPerceptionOutputs(spec.rule, c.frames)) && !c.authored));
        if (direction !== 'up' || scene !== 'single') {
          check(`${tag}: today's upward battery first, unchanged`,
            same(bank.slice(0, 9).map((c) => c.frames),
              buildPerceptionCases({ rule: { kind: 'motion', objectLength: k }, width }).map((c) => c.frames)));
          // Every size, not just w8 k3: the bank passes its own detector and
          // fails each of the five others (the other scene included). up/single
          // is HW3 P12's frozen battery, which at w4 k2 cannot see scenes.
          const q = { id: 1, label: 'P', statement: 's', buildMode: 'SC' as const, representation: 'binary' as const,
            perception: spec, perception_cases: bank };
          const passes = (d: MotionDirection, s: MotionScene) => {
            const g = gradeQuestion(q, perceptionMotionDetector({ width, k, direction: d, scene: s }));
            return g.status === 'graded' && g.passed === g.total;
          };
          check(`${tag}: separates every direction and scene — only its own detector passes`,
            (['up', 'down', 'either'] as MotionDirection[]).every((d) =>
              (['single', 'multi'] as MotionScene[]).every((s) => passes(d, s) === (d === direction && s === scene))));
        }
      }
    }
  }
  const upSingle = gradeQuestion(
    { id: 1, label: 'P', statement: 's', buildMode: 'SC', representation: 'binary', perception: { rule: { kind: 'motion', objectLength: 3, scene: 'multi' }, width: 8 },
      perception_cases: buildPerceptionCases({ rule: { kind: 'motion', objectLength: 3, scene: 'multi' }, width: 8 }) },
    perceptionMotionCorrect());
  check("the multi bank separates the scenes: HW3 P12's single-object detector fails it",
    upSingle.status === 'graded' && upSingle.passed < upSingle.total);
}

// ── authored films ─────────────────────────────────────────────────
console.log('\n[authored films]');
{
  const spec = { rule: { kind: 'motion', objectLength: 3, direction: 'down' } as PerceptionRule, width: 8 };
  const films = [[objectFrame(8, 3, 0), objectFrame(8, 3, 1), objectFrame(8, 3, 2)], [objectFrame(8, 3, 4)]];
  const generated = buildPerceptionCases(spec);
  const bank = buildPerceptionCases(spec, films);
  check('bank = the generated battery ++ the films, in order',
    same(bank.slice(0, generated.length), generated) && bank.length === generated.length + films.length &&
    same(bank.slice(generated.length).map((c) => c.frames), films));
  check('films are marked authored: true; generated cases are not',
    bank.slice(generated.length).every((c) => c.authored === true) && generated.every((c) => c.authored === undefined));
  check("an authored film's expected comes from the rule",
    same(bank[generated.length].expected, [0, 1, 1]) && same(bank[generated.length + 1].expected, [0]));
  // A caller's bogus expected never reaches the bank: only frames go in.
  const bogus = films.map((f) => Object.assign([...f], { expected: [1, 1, 1] })) as number[][][];
  check('whatever the caller holds, expected is recomputed', same(buildPerceptionCases(spec, bogus), bank));
  check('the films are copied, not aliased', bank[generated.length].frames[0] !== films[0][0]);
  const throws = (fn: () => unknown): string | null => { try { fn(); return null; } catch (e) { return (e as Error).message; } };
  check('throws: a frame of the wrong width', /film 1: frame t1 has 7 bits/.test(throws(() => buildPerceptionCases(spec, [[bits('0000000')]])) ?? ''));
  check('throws: a non-bit', /not 0 or 1/.test(throws(() => buildPerceptionCases(spec, [[[0, 0, 0, 0, 0, 0, 0, 2]]])) ?? ''));
  check('throws: an empty film', /at least one frame/.test(throws(() => buildPerceptionCases(spec, [[]])) ?? ''));
  check(`throws: more than ${MAX_FILM_FRAMES} frames`,
    /at most 24/.test(throws(() => buildPerceptionCases(spec, [Array.from({ length: 25 }, () => objectFrame(8, 3, 0))])) ?? ''));
  check('throws: films on a CC rule (its bank is exhaustive)',
    /SC rules only/.test(throws(() => buildPerceptionCases({ rule: { kind: 'min-run', runLength: 3 }, width: 8 }, [[bits('00000000')]])) ?? ''));
  check('throws: an unknown direction / scene',
    throws(() => buildPerceptionCases({ rule: { kind: 'motion', objectLength: 3, direction: 'left' as MotionDirection }, width: 8 })) !== null &&
    throws(() => buildPerceptionCases({ rule: { kind: 'motion', objectLength: 3, scene: 'crowd' as MotionScene }, width: 8 })) !== null);
  check(`a film of exactly ${MAX_FILM_FRAMES} frames and one of 1 frame are fine`,
    throws(() => buildPerceptionCases(spec, [Array.from({ length: 24 }, () => objectFrame(8, 3, 0)), [objectFrame(8, 3, 0)]])) === null);

  // The draft (instructor/perceptionAuthoring.ts) round-trips through a save.
  const draftFilms = films.map((frames) => ({ frames, example: false }));
  const draft: PerceptionDraft = {
    kind: 'motion', width: 8, runLength: 3, pattern: '', direction: 'either', scene: 'multi', films: draftFilms,
  };
  const saved = perceptionFields(draft, 'SC');
  const back = draftFromQuestion(saved);
  check('draft → save → draft keeps the rule and the films', same(back, draft));
  check('the saved bank ≡ buildPerceptionCases(spec, films)',
    same(saved.perception_cases, buildPerceptionCases(saved.perception, films)));
  check('ruleFromDraft omits direction/scene at up/single (HW3 P12 stays hash-stable)',
    same(ruleFromDraft({ ...draft, direction: 'up', scene: 'single' }, 'SC'), { kind: 'motion', objectLength: 3 }) &&
    same(ruleFromDraft(draft, 'SC'), { kind: 'motion', objectLength: 3, direction: 'either', scene: 'multi' }));
  const hw3 = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/devData/homeworks/hw3.json'), 'utf8')) as AssignmentData;
  const p12 = hw3.questions.find((q) => q.id === 12)!;
  check('HW3 P12 opened and saved unchanged: the same two fields, byte for byte',
    same(perceptionFields(draftFromQuestion(p12), 'SC'), { perception: p12.perception, perception_cases: p12.perception_cases }));
  const summary = bankSummary(draft, 'SC');
  check('bankSummary counts generated + authored',
    summary !== null && summary.authored === 2 && summary.generated === buildPerceptionCases(saved.perception).length && summary.positives > 0);
  check('draftProblems: none for a sound draft', draftProblems(draft, 'SC').length === 0);
  check('draftProblems: a film of the wrong width is named',
    /Film 2: frame t1 has 6 bits/.test(draftProblems({ ...draft, films: [draftFilms[0], { frames: [bits('000000')], example: false }] }, 'SC').join(' ')));
  check('draftProblems: an empty film', /Film 1: a film needs at least one frame/.test(draftProblems({ ...draft, films: [{ frames: [], example: false }] }, 'SC').join(' ')));
  check('draftProblems: films on a CC rule', /films are for SC rules/.test(draftProblems({ ...draft, kind: 'min-run' }, 'CC').join(' ')));
  check('draftProblems: object length past the retina', /object length/.test(draftProblems({ ...draft, runLength: 9 }, 'SC').join(' ')));
  check('a mode flip coerces the kind (CC → min-run), films ignored for the CC save',
    ruleFromDraft(draft, 'CC').kind === 'min-run');
  // Film edits.
  let f = newFilm(8);
  check('newFilm: two blank frames', f.length === 2 && f.every((x) => same(x, Array(8).fill(0))));
  f = toggleFilmBit(f, 1, 7);
  check('toggleFilmBit flips one bit', f[1][7] === 1 && f[0][7] === 0);
  f = shiftFilmFrame(f, 1, 'up');
  check('shiftFilmFrame up moves toward IN1', f[1][6] === 1 && f[1][7] === 0);
  const full = Array.from({ length: MAX_FILM_FRAMES }, () => objectFrame(8, 3, 0));
  check(`addFilmFrame copies the newest, never past ${MAX_FILM_FRAMES}`,
    same(addFilmFrame(f, 8)[2], f[1]) && addFilmFrame(full, 8).length === MAX_FILM_FRAMES);
  check('duplicateFilm / removeFilm', duplicateFilm(draftFilms, 0).length === 3 && same(removeFilm(draftFilms, 0), [draftFilms[1]]));
  check('fitFilmToWidth pads / cuts at the bottom', same(fitFilmToWidth([bits('111')], 5), [bits('11100')]) && same(fitFilmToWidth([bits('11101')], 3), [bits('111')]));
}

// ── example films (task 059) ───────────────────────────────────────
// A film flagged "Example for students" is marked `example: true` inside the
// (stripped) bank and derived, at save, into its own student-visible field
// `perception_examples` ({frames, expected}, no flags). The grader never
// reads that field.
console.log('\n[example films]');
{
  const spec = { rule: { kind: 'motion', objectLength: 3, direction: 'down' } as PerceptionRule, width: 8 };
  const filmA = [objectFrame(8, 3, 0), objectFrame(8, 3, 1), objectFrame(8, 3, 2)];
  const filmB = [objectFrame(8, 3, 4), objectFrame(8, 3, 3)];
  const filmC = [objectFrame(8, 3, 2)];
  const generated = buildPerceptionCases(spec);
  const bank = buildPerceptionCases(spec, [filmA, filmB, filmC], [0, 2]);
  check('exampleIdx marks exactly those authored cases example: true',
    same(bank.slice(generated.length).map((c) => c.example === true), [true, false, true]));
  check('generated cases are never examples', bank.slice(0, generated.length).every((c) => c.example === undefined));
  check('no exampleIdx: no case is an example', buildPerceptionCases(spec, [filmA]).every((c) => c.example === undefined));
  const throws = (fn: () => unknown): string | null => { try { fn(); return null; } catch (e) { return (e as Error).message; } };
  check('throws: an example index past the films', /example film 3 does not exist/.test(throws(() => buildPerceptionCases(spec, [filmA, filmB], [2])) ?? ''));
  const examples = perceptionExamples(bank);
  check('perceptionExamples = the flagged films, in order, expected from the rule',
    same(examples, [
      { frames: filmA, expected: expectedPerceptionOutputs(spec.rule, filmA) },
      { frames: filmC, expected: expectedPerceptionOutputs(spec.rule, filmC) },
    ]));
  check('examples carry no flag keys', examples.every((ex) => same(Object.keys(ex).sort(), ['expected', 'frames'])));
  const flagged = bank[generated.length];
  check('examples are copies, not aliases',
    examples[0].frames !== flagged.frames && examples[0].frames[0] !== flagged.frames[0] && examples[0].expected !== flagged.expected);
  check('perceptionExamples of an unflagged bank is empty', perceptionExamples(buildPerceptionCases(spec, [filmA])).length === 0);

  // The draft round-trips the flags.
  const draft: PerceptionDraft = {
    kind: 'motion', width: 8, runLength: 3, pattern: '', direction: 'down', scene: 'single',
    films: [{ frames: filmA, example: false }, { frames: filmB, example: true }],
  };
  const saved = perceptionFields(draft, 'SC');
  check('perceptionFields: perception_examples = the flagged film + its rule expected',
    same(saved.perception_examples, [{ frames: filmB, expected: expectedPerceptionOutputs(spec.rule, filmB) }]));
  check('perceptionFields: the bank flags the film', same(saved.perception_cases.slice(generated.length).map((c) => c.example === true), [false, true]));
  check('draft → save → draft keeps the example flags', same(draftFromQuestion(saved), draft));
  const none = perceptionFields({ ...draft, films: draft.films.map((f) => ({ ...f, example: false })) }, 'SC');
  check('no flagged film: the perception_examples key is absent', !('perception_examples' in none));
  check('a CC rule (no films): no perception_examples', !('perception_examples' in perceptionFields({ ...draft, kind: 'min-run' }, 'CC')));
  const p12 = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/devData/homeworks/hw3.json'), 'utf8'))
    .questions.find((q: AssignmentQuestion) => q.id === 12) as AssignmentQuestion;
  const p12Saved = perceptionFields(draftFromQuestion(p12), 'SC');
  check("HW3 P12 no-op edit: no perception_examples key, the committed fields unchanged (content hash stable)",
    !('perception_examples' in p12Saved) && same(p12Saved, { perception: p12.perception, perception_cases: p12.perception_cases }));
  const summary = bankSummary(draft, 'SC');
  check('bankSummary counts the examples', summary !== null && summary.examples === 1 && summary.authored === 2);
  // Film list edits keep the flag with its film.
  const dup = duplicateFilm(draft.films, 1);
  check('duplicateFilm copies the flag (and the frames deeply)',
    dup.length === 3 && dup[2].example === true && same(dup[2].frames, filmB) && dup[2].frames[0] !== filmB[0]);
  const removed = removeFilm(draft.films, 0);
  check('removeFilm keeps the others aligned with their flags', same(removed, [{ frames: filmB, example: true }]));
  // The player's expected-row match.
  check('matchingPerceptionExample: a hit', matchingPerceptionExample(examples, filmC.map((f) => [...f])) === 1);
  check('matchingPerceptionExample: an edited film misses',
    matchingPerceptionExample(examples, [filmA[0], filmA[1], shiftFrame(filmA[2], 'down')]) === null &&
    matchingPerceptionExample(examples, filmA.slice(0, 2)) === null && matchingPerceptionExample([], filmA) === null);
  // Grep gate: the grader's path never reads the student-visible field.
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src/engine');
  for (const f of ['grader.ts', 'caseRun.ts', 'score.ts']) {
    check(`grep gate: engine/${f} never reads perception_examples`, !readFileSync(join(SRC, f), 'utf8').includes('perception_examples'));
  }
}

// ── grading ────────────────────────────────────────────────────────
console.log('\n[grading]');

function perceptionQuestion(rule: PerceptionRule, width: number): AssignmentQuestion {
  return {
    id: 1,
    label: 'P',
    statement: 's',
    buildMode: perceptionModeFor(rule),
    representation: 'binary',
    perception: { rule, width },
    perception_cases: buildPerceptionCases({ rule, width }),
  };
}

function gradePair(
  label: string,
  rule: PerceptionRule,
  width: number,
  good: CircuitData,
  bad: CircuitData,
) {
  const q = perceptionQuestion(rule, width);
  const g = gradeQuestion(q, good);
  const b = gradeQuestion(q, bad);
  check(`${label}: correct circuit passes every case`,
    g.status === 'graded' && g.total > 0 && g.passed === g.total);
  check(`${label}: incorrect circuit fails some case`,
    b.status === 'graded' && b.passed < b.total);
  const failing = b.perceptionCases?.find((c) => !c.pass);
  check(`${label}: failure reports the first wrong step`,
    failing != null && (failing.failStep ?? 0) >= 1);
}

gradePair('edge', { kind: 'min-run', runLength: 3 }, 8,
  perceptionEdgeCorrect(), perceptionEdgeIncorrect());
gradePair('object', { kind: 'exact-run', runLength: 3 }, 8,
  perceptionObjectCorrect(), perceptionObjectIncorrect());
gradePair('landmark', pattern, 9,
  perceptionLandmarkCorrect(), perceptionLandmarkIncorrect());
gradePair('change', change, 8,
  perceptionChangeCorrect(), perceptionChangeIncorrect());
gradePair('motion', motion, 8,
  perceptionMotionCorrect(), perceptionMotionIncorrect());

// ── task 013: grading the new rules (authored films included) ──────
console.log('\n[grading new rules]');
const newVariantFilms = [
  [objectFrame(8, 3, 2), objectFrame(8, 3, 3), objectFrame(8, 3, 2), objectFrame(8, 3, 1)],
  [bits('10000000'), bits('10111000'), bits('10011100'), bits('10001110')],
];
function variantQuestion(direction: MotionDirection, scene: MotionScene, films: number[][][] = newVariantFilms): AssignmentQuestion {
  const spec = { rule: { kind: 'motion', objectLength: 3, direction, scene } as PerceptionRule, width: 8 };
  return {
    id: 1, label: 'P', statement: 's', buildMode: 'SC', representation: 'binary',
    perception: spec, perception_cases: buildPerceptionCases(spec, films),
  };
}
for (const [direction, scene, wrongDirection, wrongScene] of [
  ['down', 'single', 'up', 'single'],
  ['either', 'multi', 'either', 'single'],
  ['down', 'multi', 'down', 'single'],
  ['either', 'single', 'up', 'single'],
] as [MotionDirection, MotionScene, MotionDirection, MotionScene][]) {
  const q = variantQuestion(direction, scene);
  const good = gradeQuestion(q, perceptionMotionDetector({ width: 8, k: 3, direction, scene }));
  const bad = gradeQuestion(q, perceptionMotionDetector({ width: 8, k: 3, direction: wrongDirection, scene: wrongScene }));
  const authoredAt = (q.perception_cases ?? []).findIndex((c) => c.authored);
  check(`${direction}/${scene}: the detector passes every case, the authored films included (${good.passed}/${good.total})`,
    good.status === 'graded' && good.passed === good.total && authoredAt > 0 && good.total === q.perception_cases!.length);
  const miss = bad.perceptionCases?.find((c) => !c.pass);
  check(`${direction}/${scene}: a ${wrongDirection}/${wrongScene} detector fails some case, first wrong step reported (${bad.passed}/${bad.total})`,
    bad.passed < bad.total && (miss?.failStep ?? 0) >= 1);
  check(`${direction}/${scene}: results carry no authored flag`,
    !JSON.stringify(good).includes('authored'));
}
{
  // An authored film is graded like a generated one: HW3's memoryless
  // detector fails a static object at its first step.
  const upQ = variantQuestion('up', 'single', [[objectFrame(8, 3, 2), objectFrame(8, 3, 2)]]);
  const g = gradeQuestion(upQ, perceptionMotionIncorrect());
  const last = g.perceptionCases![g.perceptionCases!.length - 1];
  check('an authored film is graded like any case (static object: the memoryless detector fails at t1)',
    !last.pass && last.failStep === 1 && same(last.expected, [0, 0]));
}

// Structural rejection: wrong retina size fails every case with a reason.
const q8 = perceptionQuestion({ kind: 'min-run', runLength: 3 }, 8);
const wrongShape = gradeQuestion(q8, perceptionLandmarkCorrect()); // 9 inputs, expects 8
check('wrong input count fails every case with a reason',
  wrongShape.status === 'graded' &&
  wrongShape.passed === 0 &&
  (wrongShape.perceptionCases?.every((c) => !c.pass && !!c.reason) ?? false));

// ── frames ↔ lanes (the frame player's film as the run's input) ────
console.log('\n[frames ↔ lanes]');
{
  const films = [up, ...changeCases.map((c) => c.frames), ...motionCases.map((c) => c.frames)];
  check('lanesToFrames(framesToLanes(f, 8), 8) is f, for every SC bank film',
    films.every((f) => JSON.stringify(lanesToFrames(framesToLanes(f, 8), 8)) === JSON.stringify(f)));
  const lanes = framesToLanes(up, 8);
  check('lane i is wire IN(i+1) over time, t1 first',
    lanes.length === 8 && lanes.every((lane, i) => lane.length === up.length && lane.every((b, t) => b === up[t][i])));
  check('ragged / short / missing lanes read 0',
    JSON.stringify(lanesToFrames([[1, 1, 1], [1]], 3)) === JSON.stringify([[1, 1, 0], [1, 0, 0], [1, 0, 0]]));
  check('a short frame reads 0 in its missing bits',
    JSON.stringify(framesToLanes([[1]], 3)) === JSON.stringify([[1], [0], [0]]));
  check('framesToLanes([], w) loads no lane, and holds no frame',
    framesToLanes([], 8).every((l) => l.length === 0) && lanesToFrames(framesToLanes([], 8), 8).length === 0);
  const f = objectFrame(8, 3, 4);
  check("the player's shift up is toward IN1: objectFrame(8,3,4) → objectFrame(8,3,3)",
    JSON.stringify(shiftFrame(f, 'up')) === JSON.stringify(objectFrame(8, 3, 3)));
  check("…so the motion rule reads [f, up(f)] as upward motion (the player's 'up' IS the rule's)",
    expectedPerceptionOutputs(motion, [f, shiftFrame(f, 'up')])[1] === 1);
  check('shift down moves away from IN1, and is not upward motion',
    JSON.stringify(shiftFrame(f, 'down')) === JSON.stringify(objectFrame(8, 3, 5)) &&
    expectedPerceptionOutputs(motion, [f, shiftFrame(f, 'down')])[1] === 0);
}

// ── The REAL store, headless ────────────────────────────────────────────────

// Minimal DOM shims so the store module (browser code) loads under Node
// (as scWindowCheck).
(globalThis as unknown as { window: unknown }).window = {
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { document: unknown }).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible',
};
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
}

// Import AFTER the shims (static imports would hoist above them).
const {
  useStore,
  selectCodecLayout,
  selectCodecWindow,
  selectScRunWindow,
  selectPerceptionRetina,
  selectQuestionLocked,
} = await import('../src/store');

async function waitUntil(pred: () => boolean, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const hw3 = JSON.parse(readFileSync(join(HERE, '../src/devData/homeworks/hw3.json'), 'utf8')) as AssignmentData;
const hw3Question = (id: number) => hw3.questions.find((q) => q.id === id)!;

/** Open `q` alone with `machine` on its canvas (a fresh canvas: reset law 1). */
function openPerception(q: AssignmentQuestion, machine: CircuitData) {
  useStore.getState().loadAssignment({ id: `perception-check-${q.id}`, title: 'Perception check', questions: [q] });
  useStore.setState({ components: machine.components, wires: machine.wires });
}

/** scStep until the store refuses one; the number of steps taken. */
function stepToEnd(): number {
  let steps = 0;
  for (let guard = 0; guard < 500; guard++) {
    const before = useStore.getState().scTimeStep;
    useStore.getState().scStep();
    if (useStore.getState().scTimeStep === before) break;
    steps++;
  }
  return steps;
}

/** What the store's run fed and output, per step, t ascending. */
function storeRun(): { fed: number[][]; out: number[] } {
  const hist = useStore.getState().scHistory.slice().sort((a, b) => a.t - b.t);
  return { fed: hist.map((h) => h.inputBits), out: hist.map((h) => h.outputBits[0] ?? 0) };
}

/** The machine with run scratch left in every top-level MEM (autosaved and
 *  submitted as-is): both the grader and the player must start from 0. */
function withDirtyMems(m: CircuitData): CircuitData {
  return { ...m, components: m.components.map((c) => (c.type === 'MEM' ? { ...c, storedValue: 1 } : c)) };
}

console.log('\n[store: SC perception frame run ≡ grader]');
const perceptionPairs: [number, string, () => CircuitData, () => CircuitData][] = [
  [11, 'change', perceptionChangeCorrect, perceptionChangeIncorrect],
  [12, 'motion', perceptionMotionCorrect, perceptionMotionIncorrect],
];
for (const [id, name, correct, incorrect] of perceptionPairs) {
  const q = hw3Question(id);
  const cases = q.perception_cases ?? [];
  check(`hw3 #${id} (${name}) is an SC perception question with a bank`,
    q.buildMode === 'SC' && !!q.perception && cases.length > 0);

  const machines: [string, CircuitData][] = [
    ['correct', correct()],
    ['incorrect', incorrect()],
    ['correct, boxed whole', boxWhole(correct())],
    ['correct, dirty MEM scratch', withDirtyMems(correct())],
  ];
  for (const [mName, machine] of machines) {
    const graded = gradeQuestion(q, machine);
    let exactLength = true;
    let fedFrames = true;
    let gradersGot = true;
    let enginesRun = true;
    let refusesPast = true;
    let missesExpected = false;
    cases.forEach((tc, k) => {
      openPerception(q, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      const s = useStore.getState();
      exactLength &&= s.scHistory.length === tc.frames.length && s.scTimeStep === tc.frames.length + 1;
      const run = storeRun();
      fedFrames &&= same(run.fed, tc.frames);
      gradersGot &&= same(run.out, graded.perceptionCases?.[k]?.got);
      enginesRun &&= same(run.out, runPerceptionCase(gradingCircuit(machine), 'SC', tc));
      s.scStep();
      const after = useStore.getState();
      refusesPast &&= after.scHistory.length === tc.frames.length && after.scTimeStep === tc.frames.length + 1;
      missesExpected ||= !same(run.out, tc.expected);
    });
    check(`${name} / ${mName}: every case runs exactly its frames — no drain step`, exactLength);
    check(`${name} / ${mName}: the fed input bits ARE the case's frames`, fedFrames);
    check(`${name} / ${mName}: the output bit per step ≡ the grader's got (${graded.passed}/${graded.total} graded)`, gradersGot);
    check(`${name} / ${mName}: … ≡ runPerceptionCase(gradingCircuit(machine))`, enginesRun);
    check(`${name} / ${mName}: a further scStep past the film is refused`, refusesPast);
    if (mName === 'incorrect') {
      check(`${name} / incorrect: the store run shows the miss the grader fails (not vacuous)`,
        missesExpected && graded.passed < graded.total);
    } else {
      check(`${name} / ${mName}: the grader passes it (${graded.passed}/${graded.total})`,
        graded.status === 'graded' && graded.passed === graded.total);
    }
  }

  // Run (the interval loop) stops at the film's end too — not at L + one
  // drain step per MEM, the sandbox's end.
  {
    const machine = correct();
    const drain = memorySlots(machine.components).length;
    const tc = cases[0];
    openPerception(q, machine);
    useStore.getState().setScFrames(tc.frames);
    useStore.getState().scRun(1);
    const stopped = await waitUntil(() => !useStore.getState().scRunning);
    await new Promise((r) => setTimeout(r, 30)); // a stray tick would land here
    const s = useStore.getState();
    check(`${name}: Run stops by itself after the ${tc.frames.length} frames, not ${tc.frames.length} + ${drain} MEM drain steps`,
      drain > 0 && stopped && s.scHistory.length === tc.frames.length && s.scTimeStep === tc.frames.length + 1);
    check(`${name}: Run's outputs ≡ the grader's got`,
      same(storeRun().out, gradeQuestion(q, machine).perceptionCases?.[0]?.got));
  }

  // The run window and the codec: a perception question has no codec layout,
  // even given a stray cc_spec — its end is the film's length.
  for (const [label, qv] of [
    ['as authored', q],
    ['with a stray cc_spec', { ...q, cc_spec: { inputs: [{ name: 'x', width: 3 }], outputs: [{ name: 'y', width: 3, formula: 'x' }] } }],
  ] as [string, AssignmentQuestion][]) {
    const tc = cases[0];
    openPerception(qv, correct());
    useStore.getState().setScFrames(tc.frames);
    const s = useStore.getState();
    check(`${name} ${label}: no codec layout/window; run window = ${tc.frames.length} frames; retina = ${q.perception!.width}`,
      selectCodecLayout(s) === null && selectCodecWindow(s) === null &&
      selectScRunWindow(s) === tc.frames.length && selectPerceptionRetina(s) === q.perception!.width);
    stepToEnd();
    check(`${name} ${label}: the run ≡ the grader's got`,
      same(storeRun().out, gradeQuestion(q, correct()).perceptionCases?.[0]?.got));
  }

  // The run never reads the answer key: a student's stripped copy (remote:
  // perception_cases removed, server/src/sanitize.ts) plays identically.
  {
    const stripped: AssignmentQuestion = { ...q, perception_cases: [] };
    const machine = incorrect();
    let identical = true;
    for (const tc of cases) {
      openPerception(q, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      const keyed = storeRun();
      openPerception(stripped, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      identical &&= same(storeRun(), keyed) && selectScRunWindow(useStore.getState()) === tc.frames.length;
    }
    check(`${name}: a stripped copy (perception_cases: []) plays every film identically`, identical);
  }

  // Frames are stimulus: never locked. A done question still loads and plays a film.
  {
    const tc = cases[0];
    openPerception(q, correct());
    useStore.getState().toggleCurrentQuestionDone();
    const locked = selectQuestionLocked(useStore.getState());
    useStore.getState().setScFrames(tc.frames);
    const loaded = same(useStore.getState().scInputSequence, framesToLanes(tc.frames, q.perception!.width));
    stepToEnd();
    check(`${name}: marked done (locked=${locked}), setScFrames still loads the film and it plays`,
      locked && loaded && same(storeRun().out, gradeQuestion(q, correct()).perceptionCases?.[0]?.got));
  }

  // An edit mid-run (a raw setState — the store's machine-key subscriber, law 6)
  // restarts the run at t=1 keeping the film; a canvas swap drops the film (law 1).
  {
    const tc = cases[0];
    openPerception(q, correct());
    useStore.getState().setScFrames(tc.frames);
    useStore.getState().scStep();
    useStore.getState().scStep();
    const film = useStore.getState().scInputSequence;
    const midRun = useStore.getState().scTimeStep === 3;
    useStore.setState({ components: [...useStore.getState().components, comp('pc-extra-not', 'NOT', 'NOT', 600, 600)] });
    const s = useStore.getState();
    check(`${name}: an edit mid-run restarts at t=1 with the film kept`,
      midRun && s.scTimeStep === 1 && s.scHistory.length === 0 && same(s.scInputSequence, film));
    useStore.getState().resetAllSimState();
    check(`${name}: a canvas swap (resetAllSimState) drops the film`,
      useStore.getState().scInputSequence.every((lane) => lane.length === 0));
  }
}

// ── task 013: the new rules and authored films play as graded ─────
console.log('\n[store: new rules + authored films ≡ grader]');
{
  const q = variantQuestion('either', 'multi');
  const cases = q.perception_cases ?? [];
  for (const [mName, machine] of [
    ['either/multi detector', perceptionMotionDetector({ width: 8, k: 3, direction: 'either', scene: 'multi' })],
    ['up/single detector', perceptionMotionCorrect()],
  ] as [string, CircuitData][]) {
    const graded = gradeQuestion(q, machine);
    let identical = true;
    let authoredPlayed = 0;
    cases.forEach((tc, k) => {
      openPerception(q, machine);
      useStore.getState().setScFrames(tc.frames);
      stepToEnd();
      const run = storeRun();
      identical &&= same(run.fed, tc.frames) && same(run.out, graded.perceptionCases?.[k]?.got);
      if (tc.authored) authoredPlayed++;
    });
    check(`${mName}: every case (${authoredPlayed} authored) plays in the store as the grader ran it (${graded.passed}/${graded.total})`,
      identical && authoredPlayed === newVariantFilms.length);
  }
}

console.log('\n[replay: Run this input on a perception film]');
{
  /** `machine` submitted for `q`, graded, as the latest record — local or
   *  a student's copy (stripAnswers + studentRecord: no bank, no key). */
  const openGraded = (q: AssignmentQuestion, machine: CircuitData, remote: boolean): QuestionResult => {
    const full: AssignmentData = { id: `perception-replay-${q.buildMode}-${remote ? 'r' : 'l'}`, title: 'replay', questions: [q] };
    const graded = gradeQuestion(q, machine);
    const record: SubmissionRecord = {
      assignmentId: full.id,
      attempt: 1,
      submittedAt: '2026-09-27T00:00:00.000Z',
      submission: { assignmentTitle: full.title, submittedAt: '2026-09-27T00:00:00.000Z', answers: [{ questionId: q.id, circuit: machine }] },
      result: { student: 's', questions: [graded], passed: graded.passed, total: graded.total },
    };
    useStore.getState().loadAssignment(remote ? stripAnswers(full) : full);
    useStore.setState({
      components: machine.components,
      wires: machine.wires,
      submissions: { [full.id]: remote ? studentRecord(record, true) : record },
    });
    return graded;
  };

  // SC: a down/single question, graded on the up/single detector.
  const scQ = variantQuestion('down', 'single');
  const wrong = perceptionMotionCorrect();
  for (const remote of [false, true]) {
    const tag = remote ? 'student copy' : 'local';
    const graded = openGraded(scQ, wrong, remote);
    const failed = graded.perceptionCases!.map((c, k) => ({ c, k })).filter(({ c }) => !c.pass);
    const authoredFail = failed.find(({ k }) => scQ.perception_cases![k].authored);
    const picks = [failed[0], authoredFail].filter((x) => x !== undefined);
    check(`SC ${tag}: failed cases to replay, an authored film among them`, picks.length === 2);
    for (const { c, k } of picks) {
      if (remote) check(`SC ${tag}: the store holds no bank`, (useStore.getState().assignment?.questions[0].perception_cases ?? []).length === 0);
      await useStore.getState().loadCaseInput(scQ.id, k);
      const st = useStore.getState();
      const lc = st.loadedCase;
      check(`SC ${tag} case ${k}: loadedCase is the result's film, with no expected/got`,
        lc !== null && lc.kind === 'perception' && same(lc.frames, c.frames) &&
        !/"(expected|got)"/.test(JSON.stringify(lc)) && lc.recorded.pass === false);
      check(`SC ${tag} case ${k}: the film is the run's lanes, played to its end (${c.frames.length} frames)`,
        same(st.scInputSequence, framesToLanes(c.frames, 8)) &&
        st.scHistory.length === c.frames.length && st.scTimeStep === c.frames.length + 1);
      const run = storeRun();
      check(`SC ${tag} case ${k}: fed the frames, OUT row ≡ the grader's got (${c.got.join('')})`,
        same(run.fed, c.frames) && same(run.out, c.got));
      const view = lc ? gradedCaseView(scQ, lc, { components: st.components, wires: st.wires }, 1) : null;
      check(`SC ${tag} case ${k}: the banner reads the machine's output, same as graded`,
        view !== null && view.note === 'same' && !view.recorded.pass && view.now.text.includes(c.got.join(' ')));
    }
    // A done question still replays (stimulus is never locked), and the
    // undo history is untouched.
    const k = failed[0].k;
    useStore.getState().toggleCurrentQuestionDone();
    const undoBefore = useStore.getState().undoStack.length;
    await useStore.getState().loadCaseInput(scQ.id, k);
    check(`SC ${tag}: a locked question still replays, undo untouched`,
      selectQuestionLocked(useStore.getState()) && useStore.getState().scHistory.length === failed[0].c.frames.length &&
      useStore.getState().undoStack.length === undoBefore);
    // A canvas swap drops the loaded case (reset law 1).
    useStore.getState().resetAllSimState();
    check(`SC ${tag}: resetAllSimState clears the loaded case`, useStore.getState().loadedCase === null);
  }

  // A machine the grader rejects: the banner says why, like the recorded case.
  {
    const graded = openGraded(scQ, perceptionLandmarkCorrect(), false); // 9 inputs, retina is 8
    await useStore.getState().loadCaseInput(scQ.id, 0);
    const st = useStore.getState();
    const view = st.loadedCase ? gradedCaseView(scQ, st.loadedCase, { components: st.components, wires: st.wires }, 1) : null;
    check('SC rejected machine: recorded and live verdicts both carry the Stage-1 reason',
      view !== null && view.note === 'same' && view.recorded.text.includes(graded.perceptionCases![0].reason!) &&
      view.now.text.includes(graded.perceptionCases![0].reason!));
  }

  // CC: one frame on the INPUT toggles by label.
  const ccQ = perceptionQuestion({ kind: 'min-run', runLength: 3 }, 8);
  for (const remote of [false, true]) {
    const tag = remote ? 'student copy' : 'local';
    const graded = openGraded(ccQ, perceptionEdgeIncorrect(), remote);
    const k = graded.perceptionCases!.findIndex((c) => !c.pass);
    const c = graded.perceptionCases![k];
    await useStore.getState().loadCaseInput(ccQ.id, k);
    const st = useStore.getState();
    const ins = sortByLabel(st.components, 'IN').map((x) => x.value ?? 0);
    const out = sortByLabel(st.components, 'OUT').map((x) => x.value ?? 0);
    check(`CC ${tag} case ${k}: INPUT toggles = frames[0] (${c.frames[0].join('')}), OUT = the grader's got`,
      st.loadedCase?.kind === 'perception' && same(ins, c.frames[0]) && same(out, c.got));
    check(`CC ${tag} case ${k}: the machine graded is the canvas's`,
      st.loadedCase?.gradedKey === gradedMachineKey(perceptionEdgeIncorrect()));
  }
}

console.log(`\n${failures === 0 ? 'PERCEPTION OK' : `PERCEPTION FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
