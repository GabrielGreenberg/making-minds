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

- **I/O vs A/V** — I/O shows raw per-wire bits; A/V shows the concatenated numeral
  under tally or binary (IN1 = most significant bit).
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

- States are **circles** labeled `S₀, S₁, …`; `S₀` is the initial state, marked
  with an incoming arrow from nowhere. Current state highlighted (filled green).
- Transition arrows labeled **`input:output`** (e.g. `0:1` = "on input 0, output 1").
  At most one outgoing arrow per input value; a missing arrow ⇒ halt on that input.
- A **state table** view mirrors the diagram: `STATE | IN | OUT | NEXT`.
- "Current state: Sₙ" shown above the canvas.

## TM  ⚠ the one deliberate departure

- Tape: horizontal strip of cells; a **triangle** read/write head marks the current
  cell. Uninitialized cells read 0 (unary/tally) or blank; scrollable both ways.
- **Transition notation — target state (industry standard, NOT the textbook):**
  one **input** symbol drives **two separate outputs** — one for the symbol to
  **write**, one for the **move** direction. The engine already stores
  `TMAction {write, move}` separately; the UI must present them as two outputs.
  - Current (textbook, being replaced): dual-action token `input:action`, e.g.
    `1:0R` = read 1, write 0, move right.
  - Target: one input → (write, move) as two labeled outputs. Record the exact
    rendered form here once P2.1 lands, and note the departure in spec §10.3.
- Status panel: time step, current state, read value, write+move action, next state.
- Alphabet is tied to the question's `representation` (`*` only on binary).

## Turbot (arena)

- Split view: **arena (Map)** above / **internal circuitry** below (the brain is a
  CC/SC/FSM/TM editor). "Map" label upper-left of the arena.
- Arena cells: **turbot = yellow triangle** pointing in its facing direction;
  **block = gray square** (impassable); **food/goal = green circle**. Arena boundary
  is an implicit wall. One item per cell.
- **Sensor (1 bit):** 0 = empty ahead, 1 = block/boundary ahead. Food reads as
  passable/empty (the goal is invisible to the turbot — HW3 Note 2).
- **Motor (2 bits)** `ij` (i = left wheel, j = right wheel): `00` stop, `01` turn
  left (CCW), `10` turn right (CW), `11` forward.
- FSM/TM navigation abbreviations (HW4): inputs `0=E` (empty) / `1=B` (block);
  outputs `11=F` / `00=S` / `10=R` / `01=L`.
- Turbot-TM states: **internal = circle** (operate on the private {0,1,*} tape,
  single action write-or-move), **external = square** (sense B/E/F, move ↑/↱/↰).
  TM-turbot's private tape shown read-only below the canvas.
