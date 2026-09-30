// themeCheck — the grep gate for the site's ONE visual language (task
// 2026-09-21-019; widened to the editor by task 2026-09-25-052). Everything
// outside the circuit editor, and the editor's own frame, is styled through
// src/theme.css (the makingminds.org tokens + the shared vocabulary),
// src/pages.css (per-surface rules) and src/workbench.css (the editor's
// frame), so the pins are:
//
//   1. Colour literals (#hex, rgb/rgba/hsl, named colours) appear ONLY inside
//      theme.css's :root block. pages.css, workbench.css, the rest of theme.css,
//      every page component and every editor-frame component carry none — a new
//      surface cannot re-introduce an ad-hoc grey.
//   2. Every var(--mm-…) used anywhere resolves to a token defined in :root
//      (a typo'd token silently falls back to nothing in the browser).
//   3. The wiring: main.tsx (and the embed's entry, embed/main.tsx) imports
//      theme.css → index.css → pages.css → workbench.css; index.html loads
//      the IBM Plex fonts; each page surface renders <PageShell>; the retired header idioms are gone.
//   4. The editor's older stylesheet (index.css — the canvas, palette and data
//      panel internals) is migrating onto the tokens: its colour literals may
//      only go DOWN (a ratchet), until tasks 053–055 bring them to zero.
//   5. One modal (task 088): the scrim and card markup live only in
//      components/Modal.tsx, which portals to document.body with role=dialog
//      and aria-modal, and owns Escape. Every dialog renders <Modal>, so none
//      inherits its opener's type or sits in its stacking context again.
//
// Run from app/: npx tsx tools/themeCheck.ts   (part of `npm run check`).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`);
  if (!ok) failures++;
}

// The page components: everything that renders outside the editor's .app tree —
// and the editor's frame (task 052), which speaks the same language.
const PAGE_COMPONENTS = [
  'components/EditorShell.tsx',
  'components/EditorTopBar.tsx',
  'components/QuestionPanel.tsx',
  'components/PanelDivider.tsx',
  'components/Worksheet.tsx',
  'components/OutputPanel.tsx',
  'components/LiveTruthTable.tsx',
  'components/CanvasActions.tsx',
  'components/CanvasIcons.tsx',
  'components/Palette.tsx',
  'components/CanvasGuide.tsx',
  'components/PageShell.tsx',
  'components/SessionControls.tsx',
  'components/HomeScreen.tsx',
  'components/AssignmentOverview.tsx',
  'components/ProblemSetDocument.tsx',
  'components/StatementBody.tsx',
  'components/GradesView.tsx',
  'components/GradeSheet.tsx',
  'components/StudentLayout.tsx',
  'components/FeedbackPanel.tsx',
  'components/Modal.tsx',
  'auth/LoginScreen.tsx',
  'auth/HealthGate.tsx',
  'auth/AccountPanel.tsx',
  // The embeddable sandbox (task 087): its bar, poster and notes.
  ...readdirSync(path.join(SRC, 'embed'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `embed/${f}`),
  ...readdirSync(path.join(SRC, 'instructor'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `instructor/${f}`),
];

const theme = read('theme.css');
const pages = read('pages.css');
const frame = read('workbench.css');
const editor = read('index.css');

// ── 1. Colour literals only in theme.css :root ─────────────────────────────
const ROOT_BLOCK = /:root\s*\{[^}]*\}/g;
const themeOutsideRoot = theme.replace(ROOT_BLOCK, '');
const HEX = /(?<!&)#[0-9a-fA-F]{3,8}\b/g; // (?<!&): HTML entities like &#8217; are not colours
const FUNC = /\b(?:rgba?|hsla?)\s*\(/g;
// Named colours in value position (`: white;`); `white-space` and the like don't match.
const NAMED = /:\s*(?:white|black|red|blue|green|gr[ae]y|orange|purple|pink|yellow)\s*[;!]/gi;

function literals(text: string): string[] {
  const hits = [...text.matchAll(HEX), ...text.matchAll(FUNC), ...text.matchAll(NAMED)];
  return hits.map((m) => {
    const line = text.slice(0, m.index).split('\n').length;
    return `${line}: ${m[0]}`;
  });
}
function noLiterals(label: string, text: string) {
  const hits = literals(text);
  check(`${label}: no colour literals`, hits.length === 0, hits.slice(0, 8).join(' · '));
}
check('theme.css: has a :root token block', ROOT_BLOCK.test(theme));
noLiterals('theme.css outside :root', themeOutsideRoot);
noLiterals('pages.css', pages);
noLiterals('workbench.css', frame);
for (const rel of PAGE_COMPONENTS) noLiterals(rel, read(rel));

// ── 2. Every var(--mm-…) resolves ──────────────────────────────────────────
const defined = new Set([...theme.matchAll(/(--mm-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const usedIn = (text: string) => new Set([...text.matchAll(/var\(\s*(--mm-[a-z0-9-]+)/g)].map((m) => m[1]));
const undefinedTokens = new Set<string>();
for (const [label, text] of [['theme.css', theme], ['pages.css', pages], ['workbench.css', frame], ['index.css', editor], ...PAGE_COMPONENTS.map((r) => [r, read(r)] as const)] as const) {
  for (const t of usedIn(text)) if (!defined.has(t)) undefinedTokens.add(`${t} (${label})`);
}
check(`every var(--mm-*) resolves to a defined token (${defined.size} defined)`, undefinedTokens.size === 0, [...undefinedTokens].join(', '));

// ── 2b. The canvas (task 055) ──────────────────────────────────────────────
// The canvas draws in SVG attributes, so its colours are theme ROLES
// (canvasTheme.ts) read off the tokens — never a literal: no hex, no rgb/hsl,
// no quoted colour name ('white', "black"), no monospace stack. Every role
// names a token theme.css defines.
{
  const QUOTED_NAMED = /['"](?:white|black|red|blue|green|gr[ae]y|orange|purple|pink|yellow)['"]/g;
  for (const rel of ['components/CircuitCanvas.tsx', 'canvasTheme.ts']) {
    const text = read(rel);
    const hits = [...literals(text), ...[...text.matchAll(QUOTED_NAMED)].map((m) => `${text.slice(0, m.index).split('\n').length}: ${m[0]}`)];
    check(`${rel}: no colour literals (hex, rgb/hsl, quoted names)`, hits.length === 0, hits.slice(0, 8).join(' · '));
  }
  const canvas = read('components/CircuitCanvas.tsx');
  check('CircuitCanvas.tsx: no monospace text (Plex Sans, tabular — decision 2)', !/monospace|SF Mono|Fira Code/.test(canvas));
  const roles = [...read('canvasTheme.ts').matchAll(/^\s+[a-zA-Z0-9]+: '(--mm-[a-z0-9-]+)',/gm)].map((m) => m[1]);
  const missing = roles.filter((t) => !defined.has(t));
  check(`every canvas role names a defined token (${roles.length} roles)`, roles.length >= 15 && missing.length === 0, missing.join(', '));
  for (const t of usedIn(canvas)) if (!defined.has(t)) undefinedTokens.add(`${t} (CircuitCanvas.tsx)`);
  check('CircuitCanvas.tsx: every var(--mm-*) resolves', [...usedIn(canvas)].every((t) => defined.has(t)));
}

// ── 3. Wiring ──────────────────────────────────────────────────────────────
const main = read('main.tsx');
const order = ["import './theme.css'", "import './index.css'", "import './pages.css'", "import './workbench.css'"].map((s) => main.indexOf(s));
check('main.tsx imports theme.css → index.css → pages.css → workbench.css',
  order.every((i) => i >= 0) && order.every((i, k) => k === 0 || order[k - 1] < i));

// The embed's entry (task 087) loads the same sheets in the same order, and no KaTeX.
const embedMain = read('embed/main.tsx');
const embedOrder = ["import '../theme.css'", "import '../index.css'", "import '../pages.css'", "import '../workbench.css'"].map((s) => embedMain.indexOf(s));
check('embed/main.tsx imports theme.css → index.css → pages.css → workbench.css, and no KaTeX css',
  embedOrder.every((i) => i >= 0) && embedOrder.every((i, k) => k === 0 || embedOrder[k - 1] < i) &&
    !/katex/i.test(embedMain.replace(/^\s*\/\/.*$/gm, '')));

const html = readFileSync(path.join(SRC, '../index.html'), 'utf8');
check('index.html loads the IBM Plex fonts (Sans + Serif + Mono)', /fonts\.googleapis\.com\/css2\?[^"]*IBM\+Plex\+Sans[^"]*IBM\+Plex\+Serif[^"]*IBM\+Plex\+Mono/.test(html));
check('index.html title is the course, not "app"', /<title>Making Minds/.test(html));

// ── 4. index.css, the editor's older stylesheet: a literal ratchet ────────
// It may use the page tokens (they resolve — pin 2); its own colour literals
// are the canvas, palette and data-panel internals that tasks 053–055 move
// onto the tokens. The ceiling only ever goes down: lower it as they go, and
// a new literal fails here. At 0 this becomes pin 1's rule for index.css.
const INDEX_CSS_LITERAL_CEILING = 126;
const editorLiterals = literals(editor);
check(
  `index.css: colour literals only go down (${editorLiterals.length} ≤ ${INDEX_CSS_LITERAL_CEILING})`,
  editorLiterals.length <= INDEX_CSS_LITERAL_CEILING,
  `${editorLiterals.length} found — move the new colour into a theme.css token`,
);

for (const rel of ['components/StudentLayout.tsx', 'instructor/InstructorLayout.tsx', 'instructor/InstructorGate.tsx', 'auth/LoginScreen.tsx', 'auth/HealthGate.tsx']) {
  check(`${rel} renders <PageShell>`, /<PageShell\b/.test(read(rel)));
}
for (const rel of ['components/HomeScreen.tsx', 'components/GradesView.tsx', 'components/AssignmentOverview.tsx']) {
  check(`${rel} renders <StudentLayout> (the Home tabs)`, /<StudentLayout\b/.test(read(rel)));
}
check('the grade-sheet modal (GradesPanel) is gone', !existsSync(path.join(SRC, 'components/GradesPanel.tsx')));

const RETIRED =
  /(?<![\w-])(?:page-bar|page-body|instructor-header|instructor-app|login-screen|login-card|modal-card|modal-backdrop|instructor-btn|instructor-input|instructor-badge|instructor-page-head|instructor-page-title|instructor-section-title|instructor-subhead|instructor-section-head|instructor-field|instructor-unlock|instructor-empty|instructor-hint|instructor-link|instructor-select|instructor-encoding|instructor-mode-btn|instructor-textarea|instructor-title-input|instructor-inline-field|instructor-head-actions|subbar|page--wide|login-tabs|login-tab)(?:--?[\w-]*)?(?![\w-])|(?<![\w-])instructor-table(?![\w-])/;
const allSrc = (dir: string): string[] =>
  readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? allSrc(path.join(dir, d.name)) : /\.(tsx?|css)$/.test(d.name) ? [path.join(dir, d.name)] : []);
const retiredHits = allSrc('.').filter((rel) => RETIRED.test(read(rel)));
check('the retired header/modal idioms are gone from src/', retiredHits.length === 0, retiredHits.join(', '));

// ── 5. One modal ───────────────────────────────────────────────────────────
{
  const MODAL = 'components/Modal.tsx';
  const codeOf = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\/|(?<=^|\s)\/\/[^\n]*/gm, '');
  const tsx = allSrc('.').filter((rel) => /\.tsx?$/.test(rel));
  // The scrim's class, and the card's bare token ('mm-modal' not followed by
  // '-' or a word character: mm-modal-head and mm-modal--narrow are the card's
  // inner vocabulary, free to use).
  const markup = tsx.filter((rel) => rel !== MODAL && /mm-modal-backdrop|["' ]mm-modal(?![-\w])/.test(codeOf(rel)));
  check(`the modal scrim and card markup appear only in ${MODAL} (${tsx.length} files scanned)`, markup.length === 0, markup.join(', '));
  const modal = codeOf(MODAL);
  check(`${MODAL} portals to document.body as a dialog (role, aria-modal) and owns Escape`,
    /createPortal\(/.test(modal) && /document\.body/.test(modal) && /role="dialog"/.test(modal) && /aria-modal="true"/.test(modal) &&
      /className="mm-modal-backdrop"/.test(modal) && /'mm-modal'/.test(modal) &&
      /document\.addEventListener\('keydown'/.test(modal) && /pushModal\(/.test(modal) && /popModal\(/.test(modal) &&
      /latest\.current\.busy/.test(modal));
  for (const rel of ['components/FeedbackPanel.tsx', 'auth/AccountPanel.tsx', 'components/WorkbookFileMenu.tsx',
    'components/SubmitDialog.tsx', 'instructor/LateAdjustControls.tsx', 'instructor/RegradeDialog.tsx']) {
    const text = codeOf(rel);
    check(`${rel} renders <Modal> and keeps no Escape listener of its own`,
      /<Modal\b/.test(text) && !/'Escape'/.test(text));
  }
}

console.log(failures === 0 ? '\nthemeCheck: all pins hold.' : `\nthemeCheck: ${failures} pin(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
