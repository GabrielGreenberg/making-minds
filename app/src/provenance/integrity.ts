// The integrity check at submit (task 034): per question, whose ids these
// are, whether the answer text carries this student's stamp, and whether the
// editing record says the work arrived in one piece. Pure — the server runs it
// on receipt (app.ts, over every roster key) and the local SubmissionStore runs
// it with the dev keys; it imports no grader (tools/remoteStoreCheck.ts's grep
// gate covers the remote module graph).
//
// Every flag is something TO LOOK AT, never a verdict: the summary sits
// beside the grade (SubmissionRecord.integrity), never changes a score, and
// students never see it (server/src/sanitize.ts). An in-app paste of the
// student's own work between their own questions or assignments is flagged
// too — its detail says it arrived in one in-app paste, so an instructor can
// tell it from an out-of-app transplant (whose ids name someone else, or
// nobody).
//
// Thresholds are named constants below; tools/provenanceCheck.ts pins them.

import type {
  IntegrityFlag,
  QuestionIntegrity,
  QuestionProvenance,
  SubmissionIntegrity,
} from '../types';
import { idsOfCircuit, prepareKey, verifyWithKey } from './ids';
import type { HmacKey } from './sha256';
import { isTraceShape, textDigest, textLength, verifyTrace, type TextContent } from './trace';

/** One-piece text: the largest insertion is at least this share of the
 *  final text, and the text is at least this long. */
export const ONE_PIECE_TEXT_SHARE = 0.5;
export const ONE_PIECE_TEXT_MIN_CHARS = 40;
/** One-piece circuit: the largest paste is at least this share of the final
 *  component count, and the circuit has at least this many components. */
export const ONE_PIECE_CIRCUIT_SHARE = 0.5;
export const ONE_PIECE_CIRCUIT_MIN_COMPONENTS = 5;
/** Typed too fast: the characters of a record's smaller insertions (all but
 *  the largest, which one-piece-text judges) per second of active editing
 *  exceed what a person types — 25 a second is 300 words a minute, beyond any
 *  sustained typist — counted once at least this many were typed. */
export const MAX_TYPING_CHARS_PER_SEC = 25;
export const TYPING_RATE_MIN_CHARS = 40;
/** One save: the largest rise of the work past everything an earlier save
 *  (from empty, through every save, to the submission) already held is at
 *  least this share of the final work, and the work is at least this big.
 *  Autosave lands at least once per burst of editing (store.ts
 *  AUTO_SAVE_MAX_WAIT), so "between two saves" means within one burst. */
export const ONE_SAVE_SHARE = 0.8;
export const ONE_SAVE_MIN_COMPONENTS = 5;
export const ONE_SAVE_MIN_CHARS = 200;
/** Ids per submission searched against everyone else's keys (each search is
 *  one MAC per key). A whole homework's worth of transplanted ids fits many
 *  times over; beyond it, an id that is not the student's own simply counts as
 *  unbound — the cap keeps a padded submission from tying up the server. */
export const MAX_ATTRIBUTION_SEARCHES = 2000;

/** Per question: components, wires and answer-text characters. */
export type QuestionSize = { c: number; w: number; t: number };
/** A save's coarse summary, keyed by question id — the server's per-save
 *  history row (never a snapshot of the work). */
export type SaveSummary = Record<string, QuestionSize>;

/** What a workbook already held when the watermark arrived (server/src/db.ts
 *  `legacy_content`, snapshotted once): its ids and its per-question size. */
export interface LegacyContent {
  ids: string[];
  summary: SaveSummary;
}

type LooseCircuit = { components?: unknown; wires?: unknown };

function sizeOf(circuit: LooseCircuit | undefined, text: TextContent): QuestionSize {
  return {
    c: Array.isArray(circuit?.components) ? circuit.components.length : 0,
    w: Array.isArray(circuit?.wires) ? circuit.wires.length : 0,
    t: textLength(text),
  };
}

/** The coarse per-question summary of a saved workbook state. */
export function saveSummary(state: { questionCircuits?: unknown } | null | undefined): SaveSummary {
  const out: SaveSummary = {};
  const qcs = state?.questionCircuits;
  if (!qcs || typeof qcs !== 'object') return out;
  for (const [qid, qc] of Object.entries(qcs as Record<string, unknown>)) {
    if (!qc || typeof qc !== 'object') continue;
    const q = qc as LooseCircuit & TextContent;
    out[qid] = sizeOf(q, { responseText: q.responseText, fillAnswers: q.fillAnswers });
  }
  return out;
}

export interface IntegrityInput {
  /** The assignment's question ids: one entry per question answered, and
   *  nothing else — what a padded submission adds beyond them is never read. */
  questionIds: number[];
  /** The submission's answers (SubmissionData.answers, as received). Like
   *  the grader (its answers Map), the LAST answer for a question id is the
   *  one assessed: the one that is graded. */
  answers: unknown;
  /** The submitting student and their mint key (hex) for this assignment. */
  self: { email: string; key: string };
  /** Everyone else's keys for this assignment — whose ids a transplant carries. */
  others: { email: string; key: string }[];
  legacy?: LegacyContent | null;
  /** The server's save history for this workbook, oldest first. Absent (local
   *  mode) = no one-save check. */
  history?: SaveSummary[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function checkQuestion(
  answer: Record<string, unknown>,
  self: HmacKey | null,
  others: { email: string; key: HmacKey }[],
  legacyIds: Set<string>,
  input: IntegrityInput,
  budget: { searches: number },
): QuestionIntegrity {
  const questionId = answer.questionId as number;
  const circuit = (answer.circuit && typeof answer.circuit === 'object' ? answer.circuit : undefined) as
    | LooseCircuit
    | undefined;
  const text: TextContent = {
    responseText: typeof answer.responseText === 'string' ? answer.responseText : undefined,
    fillAnswers: Array.isArray(answer.fillAnswers) ? (answer.fillAnswers as string[]) : undefined,
  };
  const size = sizeOf(circuit, text);
  const legacyQ = input.legacy?.summary[String(questionId)];
  const flags: IntegrityFlag[] = [];

  // ── ids: self, legacy, a classmate's, or nobody's ──
  const ids = idsOfCircuit(circuit);
  let selfCount = 0;
  let legacy = 0;
  let unbound = 0;
  const byOther = new Map<string, number>();
  for (const id of ids) {
    if (self && verifyWithKey(id, self)) selfCount++;
    else if (legacyIds.has(id)) legacy++;
    else {
      const owner = budget.searches-- > 0 ? others.find((o) => verifyWithKey(id, o.key)) : undefined;
      if (owner) byOther.set(owner.email, (byOther.get(owner.email) ?? 0) + 1);
      else unbound++;
    }
  }
  const otherIds = [...byOther].map(([email, count]) => ({ email, count }));
  for (const o of otherIds) {
    flags.push({
      code: 'ids-other',
      detail: `${o.count} of ${plural(ids.length, 'id')} were created in ${o.email}'s editor for this assignment — to look at.`,
    });
  }
  if (unbound > 0) {
    flags.push({
      code: 'ids-unbound',
      detail:
        `${unbound} of ${plural(ids.length, 'id')} were not created in this student's editor for this assignment ` +
        '(brought in from the sandbox, a file, the browser console or another tool?) — to look at.',
    });
  }

  // ── the editing record: whose signature ──
  const prov = answer.provenance;
  let record: QuestionIntegrity['record'] = 'none';
  let from: string | undefined;
  if (prov !== undefined && prov !== null) {
    if (self && verifyTrace(questionId, prov, self)) record = 'self';
    else {
      const owner = isTraceShape(prov) ? others.find((o) => verifyTrace(questionId, prov, o.key)) : undefined;
      if (owner) {
        record = 'other';
        from = owner.email;
      } else record = 'invalid';
    }
  }
  const trace = record === 'self' ? (prov as QuestionProvenance) : null;

  // ── the text stamp ──
  let textStatus: QuestionIntegrity['text'] = 'none';
  if (size.t > 0) {
    if (trace) textStatus = trace.td === textDigest(text) ? 'self' : 'mismatch';
    else if (record === 'other') textStatus = 'other';
    else textStatus = legacyQ && legacyQ.t > 0 ? 'legacy' : 'unsigned';
  }
  if (textStatus === 'other') {
    flags.push({ code: 'text-other', detail: `The answer text carries ${from}'s stamp — to look at.` });
  } else if (textStatus === 'mismatch') {
    flags.push({
      code: 'text-mismatch',
      detail: 'The answer text differs from the text its editing record stamps (changed outside the editor?) — to look at.',
    });
  } else if (textStatus === 'unsigned') {
    flags.push({ code: 'text-unsigned', detail: "The answer text has no stamp from this student's editor — to look at." });
  }

  // ── the trace ──
  if (record === 'other') {
    flags.push({ code: 'record-other', detail: `The editing record was made in ${from}'s editor — to look at.` });
  } else if (trace) {
    if (trace.outside > 0) {
      flags.push({
        code: 'outside',
        detail: `The text was changed outside the editor (${plural(trace.outside, 'time')}) and then edited on — to look at.`,
      });
    }
    if (size.t >= ONE_PIECE_TEXT_MIN_CHARS && trace.maxTextIns >= ONE_PIECE_TEXT_SHARE * size.t) {
      flags.push({
        code: 'one-piece-text',
        detail:
          `${trace.maxTextIns} of ${size.t} characters arrived in one insertion (an in-app paste of the ` +
          "student's own text, or text set from outside the editor) — to look at.",
      });
    }
    // No single insertion needs to be big for a script that "types" one
    // character per input event at machine speed; its rate gives it away.
    // (One with human-like timing is the next level up.)
    const typed = trace.textIns - trace.maxTextIns;
    if (size.t > 0 && typed >= TYPING_RATE_MIN_CHARS && typed * 1000 > MAX_TYPING_CHARS_PER_SEC * trace.activeMs) {
      flags.push({
        code: 'too-fast',
        detail:
          `${typed} characters were entered in ${(trace.activeMs / 1000).toFixed(1)} s of active editing, faster ` +
          'than a person types (a script entering text a keystroke at a time?) — to look at.',
      });
    }
    if (
      size.c >= ONE_PIECE_CIRCUIT_MIN_COMPONENTS &&
      trace.maxCompIns >= 2 &&
      trace.maxCompIns >= ONE_PIECE_CIRCUIT_SHARE * size.c
    ) {
      flags.push({
        code: 'one-piece-circuit',
        detail:
          `${trace.maxCompIns} of ${size.c} components arrived in one in-app paste (the student's own work ` +
          'carried from another question or assignment?) — to look at.',
      });
    }
    // Content the record's insertions cannot explain. What the question held
    // when the record began counts only as far as the legacy snapshot backs it.
    const baseC = legacyQ ? Math.min(trace.base?.c ?? 0, legacyQ.c) : 0;
    const baseT = legacyQ ? Math.min(trace.base?.t ?? 0, legacyQ.t) : 0;
    const accC = trace.compAdded + baseC;
    const accT = trace.textIns + baseT;
    if (accC < size.c || accT < size.t) {
      const parts: string[] = [];
      if (accC < size.c) parts.push(`${plural(size.c, 'component')} but its record accounts for ${accC}`);
      if (accT < size.t) parts.push(`${plural(size.t, 'character')} of text but its record accounts for ${accT}`);
      flags.push({ code: 'unaccounted', detail: `The answer has ${parts.join('; ')} — to look at.` });
    }
  } else if (size.c > 0 || size.t > 0) {
    const legacyCovered = legacyQ != null && size.c <= legacyQ.c && size.t <= legacyQ.t;
    if (!legacyCovered) {
      flags.push({
        code: 'record-missing',
        detail:
          `The answer has no ${record === 'invalid' ? 'valid ' : ''}editing record from this student's editor ` +
          `(${plural(size.c, 'component')}, ${plural(size.t, 'character')} of text) — to look at.`,
      });
    }
  }

  // ── the save history: did the work appear between two saves? ──
  // Each save is measured against the most any EARLIER save held (a high-water
  // mark), so work deleted and then restored — an undo — is not new work.
  if (input.history) {
    const zero: QuestionSize = { c: 0, w: 0, t: 0 };
    const points = [legacyQ ?? zero, ...input.history.map((h) => h[String(questionId)] ?? zero), size];
    let jumpC = 0;
    let jumpT = 0;
    let highC = points[0].c;
    let highT = points[0].t;
    for (let i = 1; i < points.length; i++) {
      jumpC = Math.max(jumpC, points[i].c - highC);
      jumpT = Math.max(jumpT, points[i].t - highT);
      highC = Math.max(highC, points[i].c);
      highT = Math.max(highT, points[i].t);
    }
    const parts: string[] = [];
    if (size.c >= ONE_SAVE_MIN_COMPONENTS && jumpC >= ONE_SAVE_SHARE * size.c) {
      parts.push(`${jumpC} of ${size.c} components`);
    }
    if (size.t >= ONE_SAVE_MIN_CHARS && jumpT >= ONE_SAVE_SHARE * size.t) {
      parts.push(`${jumpT} of ${size.t} characters`);
    }
    if (parts.length > 0) {
      // A fast burst of honest editing can also land between two autosaves
      // (one lands after a 1.5 s pause, and at least every 10 s of unbroken
      // editing), so the record's own account rides along for the instructor
      // to weigh.
      const context = trace
        ? ` (its editing record: ${plural(trace.edits, 'edit')}, ${Math.round(trace.activeMs / 1000)} s of active editing, ` +
          `largest single insertion ${Math.max(trace.maxCompIns, trace.maxTextIns)})`
        : '';
      flags.push({
        code: 'one-save',
        detail: `${parts.join(' and ')} appeared between two saves${context} — to look at.`,
      });
    }
  }

  return {
    questionId,
    ids: { total: ids.length, self: selfCount, unbound, legacy, others: otherIds },
    text: textStatus,
    record,
    ...(from ? { from } : {}),
    ...(trace
      ? {
          trace: {
            edits: trace.edits,
            activeMs: trace.activeMs,
            textIns: trace.textIns,
            maxTextIns: trace.maxTextIns,
            compAdded: trace.compAdded,
            maxCompIns: trace.maxCompIns,
            outside: trace.outside,
            ...(trace.base ? { base: trace.base } : {}),
          },
        }
      : {}),
    flags,
  };
}

/** The integrity summary of one submission: one entry per assignment
 *  question answered, assessing the answer the grader grades. Never throws:
 *  malformed answers (they come off the wire) are skipped or read as
 *  unsigned. The work is bounded by the assignment, not by the submission:
 *  answers for ids the assignment lacks, and all but the last answer for an
 *  id, are never read. */
export function assessIntegrity(input: IntegrityInput): SubmissionIntegrity {
  const self = prepareKey(input.self.key);
  const selfEmail = input.self.email.toLowerCase();
  const others: { email: string; key: HmacKey }[] = [];
  for (const o of input.others) {
    if (o.email.toLowerCase() === selfEmail) continue;
    const key = prepareKey(o.key);
    if (key) others.push({ email: o.email, key });
  }
  const legacyIds = new Set(input.legacy?.ids ?? []);
  const budget = { searches: MAX_ATTRIBUTION_SEARCHES };
  // The grader's own lookup: last answer wins per question id.
  const byId = new Map<number, Record<string, unknown>>();
  for (const a of Array.isArray(input.answers) ? input.answers : []) {
    if (!a || typeof a !== 'object' || typeof (a as { questionId?: unknown }).questionId !== 'number') continue;
    byId.set((a as { questionId: number }).questionId, a as Record<string, unknown>);
  }
  const questions: QuestionIntegrity[] = [];
  for (const qid of new Set(input.questionIds)) {
    const a = byId.get(qid);
    if (a) questions.push(checkQuestion(a, self, others, legacyIds, input, budget));
  }
  return { v: 1, questions, flagged: questions.filter((q) => q.flags.length > 0).length };
}
