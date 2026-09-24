---
id: 2026-09-23-033
type: feature
title: Anti-cheating paste constraints — in an assignment, accept only content copied there in this window by this user; the sandbox stays free
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-23T11:30:00-07:00
status: done
after: 2026-09-23-032
branch:
merged_into:
---

## Description
Gabriel (2026-09-23): "pervasive copy-paste constraints throughout the app, to prevent the most
straightforward forms of cheating. Sandbox is free — anything can happen there. In an
assignment, only things copy-pasted from the current window/user/session can be used.
Critically, stop people from making something in a sandbox, saving it, sending it to a
friend, the friend opening it in the sandbox and copy-pasting it into an assignment. The same
goes for all text fields in an assignment." He asked for a holistic survey of the issues and
options, and the key decisions, before any building. The survey follows.

## Findings — survey (catch session 2026-09-23)

### How content can enter an assignment today
| Path | Today | Verdict |
| --- | --- | --- |
| Canvas Cmd+C / Cmd+V | Held in memory only, in the store's `clipboard` (`store.ts:585, 2368–2430`). It never touches the system clipboard (`CircuitCanvas.tsx:1934–1941` calls `preventDefault`), so text from a chat message cannot reach the canvas. But it is **never cleared**, so a copy made in the sandbox pastes into any question in the same tab. No mode or `allowed_components` check either: CC gates paste into an FSM question. | **The friend attack works today** (open the file in the sandbox, copy, open the HW, paste). |
| Undo across canvases | Undo writes the previous canvas's snapshot into the current question. | Leak; task 032. |
| Sign-out, then sign-in as another user | The new user inherits the in-memory work. | Leak; task 032. |
| Open-response text | `OpenResponsePanel.tsx:44–47` blocks copy, cut, paste and drop, silently. | Blocks everything, including the student's own text. No message. |
| Fill-in blanks | `FillInPanel.tsx:41–54`: no guard. `numericOnly` strips non-digits after a paste. | Open. |
| Box rename | `CircuitCanvas.tsx:1639`, `ComponentLibrary.tsx:143`: no guard. Graded (names live in the circuit), but trivial. | Low value. |
| Transition labels | `CircuitCanvas.tsx:1442` is a `readOnly` token editor with a key whitelist (`:1193`), so paste cannot insert. | Already safe. |
| Run inputs (SC/FSM sequences, SC cells, TM tape) | Exploratory, not graded. | Out of scope. |
| Workbook or file import | `importWorkbook`/`openWorkbook` (`store.ts:913, 967`) write only sandbox tabs and set `assignment: null`. No UI caller yet; task 028 will add one for the sandbox. | Safe while it never targets an assignment. |
| Drag from palette | Carries only a component type (`CircuitCanvas.tsx:1988–2012`). A box resolves only against this window's own library. | Safe. |
| Browser console | `window.__store = useStore` in **production builds** (`store.ts:3754–3757`). One console line can set any circuit, or call `importProject` (`:1793`, which has no lock check). | Wide open, needs no code. |
| localStorage tampering | The crash journal `mm:journal:<email>:<id>` is replayed and PUT to the server with only a shape check (`storage/journal.ts:46–56`, `store.ts:1555`). `migrateLocal.ts:73–80` uploads `mm:asg:*` on first login. | Needs devtools. Cannot be sealed client-side, because any key lives in the client. |
| Direct API | A student's own bearer token (`mm:auth:token`) lets `curl` PUT any workbook or POST any submission. The server checks shape only (`server/src/app.ts:484–523`) and keeps no workbook history (`db.ts:97–103`, one row per student and assignment, overwritten). | Cannot be prevented, only detected. |
| Redraw by hand from a friend's screen or file | — | No software can stop it. |

**Honest framing:** client-side rules can stop the straightforward attack (tier 1: copy-paste,
undo, sign-out leaks, pasting text from chat or an AI tool) and the console one-liner. They
cannot stop localStorage editing, scripting the API, or redrawing by hand. Those need
**detection** at grading time, which belongs in task 031's flags.

### Identity available
There is no per-window id and no page-load session id; the only identity is the user's email
(`api/client.ts:17`, `db.ts:87–91`). None is needed: the store and module memory are already
per window. The rule "same window" holds for free as long as the clipboard never leaves memory
(no localStorage, no BroadcastChannel, no system clipboard).

## Done when
(Final shape depends on the Questions; this is the recommended version.)
1. **One provenance seam**, `app/src/provenance.ts`: an in-memory clipboard for canvas content
   and assignment text, each item stamped with `{scope: sandbox | assignment <id>, user}`, and
   a pure `canPaste(item, target)` policy that answers every paste question in the app.
   Resolved policy: a paste into an assignment is accepted iff the item was copied inside an
   assignment (any) by the current user in this window; sandbox-scoped items are always refused;
   a paste into the sandbox is always accepted. No record of refused pastes is kept.
2. **Canvas:** copy stamps the item; paste into an assignment is refused unless the policy
   allows it; paste also refuses component types the question does not allow, and a mode
   mismatch. Paste into the sandbox is always allowed.
3. **Assignment text fields** (open response, fill-in, box rename) use one guard hook. It uses
   `beforeinput` (`insertFromPaste`, `insertFromDrop`, and friends), which covers the keyboard,
   the right-click menu, drag-drop and mobile paste. A copy or cut inside the assignment goes
   into the seam's clipboard and nothing reaches the system clipboard. A paste is accepted
   only when its text matches an item the policy allows. The open response's blanket block is
   replaced by this rule.
4. **Blocked pastes explain themselves** with a brief inline message naming the rule.
5. **The console hole is closed:** `window.__store` only in dev builds; `importProject`
   removed, or lock-gated if it still has a caller.
6. **Gates:** a new `pasteCheck.ts` pins the policy table and the store's paste behaviour,
   plus a grep gate: no `onPaste`, `clipboardData` or `navigator.clipboard` outside the seam
   and its hook, like `notationCheck`. A law is added to PROFILE §8 and CLAUDE.md: assignment
   content enters only through the provenance seam.
7. The browser pass from Verify, with screenshots.

## Design
- **deepFix (recommended):** the provenance seam above. It retires the class, because every
  way content can enter an assignment (canvas paste, text paste, drop, a future file import)
  asks the same policy. The rule is symmetric: the system clipboard never reaches assignment
  content, and assignment content never reaches the system clipboard. It is also testable
  headless.
- **surgicalFix:** clear the clipboard whenever the canvas leaves an assignment, and copy the
  open-response blanket block onto fill-in. Rejected: no rule anyone can state, a silent UX,
  and the next input or import path slips past it.
- **Detection (tiers 2–3):** belongs in task 031. It could flag identical or near-identical
  circuits across students (a canonical circuit hash), identical open-response text, and later
  a workbook-save history on the server that shows a circuit appearing fully formed in one
  save.
- Pointers: `store.ts:585, 1793, 2368–2430, 3754–3757`;
  `components/CircuitCanvas.tsx:1906–1941, 1988–2012, 1639`;
  `components/OpenResponsePanel.tsx:11–47`; `components/FillInPanel.tsx:41–54`;
  `components/ComponentLibrary.tsx:143`; `storage/journal.ts:46–56`;
  `storage/migrateLocal.ts:73–80`; `server/src/app.ts:484–523`.

### Resolved decisions (Gabriel, 2026-09-23)
1. **Scope:** yes — the same user in the same window may paste between ANY of their assignments
   (every assignment is guarded, so it can only hold their own work).
2. **Own sandbox work → assignment:** refused, always. Students prototype in the question canvas.
3. **Nothing leaves an assignment:** yes — copying out to another app yields nothing.
4. **Record and detection:** the student sees a message; no log of refused pastes is kept;
   similarity flags go into task 031's design (added there as item 12).
5. **Group work:** each member rebuilds the shared solution in their own session.

## Verify
- Gates: both `tsc`s, build, `npm run check` with `pasteCheck` and the grep gate.
- Browser, local mode: build a circuit in the sandbox, copy it, open HW1 P1, paste: refused
  with a message. Copy in P1, paste in P2: allowed; copy in HW1, paste in HW2: allowed. Paste text
  from another app into the open response and into a fill-in blank: refused. Copy a sentence
  inside the open response and paste it back: allowed. Copy in an assignment and paste into
  another app: nothing arrives. Sign out, sign in as another user, paste: refused (task 032).
  `window.__store` is undefined in `npm run build && npm run preview`.
- Owed: mobile Safari and Chrome paste behaviour on a real phone.

## Progress log

### 2026-09-23 — implemented (work loop)
**Built.** In an assignment, a paste (canvas or answer field) now takes only what this user
copied inside one of their assignments in this window; anything else is refused with a short
notice naming the rule. The sandbox is free, as before. One seam, `app/src/provenance.ts`: a
module-memory clipboard with a canvas slot and a text slot, each item stamped `{scope, user}`
(+ canvas kind), the pure `canPaste` policy, `canvasPasteVerdict` (policy, then canvas kind,
then `allowed_components` recursing into BOXED; a sandbox target skips all three),
`textPasteVerdict`, `refusalMessage`. `app/src/usePasteGuard.ts` is the one DOM adapter
(copy / cut / paste / drop / dragstart / `beforeinput`) worn by the open response, the fill-in
blanks and both box-rename fields; a guarded copy writes only `''` plus an opaque copy id
(`application/x-makingminds-copy`, no content) to the system clipboard, and a paste inserts
the slot's text, never the system clipboard's. The store's `clipboard` state is gone
(`copySelected`/`paste` go through the seam; a refused paste leaves no undo entry);
`resetForPrincipal` empties the seam, a canvas swap never does. `window.__store` is dev-only;
`importProject` (and the dead `boxedLibrary`/`importBoxedCircuit`/`boxCurrentCircuit`) removed.
Law 8 added to PROFILE §8 and CLAUDE.md "Critical design rules"; CLAUDE.md trimmed to 39973 B.

**Decision (Gabriel, 2026-09-23):** problem-statement text is NOT pasteable
into an answer. Only the answer fields are guarded (Done-when 3); statement copying stays
native (the PDFs are public), so pasting it into an answer is refused like any outside text.
No page-wide copy listener. (The loop session proposed this from Done-when 3; Gabriel confirmed it.)

**Pins.** New `app/tools/pasteCheck.ts` (85 checks, in `npm run check`): [policy table],
[canvas verdict] (mode mismatch, OR into a restricted question, boxed-OR recursion, sandbox
free), [text verdict] (copy id / other-window / outside / image-since), [input types],
[store paste] (sandbox → HW refused with no undo entry; Q1 → Q2 and HW-A → HW-B accepted;
FSM → CC refused; FSM → sandbox tab accepted; locked no-op; principal change), [grep gate]
(no clipboard API outside the hook; every `components/*.tsx` text field guarded, bare
`readOnly`, or a counted exemption — mutation-tested), [console hole]. `navResetCheck`'s
principal-change pins now read the seam's two slots.

**Gates (exit codes):** app tsc 0 · app build 0 · app `npm run check` 0 · server typecheck 0 ·
server check 0. Fresh `dist/` has no `__store` string (proxy for the production check).

**Review findings — fixed:** (1+4) sandbox verdict now returns ok before policy/kind/allowed
checks, as Done-when 1–2 say; (2) a stale text slot no longer pastes silently after a copy in
another window — the copy id; (3+5) the answer-field gate checks each field, not each file;
CLAUDE.md Provenance row wording. **Skipped:** none. **Known limit:** a browser that drops
custom clipboard types loses the id, so after a copy in another window the stale slot can
still paste (never outside content) — documented at `textPasteVerdict`.

**Owed (not claimed):** the Verify browser pass with screenshots (Done-when 7) — canvas
sandbox → HW1 P1 refused; P1 → P2 and HW1 → HW2 accepted; OR into P2 refused naming OR;
FSM → CC refused; open response + fill-in: own copy → paste works, outside text / statement
text / drag refused; box rename refused; nothing reaches the system clipboard; sign out → other
toy account → paste brings nothing; `npm run build && npm run preview` → `window.__store`
undefined (still defined in dev); notices sit in the editor vocabulary without overlapping
validation warnings; a real two-window copy to confirm the copy id survives. Owed to Gabriel:
iOS Safari / Android Chrome long-press paste (keyboard clipboard-suggestion chips arrive as
IME typing and cannot be told apart — a stated limit).

**Next step:** loop session: visual check (owed browser pass above, screenshots into this
log), then land per PROFILE §5.

### 2026-09-23 — browser pass and land (work loop)
- **Browser, local mode (dev server :5173, John Doe, HW1/HW2/HW4 published), all passed.**
  Canvas, driven by real Cmd+C / Cmd+V keys, with in-app hash navigation and no page reload:
  - (a) An AND copied in the sandbox and pasted into HW1 P1 was refused with "Not pasted: that was copied in the
    sandbox…". Nothing was added and no undo entry was recorded.
  - (b) An AND copied in HW1 P1 pasted into P2, and the same clip pasted into HW2 P1. Both were accepted.
  - (c) An OR copied in HW1 P1 and pasted into P2 was refused with "this question doesn't allow OR".
  - (d) An FSM state from HW4 P3 pasted into HW1 P3 was refused with "state-machine parts can't go on a
    logic-circuit canvas".

  Text fields (the pane's synthetic keys don't fire native clipboard events, so real
  `ClipboardEvent`s were dispatched):
  - Open response (HW1 P6): a copy writes only `''` plus the opaque copy id, so nothing leaves. Pasting
    the field's own copy inserted the text. Outside text, statement text, a drop and a `beforeinput`
    insertFromPaste were all refused, and the footer notice appeared in blue beside the word count.
  - Fill-in (HW1 P11): a copy from blank 0 pasted into blank 1. Outside text was refused with the notice.

  Principal change: after John logged out and Ada signed in on the same page, a paste into HW1 got
  "Nothing to paste", so the seam was cleared.

  Production: the built bundle has no `__store` string and does carry the paste guard.
  In dev, `window.__store` still exists. A full page load also empties the clipboard, as designed
  ("in this window" means this page load).
- **Seen in passing, dev only.** John's sandbox from task 032's check came back empty after this
  tab had lived through about 50 minutes of Vite hot updates to `store.ts`. That is a module
  re-evaluation inside a live page, which can't happen in production. With full loads, the same
  flow (Home, log out, Ada in and out, John back) kept his sandbox intact. Not pursued.
- **Still owed to Gabriel:** real-phone paste on iOS Safari and Android Chrome (Verify), plus a
  copy between two real browser windows to confirm the custom clipboard type survives.
- Landed via a merge into `main`.
