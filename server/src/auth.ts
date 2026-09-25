// Auth seam for the server — the one place identity is established.
//
// `AuthProvider` answers three questions and nothing else:
//   authenticate(credentials) → who is this?  (or null)
//   register(details)         → create an account for a roster member
//   capabilities()            → what should the login screen offer?
//
// Sessions, the bearer-token middleware, the role gate, and every route are
// provider-agnostic: swapping the provider swaps the whole sign-in system.
// Three implementations live here:
//
//   PasswordAuthProvider — the launch system. The roster (imported from a CSV,
//     see roster.ts) decides WHO may have an account; each person creates one
//     with their student ID, an email and a password of their choosing, and
//     signs in with any of their emails + password afterwards. Someone the
//     roster does not have files an access request instead.
//
//   DevAuthProvider — passwordless login by known roster email. Development
//     and the headless harnesses only; MM_AUTH_MODE=dev.
//
//   SsoAuthProvider — the UCLA SSO shape, pending the campus integration
//     details. When it lands, fill in `authenticate` (validate the SSO
//     assertion, read its UID + email + name) and hand the result to
//     `signInAsserted`, which already resolves it to a roster account; nothing
//     else in the codebase changes: capabilities() already tells the client to
//     render a single "Sign in with UCLA" button instead of the form.
//
// Which account an email or a student ID means is never decided here — that
// is src/identity.ts, shared with the roster import.

import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Db, UserRow } from './db';
import { hashPassword, verifyPassword, passwordProblem, PASSWORD_MIN_LENGTH } from './password';
import { normalizeEmail } from './roster';
import { claimForSignUp, resolveAssertedIdentity } from './identity';
import type { ServerConfig } from './config';

/**
 * What the login screen may offer. Served unauthenticated at
 * GET /api/auth/config so the frontend renders the right UI for whatever the
 * server is running — no rebuild needed when the auth mode changes.
 */
export interface AuthCapabilities {
  mode: 'password' | 'dev' | 'sso';
  /** Show a password field on the sign-in form. */
  usesPassword: boolean;
  /** Offer "Create an account" (student ID + an email + a password of their choosing). */
  allowsRegistration: boolean;
  /** Offer "My email isn't on the roster" → an instructor-reviewed request. */
  allowsAccessRequests: boolean;
  passwordMinLength: number;
  /** Where to send the browser for SSO, when mode is 'sso'. */
  ssoLoginUrl?: string;
}

/** A registration attempt's outcome — a reason code the route turns into copy. */
export type RegisterResult =
  | { ok: true; user: UserRow }
  | {
      ok: false;
      reason:
        | 'unsupported'
        | 'not-on-roster'
        | 'already-registered'
        | 'weak-password'
        | 'id-mismatch'
        | 'id-required'
        | 'email-not-accepted';
      message: string;
    };

export interface AuthProvider {
  capabilities(): AuthCapabilities;
  /** Validate credentials and return the authenticated identity, or null. */
  authenticate(credentials: Record<string, unknown>): Promise<UserRow | null>;
  /** Create an account for someone already on the roster. */
  register(details: Record<string, unknown>): Promise<RegisterResult>;
}

const REGISTRATION_UNSUPPORTED: RegisterResult = {
  ok: false,
  reason: 'unsupported',
  message: 'This server does not manage its own accounts.',
};

/**
 * Email + password against the roster. The roster row must exist BEFORE an
 * account can be created: registration is claiming a seat the instructor
 * already granted, never opening a new one. The student ID says which seat —
 * it is the one piece of evidence that the person claiming it is its owner and
 * not someone who knows a classmate's email.
 */
export class PasswordAuthProvider implements AuthProvider {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  capabilities(): AuthCapabilities {
    return {
      mode: 'password',
      usesPassword: true,
      allowsRegistration: true,
      allowsAccessRequests: true,
      passwordMinLength: PASSWORD_MIN_LENGTH,
    };
  }

  async authenticate(credentials: Record<string, unknown>): Promise<UserRow | null> {
    // Any of the account's emails signs in; the credential lives on its key.
    const user = this.db.findUserByEmail(normalizeEmail(credentials.email));
    const stored = user ? this.db.getPasswordHash(user.email) : null;
    // Verify even when the account is unknown or unregistered, against a dummy
    // hash, so a wrong email and a wrong password cost the same wall-clock
    // time and cannot be told apart by timing.
    const ok = verifyPassword(credentials.password, stored ?? DUMMY_HASH);
    if (!user || !stored || !ok) return null;
    return user;
  }

  async register(details: Record<string, unknown>): Promise<RegisterResult> {
    const claim = claimForSignUp(this.db, { email: details.email, studentId: details.studentId });
    if (!claim.ok) return claim;
    const { account, email } = claim;
    if (this.db.getPasswordHash(account.email) != null) {
      return {
        ok: false,
        reason: 'already-registered',
        message: 'An account already exists for you — sign in instead.',
      };
    }
    const problem = passwordProblem(details.password);
    if (problem) return { ok: false, reason: 'weak-password', message: problem };

    // The address they chose becomes one they sign in with (claimForSignUp
    // has vetted it: the account's own, or a UCLA one nobody else holds).
    this.db.addEmailAlias(account.email, email, 'signup');
    this.db.setPasswordHash(account.email, hashPassword(details.password as string));
    return { ok: true, user: this.db.getUser(account.email)! };
  }
}

/** A well-formed hash of an unguessable value, for equal-cost failed logins. */
const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'));

/** Passwordless dev login: any email present in the `users` roster table. */
export class DevAuthProvider implements AuthProvider {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  capabilities(): AuthCapabilities {
    return {
      mode: 'dev',
      usesPassword: false,
      allowsRegistration: false,
      allowsAccessRequests: false,
      passwordMinLength: PASSWORD_MIN_LENGTH,
    };
  }

  async authenticate(credentials: Record<string, unknown>): Promise<UserRow | null> {
    return this.db.findUserByEmail(normalizeEmail(credentials.email));
  }

  async register(): Promise<RegisterResult> {
    return REGISTRATION_UNSUPPORTED;
  }
}

/**
 * UCLA SSO — the shape the campus integration will take, not yet implemented.
 * It constructs and reports its capabilities (so the frontend renders the SSO
 * button and hides the password form), and refuses to authenticate until the
 * assertion handling below is filled in. Credentials are not managed here:
 * with SSO the identity provider owns them, and the roster decides who has a
 * seat (matched by UID) and their role.
 */
export class SsoAuthProvider implements AuthProvider {
  private readonly db: Db;
  private readonly loginUrl: string;

  constructor(db: Db, loginUrl: string) {
    this.db = db;
    this.loginUrl = loginUrl;
  }

  capabilities(): AuthCapabilities {
    return {
      mode: 'sso',
      usesPassword: false,
      allowsRegistration: false,
      allowsAccessRequests: false,
      passwordMinLength: PASSWORD_MIN_LENGTH,
      ssoLoginUrl: this.loginUrl,
    };
  }

  /**
   * The roster account a validated assertion signs in to, or null when the
   * roster has no seat for it. Matched on the UID the identity provider
   * asserts — never on its email, which for 43% of a class is not the one on
   * the class list; the asserted email becomes a sign-in alias. Role, name and
   * section stay the roster's word.
   */
  signInAsserted(asserted: { uid: string; email: string }): UserRow | null {
    return resolveAssertedIdentity(this.db, asserted);
  }

  async authenticate(_credentials: Record<string, unknown>): Promise<UserRow | null> {
    // TODO(UCLA SSO, task 006): validate the assertion/ticket in
    // `_credentials`, read its UID and email attributes, and
    // `return this.signInAsserted({ uid, email })`.
    throw new Error('MM_AUTH_MODE=sso is not implemented yet (waiting on UCLA SSO details)');
  }

  async register(): Promise<RegisterResult> {
    return REGISTRATION_UNSUPPORTED;
  }
}

/** The ONE place the auth mode picks an implementation. */
export function createAuthProvider(config: ServerConfig, db: Db): AuthProvider {
  switch (config.authMode) {
    case 'dev':
      return new DevAuthProvider(db);
    case 'sso':
      return new SsoAuthProvider(db, config.ssoLoginUrl ?? '/api/auth/sso/start');
    case 'password':
    default:
      return new PasswordAuthProvider(db);
  }
}

/** Create a session for an authenticated user and return the bearer token. */
export function issueSession(db: Db, user: UserRow, ttlSeconds: number): string {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  db.createSession(token, user.email, expiresAt);
  return token;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

// Express request augmentation: routes behind requireAuth can read req.user.
declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}

/** 401 unless the request carries a valid, unexpired session token. */
export function requireAuth(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    const user = token ? db.getSessionUser(token) : null;
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = user;
    next();
  };
}

/** 403 unless requireAuth already resolved an instructor. */
export function requireInstructor(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'instructor') {
    res.status(403).json({ error: 'instructor role required' });
    return;
  }
  next();
}

/**
 * Fixed-window throttle on credential guessing, keyed by email+IP. Deliberately
 * in-memory: one server process, ~80 students, and a restart clearing the
 * counters is an acceptable cost for having no extra dependency. Locks the KEY,
 * never the account, so one attacker cannot lock a student out of their own
 * work by guessing at their address from elsewhere.
 */
export class LoginThrottle {
  private hits = new Map<string, { count: number; first: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 10, windowMs = 10 * 60 * 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  private key(email: string, ip: string): string {
    return `${email} ${ip}`;
  }

  /** Seconds to wait, or 0 when the attempt may proceed. */
  retryAfter(email: string, ip: string): number {
    const entry = this.hits.get(this.key(email, ip));
    if (!entry) return 0;
    const elapsed = Date.now() - entry.first;
    if (elapsed >= this.windowMs) return 0;
    if (entry.count < this.limit) return 0;
    return Math.ceil((this.windowMs - elapsed) / 1000);
  }

  recordFailure(email: string, ip: string): void {
    const k = this.key(email, ip);
    const entry = this.hits.get(k);
    if (!entry || Date.now() - entry.first >= this.windowMs) {
      this.hits.set(k, { count: 1, first: Date.now() });
      return;
    }
    entry.count++;
  }

  recordSuccess(email: string, ip: string): void {
    this.hits.delete(this.key(email, ip));
  }
}
