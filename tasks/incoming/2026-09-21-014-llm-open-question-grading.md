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
status: ready
after: 2026-09-23-031
branch:
merged_into:
---

## Description
Open questions return a `'pending'` result carrying the response; `ManualReview`
(`{pass, note?, reviewedAt}`) is the shape an instructor writes via
`SubmissionStore.recordManualReview`. A server-side LLM pass could write the same shape.

Note (catch 2026-09-23): the course policy (makingminds.org Policies) says paragraph answers are
human-graded and machine problems are computer-graded "not with AI". So an LLM can at most
SUGGEST a verdict that a human confirms, inside the hand-grading queue designed by task
2026-09-23-031 — hence `after: 031`. Confirm with Gabriel whether even suggestions are wanted.

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
n/a (research).

## Progress log
