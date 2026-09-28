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
status: blocked
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
n/a (research).

## Progress log

## Questions
Parked by the robot (2026-09-27): a design task — the memo `docs/buildout/designs/llm-grading.md` is written
on branch `robot/014-llm-open-question-grading` (not yet on main) and awaits your review (LOOP §4).
1. Approve the memo's recommendation — the LLM only *suggests* 0 / ½ / 1, a person accepts each (option B)?
   Recommend: yes; the other option is to make its verdict final.
2. OK to land the memo as is, and have the next /catch file its §11 follow-up feature task into blocked/?
   Recommend: yes.
3. The Policies page says prose is human-graded and computer grading is "not with AI". Reword it before the
   first LLM-suggested release? Recommend: yes, wording per memo §9.
4. Will you check with UCLA (Privacy / IT Security) that anonymized student prose (P3/FERPA) may go to Claude,
   via the Anthropic API or AWS Bedrock? Recommend: yes, before launch; the memo gates release on it.
5. The memo prices the default model as `claude-opus-5` at $5/$25 per M tokens. Should the follow-up use the
   current model (`claude-opus-5-5`) and recheck prices then? Recommend: yes.
