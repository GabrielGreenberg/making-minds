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
status: in-progress
after:
branch: task/032-scope-editor-state
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
- 2026-09-23 — Implemented the deepFix (not yet committed). Two reset laws in `store.ts`:
  `resetAllSimState()` now also empties undo/redo (every existing call site is a canvas
  swap), and `goHome`/`closeAssignment` clear history too; the new `resetForPrincipal(email |
  null)` flushes the leaving person's pending save/journal under their keys, stops runs,
  bumps `openAssignmentSeq` + a `principalEpoch` (stale `openAssignment` /
  `hydrateSubmissions` / `submitAssignment` / in-flight autosave resolves apply nothing, and
  an in-flight save never clears the next person's journal), then sets
  `{...getInitialState(), ...readSandbox(email)}` and cancels the autosave that set armed.
  The auth provider reports every principal change synchronously before React state
  (`reportPrincipal`: local initializer + login/logout; remote initializer = visitor + first
  line of `setUser`, before the session cache). Sandbox keys `making-minds-autosave:<email |
  visitor>` (`sandboxKey`, lowercased): no load at import; a signed-in person with no
  sandbox WORK receives the visitor's (moved); the legacy bare key is adopted as the visitor
  sandbox when none exists; `closeWorkbook` removes only the current principal's key.
  `routing.ts`: `setRoutingSignedIn` → `setRoutingPrincipal(email | null)`, which re-applies
  the URL on every real change (replaces `heldRoute`; fixes Home-at-#/sandbox on restore and
  a blank page on a #/sandbox sign-out). Pins: navResetCheck `[no load at import]`, `[undo
  scope]`, `[principal change]`, `[sandbox per person]`, plus a history assertion in every
  canvas-swap pin (the harness's localStorage shim gained `length`/`key` so
  `hydrateSubmissions` can list); routingCheck `[principal change]`. CLAUDE.md + PROFILE
  law 6 updated in place.
- 2026-09-23 — Review fixes (not yet committed). The leaving principal's save no longer
  rides the debounced save: `saveForLeavingPrincipal` writes the sandbox directly and, for
  an assignment, the local seam directly or (remote) journal + one single-flight PUT; a PUT
  confirmed after the change clears the journal only while it holds exactly what was saved
  (`journal.ts clearJournalIfHolds`), so a sign-out no longer leaves a stale buffer that a
  later open replays over another device's work (remote repro via Vite SSR + mocked fetch:
  confirmed sign-out → no journal; in-flight + newer edit → journal kept and replayed;
  offline → kept). "No sandbox yet" = absent or PRISTINE (no component/box, one default
  tab, no arena, default title), so tab-, rename- or map-only sandboxes are never replaced
  by the visitor's. A remote token boot reports the token's owner (`mm:auth:principal`
  hint, removed with the token), not the visitor. `resetForPrincipal` keeps an open sandbox
  open (the arriving person's) and routing never re-enters one already open. Pins:
  navResetCheck `[undo scope]` made non-vacuous (pre-edit content, unlocked target, leak
  visibility asserted), `[sandbox per person]` +component-free sandboxes + keep-open,
  `[principal change mid-save]`, `[auth provider wiring]` (source gate); routingCheck
  `[token boot]`; remoteStoreCheck `clearJournalIfHolds`. Each new pin fails with its fix
  reverted.

### 2026-09-23 — implemented (work loop)
- **Built.** Signing in or out now wipes the editor: the next person never sees the last
  person's canvas, box library, clipboard, undo history or submissions. Undo no longer
  reaches across questions or sandbox tabs. Each person on a browser has their own sandbox;
  a visitor's sandbox moves to the first person to sign in, and the old one-per-browser key
  becomes the visitor sandbox. Mechanics: `store.ts resetForPrincipal` (reset law 2, called
  by `authProvider.tsx reportPrincipal` in both modes, remote boot = the token's owner via
  `mm:auth:principal`); `resetAllSimState` + `goHome`/`closeAssignment` clear history;
  `saveForLeavingPrincipal` + `journal.ts clearJournalIfHolds`; `routing.ts
  setRoutingPrincipal`.
- **Pins.** navResetCheck `[no load at import]`, `[undo scope]`, `[principal change]`,
  `[sandbox per person]`, `[principal change mid-save]`, `[auth provider wiring]` + a history
  assertion in every canvas-swap pin (250 passed); routingCheck `[principal change]`,
  `[token boot]`; remoteStoreCheck `clearJournalIfHolds` keep/clear.
- **Gates.** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.
- **Review.** 8 findings, all fixed (vacuous undo pin; pristine-sandbox predicate; leaving
  save off the debounce; stale journal after a confirmed sign-out; remote token boot as
  visitor; provider wiring ungated). None skipped.
- **Owed (loop session, browser).** Local: undo scope (HW1 Q1 → Q2, Cmd+Z), clipboard across
  a sign-out, sandbox per person incl. visitor move and legacy adoption. Remote (Vite Remote
  Mode + server :8199, two roster accounts): sandbox survives reload on #/sandbox; A's HW1
  never reaches B; 401 on #/sandbox → visitor sandbox, on #/a/hw1/q/0 → sign-in then B's
  work. Nothing owed over ssh; no real student data.
- **Next step.** Loop session: the owed browser checks above, then land per PROFILE §5.
