// The question creator's family of turbot arenas (task 010): one row per
// arena — added, duplicated, removed and moved as a whole, so an arena never
// parts from its criterion or step budget — and, below the list, the arena
// editor (./arenaEditing.ts, ≤ 30×30) for the ONE active arena with its own
// criterion and budget. Only the active arena's grid renders, so a family of
// three 30×30 worlds (HW6 P2) stays cheap. The drafts, their defects and the
// saved field are the pure ./turbotCaseAuthoring.ts; this is only the widget.
//
// The active arena is held by the parent as a draft KEY, not an index, so a
// reorder or a removal never points it at another arena. Graded runs are
// positional, so the list warns (and the creator confirms at save) when a
// saved arena loses its slot — misplacedArenas, like the fill-in blanks.

import { useState } from 'react';
import type { TurbotSuccessCriterion } from '../types';
import { ArenaCanvas } from '../components/ArenaCanvas';
import { moveItem } from './dragReorder';
import { MAX_ARENA_SIZE, placeStart, resizeArena, setArenaCell } from './arenaEditing';
import {
  describeTurbotCase,
  duplicateTurbotCase,
  misplacedArenas,
  misplacedArenasWarning,
  newTurbotCaseDraft,
  removeTurbotCase,
  turbotCaseDefects,
  turbotCaseIndexOf,
  TURBOT_CRITERIA,
  type TurbotCaseDraft,
} from './turbotCaseAuthoring';

type ArenaTool = 'block' | 'goal' | 'erase' | 'start';

const ARENA_TOOLS: { tool: ArenaTool; label: string }[] = [
  { tool: 'block', label: 'Block' },
  { tool: 'goal', label: 'Goal' },
  { tool: 'erase', label: 'Erase' },
  { tool: 'start', label: 'Turbot' },
];

export function TurbotArenasEditor({
  drafts,
  saved,
  activeKey,
  onChange,
  onSelect,
}: {
  drafts: TurbotCaseDraft[];
  /** The drafts the question opened with (none for a new question). */
  saved: readonly TurbotCaseDraft[];
  /** The key of the arena being edited; a stale key edits arena #1. */
  activeKey: number;
  onChange: (next: TurbotCaseDraft[]) => void;
  onSelect: (key: number) => void;
}) {
  const [tool, setTool] = useState<ArenaTool>('block');
  const defects = turbotCaseDefects(drafts);
  const misplaced = misplacedArenas(saved, drafts);
  const activeIndex = turbotCaseIndexOf(drafts, activeKey);
  const active = drafts[activeIndex];

  const update = (i: number, patch: Partial<TurbotCaseDraft>) =>
    onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const add = () => {
    const d = newTurbotCaseDraft(drafts);
    onChange([...drafts, d]);
    onSelect(d.key);
  };
  const duplicate = (i: number) => {
    const { drafts: next, key } = duplicateTurbotCase(drafts, i);
    onChange(next);
    if (key !== null) onSelect(key);
  };
  const remove = (i: number) => {
    const next = removeTurbotCase(drafts, i);
    onChange(next);
    // Removing the arena being edited moves the editor to its neighbour.
    if (drafts[i]?.key === active?.key && next.length > 0) {
      onSelect(next[Math.min(i, next.length - 1)].key);
    }
  };

  const handleCellClick = (x: number, y: number) => {
    if (!active) return;
    const a = active.arena;
    const arena =
      tool === 'block' ? setArenaCell(a, x, y, 'block') :
      tool === 'goal' ? setArenaCell(a, x, y, 'goal') :
      tool === 'erase' ? setArenaCell(a, x, y, 'empty') :
      placeStart(a, x, y);
    update(activeIndex, { arena });
  };

  return (
    <>
      <section className="instructor-creator-section">
        <div className="mm-section-head">
          <h3>Arenas</h3>
          <button type="button" className="mm-btn mm-btn--small" onClick={add}>
            Add arena
          </button>
        </div>
        <p className="mm-note mm-hint">
          The brain is graded in every arena, each by its own success criterion and step
          budget, and the question passes only if every arena passes — so a family of arenas
          rejects a brain that only works in one. Students see arena #1 on the problem page
          and in the Map; a failed arena can be replayed from their grade sheet.
        </p>
        {misplaced.length > 0 && (
          <p className="instructor-preview-warning" role="alert">
            {misplacedArenasWarning(misplaced)}
          </p>
        )}
        {defects
          .filter((d) => d.arena === null)
          .map((d) => (
            <p key={d.message} className="instructor-preview-warning">{d.message}</p>
          ))}
        {drafts.map((d, i) => {
          const isActive = i === activeIndex;
          const rowDefects = defects.filter((x) => x.arena === i);
          return (
            <div
              key={d.key}
              className={'doc-editor-row' + (isActive ? ' doc-editor-row--active' : '')}
              aria-current={isActive ? 'true' : undefined}
            >
              <div className="doc-editor-inline">
                <span className="mm-label">#{i + 1}</span>
                <span className="instructor-question-summary doc-editor-grow">
                  {describeTurbotCase(d)}
                </span>
                <span className="instructor-section-actions">
                  <button
                    type="button"
                    className="mm-btn mm-btn--small"
                    aria-pressed={isActive}
                    onClick={() => onSelect(d.key)}
                  >
                    {isActive ? 'Editing' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    className="mm-btn mm-btn--small"
                    disabled={i === 0}
                    onClick={() => onChange(moveItem(drafts, i, i - 1))}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="mm-btn mm-btn--small"
                    disabled={i === drafts.length - 1}
                    onClick={() => onChange(moveItem(drafts, i, i + 1))}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button type="button" className="mm-btn mm-btn--small" onClick={() => duplicate(i)}>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="mm-btn mm-btn--small mm-btn--danger"
                    disabled={drafts.length <= 1}
                    title={drafts.length <= 1 ? 'A turbot question needs at least one arena' : undefined}
                    onClick={() => remove(i)}
                  >
                    Remove
                  </button>
                </span>
              </div>
              {/* The active arena's problems show in its editor below. */}
              {!isActive && rowDefects.map((x) => (
                <p key={x.message} className="instructor-preview-warning">
                  Arena #{i + 1}: {x.message}
                </p>
              ))}
            </div>
          );
        })}
      </section>

      {active && (
        <section className="instructor-creator-section">
          <div className="mm-section-head">
            <h3>Arena #{activeIndex + 1}</h3>
            <div className="mm-segmented">
              {ARENA_TOOLS.map((t) => (
                <button
                  key={t.tool}
                  className={
                    'mm-segmented-btn' + (tool === t.tool ? ' mm-segmented-btn--active' : '')
                  }
                  onClick={() => setTool(t.tool)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mm-note mm-hint">
            Click cells to paint with the selected tool. With the Turbot tool, click a cell to
            move the start there; click the turbot again to rotate it.
          </p>
          <div className="instructor-arena-size">
            <label className="mm-inline-field">
              width
              <input
                className="mm-input mm-input--num"
                type="number"
                min={1}
                max={MAX_ARENA_SIZE}
                value={active.arena.width}
                onChange={(e) =>
                  update(activeIndex, {
                    arena: resizeArena(active.arena, Number(e.target.value), active.arena.height),
                  })
                }
              />
            </label>
            <label className="mm-inline-field">
              height
              <input
                className="mm-input mm-input--num"
                type="number"
                min={1}
                max={MAX_ARENA_SIZE}
                value={active.arena.height}
                onChange={(e) =>
                  update(activeIndex, {
                    arena: resizeArena(active.arena, active.arena.width, Number(e.target.value)),
                  })
                }
              />
            </label>
          </div>
          {/* Scrolls in both axes: a 30×30 arena is far wider than the form. */}
          <div className="instructor-arena-scroll">
            <ArenaCanvas arena={active.arena} onCellClick={handleCellClick} />
          </div>
          <div className="instructor-criterion-row">
            <label className="mm-inline-field">
              success criterion
              <select
                className="mm-input"
                value={active.criterion}
                onChange={(e) =>
                  update(activeIndex, { criterion: e.target.value as TurbotSuccessCriterion })
                }
              >
                {TURBOT_CRITERIA.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="mm-inline-field">
              max steps
              <input
                className="mm-input mm-input--num"
                type="number"
                min={1}
                max={10000}
                value={active.maxSteps}
                onChange={(e) =>
                  update(activeIndex, {
                    maxSteps: Math.max(1, Math.trunc(Number(e.target.value)) || 1),
                  })
                }
              />
            </label>
          </div>
          <p className="mm-note mm-hint">
            {TURBOT_CRITERIA.find((c) => c.value === active.criterion)?.hint} The turbot fails
            if it exceeds the step budget.
          </p>
          {defects
            .filter((x) => x.arena === activeIndex)
            .map((x) => (
              <p key={x.message} className="instructor-preview-warning">
                Arena #{activeIndex + 1}: {x.message}
              </p>
            ))}
        </section>
      )}
    </>
  );
}
