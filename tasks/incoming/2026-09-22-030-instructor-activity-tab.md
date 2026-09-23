---
id: 2026-09-22-030
type: feature
title: Add an Activity tab to the instructor Dashboard — class usage from our own data, plus Cloudflare site traffic
priority: normal
size: large
requires: browser, ssh, human
area: server
source: chat
created: 2026-09-22T19:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Gabriel wants to see how the platform is being used **inside the app**, without logging
into Cloudflare. Two layers, in this order of importance:

1. **Class activity from our own database** (exact, no third party): who has an account,
   who is active, and per assignment how many students have started / saved / submitted,
   plus the pass rate per question. The server already records nearly all of this
   (`workbooks.updated_at`, `submissions.submitted_at` + graded `result`, `users`).
2. **Site traffic from Cloudflare Web Analytics** (secondary panel): visits and page views
   over time, top referrers, countries, devices. Fetched **server-side** from Cloudflare's
   GraphQL Analytics API. The Cloudflare token never reaches the browser.

## Done when
- The Dashboard has an **Activity** tab (`#/instructor/activity`) beside Assignments ·
  Roster & accounts · Feedback · Notes, built from the page vocabulary (`theme.css`,
  `pages.css`; `themeCheck` green).
- **Class section** (remote mode): accounts created vs roster size; students active in the
  last 24 h / 7 days; a table per assignment: started (has a workbook), saved in the last 7 days,
  submitted (by the due date / late), plus per-question pass rate on latest attempts. Local
  mode shows the same from local stores, or a clear "remote only" note. Pick one and
  record the choice in the progress log.
- **Traffic section**: visits and page views per day for the last 30 days (a small chart),
  top referrers / countries / devices. When the server has no Cloudflare credentials it
  shows "Cloudflare traffic not configured", not an error. In local mode it shows "not available in local mode".
- New instructor-only endpoints (e.g. `GET /api/analytics/activity`,
  `GET /api/analytics/traffic?days=30`) sit behind `auth, requireInstructor`. The traffic
  result is cached in memory (≈10 min) so dashboard loads never hammer Cloudflare. A
  Cloudflare failure degrades to a message, never a 500 that breaks the page.
- Credentials come from env (`MM_CF_ACCOUNT_ID`, `MM_CF_ANALYTICS_TOKEN`,
  `MM_CF_SITE_TAG`) via `server/src/config.ts`, are documented in `deploy/README.md` and the
  systemd unit's env notes, and are **never** logged or sent to the client.
- Students get 403 on every analytics endpoint (pinned in `serverCheck`).

## Design
- **deepFix:** one `AnalyticsStore` seam (`app/src/storage/`, exported only from
  `backend.ts`), like `FeedbackStore` / `NotesStore`: `getActivity()` and
  `getTraffic(days)`. Remote impl = `api/client.ts` calls. Local impl = activity computed
  from the local stores (cheap, since they're already in the browser), traffic → `null`
  ("not available"). The server side splits in two:
  - `server/src/analytics.ts` — pure aggregation SQL/functions over `users`, `workbooks`,
    `submissions`, `assignments` (latest attempt per student, as the gradebook does).
  - `server/src/cloudflare.ts` — a small GraphQL client (`POST
    https://api.cloudflare.com/client/v4/graphql`, Bearer token) querying the Web Analytics
    (RUM) dataset (`rumPageloadEventsAdaptiveGroups`, filtered by `siteTag`, grouped by
    date / referrer / country / device), with a TTL cache and a timeout.
- **surgicalFix:** skip the seam and call `fetch` from a new Dashboard view directly. This is
  rejected because it violates the seams rule, and local mode would make `/api` traffic (law 5).
- **"Active" needs a timestamp we don't have yet.** `users` has no `last_seen` and
  `sessions` stores only `expires_at` (`server/src/db.ts:82-91`). Options: (a) derive
  activity from `max(workbooks.updated_at, submissions.submitted_at)`, with no schema change and
  good enough since autosave writes on every edit; (b) add `users.last_seen_at`, touched in
  the auth middleware at most once per few minutes. **Recommend (a)** and upgrade to (b) only if
  "logged in but did nothing" matters.
- **Cloudflare caveats to show on the panel:** the app uses hash routing
  (`app/src/routing.ts`) and the beacon ignores the `#…` part, so in-app views probably all
  count as `/`. The panel reports site-level traffic, not per-page. Ad-blockers block
  the beacon, so numbers are a floor. Confirm when worked: the exact GraphQL field names,
  data retention, the free plan's max query window, and that auto-injection works for our
  **Direct Upload** deploys (`deploy/release.sh:142` uses `wrangler pages deploy`; the docs
  only say "on the next deployment", and the HTML must be valid). If auto-injection doesn't
  fire, add the beacon `<script>` to `app/index.html` behind a build-time env
  (`VITE_CF_BEACON_TOKEN`) so local mode stays byte-identical.
- **Privacy:** the class section shows data we already hold and instructors already see in
  the gradebook. Nothing new is collected from students. Cloudflare Web Analytics is
  cookieless. No third-party product-analytics SDKs.
- Routing: add `instructor-activity` to the `Route` union (`app/src/routing.ts:41-43`)
  and a tab in `app/src/instructor/InstructorLayout.tsx:32`.

### Resolved decisions
- 2026-09-22 (Gabriel, chat): wants Cloudflare traffic visible in-app. The catcher recommended
  leading with DB-derived class activity, and Gabriel asked to file it that way.

## Verify
- Gates: both `tsc`s, `npm run build`, app `npm run check`, server `npm run check`.
- Pin in `server/tools/serverCheck.ts`: activity endpoint numbers against a seeded DB
  (N accounts, M workbooks, K submissions, known pass rates); 403 for students; traffic
  endpoint returns the "not configured" shape with no env set; Cloudflare client tested
  against a stubbed `fetch` (success, error, timeout → degraded message; cache hit on
  second call).
- `remoteStoreCheck`: the new remote store stays grader-free.
- Browser (owed): the Activity tab in local and remote mode ("Vite Remote Mode" + local
  server on 8199), light/dark, phone width.
- Owed, human + ssh: Gabriel enables Web Analytics on the Pages project, creates the
  read-only token, and puts the three env values on the Lightsail box. After a release, confirm
  the beacon appears in the deployed `index.html` and the panel shows real numbers.

## Progress log
