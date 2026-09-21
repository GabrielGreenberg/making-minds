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
after:
branch:
merged_into:
---

## Description
Open questions return a `'pending'` result carrying the response; `ManualReview`
(`{pass, note?, reviewedAt}`) is the shape an instructor writes via
`SubmissionStore.recordManualReview`. A server-side LLM pass could write the same shape.

## Done when
A written design (`docs/buildout/designs/llm-grading.md`): where it runs, how it's
distinguished from a human verdict, whether it's a grade or a suggestion the instructor
confirms, cost/latency, and what the gradebook shows. Then a follow-up feature task.

## Design
Product fork to settle with Gabriel before building: suggestion-only vs autograde.
Implementation seam is `applyManualReview` + a `source: 'llm'` marker on the review.

## Verify
n/a (research).

## Progress log
