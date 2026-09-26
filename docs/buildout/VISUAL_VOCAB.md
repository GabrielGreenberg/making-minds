# Visual Vocabulary — the appearance oracle

_What "looks right" means. Distilled from `spec/PHIL_133_Platform_Spec_v2.md`,
`mm_textbook.pdf`, and the mockups in `spec/Private & Shared/…/Mock_Ups-*.jpg`.
Appearance verification (`appr` column in COVERAGE) checks the rendered UI against
this. When a new mode's appearance work starts, refresh this from the textbook
(META-visual-vocab)._

Mockup index (spec Appendix C): CC layout `Mock_Ups-3_3.jpg`, SC `Mock_Ups-4_4.jpg`,
wires `Mock_Ups-5_4.jpg`, homework `Mock_Ups-6_4.jpg`, FSM `Mock_Ups-9.jpg`,
turbot `Mock_Ups-10.jpg`, TM `Mock_Ups-6.jpg`.

## Universal rules

- **Directionality** — every component has inputs on the **left**, outputs on the
  **right**; signal flows left → right (gates, MEM, boxed circuits, states alike).
- **Wire color** — **black = 0, red = 1** (the live signal value).
- **Wires** — straight segments (H/V/diagonal). Splitting one output to many
  inputs is allowed and drawn with a **dot** at the junction; merging is forbidden.
  Crossings that don't connect draw a **bump/arc**.
- **Validation** — _warn, don't block_: loops (in CC), merged links, free ends get
  a red highlight + tooltip.
- **Labels** — inputs `IN1, IN2, …`, outputs `OUT1, OUT2, …`, assigned at creation
  by vertical position and **permanent** (moving a component never relabels it).

## Gates (Appendix A)

| Gate | Symbol | In | Out |
|------|:------:|:--:|:---:|
| NOT | ¬ | 1 | 1 |
| AND | ∧ | 2 | 1 |
| OR  | ∨ | 2 | 1 |
| XOR | ⊕ | 2 | 1 (boxed) |
| HA (half-adder) | — | 2 | 2 (Sum, Carry) |

Boxed circuits render as a labeled rectangle; ports on left/right inherit the
inner circuit's labels; double-click opens a read-only inner view.

## Tables (right panel)

- **I/O** — the panel shows raw per-wire bits. The Argument/Value table (the
  concatenated numeral under tally or binary, IN1 = most significant bit) and its
  representation toggle were removed from the panel on 2026-09-10.
- **Local vs Global** — local = per-wire; global = all inputs as one number, all
  outputs as one number.
- **Time flows right → left** in SC and FSM tables: t1 on the right, later steps
  extend left. New time columns append on the left.
- **Tally** — `k` ones (from the right) then zeros = the number `k` (`0011`→2).
  **Binary** — standard base-2 (`0011`→3).

## SC (sequential circuits)

Layout convention (encourage, don't enforce): external inputs enter left, external
outputs exit right, **MEM block sits at the top** with `M_OUT` feeding left (back
into the circuit) and `M_IN` receiving from the right; combinational logic in the
center. MEM initializes to 0 and displays its stored value during simulation.

## FSM

_(textbook ch. 22, pp. 99–103; mockup `Mock_Ups-9.jpg`)_

- States are **circles** labeled `S₀, S₁, …` (S + subscript numeral; palette
  stencil reads `Sₙ`). **The initial state is marked by name alone — it is always
  `S₀`.** No arrow-from-nowhere, double ring, or other initial-state marker
  (textbook p. 100; the mockup shows none either).
- Current state highlighted **filled green** (mockup); "Current state: Sₙ" readout
  above the canvas. (The textbook's step-by-step figures instead use markers: red
  ▲ at the current state, blue ▲ under the current IN bit, blue ▶ beside the
  current transition's label — print convention, not the app's.)
- Transition arrows are **one-directional** (arrowhead at the target), labeled
  **`input:output`** (Mealy, e.g. `0:1` = "on input 0, output 1"); the label sits
  beside/above its arrow. The textbook's output-on-state variation (input-only
  labels) is noted there as a variation and NOT used.
- **Determinism** — per state, at most one outgoing arrow per input symbol (≤ n
  arrows for n readable symbols; binary ⇒ ≤ 2). Zero outgoing arrows is legal.
  Self-loops and multi-state loops are legal; lines may cross.
- **Self-loops** draw as a small arc looping outside the circle, label at the
  apex; multiple self-loops on one state fan out at distinct angles. When A→B and
  B→A both exist they draw as two separated curved arcs, never overlapping (a
  lone transition between a pair may be a straight arrow).
- **Halting** — no arrow for the read input ⇒ the machine halts in that state on
  that input; no outgoing arrows at all ⇒ halts on any input. Design rule
  (p. 101): a function-computing FSM should **never halt** — its final state
  carries `0:0` and `1:0` self-loops (outputs 0s indefinitely).
- **State table** mirrors the diagram: `CURRENT STATE | IN | OUT | NEXT STATE`,
  two rows per state (inputs 0 and 1, states in S₀ < S₁ < … order); a missing
  transition shows OUT `–` / NEXT `HALT`; the current state's rows highlight
  during simulation.
- Run panel: IN and OUT bit rows under `… t2 t1` headers, t1 rightmost, later
  steps extend left (mockup: `+` affordance on the table's left edge);
  Run / Pause / Step / Reset controls.

## TM  ⚠ the one deliberate departure

- Tape: horizontal strip of cells; a **triangle** read/write head marks the current
  cell. Uninitialized cells read 0 (unary/tally) or blank; scrollable both ways.
- **Transition notation — two-output form (industry standard, NOT the textbook;
  landed P2.1):** one **read** symbol drives **two separate outputs** — the
  symbol to **write** and the direction to **move**.
  - **Stored form:** `read:write,move` — e.g. `1:0,R` (read 1 → write 0, move
    right). Default new-transition label `0:0,R`.
  - **Rendered form (canvas):** two-cell label boxes as in FSM — left cell the
    read symbol, right cell `write,move` with the comma shown (e.g. `1 │ 0,R`)
    — WYSIWYG with the stored text. The label editor presents **one input
    field + two output fields** (write, then move), comma between them,
    entered one token at a time.
  - **Machine table:** `STATE | READ | WRITE | MOVE | NEXT STATE` (write and
    move are separate columns; halt rows show `– / – / HALT`). History `ACT`
    column shows `0,R`.
  - **Legacy alias:** the textbook's dual-action token `1:0R` parses forever
    (old stored machines keep working) but renders canonically and **decays
    to `1:0,R` on any edit-save**. Execution is unchanged: write+move is one
    atomic step.
- Status panel: time step, current state, read value, write+move action, next state.
- Alphabet is tied to the question's `representation` (`*` only on binary).

## Turbot (arena)

- Split view: **arena (Map)** above / **internal circuitry** below (the brain is a
  CC/SC/FSM/TM editor). "Map" label upper-left of the arena.
- Arena cells: **turbot = red triangle** (`#c73535`) pointing in its facing
  direction (decision 2026-07-08, P6.1b: the implemented red won over the
  mockups' yellow — Gabriel's call); **block = gray square** (impassable);
  **food/goal = green circle**. Arena boundary is an implicit wall. One item
  per cell.
- **Goal reached** (task 025): the step that moves the turbot onto a goal from
  off it pulses that goal's circle once (scale + soft green glow, ≤ 600 ms;
  nothing on the turbot); a Run holds 2 ticks there, Step never holds.
  `prefers-reduced-motion` drops the motion (the hold stays). Only the live Map
  animates — "Edit map" and the instructor's arena editor never do.
- **Sensor (1 bit):** 0 = empty ahead, 1 = block/boundary ahead. Food reads as
  passable/empty (the goal is invisible to the turbot — HW3 Note 2).
- **Motor (2 bits)** `ij` (i = left wheel, j = right wheel): `00` stop, `01` turn
  left (CCW), `10` turn right (CW), `11` forward.
- FSM/TM navigation abbreviations (HW4): inputs `0=E` (empty) / `1=B` (block);
  outputs `11=F` / `00=S` / `10=R` / `01=L`.
- Turbot-TM states: **internal = circle** (operate on the private {0,1,*} tape,
  single action write-or-move), **external = square** (sense B/E/F, move ↑/↱/↰).
  TM-turbot's private tape shown read-only below the canvas.

## Page surfaces (everything outside the canvas)

_The course website, https://www.makingminds.org, is the design authority for every
surface that is not the circuit editor: the login and server-health screens, the home
catalog, an assignment's question list, the grade sheet, the feedback and account
modals, the instructor shell and views. Its stylesheet is `assets/site.css` in the
`making-minds-website` repo (reconciled against commit `dab549b`, 2026-09-21). The app
carries the same vocabulary as `--mm-*` tokens in `app/src/theme.css` (each token
comments its site.css original) plus the per-surface rules in `app/src/pages.css`;
`app/tools/themeCheck.ts` fails `npm run check` if a page surface reintroduces a colour
literal or an undefined token. Task: `tasks/done/2026-09-21-019-*`._

- **Shell** — every page renders inside `components/PageShell.tsx`, and the shell is
  **invariant**: the same chrome and the same column on every route and for every role,
  so crossing between the student catalog and the instructor area moves nothing (pinned
  by measurement in task 023). A white `.topbar` (serif brand "Making Minds · PHIL 133"
  linking to the website; the nav by role — a student sees Assignments, an instructor
  sees Student view · Dashboard — current page underlined in magenta, link widths
  reserved at bold so the row never shifts; the boxed lavender **Sandbox** link beside
  the nav, set apart because it opens the editor rather than a page; name · Feedback ·
  Password · Log out at the right, from `SessionControls`), the 14px lavender `.band`,
  ONE centred `.page` column (max 1080px; wide tables scroll inside their wrappers), the
  site footer. Login, server-health and the instructors-only refusal use the shell's
  **card** variant: one centred `.mm-card`. A section's own navigation lives INSIDE the
  column as `.mm-tabs` (an optional eyebrow, then tabs; current tab underlined): the
  student Home's Assignments · Grades on the catalog, the Grades page and an
  assignment's overview; the Dashboard's Assignments · Roster & accounts · Feedback ·
  Notes on every instructor page. (The remote sign-in has no tabs: one form, with a quiet
  "First time here?" link to setup and an access request only when setup finds the
  email off-roster.)
- **Visitor** (task 027) — someone not signed in reaches only the sandbox (the editor):
  its top bar shows "Visitor" and **Sign in** where the name menu sits (the brand is not
  a link — a visitor has no Home), and under it one dismissible lavender
  `.visitor-banner` line ("…as a visitor — PHIL 133 student? Sign in"; dismissed for the
  browser session). On page surfaces `SessionControls` shows Visitor · Sign in. The
  sign-in card is the one front door (the bare site opens it for anyone not signed in,
  task 040): every pane (local picker; remote password / setup / request / dev / SSO)
  LEADS with signing in, then a hairline and one quiet meta-size `--mm-ink-3` line, "Just
  exploring? *Continue as visitor* to build…", its link the only way into the sandbox
  from there; the server-health card offers "Open the sandbox" beside Retry.
- **Up next** — the site's `.next`/`.nx` box (`.mm-next`/`.mm-nx`): a lavender field with
  a chip on the left (NEXT DUE) and date-in-`--mm-date` + title + a detail line on the
  right, above the student's catalog; shown only when a homework has a future due date.
- **Grades** — a hairline table (assignment · submitted · result); a released row opens
  in place into its question-by-question sheet (a bordered white block), never a modal.
- **Type** — IBM Plex, loaded from Google Fonts with system fallbacks: **Sans**
  15px/1.5 for text, **Serif** for h1 (34px/600) and h2 (19px/600, magenta), **Mono**
  for tags and emails. Section labels are `.eyebrow` (11.5px uppercase, tracked, grey).
- **Colour** — ink greys `--mm-ink/-2/-3` on `--mm-bg`; hairlines `--mm-line` between
  rows and `--mm-line-2` under a list or table head; **magenta `--mm-accent`** for
  section titles, the current nav item, hover, and the ONE primary button per view;
  **blue survives only as the link colour** `--mm-link`. Status colours are app-only
  tokens chosen to sit in the palette: `--mm-ok` green (pass · submitted · due later),
  `--mm-warn` amber (pending · due soon), `--mm-danger` = the site's homework red
  (fail · overdue · destructive).
- **Flat** — square corners everywhere (`--mm-radius: 0`); no shadow except the modal
  card; surfaces are separated by hairlines, never boxed in grey.
- **Lists and tables** — hairline rows over a `--mm-line-2` rule (`.mm-list`/`.mm-row`,
  `.mm-table`): uppercase eyebrow `th`, dates in `--mm-date`; a clickable row turns its
  title magenta on hover.
- **Tags** — `.tag`: mono 11px/600 on a soft field — `tag--accent` for a question's
  mode, `tag--date`/`tag--exam` for roles, `--ok/--warn/--danger` for states. Never a pill.
- **Buttons** — `.mm-btn` square, white with a `--mm-line-2` border, 13.5px/600;
  `mm-btn--primary` magenta (Submit assignment, Sign in, Send feedback, New Assignment,
  Add Question, Save); `mm-btn--quiet` text-only (the dev seeds); `.mm-link` for inline
  text actions. `.mm-segmented` is the one-of-a-few control (mode, representation, arena
  tool): square, hairline-divided, the active segment filled magenta.
- **Fields** — `.mm-field`: uppercase micro-label over a square `.mm-input` (sized
  modifiers `--num/--name/--formula/--title/--area`; `.mm-inline-field` for a label beside
  a small input); focus is a 2px magenta outline; errors `.mm-error` in danger red, notes
  `.mm-note` grey, `.mm-hint` italic.
- **Modals** — navy-tinted scrim, square white `.mm-modal` card (the one shadow), serif
  title, dim sub-line, Close as a small quiet button at the right of the head.
- **Home row** — title · meta (question count, due date) · submission status (which
  carries the grade line and the "View grades" link once released) · ONE action (Submit,
  or the past-due lock). Nothing else.
- **One visual language, the editor included** (task 052, retiring the old "the editor
  is untouched" boundary) — the editor's frame speaks these tokens too:
  `components/EditorShell.tsx` (a 48px white top bar — serif brand to Home, a breadcrumb
  to the assignment's document, the save state, Submit, `SessionControls` folded under
  "Name ▾" — over a 4px band), the left **question panel** (nav strip, the problem, the
  grouped question list), resizable and collapsible columns, and the open / fill-in
  answer area, and the canvas's floating parts **palette** (task 054: 58px icon tiles
  stroked in the ink colour, a grip, a turn button, pinned boxes, the Boxes pop-out, a
  55% ghost while a tile is dragged), all styled in `app/src/workbench.css`
  (literal-free, like `pages.css`). The spec is `docs/buildout/designs/editor-workbench.md`.
  What is still inside `index.css` — the canvas and data-panel internals — moves onto the
  tokens in task 055; until then `themeCheck` ratchets its colour literals (they may only
  go down). The goal and output tables use Plex Sans with tabular digits, never Mono.
