# Making Minds — Development Status

_Last updated: 2026-06-29_

> **Maintenance:** Always update this document before pushing or merging a substantive
> feature — keep "Where we are now" and "What's next" in sync with what actually shipped, and
> bump the _Last updated_ date. This file is read automatically at the start of every session,
> so it is the canonical status of the project.

## The goal

A platform where a student logs in (eventually UCLA SSO), picks an assignment, works on it
(one canvas per question, in the right mode — CC / SC / FSM / TM), leaves, comes back, and
resumes exactly where they left off — then submits the whole assignment with one button. On
submit it goes to the **server** and is **autograded**. Instructors author assignments and
view scores. **Students cannot grade their own work** — grading is a server/instructor
capability.

## Architecture principle: seams

Every external dependency sits **behind an interface**, so the no-backend prototype becomes a
server-backed product by swapping implementations — not rewriting the UI.

| Seam | Interface | Today (prototype) | Later (product) |
|------|-----------|-------------------|-----------------|
| Evaluation | `engine/` (pure, headless) | runs in browser | same code grades on server |
| Grading | `engine/grader.ts` | grades on receipt in `SubmissionStore` | server grades on submit |
| Identity | `src/auth/` (stub) | stub user; sessionStorage instructor role | real SSO + role claim |
| Persistence | `WorkbookStore` | `LocalWorkbookStore` (localStorage) | `RemoteWorkbookStore` |
| Assignments | `AssignmentStore` + registry | bundled + localStorage (instructor-authored) | server CRUD |
| Submission | `SubmissionStore` | `LocalSubmissionStore` (localStorage) | server endpoint |
| Navigation | `routing` (`Route` + `navigate`) | hash URLs via History API | same routes |

## Where we are now

A browser-only single-page app supporting the **local** version of the full target flow,
end-to-end:

- **Student side** — stub login → browse assignments → open one → per-question canvas in the
  correct mode → instant local autosave → leave and resume (reload/Back returns you into the
  assignment) → Submit a timestamped snapshot.
- **Autograding** — pure headless `engine/` simulators for **CC, SC, FSM**; `grader.ts`
  dispatches on `buildMode` and checks submissions against stored `test_vectors`. Submissions
  **autograde on receipt** in `SubmissionStore` and the result is persisted on the record (the
  exact shape a real server endpoint will take).
- **Instructor side** — role-gated `#/instructor` mode: dashboard, assignment editor, a **CC
  question creator** (affine-formula mini-language → auto-generated test vectors, with live
  preview), and a **gradebook** that reflects stored autogrades (scores, per-question pass
  rates, failed-vector drill-down). Sample CC/SC/FSM data can be seeded to demo the pipeline.

The missing half is the **server** and productized submit/grade loop.

## What's next

**Near-term (still no backend):**
- **TM grading** — no TM simulation engine yet; `grader.ts` skips TM cleanly until one exists.
- **SC/FSM/TM authoring** — the QuestionCreator is CC-only (other modes show "coming soon");
  SC/FSM assignments are seeded directly rather than authored.

**The backend phase (the big step):**
- **Real auth** — replace the stub with UCLA SSO; student vs. instructor roles from the token.
- **Server persistence** — `RemoteWorkbookStore` behind the existing seam, syncing across
  devices. (Supabase free tier looks sufficient.)
- **Submission endpoint + server-side autograding** — submit → server runs `engine/grader` →
  results stored; instructor gradebook reads them (the local pipeline already mirrors this).
- **Real assignment content** — author the actual PHIL 133 homeworks.

## Design notes / things to watch

- **Test vectors must not ship to the client in production.** Bundled assignment JSON today
  includes `test_vectors` (the answers) — fine for the prototype, where grading already happens
  inside the `SubmissionStore` seam. In the product, split assignments into a client part
  (statements, modes) and a server-only part (test vectors); the server grades on submit.
- **localStorage is a stopgap** — per-browser, per-device, ~5 MB. The `WorkbookStore` /
  `AssignmentStore` / `SubmissionStore` seams are exactly the boundaries a server replaces.
- **The seams are the leverage.** Every "later" column above is an interface swap, not a UI
  rewrite — route new features through `engine`, the stores, `src/auth`, and the registry.
