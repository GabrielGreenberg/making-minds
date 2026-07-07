// Transition-label NOTATION — the single owner of transition-label SYNTAX
// (docs/buildout/designs/transition-notation.md).
//
// Framework-agnostic: no React, no Zustand, no DOM. Importable from Node.
//
// Four transition-label grammars live in this codebase: FSM `0:1` (k-bit
// capable: `00:0`), base-TM two-output `1:0,R` (P2.1 — one read symbol drives
// two separate outputs, write + move; the old dual-action `1:0R` is accepted
// forever as a legacy alias), turbot-TM internal `0:1`/`1:L` and turbot-TM
// external `E:↑`. This module answers every SYNTAX question about them —
// parse, canonical format, input alphabet, editor token fields, default label
// — behind one `TransitionNotation` interface. SEMANTICS (what an output
// token makes a machine *do*) stay per-engine.
//
// The FSM and base-TM notations are implemented natively here. The turbot-TM
// notations DELEGATE to their existing engine parsers
// (`parseTurbotInternalLabel`/`ExternalLabel`) — no grammar is duplicated,
// and tools/notationCheck.ts pins adapter ≡ parser on every run (turbot
// slice 3 folds them in).
//
// Raw `transitionLabel` string dissection is allowed ONLY in this module and
// in the delegated legacy turbot parsers (engine/turbot.ts — until turbot
// slice 3). notationCheck's grep gate enforces this.

import type { CircuitComponent, Wire, TMNotation } from '../types';
import { parseTurbotInternalLabel, parseTurbotExternalLabel, turbotTMReadSymbols } from './turbot';

// NOTE on the import cycle: tm.ts → notation.ts → turbot.ts → tm.ts (and
// fsm.ts → notation.ts). This is safe because notation.ts reads NO imported
// binding at module-init time — the delegated turbot parsers are only called
// inside parse() at runtime, and every token/label literal below is spelled
// locally (the adapter≡parser pins in notationCheck keep the spellings
// honest).

/** A parsed label: the input symbol and one string per output field. */
export interface ParsedTransition {
  input: string;      // '0' | '10' | '*' | 'E' … (inputWidth chars)
  outputs: string[];  // FSM ['1'] · TM two-output ['0','R'] · turbot external ['↑']
}

/** One output field of a label (mirrors the editor's sub-field entry). */
export interface OutputField {
  name: string;      // 'output' | 'write' | 'move' | 'motor' | 'action'
  tokens: string[];  // per-CHARACTER token set for entry
  width: number;     // characters in this field
}

export interface TransitionNotation {
  id: 'fsm' | 'tm' | 'turbot-fsm' | 'turbot-internal' | 'turbot-external';
  /** FULL input-symbol enumeration — drives totality validation AND editor tokens. */
  inputAlphabet: string[];
  inputWidth: number;
  outputFields: OutputField[];
  /** Separator rendered (and stored) BETWEEN output fields — `','` for the
   *  TM's `write,move`, absent/empty for single-field grammars. */
  outputSeparator?: string;
  defaultLabel: string;
  /** null = malformed. Accepts legacy aliases where the grammar defines them. */
  parse(label: string | undefined): ParsedTransition | null;
  /** Canonical string (Wire.transitionLabel stays a plain string). Edit-saves
   *  re-emit this form, so legacy aliases decay out of stored machines. */
  format(t: ParsedTransition): string;
}

// ─── FSM (native, k-bit capable) ─────────────────────────────────────

/** All length-`width` bit strings in numeric order ('00','01','10','11'). */
function enumerateBitSymbols(width: number): string[] {
  const out: string[] = [];
  for (let v = 0; v < 1 << width; v++) {
    out.push(v.toString(2).padStart(width, '0'));
  }
  return out;
}

function isBits(s: string, width: number): boolean {
  if (s.length !== width) return false;
  for (const ch of s) {
    if (ch !== '0' && ch !== '1') return false;
  }
  return true;
}

const fsmCache = new Map<string, TransitionNotation>();

/**
 * The FSM transition grammar for a machine reading `inBits` input wires and
 * writing `outBits` output wires per step: `<inBits bit chars>:<outBits bit
 * chars>`. Symbol char i is input group i (cc_spec declaration order = codec
 * wire order). `fsmNotation(1,1)` is byte-compatible with the legacy regex
 * `^[01]:[01]$`. Instances are memoized so selectors can rely on identity.
 */
export function fsmNotation(inBits: number, outBits: number): TransitionNotation {
  const key = `${inBits}:${outBits}`;
  const cached = fsmCache.get(key);
  if (cached) return cached;
  const n: TransitionNotation = {
    id: 'fsm',
    inputAlphabet: enumerateBitSymbols(inBits),
    inputWidth: inBits,
    outputFields: [{ name: 'output', tokens: ['0', '1'], width: outBits }],
    defaultLabel: `${'0'.repeat(inBits)}:${'0'.repeat(outBits)}`,
    parse(label) {
      if (!label) return null;
      const parts = label.split(':');
      if (parts.length !== 2) return null;
      if (!isBits(parts[0], inBits) || !isBits(parts[1], outBits)) return null;
      return { input: parts[0], outputs: [parts[1]] };
    },
    format(t) {
      return `${t.input}:${t.outputs.join('')}`;
    },
  };
  fsmCache.set(key, n);
  return n;
}

// ─── Turbot-FSM (fsmNotation(1,2) + legacy 1-bit widening) ───────────
// A turbot's FSM brain drives the 2-bit motor interface (spec §9.2): output
// chars are the wheel bits [left, right] — 00 stop, 01 turn left, 10 turn
// right, 11 forward. Legacy 1-bit labels stay valid as aliases: '1' (the old
// "forward" output) widens to '11', '0' (stop) to '00'. `format` is canonical
// (2-bit), so every edit-save decays the alias out of the stored machine.
// This object is THE single answer to "is this turbot-FSM brain label legal"
// — grader (Stage-1 + runBrainStep) and store validate through it alike.

export const turbotFsmNotation: TransitionNotation = {
  id: 'turbot-fsm',
  inputAlphabet: ['0', '1'],
  inputWidth: 1,
  outputFields: [{ name: 'motor', tokens: ['0', '1'], width: 2 }],
  // Default: sensor clear → both motors on, i.e. forward.
  defaultLabel: '0:11',
  parse(label) {
    const wide = fsmNotation(1, 2).parse(label);
    if (wide) return { input: wide.input, outputs: wide.outputs };
    const narrow = fsmNotation(1, 1).parse(label);
    if (!narrow) return null;
    return { input: narrow.input, outputs: [narrow.outputs[0] === '1' ? '11' : '00'] };
  },
  format(t) {
    return `${t.input}:${t.outputs.join('')}`;
  },
};

// ─── Base TM two-output (native) ─────────────────────────────────────
// The platform's ONE deliberate departure from the textbook (spec §10.3,
// VISUAL_VOCAB §TM): a TM transition is one read symbol driving TWO separate
// outputs — the symbol to WRITE and the direction to MOVE — stored as
// `read:write,move` (e.g. `1:0,R`). Per the P1.12 stored-form contract,
// parse ALSO accepts the textbook's dual-action concatenation `1:0R`
// forever as a legacy alias; format is canonical, so every edit-save decays
// the alias out of stored machines (localStorage needs no migration).
// Execution semantics are unchanged: every step still writes AND moves as
// one atomic action (engine/tm.ts's TMAction {write, move}).
// The alphabet is representation-tied: `*` reads/writes only on binary.

const tmCache = new Map<TMNotation, TransitionNotation>();

export function tmNotation(notation: TMNotation): TransitionNotation {
  const cached = tmCache.get(notation);
  if (cached) return cached;
  const symbols = notation === 'binary' ? ['0', '1', '*'] : ['0', '1'];
  const isMove = (ch: string) => ch === 'R' || ch === 'L';
  const n: TransitionNotation = {
    id: 'tm',
    inputAlphabet: symbols,
    inputWidth: 1,
    outputFields: [
      { name: 'write', tokens: symbols, width: 1 },
      { name: 'move', tokens: ['R', 'L'], width: 1 },
    ],
    outputSeparator: ',',
    defaultLabel: '0:0,R',
    parse(label) {
      if (!label) return null;
      const parts = label.split(':');
      if (parts.length !== 2) return null;
      if (!symbols.includes(parts[0])) return null;
      const rhs = parts[1];
      let write: string;
      let move: string;
      if (rhs.length === 3 && rhs[1] === ',') {
        [write, , move] = rhs;                 // canonical `write,move`
      } else if (rhs.length === 2) {
        [write, move] = rhs;                   // legacy dual-action alias `writemove`
      } else {
        return null;
      }
      if (!symbols.includes(write) || !isMove(move)) return null;
      return { input: parts[0], outputs: [write, move] };
    },
    format(t) {
      return `${t.input}:${t.outputs.join(',')}`;
    },
  };
  tmCache.set(notation, n);
  return n;
}

// ─── Turbot-TM internal / external (delegating adapters) ─────────────

const turbotInternalCache = new Map<TMNotation, TransitionNotation>();

/**
 * Turbot-TM internal states, under the question's encoding (its
 * `representation`): binary machines read/write {0,1,*}, unary (tally)
 * machines only {0,1} — the same alphabet rule as the base TM's tape
 * (tmNotation). Alphabet and parse both come from the engine
 * (turbotTMReadSymbols / parseTurbotInternalLabel), called at runtime only
 * (see the import-cycle note above). Memoized per notation, selector-safe.
 */
export function turbotInternalNotation(tapeNotation: TMNotation = 'binary'): TransitionNotation {
  const cached = turbotInternalCache.get(tapeNotation);
  if (cached) return cached;
  const symbols = turbotTMReadSymbols(tapeNotation);
  const n: TransitionNotation = {
    id: 'turbot-internal',
    inputAlphabet: symbols,
    inputWidth: 1,
    outputFields: [{ name: 'action', tokens: [...symbols, 'R', 'L'], width: 1 }],
    defaultLabel: '0:R',
    parse(label) {
      const p = parseTurbotInternalLabel(label, tapeNotation);
      if (!p) return null;
      return {
        input: p.read,
        outputs: [p.action.kind === 'move' ? p.action.dir : p.action.symbol],
      };
    },
    format(t) {
      return `${t.input}:${t.outputs.join('')}`;
    },
  };
  turbotInternalCache.set(tapeNotation, n);
  return n;
}

// Motor arrows spelled locally (see the import-cycle note above); the
// adapter≡parser pins in notationCheck reject any drift from engine/turbot.ts.
const ARROW_FORWARD = '↑';
const ARROW_TURN_RIGHT = '↱';
const ARROW_TURN_LEFT = '↰';

export const turbotExternalNotation: TransitionNotation = {
  id: 'turbot-external',
  inputAlphabet: ['B', 'E', 'F'],
  inputWidth: 1,
  outputFields: [
    { name: 'motor', tokens: [ARROW_FORWARD, ARROW_TURN_RIGHT, ARROW_TURN_LEFT], width: 1 },
  ],
  defaultLabel: `E:${ARROW_FORWARD}`,
  parse(label) {
    const p = parseTurbotExternalLabel(label);
    if (!p) return null;
    const arrow =
      p.motor === 'forward' ? ARROW_FORWARD :
      p.motor === 'right' ? ARROW_TURN_RIGHT : ARROW_TURN_LEFT;
    return { input: p.sense, outputs: [arrow] };
  },
  format(t) {
    return `${t.input}:${t.outputs.join('')}`;
  },
};

// ─── Editor helper ───────────────────────────────────────────────────

/**
 * Per-character token set for entering a notation's INPUT symbol (the label
 * editor's left field). Width-1 notations expose their alphabet directly;
 * k-bit FSM symbols are entered one bit character at a time.
 */
export function inputCharTokens(n: TransitionNotation): string[] {
  if (n.inputWidth === 1) return n.inputAlphabet;
  const seen: string[] = [];
  for (const sym of n.inputAlphabet) {
    for (const ch of sym) {
      if (!seen.includes(ch)) seen.push(ch);
    }
  }
  return seen;
}

// ─── Generic transition-table walker ─────────────────────────────────

export interface TableError {
  /** unparseable = label fails parse; ambiguous = two transitions match one
   *  (state, input symbol); missing = 'total' mode only, symbol uncovered. */
  kind: 'unparseable' | 'ambiguous' | 'missing';
  message: string;
  stateId?: string;
  wireIds: string[];
}

/** Arity-aware description of an unparseable label, naming the student's
 *  actual mistake for FSM-family grammars ("has a 1-bit input symbol; this
 *  question has 2 input wires") instead of a generic parse failure. */
function describeParseFailure(
  label: string | undefined,
  notation: TransitionNotation,
  source: CircuitComponent,
): string {
  const raw = label ?? '';
  if (notation.id === 'tm') {
    const machine = notation.inputAlphabet.includes('*') ? 'binary' : 'unary';
    return `Transition "${raw}" is not a valid "read:write,move" label for a ${machine} machine (e.g. "${notation.defaultLabel}").`;
  }
  if (notation.id === 'fsm' || notation.id === 'turbot-fsm') {
    const parts = raw.split(':');
    if (parts.length === 2 && /^[01]+$/.test(parts[0]) && /^[01]+$/.test(parts[1])) {
      if (parts[0].length !== notation.inputWidth) {
        return `transition "${raw}" has a ${parts[0].length}-bit input symbol; this question has ${notation.inputWidth} input wire${notation.inputWidth === 1 ? '' : 's'}.`;
      }
      const outWidth = notation.outputFields.reduce((n, f) => n + f.width, 0);
      if (notation.id === 'fsm' && parts[1].length !== outWidth) {
        return `transition "${raw}" has a ${parts[1].length}-bit output symbol; this question has ${outWidth} output wire${outWidth === 1 ? '' : 's'}.`;
      }
    }
  }
  return `state ${source.label} has an invalid transition label "${raw}" (expected the shape "${notation.defaultLabel}").`;
}

/**
 * Validate a transition table against per-source-state notations (turbot-TM
 * state kinds fit the same shape later). Errors:
 *   - unparseable labels (arity-aware messages for FSM-family grammars);
 *   - duplicate transitions per (state, input symbol) — nondeterminism;
 *   - mode 'total' only: a missing transition for any alphabet symbol
 *     (totality — precludes a mid-run halt).
 * Only wires leaving one of `states` are considered transitions.
 */
export function validateTransitionTable(
  states: CircuitComponent[],
  wires: Wire[],
  notationFor: (source: CircuitComponent) => TransitionNotation,
  mode: 'total' | 'at-most-one',
): TableError[] {
  const errors: TableError[] = [];
  const byId = new Map(states.map((s) => [s.id, s]));
  // stateId → input symbol → wire ids
  const seen = new Map<string, Map<string, string[]>>();

  for (const w of wires) {
    const source = byId.get(w.sourceComponentId);
    if (!source) continue;
    const notation = notationFor(source);
    const parsed = notation.parse(w.transitionLabel);
    if (!parsed) {
      errors.push({
        kind: 'unparseable',
        message: describeParseFailure(w.transitionLabel, notation, source),
        stateId: source.id,
        wireIds: [w.id],
      });
      continue;
    }
    let perInput = seen.get(source.id);
    if (!perInput) {
      perInput = new Map<string, string[]>();
      seen.set(source.id, perInput);
    }
    const list = perInput.get(parsed.input) ?? [];
    list.push(w.id);
    perInput.set(parsed.input, list);
  }

  for (const s of states) {
    const perInput = seen.get(s.id) ?? new Map<string, string[]>();
    const alphabet = notationFor(s).inputAlphabet;
    for (const sym of alphabet) {
      const ids = perInput.get(sym) ?? [];
      if (ids.length > 1) {
        errors.push({
          kind: 'ambiguous',
          message: mode === 'total'
            ? `state ${s.label} has ${ids.length} transitions for input ${sym} (must be exactly one)`
            : `state ${s.label} has ${ids.length} transitions for input ${sym} (must be at most one — the machine is nondeterministic)`,
          stateId: s.id,
          wireIds: ids,
        });
      } else if (mode === 'total' && ids.length === 0) {
        errors.push({
          kind: 'missing',
          message: `state ${s.label} must have exactly one transition for input ${sym} (found 0)`,
          stateId: s.id,
          wireIds: [],
        });
      }
    }
  }

  return errors;
}
