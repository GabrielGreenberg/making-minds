# Making Minds — Development Status

_Last updated: 2026-06-27_

## The goal we're building toward

A platform where a student can:

1. **Log in** (eventually via UCLA SSO).
2. **Pick a homework/assignment** from a catalog.
3. **Work on it** — one canvas per question, in the right mode (CC / SC / FSM / …).
4. **Leave** — go home, log out, or just close the browser.
5. **Come back later** (even on the server side, eventually any device) and **resume exactly where they left off**.
6. **Submit** the whole assignment with one button → it goes to the **server** and is **autograded**.

**Students cannot autograde their own work.** Grading is an instructor/server capability, not a student-facing one.

## Architecture principle: seams

We're building the browser app and the (future) server so that each external dependency sits **behind an interface**, so the no-backend prototype can become a server-backed product by swapping implementations — not rewriting the UI.

| Seam | Interface | Today (prototype) | Later (product) |
|------|-----------|-------------------|-----------------|
| Evaluation | `engine/` (pure, headless) | runs in browser | same code runs on server for grading |
| Grading | `engine/grader.ts` + CLI | instructor runs CLI on exported JSON | server grades on submit |
| Identity | `src/auth/` (stub) | stub user / email | real SSO |
| Persistence | `WorkbookStore` | `LocalWorkbookStore` (localStorage) | `RemoteWorkbookStore` (server) |
| Navigation | `routing` (`Route` + `navigate`) | hash URLs via History API | same routes; can add server-rendered deep links |
| Submission | `SubmissionStore` | `LocalSubmissionStore` (localStorage) | server endpoint (POST → autograde) |

## What we recently achieved

In rough order (all on `main` unless noted):

- **Headless evaluation engine** — extracted CC circuit evaluation into a pure, framework-agnostic `app/src/engine/` (no React/DOM), so the *same* logic can run in the browser and on a server.
- **Autograder + submission format + CLI** — `engine/grader.ts` grades CC questions against test vectors; a `SubmissionData` JSON format; `tools/grade.ts` lets an instructor grade a batch of submissions (`npm run grade …`) with zero backend.
- **Unified Assignment model** — collapsed two overlapping concepts ("Homework" and "Problem Set") into one `Assignment` (questions carry statement + per-question build mode + test vectors).
- **Bundled assignment registry** — built-in assignments with stable ids; `listAssignments()` / `getAssignment()` (the swap point for a future server fetch); `openAssignment(id)`.
- **Home/catalog screen** — the app now lands on a Home page listing assignments + a single persistent Sandbox; opening an assignment shows per-question tabs with the correct canvas mode; a Home control returns to the catalog.
- **Auth stub layer** — `src/auth/` (AuthGate + stub) establishing the login seam ahead of real SSO.
- **Per-assignment persistence** — each assignment's work is saved to localStorage behind the `WorkbookStore` seam (`mm:asg:<id>`), restored on open, with drift handling when an assignment definition changes. Confirmed by a manual reload round-trip and a headless storage test.
- **Hash routing** — the URL hash records *where* you are (`#/`, `#/sandbox`, `#/a/<id>`, `#/a/<id>/q/<n>`); a reload or the Back button returns you *into* the assignment/question instead of landing on Home. Built on the History API behind a small `routing` seam (pure `parseHash`/`routeToHash` + `navigate()`); UI intents route through it. Question switches use `replace` (Back doesn't accumulate them); major transitions push real history entries.
- **Submit-from-anywhere** — Submit is now a real action (workbook menu bar **and** each Home card), not a buried File→Export. It records an immutable, timestamped snapshot behind a new `SubmissionStore` seam (`mm:sub:<id>`, append-only attempts). From a Home card it builds from persisted state, so you can submit without opening the assignment; from the workbook it builds from live state. Cards show a submitted/not-submitted badge. No grading happens client-side — the seam only *records* (the swap point for the future POST-to-server flow). File→Export Submission remains the instructor-CLI file handoff.

## Where we are now

A browser-only single-page app that already supports the **local** version of the full target flow: stub login → browse assignments → open one → work with instant local autosave → leave and resume (same browser, reload/Back returns you into the assignment) → Submit a snapshot. The instructor can still export a submission JSON to grade with the CLI.

The missing half is the **server** and the productized submit/grade loop.

## What's next

**Near-term (still no backend):**
- **Question statement in the right sidebar** — the on-canvas question banner was removed; the problem statement will move into the right-hand sidebar (currently the data table area) so it's visible without cluttering the canvas. Not yet implemented.
- **SC/FSM grading** — extract `scStep`/`fsmStep` into the engine so non-CC questions become gradeable (today only CC is).

**The backend phase (the big step):**
- **Real auth** — replace the stub with UCLA SSO; distinguish student vs instructor roles.
- **Server persistence** — a `RemoteWorkbookStore` implementing the existing seam, so work syncs across devices and truly survives anything.
- **Submission endpoint + server-side autograding** — student submits → server runs the headless engine/grader → results stored; instructor gradebook view.
- **Real assignment content** — author the actual PHIL 133 homeworks (HW1–HW7).

## Key design notes / things to watch

- **"Students can't autograde" has an implication for the data model.** Today, bundled assignment JSON includes `test_vectors` (i.e., the answers), and the engine can grade in the browser — fine for the prototype and the instructor CLI. In the real product, **test vectors must not be shipped to the client**; the server holds them and grades on submit. Plan to split the assignment definition into a client part (statements, modes) and a server-only part (test vectors).
- **localStorage is a prototype stopgap** — per-browser, per-device, clearable (~5 MB). The `WorkbookStore` seam is exactly the boundary a server-backed store replaces; the limitation goes away with the backend.
- **The seams are the leverage.** Every "later" column in the table above is an interface swap, not a UI rewrite — keep new features going through `engine`, `WorkbookStore`, `src/auth`, and the assignment registry rather than around them.
