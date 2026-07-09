// The turbot arena ("Map", spec §9.1) with the live simulated turbot pose,
// plus the movement-cycle controls. Mounted in the right data panel
// (DataTable's turbot branch), below the question statement and above the
// machine/history tables. The simulation itself lives in the store's turbot
// slice; the canvas column stays the inner machine's normal editor.

import { useEffect, useRef, useState } from 'react';
import { useStore, selectTurbotArena, selectTurbotInnerMode, selectTmNotation } from '../store';
import {
  senseAhead,
  senseAheadSymbol,
  turbotTMReadSymbols,
  TURBOT_FORWARD,
  TURBOT_TURN_RIGHT,
  TURBOT_TURN_LEFT,
} from '../engine/turbot';
import { setArenaCell, placeStart, resizeArena, MAX_ARENA_SIZE } from '../instructor/arenaEditing';
import type { BuildMode, TMNotation } from '../types';
import { ArenaCanvas } from './ArenaCanvas';

// Sandbox map editing reuses the instructor arena editor's tool set (pure
// helpers in instructor/arenaEditing.ts; ArenaCanvas supplies the clickable
// grid). Inside a question the arena is instructor-authored and read-only.
type MapTool = 'block' | 'goal' | 'erase' | 'start';

const MAP_TOOLS: { tool: MapTool; label: string; hint: string }[] = [
  { tool: 'block', label: 'Block', hint: 'Paint walls' },
  { tool: 'goal',  label: 'Goal',  hint: 'Paint goal (food) cells' },
  { tool: 'erase', label: 'Erase', hint: 'Clear cells' },
  { tool: 'start', label: 'Start', hint: 'Move the turbot start; click its cell again to rotate' },
];

/**
 * The percept/motor glossary: what the brain can read and output, so
 * students know how to label state transitions. TM brains get the
 * textbook's internal/external vocabularies (internal alphabet per the
 * question's encoding: binary {0,1,*}, unary {0,1}); CC/SC/FSM brains get
 * the 1-bit sensor and the 2-bit motor codes (an FSM brain's transition
 * outputs are the same "ij" codes as CC/SC output wires). Outputs are
 * described as motor states — which wheel motors are on — not as the
 * resulting movement.
 */
function TurbotGlossary({ innerMode, notation }: { innerMode: BuildMode; notation: TMNotation }) {
  const rows: { input: string[]; output: string[]; title?: string }[] =
    innerMode === 'TM'
      ? [
          {
            title: 'External states (square)',
            input: ['B = see block', 'E = see empty', 'F = see food'],
            output: [
              `${TURBOT_FORWARD} = both motors on`,
              `${TURBOT_TURN_RIGHT} = left motor on`,
              `${TURBOT_TURN_LEFT} = right motor on`,
            ],
          },
          {
            title: 'Internal states (circle)',
            input: turbotTMReadSymbols(notation).map((s) => `${s} = read ${s}`),
            output: [
              ...turbotTMReadSymbols(notation).map((s) => `${s} = write ${s}`),
              'R = move right',
              'L = move left',
            ],
          },
        ]
      : [
          {
            // The two motor bits ij drive the wheel motors: i = left wheel,
            // j = right wheel (CC/SC: the OUT1/OUT2 wires; FSM: the
            // transition label's output half).
            input: ['0 = empty/food ahead', '1 = block ahead'],
            output: [
              '00 = both motors off',
              '01 = right motor on',
              '10 = left motor on',
              '11 = both motors on',
            ],
          },
        ];

  return (
    <div className="turbot-glossary">
      {rows.map((r, i) => (
        <div key={i} className="turbot-glossary-group">
          {r.title && <div className="turbot-glossary-title">{r.title}</div>}
          <div className="turbot-glossary-cols">
            <div>
              <div className="turbot-glossary-head">Input</div>
              {r.input.map((line) => (
                <div key={line} className="turbot-glossary-line">{line}</div>
              ))}
            </div>
            <div>
              <div className="turbot-glossary-head">Output</div>
              {r.output.map((line) => (
                <div key={line} className="turbot-glossary-line">{line}</div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TurbotArenaPanel() {
  const arena = useStore(selectTurbotArena);
  const turbotState = useStore((s) => s.turbotState);
  const turbotHistory = useStore((s) => s.turbotHistory);
  const turbotRunning = useStore((s) => s.turbotRunning);
  const turbotHalted = useStore((s) => s.turbotHalted);
  const turbotStopReason = useStore((s) => s.turbotStopReason);
  const turbotStep = useStore((s) => s.turbotStep);
  const turbotRun = useStore((s) => s.turbotRun);
  const turbotPause = useStore((s) => s.turbotPause);
  const turbotReset = useStore((s) => s.turbotReset);

  const innerMode = useStore(selectTurbotInnerMode);
  const notation = useStore(selectTmNotation);

  // Sandbox turbot tabs own their arena, so the Map is editable there;
  // a question's arena is part of the assignment and stays read-only.
  const isSandbox = useStore((s) => s.assignment === null);
  const setTabArena = useStore((s) => s.setTabArena);
  const [editingMap, setEditingMap] = useState(false);
  const [mapTool, setMapTool] = useState<MapTool>('block');

  const handleMapClick = (x: number, y: number) => {
    switch (mapTool) {
      case 'block': setTabArena(setArenaCell(arena, x, y, 'block')); break;
      case 'goal':  setTabArena(setArenaCell(arena, x, y, 'goal')); break;
      case 'erase': setTabArena(setArenaCell(arena, x, y, 'empty')); break;
      case 'start': setTabArena(placeStart(arena, x, y)); break;
    }
  };

  // Follow the turbot: a big arena (30×30 ≈ 844px of grid) far outgrows the
  // Map's scroll container, so every pose change nudges the container's
  // scroll just enough to keep the turbot cell in view. Scoped to the Map's
  // own scrollport — the outer data panel is never scrolled.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Manual-scroll guard: don't fight the user. Skip auto-follow while a
  // pointer is held down on the container (scrollbar drag) or right after a
  // wheel scroll.
  const manualScroll = useRef({ pointerDown: false, lastWheelAt: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onPointerDown = () => { manualScroll.current.pointerDown = true; };
    const onPointerUp = () => { manualScroll.current.pointerDown = false; };
    const onWheel = () => { manualScroll.current.lastWheelAt = Date.now(); };
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (manualScroll.current.pointerDown) return;
    if (Date.now() - manualScroll.current.lastWheelAt < 1500) return;
    // Locate the turbot's rendered cell (robust to cell borders/padding,
    // unlike arithmetic from cellSize alone; ArenaCanvas stays presentational).
    const cell = container.querySelector('.arena-turbot')?.closest('.arena-cell');
    if (!(cell instanceof HTMLElement)) return;
    const c = container.getBoundingClientRect();
    const t = cell.getBoundingClientRect();
    const margin = 12; // keep a sliver of the neighboring cells visible
    let dx = 0;
    let dy = 0;
    if (t.left < c.left + margin) dx = t.left - (c.left + margin);
    else if (t.right > c.right - margin) dx = t.right - (c.right - margin);
    if (t.top < c.top + margin) dy = t.top - (c.top + margin);
    else if (t.bottom > c.bottom - margin) dy = t.bottom - (c.bottom - margin);
    if (dx !== 0 || dy !== 0) container.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  }, [turbotState.x, turbotState.y]);

  const cycle = turbotHistory.length;
  // Circuit brains see the 1-bit sensor; a turbot TM's external states
  // sense B (block) / E (empty) / F (food).
  const sensor = innerMode === 'TM'
    ? senseAheadSymbol(arena, turbotState)
    : senseAhead(arena, turbotState);

  // For a turbot TM, halting on no-transition IS the normal stop (textbook).
  const stopLabel =
    turbotStopReason === 'motor' ? 'STOPPED (motor 00)' :
    turbotStopReason === 'brain' ? (innerMode === 'TM' ? 'HALTED' : 'HALTED (no transition)') :
    turbotStopReason === 'limit' ? 'STOPPED (step limit)' : null;

  return (
    <div className="table-section">
      <div className="table-section-label">
        <span>Map</span>
        {isSandbox && (
          <button
            className="map-edit-toggle"
            onClick={() => {
              if (!editingMap && turbotRunning) turbotPause();
              setEditingMap((e) => !e);
            }}
            title={editingMap ? 'Back to running the turbot' : 'Paint blocks/goals and place the start'}
          >
            {editingMap ? 'Done' : 'Edit map'}
          </button>
        )}
      </div>
      {/* Map column + glossary sit level when the panel is wide enough;
          flex-wrap drops the glossary below the map when it isn't. */}
      <div className="turbot-map-row">
        <div className="turbot-map-col">
          <div className="turbot-arena-scroll" ref={scrollRef}>
            <ArenaCanvas
              arena={arena}
              turbot={turbotState}
              cellSize={28}
              onCellClick={editingMap ? handleMapClick : undefined}
            />
          </div>
          {editingMap ? (
            <>
              <div className="turbot-arena-controls">
                {MAP_TOOLS.map((t) => (
                  <button
                    key={t.tool}
                    className={'action-btn' + (mapTool === t.tool ? ' map-tool-active' : '')}
                    onClick={() => setMapTool(t.tool)}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="turbot-arena-status">
                <label>
                  {'W '}
                  <input
                    type="number"
                    className="map-size-input"
                    min={1}
                    max={MAX_ARENA_SIZE}
                    value={arena.width}
                    onChange={(e) => setTabArena(resizeArena(arena, Number(e.target.value), arena.height))}
                  />
                </label>
                <label>
                  {'H '}
                  <input
                    type="number"
                    className="map-size-input"
                    min={1}
                    max={MAX_ARENA_SIZE}
                    value={arena.height}
                    onChange={(e) => setTabArena(resizeArena(arena, arena.width, Number(e.target.value)))}
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="turbot-arena-controls">
                <button className="action-btn" onClick={turbotStep} disabled={turbotRunning || turbotHalted}>
                  Step
                </button>
                {turbotRunning ? (
                  <button className="action-btn" onClick={turbotPause}>Pause</button>
                ) : (
                  <button className="action-btn" onClick={turbotRun} disabled={turbotHalted}>Run</button>
                )}
                <button className="action-btn" onClick={turbotReset} disabled={turbotRunning}>
                  Reset
                </button>
              </div>
              <div className="turbot-arena-status">
                <span>cycle {cycle}</span>
                <span>sensor: {sensor}</span>
                {stopLabel && <span className="turbot-arena-stop">{stopLabel}</span>}
              </div>
            </>
          )}
        </div>
        <TurbotGlossary innerMode={innerMode} notation={notation} />
      </div>
    </div>
  );
}
