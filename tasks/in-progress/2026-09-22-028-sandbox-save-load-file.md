---
id: 2026-09-22-028
type: feature
title: Save and load a sandbox worksheet as a file (visitor-mode bells and whistles)
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-22T10:30:00-07:00
status: in-progress
after: 2026-09-22-027
branch: task/028-sandbox-save-load-file
merged_into:
---

## Description
Gabriel, filing visitor mode (027): "we may want to add some bells and whistles to visitor
mode eventually, like being able to save and load a worksheet locally." Provenance: chat,
catch session 2026-09-22.
Raised to normal (catch 2026-09-23): Gabriel asked for it again: "add a save/load worksheet option
to visitor mode". Visitor mode (027) has landed, so nothing blocks it.

Most of this exists headless already: the store has `newWorkbook`, `exportWorkbook`,
`importWorkbook` and `openWorkbook` (`app/src/store.ts:891, 913, 917, 967`) with NO UI callers,
and `app/src/fileHandle.ts` (`saveToFile` / `saveToFileAs` / `openFile`, File System Access API
with a download fallback) is imported nowhere — git history says a menu using them was
removed in the menu overhaul (`de82edc`). The sandbox otherwise persists only as the one
per-browser autosave blob `making-minds-autosave` (`store.ts:3760`).

## Done when
- The sandbox chrome (`TabBar`'s sandbox menu, or `MenuBar` when a workbook is open and no
  assignment is) offers **New worksheet · Open… · Save · Save as…** for visitors and signed-in
  users alike; Save writes the workbook JSON (`exportWorkbook`) via `fileHandle.ts`, Open
  reads one (`importWorkbook`, which already calls `resetAllSimState`).
- A visitor who signs in keeps their sandbox (unchanged, per-browser blob); a signed-in user's
  sandbox is NOT uploaded anywhere (out of scope — the blob stays local).
- Unsaved-changes prompt on New/Open when the current worksheet differs from its last save.

## Design
- **deepFix:** wire the existing store actions and `fileHandle.ts` into one sandbox menu;
  keep the file format = `exportWorkbook`'s JSON (already round-trips through
  `importWorkbook`; pin it in `boxScopeCheck` or a new `workbookFileCheck`: export → import ≡).
- **surgicalFix:** none needed — the store side is done.
- Constraint (catch 2026-09-23, task 2026-09-23-033): a file import must NEVER write into an
  assignment; it opens only as sandbox tabs (as `importWorkbook` does today). Content loaded this
  way is sandbox-scoped and cannot be pasted into an assignment.
- Assumption: file only (no cloud/per-account sandbox storage) for now.
- Pointers: `store.ts:888–970`, `fileHandle.ts`, `components/TabBar.tsx:98–150` (the one
  existing sandbox menu, the "+ New worksheet" machine picker), `components/MenuBar.tsx:35–85`.

## Verify
- Gates: `tsc`, build, the round-trip pin. Browser: build a CC + FSM worksheet → Save →
  New → Open the file → identical tabs; visitor and John Doe alike.
- Done (2026-09-24, implement stage): app tsc, `npm run build`, server typecheck;
  `workbookFileCheck` (113 pins: round trip, legacy, invalid files, unsaved baseline, sandbox
  only + paste refusal, principal, file handle both paths with stubbed pickers / fake DOM,
  names, menu wiring, grep gates); navResetCheck, pasteCheck, provenanceCheck, boxScopeCheck
  green. Browser pane (dev server, John Doe, local mode): File ▾ menu and New ▸ flyout render;
  New ▸ FSM on unsaved work shows the Unsaved changes modal, Cancel keeps the tabs; the '+'
  tab menu (now the shared MachineMenu) still adds a tab; with `showSaveFilePicker` /
  `showOpenFilePicker` stubbed in the page, Save wrote the export (notice, suggested name
  `Untitled Workbook.json`, "Saved to …" note) and Open read it back as identical tabs with
  no prompt; the saved baseline survived a reload.
- OWED (Gabriel, a real browser — the pane can't drive native dialogs):
  1. Chrome/Edge, File System Access path: `npm run dev` → `#/sandbox` → build a CC sheet
     (IN×2 → AND → OUT) + an FSM tab → File ▸ Save as… → pick `adder.json` (title becomes
     "adder") → edit → ⌘S (no dialog; writes the same file) → File ▸ New ▸ Logic Circuit →
     the Unsaved changes modal → Save → fresh sheet → File ▸ Open… → `adder.json` → the same
     tabs. Also: Open… on unsaved work → Save → "Saved — choose the file to open" → Open….
  2. Safari or Firefox (no pickers): Save / Save as… download `<title>.json`; Open… uses the
     file input; dismissing it leaves the menu usable (the input's `cancel` event). A download
     is not a save: File ▸ New afterwards still asks ("…was downloaded, but this page can't
     tell…"); its Save downloads again and stops at "Downloaded" — nothing is replaced until
     "New workbook" / "Open…" is clicked. Also cancel the browser's own save dialog (Firefox
     "Always ask where to save files") → the work is still there and New still asks.
  3. As a visitor (signed out, `#/sandbox`) and as John Doe: the File menu is there for both;
     a visitor who opens a file then signs in as a first-time account keeps those tabs.
  4. Open a hand-broken file (e.g. an AND renamed to "FOO"): the alert names the file and
     the component.

## Progress log
- 2026-09-24 — Implemented. New pure `app/src/workbookFile.ts` (parseWorkbookFile: size cap,
  structure/required fields/component types/wire ends/arena bounds, never label syntax;
  legacy single-circuit → one sheet; `workbookContentKey`/`workbookKeyHash`, the unsaved
  baseline minus ids/titles/view/run state; file names) and `app/src/canonicalJson.ts`
  (moved out of homeworkSync, re-exported there). `fileHandle.ts` rewritten to tagged
  results (saved / downloaded / cancelled / failed; `typeof` detection, AbortError-only
  cancel, SecurityError → download, no file-input fallback without activation, input
  `cancel` event). Store: `freshSandboxTab` (one tab factory), `sandboxTabCircuits` /
  `sandboxWorkbookData` (the live canvas folds in only when no assignment is in memory),
  `hasUnsavedWorkbookChanges`, `captureSandboxSession`; `newWorkbook(mode, innerMode,
  title)` and `importWorkbook(json, handle, fileName) → ImportResult` leave an open
  assignment through goHome first, no alert(); `markWorkbookSaved` (baseline from the
  written JSON); `openWorkbook` removed; `workbookSavedKey` persisted in the sandbox blob.
  UI: `components/MachineMenu.tsx` (shared by the '+' tab menu and File ▸ New),
  `components/WorkbookFileMenu.tsx` (File ▾ + workbook name + note, the Unsaved changes
  modal, ⌘S / ⇧⌘S), mounted by MenuBar when no assignment is open. New
  `app/tools/workbookFileCheck.ts` in `npm run check`. CLAUDE.md updated in place;
  PROFILE §6 tool count fixed (21).
- 2026-09-24 — Review fixes. (1) Save never writes a file Open refuses: `serializeWorkbook`
  indents only while that fits under the cap (compact past it); the menu asks
  `unopenableReason` (UTF-8 bytes + Open's parse) before any dialog; `markWorkbookSaved`
  reads the written JSON back without the cap. (2) [menu wiring] pins assert every token
  present and in order, and match the File items inside the dropdown markup with their
  actions (mutation-tested: dropping an item or a session guard now fails). (3) A download is
  not a save: `markWorkbookDownloaded` records it (memory only), the baseline stays, New/Open
  still ask saying it was downloaded, and the question's Save stops at a "Downloaded" step
  (a second click continues). Pins: [download], [file size]. Browser pane: both prompts and
  the Downloaded step render (download stubbed; the sandbox restored after).

### 2026-09-24 — implemented (work loop)
- **Built:** the sandbox now has a File ▾ menu (New ▸ machine · Open… · Save · Save as…,
  ⌘S / ⇧⌘S) for visitors and signed-in people alike, hidden inside an assignment. Save writes
  the workbook JSON to a file on this computer (a picked file when the browser allows it,
  else a download, which is not counted as a save); Open reads one back as sandbox tabs
  only. New and Open ask first when the work differs from its last save. Nothing is
  uploaded. Code: `workbookFile.ts` (pure parse/validate, content key, `serializeWorkbook`,
  `unopenableReason`), `canonicalJson.ts`, `fileHandle.ts` (tagged results),
  `components/WorkbookFileMenu.tsx`, `components/MachineMenu.tsx` (shared with the '+' tab
  menu), store actions (`newWorkbook`, `importWorkbook → ImportResult`, `markWorkbookSaved`,
  `markWorkbookDownloaded`, `workbookSaveState`, `captureSandboxSession`).
- **Pins:** new `app/tools/workbookFileCheck.ts` in `npm run check`, 142 checks: [round trip]
  [legacy] [invalid files] [unsaved] [download] [file size] [sandbox only] [principal]
  [file handle] [names] [menu wiring] [grep gate].
- **Gates (exit codes):** app-tsc=0 app-build=0 app-check=0 server-tsc=0 server-check=0;
  rechecked at checkpoint: app tsc 0, `workbookFileCheck` 0, budgets 0 (CLAUDE.md 39,983 B).
- **Review:** 3 fixed (Save never writes a file Open refuses; menu-wiring pins
  mutation-proof; a download is not a save). 0 skipped. Nits left: the item is labelled
  "New ▸", not "New worksheet"; the prompt's principal-change branch in `saveThenContinue`
  is unreachable (save() already returns false), so the prompt can outlive a sign-out;
  CLAUDE.md "Build phases" was trimmed to fit the budget.
- **Remaining (owed):** the loop session's browser checks (stubbed pickers in local mode:
  Save as → New → Open ≡ with a CC + FSM sheet; the Unsaved modal's Cancel / Don't save /
  Save; the download + file-input fallback; an invalid file; visitor → John Doe keeps
  the sheet; no File menu in HW1; no `/api` traffic), then Gabriel's real-dialog recipes
  (Verify OWED 1–4).
- **NEXT STEP:** loop session: run the owed browser checks, then land per PROFILE §5.

### 2026-09-24 — loop browser check and land
- **Fixed here:** the review's label nit. The File item read "New ▸"; it now reads **"New
  worksheet ▸"**, as the Done-when says. The `workbookFileCheck [menu wiring]` pin follows it
  (142 checks OK); app tsc is 0.
- **Browser, local mode (dev server restarted on the branch), John's sandbox with 4 tabs
  (Circuit, TM, Turbot, FSM).** The native pickers were stubbed as in the recipe.
  - The header shows "File ▾ · Untitled Workbook". The menu reads **New worksheet ▸ · Open… ·
    Save ⌘S · Save as… ⇧⌘S**.
  - Save as… wrote `Untitled Workbook.json` (formatVersion, notice, metadata, 4 worksheets),
    and the header read "Saved to Untitled Workbook.json".
  - New worksheet ▸ Logic Circuit gave one empty tab with no prompt (the work was saved).
  - Open… brought back all 4 worksheets identical (titles, modes, component types, wires:
    "Turbot 1|turbot|INPUT,NOT,OUTPUT,OUTPUT|3", "FSM|STATE,STATE|1"), and the header read
    "Opened Untitled Workbook.json".
  - Adding an OR, then File ▸ Open…, showed the **Unsaved changes** modal ("…Opening a file
    will replace it. Save it first?" Don't save · Cancel · Save). Cancel kept the work.
  - No `/api` requests (only Vite's module load of `api/client.ts`).
- **Owed to Gabriel:** the real OS dialogs. Chrome: Save as → Save in place → New → Open,
  identical. Safari/Firefox: the download plus file-chooser fallback. Recipe above.
- Landed via a merge into `main`.
