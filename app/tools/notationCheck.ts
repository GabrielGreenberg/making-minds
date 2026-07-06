// Headless check pinning the transition-notation seam (P1.12 —
// docs/buildout/designs/transition-notation.md).
//
//   cd app && npx tsx tools/notationCheck.ts
//
// The seam: engine/notation.ts owns transition-label SYNTAX for all four
// grammars behind one TransitionNotation interface. Only the FSM notation is
// implemented natively; TM and turbot-TM notations DELEGATE to the existing
// engine parsers. These pins make drift impossible:
//
//   ADAPTER ≡ PARSER   each delegating adapter must agree with its engine
//     parser on an exhaustive label corpus (legal AND malformed) — two paths
//     answering "what does this label mean" cannot diverge silently.
//   LEGACY BYTE-COMPAT fsmNotation(1,1) accepts/rejects exactly what the
//     legacy regex ^[01]:[01]$ did, over a generated string corpus.
//   ALPHABET           fsmNotation(2,1) enumerates 00/01/10/11 in order.
//   ROUND-TRIP         format(parse(l)) === l for every canonical label.
//   WIDENING           turbotFsmNotation keeps legacy 1-bit outputs valid
//     ('1' → '11' forward, '0' → '00' stop) and format decays them.
//   BIT ORDER (asymmetric)  a k=2 FSM computing x + 2*y — NOT symmetric x+y —
//     grades end-to-end, and the same machine with swapped symbol halves
//     FAILS: wire order = cc_spec declaration order (x is the LEFT char).
//   TOTALITY/ARITY     Stage-1 names the student's actual mistake ("has a
//     1-bit input symbol; this question has 2 input wires"), never grades a
//     wrong-arity machine, and caps kIn at 3 with an explicit reason.

import type { AssignmentQuestion, TMNotation } from '../src/types';
import { buildQuestionBank } from '../src/engine/testVectorGen';
import { gradeQuestion } from '../src/engine/grader';
import { validateMachine } from '../src/engine/machineValidation';
import { comp, transition, circuit } from './builder';
import { parseTMTransition } from '../src/engine/tm';
import {
  parseTurbotInternalLabel,
  parseTurbotExternalLabel,
  TURBOT_FORWARD,
  TURBOT_TURN_RIGHT,
  TURBOT_TURN_LEFT,
} from '../src/engine/turbot';
import {
  fsmNotation,
  turbotFsmNotation,
  tmDualNotation,
  turbotInternalNotation,
  turbotExternalNotation,
  type TransitionNotation,
  type ParsedTransition,
} from '../src/engine/notation';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Label corpora ───────────────────────────────────────────────────
// Legal labels for each grammar plus a shared pile of malformed strings.

const MALFORMED = [
  '', ':', '0', '1', '0:', ':0', '0:0:0', '00', '0:2', '2:0', 'x:0', '0:x',
  '0 :0', '0: 0', '0:0 ', ' 0:0', '0:0\n', 'B:0', '0:B', 'E:E', '↑:E',
  '0:RL', '0:LR', '0:0RR', '*:*L*', '0;0', '0-0', 'O:0', '0:O',
];

const TM_LEGAL: Record<TMNotation, string[]> = {
  binary: ['0:0R', '0:0L', '0:1R', '0:1L', '0:*R', '0:*L',
           '1:0R', '1:0L', '1:1R', '1:1L', '1:*R', '1:*L',
           '*:0R', '*:0L', '*:1R', '*:1L', '*:*R', '*:*L'],
  unary: ['0:0R', '0:0L', '0:1R', '0:1L', '1:0R', '1:0L', '1:1R', '1:1L'],
};
// Legal-for-binary-only labels must be REJECTED by the unary adapter too.
const TM_STAR_ONLY = TM_LEGAL.binary.filter((l) => l.includes('*'));

const INTERNAL_LEGAL = ['0:0', '0:1', '0:*', '0:R', '0:L',
                        '1:0', '1:1', '1:*', '1:R', '1:L',
                        '*:0', '*:1', '*:*', '*:R', '*:L'];

const EXTERNAL_LEGAL = ['B', 'E', 'F'].flatMap((s) =>
  [TURBOT_FORWARD, TURBOT_TURN_RIGHT, TURBOT_TURN_LEFT].map((m) => `${s}:${m}`));

// ─── Adapter ≡ parser equivalence ────────────────────────────────────

console.log('[adapter ≡ engine parser]');

for (const notation of ['binary', 'unary'] as TMNotation[]) {
  const adapter = tmDualNotation(notation);
  const corpus = [...TM_LEGAL[notation], ...TM_STAR_ONLY, ...MALFORMED, ...INTERNAL_LEGAL, ...EXTERNAL_LEGAL];
  const agree = corpus.every((label) => {
    const engine = parseTMTransition(label, notation);
    const seam = adapter.parse(label);
    if (engine === null || seam === null) return engine === null && seam === null;
    return seam.input === engine.input &&
      eq(seam.outputs, [engine.action.write, engine.action.move]);
  });
  check(`tm-dual(${notation}): adapter agrees with parseTMTransition on ${corpus.length} labels`, agree);
}

{
  const corpus = [...INTERNAL_LEGAL, ...EXTERNAL_LEGAL, ...TM_LEGAL.binary, ...MALFORMED];
  const agree = corpus.every((label) => {
    const engine = parseTurbotInternalLabel(label);
    const seam = turbotInternalNotation.parse(label);
    if (engine === null || seam === null) return engine === null && seam === null;
    const token = engine.action.kind === 'move' ? engine.action.dir : engine.action.symbol;
    return seam.input === engine.read && eq(seam.outputs, [token]);
  });
  check(`turbot-internal: adapter agrees with parseTurbotInternalLabel on ${corpus.length} labels`, agree);
}

{
  const corpus = [...EXTERNAL_LEGAL, ...INTERNAL_LEGAL, ...TM_LEGAL.binary, ...MALFORMED];
  const arrowOf = { forward: TURBOT_FORWARD, right: TURBOT_TURN_RIGHT, left: TURBOT_TURN_LEFT } as const;
  const agree = corpus.every((label) => {
    const engine = parseTurbotExternalLabel(label);
    const seam = turbotExternalNotation.parse(label);
    if (engine === null || seam === null) return engine === null && seam === null;
    return seam.input === engine.sense && eq(seam.outputs, [arrowOf[engine.motor]]);
  });
  check(`turbot-external: adapter agrees with parseTurbotExternalLabel on ${corpus.length} labels`, agree);
  check('turbot-external: adapter arrows are the engine arrow constants',
    eq(turbotExternalNotation.outputFields[0].tokens, [TURBOT_FORWARD, TURBOT_TURN_RIGHT, TURBOT_TURN_LEFT]) &&
    turbotExternalNotation.defaultLabel === `E:${TURBOT_FORWARD}`);
}

// ─── fsmNotation(1,1) ≡ legacy regex ─────────────────────────────────

console.log('\n[fsmNotation(1,1) ≡ legacy ^[01]:[01]$]');
{
  const LEGACY = /^[01]:[01]$/;
  // All strings of length ≤ 3 over a probing alphabet, plus targeted longer shapes.
  const alphabet = ['0', '1', ':', '*', 'R'];
  const corpus: string[] = [''];
  for (const a of alphabet) {
    corpus.push(a);
    for (const b of alphabet) {
      corpus.push(a + b);
      for (const c of alphabet) {
        corpus.push(a + b + c);
      }
    }
  }
  corpus.push('00:0', '0:00', '00:00', '10:1', '1:10', '0:0R', '0:1\n', ' 0:1', '0:1 ', '0:1:1');
  const n = fsmNotation(1, 1);
  const agree = corpus.every((label) => (n.parse(label) !== null) === LEGACY.test(label));
  check(`accepts/rejects exactly like the legacy regex on ${corpus.length} strings`, agree);
  check('parse fields: "0:1" → input "0", outputs ["1"]',
    eq(n.parse('0:1'), { input: '0', outputs: ['1'] }));
  check('undefined label is malformed', n.parse(undefined) === null);
}

// ─── Alphabet enumeration ────────────────────────────────────────────

console.log('\n[alphabet enumeration]');
check('fsmNotation(2,1).inputAlphabet = 00/01/10/11 (numeric order)',
  eq(fsmNotation(2, 1).inputAlphabet, ['00', '01', '10', '11']));
check('fsmNotation(1,1).inputAlphabet = 0/1', eq(fsmNotation(1, 1).inputAlphabet, ['0', '1']));
check('fsmNotation(3,1).inputAlphabet has 8 symbols, 000 first, 111 last', (() => {
  const a = fsmNotation(3, 1).inputAlphabet;
  return a.length === 8 && a[0] === '000' && a[7] === '111';
})());
check('fsmNotation(2,1) parses "10:1" with wire order preserved (x first)',
  eq(fsmNotation(2, 1).parse('10:1'), { input: '10', outputs: ['1'] }));
check('fsmNotation(2,1) rejects 1-bit and 3-bit inputs',
  fsmNotation(2, 1).parse('0:1') === null && fsmNotation(2, 1).parse('010:1') === null);
check('fsmNotation instances are memoized (selector identity)',
  fsmNotation(2, 1) === fsmNotation(2, 1) && tmDualNotation('binary') === tmDualNotation('binary'));

// ─── render ∘ parse identity (canonical labels) ──────────────────────

console.log('\n[format(parse(l)) === l on canonical labels]');

function roundTrips(n: TransitionNotation, corpus: string[]): boolean {
  return corpus.every((label) => {
    const p = n.parse(label);
    return p !== null && n.format(p) === label;
  });
}

check('fsm(1,1): all 4 labels', roundTrips(fsmNotation(1, 1), ['0:0', '0:1', '1:0', '1:1']));
check('fsm(2,1): all 8 labels',
  roundTrips(fsmNotation(2, 1), fsmNotation(2, 1).inputAlphabet.flatMap((s) => [`${s}:0`, `${s}:1`])));
check('fsm(2,2): sample', roundTrips(fsmNotation(2, 2), ['00:00', '01:10', '11:11', '10:01']));
check('tm-dual(binary): all 18 labels', roundTrips(tmDualNotation('binary'), TM_LEGAL.binary));
check('tm-dual(unary): all 8 labels', roundTrips(tmDualNotation('unary'), TM_LEGAL.unary));
check('turbot-internal: all 15 labels', roundTrips(turbotInternalNotation, INTERNAL_LEGAL));
check('turbot-external: all 9 labels', roundTrips(turbotExternalNotation, EXTERNAL_LEGAL));
check('turbot-fsm: canonical 2-bit labels',
  roundTrips(turbotFsmNotation, ['0:00', '0:01', '0:10', '0:11', '1:00', '1:11']));

// ─── turbot-FSM legacy widening + decay ──────────────────────────────

console.log('\n[turbot-fsm widening]');
check("'1:1' still means forward: parse widens to ['11']",
  eq(turbotFsmNotation.parse('1:1'), { input: '1', outputs: ['11'] }));
check("'0:0' widens to stop ['00']",
  eq(turbotFsmNotation.parse('0:0'), { input: '0', outputs: ['00'] }));
check("decay: format(parse('1:1')) === '1:11' (canonical, not the alias)",
  turbotFsmNotation.format(turbotFsmNotation.parse('1:1') as ParsedTransition) === '1:11');
check('malformed still rejected', turbotFsmNotation.parse('1:111') === null &&
  turbotFsmNotation.parse('11:1') === null && turbotFsmNotation.parse('') === null);

// ─── Bit-order grade pin (ASYMMETRIC: x + 2*y) ───────────────────────
// hw4-p11's x+y is symmetric — blind to a swapped symbol join — so the wire-
// order pin uses x + 2*y: state = (carry, previous y bit), input symbol 'xy'
// with x the LEFT char (cc_spec declaration order = codec wire order).

console.log('\n[k=2 grade pin: x + 2*y end-to-end]');
{
  const bank = buildQuestionBank(
    [{ name: 'x', maxVal: 0 }, { name: 'y', maxVal: 0 }],
    [{ name: 'out', formula: 'x + 2*y' }],
    'binary',
    'FSM',
  );
  const question: AssignmentQuestion = {
    id: 900,
    label: 'x + 2y pin',
    statement: 'Compute x + 2y, reading one bit of x and one bit of y per step.',
    buildMode: 'FSM',
    representation: 'binary',
    cc_spec: bank.spec,
    test_cases: bank.test_cases,
  };
  check('question has 2 input groups (x first)',
    bank.spec.inputs.length === 2 && bank.spec.inputs[0].name === 'x');

  // State = (carry c, previous y bit p); on 'xy': sum = x + p + c, emit
  // sum & 1, carry' = sum >> 1, p' = y. S0=(0,0) S1=(0,1) S2=(1,0) S3=(1,1).
  const rows: [string, string, string, string][] = [
    // [from, symbol:out, to] rows flattened below
    ['s0', '00:0', 's0', 't01'], ['s0', '01:0', 's1', 't02'],
    ['s0', '10:1', 's0', 't03'], ['s0', '11:1', 's1', 't04'],
    ['s1', '00:1', 's0', 't05'], ['s1', '01:1', 's1', 't06'],
    ['s1', '10:0', 's2', 't07'], ['s1', '11:0', 's3', 't08'],
    ['s2', '00:1', 's0', 't09'], ['s2', '01:1', 's1', 't10'],
    ['s2', '10:0', 's2', 't11'], ['s2', '11:0', 's3', 't12'],
    ['s3', '00:0', 's2', 't13'], ['s3', '01:0', 's3', 't14'],
    ['s3', '10:1', 's2', 't15'], ['s3', '11:1', 's3', 't16'],
  ];
  const states = [
    comp('s0', 'STATE', 'S₀', 100, 100), comp('s1', 'STATE', 'S₁', 300, 100),
    comp('s2', 'STATE', 'S₂', 100, 300), comp('s3', 'STATE', 'S₃', 300, 300),
  ];
  const xPlus2y = circuit(states,
    rows.map(([from, label, to, id]) => transition(id, from, to, label)));
  // The SAME machine with each symbol's halves swapped computes y + 2x — if
  // the grader joined the row in the wrong wire order, THIS one would pass.
  const swapped = circuit(states,
    rows.map(([from, label, to, id]) =>
      transition(id, from, to, `${label[1]}${label[0]}:${label[3]}`)));

  const rGood = gradeQuestion(question, xPlus2y);
  check(`x + 2*y machine passes every case (${rGood.passed}/${rGood.total})`,
    rGood.status === 'graded' && rGood.total > 0 && rGood.passed === rGood.total);

  const rSwapped = gradeQuestion(question, swapped);
  check(`swapped-halves machine (y + 2*x) FAILS (${rSwapped.passed}/${rSwapped.total})`,
    rSwapped.status === 'graded' && rSwapped.passed < rSwapped.total);

  // ── Totality/arity Stage-1 pins (the footgun dies loudly) ──
  console.log('\n[Stage-1 totality/arity on the 2-group question]');
  const oneBitIdentity = circuit(
    [comp('s0', 'STATE', 'S₀', 100, 100)],
    [transition('t1', 's0', 's0', '0:0'), transition('t2', 's0', 's0', '1:1')],
  );
  const rArity = gradeQuestion(question, oneBitIdentity);
  check('1-bit machine on the 2-group question fails EVERY case (never wire-0 grading)',
    rArity.status === 'graded' && rArity.total > 0 && rArity.passed === 0);
  check('…and the reason names the arity',
    (rArity.cases[0]?.reason ?? '').includes('has a 1-bit input symbol; this question has 2 input wires'));

  const missingSymbol = circuit(states,
    rows.filter(([, , , id]) => id !== 't04')
      .map(([from, label, to, id]) => transition(id, from, to, label)));
  const rTotality = gradeQuestion(question, missingSymbol);
  check('missing one symbol fails totality with the symbol named',
    rTotality.status === 'graded' && rTotality.passed === 0 &&
    (rTotality.cases[0]?.reason ?? '').includes('must have exactly one transition for input 11 (found 0)'));

  const kInCap = validateMachine(xPlus2y, 'FSM', {
    axis: 'time', rep: 'binary',
    inputWidths: [6, 6, 6, 6], outputWidths: [8],
  }, 'binary');
  check('kIn > 3 fails Stage 1 with an explicit cap reason',
    !kInCap.ok && (kInCap.reason ?? '').includes('at most 3 input groups'));
}

// ─── verdict ─────────────────────────────────────────────────────────

console.log(`\n${failures === 0 ? 'NOTATION CHECK OK' : `NOTATION CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
