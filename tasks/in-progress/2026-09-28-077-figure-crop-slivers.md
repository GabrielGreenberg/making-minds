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
status: ready
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
