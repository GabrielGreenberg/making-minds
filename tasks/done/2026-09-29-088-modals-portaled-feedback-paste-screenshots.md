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
status: done
after:
branch:
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

### 2026-09-29 — implement (robot)
- **Built** (the deep fix): `app/src/modalStack.ts` (pure: `pushModal` / `popModal` /
  `isModalOpen` / `isTopModal`) and `components/Modal.tsx`, the one modal: backdrop + card
  portaled to `document.body`, `role="dialog"`, `aria-modal`, a name (`label` or
  `labelledBy`), focus to the card on open unless a child autofocused (not handed back on
  close), Escape on a document listener (innermost modal only, stopped there so the
  canvas's window Escape never sees it, ignored while `busy`), the scrim closes only when a
  press starts and ends on it, and the click family stops at the root (keydown, paste,
  pointerup pass). All six files moved onto it (FeedbackPanel, ChangePasswordModal, the
  sandbox save prompt, SubmitDialog, LateDialog, RegradeDialog); their private Escape
  effects are gone. The canvas's shortcut handler and its pending-wire Escape, the grading
  queue (its private `modalOpen()` deleted) and the sandbox's ⌘S ask `isModalOpen()`.
- **Paste**: `usePasteGuard.ts` gains `imageFilesOf` / `takeImagePaste` (pure, generic
  over the file type) and `useImagePaste` (a document paste listener; skips a paste an
  answer field's guard already cancelled). FeedbackPanel calls it into `addFiles`, which
  now takes pasted `File[]` too, caps in the setter, says "You can attach up to 2
  screenshots. Remove one to add another." at the limit, and shows the hint "Paste a
  screenshot (⌘V) or choose a file." (Ctrl+V off Apple). The picker stays. No image drop
  (optional; skipped to keep the change on the reported gestures).
- **CSS/docs**: theme.css's leak comments rewritten, `.mm-modal` gets
  `overflow-wrap: break-word` and no focus ring; the dead `.modal-*` block in index.css is
  deleted (its literal ceiling 133 → 126). `MOD_KEY` moved to `shortcuts.ts` (a display
  const beside the table, which is unchanged) so the File menu and the form share it.
  VISUAL_VOCAB §Modals and CLAUDE.md (Student UI, Provenance, Part 1 Feedback) updated in
  place; CLAUDE.md 39,996 bytes.
- **Pins**: themeCheck §5 (scrim/card markup only in Modal.tsx; portal + dialog + Escape
  owner; the six call sites render `<Modal>` with no Escape of their own); workbenchCheck
  [shortcuts] (the stack's open/top/out-of-order/double pop; the canvas asks
  `isModalOpen()` before the table; ⌘S stands down); gradingViewCheck (the queue imports
  and passes `isModalOpen()`, no `modalOpen`, no scrim query); pasteCheck [image paste]
  (10 fake-event rows + source pins; grep gate, EXEMPT and SEAM_DOM_ADAPTER untouched).
- **Gates**: app tsc, typecheck:tools, build, `npm run check` (exit 0); server typecheck,
  `npm run check` (exit 0).
- **Headless eyeball** (the built app in local mode, headless Chrome over CDP; the Robot
  Dev Server can't be started unattended): Feedback from the editor's Name ▾ (instructor
  and student, HW1 q/10), Home and the Dashboard's queue: the card is a child of body,
  z-index 500 and topmost, `.mm-modal-sub` identical everywhere (white-space normal,
  12.5px, rgb(123,123,123); 2 lines instructor, 3 student), scrollWidth = clientWidth at
  1280 and 640, nothing past the card's edge, Escape closes. Paste (synthetic
  ClipboardEvents): text into the message not cancelled, no thumbnail; an image into the
  message → 1 thumbnail, cancelled; image + text on the card → 2; a third → still 2 and the
  limit message. Sandbox: an AND placed and selected, Feedback opened, the card's heading
  clicked, then Delete, Backspace, ⌘V, ⌘Z → the part is still there and the modal open;
  after Escape, Delete alone removes it (the selection held). The sandbox "Unsaved changes"
  prompt: portaled, wraps (scrollWidth = clientWidth at 1280 and 640). No console errors.
- **Owed (Gabriel, a real browser)**: the real clipboard. Recipe: HW1 q11, Name ▾ →
  Feedback; ⌘⇧⌃4 a region, then ⌘V with focus on the form's blank area and again in the
  message box → a thumbnail each time; copy text and paste into the message → text; a
  third image → the limit line. Worth one try in Safari too (it may fire `paste` only with
  focus in the message box). The Password form (remote mode only; local mode has no
  passwords) is the same `<Modal narrow>`, so it is covered by the pins, not the eyeball.
- Task 089's FeedbackPanel rows are keyed by file:line; they moved (:65 → :78, :85 → :104,
  :99 → :118, :104 → :123, :112 → :130; as of the fix below). 089 already allows for drift;
  the strings are unchanged here.

### 2026-09-29 — fix (robot)
- **Review findings (4, two pairs)**: (a) two quick pastes (double ⌘V, or ⌘V held) raced for
  the last slot off the render's stale `screenshots`, and the setter's quiet cap then dropped
  one with the message cleared; (b) text + a picture of it (copied Office cells) pasted into
  the message box lost the text to the image.
- **(a)**: `components/screenshotSlots.ts` (pure `ScreenshotSlots`: `claim(offered)` →
  `{take, overLimit}`, `release(n)`): FeedbackPanel claims on ARRIVAL (attached + still
  decoding), says the limit whenever it takes less than offered, gives the slot back on a
  failed decode and on Remove; the setter's silent `.slice` cap is gone.
- **(b)**: `takeImagePaste` reads the event's `target`: into a text field (textarea,
  text-like input, contentEditable — not the file picker) a clipboard that also holds
  `text/plain` (items or `types`, for Safari) is the text's — nothing taken, not cancelled.
  An image with no plain text (a screenshot, a copied web image: HTML + PNG) is still taken
  anywhere, the message box included.
- **Pins** (pasteCheck [image paste]): 7 text-field rows (message box, text input,
  contentEditable, Safari types-only, image alone, HTML + image, file picker) and the
  card-target row renamed; 5 slot rows (the race for the last slot, ⌘V held, two into one,
  release, empty pick); source pins (claim on arrival, limit said, no quiet cap, release on
  failure and Remove, `setScreenshots` written twice only).

### 2026-09-29 — implemented (work loop)
- **Built**: every modal now opens on the page itself (one `components/Modal.tsx`, portaled
  to `document.body`), so the Feedback form wraps and looks the same from Home, the editor
  and the Dashboard; while any modal is open the canvas's keys and the grading queue's keys
  stand down (one `modalStack.ts isModalOpen()`); a screenshot can be pasted into the
  Feedback form (⌘V / Ctrl+V), read in `usePasteGuard.ts` and downscaled like a picked file,
  up to 2, with the limit said; text pasted into the message box stays text. Six files moved
  onto `<Modal>` (the seven openers); the dead `.modal-*` CSS is gone.
- **Pins**: themeCheck §5 (scrim/card only in Modal.tsx, portal + dialog + Escape owner,
  the six call sites); workbenchCheck [shortcuts] (stack, canvas asks first, ⌘S);
  gradingViewCheck [queue] (shared test); pasteCheck [image paste] (fake-event rows,
  text-field rows, slot race rows, FeedbackPanel source pins; grep gate unchanged).
- **Gates** (exit codes): app tsc 0, app build 0, app check 0, server tsc 0, server check 0.
- **Review**: 4 findings (2 pairs) fixed — the last-slot paste race, text + image into the
  message box; none skipped. Nits left: `shortcuts.ts MOD_KEY` reads `navigator` (and its
  "outside a browser" comment is wrong); the limit line stays after a Remove.
- **Owed**: headless re-run after the fix stage (paste rows: 2 thumbnails, a third → limit
  line, text-only on the textarea not prevented; keyboard: Delete/Backspace/⌘Z/⌘V inert
  behind Feedback, queue keys 0/h/1/↵ inert then live; wrap + one look on Home / editor /
  queue at 1280 and 640; the sandbox save prompt). Password form: remote mode only. Gabriel:
  the real clipboard on his Mac, Chrome and Safari (⌘⇧⌃4, then ⌘V in the message box and on
  the card's blank area), and the form's look side by side.
- **Next step**: loop session: headless visual check (owed above), then land per PROFILE §5.

### 2026-09-29 — headless check + nits (robot)
- **Nits fixed**: a Remove now clears the limit line (there is room again; pinned in
  pasteCheck [image paste]); `shortcuts.ts MOD_KEY`'s comment corrected (Node has a
  `navigator.platform` too, so a harness on a Mac reads "⌘"). MOD_KEY stays beside the
  table as a display const; the table itself is unchanged.
- **Headless re-run after the fix stage** (the built app, local mode, headless Chrome over
  CDP; scratch script, not committed): Feedback from the editor's Name ▾ (instructor and
  student, HW1 q/10), Home and the Dashboard's queue — portaled (child of body), role
  dialog, aria-modal, z-index 500 and topmost; `.mm-modal-sub` identical on all three
  (white-space normal, 12.5px, rgb(123,123,123)); scrollWidth = clientWidth at 1280 and
  640, nothing past the card's edge; Escape closes. Paste (synthetic ClipboardEvents): text
  into the message → not cancelled, no thumbnail; image into the message → 1, cancelled;
  image + text on the card → 2; a third → still 2 + the limit line; Remove → 1, line
  cleared; text + image into the message → the text's (not cancelled, no thumbnail); image
  again → 2. Sandbox: an AND placed and selected, Feedback open, the card's heading
  clicked, Delete / Backspace / ⌘V / ⌘Z → the part still there, the modal still open;
  after Escape, Delete alone removes it. The sandbox "Unsaved changes" prompt: portaled,
  wraps at 1280 and 640. No console errors.
- **Owed, not claimed** (Gabriel, a real browser): the real clipboard on his Mac in Chrome
  and Safari — ⌘⇧⌃4 a region, open HW1 q11 → Name ▾ → Feedback, ⌘V (a) in the message box
  and (b) after clicking the card's blank area → a thumbnail each time, nothing pasted into
  the canvas behind (Safari may fire `paste` only with focus in the message box — note
  whether (b) works); plain text into the message → text; the form's look side by side on
  Home, the editor and the Dashboard queue. The grading queue's keys (0 / h / 1 / ↵) inert
  behind a modal and live after it closes (pinned in gradingViewCheck, not eyeballed). The
  Password form in remote mode (the same `<Modal narrow>`; pinned, not eyeballed).

### 2026-09-29 — landed (robot)
- Gates (exit codes, final tree): app tsc 0, app build 0, app `npm run check` 0; server
  typecheck 0, `npm run check` 0 (the workflow's run; nothing server-side changed since).
  `origin/main` brought nothing in. Merged `--no-ff` into `main` and pushed; the release
  gate decides the pilot. Owed checks: above (the real clipboard, Safari, the queue keys
  and the Password form by eye).
