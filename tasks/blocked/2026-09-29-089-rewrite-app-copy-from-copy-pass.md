---
id: 2026-09-29-089
type: chore
title: Rewrite the app's on-screen copy from Gabriel's copy pass, and hold new copy to the house style
priority: normal
size: large
requires: human
area: app
source: chat
created: 2026-09-29T08:00:00-07:00
status: blocked
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
sandbox 59, instructor 528, server replies 19, developer-facing 78. They are on the
**Making Minds Copy Pass** page (https://claude.ai/artifact/BLwAy4V9PFQz6vVPHAV1Qq, private
to Gabriel). Each row shows the text, where it appears, `file:line` and the code around it,
with a field for Gabriel's version. Rows can also be marked Keep or Cut. A "House style" box
holds rules for the rows he doesn't rewrite. **Copy decisions** exports all of it as plain
text:

```
HOUSE STYLE:
<rules>

### c0001 · REWRITE
where: Home › Assignments tab · app/src/components/HomeScreen.tsx:84
old: <the current text; {…} marks an interpolated value>
new: <Gabriel's text>
```

`KEEP` and `CUT` blocks have no `new:` line. The page's database holds the same decisions,
so a worker can also read them with `ArtifactData list` (collection `copy`, and `meta/style`
for the house style).

## Done when
- Every `REWRITE` is in the app verbatim at its location, with `{…}` placeholders wired back
  to the same expressions. Line numbers may have drifted since `e2c7f12`, so locate each row
  by its `old:` text.
- Every `CUT` is removed, and the surface still reads and lays out correctly without it (no
  empty `<p>`, no orphaned label, no dangling separator).
- `KEEP` rows are unchanged.
- Undecided rows on **student-facing** surfaces (groups: student pages, sign-in, editor,
  machine checks, sandbox) follow the house style. Every such change is listed in the
  progress log as old → new, for Gabriel to look over before landing. Instructor and
  developer rows he left undecided stay as they are unless he says otherwise.
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
- **surgicalFix:** Apply the pasted rewrites only. The next feature brings the em dashes
  back.
- Seams: none. This is text only, except the few rows that are thrown `Error` messages or
  server replies (`server/src/app.ts`, `identity.ts`, `password.ts`) that the client shows
  as-is. Change those on the server, where the text is set.
- Watch: `SubmitDialog` and the late-cost copy (`dueDates.ts submitLateWarning`,
  `provenance/notice.ts submitConfirmMessage`) are built from pieces. Rewrite the whole
  sentence, not its fragments. `routingCheck`, `navResetCheck`, `pasteCheck` and
  `dueDateCheck` pin some strings.

## Verify
`npm run check` (and `npx tsc -p tsconfig.app.json --noEmit` plus `npm run typecheck:tools`
in `app/`). In the browser preview, look at each student surface Gabriel rewrote: Home
(Assignments, Grades), the assignment page, the editor's top bar and hint line, Submit,
Feedback and sign-in. Check wrapping at phone width. Remote-only strings (server replies,
sign-in claim errors) are owed a look on the pilot after release.

## Questions
1. Gabriel: work through the Copy Pass page
   (https://claude.ai/artifact/BLwAy4V9PFQz6vVPHAV1Qq), then paste the **Copy decisions**
   output into `/catch` or `/work`, or just say "done" and the worker reads the decisions
   from the page's database. Fill in the House style box too: those rules decide the rows
   you don't rewrite.

## Progress log
- 2026-09-29 — Filed from chat. The copy pass is published with 1,112 items and Paul's three
  flagged. Waiting on Gabriel's decisions. Next step: read them (paste or `ArtifactData`),
  release to `incoming/`, apply.
