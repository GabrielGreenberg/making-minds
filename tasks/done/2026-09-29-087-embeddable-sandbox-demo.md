---
id: 2026-09-29-087
type: feature
title: Make the sandbox embeddable as a live demo on makingminds.org
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-29T16:34:08-07:00
status: done
after:
branch:
merged_into:
---

## Description
Gabriel wants to show a live, working sandbox on the course website's landing page
(makingminds.org) for visitors to play with. **It's just for show, not for serious
problem solving.** A visitor sees a machine that already works, presses Run, pokes at it,
and can follow a link to the full sandbox.

The website is `GabrielGreenberg/making-minds-website`: plain static HTML on GitHub Pages
(legacy build from `main` at the root, CNAME `www.makingminds.org`). It can't run the app,
but it doesn't need to. The sandbox already runs entirely in the browser, with no server
and no sign-in (visitors, task 027). So the website only needs one `<iframe>` pointing at a
small **embed page** that the app serves from its own host, `https://making-minds.pages.dev`
(Cloudflare Pages).

What exists today: iframing `https://making-minds.pages.dev/#/sandbox` already works,
because the pilot sends no framing headers (checked with `curl -I`, 2026-09-29). But it
shows the full-window app: top bar, File menu, Sign in, visitor banner. It also has the
problems listed under Design. This task builds the page actually meant for embedding.

## Done when
- The app build emits a second page, `embed.html`, next to `index.html`. It renders only
  the editor for ONE preloaded example machine, with a slim bar: the example's name,
  **Reset** (back to the example), and **Open the full sandbox ↗** (new tab →
  `#/sandbox`). There's no File menu, no Sign in, no visitor banner, no feedback link,
  and no tab bar.
- `embed.html?example=<name>` loads the example from a folder of workbook files
  (task 028's format, `parseWorkbookFile`). An unknown or missing name falls back to the
  default example. There are at least three examples covering the circuit, FSM and turbot
  editors (a TM one is welcome). **None of them may be the answer to a HW1–HW7 problem.**
  Author them fresh and check each against the homework statements. Do NOT take them
  from `app/tools/fixtures/reference/`: those are homework solutions.
- **It never saves or reads anything.** Every load starts from the example. The embed
  neither reads nor writes `making-minds-autosave:*` or any other storage key, and a
  check pins this.
- **Scrolling the host page is never hijacked.** A plain wheel or trackpad scroll over the
  embed scrolls the website until the visitor has clicked into the canvas. Panning and
  zooming work after that, as in the app.
- It is usable in a box from about **640×420** up (the landing page will likely give it
  100% width × ~500px). Below a narrow width (~600px, i.e. phones), it shows a still
  picture of the example with "Try it on a larger screen" and the full-sandbox link,
  instead of a cramped editor.
- **Framing is allowed only where intended.** A `_headers` file (Cloudflare Pages) lets
  `https://makingminds.org` and `https://www.makingminds.org` frame the embed page and
  forbids framing of every other page (today anyone can frame the whole app). This is
  verified against the deployed site with `curl -I` for both the embed and the main page,
  including the `/embed` pretty-URL form Pages may serve.
- The embed's JavaScript excludes the instructor UI, auth, API client, markdown and KaTeX
  (grep the built chunk). Its gzipped size is recorded in the progress log; for
  comparison, today's single app chunk is 1.7 MB, 355 KB gzipped.
- `deploy/README.md` gains an "Embedding the sandbox" section: the iframe snippet, the
  URL parameter, the example list, and how to add an example (build it in the sandbox →
  File → Save → drop the `.json` in the folder). CLAUDE.md's Key files and Part 1 are
  updated in place.
- All gates are green, plus the new check below.

**Handoff (Gabriel's call, not a Done-when item):** putting the iframe on
makingminds.org means committing to `GabrielGreenberg/making-minds-website`, which
publishes his public site. So it waits for his yes, and where it goes on the page is his
choice. A `/work` session with him present may make that commit once he says so. An
unattended run stops at the handoff and reports the snippet.

## Design

### Resolved decisions (Gabriel, in chat 2026-09-29)
- **An iframe, not a native `<mm-sandbox>` component.** Putting the editor directly in the
  host page would collide with it:
  - the editor's state is one module-level Zustand store for the whole page
    (`app/src/store.ts`, `create<AppState>()`), so two instances would share it;
  - the CSS is global (`:root` tokens; `html, body, #root { 100vh; 100vw }` at
    `app/src/index.css:18`);
  - keyboard shortcuts listen on `window` (`CircuitCanvas.tsx:1998`, `:3134`);
  - there are unload listeners (`store.ts:5902–5903`) and hash routing.

  An iframe isolates all of that for free. Several sandboxes on one page (a future online
  textbook, say) also work fine as several iframes.
- **Served from the app's host, not copied into the website repo.** Each release keeps
  the demo current with no extra step, and the website holds only the tag. When task 008
  gives the app a real domain, the snippet's URL changes once.
- **For show only.** No saving, no File menu, and one machine per embed.

### Shape of the work
- **A second Vite entry.** Add `app/embed.html` plus `app/src/embed/main.tsx`, listed
  under `build.rollupOptions.input` in `app/vite.config.ts`. It must be its own page, not
  an `#/embed` route: framing permission is an HTTP header set per path, and a hash never
  reaches the server. Only a separate file lets the embed be frameable while `#/instructor`
  is not. The entry mounts the editor frame without `ServerHealthProvider`, `AuthProvider`,
  `AuthGate` or `initRouting()` (compare `app/src/main.tsx`).
- **Auth coupling in the frame.** `EditorShell.tsx:47` (`isVisitor`) and
  `EditorTopBar.tsx:49` (`user`, and `SessionControls`) read `useAuth()`.
  - **deepFix:** the frame takes its host as data (sandbox / assignment / embed), and the
    host decides which chrome shows. The top bar becomes one of the chromes, and the embed
    passes its slim bar.
  - **surgicalFix:** wrap the embed in a static visitor auth value and hide the top bar
    with a flag.

  Recommend the deepFix if it stays small. Whichever is chosen, the embed's module graph
  must not pull in `auth/`, `api/`, `storage/remoteStores.ts` or `instructor/`.
- **Persistence off, at the one place that decides it.** The sandbox autosave is a
  module-level subscriber (`store.ts:5778`) writing `sandboxKey(null)` =
  `making-minds-autosave:visitor` (`store.ts:5551`). It is flushed on
  `beforeunload`/`pagehide` (`store.ts:5902–5903`) and read back by `readSandbox`
  (`store.ts:6195`). This is not cosmetic. Browsers key an iframe's storage by the pair
  (frame origin, top-level site). If task 008 puts the app under a makingminds.org
  subdomain, the embed on www.makingminds.org and a visitor's real sandbox land in the
  same storage partition, and the demo would overwrite their work.
  - **deepFix:** an explicit "ephemeral" persistence mode that the autosave subscriber,
    `flushAutoSave` and `readSandbox` all consult, set by the embed entry before the first
    render.
  - **surgicalFix:** early returns in the two write paths.
- **Loading an example.** Examples are workbook files under something like
  `app/public/embed-examples/<name>.json`, fetched by name and validated with
  `parseWorkbookFile` (`app/src/workbookFile.ts:93`). The first tab opens as the only tab,
  going through the same path the File menu's Open uses (`WorkbookFileMenu.tsx`). Every
  canvas swap must go through `resetAllSimState()` (Critical design rules). Reset re-opens
  the example.
- **The scroll trap.** The canvas's wheel handler calls `preventDefault()` on every wheel
  event and pans on a plain scroll (`CircuitCanvas.tsx:2003–2016`). The turbot Map claims
  only ctrl/cmd-wheel (`TurbotArenaPanel.tsx:209–219`), which is fine. In the embed, the
  canvas should ignore wheel events (no `preventDefault`) until it is activated by a
  pointerdown inside it, and deactivate when focus or the pointer leaves the frame. Take
  the activation state from the host descriptor so the app's own behaviour is unchanged.
  Window `keydown` listeners need no change: inside an iframe they only fire while the
  frame has focus.
- **A compact layout.** The workbench was designed for a full window (resizable, collapsible
  columns; floating palette). Measure it at 640×420, 800×500 and 1000×560, and choose
  defaults for embed: likely the output panel collapsed or narrow, the palette docked
  where it can't cover the example, and Fit on load (`canvasView.ts`). For narrow
  widths, the still picture can be a PNG per example shot with
  `app/tools/shootCircuits.mjs`, or rendered at build time.
- **Headers.** Cloudflare Pages merges the headers of every `_headers` rule that matches.
  So a site-wide `/*` rule setting `Content-Security-Policy: frame-ancestors 'self'` (plus
  `X-Frame-Options: SAMEORIGIN`) must be detached on the embed paths with the `! Header`
  syntax, then set to
  `frame-ancestors https://makingminds.org https://www.makingminds.org`. Pages serves
  `embed.html` at `/embed` too (pretty URLs), so cover both. Put the file in
  `app/public/_headers` so `vite build` copies it to `dist/`. Confirm `deploy/release.sh`
  uploads it (it deploys `dist/`).
- **The website snippet** (for the docs and the handoff):
  `<iframe src="https://making-minds.pages.dev/embed?example=<name>" width="100%"
  height="500" style="border:0" loading="lazy" title="Making Minds sandbox"></iframe>`.

## Verify
- **Gates:** PROFILE.md §Gates (`npm run check`, both `tsc` runs).
- **A new `app/tools/embedCheck.ts`, added to `npm run check`:**
  - every example parses with `parseWorkbookFile` and opens as a tab;
  - with persistence ephemeral, driving edits through the store and calling
    `flushAutoSave` writes no `making-minds-autosave` key (fake `localStorage`, as other
    checks do);
  - a grep gate: the embed entry's import graph reaches none of `auth/`, `api/`,
    `storage/remoteStores.ts`, `instructor/`;
  - `_headers` contains the embed allowance and the site-wide deny.
- **Browser:**
  - serve `dist/` (or the dev server's `/embed.html`) and a scratch host page on another
    port that iframes it at 100% × 500;
  - scroll the host page past the embed (no hijack), click in and pan/zoom (works), edit,
    Reset, reload (back to the example);
  - resize to 640×420, check the narrow poster at 375 wide (`resize_window`);
  - screenshots in the progress log.
- **Owed, not claimed, until deployed:** `curl -I https://making-minds.pages.dev/embed`
  and `/` show the intended framing headers, and the embed appears live inside a
  makingminds.org page (the handoff).

## Progress log

### 2026-09-29 — implement (robot)
- **Built** (deep fix throughout; memo `docs/buildout/designs/embeddable-sandbox.md`):
  `app/embed.html` + `src/embed/` (first import `ephemeral.ts`; `example.ts`,
  `layout.ts`, `EmbedApp`), a second Vite input. The store and routing now read the
  course through an installed slot, `storage/pageBackend.ts` (the app's `main.tsx`
  imports `storage/appBackend.ts`; the embed installs none); `persistence.ts`
  (`makeEphemeral` / `pageStorage`) behind every storage site in `store.ts` and
  `uiPrefs.ts` (+ `setUiPrefDefaults`); `EditorShell` is layout-only with
  bar / banner / question / output slots, the canvas column moved to
  `EditorWorkspace`; `editorHost.ts` gates the canvas wheel on a click-in;
  `buildSubmission` split to `storage/buildSubmission.ts`; `arenaEditing.ts` moved to
  `src/`. `public/_headers` (site-wide `frame-ancestors 'self'` + `SAMEORIGIN`;
  `/embed`, `/embed.html` detach both and allow makingminds.org only).
- **Examples** (`app/public/embed-examples/`, authored fresh with `tools/builder.ts`
  in a scratch script, never from fixtures): `majority` (CC, default), `parity`
  (FSM), `square-patrol` (turbot, FSM brain: forward, turn right; a block ahead
  stops it). A first patrol (F, F, R, turning right at a block) earned FULL credit on
  HW2 P14 "Full circle" once its FSM brain was swapped in for the problem's CC one,
  so it was replaced; embedCheck now grades every example against every HW1–HW7
  machine problem, turbot problems also with the example's brain — no credit
  anywhere. No TM example (optional; not attempted).
- **Size** (`npx tsx tools/embedCheck.ts --dist`): embed JS = 4 chunks, 518.1 KB raw,
  **158.2 KB gzipped** (+ 17.4 KB gz CSS), same in the Pages configuration
  (`VITE_BASE_PATH=/ VITE_API_BASE=…`); compare today's single app chunk 1.7 MB /
  355 KB gz. None of the markers (auth token key, KaTeX, DOMPurify, marked, the
  instructor UI, `/api/` in the remote build) is in the embed's chunks; all are in
  the app's.
- **Layout, measured** (headless Chrome, `node tools/shootEmbedPosters.mjs
  --measure <dir>` at 640×420, 800×500, 1000×560): a circuit / FSM starts with the
  output panel folded below 760px wide; a turbot keeps it, its Map moved above the
  glossary (embed-scoped CSS) and its cells sized to the arena (28px at 640–800,
  32px at 1000). The palette keeps the app's own placement: docking it flat along
  the top (the plan) pushed a one-tile FSM palette under the canvas actions and
  cropped the machine at 640×420.
- **Browser, verified** (headless Chrome over CDP; a host page iframing the built
  embed at 100% × 500): a plain wheel over the canvas scrolled the HOST (300 → 420)
  and left the canvas alone; after a click inside, the wheel panned the canvas
  (translate y 132 → 12) and the host stayed put; ctrl-wheel zoomed (154%); once
  the pointer left the frame a plain wheel scrolled the host again; deleting a gate
  (9 → 8) then Reset gave 9 parts back with Undo disabled; a reload showed the
  example; the frame's storage held 0 keys; parity's Run gave OUT `011011`; the
  turbot ran (cycle 8); `?example=nope` showed Majority vote; at 375×640 the poster,
  "Try it on a larger screen." and the sandbox link. Screenshots were scratch; the
  committed posters (`embed-examples/*.png`, 800×500) are the stills.
- **Owed, not claimed:** after the release (held by the gate: `deploy/README.md`
  changed), `curl -sI https://making-minds.pages.dev/embed` and `/` must show the
  framing headers; a real-trackpad scroll check in a real browser; the embed on
  makingminds.org — the handoff, Gabriel's yes (`GabrielGreenberg/making-minds-website`):
  `<iframe src="https://making-minds.pages.dev/embed?example=majority" width="100%"
  height="500" style="border:0" loading="lazy" title="Making Minds sandbox"></iframe>`.
- **Next:** Checkpoint (commit), then review; nothing is left to build.

### 2026-09-29 — fix (robot)
Six review findings, all fixed:
- **The load's Fit ran before the palette settled** (majors 1 and 5: at 640×420 the
  default example opened with IN1 and the top AND gate under the palette, and IN1's
  label was covered at 100% × 500 on a 1000px page). The swap's fit now follows the
  layout until the person does anything (a press or key anywhere, or a view of their
  own): `CircuitCanvas` re-fits on each canvas resize and on each placement the palette
  renders (`Palette` `onPlaced`). This is the app's fix too, for its own short windows.
  workbenchCheck pins it. Re-measured with `shootEmbedPosters.mjs --measure`: majority
  at 640×420 is 80%, the palette lies flat, and the whole circuit sits below it. Iframed at
  100% × 500 on a 1000px host, the palette ends at y 171 and IN1's label starts at y 187.
  The posters were re-shot.
- **A state machine's Run was folded away at 600–759px** (minor 2). Now only a
  combinational circuit folds its output panel; SC, FSM, TM and turbot keep it at every
  width. parity at 640×420 shows Run and Step, with the machine in full view.
- **README "Adding one" produced a file embedCheck refused** (minor 3). The README now
  says to set `metadata.title` after the first Save (it writes "Untitled Workbook"). It
  also lists what embedCheck checks. embedCheck now has a validator for every machine
  kind: SC (and SC-brained turbots) are checked as wired through, TM uses
  `validateTMTable`, and a TM-brained turbot uses `validateTurbotTM`. On a scratch run over
  the reference fixtures (test only, never an example) every correct SC/TM/turbot-TM
  machine came out clean.
- **Touch swipes over the canvas never scrolled the host** (major 4). The claim is now
  `editorHost.ts` `gestureClaim` (`wheelNeedsActivation` → `gesturesNeedActivation`),
  a pure machine: a mouse or pen press claims at once, and a touch claims only as a tap
  (no `pointercancel`). Until the claim, the canvas's and palette's `touch-action` is
  `manipulation`, and an unclaimed touch is kept from the canvas's handlers. embedCheck
  [host] drives the machine. Verified on CDP against a host page iframing the build at
  100% × 500. A touch swipe over the canvas scrolled the host (0 → 121), and a second swipe
  did too (→ 242). A mouse wheel over the canvas scrolled the host (→ 120). A tap claimed
  the canvas (touch-action `none`), and the next swipe left the host at 0. A mouse click
  followed by a wheel panned the canvas (translate y 161 → 41) with the host at 0.
- **The ephemeral ordering guarantee did not hold in the bundle** (minor 6). The page
  now declares it: `embed.html` has `<html data-persistence="ephemeral">`, and
  `persistence.ts` reads that as it evaluates. Every module that keeps anything imports
  `persistence.ts`, so the order of the bundle's chunks no longer matters. There is no
  switch and no `embed/ephemeral.ts`. embedCheck pins the declaration in the source and,
  with `--dist`, in the built page, and checks that `index.html` has none.
- **Size:** embed JS 519.7 KB raw, **158.7 KB gzipped** (4 chunks).
- **Gates:** app tsc 0, app build 0, app check 0, server typecheck 0, server check 0.
- **Next:** Checkpoint (commit), then the release step. What is owed has not changed.

### 2026-09-29 — implemented (work loop)
- **Built:** a second page, `embed.html`, that shows ONE example machine in the app's
  editor with a slim bar (name, Reset, "Open the full sandbox ↗"), keeps nothing, lets the
  host page scroll past it until clicked (or tapped) into, and shows a poster below 600px.
  Three fresh examples (`majority` CC default, `parity` FSM, `square-patrol` turbot).
  `_headers` lets only makingminds.org frame `/embed` and `/embed.html` and every other
  page only itself. Deep fixes: host descriptor (`editorHost.ts`), page-declared
  persistence (`persistence.ts`), installed backend slot (`storage/pageBackend.ts`),
  layout-only `EditorShell` + `EditorWorkspace`. Memo `docs/buildout/designs/embeddable-sandbox.md`.
- **Pins:** new `tools/embedCheck.ts` in `npm run check` — [examples] [not homework]
  [ephemeral] [reset] [module graph] [host] [headers] [wiring], `--dist` (built page
  ephemeral, no app-only markers, gz size: 158.7 KB); workbenchCheck (swap's Fit follows
  the palette until the person acts); the other checks moved to the new seams.
- **Gates (exit codes):** app tsc 0, app build 0, app check 0 (embedCheck re-run at
  checkpoint: all passed; budgets: CLAUDE.md 39999/40000), server tsc 0, server check 0.
- **Review:** 6 findings fixed (2 major Fit-before-palette + 1 related minor; 1 major touch
  scroll trap; minors: FSM Run folded at 600–759px, README "Adding one", ephemeral chunk
  order), 0 skipped. Nits left: two "Reset" buttons (bar vs run row); layout defaults
  computed once at load (a frame that widens after loading narrow keeps narrow defaults).
- **Owed:** the loop session's headless-browser pass (host page iframing the dev embed:
  wheel/touch handoff, Reset, reload, zero storage keys, 640×420 / 800×500 / 1000×560
  shots, 375×667 poster, sandbox link) — earlier stages drove it over CDP, recorded above;
  optional `wrangler pages dev` header check. OWED TO GABRIEL: the release is held
  (`deploy/` on HOLD_PATHS); after his hand release, `curl -sI` `/embed`, `/embed.html`
  (308 → `/embed`), `/` and `/embed?example=parity` show the intended headers; then the
  website iframe (handoff, his yes).
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-29 — landed (robot)
- **Headless browser pass** (the robot's own, over CDP against the built `dist/`: a host
  page on another port iframing `/embed?example=majority` at 100% × 500, 1000 wide). A plain
  wheel over the canvas scrolled the host (1200 → 1400). After a click inside, the wheel
  panned the canvas and the host stayed at 1400. After a click on the host, the wheel
  scrolled the host again (→ 1600). The frame held 0 storage keys on a fresh origin (a key
  seen on a first run was the main app's, left on the same origin by the regression pass
  before it). The bar has the name, Reset and "Open the full sandbox ↗" (`#/sandbox`,
  `_blank`), with no File menu, Sign in or feedback. All three examples render at 640×420 and
  1000×560, and `?example=nope` falls back to Majority vote (its 404 for `nope.json` is the
  only console error, as designed). At 375 wide the poster shows "Try it on a larger
  screen." and the link.
- **Main-app regression** (same build, local mode): the sandbox and the sign-in picker
  render. As Prof. Ada after Load HW1–HW7, the editor opens HW1 P1, HW2 P4 (CC), HW4 P1
  (written), HW4 P3 (FSM), HW5 P3 (TM) and HW6 P2 (turbot TM, internal tape) with no console
  errors.
- **Gates after merging `origin/main`** (it brought in one task file): app tsc 0, app build
  0, app check 0, server typecheck 0, server check 0.
- **Owed, not claimed:** Gabriel's eyeball in a real browser, including a real trackpad
  (recipe: build, serve `dist/`, and iframe `/embed` from a page on another port, as in the
  Verify section). After the release, which the gate holds because `deploy/` changed:
  `curl -sI https://making-minds.pages.dev/embed`, `/embed.html` (308 → `/embed`) and `/`
  show the framing headers. Then the website iframe (the handoff, which needs his yes):
  `<iframe src="https://making-minds.pages.dev/embed?example=majority" width="100%"
  height="500" style="border:0" loading="lazy" title="Making Minds sandbox"></iframe>`.
