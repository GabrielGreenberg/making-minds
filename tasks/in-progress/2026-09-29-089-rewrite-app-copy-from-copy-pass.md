---
id: 2026-09-29-089
type: chore
title: Rewrite the app's on-screen copy from Gabriel's copy pass, and hold new copy to the house style
priority: normal
size: large
requires: browser
area: app
source: chat
created: 2026-09-29T08:00:00-07:00
status: ready
after:
branch:
merged_into:
---

## Description
Much of the app's on-screen text reads as LLM-written: em-dash asides, semicolons, a colon
before the point, two sentences where one would do, and text that explains the machinery
("it joins the Feedback queue with the instructor tag"). Paul flagged some examples in the
shared Notes (2026-09-29, "LLM-isms on the site"):
- **Assignments** intro (`HomeScreen.tsx:84`): replace the em dash, commas and semicolon
  with full stops.
- **Grades** intro (`GradesView.tsx:45`): "Your results for each homework. Click on a row
  for details." Or cut the second sentence.
- **Feedback** intro (`FeedbackPanel.tsx:99`, the instructor version): "A problem or an idea
  about the platform or homework? Let us know/file it here." The student version on line 104
  fills the same slot.

Paul's other items (landing-page table cells, the Policies → Problem sets wording, the
"length varies" bullet) are on the **course website**, not in this repo. They are out of
scope here.

Gabriel asked for an exhaustive list so that he can rewrite it himself. On 2026-09-29 a
script pulled every prose-shaped string from `app/src` and `server/src` (at `e2c7f12`) using
the TypeScript AST. It took JSX text flattened per element, string and template literals,
string concatenations, and the `title` / `placeholder` / `aria-label` / `alt` attributes.
It dropped class names, SQL, console output, `devData/` and the CLIs. That gave **1,112
items**, grouped by screen: student pages 84, sign-in 67, editor 199, machine checks 78,
sandbox 59, instructor 528, server replies 19, developer-facing 78. Gabriel reviewed them on
the private **Making Minds Copy Pass** page (https://claude.ai/artifact/BLwAy4V9PFQz6vVPHAV1Qq).
A worker does not need the page.

**The rows to change are in `tasks/attachments/2026-09-29-089-1-copy-decisions.md`**, the
source of truth for this task. It lists 13 rows Gabriel decided himself and 247 that Claude
drafted from his rules (246 rewrites and 1 cut). Each row has `### <id> · REWRITE|CUT ·
Gabriel|suggested`, then `where:` (screen and `file:line` at `e2c7f12`), `old:` and, for a
rewrite, `new:`. Every row not listed stays as it is.

### The house style (from Gabriel's first 13 decisions, 2026-09-30)
Gabriel rewrote 13 rows himself (Home, Grades, Feedback, the past-due notice). They are
recorded below under Resolved decisions. The rules they show:
1. No em or en dashes as punctuation. Split at the dash into two sentences, or drop the part
   after it if it only explains.
2. No semicolons. Full stop instead.
3. Cut page intros that explain what a page is for when the page makes it obvious.
4. Don't describe the machinery (queues, tags, canvases, snapshots). Say what is true for the
   reader ("Your submission is read-only.").
5. No rhetorical-question openers. Use a plain statement or instruction.
6. Confirmations are short: "Filed." "Thank you."
7. Errors: what went wrong, then what to do, in short sentences.
8. Side information goes last in parentheses, or goes.
9. No colon-then-reveal inside a sentence. A colon after a short label ("Free end:") stays.
10. Leave text that already works. Short labels and plain messages mostly stay.

Claude applied these rules to every other row except the developer-only group: 1,021 rows,
giving 246 rewrites and 1 cut, with the other 774 left unchanged. Gabriel released that
extrapolation to be applied (Resolved decisions).

## Done when
- Every `REWRITE` in the attachment is in the app at its location, with `{…}` placeholders
  wired back to the same expressions. Line numbers may have drifted since `e2c7f12`, so
  locate each row by its `old:` text.
  - `Gabriel` rows are applied verbatim, with single spaces after full stops.
  - `suggested` rows are applied as written. If one reads wrong in place or breaks a rule,
    fix it and list the fix in the progress log as old → suggested → applied.
- Every `CUT` is removed, and the surface still reads and lays out correctly without it (no
  empty `<p>`, no orphaned label, no dangling separator).
- Rows not in the attachment are unchanged.
- The house style is written down where future copy will meet it:
  `docs/buildout/VISUAL_VOCAB.md` gets a §Copy section and CLAUDE.md gets a one-line pointer.
  `copyCheck` in `npm run check` enforces the mechanical rules (for example, no em dash or
  semicolon in user-facing strings), with an explicit allowlist for any exceptions.
- All gates are green. Harness checks that assert on copy strings are updated to the new
  text.

## Design
- **deepFix:** Apply the decisions, then stop the class from coming back. The style lives in
  VISUAL_VOCAB, which every UI task already reads. `copyCheck` is built on the same
  AST extraction as the pass: a committed `app/tools/copyCensus.ts` lists user-facing
  strings and fails on the house style's mechanical rules. New copy then meets the rules at
  `npm run check`, the same way `themeCheck` holds colours.
- **surgicalFix:** Apply the attachment only. The next feature brings the em dashes
  back.
- Seams: none. This is text only, except the few rows that are thrown `Error` messages or
  server replies (`server/src/app.ts`, `identity.ts`, `password.ts`) that the client shows
  as-is. Change those on the server, where the text is set.
- Watch: `SubmitDialog` and the late-cost copy (`dueDates.ts submitLateWarning`,
  `provenance/notice.ts submitConfirmMessage`) are built from pieces. Rewrite the whole
  sentence, not its fragments. `routingCheck`, `navResetCheck`, `pasteCheck` and
  `dueDateCheck` pin some strings.
- Found while drafting the suggestions:
  - `app/tools/notationCheck.ts:344` pins the old phrase "has a 1-bit input symbol; this
    question has 2 input wires".
  - `app/tools/grade.ts:65` prints its own copy of the grader's "open question — needs
    manual review" text.
  - The submit confirmation (`provenance/notice.ts submitConfirmMessage`) is split on `\n\n`
    into paragraphs. Keep the same three parts.
  - The Dashboard's "students have submitted this assignment — hide it…" text is also
    returned word for word by `server/src/app.ts:621`. Change both.
  - Two Grading › Matrix strings (the flag tooltip and the legend) hold a `\n` or a nested
    `<span>⚑` that the page shows flattened.
  - The roster import appends "— row not imported" to the server's UID-conflict reasons
    (`rosterImport.ts:52`). Rewrite that join too.
  - Server replies reach the client with the first letter capitalised
    (`authProvider.tsx:192`). A two-sentence reply needs its own closing full stop.

## Verify
`npm run check` (and `npx tsc -p tsconfig.app.json --noEmit` plus `npm run typecheck:tools`
in `app/`). In the browser preview, look at each student surface that changed: Home
(Assignments, Grades), the assignment page, the editor's top bar and hint line, Submit,
Feedback and sign-in. Check wrapping at phone width. Remote-only strings (server replies,
sign-in claim errors) are owed a look on the pilot after release.

### Resolved decisions
Gabriel's rewrites, 2026-09-30 (row id · `file:line` at `e2c7f12`):
- c0001 `HomeScreen.tsx:84` Assignments intro: **cut**.
- c0002 `HomeScreen.tsx:102` → "· submitted {date}. You can submit again until then"
- c0006 `HomeScreen.tsx:162` (title) → "The due date for this assignment has passed. Your
  submission is now read-only."
- c0008 `HomeScreen.tsx:178` → "Couldn't load assignments. The server may be unreachable."
  + Retry
- c0009 `GradesView.tsx:45` Grades intro: **cut**.
- c0010 `GradesView.tsx:54` → "Couldn't load your grades. The server may be unreachable."
  + Retry
- c0015 `FeedbackPanel.tsx:65` → "Could not attach that image. Try a different file."
- c0018 `FeedbackPanel.tsx:85` → "Could not send feedback. Try again in a moment."
- c0019 `FeedbackPanel.tsx:99` (instructor intro) → "File a report here, with the instructor
  tag."
- c0020 `FeedbackPanel.tsx:104` (student intro) → "Report a bug or technical problem with the
  homework here. (For issues relating to the class, contact your instructor directly.)"
- c0021 `FeedbackPanel.tsx:112` → "Filed."
- c0022 `FeedbackPanel.tsx:112` → "Thank you. An instructor will take a look."
- c0028 `AssignmentOverview.tsx:123` → "🔒 Past due. Your submission is read-only."

2026-09-30, Gabriel: no more decisions of his own. The rules extrapolated from his 13 are
to be applied as drafted (the attachment's `suggested` rows). The task is released for the
robot to take.

## Progress log
- 2026-09-29 — Filed from chat. The copy pass is published with 1,112 items and Paul's three
  flagged. Waiting on Gabriel's decisions. Next step: read them (paste or `ArtifactData`),
  release to `incoming/`, apply.
- 2026-09-30 — Gabriel decided 13 rows (Resolved decisions). The house style above was
  derived from them. Six agents drafted suggestions for the other 1,021 rows, and the page was
  republished with them (Version 2). Still waiting on Gabriel. Next step: unchanged.
- 2026-09-30 — Released. Gabriel has no more decisions and wants the extrapolated rules
  applied. His 13 rows and Claude's 247 suggested changes were written to
  `tasks/attachments/2026-09-29-089-1-copy-decisions.md`, which is now the source of truth.
  Next step: claim, then apply the attachment row by row (student surfaces first). Then
  write VISUAL_VOCAB §Copy and `copyCheck`, update the pinned strings in the harness, and
  run the gates.
