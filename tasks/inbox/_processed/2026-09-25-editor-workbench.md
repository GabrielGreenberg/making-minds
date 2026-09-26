# Inbox: editor workbench redesign (HW1 / CC pass)

Source: design sessions with Gabriel, September 2026. The design memo is `docs/buildout/designs/editor-workbench.md`, a copy of the handoff README. The working reference is `Editor Prototype.dc.html` from the same handoff folder, which should go in `docs/buildout/designs/editor-workbench/`.

**For /catch:** file these as five tasks, chained with `after:`. Each one is shippable alone, so HW1 stays usable between them. First, settle the memo's four open questions with Gabriel (done-lock, table font, dim vs hide, sandbox left panel).

1. **Editor shell: top bar, question panel, resizable and collapsible columns** (feature, large, requires: browser)
   - **Scope:**
     - Replace `MenuBar` + the question branch of `TabBar` with the 48px top bar.
     - Add the left question panel: nav strip, current question with caution, hint and section-note links, the done mark, and the grouped question list.
     - Add both divider drag handles, both collapse strips, and the persisted prefs.
     - Move open and fill-in questions into the same shell.
   - **Done when:**
     - Every HW1 question opens in the new shell.
     - Prev/Next, list rows and the breadcrumb navigate the same way `TabBar` did, submission attempts included.
     - Widths and collapse states survive a reload.
     - The locks and the frozen and viewing tags still show.
     - `navResetCheck` and `routingCheck` are green.
     - `themeCheck` is green, with the new tokens in `:root`.

2. **Output panel: one run-control set and the live table** (feature, large, after 1)
   - **Scope:**
     - Fold `SimulationToolbar` into the right panel's header row.
     - Remove the duplicate Resets.
     - For CC, restyle the I/O table per the memo: the current row highlighted, and a row click sets the inputs.
     - For SC, FSM, TM and turbot, re-house the existing `DataTable` content in the frame unchanged.
   - **Done when:**
     - There is exactly one Run/Step/Reset on screen in every mode.
     - The CC table behaves per the memo.
     - `scWindowCheck`, `caseRunCheck` and `pipelineCheck` are green.

3. **Floating palette with the Boxes pop-out and pinning** (feature, large, after 1)
   - **Scope:**
     - Replace the `ComponentLibrary` column with the floating, draggable, turnable palette and the icon tiles.
     - Support drag-to-place and click-to-arm.
     - Handle `allowed_components` per the decision on dimming versus hiding.
     - Add the Boxes pop-out (the library rows with rename, delete and pin, plus the New box tool).
     - Store pinned tiles as a per-homework pref.
   - **Done when:**
     - Every part can be placed both ways.
     - The palette position and orientation persist.
     - Boxes can be pinned by drag or button, and unpinned.
     - `boxScopeCheck` and `pasteCheck` are green.

4. **Canvas appearance: Plex Sans, regular gate geometry, drawn symbols, magenta selection** (feature, large, requires: browser, after 1)
   - **Scope:**
     - Update the gate geometry table in the memo, across `types.ts`, `componentGeometry.ts` and `CircuitCanvas`.
     - Replace the glyph symbols with stroked paths.
     - Switch all canvas text to Plex Sans tabular.
     - Change the selection colour from blue to `--mm-accent` / `--mm-lav-soft`.
     - Add the dot grid, the hint line and the empty state.
   - **Done when:**
     - AND and OR are 60×60 and NOT is 50×60, with ports at 20/40 and 30.
     - There is no monospace text on the canvas.
     - `routerCheck` (fallback budget 0), `layoutCheck`, `bumpCheck` and `coverageCheck` are green.
     - Existing HW1 workbooks re-open with all connections intact (a screenshot pass with `shootProblemSets.mjs`).

5. **Detailed pass against the memo** (chore, small, requires: browser, after 2 3 4)
   - Measure the built editor against every value in the memo.
   - Fix any drift.
   - Attach before and after screenshots at 1280 and at 1024 wide.
