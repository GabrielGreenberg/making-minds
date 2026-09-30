// The editor's one panel divider (task 078; design memo editor-workbench.md
// §Dividers): the two column rules EditorShell draws beside its side panels
// and the row rule between the question panel's problem and its list. One
// pointer and keyboard behaviour on either axis — a drag is live and stored
// on release, the arrow keys along the axis step it — while the caller owns
// the value: `drag` maps the pointer's travel to one, `step` a key press.
// Its own module because both EditorShell and QuestionPanel draw it (the
// frame takes the question panel as a slot, task 087).

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export interface PanelDividerProps {
  /** 'vertical': a column rule, dragged sideways (← / →); 'horizontal': a
   *  row rule, dragged up and down (↑ / ↓). */
  orientation: 'vertical' | 'horizontal';
  label: string;
  /** What a screen reader hears: the value in its range (and, if given, a
   *  word on what it means). */
  value: number;
  min: number;
  max: number;
  valueText?: string;
  /** Called once as a drag starts, so the caller captures its starting value
   *  (and anything it measures) there and then; the map it returns takes the
   *  pointer's travel along the axis, in px (+ = right / down), to the new
   *  value. */
  drag: () => (delta: number) => number;
  /** A key press along the axis: +1 = → / ↓, −1 = ← / ↑. */
  step: (dir: 1 | -1) => number;
  /** Live while dragging (`done` false), then once on release or per key
   *  press (`done` true: store it). */
  onResize: (value: number, done: boolean) => void;
}

/** A 9px hit area over a 1px rule, with a grip (workbench.css .wb-divider). */
export function PanelDivider({ orientation, label, value, min, max, valueText, drag, step, onResize }: PanelDividerProps) {
  const active = useRef<{ start: number; map: (delta: number) => number; last: number } | null>(null);
  const horizontal = orientation === 'horizontal';
  const along = (e: PointerEvent<HTMLDivElement>) => (horizontal ? e.clientY : e.clientX);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const map = drag();
    active.current = { start: along(e), map, last: map(0) };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = active.current;
    if (!d) return;
    const next = d.map(along(e) - d.start);
    if (next === d.last) return;
    d.last = next;
    onResize(next, false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = active.current;
    if (!d) return;
    active.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onResize(d.last, true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const [back, forward] = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const dir = e.key === forward ? 1 : e.key === back ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    onResize(step(dir), true);
  };

  return (
    <div
      className={horizontal ? 'wb-divider wb-divider--row' : 'wb-divider'}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="wb-divider-grip" aria-hidden />
    </div>
  );
}
