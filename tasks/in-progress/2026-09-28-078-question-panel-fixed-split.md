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
