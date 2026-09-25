---
id: 2026-09-25-052
type: feature
title: Rebuild the question editor's frame as a workbench — a top bar, a question panel on the left, resizable and collapsible columns (editor redesign 1 of 6)
priority: normal
size: large
requires: browser
area: app
source: inbox
created: 2026-09-25T16:15:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Step 1 of the **editor workbench redesign** (HW1 / CC pass), which came from design sessions
with Gabriel (inbox `2026-09-25-editor-workbench.md`, now in `inbox/_processed/`).
- **The spec:** the memo `docs/buildout/designs/editor-workbench.md`, which gives exact sizes,
  tokens and behaviour.
- **The look:** the prototype `docs/buildout/designs/editor-workbench/Editor Prototype.dc.html`.
  Open it in the browser preview with `support.js` beside it. It is a design reference, not
  code to port: its canvas, router and evaluator are stand-ins. `CircuitCanvas`,
  `componentGeometry`, `wireRouter` and `engine/` stay the source of truth.
- **Where the memo is overridden:** the decisions and flags below override it wherever they
  differ.

The chain is **052 shell → 053 output panel → 054 palette → 055 canvas look → 056 gate
geometry (parks for Gabriel's yes) → 057 detailed pass**. Each step ships on its own, and
HW1 stays usable between them.

This task builds the frame around the canvas. It covers the memo's §Layout, §Top bar,
§Question panel, §Dividers, and §Open and fill-in answer area, plus the token and type move
from §Tokens used:
- **Top bar.** A 48px top bar replaces `MenuBar` and the question half of `TabBar`.
- **Question panel (left).** It stacks the nav strip, the current question and the grouped
  question list.
- **Dividers.** Both vertical dividers are drag handles, and each side panel collapses to a
  40px strip. The right column is still today's `DataTable` until 053 re-frames it.
- **Open and fill-in questions.** They move into the same shell, with the answer area in the
  centre and no right panel.
- **Sandbox.** It keeps its worksheet tabs as a strip above the canvas and gets no question
  panel.

## Done when
- **All HW1 questions.** Every HW1 question (CC, open, fill-in) opens in the new shell,
  local and remote. SC, FSM, TM and turbot questions and the sandbox still work inside it,
  with their right-panel content unchanged.
- **Navigation.** Prev/Next, the list rows and the breadcrumb navigate exactly as `TabBar`
  did, including `attempt` while viewing a submission. "Back to my work" still leaves a
  viewed submission.
- **What must survive the top bar.** The sandbox File menu, the Instructor view button, the
  visitor chip with Sign in, and `VisitorBanner` all survive. The frozen, viewing and 🔒 done
  tags show in the nav strip.
- **Done-lock.** The done mark still locks the question (decision 1), and the mark says so.
  Unchecking it unlocks.
- **Goal table.** A CC question's goal table is built from its statement's profile only,
  never from `test_cases`.
- **Question list.** It is grouped by `documentSections`, and a row's status is only
  "done" or "started", from the student's own marks and answers.
- **Top bar right side.** The save state shows "Saving…", "Saved just now", "Saved N min
  ago" or the remote error, on every question type, open and fill-in included. "Submitted
  3:42 pm" and the Submit / "Submit again" button follow.
- **Persistence.** Panel widths and collapse states survive a reload.
- **One visual language.** The editor chrome uses `--mm-*` tokens, and the new app-only
  tokens sit in `theme.css :root`. `VISUAL_VOCAB.md` §Page surfaces states the new one-language
  rule, and `themeCheck` enforces it (see flag F2).
- **The memo itself.** Its "Open questions" section is replaced by this task's
  `### Resolved decisions` and the filing flags, so the memo reads as settled.
- **CLAUDE.md is current.** Its STATUS (Part 1 student side, and the Key files Student UI and
  Page surfaces rows) is updated in place, with no net growth.
- **Gates.** `navResetCheck`, `routingCheck`, `themeCheck` and `pasteCheck` are green, along
  with every gate in PROFILE §6.

## Design
**deepFix.** One editor frame component (e.g. `components/EditorShell.tsx`) owns the
layout for every question kind and the sandbox. `App.tsx` stops branching the layout per
kind:
- today open and fill-in questions branch at `App.tsx:61-70`;
- circuit questions and the sandbox share `App.tsx:72-92`;
- the frame decides which of its three regions render.

Pure selectors in the store (or a small pure module) derive the question list and each row's
status, so the rendering stays thin. The top bar reuses `SessionControls.tsx:27-61` instead of
`MenuBar`'s inline copy (`MenuBar.tsx:87-111`), which leaves one implementation of the
session controls.

**surgicalFix, for contrast.** Restyle `MenuBar` and `TabBar` in place and add a left column
to the two existing `App.tsx` branches. That keeps two layouts, which is exactly what drifts.

**Code as it stands (read 2026-09-25).**
- **MenuBar.tsx:**
  - "⌂ Home" :36-40 (replaced by the brand, which links to Home);
  - `WorkbookFileMenu` when `!assignment` :45 (keep it: sandbox only);
  - Submit :51-63, with the submitted time only in its tooltip :56-57;
  - frozen / viewing tags :64-73;
  - Instructor view :79-86;
  - session controls :87-111.
- **TabBar.tsx:**
  - question branch :163-241; `go(i)` → `navigate({kind:'assignment', id, attempt,
    questionIndex}, {replace:true})` :171-172; "‹ Questions" :175-181;
  - "🔒 done" :203-205; the frozen tag :207-210; viewing tag + "Back to my work" :211-226;
  - Mark done → `toggleCurrentQuestionDone()` :228-234;
  - the sandbox branch :243-271 stays as the strip above the canvas.
- **Save state:** `autoSaveStatus` (`store.ts:662`, set in `performAutoSave` around
  :4789-4866) has no timestamp. Add a `lastSavedAt` UI field there for "Saved N min ago" (30s
  refresh). Today it renders only in `SimulationPanel.tsx:126-140`: move it to the top bar.
  Open and fill-in questions show static footer text instead (`OpenResponsePanel.tsx:57`,
  `FillInPanel.tsx:76`).
- **Question text:**
  - `ProblemBody` renders at `ProblemSetDocument.tsx:98-130`, the hint at :116;
    `ProblemContext` :137-155 (the "Note for this section" `<details>` :146-152);
    `CalloutView` :60-73.
  - Callout kinds are at `types.ts:198-199`.
  - The question text now moves to the left panel, so **remove** DataTable's
    `QuestionStatement` (`DataTable.tsx:23-36`, rendered at :404/:560/:768/:891/:931). The
    open and fill-in panels also stop rendering it (`OpenResponsePanel.tsx:39-40`,
    `FillInPanel.tsx:43-44`).
  - Caution callouts are always visible. `hint` and hint callouts sit behind "▸ Hint".
    Section callouts sit behind a link named by kind. Both links are closed by default and
    reset closed on question change.
- **Locks:** `selectQuestionLocked` `store.ts:149-157`, `selectLockNotice` :167-173,
  `isCurrentQuestionLocked` :4688. `toggleCurrentQuestionDone` (:2391-2406) is deliberately
  NOT guarded by the lock, so a done question can be un-done. It is blocked only while a
  submission shows.
- **Open / fill-in:** `usePasteGuard` refs (`OpenResponsePanel.tsx:25/:46`,
  `FillInPanel.tsx:27/:59`) and `readOnly={locked}` must carry over unchanged (law 8).
- **Prefs:** `uiPrefs.ts` is ONE localStorage key per browser (`uiPrefs.ts:6`), not per
  student. It is fine for cosmetic prefs. Use the memo's keys (`editor.leftW`, `editor.rightW`,
  `editor.leftOpen`, `editor.rightOpen`) and clamp them on load (left 260–480, right 240–480).
- **Tokens:**
  - The `theme.css` `:root` block is :27-89.
  - The editor's own tokens are at `index.css:2-18`: `--accent #2a7fff` etc.
  - The memo's literals `#F7F5FA`, `#CFC8D8`, `#B9B2C4` and `#DAD4E2` become named tokens in
    `:root`, next to the existing `--wire-0`/`--wire-1`.

### Resolved decisions
Gabriel, 2026-09-25 (catch). These answer the memo's open questions and override the memo
where they differ.
1. **Done keeps its lock.** "I'm done with this question" still locks the question through
   `isCurrentQuestionLocked`, which `navResetCheck` pins. The checked state must read as a
   lock (e.g. "🔒 Done — uncheck to edit"), since the prototype showed it as a bare marker.
2. **Table digits switch to Plex Sans with tabular numbers.** This covers the goal table here
   and the output table in 053. Mono stays where the memo names it outside tables: the
   list's number column and the fill-in inputs.
3. **Disallowed parts are dimmed with a tooltip, not hidden.** This lands in 054.
4. **The sandbox has no question panel.** Its worksheet tabs stay as a strip above the
   canvas.
5. **The later steps have their own decisions:** in 053, CC keeps its signal-flow
   animation; in 054, deleting a box removes it from the library only; in 056, NOT is
   50×60 and the task parks for the screenshot pass. Those are recorded in their own files.

### Where the memo meets the laws (flagged at filing, 2026-09-25)
- **F1. Goal table: never from `test_cases`** (law 1).
  - The memo says "built from the profile or `test_cases`". In remote mode students never
    receive `test_cases`: the server strips them (`server/src/sanitize.ts:48-56`).
  - So build the goal table only from the statement's profile. `statementFormat.ts` already
    lifts `IN1=0,IN2=1 -> OUT=1` profiles into tables, and every HW1 CC statement is one
    (e.g. `hw1.json:75, :142, :223`).
  - Show the section intro, then that table.
- **F2. One visual language reverses a deliberate, gated rule.**
  - Two places pin today's two-language boundary:
    - `VISUAL_VOCAB.md:216-218`: "The editor is untouched — `index.css` keeps its own
      canvas tokens".
    - `themeCheck.ts:97-102`: `index.css` may use only `--mm-font-sans`.
  - The memo moves the editor onto page tokens. **Rewrite the rule; don't route around it:**
    - VISUAL_VOCAB §Page surfaces gains the one-language rule.
    - themeCheck flips to "the editor uses `--mm-*`; colour literals only in `theme.css
      :root`" and extends its literal scan to `index.css`.
  - 055 extends the scan to `CircuitCanvas.tsx`, which holds 27 `#2a7fff` literals the gate
    can't see today.
- **F3. Locks stay** (law 3, decision 1). Nothing in the new UI gates editing in a component.
  The nav strip only displays the existing lock reasons.
- **F4. The reset law** (law 6).
  - The memo says that on a question change the tool disarms, the selection clears and Fit
    runs.
  - `resetAllSimState` (`store.ts:4543-4557`) clears `selectedTool` but NOT `selectedIds`.
    Add the selection clear to that reset path in the store, so every canvas swap does it,
    and pin it in `navResetCheck`. Never do it in a component effect.
  - The hint and section-note links are transient component state, so key them by question.
    Fit belongs to 055.
- **F5. What the memo's top bar leaves out but must be kept:**
  - the sandbox File menu (task 028);
  - the Instructor view button;
  - "Back to my work" while viewing a submission;
  - the frozen and viewing tags, which move to the nav strip where "4 of 23" sits.
- **F6. The brand link.** `PageShell`'s brand goes to makingminds.org (`PageShell.tsx:6`).
  The memo's editor brand goes to Home, replacing "⌂ Home". Follow the memo: the editor has
  no other Home link.
- **F7. Prefs are per browser.** The memo says "per student", but `uiPrefs` has always been
  per browser and is already used in remote mode. Add "ui prefs" to CLAUDE.md "Things to
  watch", in the localStorage list, in place.

## Verify
- **Gates:** everything in PROFILE §6. The fast loop is both `tsc`s plus `navResetCheck`,
  `routingCheck`, `themeCheck` and `pasteCheck`.
- **New pins:**
  - `navResetCheck`: a question change clears the selection (F4); the done-lock still refuses
    an edit and unchecking restores it.
  - `themeCheck`: the flipped `index.css` rule (F2).
- **Browser (requires: browser), with the Vite Dev Server in local mode:**
  - Load HW1–HW7 as the instructor, then open HW1 as a student. Walk all 23 questions with
    Prev/Next and with the list.
  - Mark one done, confirm edits are refused, then uncheck it.
  - Collapse and resize both panels, then reload.
  - Submit, then view the submission from the Grades sheet: the nav strip tags show, and
    "Back to my work" works.
  - Open an SC, an FSM, a TM and a turbot question: their right panels are unchanged.
  - Open the sandbox: there is no left panel, the tabs strip shows, and the File menu works.
  - In remote mode ("Vite Remote Mode" + a local server), check the save-state error display.
  - Screenshot at 1280 wide.

## Progress log
