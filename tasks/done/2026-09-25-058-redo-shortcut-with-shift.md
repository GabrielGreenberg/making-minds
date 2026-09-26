---
id: 2026-09-25-058
type: bug
title: Make Ctrl/⌘+Shift+Z redo on every keyboard — the canvas compares the key's case, so Shift can turn "z" into "Z" and skip redo
priority: normal
size: small
requires:
area: app
source: chat
created: 2026-09-25T16:15:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
Found while reading the canvas keyboard code during the editor-workbench filing
(2026-09-25).

The canvas's shortcut handler redoes on `e.key === 'z' && e.shiftKey`
(`app/src/components/CircuitCanvas.tsx`, the keyboard `useEffect` at ~:1904-1952, redo at
~:1929). But with Shift held, browsers usually report `e.key` as the capital `"Z"`. That is
certainly the case for Ctrl+Shift+Z on Windows and Linux, and it varies by browser on macOS.
So redo can silently do nothing.

It isn't browser-verified here: the catcher had no browser. The code path is plain, though.

Nearby, in the same handler:
- There is no Ctrl+Y redo, which is the Windows convention.
- Caps Lock can capitalise the other letter shortcuts too (Z undo, C/V copy-paste, A
  select-all).
- The text-field guard (:1906-1910) checks INPUT and TEXTAREA only. It misses contentEditable
  and SELECT.

## Done when
- **Redo** fires on Ctrl/⌘+Shift+Z whatever case the browser reports, and on Ctrl+Y.
- **Undo, copy, paste and select-all** fire whatever the case (Caps Lock included).
- **No shortcut fires** while focus is in a text field, a contentEditable element or a
  select.
- **The key → command mapping is pinned in a check tool.** Undo and redo still go through
  the store's `undo`/`redo` (`store.ts:2087`, `:2112`), which stay blocked on a locked
  question.

## Design
**deepFix.** Extract the mapping as a pure function, e.g. `editorShortcut({key, shiftKey,
ctrlKey, metaKey}) → 'undo' | 'redo' | 'copy' | 'paste' | 'selectAll' | 'delete' | 'escape' |
null`:
- it normalises `key` to lower case;
- it maps Ctrl+Y to redo;
- the handler just dispatches the command;
- it goes in a small non-React module (not `engine/`, since it is UI), so a check tool can
  import it.

**surgicalFix.** Write `e.key.toLowerCase() === 'z'` in the two branches.

The editor redesign (052–053) adds Undo/Redo buttons, but the keyboard path must work on its
own.

## Verify
- **Gates:** both `tsc`s and `npm run check`.
- **The pin:** a table of key events → commands in an existing editor check (e.g.
  `navResetCheck`) or a new `keyboardCheck.ts`, registered in `npm run check`.
- **Owed:** a real keypress in a browser (Chrome on macOS and on Windows) for redo, since a
  harness can't produce the browser's own key reporting.

## Progress log

### 2026-09-25 — built, verified, landed (/work, with 054)
- `app/src/shortcuts.ts` (pure): `editorShortcut(press)` → `undo | redo | copy | paste |
  selectAll | delete | escape | null`. The letter is lower-cased; a non-Latin `key` falls
  back to the physical `code` (`KeyZ`), while Latin layouts keep `key`, so AZERTY's Z is
  still Z. Ctrl+Y is redo; ⌘Y is left to the browser (History on a Mac).
  Ctrl+Shift+C/V/A and AltGr (Ctrl+Alt) are not shortcuts. `isTextEntryTarget` stands
  every shortcut down in an INPUT, TEXTAREA, SELECT or contentEditable.
- `CircuitCanvas`'s keydown handler now only dispatches the command. Undo and redo go
  through the store's own (locked) `undo`/`redo`, and Esc also closes 054's Boxes pop-out.
- Pinned in `workbenchCheck [shortcuts]`: a 21-row key table (the Windows "Z" report,
  Caps Lock, Ctrl+Y, ⌘Y, Cyrillic, AZERTY, AltGr) plus the focus guard, and a source pin
  that the canvas asks the table and has no case-sensitive `e.key === 'z'` left.
- **Browser (this pane, macOS):** ⌘Z undid a box delete, ⌘⇧Z redid it, and Ctrl+Y redid.
  ⌘A inside the rename field did not select the canvas.
- **Gates green** with 054's.
- **Owed:** a real keypress on Windows Chrome for Ctrl+Shift+Z (the harness and this
  pane can't produce the OS's own key reporting).
