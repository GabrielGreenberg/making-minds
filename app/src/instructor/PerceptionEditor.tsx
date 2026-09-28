import { useState } from 'react';
import type { MotionDirection, MotionScene } from '../types';
import {
  describePerceptionRule,
  expectedPerceptionOutputs,
  filmProblem,
  MAX_FILM_FRAMES,
  MAX_PERCEPTION_WIDTH,
  MIN_PERCEPTION_WIDTH,
} from '../engine/perception';
import { FrameFilmGrid } from '../components/FrameFilmGrid';
import {
  PERCEPTION_KINDS,
  MOTION_DIRECTION_LABELS,
  MOTION_SCENE_LABELS,
  addFilmFrame,
  bankSummary,
  draftProblems,
  duplicateFilm,
  duplicateFilmFrame,
  effectiveKind,
  effectiveWidth,
  fitFilmToWidth,
  newFilm,
  removeFilm,
  removeFilmFrame,
  replaceFilm,
  ruleFromDraft,
  shiftFilmFrame,
  takesFilms,
  toggleFilmBit,
  type PerceptionDraft,
  type PerceptionKind,
} from './perceptionAuthoring';

/**
 * The question creator's perception task (task 013): the rule row (kind,
 * retina size, run/object length or pattern; a motion rule's direction and
 * scene), then — for an SC rule — the instructor's own frame films, appended
 * to the generated battery at save (perceptionAuthoring.ts). The active film
 * is drawn in the student's grid (FrameFilmGrid) with the rule's expected
 * output under it: the expected bits are always the rule's, never typed.
 * Films are clicked, not typed — no text field, no paste path.
 */
export function PerceptionEditor({
  mode,
  draft,
  onChange,
}: {
  mode: 'CC' | 'SC';
  draft: PerceptionDraft;
  onChange: (draft: PerceptionDraft) => void;
}) {
  const [activeFilm, setActiveFilm] = useState(0);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  const kind = effectiveKind(draft, mode);
  const width = effectiveWidth(draft, mode);
  const rule = ruleFromDraft(draft, mode);
  const problems = draftProblems(draft, mode);
  const summary = bankSummary(draft, mode);
  const films = takesFilms(draft, mode);
  const set = (patch: Partial<PerceptionDraft>) => onChange({ ...draft, ...patch });

  const active = films && activeFilm < draft.films.length ? activeFilm : null;
  const film = active === null ? null : draft.films[active];
  const frame = film && selectedFrame !== null && selectedFrame < film.length ? selectedFrame : null;
  const setFilm = (next: number[][]) => {
    if (active !== null) set({ films: replaceFilm(draft.films, active, next) });
  };
  const pick = (i: number | null) => {
    setActiveFilm(i ?? 0);
    setSelectedFrame(null);
  };

  return (
    <>
      <section className="instructor-creator-section">
        <div className="mm-section-head">
          <h3>Perception rule</h3>
        </div>
        <p className="mm-note mm-hint">
          The machine's inputs are an array of stimulations (like light hitting a retina) and
          its single output classifies them. Grading feeds raw bit patterns
          {mode === 'SC' ? ' — one frame per clock tick — ' : ' '}to the circuit and checks the
          output bit{mode === 'SC' ? ' at every step. The "previous input" before the first frame is all 0s (what fresh MEM blocks hold).' : '.'}
        </p>
        <div className="instructor-criterion-row">
          <select
            className="mm-input"
            value={kind}
            onChange={(e) => set({ kind: e.target.value as PerceptionKind })}
          >
            {PERCEPTION_KINDS[mode].map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
          {(kind === 'min-run' || kind === 'exact-run' || kind === 'motion') && (
            <label className="mm-inline-field">
              {kind === 'motion' ? 'object length' : 'run length k'}
              <input
                className="mm-input mm-input--num"
                type="number"
                min={1}
                max={width}
                value={draft.runLength}
                onChange={(e) => set({ runLength: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })}
              />
            </label>
          )}
          {kind === 'pattern' ? (
            <label className="mm-inline-field">
              pattern
              <input
                className="mm-input"
                placeholder="e.g. 110010111"
                value={draft.pattern}
                onChange={(e) => set({ pattern: e.target.value.replace(/[^01]/g, '') })}
              />
            </label>
          ) : (
            <label className="mm-inline-field">
              inputs
              <input
                className="mm-input mm-input--num"
                type="number"
                min={MIN_PERCEPTION_WIDTH}
                max={MAX_PERCEPTION_WIDTH}
                value={draft.width}
                onChange={(e) => set({ width: Math.trunc(Number(e.target.value)) || 0 })}
              />
            </label>
          )}
        </div>
        {kind === 'motion' && (
          <div className="instructor-criterion-row">
            <label className="mm-inline-field">
              moving
              <select
                className="mm-input"
                value={draft.direction}
                onChange={(e) => set({ direction: e.target.value as MotionDirection })}
              >
                {(Object.keys(MOTION_DIRECTION_LABELS) as MotionDirection[]).map((d) => (
                  <option key={d} value={d}>{MOTION_DIRECTION_LABELS[d]}</option>
                ))}
              </select>
            </label>
            <label className="mm-inline-field">
              scene
              <select
                className="mm-input"
                value={draft.scene}
                onChange={(e) => set({ scene: e.target.value as MotionScene })}
              >
                {(Object.keys(MOTION_SCENE_LABELS) as MotionScene[]).map((s) => (
                  <option key={s} value={s}>{MOTION_SCENE_LABELS[s]}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {kind === 'pattern' && (
          <p className="mm-note mm-hint">
            The number of inputs equals the pattern length ({width || '—'}).
          </p>
        )}
        {problems.length > 0 ? (
          problems.map((p) => <p key={p} className="instructor-preview-warning">{p}</p>)
        ) : (
          <p className="mm-note mm-hint">
            Rule: {describePerceptionRule(rule)}. The circuit needs {width} inputs and 1 output.
          </p>
        )}
        {!films && draft.films.length > 0 && (
          <button type="button" className="mm-btn mm-btn--small mm-btn--danger" onClick={() => set({ films: [] })}>
            Remove the films
          </button>
        )}
        {summary && (
          <p className="mm-note mm-hint">
            Grading bank: {summary.generated} generated case{summary.generated === 1 ? '' : 's'}
            {summary.authored > 0 && ` + ${summary.authored} of your film${summary.authored === 1 ? '' : 's'}`}
            {' '}— {summary.positives} with an expected 1 somewhere.
          </p>
        )}
      </section>

      {films && (
        <section className="instructor-creator-section">
          <div className="mm-section-head">
            <h3>Your films</h3>
            <button
              type="button"
              className="mm-btn mm-btn--small"
              onClick={() => {
                set({ films: [...draft.films, newFilm(width)] });
                pick(draft.films.length);
              }}
            >
              Add film
            </button>
          </div>
          <p className="mm-note mm-hint">
            Frame sequences of your own, graded after the generated ones — every step, like
            theirs. The expected output is always the rule's; students never see these films.
          </p>
          {draft.films.map((f, i) => {
            const isActive = i === active;
            const bad = filmProblem(f, width);
            return (
              <div
                key={i}
                className={'doc-editor-row' + (isActive ? ' doc-editor-row--active' : '')}
                aria-current={isActive ? 'true' : undefined}
              >
                <div className="doc-editor-inline">
                  <span className="mm-label">Film {i + 1}</span>
                  <span className="instructor-question-summary doc-editor-grow">
                    {f.length} frame{f.length === 1 ? '' : 's'} · expected{' '}
                    {bad ? '—' : expectedPerceptionOutputs(rule, f).join('')} (t1 first)
                  </span>
                  <span className="instructor-section-actions">
                    <button
                      type="button"
                      className="mm-btn mm-btn--small"
                      aria-pressed={isActive}
                      onClick={() => pick(i)}
                    >
                      {isActive ? 'Editing' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="mm-btn mm-btn--small"
                      onClick={() => {
                        set({ films: duplicateFilm(draft.films, i) });
                        pick(i + 1);
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="mm-btn mm-btn--small mm-btn--danger"
                      onClick={() => {
                        set({ films: removeFilm(draft.films, i) });
                        pick(Math.max(0, Math.min(i, draft.films.length - 2)));
                      }}
                    >
                      Remove
                    </button>
                  </span>
                </div>
                {bad && f[0]?.length !== width && (
                  <button
                    type="button"
                    className="mm-btn mm-btn--small"
                    onClick={() => set({ films: replaceFilm(draft.films, i, fitFilmToWidth(f, width)) })}
                  >
                    Fit to {width} inputs
                  </button>
                )}
              </div>
            );
          })}

          {film && (
            <div className="table-section">
              <FrameFilmGrid
                frames={film}
                width={width}
                outputRow={{ label: 'expected', bits: expectedPerceptionOutputs(rule, film) }}
                selected={frame}
                maxFrames={MAX_FILM_FRAMES}
                onToggle={(t, wire) => setFilm(toggleFilmBit(film, t, wire))}
                onSelect={setSelectedFrame}
                onAdd={() => {
                  setFilm(addFilmFrame(film, width));
                  setSelectedFrame(Math.min(film.length, MAX_FILM_FRAMES - 1));
                }}
              />
              <div className="pf-tools">
                {frame === null ? (
                  <span className="pf-hint">
                    Click a bit to flip it, + to add a frame, a frame's t to shift, duplicate or delete it.
                  </span>
                ) : (
                  <>
                    <span className="pf-hint">t{frame + 1}:</span>
                    <button type="button" className="toggle-btn pf-small" onClick={() => setFilm(shiftFilmFrame(film, frame, 'up'))} title="Shift the frame up one wire (toward IN1)">↑ up</button>
                    <button type="button" className="toggle-btn pf-small" onClick={() => setFilm(shiftFilmFrame(film, frame, 'down'))} title="Shift the frame down one wire">↓ down</button>
                    <button
                      type="button"
                      className="toggle-btn pf-small"
                      disabled={film.length >= MAX_FILM_FRAMES}
                      onClick={() => {
                        setFilm(duplicateFilmFrame(film, frame));
                        setSelectedFrame(frame + 1);
                      }}
                    >
                      duplicate
                    </button>
                    <button
                      type="button"
                      className="toggle-btn pf-small"
                      onClick={() => {
                        setFilm(removeFilmFrame(film, frame));
                        setSelectedFrame(film.length > 1 ? Math.min(frame, film.length - 2) : null);
                      }}
                    >
                      delete
                    </button>
                  </>
                )}
                <span className="pf-end pf-hint">{film.length} / {MAX_FILM_FRAMES} frames</span>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
