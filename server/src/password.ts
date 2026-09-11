// Password hashing and policy — the credential half of the local account
// system, kept pure and dependency-free so it can be unit-checked headlessly
// (tools/authCheck.ts) and so nothing needs compiling on the Lightsail box.
//
// Algorithm: scrypt from node:crypto (memory-hard, in the standard library).
// A stored credential is one self-describing string:
//
//   scrypt$<N>$<r>$<p>$<saltBase64url>$<hashBase64url>
//
// The parameters ride along with every hash, so raising the cost later does
// not invalidate existing passwords — old hashes keep verifying with their own
// parameters and re-hash to the new ones on the next password change.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Current cost parameters. ~100ms per hash on a small Lightsail instance. */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** Passwords shorter than this are rejected at registration and change. */
export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound so a huge body can't turn scrypt into a CPU sink. */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Validate a proposed password. Returns a student-facing reason, or null when
 * the password is acceptable. Deliberately minimal: length only. Composition
 * rules (a digit, a symbol…) push people toward `Password1!` without buying
 * real strength, and this is a course gradebook, not a bank.
 */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Enter a password.';
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password.trim().length === 0) {
    return 'Password must not be only whitespace.';
  }
  return null;
}

/** Hash a password into the self-describing stored form. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/**
 * Constant-time verification against a stored credential. Any malformed or
 * absent credential is a plain `false` — an unregistered account can never be
 * logged into, whatever is passed.
 */
export function verifyPassword(password: unknown, stored: string | null | undefined): boolean {
  if (typeof password !== 'string' || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  let actual: Buffer;
  try {
    const salt = Buffer.from(parts[4], 'base64url');
    actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
