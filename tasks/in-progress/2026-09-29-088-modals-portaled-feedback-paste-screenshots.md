---
id: 2026-09-29-088
type: bug
title: Open every modal on the page itself so the Feedback form wraps its text, and let it take a pasted screenshot
priority: normal
size: large
requires:
area: app
source: feedback
created: 2026-09-29T17:08:40-07:00
status: in-progress
after:
branch: robot/088-modals-portaled-feedback-paste-screenshots
merged_into:
---

## Description
App Feedback report `fb-munb8jun-pgnjdg` (author-role: instructor, category: platform
design; filed from HW1, question 11 — i.e. from inside the editor). Two points about the
Feedback form:

1. **Its text runs off the right edge.** Opened from the editor, the form's explanatory
   line (and any error or "sent" message) stays on one line and runs past the edge of the
   card instead of wrapping.
2. **A screenshot should be attachable by pasting it** (⌘V / Ctrl+V after a screen
   capture to the clipboard), not only through the "Choose file" picker.

**Why (1) happens — reproduced from the code.** The form is not opened on the page; it is
rendered *inside the component that opened it*. In the editor that is the top bar's
"Name ▾" menu (`SessionControls.tsx:144`, `<RouteFeedbackPanel>` inside
`<div className="session session--menu">`), and the top bar's session styles set
`white-space: nowrap` (`workbench.css:112`, `.wb-topbar .session { … white-space: nowrap; }`).
`white-space` is inherited, so every paragraph in the modal inherits "never wrap": the
subtitle (`FeedbackPanel.tsx:99-108`, ~110 characters for an instructor, ~260 for a
student) is one line wider than the 640px card, and `.mm-modal`'s `overflow-y: auto`
(`theme.css:308-312`) turns the overflow into a sideways scroll/clip. (The textarea itself
still wraps — browsers default a textarea to `pre-wrap`.)

This is one case of a class: **a modal's look depends on where it was opened**, because
all seven modals render in place as DOM descendants of their opener and inherit its
typography (`white-space`, `font-size`, `color`, `font-weight`), and sit inside its
stacking context (`.wb-topbar` is `position: relative; z-index: 100`, `workbench.css:80`,
so a modal opened there can never rise above z-index 100 in the editor). `theme.css:170-172`
already records a workaround for the same leak (direct-child selectors so the modal's buttons
keep their look). Every modal currently opened inside a nowrap context is affected:

### Members
- Feedback form from the editor's "Name ▾" menu — `SessionControls.tsx:144` inside
  `.wb-topbar .session` (nowrap, `--mm-fs-small`, `--mm-ink-2`) — **the reported symptom**.
- Password form from the same menu — `SessionControls.tsx:145` (`ChangePasswordModal`,
  `AccountPanel.tsx:57`) — same inheritance, same overflow for any long line.
- The sandbox's "Unsaved changes / Downloaded / Saved" prompt — `WorkbookFileMenu.tsx:239`,
  rendered inside `<nav className="wb-crumbs">` (`EditorTopBar.tsx:81-106`;
  `.wb-crumbs { white-space: nowrap }`, `workbench.css:92-95`) — its `mm-lede` sentence
  can't wrap either.
- The Feedback form from the page-shell topbar (`SessionControls.tsx:65`, inside
  `.topbar .session`, `theme.css:173`) inherits the nav font size — the same form looks
  different on Home than in the editor or the Dashboard's Feedback queue
  (`FeedbackQueueView.tsx:91`). No overflow there, but the same leak.
- Not visibly broken today but built the same way: `SubmitDialog.tsx:108`,
  `LateAdjustControls.tsx:108`, `RegradeDialog.tsx:71`.

**A second, latent hazard in the same family, directly in the path of (2).** The canvas's
keyboard shortcuts listen on `window` (`CircuitCanvas.tsx:1952-1995`) and skip only when
focus is in a text field (`shortcuts.ts isTextEntryTarget`). With a modal open over the
editor and focus on anything else in it (after clicking the card's blank area, a label, or
a button), **Delete/Backspace deletes the selected parts behind the modal, ⌘V pastes the
canvas clipboard into the problem, ⌘Z undoes** — unseen. The grading queue already guards
against exactly this with its own `modalOpen()` (`instructor/GradingQueue.tsx:533-537`:
"a modal … owns the keyboard"); the canvas doesn't. Point (2) makes it acute: the natural
gesture to paste a screenshot is ⌘V with focus on the form, and today that keydown reaches
the canvas first (keydown precedes the paste event) and pastes circuit parts into the
student's answer behind the modal.

**Why (2) needs the paste seam.** The paste law (PROFILE §8.8; `CLAUDE.md` Critical
design rules) allows no clipboard API outside `app/src/usePasteGuard.ts`, enforced by the
`[grep gate]` in `app/tools/pasteCheck.ts:389-404` (`clipboardData`, `onPaste`, paste
listeners). The Feedback form is not assignment content (its textarea is already a counted
exemption, `pasteCheck.ts:422`), so an image paste there is always allowed — but the DOM
code that reads it must live in the seam's DOM adapter, not in `FeedbackPanel.tsx`.

## Done when
- Every modal renders through ONE shared modal component that portals to `document.body`
  (so it inherits nothing from its opener and sits above every editor panel); the seven
  call sites above use it; `.mm-modal-backdrop` markup appears nowhere else.
- The Feedback form opened from the editor's "Name ▾" menu wraps every line inside the
  card — no sideways scroll at 640px — and looks the same (font size, colour) wherever it is
  opened: Home, the editor, the Dashboard's Feedback queue. Same for the Password form and
  the sandbox's save prompt.
- While any modal is open, the canvas's keyboard shortcuts (delete, copy, paste, undo, redo,
  select all) do nothing; the grading queue uses the same one "a modal is open" test instead
  of its private copy.
- In the Feedback form, pasting an image (⌘V / Ctrl+V, with focus anywhere in the form,
  including the message box) attaches it as a screenshot through the same downscale path as
  a picked file (`fileToScreenshot`), up to the existing limit of 2; pasting text into the
  message box still pastes text; a paste with no image changes nothing; at the limit a paste
  says so instead of silently dropping. The form tells the reader they can paste
  ("Paste a screenshot (⌘V) or choose a file"). The file picker stays (see Design).
- The clipboard read lives in `usePasteGuard.ts`; `pasteCheck`'s grep gate passes
  unchanged (no allowlist widened) and pins the new behaviour.
- All gates green (PROFILE §6).

## Design
- **deepFix (recommended):** one modal primitive, owning placement and the keyboard.
  - `app/src/components/Modal.tsx` (or `mm-modal` in the shared vocabulary's home): renders
    backdrop + card via `createPortal(…, document.body)` (the one precedent:
    `TabBar.tsx:122`), with `role="dialog"`, `aria-modal`, an accessible name (its title),
    Escape to close, backdrop click to close (respecting a `busy`/non-dismissable flag —
    `LateAdjustControls` and `SubmitDialog` block closing while busy), and the existing
    classes (`mm-modal`, `mm-modal--narrow`, `mm-surface`) so `theme.css` stays the one
    look. React synthetic events still bubble through a portal to the opener's React tree:
    stop propagation at the Modal's root so no opener's React handler ever sees clicks
    from inside the modal.
  - Export one `isModalOpen()` (a mounted-modal count kept by `Modal`, or the DOM query the
    grading queue uses today) and consult it first in `CircuitCanvas.tsx`'s shortcut handler
    (`:1953`) and in `GradingQueue.tsx` (replacing its private `modalOpen`, `:535`). Keep
    `shortcuts.ts` pure — the handler asks, the table stays a table.
  - Migrate all seven call sites; delete the `theme.css:170-172` direct-child workaround's
    rationale comment (the selectors can stay; the leak they guard against is gone).
  - Paste: add to `usePasteGuard.ts` (the one file the grep gate lets touch the clipboard) a
    small hook, e.g. `useImagePaste(onImages: (files: File[]) => void, enabled: boolean)`,
    that while enabled listens for `paste` on `document`, takes the `clipboardData` items
    whose `kind === 'file'` and `type` starts with `image/`, and only when there is at
    least one calls `preventDefault()` and hands the `File`s over — a text paste passes
    through untouched. Keep the item filtering a pure exported function so `pasteCheck`
    can pin it with fake items. `FeedbackPanel` calls the hook and feeds the files to its
    existing `addFiles` path (cap, downscale, error message). No `provenance.ts` verdict is
    needed — the Feedback form is not assignment content (and is already a counted
    exemption) — but say so in the hook's doc comment so the next reader doesn't add one.
  - Optional, same hook, only if cheap: dropping an image file onto the form attaches it
    too (`drop` is not gated by the grep gate; `dataTransfer.files`).
- **surgicalFix:** add `white-space: normal` (and reset `font-size`/`color`) on `.mm-modal`
  in `theme.css`, and put a `paste` handler in `FeedbackPanel.tsx` with the file added to
  the grep gate's allowlist. Rejected: it cures the one symptom while the next modal opened
  from a styled opener leaks again, the modal stays trapped under the top bar's z-index,
  the canvas still eats ⌘V/Delete behind every modal, and widening the paste gate's
  allowlist weakens a load-bearing law.
- **Decision taken (not a product fork):** keep the "Choose file" picker beside paste. The
  report's "rather than choose file" reads as "not only"; the picker is still needed on
  touch devices and for images already saved on disk. Paste becomes the advertised first
  way (the hint line), the picker the fallback.
- Interplay to keep: `pasteCheck`'s text-field exemption for `FeedbackPanel.tsx` (1 field)
  stays; `GradingQueue`'s keyboard behaviour (keys 0 / h / 1, ↵) must not change except
  that its modal test becomes the shared one; the Escape handlers in `CircuitCanvas`
  (`:1959`, `:3113`) are harmless with a modal open but may also consult `isModalOpen()`.

## Verify
- Gates: PROFILE §6, all of them (`npm run check` in `app/` and `server/`).
- Pins to add:
  - `app/tools/pasteCheck.ts` — the image-item filter (image file items kept, text items
    and non-image files ignored, nothing → no preventDefault) and a grep that the clipboard
    read stays in `usePasteGuard.ts` (the existing gate already fails otherwise).
  - `app/tools/themeCheck.ts` (or `workbenchCheck.ts`) — `mm-modal-backdrop` appears in
    exactly one `.tsx` (the Modal component) and that file uses `createPortal`; so a new
    in-place modal fails the gate.
  - `app/tools/workbenchCheck.ts` — the canvas shortcut handler consults `isModalOpen()`
    before dispatching (a source pin or a pure predicate test).
- Eyeball owed (the robot's "Robot Dev Server", or `/work`'s preview): sign in as an
  instructor and as a student, open HW1 question 11, open "Name ▾ → Feedback": every line
  wraps inside the card, no horizontal scrollbar; select a part on the canvas, click the
  form's blank area, press Delete and ⌘V — the canvas is unchanged; copy a screenshot to
  the clipboard (⌘⇧⌃4 on a Mac), paste into the form — a thumbnail appears; paste text into
  the message box — text appears; paste a third image — the limit message shows. Repeat
  the wrap check for Password and for the sandbox File menu's "Unsaved changes" prompt, and
  open Feedback from Home and from the Dashboard's Feedback queue to confirm one look.
  Screenshots in the progress log.

## Progress log
