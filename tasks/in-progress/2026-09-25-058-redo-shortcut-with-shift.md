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
status: in-progress
after:
branch: task/054-editor-floating-palette
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
