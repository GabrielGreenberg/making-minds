# `docs/buildout/` — the build-out loop's memory

This folder is the durable brain of the Making-Minds build-out: a self-driving,
memo-disciplined effort to make the UI able to construct a machine that solves
**every machine-buildable problem in HW1–HW6**, verified adversarially (function +
appearance). All state lives here, in the coverage manifest, and in fixtures — so
any single session is disposable.

## The files

| File | Role |
|------|------|
| [NORTH_STAR.md](NORTH_STAR.md) | The mission + definition of done + scope. Rarely edited. |
| [COVERAGE.md](COVERAGE.md) | The Problem Coverage Matrix — one row per problem; done when all ✅. |
| [QUEUE.md](QUEUE.md) | Ordered tasks (phased) + recurring meta-tasks. |
| [VISUAL_VOCAB.md](VISUAL_VOCAB.md) | The appearance oracle (textbook/mockup notation). |
| [LOG.md](LOG.md) | Append-only session journal. |
| [HANDOFF.md](HANDOFF.md) | The hot state — read first, rewritten each iteration. |

Machine-readable siblings: `app/tools/fixtures/coverage-manifest.json` (the rows +
fixture paths) and `app/tools/fixtures/reference/*.json` (reference solutions).

## How it runs

The human runs, in a separate Ultracode session:

```
/loop /handoff
```

`/loop` self-paces; each firing runs the [`/handoff`](../../.claude/commands/handoff.md)
command, which orients from these memos, does one queue task end-to-end (build →
adversarially verify → update these memos → commit), then schedules the next wake.
The harness (`npm run coverage`, from `app/`) is the objective gate: no COVERAGE
row goes green without a passing reference machine + a failing broken variant.

See the full design in the plan file that created this system:
`~/.claude/plans/i-need-your-help-sequential-lamport.md`.
