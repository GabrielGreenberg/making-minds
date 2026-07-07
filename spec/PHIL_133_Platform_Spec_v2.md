# PHIL 133 Platform Spec (v2)

**Making Minds: A Constructive Introduction to the Computational Theory of Mind**

**Author:** Gabriel Greenberg
**Last Updated:** March 14, 2026

---

## Implementation Phases

The platform will be built in six phases, each adding a new computational model. Later phases build on the infrastructure of earlier ones.

| Phase | Model | Key New Components |
|-------|-------|--------------------|
| 1 | Combinatorial Circuits (CCs) | Logic gates, inputs/outputs, wiring, I/O and A/V tables, boxed circuits |
| 2 | Sequential Circuits (SCs) | MEM block, clock/time model, sequential I/O table |
| 3 | Finite State Machines (FSMs) | State nodes, transition arrows, FSM editor |
| 4 | Turbots | Arena, turbot agent, internal circuitry workspace |
| 5 | Turing Machines (TMs) | Tape, read/write head, TM state display |
| 6 | Turing Machine Turbots | Turbot with TM-based internal circuitry |

---

## 1. Application Navigation

### 1.1 Application Layout

The interface consists of five regions:

- **Top menu bar** — File, Edit, View, Table, and (when loaded) Homework menus
- **Left component library** — Palette of draggable components, context-sensitive to the current build mode (circuit, FSM, turbot, or TM)
- **Workspace canvas** — The main editing area
- **Data table panel** (right side) — Displays I/O table, A/V table, or sequential time-step table depending on context
- **Simulation panel** (bottom) — Run, Pause, Step, Reset, Global Reset controls

*See Mockups: Overall Layout (CC), Overall Layout (SC)*

### 1.2 Menu System

**File Menu:**

- New → submenu: Circuit, FSM, Turbot, Turing (Phase 5+)
- Open File (JSON upload)
- Save
- Save As
- Import
  - Build (circuit, FSM, turbot)
  - Worksheet (homework file)
- Export
  - Build
  - Worksheet

**Edit Menu:**

- Undo
- Redo
- Copy
- Paste
- Delete
- Select All

**View Menu:**

- Zoom in / Zoom out
- Reset zoom
- Toggle grid

**Table Menu:**

- Representational System
  - Tally (T)
  - Binary (B)
- Display Mode
  - Input/Output Table (I/O) — shows raw bit strings per input/output line
  - Argument/Value Table (A/V) — shows interpreted numerical values under the selected representational system
- Scope
  - Local — shows per-bit (per-wire) values at each time step
  - Global — concatenates all input bits into a single numeral and all output bits into a single numeral, then interprets under the selected representational system

When the user toggles between I/O and A/V, or between Tally and Binary, the table recalculates automatically. In I/O mode, cells contain raw 0/1 bit values. In A/V mode, cells contain the number represented by the concatenated bit string under the current representational system. The Local/Global toggle determines whether the table shows individual wires or concatenated groups.

**Homework Menu:**

- Appears only after a homework file has been imported
- Labeled with the homework file name (e.g., "HW #1")
- Generates a separate workspace tab for each problem
- Each workspace displays the problem text at the top of the canvas
- May constrain the available component library (e.g., CC-only problems hide MEM blocks)

*See Mockup: Homework Menu*

### 1.3 Simulation Panel

- **Run** — Continuously advance simulation (for SCs: advances clock cycles; for FSMs: processes input sequence; for TMs: executes steps)
- **Pause** — Halt continuous execution
- **Step** — Advance one unit:
  - CC mode: evaluate the circuit for the current input (no time dimension)
  - SC mode: advance one clock cycle
  - FSM mode: process the next input bit and transition
  - TM mode (Phase 5): read tape, run circuit, execute tape action
  - Turbot mode: advance one movement cycle
- **Reset** — Return to time step 1 (preserve circuit structure and input sequence)
- **Global Reset** — Return to time step 1 and clear all inputs and memory to 0

### 1.4 JSON File Model

Projects are serialized into JSON for saving, loading, and sharing. The JSON includes:

- **Metadata:** title, author, date, phase/build type (CC, SC, FSM, turbot, TM)
- **Circuit data:** all component instances with type, unique ID, and parameters
- **Position data:** x/y coordinates for each component on the canvas
- **Connection data:** all links, specifying source port and destination port by component ID
- **Representational system:** current setting (tally or binary)
- **For boxed circuits:** internal circuit definition and exposed port mapping
- **For FSMs:** state node positions, transition arrow definitions (source state, destination state, input, output)
- **For turbots:** arena layout (grid dimensions, block positions, food positions, turbot start position and orientation), plus internal circuitry data
- **For TMs (Phase 5):** initial tape contents, head start position

The JSON format is suggestive; data can be reorganized as implementation requires.

### 1.5 Homework JSON Schema

Homework files use a separate JSON schema:

```
{
  "title": "HW3: Computing with SCs",
  "problems": [
    {
      "id": 1,
      "text": "Design a SC that computes +1 B",
      "type": "SC",
      "representation": "binary",
      "allowed_components": ["NOT", "AND", "OR", "MEM", "XOR", "HA"],
      "test_vectors": [
        { "input_sequence": [1, 0, 0, 0], "expected_output": [0, 1, 0, 0] },
        { "input_sequence": [1, 1, 0, 0], "expected_output": [0, 0, 1, 0] }
      ],
      "grading_mode": "exhaustive | test_vectors",
      "notes": "You may assume boxed circuits for XOR and half-adder."
    }
  ]
}
```

- **type** constrains the build mode (CC, SC, FSM, turbot, TM)
- **representation** sets the default tally/binary interpretation
- **allowed_components** optionally restricts the component library for that problem
- **test_vectors** defines input sequences and expected output sequences for automatic grading
- **grading_mode:**
  - `exhaustive` — for CCs, the grader tests all 2^n input combinations
  - `test_vectors` — the grader runs only the specified input/output pairs
- For turbot problems, test vectors include arena configuration and success criteria (e.g., "reach position (3,1) and stop")

### 1.6 Save/Load Data

**Save Flow:**

1. User selects Save
2. Project serialized to JSON
3. File saved locally (browser download)
4. Success confirmation

**Load Flow:**

1. User selects Open
2. JSON file uploaded
3. File validated (structure, required fields, component types)
4. Circuit reconstructed in workspace
5. UI refreshes

### 1.7 Project State

- Unsaved-changes warning when closing or navigating away
- Error message for invalid JSON on upload, with details about what failed validation
- Each workspace tab maintains independent undo/redo history

*See Mockup: Expanded menu and error message*

---

## 2. Foundation

### 2.1 Workspace

The editor provides a two-dimensional canvas for building circuits, FSMs, turbots, and TMs. The workspace supports visual drag-and-drop interaction.

**Features:**

- Infinite (or very large) scrollable canvas
- Zoom in/out
- Pan navigation via mouse drag or trackpad
- Background grid
- Snap-to-grid alignment for components
- Component placement by either (a) dragging from the library or (b) clicking in the library then clicking a canvas location

### 2.2 Selection and Editing

**Editing functionality:**

- Single select (click)
- Multi-select (shift-click or cmd-click)
- Box select (drag rectangle)
- Move (drag selected components; preserves all existing wiring)
- Copy / Paste
- Delete
- Undo / Redo — covers all user actions: component creation, movement, wiring, deletion, parameter changes

---

## 3. Component Library

The component library in the left panel changes based on the current build mode. Components available in each phase:

### 3.1 Inputs and Outputs (All Phases)

- **Input** — user-controlled boolean value (0 or 1), displayed as a small square on the left side of the circuit with an editable text field
- **Output** — displays the computed result, shown as a small square with an arrow on the right side

**Labeling rules:**

- Inputs are automatically labeled IN1, IN2, IN3... based on vertical position at creation time (higher up = lower index number)
- Labels are assigned at creation and are permanent — moving an input to a different vertical position does NOT relabel it
- Outputs follow the same convention: OUT1, OUT2, etc.
- When a new input is added, it receives the next available sequential number (not based on current position)

**Input entry:**

- Values can be entered either (a) directly in the input text box on the canvas, or (b) in the I/O or A/V table
- Typing a value in either location automatically populates the other
- For CCs, each input is a single bit (0 or 1)
- For SCs and FSMs, inputs are entered as a sequence of bits across time steps

**Directionality:** All components have a defined signal direction. Inputs flow left-to-right through the circuit. Input ports are on the left side of a component; output ports are on the right side.

### 3.2 Logic Gates (Phase 1+)

- **NOT** — 1 input, 1 output; inverts the signal
- **AND** — 2 inputs, 1 output; outputs 1 only when both inputs are 1
- **OR** — 2 inputs, 1 output; outputs 1 when at least one input is 1

Each gate has clearly visible input ports (left side) and one output port (right side). Gate symbols follow the textbook conventions (∧ for AND, ∨ for OR, ¬ for NOT).

### 3.3 Memory Block (Phase 2+)

- **MEM** — 1 input (M_IN, accepts the "write" signal from the circuit), 1 output (M_OUT, provides the "read" signal to the circuit)
- The M_IN port is on the right side of the block (receives signal flowing rightward from the circuit); the M_OUT port is on the left side (feeds signal back into the circuit)
- All memory registers initialize to 0 at simulation start
- At each clock cycle: the current stored value is sent out via M_OUT, then the value arriving at M_IN is stored for the next cycle
- During simulation, the MEM block visually displays its current stored value (0 or 1)

### 3.4 Boxed Circuits (Phase 1+)

A **boxed circuit** encapsulates an existing circuit as a reusable component. This is essential for building complex circuits from simpler ones.

**Creating a boxed circuit:**

1. The user builds a circuit in a workspace
2. User selects "Export > Build" from the File menu, saving the circuit as a named JSON file
3. User selects "Import > Build" to load a previously saved circuit as a boxed component
4. The imported circuit appears in the component library as a new draggable component with a rectangular icon labeled with the circuit's name

**Boxed circuit properties:**

- Displays as a labeled rectangle in the workspace
- Input ports on the left, output ports on the right, matching the number of inputs/outputs of the encapsulated circuit
- Port labels inherit from the original circuit's input/output labels
- Signal direction is preserved: all signals flow left-to-right through the box
- The internal circuit is not editable from the parent workspace (it is a "black box")
- Double-clicking a boxed circuit opens a read-only view of its internal structure
- Boxed circuits can be nested (a boxed circuit may contain other boxed circuits)

**Pre-built boxed circuits:**

The following boxed circuits should be available as built-in components from Phase 1:

- **XOR** — 2 inputs, 1 output; exclusive or
- **Half-Adder (HA)** — 2 inputs, 2 outputs (Sum and Carry)

Additional built-in boxed circuits may be specified per homework problem (e.g., "you may assume boxed circuits for XOR and half-adder").

### 3.5 State Nodes (Phase 3+)

- **State (S_n)** — circular node representing a state in an FSM
- Labeled S_0, S_1, S_2... (S_0 is always the initial state)
- User can rename states
- The initial state (S_0) is marked with an incoming arrow from nowhere

### 3.6 Turbot Components (Phase 4+)

- **Turbot** — the agent, represented as a triangle pointing in its current facing direction
- **Block** — a filled gray square; impassable, restricts movement
- **Food** (Goal) — a green circle; represents the goal location

### 3.7 Turing Machine Components (Phase 5+)

- **Tape** — an infinite horizontal strip of cells, each containing 0 or 1
- **Read/Write Head** — a triangle marker indicating the current tape position

---

## 4. Drag and Drop Functionality

### 4.1 Component Creation

When a component is dragged from the library onto the canvas, a new instance is created with:

- Component type
- Workspace position (snapped to grid)
- Input/output ports (number and position determined by type)
- Unique identifier

A component can also be placed by clicking it in the library, then clicking the desired canvas location.

### 4.2 Movement

Moving a component preserves:

- Type and identifier
- All existing wiring (links stretch/reroute to follow the component)

### 4.3 Ports

Each component has visible connection ports. Input ports are on the left; output ports are on the right. Ports are the valid connection endpoints for wiring.

---

## 5. Circuit Functionality

### 5.1 Wiring System

Users create links between components by clicking an output port and dragging to an input port. Links follow these rules:

**Valid connections:**

- Links connect one output port to one input port
- One output port may connect to multiple input ports (splitting)
- Links may NOT merge: two output ports cannot feed into the same input port
- Each input port accepts exactly one incoming link

**Visual rules:**

- Wires consist of straight-line segments only (horizontal, vertical, or diagonal)
- Horizontal and vertical segments follow grid lines
- Diagonal segments begin and end at grid vertices
- When wires cross without connecting, a "bump" (arc) is drawn to indicate they are separate pathways
- When a wire splits, a dot is drawn at the junction point

**Value propagation:**

- Wire color indicates the current signal value:
  - Black = 0
  - Red = 1
- Propagation is instantaneous for CCs; clock-driven for SCs

### 5.2 Circuit Validation

The system should validate circuits and warn (not prevent) when structural rules are violated:

- **No loops** — CCs must be acyclic (loops are only valid in SCs via MEM blocks)
- **No merged links** — two wires may not feed into the same input port
- **No free ends** — every wire endpoint must connect to a port (except designated inputs and outputs)

These correspond to the three rules in the formal CC definition from the textbook. Violations should be highlighted visually (e.g., a red glow on the offending wire or component) with a tooltip explaining the issue.

### 5.3 Logic Gate Evaluation

Each gate evaluates its output based on its truth table. Whenever any input value changes:

1. Connected gates recompute their outputs
2. Updated signals propagate through all downstream links
3. Output values and wire colors update visually

For CCs, this propagation is instantaneous and acyclic. The simulator uses topological ordering to evaluate gates in dependency order.

---

## 6. Combinatorial Circuits (Phase 1)

CCs compute outputs directly from inputs with no internal memory and no time dimension.

**Behavior:**

- The simulator evaluates the full circuit whenever any input changes
- All gates recompute instantly
- The I/O table (when visible) shows one row per possible input combination
- The A/V table interprets the bit strings as numbers under the selected representational system (tally or binary)

**I/O Table (local view):**

| IN1 | IN2 | OUT |
|-----|-----|-----|
| 0   | 0   | 0   |
| 0   | 1   | 1   |
| 1   | 0   | 1   |
| 1   | 1   | 0   |

**A/V Table (global view, binary):**

| ARG | VAL |
|-----|-----|
| 0   | 0   |
| 1   | 1   |
| 2   | 1   |
| 3   | 0   |

In the A/V table, all input bits are concatenated into a single numeral (IN1 is the most significant bit) and interpreted under the chosen system. Likewise for outputs.

---

## 7. Sequential Circuits (Phase 2)

SCs extend CCs with the MEM block, introducing time and memory.

### 7.1 Time Model

- Simulation maintains a discrete time step counter, starting at t=1
- Each time step represents one clock cycle
- At each clock cycle:
  1. M_OUT values are read from all MEM blocks (current stored values)
  2. The combinational logic evaluates using the current input and M_OUT values
  3. Output values and M_IN values are determined
  4. M_IN values are written into the MEM blocks (stored for the next cycle)

### 7.2 Sequential I/O Table

The data table displays inputs and outputs across time steps. Time flows right-to-left (matching the textbook convention, where t1 is on the right and later time steps extend to the left).

**Local view (per-wire):**

| ... | t4 | t3 | t2 | t1 |     |
|-----|----|----|----|----|-----|
| ... | 0  | 0  | 1  | 0  | IN  |
| ... | 0  | 1  | 1  | 0  | OUT |

**Global view (binary):**

| ... | t4 | t3 | t2 | t1 |     |
|-----|----|----|----|----|-----|
| ... | 0  | 0  | 1  | 0  | IN  |
| ... | 0  | 1  | 1  | 0  | OUT |

(For multi-input SCs, the local view shows separate rows for each input wire; the global view concatenates them into a single row showing the interpreted number.)

**Input entry for SCs:**

- Users enter the full input sequence in the table (one bit per time step)
- Alternatively, during Step mode, the user can set each input before advancing

### 7.3 SC Layout Convention

The textbook establishes a standard SC layout:

- External inputs enter from the left
- External outputs exit to the right
- MEM block sits at the top, with M_OUT feeding left (back into the circuit) and M_IN receiving from the right (output of the circuit)
- The combinational logic sits in the center

The workspace should encourage (but not enforce) this layout.

---

## 8. Finite State Machines (Phase 3)

FSMs provide a state-level abstraction over sequential circuits. The FSM editor uses a different workspace mode from the circuit editor.

### 8.1 FSM Editor

The workspace switches to FSM mode when the user creates a new FSM project. The component library shows only the State node component.

**Creating an FSM:**

1. Drag state nodes onto the canvas
2. The first state created is automatically labeled S_0 (initial state) and marked with an incoming arrow
3. Create transitions by clicking a state's edge and dragging to another state (or to itself for self-loops)
4. Each transition arrow is labeled with the notation **input:output** (e.g., "0:1" means "if input is 0, output 1")
5. For each state, there can be at most one outgoing arrow per input value (0 and 1)
6. If a state has no outgoing arrow for a given input, the machine **halts** on that input in that state

### 8.2 FSM Constraints

- At most 2 outgoing transitions per state (one for input 0, one for input 1)
- Transition labels use the format **X:Y** where X is the input bit and Y is the output bit
- Self-loops are allowed
- Any state with fewer than 2 outgoing transitions implies halting on the missing input

### 8.3 FSM Simulation

During simulation:

- The **current state** is highlighted (filled green, matching the mockup)
- A "Current state: S_n" label displays above the canvas
- The time-step table shows IN and OUT rows, with time flowing right-to-left
- Input is provided as a sequence of bits in the table (the entire input is entered before running, or one bit at a time in Step mode)
- At each step: the machine reads the current input bit, follows the matching transition arrow, produces the output bit, and moves to the next state
- When computing a function, the FSM should never halt; it should end computation by outputting 0s indefinitely in a final state

### 8.4 FSM State Table View

In addition to the diagram, the system should offer a **state table** view (toggleable) that displays the FSM as a table:

| STATE | IN | OUT | NEXT |
|-------|-----|-----|------|
| S_0   | 0   | 1   | A    |
| S_0   | 1   | 0   | S_0  |
| A     | 0   | 0   | A    |
| A     | 1   | 1   | A    |

This mirrors the textbook's state table notation and helps students connect the visual and tabular representations.

*See Mockup: FSM*

---

## 9. Turbots (Phase 4)

### 9.1 Arena

The turbot workspace is split into two panels:

- **Upper panel: Arena** — a grid-based environment for placing the turbot, blocks, and goals
- **Lower panel: Internal circuitry** — the circuit or FSM that controls the turbot's behavior

The arena component library (left panel, upper section) includes:

- **Turbot** — a triangle that can face any cardinal direction (N, S, E, W)
- **Block** — gray square; impassable obstacle
- **Food / Goal** — green circle; the target location

Arena features:

- Grid-based placement (one component per cell)
- Turbot occupies exactly one cell
- Turbot can be rotated to set initial facing direction
- The arena boundary acts as an implicit wall (turbot cannot leave the grid)
- "Map" label in the upper-left of the arena panel

### 9.2 Turbot I/O Encoding

The turbot uses a fixed input/output encoding:

**Sensor input (1 bit):**

- 0 = the cell directly ahead is **empty**
- 1 = the cell directly ahead is a **block** (or boundary)

**Motor output (2 bits):**

- 00 = **Stop** (halt movement)
- 01 = **Turn left** (rotate 90° counter-clockwise, do not move forward)
- 10 = **Turn right** (rotate 90° clockwise, do not move forward)
- 11 = **Move forward** (advance one cell in the current facing direction)

Note: Turbot has two output wires, which together encode the movement command. For SC turbots, these correspond to two physical output lines from the internal circuit.

### 9.3 Internal Circuitry

The turbot's behavior is controlled by a circuit or FSM built in the lower panel:

- The internal circuit receives the turbot's sensor reading as its input (1 bit)
- The internal circuit produces the motor command as its output (2 bits)
- For CC-based turbots: the circuit evaluates once per movement cycle (the turbot has no memory; it reacts purely to the current sensor reading)
- For SC-based turbots: the circuit has MEM blocks and can maintain state across cycles
- For FSM-based turbots: the lower panel uses the FSM editor
- For TM-based turbots (Phase 6): the lower panel uses the TM editor

Changes in the internal circuitry are live-linked to the turbot's behavior in the arena.

### 9.4 Turbot Simulation

- **Step** advances one movement cycle: read sensor → evaluate internal circuit → execute motor command → update turbot position/orientation in arena
- **Run** continuously advances cycles (with configurable speed)
- The I/O table tracks sensor input and motor output at each time step
- The arena visually updates the turbot's position and facing direction after each step

*See Mockup: Turbot*

---

## 10. Turing Machines (Phase 5 — Deferred)

Turing machines extend FSMs with read/write memory (an infinite tape).

### 10.1 Architecture

A Turing Machine consists of:

- **Logic engine** — a finite state machine (built using the FSM editor)
- **Tape** — an infinite horizontal strip of cells, each containing 0 or 1

### 10.2 Tape Interface

- The tape is displayed as a horizontal row of cells spanning the workspace
- A triangle marker (read/write head) indicates the current position
- Users can pre-populate the tape by clicking cells to toggle between 0 and 1
- The tape extends infinitely in both directions (scrollable); all uninitialized cells contain 0

### 10.3 TM Transition Labels

> **⚠ Deliberate departure from the textbook.** The textbook writes TM
> transitions as a dual-action token (`input:action`, e.g. `1:0R`). The
> platform instead uses the **industry-standard two-output form**: one read
> symbol driving **two separate outputs** — the symbol to write and the
> direction to move. This is the single place the platform intentionally
> departs from the textbook's notation. Execution is unchanged (write + move
> remain one atomic step); only the label notation differs. The legacy
> dual-action spelling is still accepted when read (old saved machines keep
> working) and is rewritten to the new form whenever a label is edited.

TM transitions use the format **read:write,move** where:

- Read is 0 or 1 (the value read from the current tape cell; also `*` on
  binary machines)
- Write is the symbol to write into the cell (0, 1, or `*` on binary machines)
- Move is R (move right) or L (move left)

e.g. `1:0,R` reads 1, writes 0, then moves right — as one step. Every
transition both writes and moves; there is no write-only or move-only step.
The editor presents one input field and two output fields (write, move); the
machine table shows WRITE and MOVE as separate columns.

### 10.4 TM Operation Cycle

At each time step:

1. **Read** the current tape cell
2. **Run** the FSM: given current state and tape reading, determine output and next state
3. **Execute** the tape action (write, then move)
4. Repeat (or halt, if no transition exists for the current state and input)

### 10.5 TM Status Display

The upper-right panel shows:

- Current time step
- Current state
- Read value
- Write and Move (the two outputs of the transition taken this step — executed as one atomic action)
- Next state

### 10.6 TM Halting

- A TM halts when it reaches a state with no outgoing transition for the current tape reading
- When halted, the tape displays the final output
- Input is the initial tape configuration; output is the final tape configuration after halting

*See Mockup: Turing Machine*

---

## 11. Turing Machine Turbots (Phase 6 — Deferred)

Phase 6 combines turbots with TM-based internal circuitry. The turbot arena operates as in Phase 4, but the internal circuitry panel uses the Turing Machine editor from Phase 5. The turbot's sensor input feeds into the TM's tape reading, and the TM's output controls the turbot's motor commands.

---

## 12. Evaluation and Grading

### 12.1 Instructor Evaluation Interface

The platform supports automatic grading of student submissions. The evaluation system is accessible only to instructors (not students).

**Workflow:**

1. Instructor creates a homework file (JSON) with problems and test vectors
2. Students import the homework file into the platform
3. Students build their circuits/FSMs/turbots in the generated workspaces
4. Students export their completed worksheet (JSON)
5. Instructor uploads student worksheets to the evaluation interface
6. The grader runs each student's circuit against the test vectors and reports results

### 12.2 CC Evaluation

- **Exhaustive mode:** The grader tests all 2^n input combinations (feasible for small n)
- **Test vector mode:** The grader tests only the specified input/output pairs
- Comparison: for each test case, the grader sets the inputs, evaluates the circuit, and compares the outputs to the expected values
- Result: pass/fail per test case, with a summary (e.g., "12/16 correct")

### 12.3 SC Evaluation

- The grader provides an input sequence (series of bits across time steps)
- The grader runs the student's SC for the full length of the input sequence
- At each time step, the grader compares the student's output to the expected output
- Multiple test sequences may be specified per problem
- Memory registers are reset to 0 before each test sequence

### 12.4 FSM Evaluation

- The grader provides input sequences and expected output sequences
- The grader simulates the student's FSM step by step
- At each step, the grader checks: correct output bit and correct state transition
- FSMs are tested by running the input sequence and comparing the full output sequence

### 12.5 Turbot Evaluation

- The grader loads the specified arena configuration
- The grader runs the student's turbot for a maximum number of steps (specified per problem)
- Success criteria vary by problem type:
  - **Reach goal and stop:** turbot must be on the goal cell and output 00 (stop)
  - **Reach goal and keep going:** turbot must pass through the goal cell (checked at each step)
  - **Return to start:** turbot must end at its starting position. If the
    arena declares a goal cell, the turbot's trace must also *visit* it before
    ending at the start — this is what makes out-and-back problems at unknown
    distance (Mad Max) gradable: without a visit requirement, a turbot that
    never moves (or blindly retraces any fixed walk) would pass. Goal-less
    arenas keep the plain end-at-start reading.
- The grader reports: success/failure, number of steps taken, final position

### 12.6 TM Evaluation (Phase 5+)

- The grader loads the specified initial tape configuration
- The grader runs the student's TM until it halts (or a maximum step count)
- The grader compares the final tape contents to the expected output

---

## 13. Data Table Specification

The data table panel (right side of the interface) adapts to the current circuit type and user settings.

### 13.1 Table Modes

The table has two independent toggle dimensions:

**Display mode** (I/O vs A/V):

- **I/O mode** — columns represent individual input and output wires; cells contain raw bit values (0 or 1)
- **A/V mode** — columns represent the *argument* (all inputs concatenated as a single numeral) and *value* (all outputs concatenated as a single numeral); cells contain the number represented under the current representational system

**Scope** (Local vs Global):

- **Local** — shows per-wire values (each IN and OUT wire gets its own row/column)
- **Global** — concatenates all input wires into a single numeral and all output wires into a single numeral

The natural combinations are:

- **I/O + Local** — the standard truth table with one column per wire
- **A/V + Global** — the argument/value table showing interpreted numbers (this is what the textbook calls the "argument-value profile" of the function)
- Other combinations are available but less commonly used

### 13.2 Representational System

The Tally/Binary toggle determines how bit strings are interpreted as numbers:

- **Tally (T):** a string of n bits where the first k bits (from the right) are 1 and the rest are 0 represents the number k. Example: "0011" represents 2.
- **Binary (B):** standard base-2 positional notation. Example: "0011" represents 3.

Changing the representational system recalculates the A/V table immediately. The I/O table is unaffected (it shows raw bits regardless).

### 13.3 CC Tables

For CCs, the table shows all possible input combinations (rows) and the corresponding outputs. There is no time dimension.

### 13.4 SC and FSM Tables

For SCs and FSMs, the table is a time-step table with time flowing **right to left** (t1 on the right, t2 to its left, etc.). This matches the textbook convention where numerals are read right-to-left.

Rows are labeled IN1, IN2, ..., OUT1, OUT2, ... (local view) or IN, OUT (global view).

New time columns are appended to the left as the simulation advances.

---

## Appendix A: Gate Symbol Reference

| Gate | Symbol | Inputs | Outputs | Truth Table |
|------|--------|--------|---------|-------------|
| NOT  | ¬      | 1      | 1       | 0→1, 1→0 |
| AND  | ∧      | 2      | 1       | 1∧1=1, else 0 |
| OR   | ∨      | 2      | 1       | 0∨0=0, else 1 |
| XOR  | ⊕      | 2      | 1       | equal→0, different→1 |

## Appendix B: Turbot I/O Encoding Reference

**Sensor Input (1 bit):**

| Bit | Meaning |
|-----|---------|
| 0   | Empty cell ahead |
| 1   | Block (or boundary) ahead |

**Motor Output (2 bits):**

| Bits | Command |
|------|---------|
| 00   | Stop |
| 01   | Turn left (90° CCW) |
| 10   | Turn right (90° CW) |
| 11   | Move forward |

## Appendix C: Mockup Index

| Mockup | Description | File |
|--------|-------------|------|
| Overall Layout (CC) | CC workspace with table dropdown | Mock_Ups-3_3.jpg |
| Overall Layout (SC) | SC workspace with MEM block | Mock_Ups-4_4.jpg |
| Wire Functionality | Wire crossing with bump, value propagation | Mock_Ups-5_4.jpg |
| Homework Menu | HW workspace with problem text | Mock_Ups-6_4.jpg |
| Menu + Error | File menu expanded, unsaved changes dialog | Mock_Ups-6_2.jpg |
| FSM | FSM editor with state diagram | Mock_Ups-9.jpg |
| Turbot | Split arena/internal circuitry view | Mock_Ups-10.jpg |
| Turing Machine | Tape with read/write head | Mock_Ups-6.jpg |
