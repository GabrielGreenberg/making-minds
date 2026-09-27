// Soft claims on hand-grading work (task 066; design memo
// docs/buildout/designs/grading-interface.md §6.4, decision 17): opening a
// response in the queue claims it for five minutes, renewed while the grader
// is active, so a second grader's queue skips it and shows "Being graded by
// …". ADVISORY only: a grade write never checks a claim — the grade row's
// `version` (storage/gradeWrites.ts, a 409 on a stale one) is what stops two
// graders overwriting each other.
//
// Held in memory (the server: one book per app; local mode: one per page), so
// there is nothing to migrate or clean — a restart forgets every claim, which
// only means a response may briefly show as unclaimed.
//
//   · A claim lives until `until` = the claim's time + CLAIM_TTL_MS; it is
//     expired iff now >= until.
//   · One live claim per grader (the `actor`): claiming a new response drops
//     their old one; claiming the same one again renews it.
//   · Another grader's live claim is never stolen — the answer names who holds
//     it — but an expired one is.
//
// Pure: no storage, no clock (the caller passes `now`) — the server imports it.

/** How long a claim lives without renewal. */
export const CLAIM_TTL_MS = 5 * 60 * 1000;

/** What is claimed: one problem of one student's work. `studentKey` is the
 *  opaque grading key (GradingIdentity.key) — never an email or UID. */
export interface ClaimTarget {
  assignmentId: string;
  studentKey: string;
  questionId: number;
}

/** Who claims: `actor` identifies the grader (their sign-in email — it never
 *  leaves the book), `name` is what other graders are shown. */
export interface Claimant {
  actor: string;
  name: string;
}

/** A claim attempt's outcome: held (until, ISO), or someone else holds it.
 *  (After a release: `by`/`until` null = nobody holds it now.) */
export type ClaimOutcome = { held: true; until: string } | { held: false; by: string | null; until: string | null };

/** A claim as the queue feed shows it to a viewer: who, whether it is the
 *  viewer's own, and when it lapses (ISO). */
export interface ClaimView {
  by: string;
  mine: boolean;
  until: string;
}

interface Held {
  target: ClaimTarget;
  who: Claimant;
  until: number;
}

const keyOf = (t: ClaimTarget) => `${t.assignmentId}\0${t.studentKey}\0${t.questionId}`;

export class ClaimBook {
  private readonly byTarget = new Map<string, Held>();
  /** actor → the key of their one live claim. */
  private readonly byActor = new Map<string, string>();

  /** Claim (or renew) a target. Never replaces another actor's live claim. */
  claim(target: ClaimTarget, who: Claimant, now: number): ClaimOutcome {
    const key = keyOf(target);
    const cur = this.byTarget.get(key);
    if (cur && cur.until > now && cur.who.actor !== who.actor) {
      return { held: false, by: cur.who.name, until: new Date(cur.until).toISOString() };
    }
    if (cur) this.drop(key);
    const old = this.byActor.get(who.actor);
    if (old !== undefined) this.drop(old);
    const held: Held = { target: { ...target }, who: { ...who }, until: now + CLAIM_TTL_MS };
    this.byTarget.set(key, held);
    this.byActor.set(who.actor, key);
    return { held: true, until: new Date(held.until).toISOString() };
  }

  /** Let go of a target — only its holder can; anyone else is a no-op. */
  release(target: ClaimTarget, actor: string): void {
    const key = keyOf(target);
    if (this.byTarget.get(key)?.who.actor === actor) this.drop(key);
  }

  /** The live claims on one problem of an assignment, by student key, as
   *  `viewer` sees them. Expired claims are pruned on the way. */
  active(assignmentId: string, questionId: number, now: number, viewer?: string): Map<string, ClaimView> {
    this.prune(now);
    const out = new Map<string, ClaimView>();
    for (const h of this.byTarget.values()) {
      if (h.target.assignmentId !== assignmentId || h.target.questionId !== questionId) continue;
      out.set(h.target.studentKey, { by: h.who.name, mine: viewer !== undefined && h.who.actor === viewer, until: new Date(h.until).toISOString() });
    }
    return out;
  }

  /** How many claims the book holds (live or not yet pruned) — for the pins. */
  get size(): number {
    return this.byTarget.size;
  }

  private prune(now: number): void {
    for (const [key, h] of this.byTarget) if (h.until <= now) this.drop(key);
  }

  private drop(key: string): void {
    const h = this.byTarget.get(key);
    if (!h) return;
    this.byTarget.delete(key);
    if (this.byActor.get(h.who.actor) === key) this.byActor.delete(h.who.actor);
  }
}
