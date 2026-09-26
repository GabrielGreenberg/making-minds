// The canvas's floating palette and its Boxes pop-out (task 054; the design
// memo is docs/buildout/designs/editor-workbench.md §Floating palette,
// §Boxes). It replaces the 64px parts column. What it offers, dims, pins and
// where it sits are palette.ts's pure decisions; placing is the store's ONE
// path (`placeTool`), whose actions carry the lock (law 3) — nothing here
// gates on it.
//
// Every tile — a part, a pinned box, a box row in the pop-out — is used the
// same two ways: click to arm it (then click the canvas; Shift keeps it
// armed, Esc disarms), or drag it onto the canvas, where a 55% ghost of the
// part follows the pointer (CircuitCanvas draws it from usePaletteDrag) and
// the drop places it centred on the pointer. A box row dragged onto the
// palette pins it there.

import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  useStore,
  selectEffectiveMode,
  selectAllowedComponents,
  selectPlaceableBoxKinds,
  selectMayHoldMemory,
} from '../store';
import {
  DRAG_THRESHOLD,
  boxRows,
  clampPalette,
  clientToCanvas,
  paletteHasBoxes,
  paletteLength,
  paletteOrientation,
  paletteParts,
  palettePlacementFromPrefs,
  partRefusal,
  pinnedRows,
  pinsFromPrefs,
  pinsPrefKey,
  sameTool,
  togglePin,
  PALETTE_PREF_KEY,
  type ArmedTool,
  type BoxRow,
  type PalettePart,
  type PalettePlacement,
} from '../palette';
import { problemNumber } from '../problemSet';
import { loadUiPrefs, saveUiPref } from '../uiPrefs';
import { usePasteGuard } from '../usePasteGuard';
import { usePaletteDrag } from './paletteDrag';
import type { ComponentType } from '../types';

// ── Icons (36×26, stroked in the ink colour — memo §Tile icons) ─────────────

function PartIcon({ type }: { type: ComponentType }) {
  switch (type) {
    case 'INPUT':
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <rect x="4" y="5" width="16" height="16" />
          <path d="M20 13 H30" />
          <circle className="pal-ico-dot" cx="30" cy="13" r="2.2" />
        </svg>
      );
    case 'OUTPUT':
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <rect x="16" y="5" width="16" height="16" />
          <path d="M6 13 H16" />
          <circle className="pal-ico-dot" cx="6" cy="13" r="2.2" />
        </svg>
      );
    case 'AND':
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <path d="M8 3 H18 A10 10 0 0 1 18 23 H8 Z" />
          <path d="M13 16 L16.5 9.5 L20 16" />
        </svg>
      );
    case 'OR':
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <path d="M7 3 H15 Q27 4 31 13 Q27 22 15 23 H7 Q11 13 7 3 Z" />
          <path d="M14 10 L17.5 16.5 L21 10" />
        </svg>
      );
    case 'NOT':
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <polygon points="9,3 30,13 9,23" />
          <path d="M12 11.5 H17.5 V15" />
        </svg>
      );
    case 'STATE':
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <circle cx="18" cy="13" r="10" />
          <text x="18" y="16.5" textAnchor="middle">S</text>
        </svg>
      );
    default:
      // MEM (not designed yet — the memo keeps the tile) and anything else.
      return (
        <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
          <rect className="pal-ico-fill" x="8" y="4" width="20" height="18" />
          <path d="M3 13 H8 M28 13 H33" />
          <text x="18" y="16.5" textAnchor="middle">{type === 'MEM' ? 'M' : type}</text>
        </svg>
      );
  }
}

/** A box: its own port counts as stubs (up to four a side). */
function BoxIcon({ numIn, numOut }: { numIn: number; numOut: number }) {
  const stubs = (n: number, x1: number, x2: number) =>
    Array.from({ length: Math.min(n, 4) }, (_, i) => {
      const y = 4 + (18 * (i + 1)) / (Math.min(n, 4) + 1);
      return `M${x1} ${y} H${x2}`;
    }).join(' ');
  return (
    <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
      <rect className="pal-ico-fill" x="8" y="4" width="20" height="18" />
      {numIn > 0 && <path d={stubs(numIn, 3, 8)} />}
      {numOut > 0 && <path d={stubs(numOut, 28, 33)} />}
    </svg>
  );
}

function BoxesIcon() {
  return (
    <svg className="pal-ico" viewBox="0 0 36 26" aria-hidden>
      <rect x="6" y="8" width="18" height="14" />
      <rect className="pal-ico-fill" x="11" y="3" width="18" height="14" />
      <path className="pal-ico-dot" d="M28 20 H33 L30.5 23.5 Z" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg className="pal-grip-ico" viewBox="0 0 12 12" aria-hidden>
      {[[2, 2], [10, 2], [6, 6], [2, 10], [10, 10]].map(([cx, cy]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="1.2" />
      ))}
    </svg>
  );
}

function TurnIcon() {
  return (
    <svg className="pal-ico pal-turn-ico" viewBox="0 0 14 14" aria-hidden>
      <path d="M11.5 7 A4.5 4.5 0 1 1 7 2.5" />
      <path d="M6.5 0.5 L8.8 2.5 L6.5 4.5" />
    </svg>
  );
}

// ── Dragging a tile ─────────────────────────────────────────────────────────

// A drag ends in a pointerup whose click (when it ends on the tile it started
// on) must not arm the tile as well. The click follows in the same task, so
// the flag lives exactly until then.
let suppressNextClick = false;

/** What is under the pointer: the palette, the pop-out, or open canvas. */
function hitAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  const onPalette = !!el?.closest('.pal');
  const onPopout = !!el?.closest('.pal-pop');
  const canvas = el?.closest<HTMLElement>('.canvas-container') ?? null;
  return { onPalette, overCanvas: !!canvas && !onPalette && !onPopout, canvas };
}

/**
 * Start tracking a press on a tile. Moving past the threshold makes it a drag
 * (the ghost shows over open canvas); releasing over the canvas places the
 * tool there, releasing a pop-out box over the palette pins it. A press that
 * never moved is a click, which the tile's onClick handles (so the keyboard
 * arms a tile the same way).
 */
function startTileDrag(e: ReactPointerEvent, tool: ArmedTool, pinnable: boolean, onPin: (boxId: string) => void) {
  if (e.button !== 0) return;
  e.preventDefault(); // no text selection, no native drag
  const start = { x: e.clientX, y: e.clientY };
  let moved = false;

  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= DRAG_THRESHOLD) return;
    moved = true;
    const hit = hitAt(ev.clientX, ev.clientY);
    usePaletteDrag.setState({
      drag: {
        tool,
        clientX: ev.clientX,
        clientY: ev.clientY,
        overCanvas: hit.overCanvas,
        pinTarget: pinnable && hit.onPalette,
      },
    });
  };
  const finish = (ev: PointerEvent, cancelled: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    usePaletteDrag.setState({ drag: null });
    if (!moved || cancelled) return;
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 0);
    const hit = hitAt(ev.clientX, ev.clientY);
    if (pinnable && hit.onPalette && typeof tool === 'object') {
      onPin(tool.box);
      return;
    }
    if (hit.overCanvas && hit.canvas) {
      const s = useStore.getState();
      const at = clientToCanvas({ x: ev.clientX, y: ev.clientY }, hit.canvas.getBoundingClientRect(), s);
      s.placeTool(tool, at.x, at.y);
    }
  };
  const up = (ev: PointerEvent) => finish(ev, false);
  const cancel = (ev: PointerEvent) => finish(ev, true);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/** A tile's click: arm it, or disarm it if it is the armed tool. */
function armToggle(tool: ArmedTool) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  const s = useStore.getState();
  s.setSelectedTool(sameTool(s.selectedTool, tool) ? null : tool);
}

// ── The palette ─────────────────────────────────────────────────────────────

interface TileProps {
  tool: ArmedTool;
  label: string;
  icon: React.ReactNode;
  refusal: string | null;
  armed: boolean;
  title: string;
  onPin: (boxId: string) => void;
}

function Tile({ tool, label, icon, refusal, armed, title, onPin }: TileProps) {
  return (
    <button
      type="button"
      className={`pal-tile${armed ? ' pal-tile--armed' : ''}${refusal ? ' pal-tile--off' : ''}`}
      title={refusal ?? title}
      aria-disabled={refusal ? true : undefined}
      aria-pressed={armed}
      onPointerDown={(e) => { if (!refusal) startTileDrag(e, tool, false, onPin); }}
      onClick={() => { if (!refusal) armToggle(tool); }}
    >
      {icon}
      <span className="pal-tile-label">{label}</span>
    </button>
  );
}

export function Palette({ canvasW, canvasH }: { canvasW: number; canvasH: number }) {
  const effectiveMode = useStore(selectEffectiveMode);
  const allowed = useStore(selectAllowedComponents);
  const placeableKinds = useStore(selectPlaceableBoxKinds);
  const mayHoldMemory = useStore(selectMayHoldMemory);
  const library = useStore((s) => s.confirmedBoxLibrary);
  const armedTool = useStore((s) => s.selectedTool);
  const popoutOpen = useStore((s) => s.boxesPopoutOpen);
  const assignment = useStore((s) => s.assignment);
  const activeTabId = useStore((s) => s.activeTabId);
  const pinTarget = usePaletteDrag((s) => s.drag?.pinTarget ?? false);

  // Where it sits and which way it runs (a per-browser pref, F7).
  const [placement, setPlacement] = useState<PalettePlacement>(() => palettePlacementFromPrefs(loadUiPrefs()));
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((prev) =>
      prev.w === el.offsetWidth && prev.h === el.offsetHeight ? prev : { w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pinned boxes: per homework (per tab in the sandbox), a per-browser pref (F12).
  const pinsKey = pinsPrefKey(assignment ? { assignmentId: assignment.id } : { tabId: activeTabId });
  const [pinState, setPinState] = useState(() => ({ key: pinsKey, ids: pinsFromPrefs(loadUiPrefs(), pinsKey) }));
  // Another homework or tab: its own pins (React's adjust-state-while-rendering).
  if (pinState.key !== pinsKey) setPinState({ key: pinsKey, ids: pinsFromPrefs(loadUiPrefs(), pinsKey) });
  const pins = pinState.key === pinsKey ? pinState.ids : [];
  const setPinned = (boxId: string, on: boolean) => {
    const ids = togglePin(pins, boxId, on);
    saveUiPref(pinsKey, ids);
    setPinState({ key: pinsKey, ids });
  };
  const pin = (boxId: string) => setPinned(boxId, true);

  const problemOf = (origin: number | undefined): string | null => {
    if (!assignment || origin === undefined) return null;
    const i = assignment.questions.findIndex((q) => q.id === origin);
    return i < 0 ? null : problemNumber(assignment.questions[i].label, i);
  };

  const parts = paletteParts(effectiveMode, mayHoldMemory);
  const hasBoxes = paletteHasBoxes(effectiveMode);
  const rows = hasBoxes ? boxRows(library, placeableKinds, allowed, pins, problemOf) : [];
  const pinned = pinnedRows(pins, rows);
  const groups: PalettePart[][] = [
    parts.filter((p) => p.group === 'io' || p.group === 'states'),
    parts.filter((p) => p.group === 'gates'),
  ].filter((g) => g.length > 0);

  // Which way it runs: the student's choice, unless only the other way fits
  // this canvas (palette.ts paletteOrientation). The turn button flips what
  // is shown, and stands down when the other way would not fit.
  const tileCount = parts.length + (hasBoxes ? pinned.length + 1 : 0);
  const dividerCount = groups.length - 1 + (hasBoxes ? 1 : 0) + 1;
  const length = paletteLength(tileCount, dividerCount);
  const canvas = { w: canvasW, h: canvasH };
  const horiz = paletteOrientation(placement.horiz, length, canvas);
  const canTurn = paletteOrientation(!horiz, length, canvas) === !horiz;
  const canvasKnown = canvasW > 0 && canvasH > 0 && size.w > 0;
  const shown = canvasKnown ? clampPalette(placement, size, canvas) : placement;

  // Moving it: the grip drags it (clamped as it goes); the pref is written on release.
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, px: shown.x, py: shown.y };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging(true);
    let last = { x: shown.x, y: shown.y };
    const move = (ev: PointerEvent) => {
      last = clampPalette({ x: start.px + ev.clientX - start.x, y: start.py + ev.clientY - start.y }, size, { w: canvasW, h: canvasH });
      setPlacement((p) => ({ ...p, ...last }));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragging(false);
      setPlacement((p) => {
        const next = { ...p, ...last };
        saveUiPref(PALETTE_PREF_KEY, next);
        return next;
      });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const turn = () => {
    const next = { x: shown.x, y: shown.y, horiz: !horiz };
    saveUiPref(PALETTE_PREF_KEY, next);
    setPlacement(next); // re-clamped against its new shape on the next render
  };

  const armed = (tool: ArmedTool) => sameTool(armedTool, tool);
  const machine = effectiveMode === 'FSM' ? 'state machine' : effectiveMode === 'TM' ? 'Turing machine' : 'circuit';

  // The pop-out: 8px beside the palette (below it when horizontal), kept in the canvas.
  const POPOUT_W = 260;
  const popLeft = horiz ? shown.x : shown.x + size.w + 8;
  const popTop = horiz ? shown.y + size.h + 8 : shown.y;
  const popStyle = {
    left: canvasW > 0 ? Math.max(8, Math.min(popLeft, canvasW - POPOUT_W - 8)) : popLeft,
    top: popTop,
    maxHeight: canvasH > 0 ? Math.max(160, canvasH - popTop - 8) : undefined,
  };

  return (
    <>
      <div
        ref={ref}
        className={`pal${horiz ? ' pal--horiz' : ''}${dragging ? ' pal--dragging' : ''}${pinTarget ? ' pal--pin-target' : ''}`}
        style={{ left: shown.x, top: shown.y }}
        role="toolbar"
        aria-label={`Parts for this ${machine}`}
        onContextMenu={(e) => {
          // The canvas's disarm gesture works here too.
          const s = useStore.getState();
          if (s.selectedTool !== null) {
            e.preventDefault();
            s.setSelectedTool(null);
          }
        }}
      >
        <div className="pal-grip" title="Drag to move the toolbar" onPointerDown={onGripDown}>
          <GripIcon />
        </div>
        {groups.map((group, gi) => (
          <div key={gi} className="pal-groupwrap">
            {gi > 0 && <div className="pal-div" />}
            <div className="pal-group">
              {group.map((part) => (
                <Tile
                  key={part.type}
                  tool={part.type}
                  label={part.label}
                  icon={<PartIcon type={part.type} />}
                  refusal={partRefusal(part, allowed)}
                  armed={armed(part.type)}
                  title={`${part.label}: drag onto the canvas, or click and then click the canvas`}
                  onPin={pin}
                />
              ))}
            </div>
          </div>
        ))}
        {hasBoxes && (
          <>
            <div className="pal-div" />
            <div className="pal-group">
              {pinned.map((row) => (
                <Tile
                  key={row.box.id}
                  tool={{ box: row.box.id }}
                  label={row.box.name}
                  icon={<BoxIcon numIn={row.numIn} numOut={row.numOut} />}
                  refusal={row.refusal}
                  armed={armed({ box: row.box.id })}
                  title={`${row.box.name} (${row.meta}): drag onto the canvas, or click and then click the canvas`}
                  onPin={pin}
                />
              ))}
              <button
                type="button"
                className={`pal-tile${popoutOpen ? ' pal-tile--armed' : ''}`}
                title="Your boxes"
                aria-expanded={popoutOpen}
                onClick={() => useStore.getState().setBoxesPopoutOpen(!popoutOpen)}
              >
                <BoxesIcon />
                <span className="pal-tile-label">Boxes</span>
                {rows.length > 0 && <span className="pal-badge">{rows.length}</span>}
              </button>
            </div>
          </>
        )}
        <div className="pal-div" />
        <button
          type="button"
          className="pal-turn"
          disabled={!canTurn}
          title={!canTurn ? 'No room to turn the toolbar here' : horiz ? 'Stand the toolbar up' : 'Lay the toolbar flat'}
          onClick={turn}
        >
          <TurnIcon />
        </button>
      </div>
      {hasBoxes && popoutOpen && (
        <BoxesPopout rows={rows} style={popStyle} armedTool={armedTool} onPin={pin} setPinned={setPinned} />
      )}
    </>
  );
}

// ── The Boxes pop-out ───────────────────────────────────────────────────────

function BoxesPopout({ rows, style, armedTool, onPin, setPinned }: {
  rows: BoxRow[];
  style: React.CSSProperties;
  armedTool: ArmedTool | null;
  onPin: (boxId: string) => void;
  setPinned: (boxId: string, on: boolean) => void;
}) {
  return (
    <div className="pal-pop" style={style} role="group" aria-label="Your boxes">
      <div className="pal-pop-head">
        <span className="pal-pop-title">Your boxes</span>
        <button type="button" className="pal-pop-close" title="Close" aria-label="Close" onClick={() => useStore.getState().setBoxesPopoutOpen(false)}>
          ×
        </button>
      </div>
      <div className="pal-pop-list">
        {rows.length === 0 ? (
          <p className="pal-pop-empty">Boxes you make are kept here and can be used in later questions.</p>
        ) : (
          rows.map((row) => (
            <BoxRowView key={row.box.id} row={row} armed={sameTool(armedTool, { box: row.box.id })} onPin={onPin} setPinned={setPinned} />
          ))
        )}
      </div>
      <div className="pal-pop-foot">
        <button
          type="button"
          className={`pal-newbox${armedTool === 'NEW_BOX' ? ' pal-newbox--armed' : ''}`}
          aria-pressed={armedTool === 'NEW_BOX'}
          title="Draw a rectangle around the parts to box"
          onClick={() => armToggle('NEW_BOX')}
        >
          New box
        </button>
        <p className="pal-pop-note">Drag a box onto the toolbar to keep it there.</p>
      </div>
    </div>
  );
}

function BoxRowView({ row, armed, onPin, setPinned }: {
  row: BoxRow;
  armed: boolean;
  onPin: (boxId: string) => void;
  setPinned: (boxId: string, on: boolean) => void;
}) {
  const { box, refusal } = row;
  const tool: ArmedTool = { box: box.id };
  const [editing, setEditing] = useState(false);
  // Box names are part of the graded circuit: the rename wears the provenance
  // guard like every assignment answer field (law 8).
  const { ref: pasteGuardRef, notice: pasteNotice } = usePasteGuard();

  const commitRename = (value: string) => {
    const name = value.trim();
    setEditing(false);
    if (!name || name === box.name) return;
    const err = useStore.getState().renameBox(box.id, name);
    if (err) alert(err);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={`pal-row${armed ? ' pal-row--armed' : ''}${refusal ? ' pal-row--off' : ''}`}
      title={refusal ?? `${box.name}: drag onto the canvas or the toolbar, or click and then click the canvas`}
      role="button"
      tabIndex={0}
      aria-disabled={refusal ? true : undefined}
      aria-pressed={armed}
      onPointerDown={(e) => { if (!refusal && !editing) startTileDrag(e, tool, true, onPin); }}
      onClick={() => { if (!refusal && !editing) armToggle(tool); }}
      onKeyDown={(e) => {
        if (editing || refusal || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          armToggle(tool);
        }
      }}
    >
      <span className="pal-row-icon"><BoxIcon numIn={row.numIn} numOut={row.numOut} /></span>
      <span className="pal-row-text">
        {editing ? (
          <span className="pal-row-rename" onPointerDown={stop} onClick={stop}>
            <input
              autoFocus
              ref={pasteGuardRef}
              defaultValue={box.name}
              aria-label="Box name"
              onBlur={(e) => commitRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                // Restore before blurring: the blur handler is what commits.
                if (e.key === 'Escape') {
                  (e.target as HTMLInputElement).value = box.name;
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {pasteNotice && <span className="pal-row-notice" role="status">{pasteNotice}</span>}
          </span>
        ) : (
          <span className="pal-row-name">
            <span className="pal-row-label">{box.name}</span>
            <span className="pal-row-tools" onPointerDown={stop}>
              <button type="button" title="Rename box" aria-label={`Rename ${box.name}`} onClick={(e) => { stop(e); setEditing(true); }}>
                ✎
              </button>
              <button
                type="button"
                title="Remove from your boxes (copies already placed stay)"
                aria-label={`Remove ${box.name} from your boxes`}
                onClick={(e) => { stop(e); useStore.getState().removeConfirmedBox(box.id); }}
              >
                ✕
              </button>
            </span>
          </span>
        )}
        <span className="pal-row-meta">{row.meta}</span>
      </span>
      <button
        type="button"
        className={`pal-pin${row.pinned ? ' pal-pin--on' : ''}`}
        title={row.pinned ? 'Take it off the toolbar' : 'Keep it on the toolbar'}
        onPointerDown={stop}
        onClick={(e) => { stop(e); setPinned(box.id, !row.pinned); }}
      >
        {row.pinned ? 'On toolbar' : 'Add to toolbar'}
      </button>
    </div>
  );
}
