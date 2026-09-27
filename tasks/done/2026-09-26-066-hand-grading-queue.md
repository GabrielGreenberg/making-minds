---
id: 2026-09-26-066
type: feature
title: Build the hand-grading queue — one problem across students, 0 / ½ / 1 keys, hide names, soft claims, changed-since-graded suggestions
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-26T21:34:00-07:00
status: done
after: 2026-09-26-065
branch:
merged_into:
---

## Description
Filed from task 031's accepted design (Gabriel approved 2026-09-26, with its three proposed defaults). Authority: the memo `docs/buildout/designs/grading-interface.md` — its §3 table records every decision; read it before starting. Slice 6 of 11 (memo §12). HW1 is due Oct 4 and is returned about a week later, so slices 1–8 carry the schedule.

24 paragraph problems across HW1–HW7 ≈ 1,900 hand grades a term. The queue is where they
happen (memo §6.4, mockup 4, `tasks/attachments/2026-09-23-031-4-queue.png`).

## Done when
- `GET /api/assignments/:id/questions/:qid/responses` (the queue feed: per latest attempt the
  answer — text / blanks, a machine by reference — grade, answerKey, claim) and
  `POST /api/grading/claims` (in memory, 5-minute TTL renewed while active).
- `#/instructor/grading/:asg/queue/:qid`: **By problem** — statement (collapsible), one
  response, 0 / ½ / 1 (keys `0`, `h`, `1`), note (optional on a hand grade; placeholder "No
  medical or accommodation details"), **Save & next** (↵), J/K next/previous (vim/Gmail: J = next); it skips graded
  and claimed responses; the side list shows states (to grade, changed, graded, claimed by …).
  **By student** walks one student's pending problems.
- **Hide names** toggle (per-person ui pref in localStorage) shows "Response 39".
- A "changed since graded" response offers its old grade as a one-click suggestion.
- A 409 from a stale version shows the other grader's grade instead of overwriting.
- Pinned: claim TTL and skip logic (pure, in a check tool), responses feed has no answer key
  for autograded parts, 409 path.

## Design
- **deepFix:** the queue is a view over the 064/063 seam; claims are advisory, versions are
  the real guard.
- Pointers: `usePasteGuard.ts` (the note field is not assignment content but must not add a
  clipboard API), `StatementBody` for the prompt.

## Verify
Gates; browser: grade ten toy responses by keyboard alone; two tabs as two instructors
see the claim and the 409.

Done 2026-09-27 (Implement stage, headless Chrome over the Vite dev server, local mode,
HW1 seeded): `/queue` lands on Problem 6a; `h ↵ 1 ↵ 0 ↵` graded all three local responses
by keyboard (counts 0 → 3 of 3, then "All caught up"); Hide names switch → "Response N";
By student walks one submitter's 9 waiting problems; typing `1`/`h` in the note leaves the
points alone; 390 px wide: one column, no horizontal scroll.

**Owed (remote mode — local mode has one instructor and three HW1 submitters):**
1. `cd server && MM_AUTH_MODE=dev npm run dev` (port 8199) and the "Vite Remote Mode"
   launch config; import ten fake students (`npm run roster`), submit HW1 as each (dev
   login), add a second instructor (made-up name).
2. Tab A as instructor 1 → `#/instructor/grading/hw1/queue/<open qid>`: grade ten
   responses with `0`/`h`/`1` + ↵ alone.
3. Tab B (a private window) as instructor 2 on the same problem: the response open in
   tab A shows "claimed by <name>" in the side list and Save & next skips it.
4. Both tabs open the same ungraded response (click it in the side list); save in A, then
   in B → B shows "Graded … by … meanwhile — theirs stands" with Keep theirs / Save mine.
5. Resubmit one graded student with a different answer → the queue shows "↻ was ½" and
   the card's "Keep ½" saves it in one click.

## Progress log
- 2026-09-27 (robot, Implement): built on `robot/066-hand-grading-queue`. Pure
  `storage/gradingClaims.ts` (ClaimBook, TTL 5 min, never stolen, one per grader) and
  `gradingSummary.ts buildQuestionResponses` (the feed; answer keys only as a sha256
  fingerprint, a machine by attempt reference); `GradingStore.responses/claim` (local:
  in-page ClaimBook; remote: `getQuestionResponses`/`postGradingClaim`); server routes
  `GET …/questions/:qid/responses`, `POST /api/grading/claims`; route
  `/queue/student/:sid`; `instructor/gradingQueueViews.ts` (pure) + `GradingQueue.tsx`;
  Overview "Grade →"; pages.css queue block. Pins: gradingViewCheck [claims] [queue]
  [feed] (grep gate widened), server gradingCheck [queue feed] [claims] [queue 409],
  routingCheck. Decisions: the queue lists every submitter (roster first, off-roster
  tagged) ordered by opaque key so "Response N" is stable and name-blind; one live claim
  per grader; a live claim is only shown, never taken; claims renew every 60 s only after
  activity in the last 5 min; By student reuses the queue card until 067 builds the §6.3
  page; J = next, K = previous (vim/Gmail), the hint says so. The pure module is
  `gradingQueueViews.ts`, not `gradingQueue.ts` — that name collides with
  `GradingQueue.tsx` on macOS's case-insensitive filesystem.
- 2026-09-27 (robot, review fixes): Save & next now writes the version the card MOUNTED
  with (pinned in a ref; the 30 s poll and a 409 patch no longer rebase it) — only "Save
  mine over it" or a successful save rebases; while a conflict shows, ↵ = Keep theirs &
  next. Mouse clicks on the side list, Hide names, statement toggle and Previous keep focus
  off the button so ↵ still saves. The side list says "claimed by <name>". The Done-when's
  J/K clause amended to record the J = next decision.

### 2026-09-27 — implemented (work loop)
- **Built:** the hand-grading queue. One open response at a time under its (collapsible)
  statement, 0 / ½ / 1 by key (`0` `h` `1`), optional note, ↵ = Save & next (skips graded
  and others' claimed responses), J/K next/previous; side list with states; By student walks
  one student's pending problems; Hide names ("Response N", per-person ui pref); a changed
  answer offers its old grade as one click; a 409 shows the other grader's grade ("theirs
  stands", Keep theirs / Save mine over it). Server: `GET …/questions/:qid/responses`,
  `POST /api/grading/claims` (in-memory ClaimBook, 5-min TTL). Overview "Grade →" opens it.
- **Pins:** gradingViewCheck [claims] [queue] [feed]; server gradingCheck [queue feed]
  (no answer key / test cases in the feed) [claims] [queue 409]; routingCheck (queue routes).
- **Gates:** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- **Review:** 4 fixed (claimed-by text; J/K recorded as J = next; keepFocus so ↵ still
  saves after a mouse click; version pinned at mount so polls/409 never rebase silently),
  0 skipped.
- **Owed (loop session):** browser checks in local mode (queue page, keys, Hide names,
  By student, 1080px + phone width) and remote mode (ten fake students by keyboard alone;
  two instructors: claim shown + skipped, 409 → theirs stands, Save mine works, claim lapses;
  resubmit → ↻ with one-click Keep). Fake names only, scratchpad files, never git.
- **NEXT STEP:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-27 (robot, land)
- The browser pane can't start a dev server in an unattended run. For the visual check I used
  headless Chrome (CDP, the shootProblemSets recipe) over a scratch Vite in local mode, with the
  sample assignment's 5 submitters on P14.
- Found and fixed (27b708b): ByProblem used '' to mean "all caught up", but the sample's anonymous
  submitter has the key ''. So the queue opened on "All caught up" with 0 of 5 graded. The
  current response is now `{key}` | CAUGHT_UP | null. After the fix: the card renders; 1 + Enter
  saves and moves on ("1 of 5 graded", the side list shows 1, the next response is "grading");
  J moves to the next response; at 375px nothing scrolls sideways (widest element 375).
- Gates re-run after the fix, all exit 0: app tsc, build, check, typecheck:tools; server tsc,
  check.
- Owed, not claimed: every local-mode submitter reads "Not on the roster" (the sample's emails
  aren't toy accounts; this predates 066, from 064's localIdentity), so the name/Hide-names
  labels were only checked in code and pins. Also owed: the remote-mode checks above (ten fake
  students by keyboard alone, two instructors' claim + 409, the ↻ Keep suggestion), and By
  student in the browser.
