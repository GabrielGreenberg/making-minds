---
id: 2026-09-21-019
type: feature
title: Restyle the administrative surfaces to be continuous with makingminds.org (student first, then instructor)
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T16:30:00-07:00
status: in-progress
after:
branch: task/019-restyle-admin-surfaces
merged_into:
---

## Description
Everything a student or instructor sees OUTSIDE the circuit editor — login / server-health
screen, student home, assignment overview, grade sheet, feedback and account modals, the
instructor shell and its six views — was styled ad hoc and reads as chaotic and generic
(system font, blue buttons, five near-identical greys). Gabriel wants these surfaces to copy,
or be visibly continuous with, the course website **https://www.makingminds.org** (Phil 133).
The circuit editor and canvas are explicitly OUT of scope for now. Student surfaces first;
the instructor side is more coherent already and just needs to match.

The website's SOURCE is the git repo at
`~/Documents/Academic/Teaching/Phil 133 - 2026f/Phil 133 - web/claude redesign/` (CNAME
`www.makingminds.org`; `assets/site.css` is the stylesheet, `data/course.json` drives the pages,
its README explains). The live `https://www.makingminds.org/assets/site.css` (18 KB) was read
during intake and is what the vocabulary below records. Provenance: chat, catch session 2026-09-21.

### The reference vocabulary (from site.css, 2026-09-21)
- **Type:** body `"IBM Plex Sans"` 15px / 1.5, ink `#2A2A2A`; headings `"IBM Plex Serif"`
  (h1 34px/600, letter-spacing -0.01em; h2 19px/600 in the magenta accent; h3 16px/600);
  `"IBM Plex Mono"` for tags; loaded via one Google Fonts link (Sans 400/500/600 + italic 400,
  Serif 500/600/700, Mono 400/500).
- **Colour tokens:** `--bg #FBFAFD` · `--surface #FFFFFF` · `--surface-2 #F1EEF5` ·
  `--ink #2A2A2A` / `--ink-2 #4A4A4A` / `--ink-3 #7B7B7B` · `--line #E5E5E5` /
  `--line-2 #D5D5D5` · `--accent #C255B9` (magenta) / `--accent-2 #DA73D2` /
  `--accent-soft #F7E6F5` · `--lav #E2B4FF` / `--lav-soft #F2E6FF` / `--lav-line #DCC6F2` ·
  `--link #1382D6` · `--date #24678D` / `--date-soft #E3EEF6` · `--hw #C93A3A` /
  `--hw-soft #FCEBEB` · `--exam #6E3A96` / `--exam-soft #EFE2FF` · `--navy #030D24` ·
  `--orange #F5A623`.
- **Shell:** `.topbar` white, 1px `--line` bottom border; `.brand` serif 19px/700 "Making
  Minds" + small "Phil 133"; nav 14px, `--ink-2`, 2px accent underline + 600 weight on the
  current page; `.page` max-width 1080px, padding-inline clamp(16px, 4vw, 40px); a 14px
  lavender `.band` under the hero; footer 12.5px `--ink-3` above a hairline.
- **Content idioms:** `.eyebrow` 11.5px uppercase 0.09em `--ink-3` 600 (section labels);
  `.facts` two-column key/value grid over a `--line-2` rule; tables with uppercase eyebrow
  `th`, `td` 10px 12px padding and `--line` hairlines, `td.date` in `--date`; `.tag` mono
  11px/600 on a soft background (`accent-soft`/`accent`, `date-soft`/`date`,
  `surface-2`/`ink-2`); `.chip` 11px uppercase 0.08em.

### What the app does today (local dev, 1280×800, HW1–HW3 published)
- **Home** (`HomeScreen.tsx`): title "Making Minds", subtitle "Design circuits, state machines,
  and more", eyebrow ASSIGNMENTS, one row per homework (title · "17 questions" · "✓ Submitted
  <date>" · a blue Submit button), eyebrow EXPLORE → Sandbox; top-right name chip + Feedback +
  Log out. System font, `#1565c0` buttons, `#1a1a1a` title.
- **Assignment overview** (`AssignmentOverview.tsx`): "← All assignments", H1, "17 questions —
  pick one to work on · 0 of 17 marked done", rows "Problem N · mode chip · statement clipped
  to two lines", a submit row at the bottom.
- **Instructor** (`InstructorLayout.tsx` + views): header "Instructor — Making Minds" /
  Student view / Log out; a row of five nav buttons (Load sample data · Load HW1–HW7 · Roster
  & accounts · Feedback · Notes); assignments table with drag grip, title + `custom`/`hidden`
  chips, counts, and five action buttons per row.
- **Login / health** (`auth/LoginScreen.tsx`, `HealthGate.tsx`): a centred `.login-card`
  duplicated by hand in both files.

### Root cause — the class
There is no design layer for page surfaces. `app/src/index.css` (2864 lines, the only
stylesheet) defines 17 `:root` tokens, all canvas-oriented (`--wire-1`, `--port-fill`,
`--accent #2a7fff` = selection blue). In the admin sections (lines 1108–2325) there are 107
hard-coded hex colours (39 distinct) against 117 `var()` uses of only 9 tokens; 14 distinct
font sizes with no scale; and three unrelated header idioms — `.page/.page-bar` (home,
overview; built inline in each file), `.instructor-app/.instructor-header`
(`InstructorLayout.tsx`, the one real shell, yet every view adds its own
`.instructor-page-head` choosing between two title classes), and `.login-screen/.login-card`
(hand-duplicated). `.modal-backdrop/.modal-card` is the only shared primitive (grades,
feedback, account), and a second unrelated `.modal-overlay/.modal-dialog` family (lines
967–1028) serves the editor. `docs/buildout/VISUAL_VOCAB.md` covers the canvas only; nothing
in the repo says what a page should look like — this task defines it.

## Done when
**Phase A — foundation + student surfaces**
1. A page-token layer exists in ONE file (`app/src/theme.css`, imported by `main.tsx` before
   `index.css`) carrying the site's palette, type scale and spacing as CSS variables, and
   `index.html` loads the same IBM Plex Google Fonts link (system fallbacks kept). Page tokens
   are namespaced `--mm-*` (e.g. `--mm-accent`) with a comment mapping each to its `site.css`
   name, because the canvas already owns `--accent`.
2. One shared shell component (`components/PageShell.tsx`: topbar with the serif brand
   "Making Minds · Phil 133" linking to the website, the app's own nav, the session controls;
   `.page` max-width 1080) is used by `HomeScreen`, `AssignmentOverview`, `InstructorLayout`,
   and — as a card variant — `LoginScreen` and `HealthGate`. The three header idioms are gone.
3. Login/health, home, assignment overview, grade sheet, feedback and account modals are
   restyled through the tokens: serif page titles, eyebrow section labels, hairline tables/rows,
   mono tags for mode/status chips, magenta accent, the site's buttons/links. The student home
   is clean and uncluttered: an assignment row is title · due/status · one action, nothing else.
4. The circuit editor is untouched: nothing before `index.css:1108` or after `:2325` changes
   except inheriting the font family; wire/component colours and canvas selection blue stay.
5. A grep gate (new `app/tools/themeCheck.ts`, in `npm run check`) fails if the admin sections
   of `index.css` (or any page component) introduce a hex/rgb literal outside `theme.css`.

**Phase B — instructor surfaces** (`/work` may split this into its own id when Phase A lands)
6. The instructor shell and all six views (dashboard, assignment editor, question creator,
   gradebook, roster, feedback queue, notes) use the same shell, tokens, table, tag and button
   styles; gradebook/roster keep their sticky columns; the five dashboard nav buttons become
   the shell's nav.
7. Every surface eyeballed in the browser at desktop and narrow widths; screenshots attached.

## Design
- **deepFix (recommended):** the token layer + one shell component + a lint gate, then restyle
  every page surface THROUGH them. Retires the class (ad-hoc colours, no type scale, three
  headers) and makes future surfaces inherit the look for free; naming the tokens after
  `site.css` means the site and the app can later share one stylesheet verbatim. The website
  is the design authority; write the page-surface rules into `docs/buildout/VISUAL_VOCAB.md`
  as a new section so the appearance oracle covers pages too.
- **surgicalFix:** swap the font stack and recolour `HomeScreen` only. Not recommended — the
  39 greys, the three headers and the instructor mismatch all survive.
- **Assumptions recorded at intake (Gabriel to confirm; none blocks starting):**
  (a) the topbar brand links back to the website and the app's nav is Assignments · Sandbox ·
  (Instructor, for instructors) · Feedback · account/session;
  (b) the font swap applies app-wide, including the editor's menu/tab chrome text, but no
  editor layout or canvas colour changes;
  (c) the site's magenta replaces the app's blue on page surfaces (buttons, active nav,
  section titles); blue survives only as `--mm-link` for hyperlinks.
- Pointers: `app/src/index.css:1–30` (canvas `:root`), `:1108–2325` (every admin section, per
  family: modal/grades 1108, page shell 1224, home 1267–1436, instructor 1455–1848, login
  1849, roster 1956, feedback 1979, notes 2102, session chip 2206, overview 2240);
  `components/HomeScreen.tsx:76`, `components/AssignmentOverview.tsx:59`,
  `instructor/InstructorLayout.tsx`, `auth/LoginScreen.tsx`, `auth/HealthGate.tsx`,
  `auth/AccountPanel.tsx`, `components/GradesPanel.tsx`, `components/FeedbackPanel.tsx`,
  `app/index.html`, `app/src/main.tsx`.
- Seams: presentation only — no store, engine, storage or routing change. `routing.ts` gains
  nothing; the shell reads the existing `Route`.

## Verify
- Gates: `tsc`, `npm run build`, `npm run check` (with the new `themeCheck` grep gate).
- Browser recipe (local mode, "Vite Dev Server"): sign in as Prof. Ada → `#/instructor` →
  Load HW1–HW7 → Publish HW1–HW3 → (Submissions → Release grades on HW1) → Log out → John Doe
  → home → HW1 overview → View grades → Feedback → Sandbox; then Prof. Ada again for dashboard,
  Edit, New question, Submissions, Feedback, Notes. Roster is remote-only: run "Vite Remote
  Mode" against a local server for that one view. Check at 1280 wide and at ~700 wide.
- Screenshots: `tasks/attachments/2026-09-21-019-<surface>.png`, before and after.
- Owed: re-read `assets/site.css` in the source repo at start (it may have moved on since
  2026-09-21); a real-device look on Gabriel's laptop.

## Progress log
