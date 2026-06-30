# Instructor Frontend — Design Plan

## Overview

The instructor frontend is a separate mode of the same single-page app, gated behind an
instructor role check. It lets an instructor author assignments (creating questions with
mathematical specifications that feed the autograder), view published assignments, manage
their content, and inspect student submissions and scores. The student-facing UI is
untouched; the two modes share the same underlying data model and engine.

---

## Architecture integration

### Where it lives

The instructor frontend routes under `#/instructor/...` using the existing hash-routing
system. New route kinds are added to the `Route` union in `routing.ts`:

```
#/instructor                          — dashboard
#/instructor/assignments/new          — assignment creator
#/instructor/assignments/:id/edit     — assignment editor
#/instructor/assignments/:id/submissions — gradebook view
```

A new `InstructorGate` component (mirroring the existing `AuthGate`) wraps all instructor
routes. If the role check fails, it redirects to `#/`.

### New seams introduced

| Seam              | Interface                                   | Today (prototype)                                       | Later (product) |
| ----------------- | ------------------------------------------- | ------------------------------------------------------- | --------------- |
| `AssignmentStore` | `list`, `get`, `create`, `update`, `delete` | `LocalAssignmentStore` (localStorage)                   | server CRUD API |
| `InstructorRole`  | `isInstructor()`                            | `LocalInstructorRole` (URL flag or localStorage toggle) | SSO role claim  |
| `Gradebook`       | `listSubmissions(id)`, `getStats(id)`       | reads `LocalSubmissionStore`                            | server query    |

The `AssignmentStore` seam is the most important new abstraction. Currently, assignments
are bundled at build time in `assignments/index.ts`. For instructor-created assignments to
be editable at runtime, they need a mutable store. The existing registry functions
(`listAssignments`, `getAssignment`) are updated to merge both sources: bundled
assignments (read-only) and localStorage assignments (read-write). Bundled assignments
can be viewed but not edited through the instructor UI. Later, a `RemoteAssignmentStore`
drops in at the same seam.

### Engine additions (pure TypeScript, no React)

Two new modules live in `engine/`:

- **`formulaEval.ts`** — parses and evaluates affine arithmetic expressions; pure, no
  side effects, fully testable headlessly.
- **`testVectorGen.ts`** — given an assignment question's spec (mode, widths, encoding,
  formula), produces `test_vectors`. Also pure. The generation strategy differs by mode:
    - **CC**: exhaustive enumeration over all 2ⁿ input combinations (input space is finite
      and small).
    - **SC / TM**: the input space is infinite (arbitrary-length sequences / tapes), so
      exhaustive enumeration is impossible. Instead, the generator produces a representative
      sample: short inputs, long inputs, all-zeros, all-ones, and inputs that exercise
      boundary behaviour (e.g., carry propagation, tape boundaries). The instructor reviews
      and can supplement this sample before saving.

These are called at **assignment-authoring time** (when the instructor saves a question),
not at grading time. The grader (`engine/grader.ts`) is unchanged — it still works
against the stored `test_vectors`. The formula is an authoring convenience, not a
runtime dependency of the grader.

---

## Data model additions

The existing `AssignmentQuestion` type gains a `cc_spec` (and analogues for other modes
later) that captures everything needed to generate test vectors and display the question
in the instructor UI:

```typescript
interface CCInputGroup {
    name: string; // variable name used in the formula, e.g. "x"
    width: number; // number of input wires in this group
    encoding: "binary" | "unary";
}

interface CCOutputGroup {
    name: string; // label shown to students, e.g. "y"
    width: number; // number of output wires in this group
    encoding: "binary" | "unary";
    formula: string; // affine expression over input group names, e.g. "2 * x"
}

interface CCSpec {
    inputs: CCInputGroup[];
    outputs: CCOutputGroup[];
}
```

The `AssignmentQuestion` grows an optional `cc_spec?: CCSpec` field. When present, the
system generates `test_vectors` from it at save time. The formula strings are stored
alongside `test_vectors` as documentation — so the instructor UI can display "expected
f(x) = 2x" in error output rather than just raw bit vectors, and so vectors can be
regenerated if the spec is edited.

---

## The arithmetic language

### Motivation

Instructors specify what function a student's circuit must compute. The language needs to
be expressive enough to cover all PHIL 133 exercises but simple enough that an instructor
can write it without ambiguity or error. Since all target functions in this course are at
most affine (linear combinations of inputs plus a constant, possibly with products of two
input variables), a small arithmetic language covers everything.

### What the language supports

- **Variables**: the `name` of each declared input group (`x`, `y`, `a`, `b`, …)
- **Integer constants**: non-negative integers (`0`, `1`, `2`, `3`, …)
- **Addition**: `x + y`
- **Subtraction**: `x - y`
- **Multiplication**: `2 * x`, `x * y`
- **Bitwise AND**: `x & y`
- **Bitwise OR**: `x | y`
- **Bitwise XOR**: `x ^ y`
- **Bitwise NOT**: `~x`
- **Parentheses**: `(x + y) * 2`, `(a & b) | c`

That is the entire language. No division, no modular arithmetic, no floor/ceiling, no
conditionals, no function calls. The output is an integer; the system automatically
extracts the least-significant `width` bits to produce the output wire values.

Arithmetic and boolean operators compose freely. For single-bit inputs, `&`, `|`, `^`,
and `~` behave exactly as the logical connectives AND, OR, XOR, and NOT. For multi-bit
groups they act bitwise, which is the natural generalisation (e.g., `x & y` on two 3-bit
inputs ANDs each pair of corresponding bits).

### Why this is enough

The bit-width of the output group acts as an implicit modulus. If `width = 1`, the
formula `x + y` produces 0 or 1 (the LSB of the sum), which is XOR. If `width = 2`, the
same formula produces both the sum bit and the carry. The instructor does not need to
write `(x + y) % 2` — they just set the output group width to 1 and write `x + y`.
Truncation to the declared width handles all the modular structure automatically.

### Encoding integration

#### CC (fixed-width)

For combinatorial circuits, the encoding controls how a fixed-width bit group is
converted to the integer the formula receives, and how the formula's integer result is
converted back to output bits.

- **Binary**: n input wires → integer in 0..2ⁿ−1 (wire I₁ is the most significant bit)
- **Unary**: n input wires → integer in 0..n (count of 1-bits from the left; the
  representation 111...1 with k ones encodes the integer k)

The encoding is declared per group (both input and output), so a question can mix binary
and unary groups. For output groups, the same encoding controls how the formula's integer
result is serialised to output wire values.

#### SC and TM (variable-length, future)

For sequential circuits and Turing machines, inputs are not fixed-width bit patterns but
variable-length sequences: temporal (one input bit per clock tick for SC) or spatial (a
tape of symbols for TM). The encoding still specifies binary vs. unary, but it now
governs how an arbitrarily long sequence is interpreted as a number — e.g., a unary tape
of k ones encodes the integer k, and a binary tape of bits b₁b₂…bₙ (MSB first) encodes
the integer they represent.

When a question has multiple inputs (e.g., implement x + y), they are supplied as
separate named sequences, with a designated delimiter or interleaving convention
(exact scheme TBD when SC/TM authoring is implemented). Each sequence is decoded
independently to its integer value, and the formula receives one variable per group.

### Evaluation

The formula is evaluated using `new Function()` with the input variables bound to their
integer values. This is safe because formula evaluation is instructor-only tooling, not
student-facing. The evaluator:

1. Binds each input group name to its decoded integer value
2. Evaluates the formula expression
3. Validates that the result is a non-negative integer — a negative result or a
   non-integer is a formula error (circuits cannot represent negative numbers), reported
   immediately in the UI and blocking save
4. Extracts the least-significant `width` bits as an array of 0s and 1s (the output
   bits for that group, MSB first within the group)

If the formula throws, returns a non-integer, or returns a negative integer, the UI shows
a validation error immediately and does not allow saving.

### Example

Question: "Implement the function x → 2x" (3-bit input, 3-bit output, binary encoding).

```
inputs:  [{ name: "x", width: 3, encoding: "binary" }]
outputs: [{ name: "y", width: 3, encoding: "binary", formula: "2 * x" }]
```

Enumeration (binary, 3 bits → 0..7):

| x (bits) | x (int) | 2x (int) | y (bits, 3-wide) |
| -------- | ------- | -------- | ---------------- |
| 000      | 0       | 0        | 000              |
| 001      | 1       | 2        | 010              |
| 010      | 2       | 4        | 100              |
| 011      | 3       | 6        | 110              |
| 100      | 4       | 8        | 000 (truncated)  |
| …        | …       | …        | …                |

These rows become the stored `test_vectors`. The grader never sees the formula again.

---

## Interface with the autograder

The grader (`engine/grader.ts`) is unchanged. It takes a `SubmissionData` (student
circuit) and an `AssignmentData` (with `test_vectors` embedded per question) and returns
pass/fail per question.

The connection between the formula language and the grader is entirely at authoring time:

```
[Instructor UI]
    ↓ writes CCSpec (inputs, outputs with formulas)
[testVectorGen.ts]
    ↓ enumerates inputs, evaluates formulas, encodes outputs
[AssignmentQuestion.test_vectors]
    ↓ stored in AssignmentData JSON (localStorage or server)
[engine/grader.ts]
    ↓ reads test_vectors, runs student circuit for each, compares
[GradeResult]
```

This separation means:

- The grader has no dependency on the formula language or the instructor UI.
- Test vectors can be inspected, exported, and reasoned about independently.
- If an instructor edits the formula, the system regenerates test vectors and saves the
  updated assignment — old submissions are still gradeable against the new vectors (the
  store records which assignment version was live at submission time, when that matters).

---

## UX / Workflow for question creation

The instructor accesses question creation through the assignment editor
(`#/instructor/assignments/:id/edit`). Adding a question opens a focused question-creation
flow — either a full-page step wizard or a modal, to be decided during implementation.

### Step 1 — Pick mode

A button group: **CC · SC · FSM · TM**. Selecting one advances to step 2. (SC, FSM, TM
are shown but marked "coming soon" until their specs are implemented.)

### Step 2 — Declare inputs and outputs

For **CC** (the first implemented mode):

- **Input groups**: a list the instructor builds up by clicking "Add input group". Each
  group has:
    - A short name (the formula variable): `x`, `y`, `a`, `b`, …
    - A wire count (number of bits in the group)
    - An encoding: binary or unary

    Example: to ask students to add two 2-bit numbers, the instructor adds two groups —
    `x (2 bits, binary)` and `y (2 bits, binary)`.

- **Output groups**: same structure, plus a formula field (filled in step 3). Each output
  group becomes one labelled cluster of output wires on the student canvas.

The total number of input wires and output wires is shown as a running count so the
instructor can see how many ports the student circuit will have.

### Step 3 — Write the formula

For each output group, the instructor writes an affine expression in the declared input
variable names. A live preview table appears as they type, showing the mapping for all
input combinations (or a sample if there are more than 16 rows). Invalid expressions
(parse error, non-integer result, reference to an undeclared variable) are flagged inline
with a short explanation.

The preview table is the main correctness check: the instructor can visually verify that
the generated mapping matches what they intended before saving. This replaces the
error-prone process of writing test vectors by hand.

### Step 4 — Write the question text

A text area for the statement shown to students above the canvas. This is plain text for
now (Markdown rendering is a future enhancement). The statement typically names the
function, gives context from the course material, and calls out any constraints
(e.g., "use only AND, OR, and NOT gates").

### Step 5 — Save and continue

A "Add to Assignment" button saves the question (generating and storing test vectors),
closes the question creation flow, and returns to the assignment editor, where the new
question appears in the question list. From there the instructor can reorder questions,
add another, or return to the dashboard.

---

## Instructor dashboard and supporting views

### Dashboard (`#/instructor`)

- List of all assignments (bundled + custom), with title, question count, and submission
  count.
- "New Assignment" button → prompts for a title, then navigates to the editor.
- Per-row actions: Edit (custom only), View Submissions, Export JSON, Delete (custom only).

### Assignment editor (`#/instructor/assignments/:id/edit`)

- Editable title field.
- Ordered list of questions: label, mode badge, formula preview, reorder handles.
- "Add Question" button → question creation flow.
- Per-question actions: Edit, Delete.
- "Export Assignment JSON" — downloads the full `AssignmentData` for archiving or
  bundling into the codebase.

### Gradebook (`#/instructor/assignments/:id/submissions`)

- Per-student rows (identified by the `student` field from `SubmissionData`, or "Anonymous").
- Columns: submission time, attempt number, per-question pass/fail, total score.
- Click a row → show the submission detail: per-question circuit (read-only canvas view)
  and which test vectors passed/failed.
- Summary row: submission count, % passing each question, mean score.

Today this reads from `LocalSubmissionStore` (same browser). Once the server submission
endpoint exists, the `Gradebook` seam swaps to fetch from the server — the UI is
unchanged.

---

## Role gating (prototype)

The instructor role is checked via `InstructorRole.isInstructor()`. In the prototype:

- Accessing `#/instructor` when not in instructor mode shows a simple unlock screen with
  a passphrase or toggle (exact mechanism TBD during implementation).
- Instructor mode is stored in `sessionStorage` (not `localStorage`) so it clears on
  browser close without affecting the student experience.
- The "Enter Instructor Mode" affordance is not linked from the student UI — instructors
  navigate to `#/instructor` directly.

Later: the SSO token carries a role claim; `InstructorRole` reads it.

---

## What is explicitly out of scope for this phase

- Real multi-user gradebook (submissions from other browsers/devices)
- Student identity management
- "Publishing" an assignment to students automatically
- SC, FSM, and TM question specs (the flow reserves space for them; only CC is
  implemented first)
- Rich text / LaTeX in question statements
- Per-question point values and weighted scoring

---

## Implementation Plan

_This section is a guide for a fresh implementation session. Read the full spec above
before starting. The spec explains the **why** behind every decision here._

### Read first

Understand the existing codebase before writing any new code:

| File                                 | What to learn                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `app/src/types.ts`                   | All domain types; you'll add `CCInputGroup`, `CCOutputGroup`, `CCSpec` here         |
| `app/src/engine/grader.ts`           | How the autograder consumes `test_vectors`; this file is **not** modified           |
| `app/src/assignments/index.ts`       | The bundled assignment registry; you'll extend `listAssignments` / `getAssignment`  |
| `app/src/storage/submissionStore.ts` | Pattern for a storage seam; `AssignmentStore` and `Gradebook` follow the same shape |
| `app/src/storage/workbookStore.ts`   | Same pattern, second example                                                        |
| `app/src/auth/AuthGate.tsx`          | The component `InstructorGate` mirrors                                              |
| `app/src/auth/stubAuth.tsx`          | Pattern for a stub role implementation                                              |
| `app/src/routing.ts`                 | Hash routing; you'll extend `Route`, `parseHash`, `routeToHash`, `applyRoute`       |
| `app/src/App.tsx`                    | Top-level render switch; you'll add the instructor branch here                      |

---

### Phase 1 — Data model and engine (pure TypeScript, no React)

Start here because everything else depends on it, and it can be built and tested without
touching the UI at all.

**`app/src/types.ts`** — add the three new types from the "Data model additions" section
of the spec (`CCInputGroup`, `CCOutputGroup`, `CCSpec`), and add `cc_spec?: CCSpec` to
`AssignmentQuestion`. No other types change.

**`app/src/engine/formulaEval.ts`** (new file) — implement:

```ts
export function evalFormula(expr: string, vars: Record<string, number>): number; // throws FormulaError on invalid expr, negative result, or non-integer
```

Use `new Function()` to evaluate. Validate that the result is a non-negative integer
before returning; throw a typed `FormulaError` (a plain `Error` subclass with a
human-readable `.message`) otherwise. Keep this module free of any encoding logic — it
just maps variable names to numbers and returns a number.

**`app/src/engine/testVectorGen.ts`** (new file) — implement:

```ts
// Decode a bit array to an integer under the given encoding.
export function decodeBits(
    bits: number[],
    encoding: "binary" | "unary",
): number;

// Encode an integer to a bit array of exactly `width` bits under the given encoding.
// Truncates to the least-significant `width` bits for binary; clamps for unary.
export function encodeBits(
    n: number,
    width: number,
    encoding: "binary" | "unary",
): number[];

// Generate all test vectors for a CC question spec.
// Enumerates every combination of input group values exhaustively.
export function generateCCTestVectors(
    spec: CCSpec,
): { input_sequence: number[]; expected_output: number[] }[];
```

`generateCCTestVectors` works as follows:

1. Compute the set of valid integer values for each input group (0..2ⁿ−1 for binary,
   0..n for unary).
2. Take the Cartesian product across all input groups.
3. For each combination: decode each group to its integer value, evaluate each output
   formula via `evalFormula`, validate the result (non-negative integer), encode the
   result to bits, flatten all input bit arrays into `input_sequence` and all output bit
   arrays into `expected_output`.
4. Return the full list.

Bit layout within `input_sequence`: input groups are concatenated in declaration order,
MSB first within each group. Same for `expected_output`. This must match whatever
convention `engine/grader.ts` uses when feeding bits to the student circuit — check
`grader.ts` before finalising the layout.

**Verification before moving on**: write a small standalone script (run with
`npx tsx script.ts`) that calls `generateCCTestVectors` with the `x → 2x` example from
the spec and prints the result. Confirm it matches the table in the spec. Also test a
simple boolean question, e.g., `a & b` with two 1-bit binary inputs and a 1-bit output.

---

### Phase 2 — AssignmentStore seam

**`app/src/storage/AssignmentStore.ts`** (new file) — define the interface and
implement `LocalAssignmentStore`:

```ts
export interface AssignmentStore {
    list(): AssignmentSummary[];
    get(id: string): AssignmentData | undefined;
    save(assignment: AssignmentData): void; // create or update
    remove(id: string): void;
}
```

Use the key prefix `mm:inst-asg:` in localStorage (distinct from `mm:asg:<id>` which
stores student work). Export a `localAssignmentStore` singleton.

**`app/src/assignments/index.ts`** — update `listAssignments()` and `getAssignment()` to
merge both sources: bundled assignments first, then `localAssignmentStore.list()` /
`.get()`. If the same id appears in both, the bundled one wins (it's read-only and
authoritative). Add a new export:

```ts
export function createAssignment(title: string): AssignmentData;
```

This generates a slug id from the title + a short timestamp suffix (to avoid collisions),
constructs an empty `AssignmentData`, saves it via `localAssignmentStore`, and returns it.

---

### Phase 3 — InstructorRole seam

**`app/src/auth/instructorRole.ts`** (new file) — define the interface and implement:

```ts
export interface InstructorRole {
  isInstructor(): boolean;
  enter(): void;
  exit(): void;
}

export const instructorRole: InstructorRole = { ... }  // sessionStorage-backed
```

Use `sessionStorage` (not `localStorage`) so the flag clears when the browser tab closes,
without affecting the student-side `localStorage` data. The key can be `mm:instructor`.

---

### Phase 4 — Routing

**`app/src/routing.ts`** — extend the `Route` union:

```ts
| { kind: 'instructor' }
| { kind: 'instructor-new-assignment' }
| { kind: 'instructor-edit'; id: string }
| { kind: 'instructor-submissions'; id: string }
```

Update `parseHash` and `routeToHash` for these four new kinds. Update `applyRoute`:
instructor routes do **not** need to touch the student Zustand store — `applyRoute` for
these kinds can be a no-op (the UI reads the hash directly; see Phase 5). The only action
`applyRoute` should take for instructor routes is to check `instructorRole.isInstructor()`
and, if false, redirect to home via `navigate({ kind: 'home' }, { replace: true })`.

---

### Phase 5 — Instructor routing in the UI

The instructor views bypass the student Zustand store entirely. Instead of adding
instructor state to `store.ts`, use a small custom hook:

**`app/src/instructor/useInstructorRoute.ts`** (new file):

```ts
// Parses the current hash and returns the active instructor route, or null
// if the current hash is not an instructor route. Re-renders on popstate.
export function useInstructorRoute(): InstructorRoute | null;
```

**`app/src/App.tsx`** — in the render logic, add a branch: if the current hash starts
with `#/instructor`, render the instructor subtree (`<InstructorGate>` wrapping the
appropriate view) instead of the student subtree. The cleanest approach is to call
`useInstructorRoute()` at the top level of `App` and use its return value to switch
between student and instructor rendering.

**`app/src/instructor/InstructorGate.tsx`** (new file) — checks
`instructorRole.isInstructor()`. If false, renders an unlock screen: a brief explanation
and a single "Enter Instructor Mode" button. On click, calls `instructorRole.enter()` and
forces a re-render. No passphrase for the prototype. If true, renders `{children}`.

**`app/src/instructor/InstructorLayout.tsx`** (new file) — thin shell: a header bar
reading "Instructor — Making Minds", an "Exit Instructor Mode" link (calls
`instructorRole.exit()` then `navigate({ kind: 'home' })`), and a `{children}` content
area.

Place all new instructor UI files under `app/src/instructor/` (a new directory, parallel
to `app/src/components/`, `app/src/storage/`, etc.).

---

### Phase 6 — Dashboard

**`app/src/instructor/InstructorDashboard.tsx`** (new file):

- Calls `listAssignments()` to get all assignments (bundled + custom).
- For each, shows: title, question count, submission count (from
  `localSubmissionStore.listSubmissions(id).length`), and a "custom" badge if it came
  from `localAssignmentStore`.
- Per-row actions:
    - **Edit** (custom only) → `navigate({ kind: 'instructor-edit', id })`
    - **Submissions** → `navigate({ kind: 'instructor-submissions', id })`
    - **Export JSON** → trigger a browser download of the `AssignmentData` JSON
      (use the existing `download.ts` utility if one exists, otherwise `URL.createObjectURL`)
    - **Delete** (custom only) → `window.confirm`, then `localAssignmentStore.remove(id)`,
      then re-render
- **New Assignment** button: `window.prompt("Assignment title:")`, call
  `createAssignment(title)`, `navigate({ kind: 'instructor-edit', id: result.id })`

---

### Phase 7 — Assignment editor

**`app/src/instructor/AssignmentEditor.tsx`** (new file):

- Reads the assignment from `getAssignment(id)`. If not found, show an error.
- Editable title: a text input that calls `localAssignmentStore.save(...)` on blur.
- Question list: ordered, each row shows the question label, build mode badge, and a
  one-line summary of its `cc_spec` (e.g., "f(x) = 2x, 3-bit binary in/out"). Reordering
  via Up/Down buttons is sufficient (no drag-and-drop required).
- Per-question actions: **Edit** (re-opens `QuestionCreator` pre-populated with the
  existing question data) and **Delete** (with confirm).
- **Add Question** button opens `QuestionCreator` (Phase 8) for a new question.
- **Export JSON** button triggers a browser download of the full `AssignmentData`.

All mutations save immediately via `localAssignmentStore.save(updatedAssignment)`.

---

### Phase 8 — Question creator

**`app/src/instructor/QuestionCreator.tsx`** (new file) — the most complex piece.
Implement as a self-contained component with local step state (no routing between steps).

Props:

```ts
{
  assignmentId: string;
  existingQuestion?: AssignmentQuestion;  // provided when editing
  onSave: (q: AssignmentQuestion) => void;
  onCancel: () => void;
}
```

**Step 1 — Mode**: Button group `CC | SC | FSM | TM`. SC, FSM, TM are rendered disabled
with a "coming soon" tooltip. Selecting CC advances to step 2.

**Step 2 — Inputs and outputs** (can be merged with Step 3 into a single step if that
feels more natural during implementation):

- Dynamic list of input groups. Each row: name text input (short identifier, e.g. `x`),
  width number input (1–8), encoding toggle (Binary / Unary). "Add input group" button
  appends a new blank row. Running total: "N input wires total".
- Dynamic list of output groups. Same fields plus a formula text input. "Add output
  group" appends a new blank row. Running total: "M output wires total".

**Step 3 — Formula and preview**:

For each output group, the formula field (which may already be visible from Step 2) drives
a live preview table. Compute the preview on every keystroke using `generateCCTestVectors`
(or a lighter helper that calls `evalFormula` directly, to avoid re-running the full
cartesian product on every keypress when there are many inputs). Display:

- All rows if total combinations ≤ 16
- First 8 + "… N rows total …" + last 8 otherwise

Each row shows: input bits for each group (grouped and labelled), the decoded integer
value for each group, the formula result integer, and the output bits. If the formula
throws a `FormulaError`, show the error message inline under that output group's field and
disable the save button.

**Step 4 — Question text**: A `<textarea>` for the student-facing statement. Label:
"Instructions shown to students".

**Step 5 — Save**: "Add to Assignment" button (disabled if any formula is invalid or any
required field is empty). On click:

1. Call `generateCCTestVectors(spec)` to produce the final `test_vectors`.
2. Construct an `AssignmentQuestion` with a new `id` (max existing id + 1), a generated
   `label` ("Problem N"), the chosen `buildMode: 'CC'`, the `statement` text, the
   `cc_spec`, and the generated `test_vectors`.
3. Call `onSave(question)`. The parent (`AssignmentEditor`) appends the question to the
   assignment and calls `localAssignmentStore.save(...)`.

---

### Phase 9 — Gradebook

**`app/src/instructor/Gradebook.ts`** (new file) — pure helper functions (not a React
component):

```ts
export interface QuestionGrade {
    questionId: number;
    passed: boolean;
    failedCount: number; // number of test vectors that didn't match
}

export interface SubmissionGrade {
    record: SubmissionRecord;
    grades: QuestionGrade[];
    score: number; // fraction: passed questions / total questions
}

export function gradeSubmissions(
    assignment: AssignmentData,
    records: SubmissionRecord[],
): SubmissionGrade[];

export function computeStats(
    grades: SubmissionGrade[],
    assignment: AssignmentData,
): {
    submissionCount: number;
    passByQuestion: Record<number, number>; // questionId → pass rate (0..1)
    meanScore: number;
};
```

These call `engine/grader.ts` (check its exported API before writing the call sites).

**`app/src/instructor/GradebookView.tsx`** (new file):

- Reads `localSubmissionStore.listSubmissions(id)` and the `AssignmentData`.
- Calls `gradeSubmissions` and `computeStats`.
- Renders a stats summary at the top: submission count, per-question pass rate, mean score.
- Renders one row per submission: student name (or "Anonymous"), timestamp, attempt
  number, per-question pass/fail badges, total score.
- Clicking a row expands it to show which test vectors failed (input bits, expected output
  bits, actual output bits from the student circuit — if `grader.ts` returns this detail;
  skip the expansion if it does not).

---

### Wiring it all together

Once all phases are done, the only files that need updates beyond what's listed above:

- **`app/src/App.tsx`**: import `useInstructorRoute`, add the instructor render branch.
- **`app/src/routing.ts`**: already extended in Phase 4.
- **`app/src/assignments/index.ts`**: already extended in Phase 2.

No changes to `store.ts`, `engine/grader.ts`, or any existing student-facing component.

---

### End-to-end verification

After all phases, run `npm run dev` and walk through this flow:

1. Navigate to `#/instructor` → see the unlock screen.
2. Click "Enter Instructor Mode" → see the dashboard.
3. Click "New Assignment", enter a title → navigate to the editor.
4. Click "Add Question" → step through the creator:
    - Pick CC.
    - Add one input group: `x`, 3 bits, binary.
    - Add one output group: `y`, 3 bits, binary, formula `2 * x`.
    - Verify the preview table matches the spec's `x → 2x` example.
    - Enter a question statement.
    - Click "Add to Assignment".
5. Return to the editor — question appears in the list.
6. Export the assignment as JSON — open the file and verify `test_vectors` is present and
   matches the preview table.
7. Click "Exit Instructor Mode" → back to student view.
8. Switch to the student view, open the assignment, submit it.
9. Return to instructor mode → Submissions → verify the submission appears with grades.

---

### Known deferreds — do not implement

- SC, FSM, TM question specs in `QuestionCreator` (show as disabled, not functional)
- `testVectorGen` sampling strategy for SC/TM
- Drag-and-drop reordering in the assignment editor
- Markdown rendering in question statements
- Multi-user gradebook
- Per-question point values / weighted scoring
