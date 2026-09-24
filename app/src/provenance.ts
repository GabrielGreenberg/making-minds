// ─── The provenance seam (task 033; law 8, tasks/PROFILE.md §8) ─────────────
// The ONE place that decides whether copied content may be pasted, for the
// canvas and for every assignment answer field alike.
//
// The rule. A paste INTO AN ASSIGNMENT is accepted iff the item was copied
// inside an assignment (any of them — the same student may carry work between
// their own homeworks) by the same user, in this window. A paste into the
// sandbox is always accepted: the sandbox is free. The rule is symmetric for
// text: nothing copied inside an assignment reaches the system clipboard, and
// nothing on the system clipboard reaches an assignment's answers. So "build it
// in the sandbox, send the file to a friend, the friend opens it in the sandbox
// and pastes it into the homework" is refused at the paste, as is text from a
// chat window or an AI tool.
//
// "This window" comes for free: the clipboard below is module memory — never
// localStorage, BroadcastChannel or the system clipboard — so another tab,
// another browser or a reload starts empty. "This user" is the principal that
// resetClipboard records; store.ts's resetForPrincipal (reset law 2) calls it,
// which also empties both slots, so nothing crosses a sign-out. A canvas or
// question swap deliberately does NOT clear it: copy in P1, paste in P2.
//
// Two slots, one per kind of content:
//   canvas — components + wires copied on a canvas (store.copySelected), with
//            the CanvasKind they were copied from; a paste into an assignment
//            must also match the target canvas's kind and the question's
//            allowed_components (canvasPasteVerdict). The sandbox takes
//            anything, a kind mismatch included, as it always has.
//   text   — a selection copied or cut in a guarded answer field (open
//            response, fill-in blanks, box rename). usePasteGuard.ts is the
//            thin DOM adapter and the ONLY file allowed to touch the clipboard
//            APIs (grep gate in tools/pasteCheck.ts). A paste inserts the
//            SLOT's text, never the system clipboard's; the system clipboard is
//            read only to tell whether the slot's item is still the latest
//            copy (textPasteVerdict). A guarded copy puts '' there, plus an
//            opaque copy id (CLIP_MARKER_TYPE; a per-window random prefix and a
//            counter, no content) naming the slot item it stands for: another
//            window's id, or anything else copied since, refuses the stale
//            slot instead of pasting it silently. Forging an id gains nothing —
//            the inserted text is still the slot's. Problem-statement text
//            copies natively (the PDFs are public), so pasting it into an
//            answer is refused like any outside text (Gabriel's decision,
//            2026-09-23; task 033's progress log).
//
// Pure policy + a module-memory store: no React, no DOM, so the harness
// imports it directly. It lives outside engine/ because grading never asks
// about provenance; it may import pure engine code.
//
// Limits — what this does NOT stop, and cannot from the client: editing
// localStorage (the crash journal replayed on the next open, the first-login
// migration), scripting the API with the student's own bearer token, and
// redrawing a friend's circuit by hand. Those need detection at grading time
// (tasks 031 and 034). The console one-liner is closed separately:
// window.__store exists only in dev builds (store.ts).

import type { BuildMode, CircuitComponent, ComponentType, Wire } from './types';
import { disallowedComponentTypes } from './engine/machineValidation';

/** Where a copy was made, or where a paste lands. */
export type PasteScope = { kind: 'sandbox' } | { kind: 'assignment'; assignmentId: string };

/** Who and where: the stamp on every copied item, and the paste target. */
export interface Provenance {
  scope: PasteScope;
  /** The signed-in email, or null for the visitor. */
  user: string | null;
}

/** The editing surface a canvas item was copied from / is pasted onto. Only a
 *  turbot TM brain is split from 'TM': its STATEs carry a stateKind and its
 *  external states a sense/move grammar. Label widths and representation
 *  mismatches are left to the existing label validation (warn, don't block). */
export type CanvasKind = 'circuit' | 'FSM' | 'TM' | 'turbot-TM';

export interface CanvasClip {
  components: CircuitComponent[];
  wires: Wire[];
}

export interface ClipItem<T> {
  payload: T;
  origin: Provenance;
  /** Canvas items only. */
  kind?: CanvasKind;
  /** Text items only: the copy id written beside '' on the system clipboard. */
  id?: string;
}

/** The clipboard type under which a guarded copy writes its copy id. */
export const CLIP_MARKER_TYPE = 'application/x-makingminds-copy';

/** What the system clipboard holds at paste time, as the guard reads it. */
export interface SystemClipboard {
  /** Its text/plain; '' when there is none. */
  text: string;
  /** The copy id under CLIP_MARKER_TYPE; '' when there is none. */
  marker: string;
  /** It holds some other type too (an image, a file, rich text): something
   *  other than a guarded copy, which writes only text/plain and the id. */
  other: boolean;
}

export type RefusalReason =
  | 'from-sandbox' // copied in the sandbox, pasted into an assignment
  | 'other-user'   // copied under another account (cannot survive a sign-out; belt and braces)
  | 'other-window' // a guarded copy made since in another window, or before a reload / sign-out
  | 'outside'      // text from outside the app / outside the assignments
  | 'empty'        // nothing copied yet
  | 'mode'         // canvas kind mismatch (an FSM onto a circuit canvas…)
  | 'component'    // a component type the question does not allow
  | 'drag';        // drag-and-drop in an assignment answer field

export interface Refusal {
  ok: false;
  reason: RefusalReason;
  message: string;
}

export type Verdict<T extends object = object> = ({ ok: true } & T) | Refusal;

/** Map an editor state to its CanvasKind; null for the non-canvas modes (open
 *  and fill-in questions), where nothing can be pasted onto a canvas. */
export function canvasKind(buildMode: BuildMode, effectiveMode: BuildMode): CanvasKind | null {
  switch (effectiveMode) {
    case 'CC':
    case 'SC':
      return 'circuit';
    case 'FSM':
      return 'FSM';
    case 'TM':
      return buildMode === 'turbot' ? 'turbot-TM' : 'TM';
    default:
      return null;
  }
}

const KIND_LABEL: Record<CanvasKind, string> = {
  circuit: 'logic-circuit',
  FSM: 'state-machine',
  TM: 'Turing-machine',
  'turbot-TM': 'turbot Turing-machine',
};

const RULE = 'In an assignment you can paste only what you copied in your own assignments, in this window.';

/** The one wording for every refusal, so the canvas and the text fields say
 *  the same thing. `detail` fills in the mode / component refusals. */
export function refusalMessage(reason: RefusalReason, detail?: string): string {
  switch (reason) {
    case 'from-sandbox':
      return `Not pasted: that was copied in the sandbox. ${RULE}`;
    case 'other-user':
      return `Not pasted: that was copied under another account. ${RULE}`;
    case 'other-window':
      return `Not pasted: that was copied in another window, or before a reload or sign-out. ${RULE}`;
    case 'outside':
      return `Not pasted: that text was not copied in your assignments. ${RULE}`;
    case 'empty':
      return 'Nothing to paste: copy something in this window first.';
    case 'mode':
      return `Not pasted: ${detail ?? 'that was copied on a different kind of canvas'}.`;
    case 'component':
      return `Not pasted: this question doesn't allow ${detail ?? 'some of those components'}.`;
    case 'drag':
      return 'Drag-and-drop is off in assignments: copy and paste instead.';
  }
}

function refuse(reason: RefusalReason, detail?: string): Refusal {
  return { ok: false, reason, message: refusalMessage(reason, detail) };
}

/** THE policy. A sandbox target takes anything; an assignment target takes an
 *  item only if it was copied inside an assignment (any id) by the same user. */
export function canPaste(origin: Provenance, target: Provenance): Verdict {
  if (target.scope.kind === 'sandbox') return { ok: true };
  if (origin.scope.kind !== 'assignment') return refuse('from-sandbox');
  if (origin.user !== target.user) return refuse('other-user');
  return { ok: true };
}

/** A canvas paste. The sandbox takes anything copied in this window (a kind
 *  mismatch included — it is free, as it always was). An assignment asks the
 *  policy, then the canvas kind, then the question's allowed_components
 *  (recursing into BOXED internals — a boxed OR must not smuggle an OR in);
 *  `allowed` is null when unrestricted. On success returns the clip to paste. */
export function canvasPasteVerdict(
  item: ClipItem<CanvasClip> | null,
  target: { prov: Provenance; kind: CanvasKind | null; allowed: readonly ComponentType[] | null },
): Verdict<{ clip: CanvasClip }> {
  if (!item) return refuse('empty');
  if (target.prov.scope.kind === 'sandbox') return { ok: true, clip: item.payload };
  const policy = canPaste(item.origin, target.prov);
  if (!policy.ok) return policy;
  if (!item.kind || item.kind !== target.kind) {
    const from = item.kind ? `${KIND_LABEL[item.kind]} parts` : 'those parts';
    const to = target.kind ? `a ${KIND_LABEL[target.kind]} canvas` : 'this question';
    return refuse('mode', `${from} can't go on ${to}`);
  }
  const offenders = disallowedComponentTypes(item.payload.components, target.allowed);
  if (offenders.length > 0) return refuse('component', offenders.join(', '));
  return { ok: true, clip: item.payload };
}

/** A text paste into a guarded field. In the sandbox the browser pastes
 *  natively (`native: true` — no interception). In an assignment the SLOT's
 *  text is inserted, never the system clipboard's, and only while the slot's
 *  item is still the latest copy the system clipboard knows of:
 *    - a copy id on it must be the slot item's (else a copy made in another
 *      window, or before a reload or sign-out emptied the slot: 'other-window');
 *    - with no id, it must hold nothing but '' or the item's own text (a
 *      browser that drops the id type, or ignores the '') — anything else was
 *      copied elsewhere since: 'outside'. */
export function textPasteVerdict(
  item: ClipItem<string> | null,
  target: Provenance,
  system: SystemClipboard,
): Verdict<{ native: true } | { native: false; text: string }> {
  if (target.scope.kind === 'sandbox') return { ok: true, native: true };
  if (system.marker !== '') {
    if (!item || system.marker !== item.id) return refuse('other-window');
  } else {
    const foreign = system.other || (system.text !== '' && system.text !== item?.payload);
    if (!item) return refuse(foreign ? 'outside' : 'empty');
    if (foreign) return refuse('outside');
  }
  const policy = canPaste(item.origin, target);
  if (!policy.ok) return policy;
  return { ok: true, native: false, text: item.payload };
}

/** `beforeinput` types that bring content from outside the field — refused in
 *  an assignment. Typing, spell-check replacements and deletes pass. */
const GUARDED_INPUT_TYPES = new Set([
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertFromDrop',
  'insertFromYank',
  'insertLink',
  'deleteByDrag',
]);

export function guardedInputType(inputType: string): boolean {
  return GUARDED_INPUT_TYPES.has(inputType);
}

// ─── The clipboard itself: module memory, one window ────────────────────────

let principal: string | null = null;
let canvasSlot: ClipItem<CanvasClip> | null = null;
let textSlot: ClipItem<string> | null = null;
/** This window's copy-id prefix (random per page load) and counter. Not a
 *  secret: it only tells this window's copies from another's. */
const WINDOW_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let copyCount = 0;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Stamp a canvas copy (deep-copied: later edits never reach the slot). */
export function stampCanvas(clip: CanvasClip, origin: Provenance, kind: CanvasKind): void {
  canvasSlot = { payload: clone(clip), origin: clone(origin), kind };
}

/** Stamp a text copy/cut made in a guarded answer field; returns its copy
 *  id, which the guard writes beside '' on the system clipboard. */
export function stampText(text: string, origin: Provenance): string {
  copyCount += 1;
  const id = `${WINDOW_ID}:${copyCount}`;
  textSlot = { payload: text, origin: clone(origin), id };
  return id;
}

/** Both slots, read-only (store.paste re-copies before pasting). */
export function peekClipboard(): { canvas: ClipItem<CanvasClip> | null; text: ClipItem<string> | null } {
  return { canvas: canvasSlot, text: textSlot };
}

/** A principal change (reset law 2): empty both slots and record who is here. */
export function resetClipboard(email: string | null): void {
  principal = email;
  canvasSlot = null;
  textSlot = null;
}

/** The provenance of a copy made / paste landing now, in `scope`, as the
 *  seam's principal — what usePasteGuard stamps and checks text against. */
export function currentProvenance(scope: PasteScope): Provenance {
  return { scope, user: principal };
}
