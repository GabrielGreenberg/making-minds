---
id: 2026-09-25-049
type: feature
title: Grade equation answers by evaluating them, the same value-based way machines are graded
priority: normal
size: large
requires: browser, human
area: app
source: audit
created: 2026-09-25T10:35:00-07:00
status: ready
after: 2026-09-25-048
branch:
merged_into:
---

## Description
From the HW1 audit (2026-09-25). HW1's Functions and Representations problems ask for
equations: P7 `k(x, y) = s(x · y)`, P8 compositions of s and a with p(1, 2) = 5, P10's Boolean
functions, and P15 `g(x, y, z) = 4·f(x) + 2·f(y) + f(z)`. Today they are free text for a human
or LLM. They could be script-graded the way machines are: check the student's function
against sample points, extensionally.

P15's target mistake is visible in the formula itself: `4x + 2y + z` does arithmetic on
symbols, i.e. a mark variable appears outside f. That is exactly what a parser can check and
a reader can miss.

## Done when
An `equation` answer kind has:
- a lenient parser accepting • · × * for times, − -, x² / x^2, and the named functions of the
  problem (s, a, f…), with implicit multiplication
- a live "we read this as: …" preview, so the student sees how their answer was parsed
- a grader that checks the reference extensionally on a sample grid (or the whole finite
  domain), plus per-question structural rules: allowed functions (P8: only s and a); variables
  only inside f (P15); two answers that must define different functions (P8) or differ in
  form (P10)

HW1 P7, P8, P10 and P15 move to it. Design memo + Gabriel's approval first.

## Design
Reuse the authoring DSL's evaluator ideas (`engine/formulaEval.ts`), but NOT its trust
model: student input must never reach `new Function()`. Needs a real parser. Pure, in
`engine/`. Answers never ship to the client in remote mode (sanitize).

## Verify
Gates; a pin per structural rule; a table of accepted and refused student spellings.

## Progress log
