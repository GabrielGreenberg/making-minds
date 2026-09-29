// The canvas strip's icon set (task 085): Undo, Redo and Rotate drawn as one
// family — 16×16, stroked in currentColor at the palette's weight (1.6, round
// caps and joins; workbench.css .cv-ico). Redo IS Undo mirrored, from the
// same path, so the pair cannot drift apart. Used by CanvasActions, whose
// rotate hint wears the same Rotate. Inside a labelled button an icon is
// decoration (aria-hidden); standing alone, pass `label`.

const UNDO_PATH = 'M5.5 3 L2 6.5 L5.5 10 M2 6.5 H10.5 A3.5 3.5 0 0 1 10.5 13.5 H6.5';
const ROTATE_PATH = 'M13 8.5 A5 5 0 1 1 8 3.5 M6.8 1.2 L9.1 3.5 L6.8 5.8';

function Icon({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <svg
      className="cv-ico"
      viewBox="0 0 16 16"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {children}
    </svg>
  );
}

export function UndoIcon({ label }: { label?: string }) {
  return (
    <Icon label={label}>
      <path d={UNDO_PATH} />
    </Icon>
  );
}

export function RedoIcon({ label }: { label?: string }) {
  return (
    <Icon label={label}>
      <g transform="translate(16 0) scale(-1 1)">
        <path d={UNDO_PATH} />
      </g>
    </Icon>
  );
}

export function RotateIcon({ label }: { label?: string }) {
  return (
    <Icon label={label}>
      <path d={ROTATE_PATH} />
    </Icon>
  );
}
