---
id: 2026-09-25-040
type: feature
title: Land first-time visitors on the sign-in screen, not in the sandbox, and retire the sign-in trace that only served that rule
priority: high
size: small
requires: browser
area: app
source: feedback
created: 2026-09-25T09:00:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
App feedback report `fb-mug2tli8-1xhris` (author-role: student, category: platform design,
filed 2026-09-24): a student could not see how to sign in and only found the way once they were
in the sandbox. (Distilled per `tasks/CATCHER.md` §3; the report itself stays on the server.)

Mechanism: a browser with no trace of a previous sign-in (`mm:auth:known`) that opens the site
root is redirected straight into the sandbox (`app/src/routing.ts:175` `landingRoute`, called
from `initRouting` at `:322–331`, fed by `AuthGate.tsx:41`). There, the only ways to sign in
are the last words of the dismissible visitor banner and the topbar's Sign in button. Every
student's first visit on every new device is such a browser, so the whole class meets this
in week 1. The landing was an intake *assumption* of task 027 (`tasks/done/2026-09-22-027-visitor-mode.md`
§Design (a), "Gabriel to confirm"), never confirmed; this report is the evidence against it.

## Done when
1. Opening the site root with no session shows the **sign-in screen**, whatever the browser's
   history. `#/sandbox` still opens the sandbox directly for anyone (links from the website);
   a deep link to a signed-in route still shows the sign-in screen and returns there after
   sign-in (027's held routes, unchanged).
2. The rule it served is retired, not left dead: `landingRoute`, `initRouting`'s
   `hasSignInTrace` option, `AuthContextValue.hasSignInTrace` and both providers'
   implementations, `KNOWN_KEY` (`mm:auth:known`) and whatever writes it. An existing
   `mm:auth:known` in a browser is simply ignored (no migration needed).
3. The sign-in card leads with signing in: the form first, "Just exploring? Continue as
   visitor" as a quieter line below (it opens with the visitor block today —
   `app/src/auth/LoginScreen.tsx:36–56`; its comment's reasoning, "people arriving from the
   website want the machines", is served by the website's own sandbox link).
4. `app/tools/routingCheck.ts` pins the new rule (no session + `#/` → sign-in screen, not
   redirected; `#/sandbox` open to a visitor; held deep links) in place of the landing pins
   (`:134–139`), plus a grep gate that `mm:auth:known` is gone from `app/src`.
5. `CLAUDE.md` Part 1 "Visitors (task 027)" line updated in place (it describes the landing).
   (The report is already marked `filed → 2026-09-25-040` on the server.)

## Design
- **deepFix (chosen):** one front door. The sign-in screen already offers both paths (027
  item 4), so the landing redirect and the browser-history trace behind it are removed rather
  than tuned; nothing else reads the trace (grep: `routing.ts`, `AuthGate.tsx`,
  `authProvider.tsx:67, 164, 386`, `auth/types.ts:52–58`, `auth/accounts.ts:45–47`,
  `routingCheck.ts`).
- **surgicalFix (rejected by Gabriel):** keep landing in the sandbox and make the banner's
  Sign in louder. Leaves a first-time student one mis-click from the wrong place.
- `navResetCheck` / `routingCheck` cover principal changes; run both.

### Resolved decisions (Gabriel, 2026-09-25)
1. First-time visitors land on the **sign-in page** (which offers the sandbox as the second
   choice), not in the sandbox.

## Verify
`routingCheck` (new pins) + `navResetCheck`; browser, both modes: a fresh profile opening the
root sees the sign-in screen with the form first; "Continue as visitor" reaches the sandbox;
`#/sandbox` opens directly; sign in → Home; Log out → sign-in screen. Owed: the pilot after
release (a private window on `https://making-minds.pages.dev`).

## Progress log
