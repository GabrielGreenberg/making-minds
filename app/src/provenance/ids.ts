// The minting seam (task 034): every component, wire, box and tab id in the
// app comes from `mintId` — nothing else generates ids (grep gate in
// tools/provenanceCheck.ts: no `uuid` package, no other UUID generator).
//
// The watermark. An id is an ordinary-looking v4 UUID. In an assignment its
// 122 free bits are a 74-bit random nonce followed by a 48-bit tag,
// HMAC(key, 'mm-id-v1' ‖ nonce) truncated, under the MINT KEY of this student
// and this assignment: HMAC(secret, ['mm-mint-v1', email, assignmentId]). The
// server holds the secret and hands each student their key with the workbook
// fetch; at submit it checks every id against the student's own key, then
// against classmates' keys, so work transplanted around the app (console,
// localStorage, the journal, curl, a file) reads as someone else's or as
// nobody's. In the sandbox (and with no key) all 122 bits are random: those
// ids verify as nobody. Nobody strips ids — the wires reference them.
//
// The key lives in module memory only (setMintKey / clearMintKeys), never in
// localStorage: store.openAssignment registers it, store.resetForPrincipal
// clears it (reset law 2). Local mode derives keys from DEV_MINT_SECRET — it
// is the dev prototype and holds its answers in the browser anyway.
//
// Pure: no npm package, no DOM — TextEncoder and crypto.getRandomValues exist
// in the browser and in Node alike, so the server imports this folder the way
// it imports engine/.

import { hmacPrepare, hmacWith, fromHex, randomBytes, toHex, utf8, concatBytes, type HmacKey } from './sha256';

/** Where an id is minted. The same shape as provenance.ts's PasteScope, so
 *  store.selectPasteScope names the scope for both seams. */
export type MintScope = { kind: 'sandbox' } | { kind: 'assignment'; assignmentId: string };

/** Local mode's fixed secret. Never used by the server (it has its own,
 *  config.ts / server_meta), so a dev-signed id reads as unbound there. */
export const DEV_MINT_SECRET = 'making-minds-dev-mint-secret';

/** The mint key (hex) of one student for one assignment. The email is
 *  lowercased; a JSON array keeps the fields apart (an email may hold '|'). */
export function deriveMintKey(secret: string, email: string, assignmentId: string): string {
  const k = hmacPrepare(utf8(secret));
  return toHex(hmacWith(k, utf8(JSON.stringify(['mm-mint-v1', email.toLowerCase(), assignmentId]))));
}

/** A hex key made ready for many MACs; null for a malformed key. */
export function prepareKey(keyHex: string): HmacKey | null {
  const bytes = fromHex(keyHex);
  return bytes && bytes.length > 0 ? hmacPrepare(bytes) : null;
}

// ─── The UUID layout ────────────────────────────────────────────────────────
// 128 bits, most significant first: bits 48–51 are the version (4), bits
// 64–65 the variant (binary 10). The 122 others carry the payload P, most
// significant first: P = nonce (74 bits) ‖ tag (48 bits).

const NONCE_BITS = 74n;
const TAG_BITS = 48n;
const TAG_MASK = (1n << TAG_BITS) - 1n;
const NONCE_MASK = (1n << NONCE_BITS) - 1n;
const ID_DOMAIN = utf8('mm-id-v1');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bytesToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function bigToBytes(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** The 48-bit tag of `nonce` under `key`. */
function tagOf(key: HmacKey, nonce: bigint): bigint {
  const mac = hmacWith(key, concatBytes(ID_DOMAIN, bigToBytes(nonce, 10)));
  return bytesToBig(mac.subarray(0, 6));
}

function formatUuid(payload: bigint): string {
  const hi48 = payload >> 74n;
  const mid12 = (payload >> 62n) & 0xfffn;
  const lo62 = payload & ((1n << 62n) - 1n);
  const u = (hi48 << 80n) | (4n << 76n) | (mid12 << 64n) | (2n << 62n) | lo62;
  const h = u.toString(16).padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The 122-bit payload of a v4 UUID; null for anything else. */
function payloadOf(id: string): bigint | null {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const u = BigInt('0x' + id.replace(/-/g, ''));
  const hi48 = u >> 80n;
  const mid12 = (u >> 64n) & 0xfffn;
  const lo62 = u & ((1n << 62n) - 1n);
  return (hi48 << 74n) | (mid12 << 62n) | lo62;
}

/** A fresh id: tagged under `key`, or all-random with no key. */
export function mintWithKey(key: HmacKey | null): string {
  const r = bytesToBig(randomBytes(16));
  if (!key) return formatUuid(r & ((1n << 122n) - 1n));
  const nonce = r & NONCE_MASK;
  return formatUuid((nonce << TAG_BITS) | tagOf(key, nonce));
}

/** Was `id` minted under `key`? */
export function verifyWithKey(id: string, key: HmacKey): boolean {
  const p = payloadOf(id);
  if (p == null) return false;
  return tagOf(key, p >> TAG_BITS) === (p & TAG_MASK);
}

/** Was `id` minted under the hex key `keyHex`? */
export function verifyId(id: string, keyHex: string): boolean {
  const key = prepareKey(keyHex);
  return key != null && verifyWithKey(id, key);
}

// ─── The key registry: module memory, this window ───────────────────────────

const keys = new Map<string, HmacKey>();
const warned = new Set<string>();

/** Register the mint key for an assignment (store.openAssignment). */
export function setMintKey(assignmentId: string, keyHex: string): void {
  const key = prepareKey(keyHex);
  if (key) keys.set(assignmentId, key);
}

/** Forget every key (store.resetForPrincipal: they are the leaving person's). */
export function clearMintKeys(): void {
  keys.clear();
  warned.clear();
}

/** The registered key for an assignment, ready for MACs; null if none. */
export function mintKeyFor(assignmentId: string): HmacKey | null {
  return keys.get(assignmentId) ?? null;
}

/** THE id minter. An assignment with no registered key mints unbound (once
 *  per assignment it says so on the console) — never throws: it runs inside
 *  click handlers. */
export function mintId(scope: MintScope): string {
  if (scope.kind === 'sandbox') return mintWithKey(null);
  const key = keys.get(scope.assignmentId) ?? null;
  if (!key && !warned.has(scope.assignmentId)) {
    warned.add(scope.assignmentId);
    console.warn(`mintId: no mint key for assignment ${scope.assignmentId}; ids will read as unbound`);
  }
  return mintWithKey(key);
}

/** Every component and wire id of a circuit, BOXED internals included
 *  (a box's boxedCircuitId is a library reference, not an id of this circuit). */
export function idsOfCircuit(circuit: { components?: unknown; wires?: unknown } | null | undefined): string[] {
  const out: string[] = [];
  const walk = (c: { components?: unknown; wires?: unknown } | null | undefined, depth: number): void => {
    if (!c || depth > 16) return;
    if (Array.isArray(c.components)) {
      for (const comp of c.components as { id?: unknown; internalCircuit?: unknown }[]) {
        if (!comp || typeof comp !== 'object') continue;
        if (typeof comp.id === 'string') out.push(comp.id);
        if (comp.internalCircuit && typeof comp.internalCircuit === 'object') {
          walk(comp.internalCircuit as { components?: unknown; wires?: unknown }, depth + 1);
        }
      }
    }
    if (Array.isArray(c.wires)) {
      for (const w of c.wires as { id?: unknown }[]) {
        if (w && typeof w === 'object' && typeof w.id === 'string') out.push(w.id);
      }
    }
  };
  walk(circuit, 0);
  return out;
}

type LooseBoxDef = { internalComponents?: unknown; internalWires?: unknown };

/** Every id a saved workbook (AssignmentState, as stored) holds: each
 *  question's circuit AND the box library's internals — the assignment-wide
 *  `boxLibrary` and the older per-question `confirmedBoxes` — since an
 *  instance placed from the library keeps its internal ids
 *  (store.placeBoxInstance). The legacy snapshot's id list (server/src/db.ts). */
export function idsOfWorkbook(state: { questionCircuits?: unknown; boxLibrary?: unknown } | null | undefined): string[] {
  const libraryIds = (lib: unknown): string[] =>
    Array.isArray(lib)
      ? (lib as (LooseBoxDef | null)[]).flatMap((b) =>
          b && typeof b === 'object' ? idsOfCircuit({ components: b.internalComponents, wires: b.internalWires }) : [],
        )
      : [];
  const qcs = state?.questionCircuits;
  const circuits =
    qcs && typeof qcs === 'object'
      ? (Object.values(qcs) as ({ components?: unknown; wires?: unknown; confirmedBoxes?: unknown } | null)[])
      : [];
  return [
    ...circuits.flatMap((qc) => (qc && typeof qc === 'object' ? [...idsOfCircuit(qc), ...libraryIds(qc.confirmedBoxes)] : [])),
    ...libraryIds(state?.boxLibrary),
  ];
}
