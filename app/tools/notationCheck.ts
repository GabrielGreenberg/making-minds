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

import type { TMNotation } from '../src/types';
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

// ─── verdict ─────────────────────────────────────────────────────────

console.log(`\n${failures === 0 ? 'NOTATION CHECK OK' : `NOTATION CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
