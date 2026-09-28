// Cropped-in neighbours in a problem-set figure (task 077) — the pure reader
// behind statementFormatCheck's [figures: no cropped-in neighbours] pins and
// its corpus sweep over every figure a homework references.
//
// Family: the SVGs under public/problem-sets/ are hand crops of the HW PDFs
// (pdftocairo output), so a crop can keep the edge of whatever sat beside the
// drawing on the page. HW1's M/N schematic kept the last 0.6 units of the grey
// Hint box to its left (App Feedback fb-muliz8de-r7tfme, instructor); HW2's
// retina arrow lost its head to the crop but kept a 0.02-unit remnant of it;
// HW2's machine-format background stopped 2.5 units short of the right edge.
//
// The rule: a filled <path> or <rect> outside <defs> whose bounding box runs
// past an edge of the viewBox on an axis it does not span is a fault, with no
// exemption for how much of it the crop keeps. A full-frame background spans
// every axis it crosses, so it passes; anything else that meets an edge is
// either a neighbour's piece (HW1's hint box: 0.2% kept) or a shape of the
// figure's own the crop trims (hw3-retina's left terminal squares were, 66%
// kept) — both fixed by the frame, never by the rule. A size- or share-based
// pass would let a thin neighbour through (a rule or box border drawn as a
// filled rect, half inside, leaves the same bar down the edge).
//
// Blind spots, by design: strokes (fill="none") and text (<use> glyphs,
// <text>) are out of scope, as are <image>s and a <use> of a drawn shape
// (hw1's masked drawing is one, inside the frame). Clip-paths are ignored on
// purpose: here they are cairo's page-edge clips, and honouring them would
// pass a clipped remnant (hw2-retina's arrowhead). A curve's box is its
// control points' (a hull, so a little generous). Geometry this reader cannot
// follow — a relative / H / V / A path command, a transform other than
// matrix() or translate(), a filled circle / ellipse / polygon / polyline, a
// non-numeric rect attribute, a missing viewBox — is a fault, never a silent
// pass.

type Matrix = [number, number, number, number, number, number];
type Point = [number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };
/** An open <g>: what its descendants inherit. `ctm` is a fault string when a
 *  transform on the way down could not be read. */
type Frame = { fill?: string; fillOpacity?: string; ctm: Matrix | string };

const EPS = 1e-3;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const UNSUPPORTED = new Set(['circle', 'ellipse', 'polygon', 'polyline']);

/** A whitespace/comma separated number list, or null if anything else is in it. */
function numbers(text: string): number[] | null {
  const out: number[] = [];
  const rest = text.replace(new RegExp(NUMBER.source, 'g'), (n) => { out.push(Number(n)); return ' '; });
  return /^[\s,]*$/.test(rest) ? out : null;
}

function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, dq, sq] of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(name, dq ?? sq);
  return out;
}

/** A presentation property: a `style` declaration wins over the attribute. */
function prop(attrs: Map<string, string>, name: string): string | undefined {
  const declared = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(attrs.get('style') ?? '');
  return declared ? declared[1].trim() : attrs.get(name);
}

/** m·n — n applies first, then m. */
function compose(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

/** A transform list (the leftmost function outermost), or a fault. */
function parseTransform(text: string | undefined): Matrix | string {
  let m = IDENTITY;
  let rest = (text ?? '').trim();
  while (rest) {
    const call = /^([A-Za-z]+)\s*\(([^)]*)\)[\s,]*/.exec(rest);
    const args = call ? numbers(call[2]) : null;
    let step: Matrix | null = null;
    if (call?.[1] === 'matrix' && args?.length === 6) step = [args[0], args[1], args[2], args[3], args[4], args[5]];
    else if (call?.[1] === 'translate' && args && (args.length === 1 || args.length === 2)) step = [1, 0, 0, 1, args[0], args[1] ?? 0];
    if (!call || !step) return `transform "${text}" is not matrix() or translate()`;
    m = compose(m, step);
    rest = rest.slice(call[0].length);
  }
  return m;
}

/** A path's points (ends and control points), or a fault. Only the absolute
 *  commands whose numbers come in coordinate pairs are read. */
function pathPoints(d: string): Point[] | string {
  const token = new RegExp(`[A-Za-z]|${NUMBER.source}`, 'g');
  if (!/^[\s,]*$/.test(d.replace(token, ' '))) return 'unreadable path data';
  const points: Point[] = [];
  let command = '';
  let args: number[] = [];
  const flush = (): string | null => {
    if (!command && args.length) return 'unreadable path data (numbers before a command)';
    if (command === 'Z' && args.length) return 'unreadable path data (numbers after Z)';
    if (args.length % 2) return `unreadable path data (an odd count of numbers after ${command})`;
    for (let i = 0; i < args.length; i += 2) points.push([args[i], args[i + 1]]);
    return null;
  };
  for (const t of d.match(token) ?? []) {
    if (/[A-Za-z]/.test(t)) {
      const fault = flush();
      if (fault) return fault;
      if (!'MLCQSTZ'.includes(t)) return `unreadable path: a "${t}" command (only the absolute M L C Q S T Z are read)`;
      command = t;
      args = [];
    } else args.push(Number(t));
  }
  return flush() ?? points;
}

/** A rect's corners, or a fault. */
function rectPoints(attrs: Map<string, string>): Point[] | string {
  const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => {
    const v = numbers(attrs.get(k) ?? '0');
    return v?.length === 1 ? v[0] : NaN;
  });
  if ([x, y, w, h].some(Number.isNaN)) return 'unreadable rect (a non-numeric x / y / width / height)';
  return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** One shape's verdict against the frame, or null when it passes. */
function judge(what: string, points: Point[], frame: Box, viewBox: string): string | null {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const r: Box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const ox = Math.min(r.x1, frame.x1) - Math.max(r.x0, frame.x0);
  const oy = Math.min(r.y1, frame.y1) - Math.max(r.y0, frame.y0);
  if (ox <= EPS || oy <= EPS) return null; // paints nothing inside the frame
  const inside = ox * oy;
  const kept = inside / ((r.x1 - r.x0) * (r.y1 - r.y0));
  const share = inside / ((frame.x1 - frame.x0) * (frame.y1 - frame.y0));
  const axes = [
    { lo: r.x0, hi: r.x1, flo: frame.x0, fhi: frame.x1, edges: ['left', 'right'] },
    { lo: r.y0, hi: r.y1, flo: frame.y0, fhi: frame.y1, edges: ['top', 'bottom'] },
  ];
  const past: string[] = [];
  const short: string[] = [];
  for (const a of axes) {
    const cutLo = a.lo < a.flo - EPS;
    const cutHi = a.hi > a.fhi + EPS;
    const spans = a.lo <= a.flo + EPS && a.hi >= a.fhi - EPS;
    if ((cutLo || cutHi) && !spans) {
      past.push(cutLo ? a.edges[0] : a.edges[1]);
      short.push(cutLo ? `${fmt(a.fhi - a.hi)} short of the ${a.edges[1]}` : `${fmt(a.lo - a.flo)} short of the ${a.edges[0]}`);
    }
  }
  if (!past.length) return null;
  const where = `${what} x ${fmt(r.x0)}→${fmt(r.x1)} y ${fmt(r.y0)}→${fmt(r.y1)} runs past the ${past.join(' and ')} edge${past.length > 1 ? 's' : ''} of viewBox "${viewBox}"`;
  if (share >= 0.5) return `${where} but stops ${short.join(' and ')} edge — a background that leaves a strip unpainted`;
  const pct = (kept * 100).toFixed(1);
  return `${where} with ${pct === '0.0' ? '<0.1' : pct}% inside — a piece of a neighbouring shape, or one of the figure's own the frame trims`;
}

/** Every cropped-in neighbour (and every shape it cannot read) in one SVG
 *  figure; empty = clean. */
export function figureCropFaults(svg: string): string[] {
  const root = /<svg\b[^>]*>/.exec(svg);
  const viewBox = root ? attributes(root[0]).get('viewBox') : undefined;
  const vb = viewBox === undefined ? null : numbers(viewBox);
  if (!vb || vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0) return ['no readable viewBox on the <svg> tag — the crop cannot be judged'];
  const frame: Box = { x0: vb[0], y0: vb[1], x1: vb[0] + vb[2], y1: vb[1] + vb[3] };
  // Nothing in <defs> paints where it stands (glyphs, clip paths, masks, the
  // masked drawing <use>d later); its nested <g>s would unbalance the stack.
  const body = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<defs\b[^>]*\/>/g, '')
    .replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/g, '');
  const faults: string[] = [];
  const stack: Frame[] = [{ ctm: IDENTITY }];
  for (const [, close, tag, rawAttrs, selfClosing] of body.matchAll(/<(\/?)([A-Za-z][\w:-]*)\b([^>]*?)(\/?)>/g)) {
    const top = stack[stack.length - 1];
    if (tag === 'g') {
      if (close) { if (stack.length > 1) stack.pop(); }
      else if (!selfClosing) {
        const attrs = attributes(rawAttrs);
        const own = parseTransform(attrs.get('transform'));
        stack.push({
          fill: prop(attrs, 'fill') ?? top.fill,
          fillOpacity: prop(attrs, 'fill-opacity') ?? top.fillOpacity,
          ctm: typeof top.ctm === 'string' ? top.ctm : typeof own === 'string' ? own : compose(top.ctm, own),
        });
      }
      continue;
    }
    if (close || (tag !== 'path' && tag !== 'rect' && !UNSUPPORTED.has(tag))) continue;
    const attrs = attributes(rawAttrs);
    const fill = prop(attrs, 'fill') ?? top.fill ?? 'black';
    const fillOpacity = prop(attrs, 'fill-opacity') ?? top.fillOpacity ?? '1';
    if (fill.trim().toLowerCase() === 'none' || Number(fillOpacity) === 0) continue;
    const what = `<${tag}> fill=${fill}`;
    if (UNSUPPORTED.has(tag)) { faults.push(`${what}: a filled <${tag}> outside <defs> — only <path> and <rect> are read, so it cannot be judged`); continue; }
    const own = parseTransform(attrs.get('transform'));
    const ctm = typeof top.ctm === 'string' ? top.ctm : typeof own === 'string' ? own : compose(top.ctm, own);
    const points = tag === 'path' ? pathPoints(attrs.get('d') ?? '') : rectPoints(attrs);
    if (typeof ctm === 'string' || typeof points === 'string') { faults.push(`${what}: ${typeof ctm === 'string' ? ctm : points} — it cannot be judged`); continue; }
    const [a, b, c, d, e, f] = ctm;
    const fault = judge(what, points.map(([x, y]): Point => [a * x + c * y + e, b * x + d * y + f]), frame, viewBox ?? '');
    if (fault) faults.push(fault);
  }
  return faults;
}
