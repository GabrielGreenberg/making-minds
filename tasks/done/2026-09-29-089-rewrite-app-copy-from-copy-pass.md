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
status: done
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

**Owed, not claimed (2026-09-30, robot run):**
- Gabriel's eyeball of the student surfaces. Checked headlessly instead (recipe: `npm run
  build`, serve `app/dist` in local mode, drive headless Chrome over CDP: sign in as Prof.
  Ada, Load HW1–HW7, publish all, set HW1's `dueDate` past in `mm:inst-asg:<id>`, sign in
  as John Doe, submit HW1 from Home, then shoot Home, Submit, Grades, Feedback, the
  assignment page, the editor and the visitor sandbox at 1200×800 and 375×812).
- The pilot, after release: sign-in "Set up your account" and "Ask to be added to the class
  roster" links; a wrong sign-in five times (c0109 "Too many sign-in attempts. Wait a few
  minutes and try again."); a setup without a UID (c0104) and with a taken email (c0108);
  deleting an assignment with submissions from the Dashboard (c1018: "Students have
  submitted this assignment. Hide it instead of deleting it."); a roster import with a
  UID conflict (c1013 "(row not imported)").
- The review fixes (next progress entry), unseen in a browser: the Grades sheet's failed-case
  lines with a grader reason ("arena #1: … N (exceeded max steps)"; a released grade with a
  failed case), the Queue's "Being graded" note with two claims, and the Matrix flag tooltip.

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
- 2026-09-30 — Applied (robot). All 260 rows: 257 rewrites and 3 cuts. A scratch verifier over
  `copyCensus` found each row's new text at its location and none of the old (260/260, 0
  left), and every string changed since `main` maps to a row id. Most rows went in by a
  scripted replace inside the literal; about 35 by hand (the JSX that spans elements, the
  `+` chains, `submitConfirmMessage`, the GradeSheet foot, the Matrix flags). Two
  neighbouring rows the script crossed (c0301/c0302, c0758/c0759) were caught by the
  verifier and redone. Structure: the frozen notice is one wording in `dueDates.ts`
  (`FROZEN_NOTICE` for the sentence, `FROZEN_BADGE` for "🔒 Past due. Your submission is
  read-only.", used by Home, the assignment page, the question panel and the top bar), and
  c0123 is `authProvider.tsx`'s `UNREACHABLE` (`describeError` lost its fallback
  parameter). The c0163 cut took the dead `usedFallback` prop off `WireView` and the wire
  data (the router's `WireRouteResult.usedFallback` stays, `routerCheck` pins it).
  Suggested rows judged in place and kept: c0994 ("Columns used. Email: …"), c0061/c0062
  (the banner's "This run" row already says what runs). No suggested row needed a fix. One
  small deviation: `tools/grade.ts` prints "open question (needs manual review, N words)".
  Post-pass copy: none. `copyCheck` flags nothing added since `e2c7f12` (087/088's copy is
  clean). New `app/tools/copyCensus.ts` (the AST census, `collectCopy`, TSV when run) and
  `copyCheck.ts` (R1 dash, R2 semicolon, R3 double space; tripwire, sweep, pins, wiring;
  after `themeCheck` in `npm run check`), with 11 `EXCEPTIONS`: 6 rows the pass kept
  (`lateLabel`'s "; n waived", "✓ passes — pose", two GradingQueue labels, two
  StudentSubmissionView labels), `INTEGRITY_NOTICE`, formulaEval's generated code, two
  header values and a `db.ts` internal throw. Pins moved to the new words: navResetCheck,
  caseRunCheck, workbenchCheck, notationCheck, pipelineCheck, provenanceCheck (plus: the
  confirmation is 3 paragraphs, the second the grading rule; the flag details carry their
  evidence and no dash), routingCheck, robotStatusCheck fixtures, rosterCheck,
  gradingCheck (`/Hide it/`), `grade.ts`; the `types.ts` flag comment. Docs:
  VISUAL_VOCAB §Copy (rules, examples, the gate, the allowlist, the census) and the stale
  §Page surfaces quotes; CLAUDE.md in place (Page surfaces row, Tools row, a Copy line in
  Critical design rules, "Set up your account"; 39,958 bytes). Gates: app tsc 0,
  typecheck:tools 0, build 0, `npm run check` 0; server `npm run check` 0. Headless look
  (recipe under Verify): every shot free of horizontal scroll; the new text reads as
  written on Home, Submit (3 paragraphs), Grades, Feedback (both intros), the assignment
  page, the question panel and top bar (frozen), the visitor banner and sign-in. Seen in
  passing, not new: at 375px the editor's top bar overlaps its crumbs, because its right
  side never shrinks (`.wb-topbar-right`) and the editor is not laid out for phones; no
  overlap from 700px up. Next step: land.
- 2026-09-30 — Review fixes (robot). The review found copyCheck blind to a dash that opens
  or closes a fragment (`{x && ' — dry run'}`, `<> — {why}</>`) and to joiners with no
  letters of their own (`` `${a} — ${b}` ``, `.join('; ')`), so six rows this pass rewrote
  (c0045, c0509, c0686, c0692, c0715, c0895) could come back unflagged. It also found
  suggested rows that still break rules 1–2 in place through the expression they wrap, so
  the earlier "No suggested row needed a fix" was wrong. Applied (old → suggested → applied):
  - c0660 Queue "Being graded": `{label} — {by}` claims joined by '; ' → suggested fixed
    only "idle; nothing" → "Response 3 by Prof. Ada, Response 7 by TA Bob. Claims lapse…".
  - c0606 integrity "unaccounted": "The answer has {parts.join('; ')} — to look at." →
    "The answer has {parts.join('; ')}." → parts joined by ", and ".
  - c0575 group-mismatch detail: "listed by a classmate; no submission" → "listed by a
    classmate but has not submitted" (still joined to its siblings by '; ') → joined by ", ".
  - c0044 / c0045 Grades sheet: the arena and film lines kept "— {c.reason}" → " ({c.reason})".
    The value-case line (not a row) takes the same form, so the sheet reads one way.
  - c0633 Matrix "Flags (to look at, not verdicts): {flagTip(r)}": the tip rendered
    "detail — names" → "detail (names)". The flag chip's tooltip (GradingParts, the same
    fact) follows.
  Gate: R1 now takes the item's edge as a side (a fragment's open end is where the sentence
  goes on), holds joiners and bare separators (`' — '`), and exempts only a dash-wrapped
  label that is its whole item ("— none —"). R2 likewise takes the edge (`.join('; ')`).
  The rules run on every census item, not only prose-shaped ones, and an exception covers
  one hit. Tripwire: 7 new checks over 13 new synthetic strings, the review's shapes among
  them. The widened sweep found 24 new hits: 9 fixed above, 15 allowlisted (26 `EXCEPTIONS`
  now). Those 15 are two rows the pass kept ("— Robot tab", and the Matrix legend's "—" cell, not punctuation), statementProse's `;`
  row syntax, and 12 joiners the pass never listed (they have no letters, so the census
  didn't show them): turbotOutcome's ✗ branch, problemVerdict's "1 point — 5/5", the Matrix
  column tooltip, the roster import line's "; {status}", the who-left list (dashboard and
  CLI), statusCountText, the submission page's waiver note and failed-case reason, the grade
  history note, "Still open: …; …", and releaseLine's '; '. Left for the next copy pass.
  VISUAL_VOCAB §Copy says a fragment is read where it lands. Gates below. Next step: land.

### 2026-09-29 — implemented (work loop)
- **Built.** The app's on-screen copy now reads as Gabriel's copy pass decided: all 260
  attachment rows (257 rewrites, 3 cuts) at their locations, server replies changed where
  they are set, and the frozen notice as one wording (`dueDates.ts` `FROZEN_NOTICE` /
  `FROZEN_BADGE`). The house style is written down (VISUAL_VOCAB §Copy, a CLAUDE.md
  pointer) and held by the new `copyCheck` (on `copyCensus`'s AST census, in `npm run
  check` after `themeCheck`): R1 dash, R2 semicolon, R3 double space; fragments and
  joiners read where they land; 26 one-hit `EXCEPTIONS`, each with a reason.
- **Pins.** copyCheck tripwire (the review's fragment / joiner / `.join('; ')` shapes),
  sweep, exception liveness, wiring. Copy pins moved to the new words: navResetCheck,
  caseRunCheck, workbenchCheck, notationCheck, pipelineCheck, provenanceCheck,
  routingCheck, robotStatusCheck, rosterCheck, gradingCheck, `grade.ts`.
- **Gates (exit codes).** app tsc 0, app build 0, app `npm run check` 0 (copyCheck all
  green), server tsc 0, server check 0.
- **Review.** Fixed 1+3 majors/minors and the widened-gate joiners (entry above:
  c0660, c0606, c0575, c0044/c0045, c0633). Skipped: none. Nits left alone: CLAUDE.md
  lost a few true, unrelated facts to stay under 40 KB (the Notes `marked` + `dompurify`
  sanitizer pointer is the one worth restoring); `deploy/README.md:293` still quotes the
  old roster-report heading "no longer on the class list — review".
- **Owed.** The headless visual check (required to land): student Home / Grades /
  overview / editor / Submit / Feedback / visitor at 1280 and 375; the past-due and
  viewing states; the review fixes' reason parentheses, two-claim Queue note and Matrix
  flag tooltip; the instructor surfaces once. To Gabriel on the pilot after release: the
  remote-only strings (sign-in setup pane, claim errors, throttle, Roster & accounts,
  Robot tab, re-grade dialog, Password panel).
- **Next step.** Loop session: the headless visual check, then land per PROFILE §5.

### 2026-09-30 — landed (robot)
- **Headless visual check (required to land): passed.** The app ran from Bash (Vite on
  :5190), and headless Chrome was driven over CDP (a scratch script seeding LOCAL mode as
  `shootProblemSets.mjs` does). Checked at 1280 and 375 as the toy student:
  - Home has no intro, and the up-next line reads "· submitted <date>. You can submit
    again until then".
  - Grades has no intro. With HW1 released, the sheet foot reads "Grade 40 / 100 (0 of 23
    points, scaled as 40 + 60 × 0/23). 9 problems still awaiting review. The grade may
    rise."
  - The editor's top-bar tooltips read as the attachment says.
  - The Submit dialog has its 3 paragraphs and the group line, and "Attempt 1 is
    recorded." after submitting.
  - Feedback shows the student intro (the parenthesis wraps cleanly at 375) and the
    instructor intro ("File a report here, with the instructor tag.").
  - Signed out, "Continue as visitor" is still a link.
  - Past due after a submission: Home shows the "🔒 Past due" tooltip, and the overview
    and editor show "🔒 Past due. Your submission is read-only." with the FROZEN_NOTICE
    title. The top bar fits at 1024 and 800 because the title truncates.
  - No horizontal overflow on any checked page at 375, and no console errors.
  - The editor's top bar is cramped at 375 with or without the new text. That was already
    so on `main` (the editor is not a phone surface).
- **Fixes of mine.** The review's two nits: CLAUDE.md gets back the Notes `marked` +
  `dompurify` pointer (39,982 bytes, under 40,000), and `deploy/README.md` now quotes the
  roster heading "no longer on the class list". These are docs only, and `origin/main` had
  nothing new, so the workflow's gates stand (app tsc/build/check 0, server tsc/check 0).
- **Owed, not claimed.**
  - Gabriel's own eyeball in the browser pane (Vite Dev Server, :5173), on the same routes
    as above.
  - The instructor surfaces, once: Grading › Matrix legend and flag tooltips, a
    submission page's Integrity and ½ lines, the Question creator's fill-in and numeral
    help, the assignment editor's labels, and the Dashboard's delete-a-submitted-HW alert.
  - On the pilot after release, the remote-only strings: the sign-in setup pane, claim
    errors, the throttle reply, Roster & accounts, the Robot tab, the re-grade dialog and
    the Password panel.

