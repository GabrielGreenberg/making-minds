// The editor's frame (task 052; design memo editor-workbench.md §Layout): one
// full-height column — the top bar, a thin band, then the body row: the
// question panel on the left, the workspace in the middle, the output panel
// on the right. Both side panels resize by dragging their divider and
// collapse to a 40px strip; widths and open states persist per browser
// (uiPrefs.ts, workbench.ts EDITOR_PREF_KEYS).
//
// ONE frame for every question kind and the sandbox: a circuit question
// passes its canvas and its output panel; an open or fill-in question passes
// its answer area and no output panel; the sandbox has no question panel
// (Gabriel, 2026-09-25) and keeps its worksheet tabs over the canvas.

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { loadUiPrefs, saveUiPref } from '../uiPrefs';
import {
  EDITOR_PREF_KEYS,
  LEFT_PANEL,
  RIGHT_PANEL,
  clampPanelWidth,
  editorLayoutFromPrefs,
  type EditorLayout,
  type WidthRange,
} from '../workbench';
import { EditorTopBar } from './EditorTopBar';
import { QuestionPanel, QuestionPanelStrip } from './QuestionPanel';
import { VisitorBanner } from './VisitorBanner';

/** The layout, read once from the browser's prefs; `update` changes it and,
 *  unless told it's a drag in progress, stores what changed. */
function useEditorLayout(): [EditorLayout, (patch: Partial<EditorLayout>, persist?: boolean) => void] {
  const [layout, setLayout] = useState(() => editorLayoutFromPrefs(loadUiPrefs()));
  const update = useCallback((patch: Partial<EditorLayout>, persist = true) => {
    setLayout((l) => ({ ...l, ...patch }));
    if (!persist) return;
    for (const key of Object.keys(patch) as (keyof EditorLayout)[]) {
      saveUiPref(EDITOR_PREF_KEYS[key], patch[key]);
    }
  }, []);
  return [layout, update];
}

export function EditorShell({ children, output }: { children: ReactNode; output?: ReactNode }) {
  const { isVisitor } = useAuth();
  const inAssignment = useStore((s) => s.assignment !== null);
  const [layout, update] = useEditorLayout();

  return (
    <div className="app wb">
      <EditorTopBar />
      <div className="wb-band" />
      {isVisitor && <VisitorBanner />}
      <div className="wb-body">
        {inAssignment &&
          (layout.leftOpen ? (
            <>
              <aside className="wb-left" style={{ width: layout.leftW }} aria-label="Question">
                <QuestionPanel onCollapse={() => update({ leftOpen: false })} />
              </aside>
              <PanelDivider
                side="left"
                width={layout.leftW}
                range={LEFT_PANEL}
                onResize={(w, done) => update({ leftW: w }, done)}
              />
            </>
          ) : (
            <QuestionPanelStrip onExpand={() => update({ leftOpen: true })} />
          ))}
        <main className="wb-center">{children}</main>
        {output !== undefined &&
          (layout.rightOpen ? (
            <>
              <PanelDivider
                side="right"
                width={layout.rightW}
                range={RIGHT_PANEL}
                onResize={(w, done) => update({ rightW: w }, done)}
              />
              <aside className="wb-right" style={{ width: layout.rightW }} aria-label="Output">
                <div className="wb-right-head mm-surface">
                  <span className="eyebrow">Output</span>
                  <button
                    type="button"
                    className="wb-collapse"
                    onClick={() => update({ rightOpen: false })}
                    title="Hide the output panel"
                    aria-label="Hide the output panel"
                  >
                    »
                  </button>
                </div>
                <div className="wb-right-body">{output}</div>
              </aside>
            </>
          ) : (
            <button
              type="button"
              className="wb-strip wb-strip--right mm-surface"
              onClick={() => update({ rightOpen: true })}
              title="Show the output panel"
              aria-label="Show the output panel"
            >
              <span className="wb-strip-toggle" aria-hidden>«</span>
              <span className="wb-strip-title wb-strip-title--eyebrow">Output</span>
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * A column divider: a 9px hit area over a 1px rule, with a grip. Dragging
 * resizes the panel on `side` (live, stored on release); the arrow keys do
 * it in 16px steps for keyboard users.
 */
function PanelDivider({
  side,
  width,
  range,
  onResize,
}: {
  side: 'left' | 'right';
  width: number;
  range: WidthRange;
  onResize: (width: number, done: boolean) => void;
}) {
  const drag = useRef<{ startX: number; startW: number; last: number } | null>(null);
  // The left panel grows as the pointer moves right; the right one as it moves left.
  const sign = side === 'left' ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: width, last: width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = clampPanelWidth(d.startW + sign * (e.clientX - d.startX), range);
    if (next === d.last) return;
    d.last = next;
    onResize(next, false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onResize(d.last, true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    onResize(clampPanelWidth(width + sign * step, range), true);
  };

  return (
    <div
      className="wb-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize the question panel' : 'Resize the output panel'}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={width}
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
