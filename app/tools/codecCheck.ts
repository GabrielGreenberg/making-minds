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
check('tally valueToBits 2/4 → [1,1,0,0]', eq(valueToBits(2, 4, 'tally'), [1, 1, 0, 0]));
check('tally round-trip 3/5', bitsToValue(valueToBits(3, 5, 'tally'), 'tally') === 3);
check('tally clamps to width (9 into 4 → 4)', bitsToValue(valueToBits(9, 4, 'tally'), 'tally') === 4);
check('isValidCodeword rejects 101 tally', isValidCodeword([1, 0, 1], 'tally') === false);
check('isValidCodeword accepts 110 tally', isValidCodeword([1, 1, 0], 'tally') === true);
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
