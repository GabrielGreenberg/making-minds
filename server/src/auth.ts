// Auth seam for the server — the mirror of the app's `src/auth/` mockup.
//
// `AuthProvider.authenticate` turns login credentials into an identity (or
// null). Today the only implementation is DevAuthProvider: passwordless login
// by a known roster email — exactly the trust level of the app's mockup login,
// acceptable for development and a closed pilot behind the class roster.
//
// When UCLA SSO lands, add an SsoAuthProvider here (validate the SSO
// ticket/token, map attributes → { email, name, role }) and select it via
// MM_AUTH_MODE=sso. Sessions, the bearer-token middleware, and every route
// stay unchanged — that's the whole point of the seam.

import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Db, UserRow } from './db';

export interface AuthProvider {
  /** Validate credentials and return the authenticated identity, or null. */
  authenticate(credentials: Record<string, unknown>): Promise<UserRow | null>;
}

/** Passwordless dev login: any email present in the `users` roster table. */
export class DevAuthProvider implements AuthProvider {
  constructor(private db: Db) {}

  async authenticate(credentials: Record<string, unknown>): Promise<UserRow | null> {
    const email = typeof credentials.email === 'string' ? credentials.email.trim().toLowerCase() : '';
    if (!email) return null;
    return this.db.getUser(email);
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
