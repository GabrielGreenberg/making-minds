---
id: 2026-09-23-032
type: bug
title: Scope in-memory editor state to its user and canvas — sign-out hands one user's work to the next; undo reaches across questions
priority: high
size: small
requires:
area: app
source: chat
created: 2026-09-23T11:30:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Found while surveying copy-paste constraints (task 033; catch session 2026-09-23). These
are correctness and privacy bugs in their own right, independent of any anti-cheating policy.

### Members
1. **Sign-out leaks the previous user's work to the next user in the same tab.**
   `signOut` (`app/src/components/SessionControls.tsx:13–16`) navigates Home, which calls
   `goHome` (`store.ts:1594`, "preserves in-memory work"), then `logout()`
   (`auth/authProvider.tsx:300–306`) only clears the user. Nothing resets the store. When the
   next person signs in and opens the SAME assignment, `openAssignment` takes its "same
   assignment already in memory → resume" early return (`store.ts:1520–1524`). They see the
   previous user's circuits, box library and answers, and autosave writes them into their own
   account. Shared lab machines make this real.
2. **Undo and redo reach across canvases.** `pushHistory` snapshots components, wires, boxes
   and the box library (`store.ts:1419–1432`), and `undo` writes the snapshot into the CURRENT
   canvas (`:1434–1452`). The stacks are reset only by `closeWorkbook`, `newWorkbook` and
   `importWorkbook` (`:884, 907, 1021, 1055`), not by `switchQuestion` (`:1656`),
   `openAssignment`, `enterSandbox` or `goHome`. So Cmd+Z after moving from Q1 to Q2, or from
   the sandbox into a question, restores the other canvas over this one.
3. **The canvas clipboard outlives the user.** `clipboard` (`store.ts:585`) is set at `:2381`
   and never cleared, so user B can paste what user A copied.

## Done when
- A principal change (sign-in, sign-out, visitor → user) resets the whole student editor
  store to its initial state: assignment, question circuits, box library, clipboard,
  undo/redo, submissions map and all sim state. The auth provider triggers it in both modes,
  and the next `openAssignment` loads from the store seam, never from memory.
- Every canvas swap clears undo/redo, alongside `resetAllSimState`: `switchQuestion`,
  `openAssignment`, `loadAssignment`, `enterSandbox`, the sandbox's tab switches and
  `goHome`. Per-canvas stacks are a possible later nicety, not this task.
- `navResetCheck` gains a `[principal change]` pin: A edits HW1, signs out; B signs in and
  opens HW1; B sees B's stored workbook and the clipboard is empty. It also gains an
  `[undo scope]` pin: edit Q1, switch to Q2, undo; Q2 is unchanged.

## Design
- **deepFix (recommended):** a single `resetForPrincipal()` store action, called by the auth
  provider whenever the principal changes, joins `resetAllSimState()` as the second
  reset law. Also add undo/redo to the canvas-swap reset list, so law 6 reads: every canvas
  swap resets sim state AND history, and every principal change resets the whole editor
  store. Update CLAUDE.md "Critical design rules" in place.
- **surgicalFix:** clear the store in `signOut` only. Rejected because a 401 expiry
  (`authProvider.tsx:179–182`) and a visitor signing in take other paths.
- Pointers: `store.ts:585, 1419–1456, 1516–1524, 1594, 1629, 1656, 2368–2430`;
  `components/SessionControls.tsx:13–16`; `auth/authProvider.tsx:95, 179–182, 300–306`;
  `app/tools/navResetCheck.ts`.

## Verify
Both `tsc`s, `npm run build`, and `npx tsx tools/navResetCheck.ts` with the two new pins,
then `npm run check`. A browser pass is optional here; task 033's browser pass covers it.

## Progress log
