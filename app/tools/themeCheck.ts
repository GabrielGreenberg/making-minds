// themeCheck — the grep gate for the page-surface design layer (task
// 2026-09-21-019). Everything outside the circuit editor is styled through
// src/theme.css (the makingminds.org tokens + the shared vocabulary) and
// src/pages.css (per-surface rules), so the pins are:
//
//   1. Colour literals (#hex, rgb/rgba/hsl, named colours) appear ONLY inside
//      theme.css's :root block. pages.css, the rest of theme.css and every page
//      component carry none — a new surface cannot re-introduce an ad-hoc grey.
//   2. Every var(--mm-…) used anywhere resolves to a token defined in :root
//      (a typo'd token silently falls back to nothing in the browser).
//   3. The wiring: main.tsx imports theme.css → index.css → pages.css;
//      index.html loads the IBM Plex fonts; the editor stylesheet (index.css)
//      touches the page tokens ONLY to inherit the font family; each page
//      surface renders <PageShell>; the three retired header idioms are gone.
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

// The page components: everything that renders outside the editor's .app tree.
const PAGE_COMPONENTS = [
  'components/PageShell.tsx',
  'components/SessionControls.tsx',
  'components/HomeScreen.tsx',
  'components/AssignmentOverview.tsx',
  'components/GradesView.tsx',
  'components/GradeSheet.tsx',
  'components/StudentLayout.tsx',
  'components/FeedbackPanel.tsx',
  'auth/LoginScreen.tsx',
  'auth/HealthGate.tsx',
  'auth/AccountPanel.tsx',
  ...readdirSync(path.join(SRC, 'instructor'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `instructor/${f}`),
];

const theme = read('theme.css');
const pages = read('pages.css');
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
for (const rel of PAGE_COMPONENTS) noLiterals(rel, read(rel));

// ── 2. Every var(--mm-…) resolves ──────────────────────────────────────────
const defined = new Set([...theme.matchAll(/(--mm-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const usedIn = (text: string) => new Set([...text.matchAll(/var\(\s*(--mm-[a-z0-9-]+)/g)].map((m) => m[1]));
const undefinedTokens = new Set<string>();
for (const [label, text] of [['theme.css', theme], ['pages.css', pages], ['index.css', editor], ...PAGE_COMPONENTS.map((r) => [r, read(r)] as const)] as const) {
  for (const t of usedIn(text)) if (!defined.has(t)) undefinedTokens.add(`${t} (${label})`);
}
check(`every var(--mm-*) resolves to a defined token (${defined.size} defined)`, undefinedTokens.size === 0, [...undefinedTokens].join(', '));

// ── 3. Wiring ──────────────────────────────────────────────────────────────
const main = read('main.tsx');
const order = ["import './theme.css'", "import './index.css'", "import './pages.css'"].map((s) => main.indexOf(s));
check('main.tsx imports theme.css → index.css → pages.css', order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2]);

const html = readFileSync(path.join(SRC, '../index.html'), 'utf8');
check('index.html loads the IBM Plex fonts (Sans + Serif + Mono)', /fonts\.googleapis\.com\/css2\?[^"]*IBM\+Plex\+Sans[^"]*IBM\+Plex\+Serif[^"]*IBM\+Plex\+Mono/.test(html));
check('index.html title is the course, not "app"', /<title>Making Minds/.test(html));

const editorTokenUses = [...editor.matchAll(/--mm-[a-z0-9-]+/g)].map((m) => m[0]);
check(
  'index.css (the editor) inherits only the font family from the page tokens',
  editorTokenUses.length === 1 && editorTokenUses[0] === '--mm-font-sans',
  `found: ${[...new Set(editorTokenUses)].join(', ') || 'none'}`,
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

console.log(failures === 0 ? '\nthemeCheck: all pins hold.' : `\nthemeCheck: ${failures} pin(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
