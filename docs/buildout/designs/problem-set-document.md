# Problem-Set Document: Model the Page, Not the List
_Status: accepted · 2026-09-22 · Task: 2026-09-21-020_

## 1. Problem family, and why now

A homework is a **document** — the PDFs under `problem sets/` have a title and date, a
preamble, sections with an intro sentence that carries the instruction for a whole run of
problems ("Design SCs that compute the following functions."), continuously numbered
problems that are often one line ("3. +1 T") or a bold title over a truth table laid out
three per row, boxed callouts (Hint / Challenge problem / Advice! / Caution!) that belong to
a section or a problem, and figures. The app models an assignment as a flat
`questions[]` of gradeable units, so none of that has a home in the data: the HW1–HW7
transcription had to flatten every problem into self-contained prose, section intros vanished
or were folded into a first problem, shared hint boxes became per-question `hint`s or were
dropped, figures became words, and the overview renders "Problem N · chip · two clipped grey
lines" — Gabriel's verdict: not functional for a person. The same missing level explains why
the in-editor statement panel cannot show a problem's context (its section's instruction),
and why an instructor cannot author any of it.

## 2. Decision

**Add the document level to the data and render it once.** `AssignmentData` gains
`preamble?`, `sections?: AssignmentSection[]` (`{ heading, intro?, questionIds, callouts?,
figures?, layout? }`) and `sourcePdf?`; `AssignmentQuestion` gains `callouts?` and
`figures?`; a `Callout` (`kind` hint · challenge · advice · caution · note, optional title,
statement-markup `body`, `placement` before · aside · after, own `figures?`) and a `Figure`
(`src` = data URL or a path under the app's public root, `alt`, `caption?`, `width?`,
`placement?`). `questions[]` stays flat and stays the grading unit: the grader, submissions,
workbooks and `sanitize.ts` are untouched (the server stores the JSON as-is and strips only
the three answer-key fields).

A pure module `src/problemSet.ts` owns the semantics — `documentSections()` normalises
(no `sections` → one unnamed section; questions in no section → a trailing unnamed one, so an
added question is never lost), `problemNumber()` numbers continuously, `problemShape()`
classifies compact / table / full problems so runs of compact problems flow in columns and
truth tables in a 3-up grid (`layout` overrides), `validateDocument()` reports the invariants
`statementFormatCheck` pins. `components/ProblemSetDocument.tsx` renders the document for the
overview and exports `ProblemBody` / `ProblemContext`, which the three editor panels
(`DataTable`'s QuestionStatement, `FillInPanel`, `OpenResponsePanel`) render instead of their
own title + statement + hint, so a PDF-style problem ("NAND" + table) reads correctly on its
own canvas under its section's instruction. `statementFormat` gains bulleted lists and the
PDFs' `a.` sub-part form. Turbot questions render their arena live from `turbot_cases` rather
than as a figure. `AssignmentEditor` authors sections, the preamble, callouts and figures;
`QuestionCreator` the per-question callouts and figures (one shared editor widget each).

## 3. Rejected: embed the PDF

`<object data="/problem-sets/hw1.pdf">` beside a compact list gives instant fidelity but is
static (page numbers, last year's dates), not clickable per problem, gives the editor nothing,
and gives instructor-authored assignments nothing. Its cheapest part survives: an "Original
PDF" link when `sourcePdf` is set.

## 4. Seams and gates

Data: `types.ts` + the `AssignmentStore` seam (both backends carry JSON as-is; a
`serverCheck` pin proves the student copy keeps `sections`/`preamble`). Markup:
`statementFormat.ts`. Rendering: one component shared by the page and the editor; styling in
`pages.css` through `--mm-*` tokens (`themeCheck` lists the new component). Content: HW1–HW7
re-transcribed to the PDFs' structure; the seeded figures are SVG crops of the PDFs under
`app/public/problem-sets/` beside the PDFs themselves (readable JSON; a public path resolves
against the app's base URL in either backend), instructor uploads are size-capped data URLs.
Pins: `statementFormatCheck` (sections partition the ids, callout kinds, figure sources
resolve, every HW parses and renders to prose), `pipelineCheck`, `remoteStoreCheck`, server
`parityCheck`. Visual proof: every HW beside its PDF at 1280 and ~700 wide.
