---
id: 2026-09-23-036
type: feature
title: Identify students by UID, not only email — 37 of 87 class-list emails are not UCLA addresses
priority: high
size: large
requires: human
area: server
source: chat
created: 2026-09-23T14:00:00-07:00
status: in-progress
after: 2026-09-23-035
branch: task/036-identity-by-uid
merged_into:
---

## Description
Found while diagnosing the roster import (task 035, catch session 2026-09-23). The registrar
exports each student's PREFERRED email. In the Fall 2026 class list, **37 of 87 (43 %) are
personal addresses** (gmail, icloud, outlook, yahoo, me.com), not `@ucla.edu` or
`@g.ucla.edu`. The platform keys every person by email: `users.email` is the primary key
(`server/src/db.ts:82`), and submissions, workbooks, sessions and journal keys all hang off it.

### What breaks
- **Password sign-up today:** the Create-account pane says "Use the email the course has on
  file for you", with the placeholder `you@ucla.edu` (`app/src/auth/LoginScreen.tsx:294–303`).
  A student whose file email is personal will naturally type their UCLA address, get "not on
  the roster", and file an access request. Expect a large share of the class to hit this in
  week 1.
- **UCLA SSO (task 006):** the identity provider asserts the UCLA logon and the UID, not the
  personal email. Matching the roster by email would lock out 43 % of the class. SSO has to
  match on UID.
- The UID is the one identifier the registrar, UCLA's identity provider and the student all
  share. Its format is `999-999-999`, and `normalizeId` (`server/src/auth.ts:147–150`) already
  canonicalises it.

## Done when
1. The UID is the roster's identity: a unique normalised `uid` on `users` (nullable only for
   instructors and manual adds).
2. A person may have several emails: the roster email plus any UCLA address they sign up with,
   stored in a `user_emails` alias table pointing at one canonical account. Sign-in accepts
   any of them. Internal keys (submissions, workbooks) stay on the canonical email, so nothing
   needs rekeying.
3. **Sign-up:** UID + an email + password. If the UID is on the roster and unclaimed, the
   account is created, and the typed email becomes an alias when it is not the roster email.
   The pane's wording and placeholder stop implying `@ucla.edu`.
4. **SSO-ready:** `SsoAuthProvider` (006) resolves the asserted UID to the account. Its email
   attribute only becomes an alias.
5. The access-request flow stays for people genuinely missing from the list.
6. **Gates:** `authCheck` pins sign-up with a personal roster email, with a UCLA email (via
   UID), a wrong UID, an already-claimed UID, sign-in by either email, and a re-import that
   changes a student's roster email (the alias survives).

## Design
- **deepFix (recommended):** UID as identity, emails as aliases; see above. It retires the
  mismatch for password mode and SSO at once, and avoids rekeying stored work by keeping one
  canonical email per account.
- **surgicalFix:** change the wording to "use the exact email on your class-list record" and
  show a masked hint (`s•••@g•••.com`) after a correct UID. Cheap, but students still have to
  use an address they may not check, and it does nothing for SSO.
- Pointers: `server/src/db.ts:82–91, 165–167, 233`; `server/src/auth.ts:100–150` (password
  provider, `normalizeId`), `:248–272` (sessions, `requireAuth`); `server/src/app.ts:121–260`
  (auth routes); `app/src/auth/LoginScreen.tsx:280–340`; `server/src/roster.ts`.

### Resolved decisions (Gabriel, 2026-09-23)
1. **Yes:** a student signs up with their UID plus EITHER their class-list email or their UCLA
   email; both become sign-in addresses for the one account (the deepFix above, not the
   surgical wording-only fix).
2. **Yes, interim:** until this lands, the sign-up pane tells students to use the email on
   their class-list record, which may be a personal address. That one-line change ships inside
   task 035 (its Done-when item 9).
3. **Accepted until SSO (2026-09-24):** with no mail server, a typed UCLA address is unverified,
   so whoever knows a classmate's UID can claim that classmate's UNCLAIMED seat. Guessing is
   capped (per-IP refusal budget, no seat oracle); the targeted case is accepted for the pilot —
   the victim sees "an account already exists" and the instructor resets it. UCLA SSO (006)
   closes it.

### Plan (work session, 2026-09-24)
One identity module, `server/src/identity.ts`, is the only place an email or a UID resolves to
an account and the only place a roster entry lands on one. Every writer of roster rows goes
through it: the class-list import, the dashboard's add-person form, access-request approval,
the CLI's `add`, sign-up and SSO. The `Db` primitives enforce the invariants (a unique `uid`
index; an alias is never another account's key) so a caller that skips the module fails
loudly instead of splitting a person in two.
- **Schema:** `users.uid` (normalised `student_id`, partial UNIQUE index, backfilled once on
  the boot that adds it) + `user_emails (email PK, user_email → users ON DELETE CASCADE,
  source, added_at)`. `users.email` stays the canonical key; `student_id` stays the ID as written.
- **Matching a roster entry:** by UID first, then by email (canonical or alias). A matched
  account keeps its key; a new roster email becomes an alias (`source: roster`). Conflicts
  (the UID is one account's, the email another's; the email is on file with a different UID)
  are reported as import issues and never rebind an account. `parseRoster` also drops a later
  row repeating a UID. The who-left review matches by UID or any email.
- **Sign-up:** UID + email + password. The UID finds the account; with no UID typed, the
  email must find an account that has none on file (instructors, manual adds). The typed email
  must be the class-list email, an existing alias, or a UCLA address (`ucla.edu` or a
  subdomain), per decision 1. It becomes an alias (`source: signup`). The register throttle
  also counts failures per UID.
- **Sign-in:** any of the account's emails; sessions and all stored work stay on the canonical.
- **Access-request approval:** if the request's UID or email already names an account, the
  email becomes an alias of it (name and role untouched); otherwise a new roster row as today.
- **SSO:** `SsoAuthProvider.signInAsserted({uid, email, name})` does the resolution (UID first;
  else an email whose account has no UID, which then takes the asserted UID); the asserted
  email becomes an alias (`source: sso`). `authenticate` still throws until 006 supplies the
  assertion check; whether an unrostered SSO user may file a request stays 006's question 3.
- **Instructor:** the roster lists each account's other sign-in addresses, removable one at
  a time (`DELETE /api/roster/:email/aliases/:alias`); the CLI `list` prints them.
- **Client:** the set-up pane asks for UID first, then "your UCLA email or the email on your
  class-list record"; not-on-roster copy speaks of the UID; the sign-in pane says "your email".
- **Trust levels (from the adversarial review):** an ID is VERIFIED (`uid`) only from the class
  list, an instructor or SSO; an approved request's typed ID stays as written, and a class-list
  row carrying it is a conflict until the instructor confirms it with the add form. An account
  "has an ID on file" as written, verified or not. A `signup` alias is the student's own word:
  the class list, SSO or an approval takes the address from it, a sign-up never does
  (`email-taken`), and an ID-less entry under one is a conflict. The add form only adds an
  address when a typed ID matches someone under another email (a typo never renames anyone).
  Removing the alias an account was set up through (`registered_via`) clears that password and
  its sessions. Sign-up checks the address before the ID (no seat oracle) and every refusal
  counts toward a per-IP budget (100 / 10 min); sign-in throttles per account.

## Verify
`authCheck` decision table (above); a browser pass of the three sign-in panes in remote mode.
Owed: a real SSO round trip (006).

## Progress log

### 2026-09-24 — built, gates green (work session)
Built per the Plan above. Server: `server/src/identity.ts` (new), `db.ts` (`users.uid` + unique
index + one-time backfill; `user_emails`; `findUserByEmail` / `findUserByUid` / alias
primitives that refuse to split a person), `auth.ts` (sign-up through `claimForSignUp`, sign-in
by any alias, `SsoAuthProvider.signInAsserted`), `app.ts` (register throttled per email and
per UID; add form, approval, request `match`, `DELETE /api/roster/:email/aliases/:alias`),
`roster.ts` (`normalizeUid`, `isCampusEmail`, duplicate-UID rows, review by UID or any email),
`rosterImport.ts` + `roster-cli.ts` through `placeRosterEntry`. Client: set-up pane asks UID
first, then "your UCLA email or class-list email"; the roster lists aliases (removable) and
which account a request names. Pins: authCheck `[identity]` (43) + `[http: identity by UID]`,
rosterCheck `[uid]` + UID-aware review, remoteStoreCheck client half. Gates: server
`npm run check`, app tsc + tools tsc + build + `npm run check`, all exit 0. Browser (remote
mode, scratch DB): set-up refusal copy, sign-up with a UCLA email onto a personal class-list
account, sign-in by that alias, request match → approve → alias, alias ×. Docs: CLAUDE.md,
server/README.md, deploy/README.md. Next: fold in the adversarial review's findings, then land.
