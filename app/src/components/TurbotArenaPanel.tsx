// The turbot arena ("Map", spec §9.1) with the live simulated turbot pose,
// plus the movement-cycle controls. Mounted in the right data panel
// (DataTable's turbot branch), below the question statement and above the
// machine/history tables. The simulation itself lives in the store's turbot
// slice; the canvas column stays the inner machine's normal editor.

import { useStore, selectTurbotArena, selectTurbotInnerMode, selectTmNotation } from '../store';
import {
  senseAhead,
  senseAheadSymbol,
  turbotTMReadSymbols,
  TURBOT_FORWARD,
  TURBOT_TURN_RIGHT,
  TURBOT_TURN_LEFT,
} from '../engine/turbot';
import type { BuildMode, TMNotation } from '../types';
import { ArenaCanvas } from './ArenaCanvas';

/**
 * The percept/motor glossary: what the brain can read and output, so
 * students know how to label state transitions. TM brains get the
 * textbook's internal/external vocabularies (internal alphabet per the
 * question's encoding: binary {0,1,*}, unary {0,1}); circuit brains get the
 * 1-bit sensor and the 2-bit motor codes (FSM: one output bit). Outputs are
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
      : innerMode === 'FSM'
        ? [
            {
              input: ['0 = empty/food ahead', '1 = block ahead'],
              output: ['0 = both motors off', '1 = both motors on'],
            },
          ]
        : [
            {
              // The two output wires drive the wheel motors: OUT1 = left
              // wheel, OUT2 = right wheel.
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
      </div>
      {/* Map column + glossary sit level when the panel is wide enough;
          flex-wrap drops the glossary below the map when it isn't. */}
      <div className="turbot-map-row">
        <div className="turbot-map-col">
          <div className="turbot-arena-scroll">
            <ArenaCanvas arena={arena} turbot={turbotState} cellSize={28} />
          </div>
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
        </div>
        <TurbotGlossary innerMode={innerMode} notation={notation} />
      </div>
    </div>
  );
}
