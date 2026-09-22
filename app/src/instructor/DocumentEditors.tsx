// The two document-level editing widgets shared by the assignment editor
// (section callouts and figures) and the question creator (a problem's own):
// a list of callout boxes and a list of figures. Figures are uploaded as
// size-capped data URLs — there is no upload endpoint, and a data URL travels
// inside the assignment JSON through either backend unchanged.

import { useRef, useState } from 'react';
import type { Callout, CalloutKind, Figure, Placement } from '../types';
import { CALLOUT_KINDS } from '../types';
import { DEFAULT_CALLOUT_TITLE, figureUrl } from '../problemSet';

/** A figure may weigh this much as a data URL; a raster is downscaled to fit. */
export const MAX_FIGURE_BYTES = 300 * 1024;
const MAX_RASTER_SIDE = 1400;

const PLACEMENTS: { value: Placement; label: string }[] = [
  { value: 'before', label: 'before the problems' },
  { value: 'after', label: 'after the problems' },
  { value: 'aside', label: 'beside them (sidebar)' },
];

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = dataUrl.slice(comma + 1);
  return dataUrl.slice(0, comma).includes(';base64') ? Math.floor((payload.length * 3) / 4) : payload.length;
}

/** An image file as a data URL under the cap: SVG verbatim (or refused),
 *  a raster downscaled through a canvas until it fits. */
export function readFigureFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      if (file.size > MAX_FIGURE_BYTES) {
        reject(new Error(`This SVG is ${Math.round(file.size / 1024)} KB; figures are capped at ${MAX_FIGURE_BYTES / 1024} KB.`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let side = Math.min(MAX_RASTER_SIDE, Math.max(img.width, img.height));
      // Shrink until the encoded size fits; PNG keeps line art crisp, JPEG
      // is the fallback for photographs that will not fit as PNG.
      for (let attempt = 0; attempt < 6; attempt++) {
        const scale = Math.min(1, side / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas unavailable.')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL('image/png');
        if (dataUrlBytes(png) <= MAX_FIGURE_BYTES) { resolve(png); return; }
        const jpeg = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrlBytes(jpeg) <= MAX_FIGURE_BYTES) { resolve(jpeg); return; }
        side = Math.round(side * 0.7);
      }
      reject(new Error('This image could not be reduced under the figure size cap.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read.')); };
    img.src = url;
  });
}

function update<T>(list: T[], i: number, patch: Partial<T>): T[] {
  return list.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

function remove<T>(list: T[], i: number): T[] {
  return list.filter((_, j) => j !== i);
}

/** Drop a key whose value is empty so the JSON stays lean. */
function prune<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete out[k];
  }
  return out as T;
}

export function FiguresEditor({
  figures,
  onChange,
  label = 'Figures',
}: {
  figures: Figure[];
  onChange: (next: Figure[]) => void;
  label?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const src = await readFigureFile(file);
      onChange([...figures, { src, alt: file.name.replace(/\.[a-z0-9]+$/i, '') }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="doc-editor">
      <div className="doc-editor-head">
        <span className="mm-label">{label}</span>
        <button type="button" className="mm-btn mm-btn--small" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Reading…' : 'Add figure'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          onChange={(e) => { void add(e.target.files?.[0]); }}
        />
      </div>
      {error && <p className="mm-error">{error}</p>}
      {figures.map((f, i) => (
        <div key={i} className="doc-editor-row doc-editor-row--figure">
          <img className="doc-editor-thumb" src={figureUrl(f.src, import.meta.env.BASE_URL)} alt="" />
          <div className="doc-editor-fields">
            <label className="mm-field">
              <span className="mm-label">Alt text</span>
              <input className="mm-input" value={f.alt} onChange={(e) => onChange(update(figures, i, { alt: e.target.value }))} />
            </label>
            <label className="mm-field">
              <span className="mm-label">Caption (optional)</span>
              <input className="mm-input" value={f.caption ?? ''} onChange={(e) => onChange(update(figures, i, prune({ caption: e.target.value })))} />
            </label>
            <div className="doc-editor-inline">
              <label className="mm-inline-field">
                Width (px)
                <input
                  className="mm-input mm-input--num"
                  type="number"
                  min={40}
                  value={f.width ?? ''}
                  onChange={(e) => onChange(update(figures, i, prune({ width: e.target.value ? Number(e.target.value) : undefined })))}
                />
              </label>
              <label className="mm-inline-field">
                Placement
                <select className="mm-input" value={f.placement ?? 'after'} onChange={(e) => onChange(update(figures, i, { placement: e.target.value as Placement }))}>
                  {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
              <button type="button" className="mm-btn mm-btn--small mm-btn--danger" onClick={() => onChange(remove(figures, i))}>Remove</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalloutsEditor({
  callouts,
  onChange,
  label = 'Callout boxes',
}: {
  callouts: Callout[];
  onChange: (next: Callout[]) => void;
  label?: string;
}) {
  return (
    <div className="doc-editor">
      <div className="doc-editor-head">
        <span className="mm-label">{label}</span>
        <button type="button" className="mm-btn mm-btn--small" onClick={() => onChange([...callouts, { kind: 'hint', body: '' }])}>
          Add callout
        </button>
      </div>
      {callouts.map((c, i) => (
        <div key={i} className="doc-editor-row">
          <div className="doc-editor-inline">
            <label className="mm-inline-field">
              Kind
              <select className="mm-input" value={c.kind} onChange={(e) => onChange(update(callouts, i, { kind: e.target.value as CalloutKind }))}>
                {CALLOUT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="mm-inline-field">
              Placement
              <select className="mm-input" value={c.placement ?? 'after'} onChange={(e) => onChange(update(callouts, i, { placement: e.target.value as Placement }))}>
                {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="mm-inline-field doc-editor-grow">
              Heading
              <input
                className="mm-input"
                placeholder={DEFAULT_CALLOUT_TITLE[c.kind] || '(none)'}
                value={c.title ?? ''}
                onChange={(e) => onChange(update(callouts, i, prune({ title: e.target.value })))}
              />
            </label>
            <button type="button" className="mm-btn mm-btn--small mm-btn--danger" onClick={() => onChange(remove(callouts, i))}>Remove</button>
          </div>
          <textarea
            className="mm-input mm-input--area doc-editor-body"
            rows={3}
            placeholder="The box's text — same markup as a statement."
            value={c.body}
            onChange={(e) => onChange(update(callouts, i, { body: e.target.value }))}
          />
          <FiguresEditor
            label="Figures inside this box"
            figures={c.figures ?? []}
            onChange={(figures) => onChange(update(callouts, i, prune({ figures })))}
          />
        </div>
      ))}
    </div>
  );
}
