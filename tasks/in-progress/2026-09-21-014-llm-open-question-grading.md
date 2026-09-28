---
id: 2026-09-21-014
type: research
title: Design LLM-assisted grading for open questions
priority: low
size: large
requires:
area: server
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: in-progress
after: 2026-09-26-066
branch: robot/014-llm-open-question-grading
merged_into:
---

## Description
Open questions return a `'pending'` result carrying the response; `ManualReview`
(`{pass, note?, reviewedAt}`) is the shape an instructor writes via
`SubmissionStore.recordManualReview`. A server-side LLM pass could write the same shape.

Note (catch 2026-09-23): the course policy (makingminds.org Policies) says paragraph answers are
human-graded and machine problems are computer-graded "not with AI". So an LLM can at most
SUGGEST a verdict that a human confirms, inside the hand-grading queue designed by task
2026-09-23-031 — its design (memo `grading-interface.md` §10) makes an LLM a suggestion inside the
hand-grading queue, task 2026-09-26-066 — hence `after: 066`. Confirm with Gabriel whether even suggestions are wanted.

## Done when
A written design (`docs/buildout/designs/llm-grading.md`): where it runs, how it's
distinguished from a human verdict, whether it's a grade or a suggestion the instructor
confirms, cost/latency, and what the gradebook shows. Then a follow-up feature task.

## Design
Product fork to settle with Gabriel before building: suggestion-only vs autograde.
Implementation seam is `applyManualReview` + a `source: 'llm'` marker on the review.

### Resolved decisions (Gabriel, 2026-09-25, from the HW1 audit)
- **He wants LLM grading** for whatever can't be script-graded ("pass them through the LLM for
  grading"). The published Policies page still says paragraph answers are human-graded and
  computer grading is "not with AI". Settle that wording, and whether the LLM's verdict is final
  or a suggestion he confirms, before the first LLM-graded release.
- **Batch by problem, not by student.** All the P7 answers go in one request, then all the
  P8s, and so on.
- **Anonymous ids.** The LLM sees only an internal per-response id — no name, email or UID.
  The app keeps the id → (student, question, part, attempt) map and stitches the verdicts
  back to their owners itself.
- **One field per gradable part.** Task 046 splits HW1's multi-part problems into lettered
  questions; task 048 is the lasting fix.
- **Rubrics.** Each part needs a reference answer and a 0 / ½ / 1 rubric, stored
  instructor-only and stripped from student copies like `fill_in_answers`. Drafts for HW1's
  ten LLM-graded parts are on the audit page. ½ credit needs task 031's grade model.
- **Also check** UCLA's rules on sending student work (P3 data) to an outside AI service.

## Verify
n/a (research) — docs only; gates: check-budgets.

## Findings
- Design memo: `docs/buildout/designs/llm-grading.md` (proposed); `grading-interface.md` §10 now points to it.
- Corrected seam: `ManualReview`/`applyManualReview` were retired by 063 (types.ts `LEGACY`); the live seam is
  `HumanGrade` + `GradingStore` + `planGradeWrite`, and the design fits that, not a `source: 'llm'` marker.
- Recommendation: option B — a separate `grade_suggestions` record (never in score.ts precedence, stale on
  `answerKey`) that a person accepts through `planGradeWrite` (queue chip, `a` key, Accept all); server-only
  `SuggestionProvider` (anthropic | bedrock | fake | off, default off); local mode uses the fake, no network.
- Anonymity: per-run shuffled ids (never `public_id`), roster/email/UID redaction, delimited answers, strict
  JSON output, human confirm as the injection backstop; instructor-only `rubric` stripped in `sanitize.ts`.
- Cost: about $0.2–0.35 per problem-run, $5–9 per term for all 24 open questions on `claude-opus-5`.
- P3 (unverified): UCLA DTS lists Bedrock/Claude as approved but NOT for P3/FERPA data — UCLA approval is a
  release gate. Decisions owed to Gabriel (memo §9): suggestion vs final, Policies wording, disclosure, UCLA.
- **OPEN at landing — owed to the lander / next /catch:** the Done-when clause "Then a follow-up feature
  task" is drafted, not filed (`llm-grading.md` §11); the robot's work routine may not mint ids
  (tasks/README.md, id rule). File it into blocked/ with its Questions, or it is lost.
- Review fixes (memo): Accept picks name `{batchId, answerKey, version}` and the server refuses a stale
  suggestion (pure `planSuggestionAccept`), since `planGradeWrite` re-anchors to the latest answer; a run is
  logged in its own `suggestion_runs` row (no `'suggest'` `GradeChangeEvent`, which needs a student), and a
  replaced suggestion is not kept.

## Progress log
- 2026-09-27 (robot): Wrote `docs/buildout/designs/llm-grading.md` (options, decision B, data model, seam,
  where it runs, gradebook display, anonymity/rubric/injection, cost, P3 + release-gating decisions, blast
  radius, draft follow-up task); pointed grading-interface.md §10 at it. No code. Next step: land this task;
  then /catch files the follow-up feature task from the memo's §11 into blocked/.

### 2026-09-27 — implemented (work loop)
- Built: the design memo `docs/buildout/designs/llm-grading.md` — an LLM gives *suggestions* a person
  accepts (option B), kept apart from human grades, server-only provider (default off), anonymous batched
  requests per problem, cost/latency, gradebook display, P3/FERPA gate, blast radius, draft follow-up task
  (§11). `grading-interface.md` §10 points to it. No code.
- Pins: none added (docs only); the memo's §10 names the follow-up's pins (gradingViewCheck stale-accept
  cases, remoteStoreCheck against the real server).
- Gates: app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- Review: fixed 3 (stale-accept refusal via pure `planSuggestionAccept`; `suggestion_runs` table instead of
  a `'suggest'` event, replaced suggestions not kept; OPEN-at-landing note for the unfiled follow-up).
  Skipped 0. Nits left: §8 HW2–7 cost floor ($0.19 not $0.35); accept should add `fromBatch` beside the
  existing grade/override kind rather than replace it.
- Remains (owed): next /catch files the follow-up task from memo §11 into blocked/ (`next-id.mjs`);
  Gabriel confirms UCLA P3 approval (memo §9) and whether HW1 rubric drafts move into hw1.json. No visual
  check (no UI).
- NEXT STEP: loop session: no visual check owed; land per PROFILE §5, then /catch files the follow-up.

### 2026-09-27 — parked for review (robot)
- Fixed the §8 cost nit (HW2–7 floor $0.19). Left the `fromBatch`-beside-kind nit for review (memo §4 / §10).
- Design task → parked for Gabriel's review of the memo (LOOP §4), not landed. NEXT STEP: Gabriel answers the
  Questions (on the `blocked/` copy on main); then land the memo and /catch files the §11 follow-up into blocked/.
