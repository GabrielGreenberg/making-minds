---
id: 2026-09-23-032
type: bug
title: Scope editor state to its user and canvas — sign-out hands one user's work to the next; undo reaches across questions; one sandbox per person
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
4. **The sandbox is one per browser, not per person** (added 2026-09-23, Gabriel's decision).
   It autosaves under the single key `making-minds-autosave` (`store.ts:3760`, written at
   `:3912`, removed by `closeWorkbook` at `:888`) and is loaded once when the module is imported
   (`loadAutoSave`, `:4072–4157`), before anyone is signed in. On a shared machine the next
   person, signed in or visitor, sees and overwrites the previous person's sandbox. Not a
   cheating path once 033 lands (sandbox content never enters an assignment); a privacy and
   tidiness one.

## Done when
- A principal change (sign-in, sign-out, visitor → user) resets the whole student editor
  store to its initial state: assignment, question circuits, box library, clipboard,
  undo/redo, submissions map and all sim state. The auth provider triggers it in both modes,
  and the next `openAssignment` loads from the store seam, never from memory.
- Every canvas swap clears undo/redo, alongside `resetAllSimState`: `switchQuestion`,
  `openAssignment`, `loadAssignment`, `enterSandbox`, the sandbox's tab switches and
  `goHome`. Per-canvas stacks are a possible later nicety, not this task.
- **One sandbox per person on each browser.** Signed-in users autosave under
  `making-minds-autosave:<email>`; visitors share `making-minds-autosave:visitor`. The sandbox
  is loaded by the principal-change reset (not at module import), so each person sees only
  their own. When someone signs in and has no sandbox yet on this browser, the visitor sandbox
  MOVES into theirs (keeping visitor mode's promise that a visitor who signs in keeps their
  work, and hiding it from the next visitor). Signing out hides a user's sandbox until they sign
  back in; nothing is deleted. The legacy un-suffixed key is treated as the visitor sandbox on
  first run. `closeWorkbook` removes the current principal's key only.
- `navResetCheck` gains a `[principal change]` pin: A edits HW1, signs out; B signs in and
  opens HW1; B sees B's stored workbook and the clipboard is empty. It also gains an
  `[undo scope]` pin: edit Q1, switch to Q2, undo; Q2 is unchanged. And a `[sandbox per person]` pin:
  A builds a sandbox and signs out; B signs in and sees an empty sandbox; A signs back in and sees
  A's; a visitor's sandbox moves to a first-time signer-in and the visitor sandbox is then empty;
  the legacy key is adopted as the visitor sandbox.

## Design
- **deepFix (recommended):** a single `resetForPrincipal()` store action, called by the auth
  provider whenever the principal changes, joins `resetAllSimState()` as the second
  reset law. Also add undo/redo to the canvas-swap reset list, so law 6 reads: every canvas
  swap resets sim state AND history, and every principal change resets the whole editor
  store. Update CLAUDE.md "Critical design rules" in place.
- The sandbox load moving from module import into `resetForPrincipal()` is the natural home:
  "who is here" decides both what is wiped and which sandbox appears.
- **Resolved decision (Gabriel, 2026-09-23):** one sandbox per person per browser, as above
  (not per browser, not server-stored). Accepted limits: the data still sits in that browser's
  storage, so someone with developer tools on the same machine could read it (sandboxes are
  ungraded), and visitors on one machine share the visitor sandbox.
- **surgicalFix:** clear the store in `signOut` only. Rejected because a 401 expiry
  (`authProvider.tsx:179–182`) and a visitor signing in take other paths.
- Pointers: `store.ts:585, 888, 1419–1456, 1516–1524, 1594, 1629, 1656, 2368–2430, 3760, 3900–3912, 4072–4157`;
  `components/SessionControls.tsx:13–16`; `auth/authProvider.tsx:95, 179–182, 300–306`;
  `app/tools/navResetCheck.ts`.

## Verify
Both `tsc`s, `npm run build`, and `npx tsx tools/navResetCheck.ts` with the two new pins,
then `npm run check`. A browser pass is optional here; task 033's browser pass covers it.

## Progress log
