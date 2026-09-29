---
id: 2026-09-28-078
type: feature
title: Give the editor's question panel a fixed, draggable split between the problem statement and the question list
priority: normal
size: small
requires:
area: app
source: feedback
created: 2026-09-28T10:52:00-07:00
status: in-progress
after:
branch: robot/078-question-panel-fixed-split
merged_into:
---

## Description
App Feedback report `fb-mulis4qp-5dtwac` (author-role: instructor, category: platform
design; filed from HW1). In the homework editor, the left column holds the current problem's
statement at the top and the list of the homework's problems below it. Moving from problem
to problem changes the statement's height, so the list and its header jump up and down the
page. Gabriel wants the statement area to have a fixed height that he can change by dragging,
with the list taking the rest, so nothing moves when you change problems.

**Cause.** `app/src/workbench.css:150–155`: `.qp-current { flex-shrink: 0; max-height: 64%;
overflow-y: auto }`. The statement block is as tall as its content, up to 64% of the panel.
The list (`.qp-list-head` + `.qp-list`, `:218–223`, `flex: 1`) gets whatever is left, so its
top edge follows each statement's length. The layout comes from the workbench memo
(`docs/buildout/designs/editor-workbench.md:69`, "max-height:64% with its own scroll").
`QuestionPanel.tsx:42–60` renders nav → `CurrentQuestion` (`:117–141`, which ends with
`DoneMark`) → `QuestionList`.

## Done when
1. The statement area has one height, shared across every problem of every homework. It
   never follows content: short statements leave empty space, long ones scroll inside it. The
   "Questions" header and list sit at the same place on every problem.
2. A horizontal divider between the statement and the list resizes it by dragging, and by
   ↑/↓ in steps for keyboard users (a `role="separator"`, `aria-orientation="horizontal"`,
   with value/min/max). It is live while dragging and stored on release, per browser, next to
   the column widths (`uiPrefs`, `EDITOR_PREF_KEYS`). A stored value is clamped on read, and
   the default reproduces roughly today's look (≈ 55–60% of the panel).
3. The split is a **fraction of the panel's height**, clamped so neither part collapses below
   a usable minimum (the list keeps its header + ≥ 2 rows; the statement keeps its title +
   a few lines). Resizing the window keeps the proportion.
4. "I'm done" (`DoneMark`) stays reachable without scrolling a long statement, so it doesn't
   move either. Recommended: pin it at the foot of the statement pane, outside the scroll.
5. `workbenchCheck` pins the pure parts: the clamp, the default, reading a bad or old pref,
   and the new pref key. The memo's question-panel paragraph says the new rule. Gates green.

## Design
- **deepFix (recommended):** one divider for both axes. `EditorShell.tsx:113–181`
  `PanelDivider` handles only vertical column rules: x-drag, ←/→, `clampPanelWidth`.
  Generalise it to an `axis` (or split out a shared pointer/keyboard hook) so the column
  dividers and this new row divider are one component, with one drag/keyboard/persist
  behaviour. Put the pure parts in `workbench.ts` next to `LEFT_PANEL`/`clampPanelWidth`: a
  `QUESTION_SPLIT` range (fractions), `clampQuestionSplit`, and the split read in
  `editorLayoutFromPrefs` with its key in `EDITOR_PREF_KEYS` (`editor.qpSplit`), so
  `useEditorLayout` persists it like the widths. The question panel then gets the split and an
  `onResize` from `EditorShell`. Layout: `.qp-current` becomes `flex: 0 0 <split>%` with
  `overflow-y: auto`, and the `max-height: 64%` rule goes.
- **surgicalFix:** a fixed CSS height (`flex: 0 0 55%`) and no drag. It stops the jumping but
  ignores the "draggable" half of the request.
- The collapsed strip (`QuestionPanelStrip`) is unaffected. The sandbox has no question panel.
- Keep the divider's hit area inside the panel, so it doesn't steal the column divider's
  pointer events at the panel's right edge.

## Verify
- `npx tsx tools/workbenchCheck.ts` (from `app/`) with the new pins, then the full gates.
- Eyeball (owed, not claimed): the robot dev server, HW1, step Prev/Next across P1 (short),
  P6 (long, with a section intro) and P16 (figure). The list header stays put. Drag the
  divider up and down, reload, and the split is remembered. Keyboard ↑/↓ on the divider
  works. "I'm done" is visible on a long statement without scrolling.

## Progress log

### 2026-09-28 — implemented (work loop)
**Built (deepFix).** The question panel's problem and list now split the panel below the nav
strip at ONE fraction, not at the statement's length. A long statement scrolls inside its
share, a short one leaves room, and the "Questions" header stays put from problem to problem.
A row divider between them drags it (live, stored on release) and steps it with ↑/↓ (4%). The
split is stored per browser under `editor.qpSplit` next to the column widths. "I'm done" is
pinned at the pane's foot, outside the scroll. Its lock note renders above the checkbox, so the
box holds still whether or not the problem is done.
- `workbench.ts`: `QUESTION_SPLIT` {0.25–0.8, default 0.58, step 0.04}, `QUESTION_SPLIT_FLOOR`
  (problem 200px; list = header + section label + 2 rows = 138px), `questionSplitRange`,
  `clampQuestionSplit`, `questionSplitFromDrag` / `questionSplitFromStep` (these start from the split on
  screen), `EditorLayout.qpSplit` read by `editorLayoutFromPrefs`, `EDITOR_PREF_KEYS.qpSplit`.
- New `components/PanelDivider.tsx`: ONE divider for both axes (the two column rules plus this
  row rule). EditorShell's old private divider is gone. `QuestionPanel` takes `split` /
  `onResizeSplit`. `.qp-current` has a basis of the split and a 200px floor, and `.qp-list-pane`
  a 138px floor. A ResizeObserver feeds the divider's aria value/min/max. `max-height: 64%` is
  gone.
- CSS `.wb-divider--row` (net 0px, row-resize, z 4 under the column divider). Memo question
  panel, done mark, dividers and state paragraphs rewritten. CLAUDE.md now says "resizable
  panels". themeCheck covers PanelDivider.tsx.

**Pins (workbenchCheck).** `[question split]`: range and default (55–60%), the list floor
derived from workbench.css itself, clamp and rounding, junk → default, both floors at 600/400px,
a too-short panel, drag and step starting from the shown split (no dead zone), the height's range,
the pref from a fresh, old or bad bag, `editor.qpSplit` plus every layout field under its own
key. `[one frame]`: one PanelDivider (2 vertical in the shell, 1 horizontal in the panel, no
pointer code elsewhere), the split threaded from EditorShell, `.qp-current` without max-height
and with the split as its basis, the done mark outside the scroll, the note above the checkbox,
and no answer key read in PanelDivider.tsx.

**Gates.** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0.

**Review.** Fixed: the done checkbox moved when ticked (note now above it; headless-measured
label top 349.0px open and done), the list floor lacked the section label (now 138px,
CSS-derived pin), and drags and keys started from the stored split, not the one on screen (clamped starts,
`questionSplitRange`, measured aria values). Skipped: none.

**Owed (not claimed).** Headless eyeball (ROBOT-WORK §3): on HW1 q/0, q/5 and q/21 the
`.qp-list-head` top is identical, and `.qp-done` sits inside `.qp-current` and the viewport. Also:
ArrowDown ×2 raises aria-valuenow by 8 and writes `editor.qpSplit`, which survives a reload; a
120px drag moves the list live and writes once on release; at 1280×500 the floors hold and
nothing overflows; the column divider wins the hit-test at the corner; the collapsed strip is
unchanged; the sandbox has no panel. Owed to Gabriel: drag feel by hand, and Prev/Next through
P1 → P6 → P16 (plus a submission on show) to confirm nothing jumps.

**Next step.** Loop session: the headless visual check above, then land per PROFILE §5.
