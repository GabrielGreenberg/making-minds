// Headless unit checks for the codec + rep core (CLAUDE_KB/pipeline/codec.md).
//
//   cd app && npx tsx tools/codecCheck.ts
//
// Covers: rep-core round-trips (binary, tally, invalid-codeword rejection); the
// space axis reproducing the CC bit layout (MSB-first, declaration order); the
// time axis (a 1-step delay register decodes to 2x — pins LSB-first + drain);
// tally acceptance rejecting a malformed output; and a tape round-trip.

import type { CodecLayout } from '../src/engine/codec';
import {
  valueToBits,
  bitsToValue,
  bitsToTally,
  isValidCodeword,
  encodeInput,
  decodeOutput,
  outputAccepted,
  axisForMode,
} from '../src/engine';
import { evaluateSCSequence } from '../src/engine/sc';
import { encodeTM, decodeTM } from '../src/engine/tmCodec';
import { scCorrect } from '../src/devData/sampleData';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
const eq = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);

// ── rep core ────────────────────────────────────────────────────
console.log('[rep core]');
check('binary valueToBits 5/3 → [1,0,1] (MSB-first)', eq(valueToBits(5, 3, 'binary'), [1, 0, 1]));
check('binary round-trip 13/4', bitsToValue(valueToBits(13, 4, 'binary'), 'binary') === 13);
check('binary width is the modulus (6 into 2 bits → 2)', bitsToValue(valueToBits(6, 2, 'binary'), 'binary') === 2);
check('tally valueToBits 2/4 → [0,0,1,1] (the textbook\'s 0…01…1)', eq(valueToBits(2, 4, 'tally'), [0, 0, 1, 1]));
check('tally round-trip 3/5', bitsToValue(valueToBits(3, 5, 'tally'), 'tally') === 3);
check('tally clamps to width (9 into 4 → 4)', bitsToValue(valueToBits(9, 4, 'tally'), 'tally') === 4);
check('isValidCodeword rejects 101 tally', isValidCodeword([1, 0, 1], 'tally') === false);
check('isValidCodeword accepts 011 tally', isValidCodeword([0, 1, 1], 'tally') === true);
check('isValidCodeword rejects 110 tally (ones must end the numeral)', isValidCodeword([1, 1, 0], 'tally') === false);
check('bitsToTally reads 0011 as two, 1000 as no numeral (textbook pp. 26–27)',
  bitsToTally([0, 0, 1, 1]) === 2 && bitsToTally([1, 0, 0, 0]) === null);
check('isValidCodeword: binary always valid', isValidCodeword([1, 0, 1], 'binary') === true);

// ── axis selection ──────────────────────────────────────────────
console.log('\n[axis]');
check('CC → space', axisForMode('CC') === 'space');
check('SC → time', axisForMode('SC') === 'time');
check('FSM → time', axisForMode('FSM') === 'time');
check('TM → tape', axisForMode('TM') === 'tape');

// ── space axis (CC bit layout) ──────────────────────────────────
console.log('\n[space]');
const space2: CodecLayout = { axis: 'space', rep: 'binary', inputWidths: [1, 1], outputWidths: [1] };
const sEnc = encodeInput([1, 0], space2);
check('space encode concatenates groups in order', sEnc.axis === 'space' && eq(sEnc.bits, [1, 0]));
const spaceWide: CodecLayout = { axis: 'space', rep: 'binary', inputWidths: [3], outputWidths: [3] };
const sEncWide = encodeInput([5], spaceWide);
check('space encode is MSB-first within a group (5/3 → 101)', sEncWide.axis === 'space' && eq(sEncWide.bits, [1, 0, 1]));
check('space decode slices by output widths', eq(decodeOutput({ axis: 'space', bits: [1, 0, 1] }, spaceWide), [5]));
check('space tally rejects malformed output 101',
  outputAccepted({ axis: 'space', bits: [1, 0, 1] }, { axis: 'space', rep: 'tally', inputWidths: [3], outputWidths: [3] }) === false);
const spaceTally: CodecLayout = { axis: 'space', rep: 'tally', inputWidths: [1], outputWidths: [2] };
check('space tally: one on two wires is OUT1=0, OUT2=1 (HW1 P16: tal(01) = one)',
  eq(decodeOutput({ axis: 'space', bits: [0, 1] }, spaceTally), [1])
  && outputAccepted({ axis: 'space', bits: [1, 0] }, spaceTally) === false);
const timeTally: CodecLayout = { axis: 'time', rep: 'tally', inputWidths: [4], outputWidths: [4] };
const tEncTally = encodeInput([2], timeTally);
check('time tally: the ones arrive FIRST (2 over 4 steps → t1..t4 = 1,1,0,0)',
  tEncTally.axis === 'time' && eq(tEncTally.steps.slice(0, 4).map((r) => r[0]), [1, 1, 0, 0]));

// ── time axis (1-step delay register decodes to 2x) ─────────────
console.log('\n[time]');
const delay: CodecLayout = { axis: 'time', rep: 'binary', inputWidths: [3], outputWidths: [4] };
let delayOk = true;
for (let x = 0; x <= 7; x++) {
  const enc = encodeInput([x], delay);
  if (enc.axis !== 'time') { delayOk = false; break; }
  const steps = evaluateSCSequence(scCorrect().components, scCorrect().wires, enc.steps);
  const got = decodeOutput({ axis: 'time', steps }, delay);
  if (!eq(got, [2 * x])) { delayOk = false; console.log(`    x=${x} → ${JSON.stringify(got)} (expected ${2 * x})`); }
}
check('1-step delay register decodes to 2x for x in 0..7', delayOk);

// ── tape axis round-trip (binary, via tmCodec) ──────────────────
console.log('\n[tape]');
let tapeOk = true;
for (const v of [0, 1, 5, 11, 42]) {
  if (decodeTM('binary', encodeTM('binary', [v])) !== v) { tapeOk = false; console.log(`    binary ${v} failed`); }
}
for (const v of [0, 1, 4, 7]) {
  if (decodeTM('unary', encodeTM('unary', [v])) !== v) { tapeOk = false; console.log(`    unary ${v} failed`); }
}
check('tape encode/decode round-trips (binary + unary)', tapeOk);

console.log(`\n${failures === 0 ? 'CODEC CHECK OK' : `CODEC CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
