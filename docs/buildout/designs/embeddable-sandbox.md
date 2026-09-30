# The embeddable sandbox
_Status: accepted · 2026-09-29 · Task: 2026-09-29-087_

## Problem family
The course website (makingminds.org, static GitHub Pages) wants a live
machine a visitor can run. The editor can already run with no server (the
visitor sandbox, task 027), but it was built as the whole window of the app:

- **the page** — one Zustand store per page, global CSS, window-level keys and
  unload flushes: two editors cannot share a host page;
- **the chrome** — `EditorShell` read the session (`useAuth`) and drew the
  app's top bar, question panel and visitor banner itself;
- **the course client** — `store.ts` imported `storage/backend`, the
  assignment registry, `auth/session` and `auth/instructorRole` (and through
  them the remote stores and the API client), so every page showing the
  editor carried all of it;
- **persistence** — the sandbox autosaves to `making-minds-autosave:*`; a demo
  framed on the website can share a storage partition with a visitor's real
  sandbox once the app has a makingminds.org subdomain (task 008);
- **the scroll gestures** — the canvas claims every wheel event and every
  touch (`touch-action: none`): framed in a page, it traps the page's scroll,
  on a trackpad and on a tablet alike;
- **the load's Fit** — it runs two frames after a canvas swap, but a short
  canvas lays the palette flat only after its first measure, and a flat
  palette drops under the canvas's actions a render later: the fit framed the
  example beside a palette that then lay across it.

## Options
1. **Iframe `#/sandbox`** (works today): the whole app, framable by anyone,
   saving into the visitor's sandbox, trapping scroll. Rejected.
2. **A native web component**: the store, CSS and listeners collide with the
   host page. Rejected (Gabriel, 2026-09-29).
3. **A second Vite page, `embed.html`, in an iframe** — its own file so a
   `_headers` rule can make it (and only it) framable by makingminds.org —
   with the editor's edges cut at the seams:
   - *surgical*: a static visitor auth value around the frame, a flag hiding
     the top bar, early returns in the two save paths;
   - *deep*: the frame takes its chrome from the host; the store reads the
     course through an installed slot; persistence is a page-level mode.

## Decision
Option 3, deep, because each edge is a class, not an instance:

- **Page backend** (`storage/pageBackend.ts`): the store and routing read the
  seams, the registry, the session email and the role from a slot the page
  installs (`storage/appBackend.ts`, imported by `main.tsx` and by every
  harness tool that drives the store). `storage/backend.ts` stays the ONE
  local-vs-remote decision; the embed installs nothing, so its module graph
  has no auth/, api/, instructor/, assignments/ or remote store
  (`embedCheck [module graph]`, and `--dist` on the built chunks). An
  assignment action on a page without a backend throws; the paths the sandbox
  shares with assignments (autosave, unload flush) ask `pageBackendOrNull()`.
- **Chrome as slots**: `EditorShell({ bar, banner, question, output })` is
  layout only; the app passes `EditorTopBar`, `VisitorBanner` and
  `questionSidePanel`; the embed its slim bar. The canvas column moved to
  `EditorWorkspace`, shared by both.
- **Persistence mode** (`persistence.ts`): the page declares it in its HTML,
  `<html data-persistence="ephemeral">` (embed.html), and `persistence.ts`
  reads that as it evaluates. Not a switch the entry flips: the bundle runs
  the embed's shared chunks (store, uiPrefs, persistence) before its entry,
  so a switch would come after any module-level storage read; the page's
  word is there before any module runs, and every module that keeps
  anything imports `persistence.ts`, so it has evaluated first. Ephemeral,
  the store's autosave, unload flush and sandbox load stand down and
  `pageStorage()` is a memory map that never touches `window.localStorage`
  (a blocked third-party frame throws on the access).
  UI prefs gain a defaults layer (`setUiPrefDefaults`) for the embed's compact
  layout, never stored.
- **Host descriptor** (`editorHost.ts`): `gesturesNeedActivation` — the
  canvas takes the page's scroll gestures only once claimed
  (`gestureClaim`, a pure machine the canvas feeds): a mouse or pen press
  inside claims at once, a touch only as a tap (it ends with no
  `pointercancel`, i.e. the browser did not take it for a scroll), so a
  visitor swiping past the frame is never caught by the next swipe. Until
  then the wheel handler returns before `preventDefault`, the canvas's and
  palette's `touch-action` lets the browser pan the page, and an unclaimed
  touch never reaches the canvas's handlers (a swipe the browser takes would
  leave it mid-drag). Leaving the page or losing focus hands the gestures
  back. The app's default host is unchanged.
- **Fit follows the settling layout**: after a swap, until the person does
  anything (a press or key anywhere, or a view of their own), the canvas
  re-fits whenever its size or the palette's placement changes (Palette's
  `onPlaced`), so a load ends where Fit would — the app's own short windows
  included.
- **Compact layout** (`embed/layout.ts`): below 760px wide only a
  combinational circuit folds its output panel (it evaluates live as inputs
  toggle); every other machine keeps it, since Run and Step are there.
- **Examples** are ordinary sandbox workbook files (task 028) opened through
  `importWorkbook` — the File menu's Open — so a load or Reset is a canvas
  swap under law 6, with no second loader.

## Blast radius
`store.ts` (imports; eleven storage sites through `pageStorage()`; ephemeral
returns), `routing.ts` (role), `main.tsx`, `App.tsx`, `EditorShell.tsx`,
`QuestionPanel.tsx`, `CircuitCanvas.tsx` (wheel, touch, the swap's fit),
`Palette.tsx` (`onPlaced`), `uiPrefs.ts`;
`buildSubmission` split into `storage/buildSubmission.ts` (re-exported);
`arenaEditing.ts` moved out of `instructor/`. Pins: `embedCheck` (new),
`workbenchCheck [one frame]`, `themeCheck`, `workbookFileCheck`; ten tools
import `appBackend` beside the store. Local mode's behaviour and the reset laws
are unchanged (navResetCheck, routingCheck and the rest green).
