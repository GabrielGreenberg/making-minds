---
id: 2026-09-28-077
type: bug
title: Remove the grey sliver at the left edge of the HW1 P16–17 schematic, and pin every problem-set figure against cropped-in neighbours
priority: normal
size: small
requires:
area: app
source: feedback
created: 2026-09-28T10:50:00-07:00
status: done
after:
branch:
merged_into:
---

## Description
App Feedback report `fb-muliz8de-r7tfme` (author-role: instructor, category: platform
design; context HW1, question 16). The schematic shown with HW1 Problems 16 and 17 has a
faint grey bar down its left edge. It should not be there.

**Cause (verified in the file).** `app/public/problem-sets/hw1-schematic-mn.svg` was cut from
the HW1 PDF page, where the schematic sits to the right of the grey "Hint" box. The crop kept
part of that box. One filled path in the file (fill `rgb(93.33%, 91.76%, 92.94%)`, the hint
grey) runs from x = −349.6 to x = 0.605, y 3.6 → 67.7, in a `viewBox="0 0 125 80"`. Only its
last 0.6 units are inside the frame, which is the thin grey strip at the left edge. Both P16
(id 16) and P17 (id 17) use this figure (`hw1.json`, `figures[0].src`).

**Same mistake elsewhere (the class).** All the figures in `app/public/problem-sets/` were cut
from the PDFs by hand, so any of them can carry a piece of a neighbouring shape. A scan of the
ten SVGs finds one more suspect: `hw2-machine-format.svg`
(`viewBox="0 0 245 92"`, shown at 300px inside HW2's "On binary addition" hint). Its
hint-grey background path runs x −220.5 → 242.5, so it stops 2.5 units short of the right
edge. That likely leaves a ~3px white strip on the right, against the hint's tint. Check it
while here. `hw2-long-addition.svg` paints the same grey across its whole frame (a `<rect>` at
x −22, width 264), so it is not a sliver. The HW4 figures' negative `M` coordinates are glyph
outlines inside `<defs>`, not page shapes.

## Done when
1. The HW1 P16/P17 schematic shows no grey bar: the stray hint-box path is removed from
   `hw1-schematic-mn.svg`, and nothing else in the drawing changes.
2. `hw2-machine-format.svg` is checked and, if it has a strip at its right edge, fixed the
   same way. That means either removing the partial background or making it cover the whole
   frame, whichever matches how the figure looks inside its hint.
3. A check-tool pin fails on any figure that a homework references
   (`hw*.json` `figures[].src` at section, callout and question level) when a filled shape
   outside `<defs>` covers only part of the viewBox and runs past one of its edges, i.e. a
   cropped-in neighbour. A full-frame background passes. Both the old
   `hw1-schematic-mn.svg` and a synthetic sliver fail the pin; every committed figure passes.
4. Gates green.

## Design
- **deepFix (recommended):** clean the figures, then add the pin so a later hand crop can't
  bring the problem back. The pin belongs with the other every-homework checks in
  `app/tools/statementFormatCheck.ts` (it already validates every HW's document). It can also
  be a small `figureCheck` added to `npm run check`. Keep it simple: read each referenced SVG
  as text, skip `<defs>…</defs>`, and for top-level `<path>`/`<rect>` elements with a fill
  other than `none` and no `transform`, take the bounding box of their absolute coordinates.
  Flag a box that crosses a viewBox edge and covers less than the whole frame on that axis.
  pdftocairo output (these files) uses absolute `M/L/C/Z`, so a coordinate scan is enough. No
  SVG library.
- **surgicalFix:** delete the one path from `hw1-schematic-mn.svg`. That fixes the report but
  leaves the HW2 suspect and the next hand crop unguarded.
- Figures are served from `app/public/` and synced to the pilot with each release (Pages
  upload). No homework JSON change is needed, and the homework sync's content hash is
  unaffected.

### Members
- `fb-muliz8de-r7tfme` (instructor): HW1 P16–17 schematic, grey bar on the left.
- (catch scan) `hw2-machine-format.svg`: probable white strip on the right edge.

## Verify
- The new pin fails on the pre-fix `hw1-schematic-mn.svg` (keep a copy as a fixture or a
  synthetic string) and passes on the cleaned set. Then `npm run check`, both `tsc`s and
  `npm run build` in `app/`.
- Eyeball (owed, not claimed): open HW1 in the problem-set document and the editor at P16. The
  schematic has a clean white left edge. Also HW2's "On binary addition" hint:
  `node app/tools/shootProblemSets.mjs` shoots the HW documents headlessly.

## Progress log
- 2026-09-28 (robot, implement): deep fix. **Cause** as filed: hand crops of the HW PDFs
  (pdftocairo SVG) keep the edge of whatever sat beside the drawing. **The pin first:** pure
  `app/tools/figureCrop.ts` `figureCropFaults(svg)` (no fs, no SVG library): strips comments
  and `<defs>`, walks the tags with a `<g>` stack (inherited fill / fill-opacity, transforms
  composed own-first then outward; `matrix()` / `translate()` only), judges filled `<path>`
  (absolute M L C Q S T Z) and `<rect>` by their bounding box against the viewBox. **Rule:** a
  shape that runs past an edge on an axis it does not span is a fault, UNLESS the crop keeps
  ≥ ½ of it AND it covers < ½ the frame. The spec's literal rule wrongly fails the committed
  `hw3-retina.svg`, whose left terminal squares run 1.55 units past the left edge (66% kept,
  their own shape). A neighbour is a shape the crop mostly excludes (HW1 hint box 0.2%
  kept), and a background (≥ ½ the frame) that stops short is never exempt. Clip-paths are
  ignored on purpose (cairo's page-edge clips; honouring them would pass hw2-retina's clipped
  remnant). Unreadable geometry (rotate, relative / H / V / A commands, % rect, filled circle /
  ellipse / polygon / polyline, no viewBox) is a fault, never a silent pass; strokes and
  text are out of scope (header comment). Pins: statementFormatCheck
  `[figures: no cropped-in neighbours]` (the pre-077 offending lines verbatim as string
  fixtures; no git history, since CI clones are shallow) + the corpus sweep over every
  `collectFigures` .svg (10 today, deduped by src; data: URLs skipped). **Pre-fix
  evidence:** with no SVG touched, `npx tsx tools/statementFormatCheck.ts` exited 1, failing
  the corpus check on exactly hw1-schematic-mn (left edge, 0.2% inside), hw2-machine-format
  (stops 2.51 short of the right edge) and hw2-retina (arrowhead remnant, 0.4% inside). The
  helper run on `git show HEAD:app/public/problem-sets/hw1-schematic-mn.svg` gave the one
  hint-box fault. **The figures:** (1) hw1-schematic-mn: the hint-box path (old line 83)
  deleted, one line, nothing else. (2) hw2-machine-format: confirmed a white strip at the
  right edge inside the lavender hint; the grey background now reaches x = 269.5 (the file's
  own white rect edge), full frame like its sibling hw2-long-addition. (3) hw2-retina: the
  output arrow's head had been cropped off (a 0.02-unit remnant under clip-16); frame
  widened to 112 (width 112pt, viewBox 0 0 112 126), the head unwrapped from its clip and
  clip-16 deleted. The head is restored (matches the PDF and hw3-retina's headed arrow);
  the eyeball shows nothing else new at the right, so no fallback was needed. hw2.json's
  width 130 is unchanged (the drawing is about 5% smaller). No JSON change. Memo `Pins:` line
  updated; CLAUDE.md untouched (39,995 of 40,000 bytes; a pin inside an existing tool doesn't
  change the index). **Gates:** app tsc 0, typecheck:tools 0, statementFormatCheck 0
  (80/80), app `npm run check` 0, `npm run build` 0, server `npm run check` 0, budgets 0.
  **Eyeball (figures, done):** a headless-Chrome render of HEAD vs the fixed SVGs at their
  document widths (hw1 on white; hw2-machine-format at 300px on the hint's `--mm-lav-soft`;
  hw2-retina at 130px): the HW1 left-edge grey bar is gone, the HW2 right strip is gone, the
  retina arrow has its head. **Owed:** the in-app eyeball (HW1 document and the editor at
  P16, HW2's "On binary addition" hint) through `node app/tools/shootProblemSets.mjs` (needs
  the dev server). Done when 1–4 met. Follow-up, not fixed here: hw3-retina's left terminals
  are trimmed by 1.55 units (exempt by the rule); widening them later would be a fidelity fix.
- 2026-09-28 (robot, fix): review found the exemption (kept ≥ ½ AND share < ½ → pass)
  breaks Done-when 3 as written. It passes a thin neighbour that is mostly inside the frame:
  a 0.4-wide rule 62% in, a hint-grey bar 60% in (the reported symptom from a thinner
  shape), a neighbour covering 41% of the frame, an arrowhead 55% in. The exemption existed
  only for hw3-retina, whose trimmed terminals were themselves a crop defect. **Fixed:** the
  exemption is gone. `judge` now faults any shape that runs past an edge on an axis it does
  not span, which is the literal rule; the header comment says why no size or share pass is
  allowed. hw3-retina is re-framed the way hw2-retina was: `viewBox="-2 0 114 138"`, width
  114pt. Its four clipped terminals are unwrapped and clip-0…clip-3 deleted, so all eight
  squares (x −1.55 → 3.06) are whole. A headless render of the old and new files side by side
  shows full squares with a clean left margin and nothing else changed. hw3.json's width 130
  is unchanged. Pins flipped or added in statementFormatCheck: the pre-077 hw3-retina
  terminal fails in the old frame (66.4% inside) and passes in the new one; the reviewer's
  thin-rule, grey-bar, 41%-neighbour and 55%-arrowhead repros each fail. The HW1 message
  regex follows the reworded fault text ("with 0.2% inside"). A sweep of all ten SVGs is
  clean, and the HEAD hw3-retina gives its eight faults. The earlier follow-up (hw3-retina's
  trimmed terminals) is done here.

### 2026-09-28 — implemented (work loop)
- **Built:** the grey bar at the left of the HW1 P16–17 schematic is gone (the stray
  hint-box path deleted, one line). Three other hand crops are fixed too: HW2 machine-format's
  grey background now fills its frame (no white strip), and HW2 retina's arrowhead and HW3
  retina's left terminals are whole (frames widened, cairo clips removed). A new pure checker,
  `app/tools/figureCrop.ts`, faults any filled shape outside `<defs>` that runs past a viewBox
  edge on an axis it does not span. It has no keep/share exemption, and any geometry it can't
  read is a fault. No homework JSON change, so the sync and content hash are unaffected.
- **Pins** (`statementFormatCheck [figures: no cropped-in neighbours]` + corpus sweep): the
  pre-077 HW1 sliver (0.2% inside), HW2 short background, HW2 arrowhead and HW3 terminal each
  fail in their old frames and pass once fixed. A synthetic right-edge sliver fails, as do the
  reviewer's thin-rule / grey-bar / 41%-neighbour / 55%-arrowhead repros. Full-frame
  backgrounds pass. Also pinned: defs/comments/strokes/fill-opacity 0 ignored, fill
  inheritance, transform order, unreadable geometry → fault. The corpus sweep covers every
  `collectFigures` .svg (section, callout, question level; 10 today) and is clean.
  statementFormatCheck 82/82.
- **Gates:** app tsc 0, app build 0, app check 0, server tsc 0, server check 0.
- **Review:** 1 blocker (the exemption) + 1 minor (the pins) fixed; none skipped. Nits left
  alone: the sweep skips data: URL figures; nested `<svg>` / `<a>` / `<switch>` / `<symbol>`
  and `<style>` sheets are walked without being read; the editor-workbench prototype's copy of
  the HW1 schematic (`docs/buildout/designs/editor-workbench/assets/`) still has the sliver.
- **Owed (loop session):** the figure-level eyeball (before/after headless render of the four
  SVGs at their document widths: HW1 on white, hw2-machine-format on `--mm-lav-soft`, hw2-retina
  at 130px, hw3-retina) and the in-app eyeball (HW1 overview + editor at P16/P17, HW2 "On binary
  addition" hint, HW2 retina aside) via `node app/tools/shootProblemSets.mjs` on the 5173 dev
  server. Nothing is owed to Gabriel.
- **Next step:** loop session: visual check if owed, then land per PROFILE §5.

### 2026-09-28 — landed (robot)
- **Figure eyeball done:** headless Chrome rendered the four SVGs before and after at their
  document widths. HW1 zoomed at the left edge: before shows the grey bar, after is clean
  white. hw2-machine-format on the hint tint: before has a white right strip, after is grey to
  the edge. hw2-retina: the arrowhead shows. hw3-retina: the terminal squares are whole.
- **Owed, not claimed (Gabriel's eyeball):** the in-app view. Run `npm run dev` in `app/`,
  sign in as the toy instructor, Dashboard → "Load HW1–HW7", and publish. Then check the HW1
  overview (P16–17 schematic) and the editor at P16/P17, HW2's "On binary addition" hint, and
  the HW2/HW3 retina asides. Or run `node app/tools/shootProblemSets.mjs <dir> 1280` against
  the 5173 dev server.
- `origin/main` had nothing new at land, so the workflow's gates stand (all 0). CLAUDE.md is
  unchanged: no line in it is made false by this task.
