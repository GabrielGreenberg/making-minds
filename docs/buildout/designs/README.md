# Design memos

One memo per significant architectural decision, written **before**
implementation (the central design principle in
[NORTH_STAR.md](../NORTH_STAR.md): unified, deep solutions over surgical
patches — and big moves get their reasoning recorded so later sessions follow
the *why*, not just the diff).

## When a memo is required

Whenever a task's deep solution changes an interface, a seam, a data format, or
a convention that more than one part of the app depends on. Not for small
fixes — the depth check in `/handoff` Phase B decides.

## Format (`<slug>.md`)

```markdown
# <Title>
_Status: proposed | accepted | superseded · Date · Task: <QUEUE id>_

## Problem family
What class of phenomena is this? List the concrete instances (course problems,
COVERAGE rows, known follow-ups) that warrant solving the class.

## Options
Each option with its depth: the shallow fix, the deep fix, anything between.
What each captures and what each leaves as a future patch.

## Decision
The chosen depth and why it's warranted by the phenomena (not speculative).

## Blast radius
Files/seams touched, migrations needed, how the harness stays green
(split plan if it can't land in one arc).
```

Expected early memos (queued): `transition-notation.md` (P2.1),
`target-functions.md` (P3.1).
