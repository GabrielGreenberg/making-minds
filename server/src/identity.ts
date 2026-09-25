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
// Claims have strengths, and a weaker one never overrides a stronger one:
//   · an ID is VERIFIED (it is the account's `uid`) when the class list, an
//     instructor, or the identity provider said so. An ID a student typed into
//     an access request is kept as written (`student_id`) and verifies
//     nothing: a class-list row with that ID is a conflict for a human, never
//     a merge into the requester's account.
//   · an alias from `signup` is the student's own word: the class list, SSO or
//     an approved request takes the address from it, and it never blocks
//     another student's roster entry.
//   · an account "has an ID on file" when it has one AS WRITTEN — verified or
//     not — and then signing up needs it.
//
// Every writer of roster rows comes through here — the class-list import, the
// dashboard's add-person form and the CLI's `add`, access-request approval —
// and so do sign-up and SSO. The Db primitives enforce the invariant (one UID
// per account, an alias never another account's key); this module decides.

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
 * Who is speaking, which decides what a matched account takes from the entry:
 *   class-list — the registrar: name, role, section and student ID are its
 *                word, and a new email becomes an alias.
 *   instructor — the add form or the CLI: the same when the EMAIL names the
 *                account (editing that person); when only the ID does, the
 *                email just becomes an alias — a mistyped ID must not rename
 *                a classmate.
 *   request    — an approved access request vouches for the ADDRESS only: it
 *                becomes an alias of the account the request's verified ID or
 *                email names; a new row keeps the typed ID unverified.
 */
export type PlacementMode = 'class-list' | 'instructor' | 'request';

/** The ID an account has on file as written, normalised ('' for none). */
const idOnFile = (account: UserRow): string => normalizeUid(account.studentId ?? '');

interface Match {
  account: UserRow | null;
  /** How the account was found: its verified ID, or the entry's email. */
  by: 'uid' | 'email' | null;
  conflict: string | null;
}

/**
 * The account a set of roster facts is about, and whether it is safe to say
 * so: the verified ID first (who they are), then the email — as a key or a
 * strong alias; another account's `signup` alias yields. A verified ID that is
 * one account's and an email that is another's, an email on file under a
 * different ID, or an ID someone typed into a request, is a conflict for a
 * human — never a rebind.
 */
export function matchAccount(db: Db, facts: { email: string; studentId: string }): Match {
  const email = normalizeEmail(facts.email);
  const uid = normalizeUid(facts.studentId);
  const written = facts.studentId.trim();
  const byUid = uid ? db.findUserByUid(uid) : null;
  const owner = email ? db.emailOwner(email) : null;
  // A student's own sign-up alias never names an account for the roster: with
  // an ID the ID decides, and without one nothing can tell whether the entry
  // is that student or someone whose address they typed.
  if (owner?.source === 'signup' && !uid) {
    return {
      account: owner.account,
      by: null,
      conflict: `${email} is an address ${owner.account.name} gave when setting up their account, and this entry has no student ID to tell whether it is the same person`,
    };
  }
  const byEmail = owner && owner.source !== 'signup' ? owner.account : null;

  if (byUid && byEmail && byUid.email !== byEmail.email) {
    return {
      account: byUid,
      by: 'uid',
      conflict: `student ID ${written} is ${byUid.name}'s, but ${email} signs in to ${byEmail.name}'s account`,
    };
  }
  if (byUid) return { account: byUid, by: byEmail ? 'email' : 'uid', conflict: null };
  if (byEmail) {
    const onFile = idOnFile(byEmail);
    if (uid && onFile && onFile !== uid) {
      return {
        account: byEmail,
        by: 'email',
        conflict: `${email} is on file for ${byEmail.name} under a different student ID (${byEmail.studentId})`,
      };
    }
    return { account: byEmail, by: 'email', conflict: null };
  }
  const unverified = uid ? db.findUnverifiedIdHolders(uid) : [];
  if (unverified.length > 0) {
    const holder = unverified[0];
    return {
      account: holder,
      by: null,
      conflict:
        `student ID ${written} is also on ${holder.name}'s account (${holder.email}) but was never verified — ` +
        `if that is this student, add them with that email and this ID; if not, remove that account`,
    };
  }
  return { account: null, by: null, conflict: null };
}

/** Land one roster entry on its account (or a new one). See PlacementMode. */
export function placeRosterEntry(db: Db, facts: RosterFacts, mode: PlacementMode): Placement {
  const email = normalizeEmail(facts.email);
  const { account, by, conflict } = matchAccount(db, { email, studentId: facts.studentId });
  if (conflict) return { kind: 'conflict', reason: conflict, account };

  if (!account) {
    // The address may be a student's own sign-up alias elsewhere; the roster's
    // word takes it.
    db.releaseSignupAlias(email);
    db.upsertUser(
      {
        email,
        name: facts.name || email.split('@')[0],
        role: facts.role,
        studentId: facts.studentId,
        section: facts.section ?? null,
        sortName: facts.sortName ?? null,
      },
      { verifiedId: mode !== 'request' },
    );
    return { kind: 'added', account: db.getUser(email)! };
  }

  const updates = mode === 'class-list' || (mode === 'instructor' && by === 'email');
  if (updates) {
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
      reason: 'not-on-roster' | 'id-mismatch' | 'id-required' | 'email-not-accepted' | 'email-taken';
      message: string;
    };

/**
 * Which roster seat a sign-up claims (no writes). The address comes first,
 * before any ID is looked up — so a refused address says nothing about which
 * IDs have seats: it must be one the roster already has, or a UCLA one. Then
 * the verified ID finds the account; with none (or an unverified one), the
 * email must name the account, and its ID on file — as written — must be the
 * one typed. The address becomes an alias (the caller stores it once the rest
 * of the sign-up checks out); one that already signs in to another account is
 * refused.
 */
export function claimForSignUp(db: Db, details: { email: unknown; studentId: unknown }): SignUpClaim {
  const email = normalizeEmail(details.email);
  const studentId = typeof details.studentId === 'string' ? details.studentId.trim() : '';
  const uid = normalizeUid(studentId);
  if (!email || !isEmail(email)) {
    return { ok: false, reason: 'email-not-accepted', message: 'Enter a valid email address.' };
  }
  const owner = db.emailOwner(email);
  if (!owner && !isCampusEmail(email)) {
    return {
      ok: false,
      reason: 'email-not-accepted',
      message: 'Use the email on your class-list record or your UCLA address (…@ucla.edu or …@g.ucla.edu).',
    };
  }
  const byUid = uid ? db.findUserByUid(uid) : null;
  let account: UserRow;
  if (byUid) {
    account = byUid;
  } else if (owner) {
    account = owner.account;
    const onFile = idOnFile(account);
    if (onFile && !uid) {
      return {
        ok: false,
        reason: 'id-required',
        message: 'Enter your student ID (UID) — it confirms the account is yours.',
      };
    }
    if (onFile && onFile !== uid) {
      return {
        ok: false,
        reason: 'id-mismatch',
        message: 'That student ID does not match the one on file for this email.',
      };
    }
  } else {
    return {
      ok: false,
      reason: 'not-on-roster',
      message: uid ? 'That student ID is not on the class roster.' : 'That email is not on the class roster.',
    };
  }
  if (owner && owner.account.email !== account.email) {
    return owner.source === 'signup'
      ? {
          ok: false,
          reason: 'email-taken',
          message: 'That email already signs in to another account — use the email on your class-list record, or ask your instructor.',
        }
      : {
          ok: false,
          reason: 'id-mismatch',
          message: 'That student ID does not match the one on file for this email.',
        };
  }
  return { ok: true, account, email };
}

/**
 * The account an SSO assertion signs in to, or null when the roster has no
 * seat for it (whether such a person may ask to be added is task 006's
 * question). The asserted UID finds the verified account; failing that, the
 * asserted email — as a key or a strong alias — may name an account whose ID
 * on file is the asserted one or none, which then takes the asserted UID as
 * verified: the identity provider's word is proof. The asserted email becomes
 * an alias (taking it from a student's own sign-up alias elsewhere).
 */
export function resolveAssertedIdentity(db: Db, asserted: { uid: string; email: string }): UserRow | null {
  const uid = normalizeUid(asserted.uid);
  let account = uid ? db.findUserByUid(uid) : null;
  if (!account) {
    const owner = db.emailOwner(asserted.email);
    if (!owner || owner.source === 'signup') return null;
    const onFile = idOnFile(owner.account);
    if (owner.account.uid || (onFile && onFile !== uid)) return null;
    if (uid) db.setUid(owner.account.email, asserted.uid);
    account = owner.account;
  }
  const email = normalizeEmail(asserted.email);
  if (isEmail(email)) db.addEmailAlias(account.email, email, 'sso');
  return db.getUser(account.email);
}
