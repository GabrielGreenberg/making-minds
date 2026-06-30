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
| Instructor role | `auth/instructorRole.ts` (`isInstructor/enter/exit`) | `sessionStorage` flag `mm:instructor`, set on the unlock screen | SSO role claim |
| Authored assignments | `storage/AssignmentStore.ts` (`list/get/save/remove`) | `localStorage` prefix `mm:inst-asg:` | server CRUD |
| Gradebook | `instructor/Gradebook.ts` (`gradeSubmissions/computeStats`) | reads `localSubmissionStore` | server query |

The role is `sessionStorage` (not `localStorage`) so it clears on tab close and never touches
student data. `InstructorGate` shows an unlock screen ("Enter Instructor Mode", no passphrase
in the prototype) when `!isInstructor()`; the affordance isn't linked from the student UI.

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

A self-contained stepped flow (local state, no routing between steps):
1. **Mode** — `CC | SC | FSM | TM`. Only **CC** is functional; SC/FSM/TM are shown disabled
   ("coming soon").
2. **Representation** — one binary/tally toggle for the whole question (governs grading + the
   preview).
3. **Inputs/outputs** — dynamic lists of groups (name, width), with running wire counts.
4. **Formula + live preview** — each output group's formula drives a preview table
   (`instructor/ccPreview.ts`) computed via the DSL under the chosen representation; invalid
   formulas show inline and block save.
5. **Statement** — plain-text instructions shown to students.
6. **Save** — generates `test_cases` via `generateTestCases(spec, rep)`, builds the
   `AssignmentQuestion` (with `representation`), hands it to the editor, which persists via
   `localAssignmentStore.save`.

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

- SC / FSM / TM question authoring (creator is CC-only; SC/FSM samples are seeded directly).
- Drag-and-drop question reordering (Up/Down only).
- Markdown / LaTeX in statements.
- Multi-user gradebook, student identity, per-question point values / weighted scoring.
