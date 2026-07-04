# Instructor frontend

**Status: implemented (CC authoring).** Role-gated `#/instructor` mode for authoring
assignments and viewing grades. This doc is the **as-built** reference; it was distilled from
the original design plan (`CLAUDE_NOTES/instructor_frontend.md`, preserved in git history),
updated to match the shipped code. The student-facing UI is untouched; both modes share the
data model and engine.

## Where it lives

A separate render subtree, reached by hash route, bypassing the student Zustand store entirely.

| Route | View | File |
|-------|------|------|
| `#/instructor` | dashboard | `instructor/InstructorDashboard.tsx` |
| `#/instructor/assignments/new` | (prompts for title, then redirects to editor) | dashboard |
| `#/instructor/assignments/:id/edit` | assignment editor | `instructor/AssignmentEditor.tsx` |
| `#/instructor/assignments/:id/submissions` | gradebook | `instructor/GradebookView.tsx` |

`App.tsx` calls `useInstructorRoute()` (`instructor/useInstructorRoute.ts`); when the hash is an
instructor route it renders `<InstructorApp route={…}>` instead of the student subtree.
`InstructorApp` wraps everything in `InstructorGate` + `InstructorLayout`. The hook reads the
hash via `useSyncExternalStore`, re-rendering on `popstate` and the `ROUTE_EVENT` that
`navigate()` dispatches — no instructor state lives in `store.ts`.

## Seams (prototype → product)

| Seam | Interface | Today | Later |
|------|-----------|-------|-------|
| Identity | `auth/` (`useAuth`, `getCurrentUserEmail`) | mockup login: pick a toy account (`auth/accounts.ts`); session in `localStorage` `mm:auth:current` | SSO session |
| Instructor role | `auth/instructorRole.ts` (`isInstructor`) | derived from the logged-in account's `role` | SSO role claim |
| Authored assignments | `storage/AssignmentStore.ts` (`list/get/save/remove`) | `localStorage` prefix `mm:inst-asg:` | server CRUD |
| Gradebook | `instructor/Gradebook.ts` (`gradeSubmissions/computeStats`) | reads `localSubmissionStore` | server query |

**Role is a property of the account, not a separate toggle.** `AuthGate` shows a login screen
(`auth/LoginScreen.tsx`) until you pick a toy account — **John Doe** (student) or **Prof. Ada**
(instructor); the choice persists in `localStorage` so a reload stays signed in. `isInstructor()`
reads that account's `role`. `InstructorGate` renders the instructor UI for instructor accounts
and an **access-denied** screen for students. The "Instructor view" link is shown only to
instructor accounts, so a student reaches `#/instructor` only by typing the URL — and hits the
denial. This is the same seam SSO replaces: `Account.role` becomes the token's role claim and
`isInstructor()` reads that; the consumers don't change.

## Assignment registry merge (`assignments/index.ts`)

`listAssignments()` / `getAssignment()` merge two sources: **bundled** assignments (compiled in
from JSON, read-only) and **instructor-authored** ones (mutable, via `AssignmentStore`). Bundled
wins on id collision. `isBundledAssignment(id)` distinguishes them (only custom ones are
editable/deletable). `createAssignment(title)` slugifies the title + a base-36 timestamp suffix
for a collision-free id, saves an empty assignment, and returns it.

## Data model for authoring (`types.ts`)

`AssignmentQuestion.cc_spec?: CCSpec` captures everything needed to (re)generate `test_cases` and
render the question in the instructor UI:

```
CCSpec    = { inputs: CCInputGroup[]; outputs: CCOutputGroup[] }
CCInputGroup  = { name; width }
CCOutputGroup = { name; width; formula }   // formula = the reference function
AssignmentQuestion.representation: RepSystem   // one rep per question (binary | tally)
```

`cc_spec` drives authoring **and** supplies the per-group **widths** the codec needs to grade
(space = wires/group, time = steps/group). The single `representation` (not per-group `encoding`)
governs both generation and grading. The grader compares against the generated numeric
`test_cases`. See `CLAUDE_KB/engines/grading.md` (codec) and the `CLAUDE.md` "Reference-function
DSL" section for the formula language.

## Question creator (`instructor/QuestionCreator.tsx`)

One shared form (local state), authoring all four modes — the `CCSpec` shape, DSL, and preview
are mode-agnostic, so mode is an ordinary field, not a gate:
1. **Mode** — `CC | SC | FSM | TM`, a button toggle next to Representation. All four are
   functional; switching mode does **not** clear the entered groups/formulas.
2. **Representation** — one binary/tally toggle for the whole question (governs grading + the
   preview). For TM this is the tape notation (tally→unary, binary→binary).
3. **Inputs/outputs** — dynamic lists of groups (name, width), with running wire counts. The
   `width` label is captioned per mode (wires for CC; time steps for SC/FSM; max input value for
   TM), with a one-line caveat for SC/FSM/TM that width isn't a machine capacity there.
4. **Formula + preview** — each output group's formula is evaluated by the DSL under the chosen
   representation and mode (`instructor/ccPreview.ts`). Enumerating the whole input space on every
   keystroke was the source of editing lag, so the preview is split into two tiers:
   - **Live check** (`probeFormulas`, per keystroke) — evaluates every formula on a **single**
     input (editable per group; defaults to each group's max value). O(#groups), independent of
     space size. Surfaces formula syntax/reference errors inline and blocks save.
   - **Examples** (`buildExamples`, on demand) — a button enumerates only the **first
     `DEFAULT_EXAMPLE_LIMIT` (16)** inputs (mixed-radix `firstCombos`, never the full cartesian).
     Cleared to stale whenever inputs/outputs/rep/mode change.
   Both tiers share `evalRow`, which for TM (the unbounded tape axis) renders the natural unpadded
   tape encoding (`formatTMValue`) instead of a fixed-width bit vector and does not width-truncate
   outputs. `countCombos` (a product, no enumeration) drives the `MAX_COMBOS` too-large guard
   cheaply. The exhaustive enumeration happens **only at save** (see step 6).
5. **Statement** — plain-text instructions shown to students.
6. **Save** — generates the full `test_cases` via `generateTestCases(spec, rep, mode)` (the one
   exhaustive enumeration, wrapped in try/catch so a formula that only fails on an input the
   single-input probe never exercised — e.g. one that goes negative — reports an error instead of
   throwing), builds the `AssignmentQuestion` (with `buildMode` + `representation`), hands it to
   the editor, which persists via `localAssignmentStore.save`.

`instructor/ccSummary.ts` renders a one-line summary of a `cc_spec` for the editor's question
list.

## Gradebook (`instructor/Gradebook.ts` + `GradebookView.tsx`)

Pure helpers grade stored submission records by **delegating to `engine/grader.ts`** — they
never re-implement grading. `gradeSubmissions` **prefers the grade persisted on the record**
(`record.result`, computed at submission time — see `CLAUDE_KB/engines/grading.md` and the
autograde pipeline doc) and falls back to grading on the fly only for legacy records.
`computeStats` rolls up submission count, per-question pass rate, and mean score. `GradebookView`
renders the summary plus per-submission rows with failed-vector drill-down. Dev sample data can
be seeded from the dashboard (`devData/seed.ts`).

## Deferred (not built)

- `requireStandardHaltPosition` (TM acceptance option) and `allowed_components` (mode-filtered
  palette) — both optional editor fields, deferred (see the deleted unification plan's §5/§6).
- Drag-and-drop question reordering (Up/Down only).
- Markdown / LaTeX in statements.
- Multi-user gradebook, student identity, per-question point values / weighted scoring.
