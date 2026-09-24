import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { sortByLabel } from '../engine';
import { lanesToFrames, shiftFrame, validatePerceptionMachine } from '../engine/perception';
import { questionComponentRules } from '../engine/caseRun';
import { RunSpeedControl } from './RunSpeedControl';

/** Longest film the player builds (a grader case is 5–9 frames). */
const MAX_FRAMES = 24;

/**
 * The SC perception question's frame player (task 012): the student draws a
 * film of retina frames and clocks it through the machine one frame per
 * tick, seeing the output bit per step — the way the question is graded
 * (engine/perception.ts runPerceptionCase).
 *
 * The film IS the run's input: it lives in the store's `scInputSequence` as
 * lanes (lane i = wire IN(i+1) over time, t1 first — framesToLanes), written
 * only through `setScFrames`, and Run/Step are the store's scRun/scStep,
 * which feed lane i to the i-th INPUT in label order from MEMs at 0 and stop
 * after the last frame (selectScRunWindow) — the grader's run of the same
 * frames. The Sequential Timeline below reads the same lanes, so the two
 * never disagree. Nothing here reads perception_cases or evaluates the rule:
 * the OUT row is the machine's own output, never an answer. The run speed is
 * the panel's (DataTable), whose Global I/O block this player replaces — so
 * its speed control lives here too.
 *
 * Layout follows the SC tables: time flows right to left (t1 rightmost, a
 * new frame appears on the left); rows are the retina's wires, IN1 on top —
 * "up" is toward IN1, as the motion rule reads it. Cells are buttons (no
 * text field: frames are clicked, never typed or pasted).
 */
export function PerceptionFramePlayer({ width, runSpeed, onRunSpeedChange }: {
  width: number;
  runSpeed: number;
  onRunSpeedChange: (speed: number) => void;
}) {
  const scInputSequence = useStore((s) => s.scInputSequence);
  const scHistory = useStore((s) => s.scHistory);
  const scTimeStep = useStore((s) => s.scTimeStep);
  const running = useStore((s) => s.scRunning);
  const components = useStore((s) => s.components);
  const wires = useStore((s) => s.wires);
  const assignmentId = useStore((s) => s.assignment?.id ?? '');
  const question = useStore((s) => s.assignment?.questions[s.currentQuestionIndex] ?? null);
  const setScFrames = useStore((s) => s.setScFrames);
  const scStep = useStore((s) => s.scStep);
  const scReset = useStore((s) => s.scReset);

  const frames = useMemo(() => lanesToFrames(scInputSequence, width), [scInputSequence, width]);
  const count = frames.length;

  // The frame picked for the per-frame tools — view state, scoped to the
  // question it was picked on, so navigating away drops it.
  const scope = `${assignmentId}:${question?.id ?? ''}`;
  const [picked, setPicked] = useState<{ scope: string; index: number } | null>(null);
  const selected = picked && picked.scope === scope && picked.index < count ? picked.index : null;
  const select = (index: number | null) => setPicked(index === null ? null : { scope, index });

  // Wire i of a frame is fed to the i-th INPUT in label order — the grader's
  // binding — so each row is labelled with the INPUT it will drive.
  const inputLabels = sortByLabel(components, 'IN').map((c) => c.label);
  const outputLabel = sortByLabel(components, 'OUT')[0]?.label ?? 'OUT1';

  // Warn, don't block: the grader's Stage 1 for this question (component
  // rules, then the retina interface), shown as text; the run still plays.
  const verdict = useMemo(() => {
    const circuit = { components, wires };
    const rules = question ? questionComponentRules(question, circuit) : { ok: true };
    return rules.ok ? validatePerceptionMachine(circuit, width) : rules;
  }, [components, wires, question, width]);

  // ── Film edits (each one resets the run to t=1: setScFrames) ──
  const toggleBit = (index: number, wire: number) =>
    setScFrames(frames.map((f, k) => (k === index ? f.map((b, i) => (i === wire ? 1 - b : b)) : f)));
  const addFrame = () => {
    if (count >= MAX_FRAMES) return;
    const newest = frames[count - 1];
    setScFrames([...frames, newest ? [...newest] : Array<number>(width).fill(0)]);
    select(count);
  };
  const shift = (dir: 'up' | 'down') => {
    if (selected === null) return;
    setScFrames(frames.map((f, k) => (k === selected ? shiftFrame(f, dir) : f)));
  };
  const duplicate = () => {
    if (selected === null || count >= MAX_FRAMES) return;
    const next = [...frames];
    next.splice(selected + 1, 0, [...frames[selected]]);
    setScFrames(next);
    select(selected + 1);
  };
  const remove = () => {
    if (selected === null) return;
    setScFrames(frames.filter((_, k) => k !== selected));
    select(count > 1 ? Math.min(selected, count - 2) : null);
  };
  const clear = () => {
    setScFrames([]);
    select(null);
  };

  // ── Playback: the store's SC run, ended by selectScRunWindow at the film's end ──
  const run = () => {
    const s = useStore.getState();
    if (s.scRunning || count === 0) return;
    if (s.scTimeStep > count) s.scReset(); // played through: play again from t1
    s.scRun(Math.round(300 / runSpeed));
  };
  const step = () => {
    if (!running && count > 0 && scTimeStep <= count) scStep();
  };

  // The frame on the retina now: the last one clocked in (0 = none yet).
  const shown = scTimeStep - 1;
  const steps = Array.from({ length: count }, (_, k) => count - k); // t descending: t1 rightmost
  const colClass = (t: number) =>
    [t === shown ? 'pf-col-current' : '', t - 1 === selected ? 'pf-col-selected' : ''].join(' ').trim();

  return (
    <div className="table-section">
      <div className="table-section-label pf-head">
        <span>Retina frames</span>
        <button className="toggle-btn pf-small" onClick={clear} disabled={count === 0} title="Remove every frame">
          clear
        </button>
      </div>

      <div className="pf-scroll">
        <table className="pf-grid">
          <tbody>
            <tr>
              <td className="pf-add" rowSpan={width + 2}>
                <button
                  className="pf-add-btn"
                  onClick={addFrame}
                  disabled={count >= MAX_FRAMES}
                  title={count >= MAX_FRAMES ? `At most ${MAX_FRAMES} frames` : 'Add a frame (a copy of the newest)'}
                >
                  +
                </button>
              </td>
              {steps.map((t) => (
                <th
                  key={t}
                  className={`pf-t ${colClass(t)}`}
                  onClick={() => select(selected === t - 1 ? null : t - 1)}
                  title={`Frame t${t}: click to shift, duplicate or delete it`}
                >
                  t{t}
                </th>
              ))}
              <th className="pf-label" />
            </tr>
            {Array.from({ length: width }, (_, wire) => {
              const label = inputLabels[wire] ?? `IN${wire + 1}`;
              return (
                <tr key={wire}>
                  {steps.map((t) => {
                    const bit = frames[t - 1][wire];
                    return (
                      <td key={t} className={colClass(t)}>
                        <button
                          className={`pf-bit${bit ? ' on' : ''}`}
                          onClick={() => toggleBit(t - 1, wire)}
                          aria-pressed={bit === 1}
                          aria-label={`${label} at t${t}: ${bit}`}
                        >
                          {bit}
                        </button>
                      </td>
                    );
                  })}
                  <th className="pf-label">{label}</th>
                </tr>
              );
            })}
            <tr className="pf-out">
              {steps.map((t) => {
                const out = scHistory.find((h) => h.t === t)?.outputBits[0];
                return (
                  <td key={t} className={`pf-out-bit${out === 1 ? ' val-1' : ''} ${colClass(t)}`}>
                    {out ?? ''}
                  </td>
                );
              })}
              <th className="pf-label">{outputLabel}</th>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="pf-tools">
        {selected === null ? (
          <span className="pf-hint">
            {count === 0
              ? 'Add a frame (+) — each frame is one clock tick.'
              : 'Click a frame’s t to shift, duplicate or delete it.'}
          </span>
        ) : (
          <>
            <span className="pf-hint">t{selected + 1}:</span>
            <button className="toggle-btn pf-small" onClick={() => shift('up')} title="Shift the frame up one wire (toward IN1)">↑ up</button>
            <button className="toggle-btn pf-small" onClick={() => shift('down')} title="Shift the frame down one wire">↓ down</button>
            <button className="toggle-btn pf-small" onClick={duplicate} disabled={count >= MAX_FRAMES} title="Copy the frame into the next time step">duplicate</button>
            <button className="toggle-btn pf-small" onClick={remove} title="Delete the frame">delete</button>
          </>
        )}
      </div>

      <div className="pf-tools">
        <button className="action-btn" onClick={run} disabled={running || count === 0}>Run</button>
        <button className="action-btn" onClick={step} disabled={running || count === 0 || scTimeStep > count}>Step</button>
        <button className="action-btn" onClick={() => scReset()}>Reset</button>
        <div className="pf-end">
          <span className="pf-hint">{count} / {MAX_FRAMES} frames</span>
          <RunSpeedControl speed={runSpeed} onChange={onRunSpeedChange} />
        </div>
      </div>

      {!verdict.ok && verdict.reason && (
        <div className="pf-warning">⚠ {verdict.reason} — the grader rejects this machine; the run still plays.</div>
      )}
    </div>
  );
}
