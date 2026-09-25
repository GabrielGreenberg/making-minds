---
id: 2026-09-25-057
type: chore
title: Measure the rebuilt editor against every value in the workbench memo and fix the drift (editor redesign 6 of 6)
priority: normal
size: large
requires: browser
area: app
source: inbox
created: 2026-09-25T16:15:00-07:00
status: ready
after: 2026-09-25-056
branch:
merged_into:
---

## Description
This is the last step of the editor workbench redesign; the spec and the chain are in
`docs/buildout/designs/editor-workbench.md` and task 052. Steps 052–056 build the redesign
piece by piece. This pass then measures the finished editor against the memo, value by
value, and fixes any drift:
- sizes, paddings, gaps, font sizes and weights, letter-spacing;
- colours as tokens, borders, shadows, and radius 0;
- clamps and states.

It also does a side-by-side against the prototype
(`docs/buildout/designs/editor-workbench/Editor Prototype.dc.html`) at the same widths.

Where a resolved decision overrides the memo, the decision wins and the pass checks against
it. The decisions are recorded in 052–056 (`### Resolved decisions`), and 052 folds them
into the memo.

## Done when
- **Every value is measured.** Every numeric or token value in the memo's sections below is
  measured in the built editor (computed style via the browser tools), and the value and
  verdict are listed in the progress log. Every mismatch is fixed or recorded with a reason
  (e.g. a resolved decision). The sections are §Top bar, §Question panel, §Dividers,
  §Canvas, §Floating palette, §Boxes, §Output panel, §Open and fill-in answer area,
  §Canvas appearance and §Tokens used.
- **No stray chrome.** Radius is 0 everywhere in the editor chrome. Shadows appear only on
  the palette, the dragged palette and the pop-out.
- **Screenshots.** Before and after, at 1280 and 1024 wide, of:
  - an HW1 CC question (mid-assignment);
  - an open question and a fill-in question;
  - the Boxes pop-out;
  - both panels collapsed;
  - the sandbox.

  They are committed as `tasks/attachments/2026-09-25-057-<n>.png`, from sample data only
  (law 9).
- **Nothing breaks at 1024.** Nothing overflows horizontally, the brand never wraps, and the
  breadcrumb truncates.
- **CLAUDE.md** STATUS reflects the finished editor, in place and with no net growth.
- **Gates.** Every gate in PROFILE §6 is green.

## Design
- **Mostly measuring.** This is a measuring pass, not a redesign, so any fix should be small.
  - A drift that needs a real change (not a style value) goes to `/catch` as its own task
    rather than growing this one.
  - A one-off measurement snippet can live in the session, not the repo.
- **Keep a checklist.** If the pass finds the same drift recurring, the memo's tables make a
  good checklist. A small committed `tools/editorSpecCheck` that reads computed styles
  headlessly (like `shootProblemSets.mjs`) would stop it recurring, but only if the drift
  keeps coming back. PROFILE §1: scope the fix to the real phenomenon.

## Verify
- **Gates:** everything in PROFILE §6.
- **Browser (requires: browser):** the measurements and screenshots above, in local mode.
- **Owed, not claimed:** the same look in remote mode with the error save state (the "Vite
  Remote Mode" preview, with the server stopped mid-edit).

## Progress log
