---
id: 2026-09-21-015
type: chore
title: Browser-verify the CSS-only fixes landed without a browser (2026-09-17 pass + two legacy layout items)
priority: normal
size: small
requires: browser
area: app
source: claude-md
created: 2026-09-21T15:30:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Landed without a browser (Chrome automation was unavailable that session), flagged as owed.
Two further members come from the legacy to-do list (`tasks/inbox/_processed/legacy-fixes-md.md`,
catch session 2026-09-21): the code for both now looks right, but nobody has eyeballed it.

### Members
- Submissions pane: per-question columns scroll horizontally, Score column pinned (`position: sticky`).
- Instructor dashboard action buttons have a fixed min-width (Publish vs Hide no longer shifts).
- TM tape strip: `user-select: none` (shift-click selected cell text) and `max-width: 100%`.
- Top bar shows a student's name without announcing the role.
- Feedback link present in both `MenuBar` and `HomeScreen` headers.
- **Legacy:** the question-pane resize grip was reported "a couple of pixels right of the pane
  boundary". `.panel-resize-handle` (`app/src/index.css:673`) now sits at `left: -5px` with a
  comment deriving the 1px border correction, so it should be centred on the divider — confirm
  on a CC, an SC and a turbot question (all five `DataTable.tsx` panels render it).
- **Legacy:** on the assignment overview the "Submit assignment" button was reported misaligned
  with the "✓ Submitted <date>" line. `.assignment-overview-submit` (`index.css:2308`) is now a
  centred flex row (`align-items: center; justify-content: space-between`) — confirm both the
  submitted and the not-submitted state, and the frozen "🔒 Past due" variant.

## Done when
Each member eyeballed in the dev preview (local mode; seed HW1–HW7 + sample submissions for
the gradebook); any defect fixed in the same session; screenshots attached.

## Design
Verification task; fixes, if any, are CSS.

## Verify
Screenshots in `tasks/attachments/2026-09-21-015-*.png`.

## Progress log

### 2026-09-24 — verified in the browser and landed (work loop)
Browser pane, local mode, dev server on `main`'s code (= this branch), HW1–HW7 loaded, sample
submissions present. Each member was eyeballed with a pane screenshot and measured in the
DOM. The pane returns screenshots to the session, not to disk, so the `tasks/attachments/`
PNGs were not written; the measurements below stand in for them.
- **Submissions pane:** HW1 gradebook table in an `overflow-x: auto` box (content 2,308 px in
  944 px); the page doesn't scroll sideways (1024 = viewport). SCORE is `position: sticky;
  right: 0` and stays at the box's right edge (984) after scrolling 400 px. ✓
  *Observation (not a member):* the Student column is not pinned, so once scrolled a row's
  owner is off-screen.
- **Dashboard action buttons:** Hide and every Publish are 88 px (`min-width: 88px`) at the same
  x = 689. ✓
- **TM tape strip:** rows and cells `user-select: none`. The wrapper is `max-width: 100%;
  overflow-x: auto` (840 px strip in 700 px) with no page overflow. Shift-click moved the head
  0 → 3 with an empty selection. ✓
- **Top bar:** John's reads "John Doe · Feedback · Log out", with no role (Ada's shows
  "Prof. Ada · Instructor"). ✓
- **Feedback link:** present in the Home header and in the editor's MenuBar header. ✓
- **Resize grip (legacy):** handle centre minus divider centre = **0 px** on an HW1 CC
  question, the sandbox SC circuit (boxed MEM), a TM tab and a Turbot tab (`left: -5px`,
  9 px wide, 1 px border). ✓
- **Overview submit row (legacy):** the class is now `.overview-submit`, since task 020 renamed
  it. It is a flex row with `align-items: center; justify-content: space-between`.
  - Frozen ("🔒 Past due — showing your submission"): the status line and the actions share
    a centre line at y = 637.6. ✓
  - Submitted, not frozen: "✓ Submitted …", "View grades" and "Submit assignment" are all at
    y = 637.6. ✓ This was the reported bug.
  - Not submitted: not reachable for John in local mode, because task 037's shared-list leak
    shows another student's "Submitted". It is one flex row with a single child, so there is
    no alignment to get wrong.
- **Defect found and fixed:** the turbot Map's sensor/motor legend (`.turbot-glossary-cols`,
  two `nowrap` columns plus an 18 px gap = 275 px) overflowed its 243 px row at the default
  panel width and was cut at the panel edge ("00 = both motors o…"). The columns now
  `flex-wrap` (gap `6px 18px`), so OUTPUT drops below INPUT: 243 px wide, every line fully
  visible. Build and themeCheck exit 0.
- Landed via a merge into `main`.
