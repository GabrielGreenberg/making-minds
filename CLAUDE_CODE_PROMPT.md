# Making Minds Platform — Implementation Prompt

## What This Is

You are building an interactive web platform for PHIL 133: "Making Minds," a philosophy/computation course. Students use the platform to build circuits, finite state machines, and grid-based agents ("turbots"), completing and submitting homework problem sets that are automatically graded.

## Key Files in This Folder

- **`spec/PHIL_133_Platform_Spec_v2.md`** — The full platform spec. Read this first, thoroughly. It is your source of truth for all behavior, layout, and feature decisions.
- **`mm_textbook.pdf`** — The course textbook. Use it to understand the pedagogy and notation (especially chapters on combinatorial circuits, sequential circuits, FSMs, and turbots). Consult it when the spec references textbook conventions.
- **`problem sets/hw1.pdf` through `hw7.pdf`** — The actual homework assignments students will complete on the platform. Use these to understand the problem formats, notation, and what the grading system needs to handle.
- **`spec/Private & Shared/PHIL 133 Platform Spec/Mock_Ups-*.jpg`** — UI mockups showing the intended layout for CC workspaces, SC workspaces, wire behavior, homework menus, FSM editor, turbot split view, and Turing machines.

## Implementation Approach

Build this as a **single-page web application** (React + TypeScript recommended). The platform runs entirely in the browser — no backend server. Files are saved/loaded via browser download/upload of JSON.

**Keep evaluation logic framework-agnostic.** All circuit/FSM evaluation lives in `app/src/engine/` (pure TypeScript, no React/Zustand/DOM) so the same code can run headlessly for server-side autograding later. The store and UI are thin wrappers over the engine.

**Follow the six-phase structure in the spec:**

1. **Phase 1: Combinatorial Circuits** — Logic gates (NOT, AND, OR), inputs/outputs, wiring with validation, I/O and A/V tables with tally/binary toggle, boxed circuits (including built-in XOR and Half-Adder), drag-and-drop canvas with snap-to-grid
2. **Phase 2: Sequential Circuits** — MEM block (M_IN on right, M_OUT on left), clock/time model, sequential time-step table with right-to-left time flow
3. **Phase 3: Finite State Machines** — State node editor, transition arrows with input:output labels, FSM simulation with state highlighting, state table view
4. **Phase 4: Turbots** — Split-panel workspace (arena above, internal circuitry below), grid-based arena, hardcoded sensor/motor encoding (see spec §9.2 and Appendix B), live-linked internal circuit
5. **Phase 5: Turing Machines** — Infinite tape, read/write head, TM transition labels, TM operation cycle
6. **Phase 6: TM Turbots** — Turbot with TM-based internal circuitry

**Start with Phase 1.** Get the canvas, component library, wiring system, circuit validation, gate evaluation, I/O/A/V tables, and boxed circuits working before moving on.

## Critical Design Details (Don't Miss These)

- **Directionality**: All components have input ports on the left, output ports on the right. Signal flows left-to-right. This applies to gates, MEM blocks, and boxed circuits.
- **Wire rules**: Splitting allowed (one output → multiple inputs), merging forbidden (two outputs → one input). Crossings show a bump/arc. Splits show a dot. Wire color: black = 0, red = 1.
- **Circuit validation**: Warn (don't block) on loops, merged links, and free ends. Show red highlight + tooltip.
- **I/O vs A/V tables**: I/O shows raw bits per wire. A/V shows concatenated numerals interpreted under tally or binary. Local scope = per-wire. Global scope = all inputs concatenated into one number, all outputs into one number.
- **Time flows right-to-left** in SC and FSM tables (t1 on the right, later steps extend left).
- **MEM block**: M_OUT (left) sends stored value into circuit. M_IN (right) receives new value from circuit. All memory initializes to 0. Display stored value during simulation.
- **Input labels**: Assigned at creation, permanent. New inputs get next sequential number regardless of vertical position.
- **Turbot encoding is hardcoded**: Sensor input — 0: empty, 1: block. Motor output — 00: stop, 01: left, 10: right, 11: forward.
- **Homework JSON**: The spec (§1.5) defines a homework JSON schema with test vectors for automatic grading. The grader compares student circuit outputs against expected outputs.
- **Topological evaluation**: CCs use topological sort for gate evaluation order. Propagation is instantaneous.

## What Good Looks Like

Look at the mockup images to understand the visual target. The interface should feel like a clean circuit simulator with a left-side component palette, center canvas, and right-side data table. It should be intuitive for philosophy students who have no engineering background — drag and drop, clear visual feedback, helpful error messages.
