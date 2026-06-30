# CLAUDE_KB — Claude knowledge base

Reference docs for Claude (and humans) to read **before working on a feature**. Unlike the
root `CLAUDE.md` — which is auto-loaded every session and kept short — these files are loaded
on demand, only when relevant to the task at hand.

## How to use it

The root `CLAUDE.md` (Part 2 → "Knowledge base") holds the **mapping** from *what you're
working on* to *which files to read here*. When you start on a feature, look up the area in
that table and read the listed docs first.

## Layout

```
CLAUDE_KB/
  README.md            ← this file
  engines/             ← technical specs for the evaluation engines
    overview.md          shared model: components, ports, bit layout, module map
    cc.md                combinatorial circuits   (app/src/engine/cc.ts)
    sc.md                sequential circuits       (app/src/engine/sc.ts)
    fsm.md               finite state machines     (app/src/engine/fsm.ts)
    tm.md                turing machines           (NOT YET IMPLEMENTED — design notes)
    grading.md           autograder, test vectors, formula DSL, representation
  instructor/          ← the instructor-facing mode
    frontend.md          authoring, gradebook, routing, role gating
  pipeline/            ← cross-cutting data flows
    autograde-pipeline.md  submit → grade-on-receipt → gradebook
```

## Conventions

- One concern per file; keep each doc focused enough to read in full before a task.
- Specs describe the **code as it is** (file paths, exported signatures, semantics, gotchas).
  Where a doc describes something not yet built, it says so explicitly at the top (see
  `engines/tm.md`).
- When you add a doc, **register it in the mapping** in `CLAUDE.md` (Part 2 → "Knowledge
  base") so it's discoverable — an unlisted doc is an invisible doc.
- When code changes invalidate a spec, update the spec in the same change.
