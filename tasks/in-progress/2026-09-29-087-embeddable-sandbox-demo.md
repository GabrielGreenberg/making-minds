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
status: in-progress
after:
branch: robot/087-embeddable-sandbox-demo
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
