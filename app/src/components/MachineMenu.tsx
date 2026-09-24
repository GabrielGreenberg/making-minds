import { useState, type CSSProperties, type MouseEvent } from 'react';
import type { BuildMode } from '../types';

// The sandbox's machine list — ONE list for both places a sheet is made: the
// tab bar's '+' (a new tab) and File ▸ New (a new workbook, task 028).

const MACHINE_OPTIONS: { mode: BuildMode; label: string }[] = [
  { mode: 'CC',  label: 'Logic Circuit' },
  { mode: 'FSM', label: 'Finite State Machine' },
  { mode: 'TM',  label: 'Turing Machine' },
];

// A turbot's brain is one of the four machine kinds (spec §9.3). The CC/SC
// distinction is real inside a turbot (it picks the brain's step semantics),
// so — unlike the sandbox machine list above, where SC is just "a Logic
// Circuit with MEM" — the brain picker names all four.
const TURBOT_BRAIN_OPTIONS: { mode: BuildMode; label: string }[] = [
  { mode: 'CC',  label: 'Logic Circuit brain' },
  { mode: 'SC',  label: 'Sequential Circuit brain' },
  { mode: 'FSM', label: 'Finite State Machine brain' },
  { mode: 'TM',  label: 'Turing Machine brain' },
];

const menuItemStyle: CSSProperties = {
  padding: '9px 16px',
  fontSize: 13,
  cursor: 'pointer',
  userSelect: 'none',
};

const hoverOn = (e: MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = '#f0f0f0');
const hoverOff = (e: MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = 'white');

/** The two-page machine picker: the machine list, then (after "Turbot") the
 *  brain-kind list for the turbot's inner machine. `onPickMachine` gets a
 *  machine's mode and label; `onPickTurbot` a turbot's brain. Items act on
 *  `activateOn`: the '+' menu (portaled) picks on press; a menu nested in a
 *  clickable parent (File ▸ New) on click, so the release lands nowhere. */
export function MachineMenu({
  onPickMachine,
  onPickTurbot,
  activateOn = 'pointerdown',
}: {
  onPickMachine: (mode: BuildMode, label: string) => void;
  onPickTurbot: (innerMode: BuildMode) => void;
  activateOn?: 'pointerdown' | 'click';
}) {
  const [brainPicker, setBrainPicker] = useState(false);
  const act = (fn: () => void) => (activateOn === 'click' ? { onClick: fn } : { onPointerDown: fn });

  if (!brainPicker) {
    return (
      <>
        {MACHINE_OPTIONS.map((opt) => (
          <div
            key={opt.mode}
            {...act(() => onPickMachine(opt.mode, opt.label))}
            style={menuItemStyle}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            {opt.label}
          </div>
        ))}
        <div
          {...act(() => setBrainPicker(true))}
          style={{ ...menuItemStyle, display: 'flex', justifyContent: 'space-between', gap: 12 }}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <span>Turbot</span>
          <span style={{ color: '#999' }}>{'›'}</span>
        </div>
      </>
    );
  }
  return (
    <>
      <div
        {...act(() => setBrainPicker(false))}
        style={{ ...menuItemStyle, color: '#666', borderBottom: '1px solid #eee' }}
        onMouseEnter={hoverOn}
        onMouseLeave={hoverOff}
      >
        {'‹'} Turbot — pick its brain
      </div>
      {TURBOT_BRAIN_OPTIONS.map((opt) => (
        <div
          key={opt.mode}
          {...act(() => onPickTurbot(opt.mode))}
          style={menuItemStyle}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          {opt.label}
        </div>
      ))}
    </>
  );
}
