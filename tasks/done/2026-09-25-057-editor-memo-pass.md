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
status: done
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

### 2026-09-26 — measured, fixed, verified, landed (/work)
- **How.** A session script (headless Chrome, local mode, fixtures and sample data only)
  set up each state: HW1 P1 mid-assignment (a circuit run, P2 marked done, a table row
  current), the Boxes pop-out, an open question (P6a), a fill-in question (P6c), both panels
  collapsed, the sandbox, the Clear confirm, and the off-screen nav arrow. It read the
  computed style or size of every numeric and token value in the memo's sections, with the
  tokens resolved in the page. The full results, before and after, are
  `tasks/attachments/2026-09-25-057-measurements-{before,after}.json` (each check: section,
  what, selector, property, want, got, verdict). The script stays in the session (Design:
  the drift didn't recur enough to earn a committed `editorSpecCheck`).
- **Verdicts by section (before → after):** Top bar 32/33 → 36/36 · Question panel 95/95 ·
  Dividers 8/8 · Canvas 20/20 · Floating palette 18/18 · Boxes 23/24 → 24/24 · Output
  panel 17/21 → 25/25 · Open and fill-in answer area 18/22 → 22/22 · Collapsed strips 14/14
  · Sandbox 2/2 — **264/264**. Canvas appearance (SVG): text Plex Sans 600 tabular, wires
  2px, selection `--mm-accent` on `--mm-lav-soft`, port dots r3.5, labels 11px
  `--mm-ink-3` .04em, values 17px, symbols 2px round strokes — all as specified. Tokens
  used: every canvas and chrome colour is a token (themeCheck).
- **Drift found and fixed:**
  - **Answer fields** were 15px Plex Sans (the memo says a 16px/1.6 textarea and mono 16px
    blanks). Cause: `theme.css`'s `.mm-surface textarea, input { font: inherit }` outranked
    the single-class rules. They are now `.wb-answer .wb-answer-text` /
    `.wb-answer .wb-fill-input`, the two-class idiom the rest of the editor already uses.
  - **Stray shadows** on the Clear confirm, the paste notice, the nav arrow (all
    053/055) and the box-editor bar (a collaborator's, today) were removed; each keeps its
    border. Shadows are now the palette's, the dragged palette's and the pop-out's only.
  - **Radius:** the sandbox's worksheet tabs and their + button (4px), the tab rename
    field (2px) and the round nav arrow are now 0. Radius is 0 everywhere in the chrome
    (the scan is clean in every state).
  - **Output header:** padding went from `10px 12px 4px 22px` to the memo's 16/22. The
    header now lines up with the prototype, and Run sits 8px under it.
  - **Palette vs the action group:** at 1024 the palette covered Undo. The group has grown
    since the memo (Rotate, Box, Clear, the rotate note); this is the collision 055 noted
    for a flat palette. The palette now keeps clear of the measured `.cv-actions` rect and
    drops below it when they would overlap (`palette.ts` `clearOf`, pinned in
    workbenchCheck).
  - **Not drift:** my own checks aimed at the breadcrumb container (the ellipsis is on the
    current crumb, verified at 800: clipped with an ellipsis) and at the output head (the
    eyebrow is its `.eyebrow` child). New box is full width at 234 (260 − borders −
    padding).
- **Nothing breaks at 1024 (or 800):** no horizontal overflow in any state; the brand is
  one line (22px) with `nowrap` and no shrink; the breadcrumb's current crumb truncates
  with an ellipsis (seen at 800); the palette clears the action group.
- **Prototype side-by-side** at 1280 and 1024 (`2026-09-25-057-13/14-prototype-*.jpg`
  against `-01/-02`). The remaining differences are all decided: the wider action group
  (053), the Sans goal-table digits (decision 2), the run-status readout (053), and the
  prototype's own "Reset demo".
- **Screenshots:** `tasks/attachments/2026-09-25-057-NN-<state>-<width>-{before,after}.jpg`
  — the HW1 CC question, the open and fill-in questions, the Boxes pop-out, both panels
  collapsed and the sandbox, at 1280 and 1024.
- **CLAUDE.md:** the editor's STATUS line now describes the finished workbench (052–057),
  and the headline drops the redesign. It shrank from 39,930 to 39,894 bytes.
- **Gates:** app tsc, tools typecheck, build, `npm run check`, server `npm run check`.
- **Owed:** the same look in remote mode with the error save state ("Vite Remote Mode",
  server stopped mid-edit).
- **Out of scope, noted:** the SC/FSM/TM/turbot panels' internals (the old `index.css`
  DataTable styles) are unchanged by design ("do not redesign them yet"); their radius
  and shadows belong to the machine-types session.
