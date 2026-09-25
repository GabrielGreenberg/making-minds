// The writing and build trace (task 034): one signed record per question of
// how its answer came to be — edit actions, the largest single insertion
// (characters, or components added in one action), active editing time.
// Aggregates only, never a keystroke log.
//
// Honest work arrives a little at a time; transplanted work arrives in one
// piece. The record is the backstop for what the keyed ids cannot see: a
// paste through a PATCHED app (DevTools Local Overrides) is re-minted by the
// app as genuine, but it still lands as one huge insertion here.
//
// The store (store.ts recordEdit) advances the record at every edit, after
// the lock check, and re-signs it with the mint key then — never at save
// time, which would launder text injected into a save (the journal,
// localStorage) on the next autosave. The record also stamps the answer text
// (`td`, a digest beside the text, never in it): text found changed since the
// last in-editor edit bumps `outside`, which stays (it is signed).
//
// Pure (no npm package, no DOM): the server's integrity check imports it.

import type { QuestionProvenance } from '../types';
import { hmacWith, sha256, toHex, utf8, type HmacKey } from './sha256';

/** Longest gap between two edits that still counts as active editing time. */
export const ACTIVE_GAP_CAP_MS = 60_000;

/** The answer text a record stamps. */
export interface TextContent {
  responseText?: string;
  fillAnswers?: string[];
}

/** Characters inserted by one change: what `after` holds between the common
 *  prefix and the common suffix it shares with `before`. */
export function insertedChars(before: string, after: string): number {
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s++;
  return after.length - p - s;
}

function fillOf(content: TextContent): string[] {
  const fill = Array.isArray(content.fillAnswers)
    ? content.fillAnswers.map((x) => (typeof x === 'string' ? x : ''))
    : [];
  // Trailing blanks are no answer: [] and ['', ''] stamp alike.
  while (fill.length > 0 && fill[fill.length - 1] === '') fill.pop();
  return fill;
}

function responseOf(content: TextContent): string {
  return typeof content.responseText === 'string' ? content.responseText : '';
}

/** Characters of answer text (prose + every blank). */
export function textLength(content: TextContent): number {
  return responseOf(content).length + fillOf(content).reduce((n, f) => n + f.length, 0);
}

/** The 64-bit stamp of the answer text, hex. */
export function textDigest(content: TextContent): string {
  return toHex(sha256(utf8(JSON.stringify([responseOf(content), fillOf(content)])))).slice(0, 16);
}

type TraceFields = Omit<QuestionProvenance, 'sig'>;

function isCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/** A record with every field of the right type (it may come off the wire). */
export function isTraceShape(p: unknown): p is QuestionProvenance {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  const base = r.base as { c?: unknown; t?: unknown } | undefined;
  return (
    r.v === 1 &&
    ['edits', 'activeMs', 'textIns', 'maxTextIns', 'compAdded', 'maxCompIns', 'outside'].every((k) => isCount(r[k])) &&
    (base === undefined || (typeof base === 'object' && base !== null && isCount(base.c) && isCount(base.t))) &&
    typeof r.td === 'string' &&
    typeof r.sig === 'string'
  );
}

/** The signature over a record's fields AND its question id, so a record
 *  moved to another question fails. 128 bits, hex. */
export function signTrace(questionId: number, f: TraceFields, key: HmacKey): string {
  const canonical = JSON.stringify([
    'mm-prov-v1',
    questionId,
    f.v,
    f.edits,
    f.activeMs,
    f.textIns,
    f.maxTextIns,
    f.compAdded,
    f.maxCompIns,
    f.outside,
    f.base ? [f.base.c, f.base.t] : null,
    f.td,
  ]);
  return toHex(hmacWith(key, utf8(canonical))).slice(0, 32);
}

/** Does `record` carry a valid signature under `key` for this question? */
export function verifyTrace(questionId: number, record: unknown, key: HmacKey): boolean {
  if (!isTraceShape(record) || record.sig === '') return false;
  return signTrace(questionId, record, key) === record.sig;
}

/** What one edit did. */
export interface TraceChange {
  /** Components this action added (add / box placement: 1; paste: n). */
  compIns?: number;
  /** Characters this action inserted (text setters). */
  textIns?: number;
}

/** Where the edit happens. */
export interface TraceContext {
  questionId: number;
  /** The answer text just before the edit (the outside check). */
  textBefore: TextContent;
  /** The answer text just after it (what the new record stamps). */
  textAfter: TextContent;
  /** Components on the canvas just before the edit (a first record's base). */
  countBefore: number;
  /** Time since the previous edit, ms (0 for the first in this window). */
  gapMs: number;
}

/**
 * The record after one edit. A previous record that does not verify under
 * `key` — forged, moved from another question, or signed under another key —
 * is not continued: the trace restarts and counts what the question holds now
 * as its `base`, which the submit check credits only when legacy content backs
 * it. With no key the record is carried on unsigned (`sig: ''`).
 */
export function nextTrace(
  prev: QuestionProvenance | null | undefined,
  change: TraceChange,
  ctx: TraceContext,
  key: HmacKey | null,
): QuestionProvenance {
  const cont = prev && isTraceShape(prev) && (!key || verifyTrace(ctx.questionId, prev, key)) ? prev : null;
  const lenBefore = textLength(ctx.textBefore);
  const base = cont
    ? cont.base
    : ctx.countBefore > 0 || lenBefore > 0
      ? { c: ctx.countBefore, t: lenBefore }
      : undefined;
  const compIns = Math.max(0, change.compIns ?? 0);
  const textIns = Math.max(0, change.textIns ?? 0);
  const fields: TraceFields = {
    v: 1,
    edits: (cont?.edits ?? 0) + 1,
    activeMs: (cont?.activeMs ?? 0) + Math.min(Math.max(0, ctx.gapMs), ACTIVE_GAP_CAP_MS),
    textIns: (cont?.textIns ?? 0) + textIns,
    maxTextIns: Math.max(cont?.maxTextIns ?? 0, textIns),
    compAdded: (cont?.compAdded ?? 0) + compIns,
    maxCompIns: Math.max(cont?.maxCompIns ?? 0, compIns),
    outside: (cont?.outside ?? 0) + (cont && cont.td !== textDigest(ctx.textBefore) ? 1 : 0),
    ...(base ? { base } : {}),
    td: textDigest(ctx.textAfter),
  };
  return { ...fields, sig: key ? signTrace(ctx.questionId, fields, key) : '' };
}
