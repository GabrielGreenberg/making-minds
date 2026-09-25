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

## Verify
`authCheck` decision table (above); a browser pass of the three sign-in panes in remote mode.
Owed: a real SSO round trip (006).

## Progress log
