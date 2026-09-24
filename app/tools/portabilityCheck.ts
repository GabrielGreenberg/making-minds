// Headless gate: every harness tool runs from any checkout (P-TOOLS-1 of
// docs/buildout/QUEUE.md — task 016).
//
//   cd app && npx tsx tools/portabilityCheck.ts
//
// Family: a harness tool that resolves something only its author's machine
// has. It passes there, fails everywhere else, and hides behind the
// earlier-passing tools in the chain — bumpCheck.ts imported
// `/Users/gabriel/.../making-minds/...` for ~20 build-out iterations: green on
// a piped tail, red by exit code off the authoring checkout. A regex for
// `from '/Users` catches that one spelling. This gate lists every import off
// TypeScript's own parse tree (`moduleRefs` — a string, comment, regex or
// template that merely reads like an import is not one, and no regex or
// aliased require hides a real one) and refuses every way an import can be
// machine-bound:
//
//   R1 ABSOLUTE  a `/…`, `\…`, `C:/…` or `file:` specifier, or any URL scheme
//                but `node:` (https://esm.sh/… is fetched, not in the repo).
//   R2 ESCAPE    a relative specifier that walks above the repo root at any
//                step — an absolute path in ../ disguise, even one that comes
//                back in through the checkout's own folder name (a worktree's
//                differs). Judged before existence: the escaped-to file may
//                well exist on the author's box.
//   R3 RESOLVE   a relative specifier that names no file, or names one only in
//                different letter case (macOS opens './Builder' as builder.ts;
//                Linux CI does not). Lookups walk directory listings, so the
//                verdict is the same on every OS.
//   R4 DECLARED  a bare package missing from the nearest package.json (at or
//                above the file, inside the repo): it resolves only through a
//                global install or a stray node_modules. `node:*` and
//                unprefixed builtins always pass (Node 20's isBuiltin says no
//                to node:sqlite); tasks/tools has no package.json, so it may
//                import builtins only.
//   R5 MACHINE   a string or template whose text BEGINS with a home or drive
//                path (/Users/, /home/, ~/, C:\ or C:/, optionally after
//                file://) — a hardcoded path read at runtime is the same bug
//                without an import.
//
// Scope: every code file (.ts/.tsx/.mts/.cts/.mjs/.js/.cjs, recursive, no
// node_modules) under app/tools, server/tools and tasks/tools — this file
// included, so it passes its own rules. The repo root comes from this file's
// URL, never a literal: the gate runs the same from a worktree. It runs FIRST
// in the app chain (and as its own CI step): a machine-bound import later in
// the chain crashes that tool with a bare module-not-found; this names it.
//
//   [tripwire]  the pure scanner on synthetic sources — every rule bites and
//               names the file; the negative controls stay clean.
//   [sweep]     zero violations over the real tree, with count pins so a
//               wrong root cannot pass vacuously.

import ts from 'typescript';
import { isBuiltin } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const TOOL_DIRS = ['app/tools', 'server/tools', 'tasks/tools'];
const CODE_FILE = /\.(?:ts|tsx|mts|cts|mjs|js|cjs)$/;
// R5. A regex literal, not a string, so this file's own sweep stays clean.
const MACHINE_PATH = /^(?:file:\/\/)?(?:\/Users\/|\/home\/|~\/|[A-Za-z]:[\\/])/;

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const repoRel = (abs: string) => relative(REPO, abs).split(sep).join('/');
const insideRepo = (abs: string) => abs === REPO || abs.startsWith(REPO + sep);
const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

// ─── resolution against the real file system ─────────────────────────

const listings = new Map<string, string[]>();
function listDir(dir: string): string[] {
  let names = listings.get(dir);
  if (!names) {
    try { names = readdirSync(dir); } catch { names = []; }
    listings.set(dir, names);
  }
  return names;
}

/** The file at `abs` (inside the repo), found by walking directory listings
 *  one segment at a time — exactly, or ignoring letter case — so a lookup on
 *  a case-insensitive disk answers what Linux's would. */
function findFile(abs: string, ignoreCase: boolean): string | null {
  let at = REPO;
  for (const seg of relative(REPO, abs).split(sep)) {
    if (!seg) continue;
    const names = listDir(at);
    const hit = names.includes(seg) ? seg
      : ignoreCase ? names.find((n) => n.toLowerCase() === seg.toLowerCase()) : undefined;
    if (hit === undefined) return null;
    at = join(at, hit);
  }
  try { return statSync(at).isFile() ? at : null; } catch { return null; }
}

/** What tsx / Node / bundler resolution would try for a relative specifier. */
function candidates(target: string): string[] {
  const out = ['', '.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.cjs', '.json',
    '/index.ts', '/index.tsx', '/index.js'].map((suffix) => target + suffix);
  const js = /\.([mc]?)js$/.exec(target);
  if (js) {
    const stem = target.slice(0, -js[0].length);
    out.push(`${stem}.${js[1]}ts`);
    if (!js[1]) out.push(`${stem}.tsx`);
  }
  return out;
}

/** The directory walk a relative specifier makes; null once it steps above
 *  the repo root (R2 — even if a later segment would climb back in). */
function walkInside(fromDir: string, spec: string): string | null {
  let at = fromDir;
  for (const seg of spec.split(/[\\/]/)) {
    if (seg === '..') at = dirname(at);
    else if (seg && seg !== '.') at = join(at, seg);
    if (!insideRepo(at)) return null;
  }
  return at;
}

const manifests = new Map<string, Set<string> | null>();
/** The packages declared by `dir/package.json`, or null if there is none. */
function manifestAt(dir: string): Set<string> | null {
  if (!manifests.has(dir)) {
    let text: string | null = null;
    try { text = readFileSync(join(dir, 'package.json'), 'utf8'); } catch { /* none here */ }
    const pkg = text === null ? null : JSON.parse(text);
    manifests.set(dir, pkg && new Set(
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .flatMap((field) => Object.keys(pkg[field] ?? {}))));
  }
  return manifests.get(dir) ?? null;
}

function nearestManifest(fromDir: string): { dir: string; names: Set<string> } | null {
  for (let dir = fromDir; insideRepo(dir); dir = dirname(dir)) {
    const names = manifestAt(dir);
    if (names) return { dir, names };
  }
  return null;
}

type RefKind = 'import' | 'reference' | 'types';

/** Why this specifier is machine-bound (R1–R4), or null if it is portable.
 *  `partial`: only the head of a template specifier (`/abs/${x}`) is known,
 *  so only R1 can be judged. */
function importProblem(absFile: string, spec: string, kind: RefKind, partial = false): string | null {
  if (/^(?:[a-z]:[\\/]|[\\/]|file:)/i.test(spec)) {
    return 'is an absolute path (resolves on one machine only)';
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(spec) && !spec.startsWith('node:')) {
    return 'is a URL import (fetched from outside the repo)';
  }
  if (partial) return null;
  if (kind === 'reference' || /^\.\.?(?:[\\/]|$)/.test(spec)) {
    const target = walkInside(dirname(absFile), spec);
    if (target === null) return 'reaches outside the repo (an absolute path in ../ disguise)';
    if (candidates(target).some((c) => findFile(c, false))) return null;
    return candidates(target).some((c) => findFile(c, true))
      ? 'letter case differs from the file on disk (resolves on macOS only)'
      : 'does not resolve to a file in the repo';
  }
  if (spec.startsWith('node:') || isBuiltin(spec)) return null;
  const name = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
  const manifest = nearestManifest(dirname(absFile));
  if (!manifest) return `${repoRel(dirname(absFile))} has no package.json, so it may import Node builtins only`;
  const typesName = `@types/${name.replace(/^@/, '').replace('/', '__')}`;
  if (manifest.names.has(name) || (kind === 'types' && manifest.names.has(typesName))) return null;
  return `package '${name}' is not declared in ${repoRel(join(manifest.dir, 'package.json'))} (resolves only via a global or stray node_modules)`;
}

// ─── the pure scanner ────────────────────────────────────────────────

type ModuleRef = { spec: string; pos: number; kind: RefKind; partial: boolean };

/** Every module specifier a parsed file names, read off the parse tree —
 *  not `ts.preProcessFile`'s token pre-scan, which a backtick inside a regex
 *  literal blinds to every import after it and which never sees an aliased
 *  require. Static / type / dynamic `import`, `export … from`,
 *  `import x = require(…)`, `import('…')` types, `require(…)` under any
 *  `createRequire(…)` or `= require` alias, `require.resolve(…)`,
 *  `import.meta.resolve(…)`, and triple-slash path / types references. A
 *  template argument (`/abs/${x}`) contributes its head, judged by R1 alone. */
function moduleRefs(source: ts.SourceFile): ModuleRef[] {
  const refs: ModuleRef[] = [
    ...source.referencedFiles.map((r) => ({ spec: r.fileName, pos: r.pos, kind: 'reference' as const, partial: false })),
    ...source.typeReferenceDirectives.map((r) => ({ spec: r.fileName, pos: r.pos, kind: 'types' as const, partial: false })),
  ];

  // Pass 1, in source order (so an alias of an alias binds): the names that
  // hold a require function.
  const requireNames = new Set(['require']);
  const isRequireFn = (expr: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) expr = expr.expression;
    if (ts.isIdentifier(expr)) return requireNames.has(expr.text);
    if (!ts.isCallExpression(expr)) return false;
    const callee = expr.expression;
    return (ts.isIdentifier(callee) && callee.text === 'createRequire')
      || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRequire');
  };
  const bind = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer && isRequireFn(node.initializer)) requireNames.add(node.name.text);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left) && isRequireFn(node.right)) requireNames.add(node.left.text);
    ts.forEachChild(node, bind);
  };
  bind(source);

  // Pass 2: every place a specifier is named.
  const add = (arg: ts.Expression | undefined) => {
    if (!arg) return;
    if (ts.isStringLiteralLike(arg)) {
      refs.push({ spec: arg.text, pos: arg.getStart(source), kind: 'import', partial: false });
    } else if (ts.isTemplateExpression(arg)) {
      refs.push({ spec: arg.head.text, pos: arg.getStart(source), kind: 'import', partial: true });
    }
  };
  const isResolver = (callee: ts.Expression) => ts.isPropertyAccessExpression(callee)
    && callee.name.text === 'resolve'
    && ((ts.isIdentifier(callee.expression) && requireNames.has(callee.expression.text))
      || (ts.isMetaProperty(callee.expression) && callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword));
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(callee) && requireNames.has(callee.text))
        || isResolver(callee)) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

/** Every violation in one source file, each prefixed `<repo-rel file>:<line>`. */
function scanSource(absFile: string, text: string): { violations: string[]; specifiers: number } {
  const rel = repoRel(absFile);
  const kind = /\.[mc]?js$/.test(absFile) ? ts.ScriptKind.JS
    : absFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1;
  const refs = moduleRefs(source);

  const violations: string[] = [];
  const reported = new Set<string>(); // `${line}\0${spec}` — R5 skips a specifier R1 named
  for (const ref of refs) {
    const why = importProblem(absFile, ref.spec, ref.kind, ref.partial);
    if (!why) continue;
    const line = lineOf(ref.pos);
    reported.add(`${line}\0${ref.spec}`);
    violations.push(`${rel}:${line} imports '${ref.partial ? `${ref.spec}\${…}` : ref.spec}' — ${why}`);
  }

  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && MACHINE_PATH.test(node.text)) {
      const line = lineOf(node.getStart(source));
      if (!reported.has(`${line}\0${node.text}`)) {
        violations.push(`${rel}:${line} has the string '${clip(node.text)}' — hardcodes a machine path`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { violations, specifiers: refs.length };
}

// ─── [tripwire] ──────────────────────────────────────────────────────

console.log('\n[tripwire: every rule bites and names the file]');
{
  // Virtual files: the source is synthetic, resolution uses the real tree.
  const TOOL = join(REPO, 'app', 'tools', '__tripwire__.ts');
  const SERVER = join(REPO, 'server', 'tools', '__tripwire__.ts');
  const TASKS = join(REPO, 'tasks', 'tools', '__tripwire__.mjs');
  const bites: Array<[label: string, file: string, source: string, why: string]> = [
    ['R1 absolute /Users import (the bumpCheck bug)', TOOL,
      "import x from '/Users/someone/making-minds/app/src/types';", 'absolute path'],
    ['R1 drive-letter re-export', TOOL, "export * from 'C:/work/x';", 'absolute path'],
    ['R1 dynamic import()', TOOL, "await import('/abs/x');", 'absolute path'],
    ['R1 require()', TOOL, "const r = require('/abs/y');", 'absolute path'],
    ['R1 file: URL', TOOL, "import u from 'file:///x';", 'absolute path'],
    ['R1 https: URL', TOOL, "import h from 'https://esm.sh/x';", 'URL import'],
    ['R2 ../ escape to a path that does not exist here', TOOL,
      "import b from '../../../elsewhere/making-minds/app/src/types';", 'outside the repo'],
    ['R2 ../ escape back in through the checkout folder name', TOOL,
      `import b from '../../../${basename(REPO)}/app/tools/builder';`, 'outside the repo'],
    ['R3 case mismatch (./Builder vs builder.ts)', TOOL,
      "import c from './Builder';", 'letter case differs'],
    ['R3 unresolved relative', TOOL, "import d from './noSuchModule';", 'does not resolve'],
    ['R4 undeclared package in app/tools', TOOL, "import e from 'left-pad';", "'left-pad' is not declared"],
    ['R4 undeclared scoped package', SERVER, "import s from '@scope/pkg/sub';", "'@scope/pkg' is not declared"],
    ['R4 tasks/tools imports a package', TASKS, "import t from 'typescript';", 'builtins only'],
    ['R5 template literal /home/ path', TOOL, 'const p = `/home/ci/fixtures/x.json`;', 'machine path'],
    ['R5 template head /Users/ path', TOOL, 'const q = `/Users/x/${name}.json`;', 'machine path'],
    ['R5 file:///Users string', TOOL, "const t = readFileSync('file:///Users/x');", 'machine path'],
    ['R5 drive path string', TASKS, "const w = 'D:/data/x.csv';", 'machine path'],
    // Import forms a token pre-scan misses or never looks for.
    ['R1 import() after a backtick regex', TOOL,
      "const fence = /`{3}/;\nawait import('/Volumes/Work/making-minds/app/src/types');", 'absolute path'],
    ['R2 static import after a backtick regex', TOOL,
      "const fence = /`{3}/;\nimport { comp } from '../../../elsewhere/app/tools/builder';", 'outside the repo'],
    ['R1 createRequire alias', TOOL, "import { createRequire } from 'node:module';\n"
      + "const req = createRequire(import.meta.url);\nreq('/opt/making-minds/app/src/types.js');", 'absolute path'],
    ['R1 alias of require', TASKS, "const load = require;\nload('/opt/x.cjs');", 'absolute path'],
    ['R1 require.resolve', TOOL, "const p = require.resolve('/abs/z');", 'absolute path'],
    ['R1 import.meta.resolve', TOOL, "const p = import.meta.resolve('/abs/z');", 'absolute path'],
    ['R1 import = require', TOOL, "import w = require('/abs/w');", 'absolute path'],
    ['R1 import() type', TOOL, "type T = typeof import('/abs/types');", 'absolute path'],
    ['R1 template import() with an absolute head', TOOL, 'await import(`/Volumes/${disk}/x.ts`);', 'absolute path'],
    ['R3 triple-slash reference to no file', TOOL, '/// <reference path="./noSuchFile.d.ts" />\nexport {};',
      'does not resolve'],
  ];
  for (const [label, file, source, why] of bites) {
    const { violations } = scanSource(file, source);
    const name = repoRel(file);
    const ok = violations.length > 0
      && violations.every((v) => v.startsWith(`${name}:`))
      && violations.some((v) => v.includes(why));
    check(`${label} → flagged, naming ${name}`, ok);
    if (!ok) for (const v of violations) console.log(`        → ${v}`);
  }

  const clean: Array<[label: string, file: string, source: string]> = [
    ['relative import that resolves', TOOL, "import { comp } from './builder';"],
    ['type-only import into src', TOOL, "import type { CircuitData } from '../src/types';"],
    ['.js specifier resolving to .ts', TOOL, "import { comp } from './builder.js';"],
    ['server tool reaching app/src', SERVER, "import type { CircuitData } from '../../app/src/types';"],
    ['node: builtin', TOOL, "import fs from 'node:fs';"],
    ['node:sqlite (not isBuiltin on Node 20)', SERVER, "import 'node:sqlite';"],
    ['unprefixed builtin in tasks/tools', TASKS, "import { readFileSync } from 'fs';"],
    ['declared package', TOOL, "import ts from 'typescript';"],
    ['declared package subpath', TOOL, "import x from 'typescript/lib/typescript.js';"],
    ['declared server package', SERVER, "import express from 'express';"],
    ['import-shaped string', TOOL, 'const s = "import x from \'/Users/a/b\'";'],
    ['import in a comment', TOOL, "// import y from '/Users/z'\nexport {};"],
    ['browser-side import() in a template', TOOL, "const page = `await import('/making-minds/src/x.ts')`;"],
    ['regex literal', TOOL, 'const re = /\\.\\/src\\/x/;'],
    ['machine path mid-template (not its start)', TOOL, 'const m = `${root}/home/x`;'],
    ['template import() with a relative head', TOOL, 'await import(`./${name}.ts`);'],
    ['a resolve() that is not a module resolver', TOOL, "const r = path.resolve('/abs/x');"],
    ['a call that is not require', TOOL, "const v = load('/abs/x');"],
  ];
  for (const [label, file, source] of clean) {
    const { violations } = scanSource(file, source);
    check(`${label} → clean`, violations.length === 0);
    for (const v of violations) console.log(`        → ${v}`);
  }
}

// ─── [sweep] ─────────────────────────────────────────────────────────

console.log('\n[sweep: every harness tool is portable]');
{
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (CODE_FILE.test(name)) files.push(p);
    }
  };
  for (const dir of TOOL_DIRS) walk(join(REPO, ...dir.split('/')));

  let specifiers = 0;
  const violations: string[] = [];
  for (const file of files) {
    const scan = scanSource(file, readFileSync(file, 'utf8'));
    specifiers += scan.specifiers;
    violations.push(...scan.violations);
  }
  for (const v of violations) console.log(`        → ${v}`);
  check(`no machine-bound import or path in ${files.length} tool files (${specifiers} specifiers)`,
    violations.length === 0);

  // Vacuity pins: a wrong root, a skipped directory or a blind scanner fails
  // here instead of passing green.
  const scanned = new Set(files.map(repoRel));
  check(`scanned more than 25 files (${files.length})`, files.length > 25);
  for (const must of ['app/tools/portabilityCheck.ts', 'server/tools/parityCheck.ts',
    'tasks/tools/check-budgets.mjs', 'app/tools/shootProblemSets.mjs']) {
    check(`the sweep covers ${must}`, scanned.has(must));
  }
  check(`saw more than 200 import specifiers (${specifiers})`, specifiers > 200);
}

// ─── verdict ─────────────────────────────────────────────────────────

console.log(`\n${failures === 0 ? 'PORTABILITY CHECK OK' : `PORTABILITY CHECK FAILED (${failures} checks)`}`);
process.exit(failures === 0 ? 0 : 1);
