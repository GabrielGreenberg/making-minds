// The editor's frame (task 052; design memo editor-workbench.md §Layout): one
// full-height column — the top bar, a thin band, then the body row: the
// question panel on the left, the workspace in the middle, the output panel
// on the right. Both side panels resize by dragging their divider
// (PanelDivider.tsx, the one divider) and collapse to a 40px strip; widths,
// open states and the question panel's split (task 078) persist per browser
// (uiPrefs.ts, workbench.ts EDITOR_PREF_KEYS).
//
// ONE frame for every question kind, the sandbox and the embed: a circuit
// question passes its canvas and its output panel; an open or fill-in
// question passes its answer area and no output panel; the sandbox has no
// question panel (Gabriel, 2026-09-25) and keeps its worksheet tabs over the
// canvas.
//
// Layout only (task 087): the host decides the chrome and passes it in — the
// bar (the app's EditorTopBar, the embed's slim bar), a banner under it (the
// visitor banner), the question panel as a pair of renderers (QuestionPanel.tsx
// questionSidePanel), the output panel. The frame reads no store and no
// session, so the embeddable sandbox mounts it without the course client.

import { useCallback, useState, type ReactNode } from 'react';
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
import { PanelDivider } from './PanelDivider';

/** What the frame hands the open question panel: collapse it, and its split. */
export interface QuestionPanelControl {
  onCollapse: () => void;
  /** The problem's share of the panel below the nav strip (workbench.ts QUESTION_SPLIT). */
  split: number;
  onResizeSplit: (split: number, done: boolean) => void;
}

/** The left column: the open panel, and the strip it collapses to. */
export interface QuestionSidePanel {
  panel: (control: QuestionPanelControl) => ReactNode;
  strip: (expand: () => void) => ReactNode;
}

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

export function EditorShell({
  bar,
  banner,
  question,
  output,
  children,
}: {
  /** The top bar. */
  bar: ReactNode;
  /** A notice under the bar (the visitor banner). */
  banner?: ReactNode;
  /** The question panel — only in an assignment; the sandbox has none. */
  question?: QuestionSidePanel;
  /** The output panel; none for a written problem. */
  output?: ReactNode;
  children: ReactNode;
}) {
  const [layout, update] = useEditorLayout();

  return (
    <div className="app wb">
      {bar}
      <div className="wb-band" />
      {banner}
      <div className="wb-body">
        {question &&
          (layout.leftOpen ? (
            <>
              <aside className="wb-left" style={{ width: layout.leftW }} aria-label="Question">
                {question.panel({
                  onCollapse: () => update({ leftOpen: false }),
                  split: layout.qpSplit,
                  onResizeSplit: (v, done) => update({ qpSplit: v }, done),
                })}
              </aside>
              <PanelDivider
                orientation="vertical"
                {...columnDivider('left', layout.leftW, LEFT_PANEL)}
                onResize={(w, done) => update({ leftW: w }, done)}
              />
            </>
          ) : (
            question.strip(() => update({ leftOpen: true }))
          ))}
        <main className="wb-center">{children}</main>
        {output !== undefined &&
          (layout.rightOpen ? (
            <>
              <PanelDivider
                orientation="vertical"
                {...columnDivider('right', layout.rightW, RIGHT_PANEL)}
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
 * A column divider's value: the width of the panel on `side`, which grows as
 * the pointer moves away from it (the left panel's rightwards, the right
 * one's leftwards), clamped to its range; the arrow keys step it 16px.
 */
function columnDivider(side: 'left' | 'right', width: number, range: WidthRange) {
  const sign = side === 'left' ? 1 : -1;
  return {
    label: side === 'left' ? 'Resize the question panel' : 'Resize the output panel',
    value: width,
    min: range.min,
    max: range.max,
    drag: () => (dx: number) => clampPanelWidth(width + sign * dx, range),
    step: (dir: 1 | -1) => clampPanelWidth(width + sign * 16 * dir, range),
  };
}
