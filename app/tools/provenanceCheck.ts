// Headless check for the provenance watermark (task 034): keyed ids, the text
// stamp, the writing/build trace, and the integrity check at submit.
//
//   cd app && npx tsx tools/provenanceCheck.ts
//
// [sha256/hmac]   the pure SHA-256 / HMAC ≡ node:crypto (empty, multi-block,
//                 UTF-8 input, long keys) and the RFC 4231 vectors.
// [mint]          mint → verify round trips; ids are well-formed v4 UUIDs;
//                 sandbox mints and crypto.randomUUID() read as unbound; any
//                 flipped tag bit (or a nonce bit) fails; another student's or
//                 another assignment's key fails; the key registry.
// [attribution]   assessIntegrity names the friend for a friend's ids and
//                 counts self / unbound / legacy, BOXED internals included;
//                 one entry per assignment question, assessing the answer the
//                 grader grades (last wins); a padded submission stays cheap;
//                 the legacy id list includes the box library's internals.
// [store]         in an opened local assignment, add / wire / box id / box
//                 placement mint under the dev key; undo, redo and confirmBox
//                 keep ids; a paste copied in A and pasted in B re-mints under
//                 B, internals included, boxedCircuitId untouched; a sandbox
//                 add is unbound.
// [stamp]         a record fails when moved to another question or when any
//                 field changes; changed text reads as a mismatch; an edit
//                 after an outside text change sets `outside`, sticky.
// [trace]         a paragraph set in one insertion is flagged, the same text
//                 typed in steps is not; one "typed" at machine speed is
//                 (too-fast); injected text the trace cannot account for is
//                 flagged; a big paste says "in-app paste"; in the store, a
//                 text box's own undo restoring deleted text inserts nothing.
// [history]       the one-save flag fires on a jump to the final count and
//                 not on gradual saves, nor on work deleted and restored;
//                 autosave lands at least once per AUTO_SAVE_MAX_WAIT of
//                 unbroken editing.
// [never scores]  the grade is the same with and without provenance.
// [grep gate]     no `uuid` import and no randomUUID in app/src or
//                 server/src; provenance/ imports no npm package and touches
//                 no DOM-only API.
// [notices]       exported files carry the notice; one submit confirmation
//                 carries the disclosure sentence; the banner is PROD-gated;
//                 the bundle comment is wired into vite.config.ts.

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssignmentData, CircuitComponent, CircuitData, QuestionProvenance, Wire } from '../src/types';

// The store registers window/document listeners at import time, so install
// minimal shims BEFORE dynamically importing it (as pasteCheck does).
const noop = () => {};
const backing = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  get length() { return backing.size; },
  key: (i: number) => [...backing.keys()][i] ?? null,
};
(globalThis as unknown as Record<string, unknown>).window = {
  setInterval: setInterval.bind(globalThis),
  clearInterval: clearInterval.bind(globalThis),
  addEventListener: noop,
  removeEventListener: noop,
};
(globalThis as unknown as Record<string, unknown>).document = {
  addEventListener: noop,
  removeEventListener: noop,
  visibilityState: 'visible',
};

const { sha256, hmacSha256, utf8, toHex } = await import('../src/provenance/sha256');
const {
  deriveMintKey,
  prepareKey,
  mintWithKey,
  mintId,
  verifyId,
  setMintKey,
  clearMintKeys,
  idsOfCircuit,
  idsOfWorkbook,
  DEV_MINT_SECRET,
} = await import('../src/provenance/ids');
const { nextTrace, verifyTrace, textDigest, insertedChars } = await import('../src/provenance/trace');
const { assessIntegrity, MAX_TYPING_CHARS_PER_SEC } = await import('../src/provenance/integrity');
const { INTEGRITY_NOTICE, SUBMIT_INTEGRITY_SENTENCE, submitConfirmMessage } = await import('../src/provenance/notice');
const { useStore, selectPasteScope, autoSaveDelay, AUTO_SAVE_MAX_WAIT } = await import('../src/store');
const { buildSampleAssignment, buildCorrectSubmission } = await import('../src/devData/sampleData');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');
const { gradeSubmission } = await import('../src/engine/grader');

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const flush = () => new Promise((r) => setTimeout(r, 10));

// ─── [sha256/hmac] ─────────────────────────────────────────────────────────
console.log('\n[sha256/hmac]');
{
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'b'.repeat(1000), 'héllo ✓ 中文 🙂'];
  check('sha256 ≡ node:crypto (empty, padding edges, multi-block, UTF-8)',
    inputs.every((s) => toHex(sha256(utf8(s))) === createHash('sha256').update(s, 'utf8').digest('hex')));
  const keys = ['', 'key', 'k'.repeat(64), 'k'.repeat(131)];
  check('hmacSha256 ≡ node:crypto (empty, short, block-size and longer keys)',
    keys.every((k) => inputs.every((s) =>
      toHex(hmacSha256(utf8(k), utf8(s))) === createHmac('sha256', k).update(s, 'utf8').digest('hex'))));
  // RFC 4231 test cases 1–4, 6, 7 (5 is a truncation case).
  const rfc: [Uint8Array, Uint8Array, string][] = [
    [hex('0b'.repeat(20)), utf8('Hi There'), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
    [utf8('Jefe'), utf8('what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
    [hex('aa'.repeat(20)), hex('dd'.repeat(50)), '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe'],
    [hex('0102030405060708090a0b0c0d0e0f10111213141516171819'), hex('cd'.repeat(50)), '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b'],
    [hex('aa'.repeat(131)), utf8('Test Using Larger Than Block-Size Key - Hash Key First'), '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'],
    [hex('aa'.repeat(131)), utf8('This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.'), '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2'],
  ];
  rfc.forEach(([k, m, want], i) => check(`RFC 4231 vector ${[1, 2, 3, 4, 6, 7][i]}`, toHex(hmacSha256(k, m)) === want));
}

// ─── [mint] ────────────────────────────────────────────────────────────────
console.log('\n[mint]');
const SECRET = 'check-secret';
{
  const kA = deriveMintKey(SECRET, 'a@x.test', 'hw1');
  check('deriveMintKey: deterministic, email case-insensitive',
    kA === deriveMintKey(SECRET, 'A@X.test', 'hw1') && /^[0-9a-f]{64}$/.test(kA));
  check('…and different per student, per assignment, per secret',
    new Set([kA, deriveMintKey(SECRET, 'b@x.test', 'hw1'), deriveMintKey(SECRET, 'a@x.test', 'hw2'),
      deriveMintKey('other', 'a@x.test', 'hw1')]).size === 4);
  check("…and a '|' in an email cannot collide two fields",
    deriveMintKey(SECRET, 'a|b@x', 'c') !== deriveMintKey(SECRET, 'a', 'b@x|c'));
  const pA = prepareKey(kA)!;
  const minted = Array.from({ length: 1000 }, () => mintWithKey(pA));
  check('1000 keyed mints all verify under their key', minted.every((id) => verifyId(id, kA)));
  check('…all are well-formed v4 UUIDs (version 4, variant 8–b)', minted.every((id) => V4.test(id)));
  check('…and all are distinct', new Set(minted).size === 1000);
  const sandbox = Array.from({ length: 1000 }, () => mintId({ kind: 'sandbox' }));
  check('sandbox mints are v4 UUIDs that verify under no key',
    sandbox.every((id) => V4.test(id) && !verifyId(id, kA)));
  check('crypto.randomUUID() ids verify under no key',
    Array.from({ length: 1000 }, () => randomUUID()).every((id) => !verifyId(id, kA)));
  /** Flip bit `bit` (0 = least significant) of the UUID's 128 bits. */
  const flip = (id: string, bit: number) => {
    const h = (BigInt('0x' + id.replace(/-/g, '')) ^ (1n << BigInt(bit))).toString(16).padStart(32, '0');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const id = minted[0];
  check('flipping any one of the 48 tag bits fails verify',
    Array.from({ length: 48 }, (_, b) => flip(id, b)).every((f) => f !== id && !verifyId(f, kA)));
  check('flipping a nonce bit fails verify', !verifyId(flip(id, 100), kA) && !verifyId(flip(id, 70), kA));
  check("another student's key fails", !verifyId(id, deriveMintKey(SECRET, 'b@x.test', 'hw1')));
  check("another assignment's key fails", !verifyId(id, deriveMintKey(SECRET, 'a@x.test', 'hw2')));
  check('malformed ids and keys fail quietly',
    !verifyId('in1', kA) && !verifyId('', kA) && !verifyId(id, 'zz') && !verifyId(id, ''));

  clearMintKeys();
  const scope = { kind: 'assignment', assignmentId: 'hw1' } as const;
  check('the registry: no key registered → an assignment mint is unbound', !verifyId(mintId(scope), kA));
  setMintKey('hw1', kA);
  check('…setMintKey → assignment mints bind to that key', verifyId(mintId(scope), kA));
  check('…only for that assignment', !verifyId(mintId({ kind: 'assignment', assignmentId: 'hw9' }), kA));
  clearMintKeys();
  check('…clearMintKeys → unbound again', !verifyId(mintId(scope), kA));
}

// ─── [attribution] ─────────────────────────────────────────────────────────
console.log('\n[attribution]');
const SELF = 'self@x.test';
const FRIEND = 'friend@x.test';
{
  const ASG = 'hw-attr';
  const kSelf = deriveMintKey(SECRET, SELF, ASG);
  const kFriend = deriveMintKey(SECRET, FRIEND, ASG);
  const pSelf = prepareKey(kSelf)!;
  const pFriend = prepareKey(kFriend)!;
  const gate = (id: string, type: CircuitComponent['type'] = 'AND', internal?: CircuitData): CircuitComponent => ({
    id, type, x: 0, y: 0, label: type, ports: [],
    ...(internal ? { internalCircuit: internal } : {}),
  });
  const wire = (id: string, a: string, b: string): Wire =>
    ({ id, sourceComponentId: a, sourcePortId: 'out', targetComponentId: b, targetPortId: 'in1', value: 0 });
  const chain = (mint: () => string, n: number): CircuitData => {
    const components = Array.from({ length: n }, () => gate(mint()));
    const wires = components.slice(1).map((c, i) => wire(mint(), components[i].id, c.id));
    return { components, wires };
  };
  const self = () => mintWithKey(pSelf);
  const friend = () => mintWithKey(pFriend);
  // Q1: the student's own, with a box inside a box — 3 top-level ids (two
  // components, a wire), 4 inside the box (two gates, their wire, the inner
  // box), 1 inside that.
  const nested = chain(self, 1);
  const inner = chain(self, 2);
  inner.components.push(gate(self(), 'BOXED', nested));
  const q1: CircuitData = { components: [gate(self()), gate(self(), 'BOXED', inner)], wires: [] };
  q1.wires.push(wire(self(), q1.components[0].id, q1.components[1].id));
  const answers = [
    { questionId: 1, circuit: q1 },
    { questionId: 2, circuit: chain(friend, 3) },
    { questionId: 3, circuit: chain(() => randomUUID(), 2) },
    { questionId: 4, circuit: { components: [gate('legacy-1'), gate('legacy-2')], wires: [] } },
    { questionId: 5, circuit: { components: [gate(self()), gate(self()), gate(friend()), gate(randomUUID())], wires: [] } },
  ];
  const r = assessIntegrity({
    questionIds: [1, 2, 3, 4, 5],
    answers,
    self: { email: SELF, key: kSelf },
    others: [SELF, FRIEND, 'third@x.test'].map((e) => ({ email: e, key: deriveMintKey(SECRET, e, ASG) })),
    legacy: { ids: ['legacy-1', 'legacy-2'], summary: { '4': { c: 2, w: 0, t: 0 } } },
  });
  const q = (id: number) => r.questions.find((x) => x.questionId === id)!;
  const idFlags = (id: number) => q(id).flags.filter((f) => f.code.startsWith('ids-'));
  check('Q1: every id self-bound, BOXED internals (nested too) walked',
    q(1).ids.total === idsOfCircuit(q1).length && q(1).ids.total === 8 && q(1).ids.self === 8 && idFlags(1).length === 0);
  check("Q2: a friend's ids are attributed to the friend",
    q(2).ids.others.length === 1 && q(2).ids.others[0].email === FRIEND && q(2).ids.others[0].count === 5 &&
    q(2).ids.self === 0);
  check('…and flagged naming them, as something to look at',
    idFlags(2).some((f) => f.code === 'ids-other' && f.detail.includes(FRIEND) && f.detail.includes('to look at')));
  check('Q3: random ids come back unbound and are flagged',
    q(3).ids.unbound === 3 && idFlags(3).some((f) => f.code === 'ids-unbound'));
  check('Q4: ids in the legacy snapshot count as legacy, unflagged',
    q(4).ids.legacy === 2 && q(4).flags.length === 0);
  check('Q5: a mix is counted id by id',
    q(5).ids.self === 2 && q(5).ids.unbound === 1 && q(5).ids.others[0]?.count === 1);
  check('the student is never their own "other"', r.questions.every((x) => x.ids.others.every((o) => o.email !== SELF)));
  check('flagged counts the questions with a flag', r.flagged === r.questions.filter((x) => x.flags.length > 0).length);
  // A padded submission cannot tie the server up: past the search budget, ids
  // are not searched against everyone's keys (they still fail the self check).
  const { MAX_ATTRIBUTION_SEARCHES } = await import('../src/provenance/integrity');
  const padded = Array.from({ length: MAX_ATTRIBUTION_SEARCHES + 50 }, () => ({ id: friend(), type: 'AND', x: 0, y: 0, label: 'AND', ports: [] }));
  const t0 = performance.now();
  const capped = assessIntegrity({ questionIds: [1], answers: [{ questionId: 1, circuit: { components: padded, wires: [] } }],
    self: { email: SELF, key: kSelf },
    others: Array.from({ length: 80 }, (_, i) => ({ email: `s${i}@x.test`, key: deriveMintKey(SECRET, `s${i}@x.test`, ASG) }))
      .concat([{ email: FRIEND, key: kFriend }]) }).questions[0];
  check(`attribution searches stop at MAX_ATTRIBUTION_SEARCHES (${MAX_ATTRIBUTION_SEARCHES}); the rest count as unbound`,
    capped.ids.others[0]?.count === MAX_ATTRIBUTION_SEARCHES && capped.ids.unbound === 50 && performance.now() - t0 < 5000);
  check('malformed answers are skipped, never thrown on',
    assessIntegrity({ questionIds: [1], answers: [null, 7, { questionId: 'x' }, { questionId: 1, circuit: 'nope', provenance: 'bad' }],
      self: { email: SELF, key: kSelf }, others: [] }).questions.length === 1);

  // One entry per assignment question, assessing the answer the grader grades:
  // with a question id answered twice, the LAST answer (gradeSubmission's
  // Map) — so a decoy first answer cannot hide the graded one's flags.
  const def = buildSampleAssignment();
  const q1Id = def.questions[0].id;
  // The friend's CORRECT Q1 (their ids), behind an empty decoy answer.
  const correct = buildCorrectSubmission(SELF).answers.find((a) => a.questionId === q1Id)!.circuit!;
  const reId = new Map(correct.components.map((c) => [c.id, friend()]));
  const friendCircuit: CircuitData = {
    components: correct.components.map((c) => ({ ...c, id: reId.get(c.id)! })),
    wires: correct.wires.map((w) => ({
      ...w, id: friend(),
      sourceComponentId: reId.get(w.sourceComponentId) ?? w.sourceComponentId,
      targetComponentId: reId.get(w.targetComponentId) ?? w.targetComponentId,
    })),
  };
  const dupAnswers = [
    { questionId: q1Id, circuit: { components: [], wires: [] } },
    { questionId: q1Id, circuit: friendCircuit },
  ];
  const graded = gradeSubmission(def, { assignmentTitle: def.title, student: SELF, submittedAt: '', answers: dupAnswers });
  const gq1 = graded.questions.find((x) => x.questionId === q1Id)!;
  check('(the grader grades the LAST answer for a question: the transplant passes)',
    gq1.total > 0 && gq1.passed === gq1.total, JSON.stringify([gq1.passed, gq1.total]));
  const dup = assessIntegrity({
    questionIds: def.questions.map((x) => x.id),
    answers: dupAnswers,
    self: { email: SELF, key: kSelf },
    others: [{ email: FRIEND, key: kFriend }],
  });
  const dupQ = dup.questions.filter((x) => x.questionId === q1Id);
  check('a question answered twice: ONE entry, for the last answer (the one the grader grades)',
    dupQ.length === 1 && dupQ[0].ids.total === idsOfCircuit(friendCircuit).length &&
    dupQ[0].ids.others[0]?.email === FRIEND && dupQ[0].flags.some((f) => f.code === 'ids-other'),
    JSON.stringify(dup.questions.map((x) => [x.questionId, x.flags.map((f) => f.code)])));
  check('answers for ids the assignment lacks are never read',
    assessIntegrity({ questionIds: [1], answers: [{ questionId: 99, circuit: chain(friend, 2) }],
      self: { email: SELF, key: kSelf }, others: [{ email: FRIEND, key: kFriend }] }).questions.length === 0);
  // Padding: 60,000 answers (well under the 10 MB body limit), every one with
  // a signed-looking record under no key — bounded by the assignment's size.
  const rec0 = nextTrace(null, { compIns: 1 }, { questionId: 1, textBefore: {}, textAfter: {}, countBefore: 0, gapMs: 0 }, pFriend);
  const pad = Array.from({ length: 60_000 }, (_, i) => ({
    questionId: 1000 + (i % 500),
    circuit: { components: [], wires: [] },
    provenance: { ...rec0, sig: 'f'.repeat(32) },
  }));
  const tPad = performance.now();
  const padded2 = assessIntegrity({
    questionIds: [1, 2, 3],
    answers: [...pad, { questionId: 1, circuit: chain(self, 2) }],
    self: { email: SELF, key: kSelf },
    others: Array.from({ length: 80 }, (_, i) => ({ email: `s${i}@x.test`, key: deriveMintKey(SECRET, `s${i}@x.test`, ASG) })),
    history: Array.from({ length: 2000 }, () => ({ '1': { c: 2, w: 1, t: 0 } })),
  });
  const padMs = performance.now() - tPad;
  check(`a padded submission (60,000 answers, 80 keys, 2,000 saves) is assessed per assignment question, fast (${padMs.toFixed(0)} ms)`,
    padded2.questions.length === 1 && padded2.questions[0].ids.self === 3 && padMs < 1000);

  // The legacy snapshot's ids: the questions' circuits AND the box library's
  // internals (a library instance placed later keeps them).
  const libBox = chain(() => randomUUID(), 2);
  const oldBox = chain(() => randomUUID(), 1);
  const canvas = chain(() => randomUUID(), 2);
  const wbIds = idsOfWorkbook({
    questionCircuits: { 1: { ...canvas, boxes: [], confirmedBoxes: [{ internalComponents: oldBox.components, internalWires: oldBox.wires }] } },
    boxLibrary: [{ internalComponents: libBox.components, internalWires: libBox.wires }],
  } as never);
  check('idsOfWorkbook: canvas + boxLibrary + legacy per-question confirmedBoxes internals',
    wbIds.length === 3 + 3 + 1 &&
    [...idsOfCircuit(canvas), ...idsOfCircuit(libBox), ...idsOfCircuit(oldBox)].every((id) => wbIds.includes(id)));
  check('…and tolerates malformed saved state',
    idsOfWorkbook(null).length === 0 &&
    idsOfWorkbook({ questionCircuits: { 1: null }, boxLibrary: [null, 7] } as never).length === 0);
}

// ─── [store] ───────────────────────────────────────────────────────────────
console.log('\n[store]');
const A = 'student-a@x.test';
const s = () => useStore.getState();
const keyA = deriveMintKey(DEV_MINT_SECRET, A, 'prov-hw-a');
const keyB = deriveMintKey(DEV_MINT_SECRET, A, 'prov-hw-b');
{
  const hwA: AssignmentData = { ...buildSampleAssignment(), id: 'prov-hw-a' };
  const hwB: AssignmentData = { ...buildSampleAssignment(), id: 'prov-hw-b' };
  for (const hw of [hwA, hwB]) {
    await localAssignmentStore.save(hw);
    await localAssignmentStore.setVisible(hw.id, true);
  }
  s().resetForPrincipal(A);
  check('A opens HW-A', (await s().openAssignment('prov-hw-a')) === true);
  s().switchQuestion(0); // Q1, CC
  const before = s().components.length;
  s().addComponent('INPUT', 200, 180);
  s().addComponent('INPUT', 200, 260);
  s().addComponent('AND', 320, 200);
  s().addComponent('OUTPUT', 460, 210);
  const [in1, in2, and, out] = s().components.slice(before);
  s().addWire(in1.id, 'out', and.id, 'in1');
  s().addWire(in2.id, 'out', and.id, 'in2');
  s().addWire(and.id, 'out', out.id, 'in');
  check('addComponent ids bind to the dev key of (A, HW-A)', [in1, in2, and, out].every((c) => verifyId(c.id, keyA)));
  check('addWire ids bind too', s().wires.length === 3 && s().wires.every((w) => verifyId(w.id, keyA)));
  // The box id: the canvas mints it with exactly this expression (pinned below).
  const boxId = mintId(selectPasteScope(s()));
  check("the box id (CircuitCanvas's mint) binds too", verifyId(boxId, keyA));
  check('…and CircuitCanvas mints it that way',
    readFileSync(new URL('../src/components/CircuitCanvas.tsx', import.meta.url), 'utf8')
      .includes('id: mintId(selectPasteScope(useStore.getState()))'));
  const idsBeforeBox = new Set(s().components.map((c) => c.id));
  s().addBox({ id: boxId, name: '', x: 150, y: 120, width: 400, height: 220, componentIds: [], inputPortIds: [], outputPortIds: [] });
  check('confirmBox succeeds', s().confirmBox(boxId) === null);
  const lib = s().confirmedBoxLibrary.find((b) => b.id === boxId)!;
  check('confirmBox keeps the ids (the library internals are the same components)',
    lib.internalComponents.every((c) => idsBeforeBox.has(c.id)) &&
    s().components.every((c) => idsBeforeBox.has(c.id)));
  s().placeBoxInstance(boxId, 400, 420);
  const placed = s().components.find((c) => c.type === 'BOXED')!;
  check('placeBoxInstance mints the instance id under the key', verifyId(placed.id, keyA));
  check("…and keeps the library's internal ids",
    JSON.stringify(idsOfCircuit(placed.internalCircuit)) ===
      JSON.stringify(idsOfCircuit({ components: lib.internalComponents, wires: lib.internalWires })));
  const snapshot = JSON.stringify(s().components.map((c) => c.id));
  s().undo();
  check('undo restores the earlier ids', !s().components.some((c) => c.id === placed.id));
  s().redo();
  check('redo brings back the same ids', JSON.stringify(s().components.map((c) => c.id)) === snapshot);

  // Copy in HW-A (Q1), paste in HW-B (Q1): re-minted under HW-B, internals too.
  s().setSelectedIds([in1.id, and.id, placed.id]);
  s().copySelected();
  s().goHome();
  check('A opens HW-B', (await s().openAssignment('prov-hw-b')) === true);
  s().switchQuestion(0);
  const beforePaste = new Set(s().components.map((c) => c.id));
  check('the paste is accepted', s().paste() === null);
  const pasted = s().components.filter((c) => !beforePaste.has(c.id));
  const pastedBox = pasted.find((c) => c.type === 'BOXED');
  check('three components pasted, every id minted under HW-B, none under HW-A',
    pasted.length === 3 && pasted.every((c) => verifyId(c.id, keyB) && !verifyId(c.id, keyA)));
  check('…the internal wire too',
    s().wires.length === 1 && verifyId(s().wires[0].id, keyB) &&
    s().wires[0].sourceComponentId !== in1.id && pasted.some((c) => c.id === s().wires[0].targetComponentId));
  const internalIds = idsOfCircuit(pastedBox?.internalCircuit);
  check('…the BOXED internals re-minted under HW-B',
    internalIds.length > 0 && internalIds.every((id) => verifyId(id, keyB)));
  const ic = pastedBox?.internalCircuit;
  const icIds = new Set(ic?.components.map((c) => c.id));
  check('…their wires re-pointed at the new internal ids',
    (ic?.wires.length ?? 0) > 0 && ic!.wires.every((w) => icIds.has(w.sourceComponentId) && icIds.has(w.targetComponentId)));
  check('…and boxedCircuitId, a library reference, untouched', pastedBox?.boxedCircuitId === boxId);
  check('the paste counts as ONE insertion of 3 in the trace',
    s().questionTrace?.maxCompIns === 3 && s().questionTrace?.compAdded === 3);

  s().goHome();
  s().enterSandbox();
  const sb = new Set(s().components.map((c) => c.id));
  s().addComponent('AND', 100, 100);
  const sbGate = s().components.find((c) => !sb.has(c.id))!;
  check('a sandbox add is unbound (neither assignment key)', !verifyId(sbGate.id, keyA) && !verifyId(sbGate.id, keyB));
  check('the sandbox keeps no trace', s().questionTrace === null || s().assignment === null);
}

// ─── [stamp] ───────────────────────────────────────────────────────────────
console.log('\n[stamp]');
{
  const key = prepareKey(deriveMintKey(SECRET, SELF, 'hw-stamp'))!;
  const ctx = (before: string, after: string, qid = 7) => ({
    questionId: qid, textBefore: { responseText: before }, textAfter: { responseText: after }, countBefore: 0, gapMs: 1000,
  });
  const rec = nextTrace(null, { textIns: 5 }, ctx('', 'hello'), key);
  check('a fresh record verifies for its question', verifyTrace(7, rec, key) && rec.td === textDigest({ responseText: 'hello' }));
  check('…and fails when moved to another question', !verifyTrace(8, rec, key));
  const fields: (keyof QuestionProvenance)[] = ['edits', 'activeMs', 'textIns', 'maxTextIns', 'compAdded', 'maxCompIns', 'outside'];
  check('…and fails when any trace field changes',
    fields.every((f) => !verifyTrace(7, { ...rec, [f]: (rec[f] as number) + 1 }, key)) &&
    !verifyTrace(7, { ...rec, td: textDigest({ responseText: 'hellO' }) }, key) &&
    !verifyTrace(7, { ...rec, base: { c: 1, t: 0 } }, key));
  const k = deriveMintKey(SECRET, SELF, 'hw-stamp');
  const textCheck = (text: string) => assessIntegrity({
    questionIds: [7],
    answers: [{ questionId: 7, circuit: { components: [], wires: [] }, responseText: text, provenance: rec }],
    self: { email: SELF, key: k }, others: [],
  }).questions[0];
  check('the stamp holds for its own text', textCheck('hello').text === 'self' && textCheck('hello').flags.length === 0);
  check('…and reads as a mismatch once the text changes',
    textCheck('hellO').text === 'mismatch' && textCheck('hellO').flags.some((f) => f.code === 'text-mismatch'));
  const rec2 = nextTrace(rec, { textIns: 1 }, ctx('hello WORLD', 'hello WORLD!'), key);
  check('an edit after an outside text change sets `outside`', rec2.outside === 1 && verifyTrace(7, rec2, key));
  const rec3 = nextTrace(rec2, { textIns: 1 }, ctx('hello WORLD!', 'hello WORLD!!'), key);
  check('…sticky: it stays through later edits', rec3.outside === 1 && rec3.edits === 3);
  const forged = nextTrace({ ...rec, maxTextIns: 0, sig: 'f'.repeat(32) }, { textIns: 1 }, ctx('hello', 'hello!'), key);
  check('a forged record is not continued: the trace restarts with the content as its base',
    forged.edits === 1 && forged.base?.t === 5);

  // The store stamps at edit time (Q14, the sample's open question).
  await s().openAssignment('prov-hw-a');
  s().switchQuestion(13);
  const q14 = s().assignment!.questions[13].id;
  for (const t of ['I', 'I w', 'I wou', 'I would']) s().setOpenResponse(t);
  const live = s().questionTrace!;
  check('setOpenResponse signs the record under the key, for its question',
    live != null && verifyTrace(q14, live, prepareKey(keyA)!) && live.td === textDigest({ responseText: 'I would' }));
  check('…counting the inserted characters, largest insertion included',
    live.textIns >= 7 && live.maxTextIns === 2);
  useStore.setState({ openResponse: 'I would INJECTED from outside' });
  s().setOpenResponse('I would INJECTED from outside!');
  check('an in-store edit after an outside change bumps `outside`', s().questionTrace?.outside === 1);
  s().setOpenResponse('I would INJECTED from outside!!');
  check('…and it stays', s().questionTrace?.outside === 1);
  s().goHome();
}

// ─── [trace] ───────────────────────────────────────────────────────────────
console.log('\n[trace]');
const ASG_T = 'hw-trace';
const kT = deriveMintKey(SECRET, SELF, ASG_T);
const pT = prepareKey(kT)!;
const judge = (answer: Record<string, unknown>, history?: Record<string, { c: number; w: number; t: number }>[]) =>
  assessIntegrity({ questionIds: [3], answers: [{ questionId: 3, circuit: { components: [], wires: [] }, ...answer }],
    self: { email: SELF, key: kT }, others: [], history }).questions[0];
const codes = (q: { flags: { code: string }[] }) => q.flags.map((f) => f.code);
{
  const P = 'Binary, because a tally grows linearly with the value while binary grows with its logarithm, so twenty bits suffice.';
  const tctx = (before: string, after: string) => ({
    questionId: 3, textBefore: { responseText: before }, textAfter: { responseText: after }, countBefore: 0, gapMs: 800,
  });
  const whole = nextTrace(null, { textIns: P.length }, tctx('', P), pT);
  check('a paragraph set in one insertion is flagged one-piece',
    codes(judge({ responseText: P, provenance: whole })).includes('one-piece-text'));
  let typed: QuestionProvenance | null = null;
  let cur = '';
  for (let i = 0; i < P.length; i += 3) {
    const next = P.slice(0, i + 3);
    typed = nextTrace(typed, { textIns: insertedChars(cur, next) }, tctx(cur, next), pT);
    cur = next;
  }
  const honest = judge({ responseText: P, provenance: typed });
  check('the same text typed in small steps is not flagged', honest.text === 'self' && honest.flags.length === 0,
    JSON.stringify(honest.flags));
  check('…and its record sums active time', (honest.trace?.activeMs ?? 0) > 0 && honest.trace?.edits === Math.ceil(P.length / 3));

  // A script that "types" one character per input event: no big insertion,
  // but a rate no person types at.
  const typeAt = (gapMs: number) => {
    let r: QuestionProvenance | null = null;
    for (let i = 1; i <= P.length; i++) {
      r = nextTrace(r, { textIns: 1 }, { ...tctx(P.slice(0, i - 1), P.slice(0, i)), gapMs }, pT);
    }
    return judge({ responseText: P, provenance: r });
  };
  const script = typeAt(0);
  check('a paragraph "typed" a character at a time with no delay is flagged too-fast',
    codes(script).includes('too-fast') && !codes(script).includes('one-piece-text') &&
    script.flags.find((f) => f.code === 'too-fast')!.detail.includes('to look at'),
    JSON.stringify(codes(script)));
  check(`…and at 30 ms a character (faster than ${MAX_TYPING_CHARS_PER_SEC}/s) too`, codes(typeAt(30)).includes('too-fast'));
  check('…but not at a fast typist\'s 100 ms a character', !codes(typeAt(100)).includes('too-fast'));
  check('one big insertion is one-piece-text, not also too-fast',
    !codes(judge({ responseText: P, provenance: whole })).includes('too-fast'));

  // Injected: typed a little, the rest set outside the editor, one keystroke on.
  let small = nextTrace(null, { textIns: 3 }, tctx('', 'Bin'), pT);
  const injected = P;
  small = nextTrace(small, { textIns: 1 }, tctx(injected, injected + '!'), pT);
  const inj = judge({ responseText: injected + '!', provenance: small });
  check('injected text the trace cannot account for is flagged (outside + unaccounted)',
    codes(inj).includes('outside') && codes(inj).includes('unaccounted'), JSON.stringify(codes(inj)));
  const bare = judge({ responseText: P });
  check('text with no record at all is flagged unsigned and record-missing',
    bare.text === 'unsigned' && codes(bare).includes('text-unsigned') && codes(bare).includes('record-missing'));

  // A circuit: eight components in one paste vs eight added one by one.
  const eight = { components: Array.from({ length: 8 }, () => ({ id: mintWithKey(pT), type: 'AND', x: 0, y: 0, label: 'AND', ports: [] })), wires: [] };
  const cctx = (n: number) => ({ questionId: 3, textBefore: {}, textAfter: {}, countBefore: n, gapMs: 500 });
  const pasteRec = nextTrace(null, { compIns: 8 }, cctx(0), pT);
  const pasteQ = judge({ circuit: eight, provenance: pasteRec });
  const pasteFlag = pasteQ.flags.find((f) => f.code === 'one-piece-circuit');
  check("a big paste is flagged, its detail saying it was an in-app paste",
    pasteFlag != null && pasteFlag.detail.includes('in-app paste') && pasteFlag.detail.includes('to look at'));
  check('…and its ids are all the student\'s own (an in-app paste, not a transplant)',
    pasteQ.ids.self === 8 && !codes(pasteQ).some((c) => c.startsWith('ids-')));
  let built: QuestionProvenance | null = null;
  for (let i = 0; i < 8; i++) built = nextTrace(built, { compIns: 1 }, cctx(i), pT);
  check('the same circuit added one at a time is not flagged', judge({ circuit: eight, provenance: built }).flags.length === 0);
  const noRecord = judge({ circuit: eight });
  check('a circuit with no record is flagged record-missing', codes(noRecord).includes('record-missing'));

  // In the store: a text box's own undo (Cmd+Z brings a deleted paragraph
  // back as ONE change) restores what was already counted — no insertion.
  await s().openAssignment('prov-hw-a');
  s().switchQuestion(13);
  const q14 = s().assignment!.questions[13].id;
  s().setOpenResponse('');
  let typedText = '';
  for (const ch of P) {
    typedText += ch;
    s().setOpenResponse(typedText);
  }
  const beforeCut = s().questionTrace!;
  s().setOpenResponse(''); // select all, delete
  s().setOpenResponse(P); // the browser's undo
  const afterUndo = s().questionTrace!;
  check('a text box\'s undo restoring a deleted paragraph inserts nothing new (still one edit each)',
    afterUndo.textIns === beforeCut.textIns && afterUndo.maxTextIns === beforeCut.maxTextIns &&
    afterUndo.edits === beforeCut.edits + 2 && afterUndo.maxTextIns < 10,
    JSON.stringify([beforeCut.textIns, afterUndo.textIns, beforeCut.maxTextIns, afterUndo.maxTextIns]));
  const undone = assessIntegrity({ questionIds: [q14], answers: [{ questionId: q14, responseText: P, provenance: afterUndo }],
    self: { email: A, key: keyA }, others: [] }).questions[0];
  check('…so the restored paragraph is not flagged one-piece', !codes(undone).includes('one-piece-text'), JSON.stringify(codes(undone)));
  s().setOpenResponse(P + ' Z');
  check('…while new text after it still counts', s().questionTrace!.textIns === afterUndo.textIns + 2);
  s().goHome();
}

// ─── [history] ─────────────────────────────────────────────────────────────
console.log('\n[history]');
{
  const ten = { components: Array.from({ length: 10 }, () => ({ id: mintWithKey(pT), type: 'AND', x: 0, y: 0, label: 'AND', ports: [] })), wires: [] };
  // A scripted build: ten single adds at machine speed (no one insertion is
  // big, so only the save history sees it arrive in one burst).
  let rec: QuestionProvenance | null = null;
  for (let i = 0; i < 10; i++) rec = nextTrace(rec, { compIns: 1 }, { questionId: 3, textBefore: {}, textAfter: {}, countBefore: i, gapMs: 0 }, pT);
  const size = (c: number) => ({ '3': { c, w: 0, t: 0 } });
  const jump = judge({ circuit: ten, provenance: rec }, [size(0), size(10)]);
  check('one-save fires on a jump from 0 to the final count', codes(jump).includes('one-save'), JSON.stringify(codes(jump)));
  check('…its detail carrying the record\'s own account',
    jump.flags.find((f) => f.code === 'one-save')!.detail.includes('10 edits'));
  const gradual = judge({ circuit: ten, provenance: rec }, [size(2), size(4), size(6), size(8), size(10)]);
  check('…and not on gradual saves', !codes(gradual).includes('one-save'));
  check('…nor with no history (local mode)', !codes(judge({ circuit: ten, provenance: rec })).includes('one-save'));
  const unsaved = judge({ circuit: ten, provenance: rec }, []);
  check('…but work that never appeared in a save counts as one jump to the submission', codes(unsaved).includes('one-save'));
  const restored = judge({ circuit: ten, provenance: rec }, [size(2), size(4), size(6), size(8), size(10), size(0), size(10)]);
  check('…nor on work deleted, saved, and restored (each save measured against the most an earlier one held)',
    !codes(restored).includes('one-save'), JSON.stringify(codes(restored)));
  const pastHigh = judge({ circuit: ten, provenance: rec }, [size(2), size(0), size(10)]);
  check('…while a rise past that high-water mark still counts', codes(pastHigh).includes('one-save'));

  // Autosave lands at least once per burst: the 1.5 s debounce is cut short
  // AUTO_SAVE_MAX_WAIT after the first unsaved change, so "between two saves"
  // means within one burst, not a whole unbroken session.
  check('autoSaveDelay: the usual 1.5 s pause', autoSaveDelay(0, 0) === 1500 && autoSaveDelay(0, 5000) === 1500);
  check('…cut short by the max wait after the first unsaved change',
    autoSaveDelay(0, AUTO_SAVE_MAX_WAIT - 400) === 400 && autoSaveDelay(0, AUTO_SAVE_MAX_WAIT + 5000) === 0);
  await s().openAssignment('prov-hw-a');
  s().switchQuestion(13);
  await new Promise((r) => setTimeout(r, 1700)); // the open's own save lands
  check('(the editor is saved before the burst)', s().autoSaveStatus === 'saved');
  const realNow = Date.now;
  const realSetTimeout = globalThis.setTimeout;
  const delays: number[] = [];
  let T = 5_000_000;
  Date.now = () => T;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return realSetTimeout(fn, ms);
  }) as typeof setTimeout;
  try {
    // One keystroke a second for ten seconds: never a 1.5 s pause.
    let text = s().openResponse;
    for (let i = 0; i <= 10; i++) {
      text += 'k';
      s().setOpenResponse(text);
      T += 1000;
    }
  } finally {
    Date.now = realNow;
    globalThis.setTimeout = realSetTimeout;
  }
  check('an unbroken burst: the save is due 1.5 s after each change until the max wait, then at once',
    delays.length === 11 && delays.slice(0, 9).every((d) => d === 1500) && delays[9] === 1000 && delays[10] === 0,
    JSON.stringify(delays));
  await flush();
  await flush();
  check('…and it lands mid-burst', s().autoSaveStatus === 'saved');
  s().goHome();
}

// ─── [never scores] ────────────────────────────────────────────────────────
console.log('\n[never scores]');
{
  const def = buildSampleAssignment();
  const plain = buildCorrectSubmission(SELF);
  const rec = nextTrace(null, { compIns: 1 }, { questionId: 1, textBefore: {}, textAfter: {}, countBefore: 0, gapMs: 0 }, pT);
  const withProv = { ...plain, answers: plain.answers.map((a) => ({ ...a, provenance: rec })) };
  check('the grade is deep-equal with and without provenance',
    JSON.stringify(gradeSubmission(def, plain)) === JSON.stringify(gradeSubmission(def, withProv)));
  check('integrity.ts imports no grader',
    !/engine\/grader|gradeSubmission|gradeQuestion/.test(readFileSync(new URL('../src/provenance/integrity.ts', import.meta.url), 'utf8')));
}

// ─── [grep gate] ───────────────────────────────────────────────────────────
console.log('\n[grep gate]');
{
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  const files = [...walk(join(root, 'app/src')), ...walk(join(root, 'server/src'))];
  const offenders = files.filter((f) => /from ['"]uuid['"]|require\(['"]uuid['"]\)|randomUUID/.test(readFileSync(f, 'utf8')));
  check('no uuid import and no randomUUID in app/src or server/src (ids come from mintId)',
    offenders.length === 0, offenders.map((f) => relative(root, f)).join(', '));
  const provDir = join(root, 'app/src/provenance');
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  for (const f of readdirSync(provDir)) {
    const src = stripComments(readFileSync(join(provDir, f), 'utf8'));
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    check(`provenance/${f}: relative imports only (no npm package)`, imports.every((i) => i.startsWith('.')), imports.join(', '));
    check(`provenance/${f}: no DOM-only API`,
      !/\b(window|document|localStorage|sessionStorage|navigator|HTMLElement|crypto\.subtle)\b/.test(src));
  }
}

// ─── [notices] ─────────────────────────────────────────────────────────────
console.log('\n[notices]');
{
  s().enterSandbox();
  const wb = JSON.parse(s().exportWorkbook());
  check('an exported workbook carries the notice', wb.notice === INTEGRITY_NOTICE);
  check('…and importing it ignores the field', (() => { s().importWorkbook(JSON.stringify(wb)); return s().workbookOpen && s().tabs.length > 0; })());
  check('an exported worksheet carries it', JSON.parse(s().exportProject()).notice === INTEGRITY_NOTICE);
  await s().openAssignment('prov-hw-a');
  check('an exported submission carries it', JSON.parse(s().exportSubmission(A) ?? '{}').notice === INTEGRITY_NOTICE);
  check('the notice speaks to the person and to AI assistants, openly',
    INTEGRITY_NOTICE.includes('academic integrity') && INTEGRITY_NOTICE.includes('AI assistants'));
  check('the submit confirmation carries the disclosure sentence',
    submitConfirmMessage('HW1').includes(SUBMIT_INTEGRITY_SENTENCE) &&
    SUBMIT_INTEGRITY_SENTENCE === 'The platform checks that submitted work was created in your own editor.' &&
    submitConfirmMessage('HW1', { saved: true }).includes('saved work'));
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const f of ['AssignmentOverview', 'MenuBar', 'HomeScreen']) {
    const text = src(`../src/components/${f}.tsx`);
    check(`${f}: its Submit asks through submitConfirmMessage (one wording)`,
      text.includes('confirm(submitConfirmMessage(') && !text.includes('This records a snapshot'));
  }
  check('main.tsx prints the banner in production builds only',
    /if \(import\.meta\.env\.PROD\) printIntegrityBanner\(\)/.test(src('../src/main.tsx')));
  const vite = src('../vite.config.ts');
  check('vite.config.ts prepends INTEGRITY_NOTICE to the bundle after minification',
    /import \{ INTEGRITY_NOTICE \} from '\.\/src\/provenance\/notice/.test(vite) && vite.includes('generateBundle'));
  s().goHome();
}

await flush();
console.log(failures === 0 ? '\nprovenanceCheck: all checks passed' : `\nprovenanceCheck: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
