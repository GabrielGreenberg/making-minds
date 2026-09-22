---
id: 2026-09-21-020
type: feature
title: Render an assignment as a readable problem-set document modelled on the HW PDFs
priority: high
size: large
requires: browser
area: app
source: chat
created: 2026-09-21T17:10:00-07:00
status: in-progress
after: 2026-09-21-023
branch: task/020-problem-set-document-view
merged_into:
---

## Description
Inside a homework the app shows a flat list of clickable rows — "Problem N · mode chip ·
statement clipped to two lines of 12px grey" — and Gabriel's verdict is that it is "essentially
impossible to read … not functional for a person". He wants the in-app problem set to look, as
far as possible, like the original PDFs (`problem sets/hw1.pdf` … `hw7.pdf`, byte-identical to
`~/Documents/Academic/Teaching/Phil 133 - 2026f/making minds/HW/`). Provenance: chat, catch
session 2026-09-21; the PDFs were read during intake.

### What the PDFs do (the oracle)
- A blue sans **title** ("HW1. Basics: Circuits, Functions, and Representations") with the date
  top-right; sometimes a **preamble** ("Note: I have put key words in **bold** …").
- **Sections** ("I. Combinatorial Circuits", "II. Functions", …) — heading over a 1px rule, then
  an **intro sentence** that carries the instruction for the whole run of problems ("Design
  combinatorial circuits with the following input-output profiles:", "Design SCs that compute
  the following functions.", "For each of the following functions, is it possible …").
- **Problems numbered continuously** across sections, each "N. **Short title.** text"; short ones
  are one line ("3. +1 T", "4. 2x+1 B [Use one 2x circuit and one +1 circuit]"); truth-table
  problems are a bold title over a small IN/OUT table, laid out **three or two per row**;
  sub-parts a./b./c. indented on their own lines; bracketed constraints and margin notes
  ("<< For this problem, do not use OR-gates. *DeMorgan's Law* is useful here!").
- **Callout boxes**: *Hint:* (grey-lavender fill, often for a whole section), *Challenge
  problem:* (blue tint), *Advice!* / *Caution!* (boxed, bold heading, as a sidebar beside a
  column of short problems).
- **Figures**: the M/N schematic (HW1 §IV), the 8-input perception box (HW3 §II), the HA/MEM
  circuits of HW4 P1–P2, the 30×30 desert-ant arena (HW6), etc.
- Two-column layouts when problems are short (HW3 §I, HW4 §II, HW6's three problems).

### What the app does
`AssignmentOverview.tsx` maps `assignment.questions` to `<button>` rows (label, mode chip,
`statementProse` clamped to 2 lines — since 019 the rows are `.overview-row` / `.overview-statement` in
`app/src/pages.css:70–110`). Inside the editor the statement is
`QuestionStatement` (`DataTable.tsx:17–36`) at 12px `#444` in the right panel. The HW JSON was
transcribed to fit this: every statement was rewritten as self-contained prose ("Design a
sequential circuit that computes +1 in binary: the input stream carries …" for what the PDF
prints as "1. +1 B" under a section intro), section intros vanished or were folded into the
first problem (HW6 P1 holds the Goal/Assumptions block), shared hint boxes became per-question
`hint`s or were dropped, and every figure became words (HW4 P1: "The machine, drawn in the HW4
PDF: two half-adder stages in series …" — the subject of task 009).

### Root cause — the class
A problem set is a **document**, but the app models an assignment as a flat list of gradeable
questions (`AssignmentData` = id, title, dueDate?, order?, `questions[]`; `types.ts:282–294`;
`AssignmentQuestion` = label, title?, statement, hint?, grading fields; `:166–216`). Sections,
section intros, preambles, shared callouts, figures and layout have **no home in the data**, so
no renderer — overview or editor panel — can produce them, and the transcription had to
flatten the PDFs to fit. The markup layer (`statementFormat.ts`: paragraphs, `$…$`, code,
bold/italic, inline I/O profiles → tables, (a)/(b) parts) is sound; it is the level above it
that is missing.

## Done when
1. **Model.** `AssignmentData` gains optional document structure: `preamble?` (statement
   markup), `sections?: AssignmentSection[]` — `{ heading, intro?, questionIds, callouts? }` —
   and `sourcePdf?`; `AssignmentQuestion` gains `callouts?` and `figures?`. `Callout` =
   `{ kind: 'hint' | 'challenge' | 'advice' | 'caution' | 'note', title?, body }`; `Figure` =
   `{ src, alt, caption?, width? }` (`src` a data URL or a bundled asset path). An assignment
   with no `sections` renders as one unnamed section — every existing assignment and JSON
   stays valid unchanged. `questions[]` stays flat and remains the grading unit; the grader,
   submissions and `sanitize.ts` (which strips only the three answer-key fields,
   `server/src/sanitize.ts:38–48`) are untouched; parity stays green.
2. **Renderer.** A `components/ProblemSetDocument.tsx` renders an assignment the way the PDF
   reads: title + date/due, preamble, sections (heading, rule, intro), continuously numbered
   problems with bold titles, statements via `StatementBody`, lettered sub-parts, callouts as
   boxes styled per kind (sidebar placement on wide screens), figures with captions, and short
   or table problems flowing several per row. Each problem is a link to its canvas with an
   unobtrusive status mark in the margin (✓ done; the verdict once grades are released); the
   Submit row stays at the foot. `AssignmentOverview` uses it in place of the row list. An
   "Original PDF" link appears when `sourcePdf` is set.
3. **Editor context.** The in-editor statement panel (`DataTable.tsx` `QuestionStatement`,
   `FillInPanel.tsx:32–34`, `OpenResponsePanel.tsx:35–37`) renders the problem through the same
   problem component, with its section intro and attached callouts/figures shown as context,
   so a problem transcribed PDF-style ("NAND" + table) reads correctly on its own canvas.
4. **Content.** HW1–HW7 JSON re-transcribed to the PDFs' structure: sections and intros,
   preambles, every Hint/Challenge/Advice/Caution box (attached to its section or problem),
   every figure (extracted or redrawn — see Design), problem titles and statements following
   the PDF text (bracketed constraints kept), `sourcePdf` pointing at the PDF copied to
   `app/public/problem-sets/`. `statementFormat` gains whatever the PDFs need that it lacks
   (bulleted lists for HW6's Goal/Assumptions at least).
5. **Authoring.** `AssignmentEditor.tsx` (today: title, due date, drag-ordered questions) can add,
   rename, reorder and delete sections, edit their intros, assign questions to a section, write
   the preamble, and add callouts and figures (image file → size-capped data URL), so
   instructor-authored assignments get the same document.
6. **Gates.** `statementFormatCheck` extended: sections partition the question ids exactly,
   callout kinds valid, figure sources resolvable, every HW JSON parses and renders to prose;
   `pipelineCheck`, `remoteStoreCheck`, server `parityCheck` green. Every HW overview eyeballed
   beside its PDF at 1280 and ~700 wide; screenshots attached.

## Design
- **deepFix (recommended):** model the document (1), render it once (2) and reuse that renderer
  in the editor (3), re-transcribe the content to the PDFs (4), and let instructors author the
  same structure (5). Retires the class: the app can then show any problem set the way its
  author laid it out, not only these seven. Seams: `types.ts` + the `AssignmentStore` (data,
  both backends carry JSON as-is), `statementFormat` (markup), the renderer shared by overview
  and editor, the instructor editor. No engine, grader, store-slice or routing change.
- **surgicalFix:** embed the original PDF on the overview (`<object data="/problem-sets/hw1.pdf">`)
  beside a compact question list. Instant fidelity, but static (page numbers, old dates), not
  clickable per problem, no help inside the editor, nothing for instructor-authored
  assignments. Keep only its cheapest part — the "Original PDF" link — inside the deep fix.
- **Figures:** extract vector art from the PDFs (`pdftocairo -svg` or `mutool draw -o x.svg`,
  then crop) or redraw the small ones as SVG; store as data URLs in the JSON (cross-backend,
  no upload endpoint) capped ~200 KB each. HW6's arena can instead render live from
  `turbot_cases` via `ArenaCanvas` — preferable for turbot questions.
- **Layout idioms to reproduce** (typography itself comes from task 019's tokens — serif
  headings, accent colour — or, if this lands first, from a self-contained CSS section written
  against the reference vocabulary in 019's description so 019 later only swaps tokens):
  hanging problem numbers; a./b./c. indented; callout kinds — hint (grey-lavender fill),
  challenge (blue tint), advice/caution (boxed, bold heading; aside on wide screens); table
  problems in a 3-up grid; short-problem runs in two columns (`grid-auto-flow: row dense`
  or CSS columns); figures centred with a caption.
- **Assumptions recorded at intake (Gabriel to confirm; none blocks starting):**
  (a) the document replaces the row list entirely — the overview IS the problem set;
  (b) statements are re-transcribed to follow the PDFs (HW1 P1 becomes "NAND" + table under
  the section intro) instead of today's self-contained prose, and the editor shows the intro
  as context;
  (c) status marks live in the margin, never inside the problem text;
  (d) seeded homeworks carry an "Original PDF" link.
- **Relationship to 019 / 021 / 023 (updated 2026-09-21 evening):** 019 Phase A and 021 (Phase B)
  have LANDED — build on `app/src/theme.css` (`--mm-*` tokens: `--mm-font-serif`, `--mm-fs-h1..h3`,
  `--mm-accent`, `--mm-lav-soft`, `--mm-line` …), `pages.css` (page surfaces; the overview at
  :70–110), `components/PageShell.tsx`, and the `themeCheck` grep gate (no colour literals outside
  `theme.css` — the document CSS must use tokens). 023 (one page frame + instructor nav) is in
  progress and edits `AssignmentOverview.tsx`, hence `after: 023`. **Relationship to 009:** figures restore HW4 P1–P2's diagrams; the worded
  descriptions become captions/alt text, so 009's review shrinks to the transcription.
- Pointers: `app/src/types.ts:166–216, 282–294` · `components/AssignmentOverview.tsx` (whole) ·
  `pages.css:70–110` (overview rows), `index.css:1225–1250` (`.question-statement`, title, hint) ·
  `components/DataTable.tsx:17–36` · `statementFormat.ts` (`Block`/`Inline`, `parseStatement`,
  `statementProse`) + `components/StatementBody.tsx` · `instructor/AssignmentEditor.tsx` (215
  lines) · `server/src/sanitize.ts:38–48` · `app/src/devData/homeworks/hw{1..7}.json` ·
  `problem sets/hw{1..7}.pdf` (the oracle).

## Verify
- Gates: both `tsc`s, `npm run build`, `npm run check` (with the extended
  `statementFormatCheck`), `server npm run check` (the new fields round-trip through the API
  and survive `sanitize`; grading unchanged).
- Browser (local mode, "Vite Dev Server"): Prof. Ada → `#/instructor` → Load HW1–HW7 → Publish
  all → John Doe → open each HW overview with its PDF page open beside it (Read the PDF with
  `pages`) at 1280 and ~700 wide; open HW1 P1 and HW3 P1 to check the in-editor context; then as
  Prof. Ada create an assignment with two sections, a callout and a figure, publish, view it as
  John Doe. Screenshots `tasks/attachments/2026-09-21-020-hwN.png`.
- Owed: nothing beyond the browser pass.

## Progress log
