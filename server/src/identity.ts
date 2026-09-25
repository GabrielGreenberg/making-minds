// Identity — who is this person? The ONE place an email or a student ID
// resolves to an account, and the one place a roster entry lands on one
// (task 036).
//
// A person is one `users` row. Its `uid` (the normalised student ID) is WHO
// they are: the one identifier the registrar, UCLA's identity provider and
// the student all share. Its `email` is the account's KEY — the address it was
// first rostered under — and every stored thing (sessions, workbooks,
// submissions, feedback, mint keys) hangs off it and it never changes, so
// nothing is ever rekeyed. Every other address the person signs in with is an
// alias (`user_emails`): a UCLA address beside a personal class-list one (the
// registrar exports the PREFERRED email, and 43% of a class list is
// personal), a registrar change mid-quarter, the address SSO asserts.
//
// Every writer of roster rows comes through here — the class-list import, the
// dashboard's add-person form, access-request approval, the CLI's `add` — and
// so do sign-up and SSO. The Db primitives enforce the invariant (one UID per
// account, an alias never another account's key); this module decides.

import type { Role } from '../../app/src/auth/accounts';
import type { Db, EmailAliasSource, UserRow } from './db';
import { isCampusEmail, isEmail, normalizeEmail, normalizeUid } from './roster';

/** What a caller knows about a person: a class-list row, the add form, a request. */
export interface RosterFacts {
  email: string;
  /** '' keeps an existing account's name (a new one takes the email's local part). */
  name: string;
  role: Role;
  /** As written; '' when unknown. */
  studentId: string;
  section?: string | null;
  sortName?: string | null;
}

/** Where a roster entry landed. */
export type Placement =
  | { kind: 'added'; account: UserRow }
  /** `aliasAdded`: the entry's email, newly a sign-in address of the account. */
  | { kind: 'updated'; account: UserRow; aliasAdded: string | null }
  /** Nothing was written; `account` is the one the entry collided with. */
  | { kind: 'conflict'; reason: string; account: UserRow | null };

/**
 * How a roster entry is applied to the account it names:
 *   roster  — the registrar's (or the instructor's) word: name, role, section
 *             and student ID are updated, and a new email becomes an alias.
 *   request — an approved access request vouches for the ADDRESS only: it
 *             becomes an alias of the account the request's ID or email
 *             names, whose roster facts stand.
 */
export type PlacementMode = 'roster' | 'request';

/**
 * The account a set of roster facts is about, and whether it is safe to say
 * so: the student ID first (who they are), then the email (key or alias). A
 * UID that is one account's and an email that is another's, or an email on
 * file under a different UID, is a conflict for a human — never a rebind.
 */
export function matchAccount(
  db: Db,
  facts: { email: string; studentId: string },
): { account: UserRow | null; conflict: string | null } {
  const email = normalizeEmail(facts.email);
  const uid = normalizeUid(facts.studentId);
  const byUid = uid ? db.findUserByUid(uid) : null;
  const byEmail = email ? db.findUserByEmail(email) : null;
  if (byUid && byEmail && byUid.email !== byEmail.email) {
    return {
      account: byUid,
      conflict: `student ID ${facts.studentId.trim()} is ${byUid.name}'s, but ${email} signs in to ${byEmail.name}'s account`,
    };
  }
  if (!byUid && byEmail?.uid && uid) {
    return {
      account: byEmail,
      conflict: `${email} is on file for ${byEmail.name} under a different student ID (${byEmail.studentId})`,
    };
  }
  return { account: byUid ?? byEmail, conflict: null };
}

/** Land one roster entry on its account (or a new one). See PlacementMode. */
export function placeRosterEntry(db: Db, facts: RosterFacts, mode: PlacementMode = 'roster'): Placement {
  const email = normalizeEmail(facts.email);
  const { account, conflict } = matchAccount(db, { email, studentId: facts.studentId });
  if (conflict) return { kind: 'conflict', reason: conflict, account };

  if (!account) {
    db.upsertUser({
      email,
      name: facts.name || email.split('@')[0],
      role: facts.role,
      studentId: facts.studentId,
      section: facts.section ?? null,
      sortName: facts.sortName ?? null,
    });
    return { kind: 'added', account: db.getUser(email)! };
  }

  if (mode === 'roster') {
    db.upsertUser({
      email: account.email,
      name: facts.name || account.name,
      role: facts.role,
      studentId: facts.studentId,
      section: facts.section ?? null,
      sortName: facts.sortName ?? null,
    });
  }
  const source: EmailAliasSource = mode === 'request' ? 'request' : 'roster';
  const aliased = email !== account.email && db.addEmailAlias(account.email, email, source) === 'added';
  return { kind: 'updated', account: db.getUser(account.email)!, aliasAdded: aliased ? email : null };
}

export type SignUpClaim =
  | { ok: true; account: UserRow; email: string }
  | {
      ok: false;
      reason: 'not-on-roster' | 'id-mismatch' | 'id-required' | 'email-not-accepted';
      message: string;
    };

/**
 * Which roster seat a sign-up claims (no writes). The student ID finds the
 * account; with none typed, the email must name an account that has no ID on
 * file (instructors, manual adds). The address they will sign in with must be
 * one the account already has, or a UCLA address — which then becomes an alias
 * (the caller stores it once the rest of the sign-up checks out).
 */
export function claimForSignUp(db: Db, details: { email: unknown; studentId: unknown }): SignUpClaim {
  const email = normalizeEmail(details.email);
  const studentId = typeof details.studentId === 'string' ? details.studentId.trim() : '';
  if (!email || !isEmail(email)) {
    return { ok: false, reason: 'email-not-accepted', message: 'Enter a valid email address.' };
  }
  const byEmail = db.findUserByEmail(email);
  let account: UserRow;
  if (normalizeUid(studentId)) {
    const byUid = db.findUserByUid(studentId);
    if (byUid && (!byEmail || byEmail.email === byUid.email)) account = byUid;
    else if (!byUid && byEmail && !byEmail.uid) account = byEmail;
    else if (byEmail) {
      return {
        ok: false,
        reason: 'id-mismatch',
        message: 'That student ID does not match the one on file for this email.',
      };
    } else {
      return { ok: false, reason: 'not-on-roster', message: 'That student ID is not on the class roster.' };
    }
  } else {
    if (!byEmail) {
      return { ok: false, reason: 'not-on-roster', message: 'That email is not on the class roster.' };
    }
    if (byEmail.uid) {
      return {
        ok: false,
        reason: 'id-required',
        message: 'Enter your student ID (UID) — it confirms the account is yours.',
      };
    }
    account = byEmail;
  }
  if (byEmail?.email !== account.email && !isCampusEmail(email)) {
    return {
      ok: false,
      reason: 'email-not-accepted',
      message:
        'Use the email on your class-list record or your UCLA address (…@ucla.edu or …@g.ucla.edu).',
    };
  }
  return { ok: true, account, email };
}

/**
 * The account an SSO assertion signs in to, or null when the roster has no
 * seat for it (whether such a person may ask to be added is task 006's
 * question). The asserted UID finds the account; failing that, the asserted
 * email may find one with no ID on file, which then takes the asserted UID —
 * the identity provider's word is proof. The asserted email becomes an alias,
 * unless another account already signs in with it.
 */
export function resolveAssertedIdentity(db: Db, asserted: { uid: string; email: string }): UserRow | null {
  let account = db.findUserByUid(asserted.uid);
  if (!account) {
    const byEmail = db.findUserByEmail(asserted.email);
    if (!byEmail || byEmail.uid) return null;
    if (normalizeUid(asserted.uid)) db.setUid(byEmail.email, asserted.uid);
    account = byEmail;
  }
  const email = normalizeEmail(asserted.email);
  if (isEmail(email)) db.addEmailAlias(account.email, email, 'sso');
  return db.getUser(account.email);
}
