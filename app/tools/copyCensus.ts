// copyCensus — every user-facing string in the app and the server (task
// 2026-09-29-089, the copy pass). It reads TypeScript's own parse tree, so a
// string is copy by where it sits, not by how it looks:
//
//   jsx       an element's own text, flattened: {…} for an expression, ‹tag›
//             for a child element; inline formatting (<b>, <a>, <span>,
//             <code>…) is read through, so a sentence split by a bold word
//             stays one. An element with no text of its own is not an item.
//   attr      a JSX attribute's string: title / placeholder / aria-label / alt
//             on a DOM element, and any prop of a custom component.
//   string    a string literal anywhere else (a thrown Error, a server reply,
//   template  a status line, a confirm()); `${…}` reads as {…}.
//   concat    a `'a' + x + 'b'` chain, joined into one item.
//
// Dropped, because no reader sees them: devData/, the *-cli.ts entry points,
// server/src/index.ts, *.d.ts; import / require / import() specifiers;
// console.* arguments; className / style / key / id / href / type / role /
// data-* / src / value (and a DOM element's other non-text attributes);
// object keys and element-access keys; comparison and `case` literals;
// type-level literals; SQL (db.prepare / db.exec arguments, or text that
// opens with an upper-case SQL keyword). JSX entities are decoded (&amp; → &).
//
// An item is prose-shaped when, outside its placeholders, it holds a letter
// and a space: what the census lists by default. copyCheck holds EVERY item to
// the house style (docs/buildout/VISUAL_VOCAB.md §Copy), since a fragment with
// no letters of its own (' — {why}', '; ') still marks the sentence it joins.
//
// Run directly it prints the census as TSV (file, line, kind, text) — the
// starting point of a future copy pass:
//
//   cd app && npx tsx tools/copyCensus.ts [--all] > census.tsv
//
// `--all` adds the items that are not prose-shaped. Imports only `typescript`
// and node builtins; the roots come from this file's URL, never a literal path.

import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CopyKind = 'jsx' | 'attr' | 'string' | 'template' | 'concat';

export interface CopyItem {
  /** Repo-relative, '/'-separated (the synthetic name, for extractCopy). */
  file: string;
  /** 1-based line of the item's first character. */
  line: number;
  kind: CopyKind;
  /** As a reader sees it: {…} for an expression (long ones shortened), ‹tag› for a child element. */
  text: string;
  /** The same with every expression as {} and every child element as ‹›: what the rules read. */
  masked: string;
  /** A letter and a space outside the placeholders. */
  prose: boolean;
}

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const COPY_ROOTS = [
  fileURLToPath(new URL('../src/', import.meta.url)),
  fileURLToPath(new URL('../../server/src/', import.meta.url)),
];

type Segment = { t: 'text'; s: string } | { t: 'expr'; src: string } | { t: 'tag'; name: string };

/** Inline elements whose text reads as part of the sentence around them. */
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'cite', 'code', 'em', 'i', 'kbd', 'mark', 'q', 's', 'small',
  'span', 'strong', 'sub', 'sup', 'u', 'var',
]);
/** A DOM element's attributes that are read (everything else on one is markup). */
const TEXT_ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt']);
/** Never read, on any element. */
const DROP_ATTRS = new Set(['className', 'style', 'key', 'id', 'href', 'type', 'role', 'src', 'value']);
const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const SQL_OPENER = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|BEGIN|COMMIT|ROLLBACK|REPLACE)\b/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–',
  hellip: '…', times: '×', middot: '·', larr: '←', rarr: '→', minus: '−',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

const collapse = (s: string) => s.replace(/\s+/g, ' ');
/** An expression as the census shows it: whitespace collapsed, shortened past 40 characters. */
function shortExpr(src: string): string {
  const s = collapse(src).trim();
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

function render(segs: Segment[], masked: boolean): string {
  return segs
    .map((g) => (g.t === 'text' ? g.s : g.t === 'expr' ? (masked ? '{}' : `{${shortExpr(g.src)}}`) : masked ? '‹›' : `‹${g.name}›`))
    .join('');
}

function isStringish(n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression {
  return ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
}
const isPlus = (n: ts.Node): n is ts.BinaryExpression =>
  ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
const tagName = (n: ts.JsxOpeningLikeElement) => n.tagName.getText();
const isIntrinsic = (name: string) => /^[a-z]/.test(name) && !name.includes('.');

/** The call a node is an argument of whose callee is console.*, db.prepare / exec, require or import(). */
function isDroppedCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(callee) && callee.text === 'require') return true;
  if (ts.isPropertyAccessExpression(callee)) {
    if (ts.isIdentifier(callee.expression) && callee.expression.text === 'console') return true;
    if (callee.name.text === 'prepare' || callee.name.text === 'exec') return true;
  }
  return false;
}

/** A literal in a position that is not copy: a key, a comparison, a case, a module specifier. */
function isNonCopyPosition(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) ||
    ts.isMethodDeclaration(p) || ts.isEnumMember(p)) && p.name === n) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isBinaryExpression(p) && (COMPARISON.has(p.operatorToken.kind) ||
    (p.operatorToken.kind === ts.SyntaxKind.InKeyword && p.left === n))) return true;
  if (ts.isCaseClause(p) && p.expression === n) return true;
  return false;
}

/** The items of one source (pure — the tripwire runs it on synthetic sources). */
export function extractCopy(file: string, source: string): CopyItem[] {
  const kind = /\.[cm]?tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const items: CopyItem[] = [];
  const consumed = new Set<ts.Node>();

  const emit = (node: ts.Node, k: CopyKind, raw: Segment[]) => {
    // Merge neighbouring text; a JSX item's whitespace is collapsed and trimmed.
    const segs: Segment[] = [];
    for (const g of raw) {
      const last = segs[segs.length - 1];
      if (g.t === 'text' && last?.t === 'text') last.s += g.s;
      else segs.push(g.t === 'text' ? { ...g } : g);
    }
    if (k === 'jsx') {
      for (const g of segs) if (g.t === 'text') g.s = collapse(g.s);
      const first = segs[0], last = segs[segs.length - 1];
      if (first?.t === 'text') first.s = first.s.trimStart();
      if (last?.t === 'text') last.s = last.s.trimEnd();
    }
    const text = render(segs, false);
    if (!text.trim()) return;
    if (SQL_OPENER.test(text)) return;
    const masked = render(segs, true);
    const prose = /\p{L}/u.test(masked.replace(/\{\}|‹›/g, '')) && /\S\s+\S/.test(masked.replace(/\{\}|‹›/g, '#'));
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    items.push({ file, line, kind: k, text, masked, prose });
  };

  const stringSegs = (n: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression): Segment[] => {
    if (!ts.isTemplateExpression(n)) return [{ t: 'text', s: n.text }];
    const segs: Segment[] = [{ t: 'text', s: n.head.text }];
    for (const span of n.templateSpans) {
      segs.push({ t: 'expr', src: span.expression.getText(sf) }, { t: 'text', s: span.literal.text });
    }
    return segs;
  };

  // An element's children, flattened; inline elements are read through.
  const flatten = (children: ts.NodeArray<ts.JsxChild>, out: Segment[]) => {
    for (const c of children) {
      if (ts.isJsxText(c)) out.push({ t: 'text', s: decodeEntities(c.text) });
      else if (ts.isJsxExpression(c)) {
        const e = c.expression;
        if (!e) continue; // a {/* comment */}
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
          consumed.add(e);
          out.push({ t: 'text', s: e.text });
        } else out.push({ t: 'expr', src: e.getText(sf) });
      } else if (ts.isJsxElement(c)) {
        const name = tagName(c.openingElement);
        if (INLINE_TAGS.has(name)) flatten(c.children, out);
        else out.push({ t: 'tag', name });
      } else if (ts.isJsxSelfClosingElement(c)) {
        const name = tagName(c);
        if (name === 'br') out.push({ t: 'text', s: ' ' });
        else out.push({ t: 'tag', name });
      } else if (ts.isJsxFragment(c)) flatten(c.children, out);
    }
  };
  // An element is an item when it holds text of its own; an inline child of
  // such an element is read as part of it, not again on its own.
  const hasOwnText = (n: ts.JsxElement | ts.JsxFragment) => n.children.some((c) =>
    ts.isJsxText(c) ? !c.containsOnlyTriviaWhiteSpaces && c.text.trim() !== ''
      : ts.isJsxExpression(c) && !!c.expression &&
        (ts.isStringLiteral(c.expression) || ts.isNoSubstitutionTemplateLiteral(c.expression)) && c.expression.text.trim() !== '');
  const readThrough = (n: ts.JsxElement | ts.JsxFragment) =>
    (ts.isJsxFragment(n) || INLINE_TAGS.has(tagName(n.openingElement))) &&
    (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) && hasOwnText(n.parent);

  // A `+` chain: literals are text, anything else an expression.
  const concatSegs = (n: ts.Expression, out: Segment[]) => {
    if (isPlus(n)) {
      concatSegs(n.left, out);
      concatSegs(n.right, out);
    } else if (ts.isParenthesizedExpression(n) && isPlus(n.expression)) concatSegs(n.expression, out);
    else if (isStringish(n)) {
      consumed.add(n);
      out.push(...stringSegs(n));
      if (ts.isTemplateExpression(n)) for (const span of n.templateSpans) visit(span.expression);
    } else {
      out.push({ t: 'expr', src: n.getText(sf) });
      visit(n);
    }
  };
  const hasStringOperand = (n: ts.Expression): boolean =>
    isPlus(n) ? hasStringOperand(n.left) || hasStringOperand(n.right)
      : ts.isParenthesizedExpression(n) ? hasStringOperand(n.expression) : isStringish(n);

  function visit(node: ts.Node): void {
    if (consumed.has(node)) return;
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isCallExpression(node) && isDroppedCall(node)) return;

    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      if (hasOwnText(node) && !readThrough(node)) {
        const segs: Segment[] = [];
        flatten(node.children, segs);
        emit(node, 'jsx', segs);
      }
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (DROP_ATTRS.has(name) || name.startsWith('data-')) return;
      const owner = node.parent.parent;
      const intrinsic = isIntrinsic(tagName(owner));
      const read = !intrinsic || TEXT_ATTRS.has(name);
      // A DOM element's markup attribute is skipped whole; its handlers are code.
      if (!read && !/^on[A-Z]/.test(name) && name !== 'ref') return;
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) {
        if (read) emit(init, 'attr', [{ t: 'text', s: decodeEntities(init.text) }]);
        return;
      }
      ts.forEachChild(node, visit);
      return;
    }

    if (isPlus(node) && !isPlus(node.parent) &&
      !(ts.isParenthesizedExpression(node.parent) && isPlus(node.parent.parent)) && hasStringOperand(node)) {
      const segs: Segment[] = [];
      concatSegs(node, segs);
      emit(node, 'concat', segs);
      return;
    }

    if (isStringish(node)) {
      if (!isNonCopyPosition(node)) {
        emit(node, ts.isTemplateExpression(node) ? 'template' : 'string', stringSegs(node));
      }
      if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) visit(span.expression);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return items;
}

/** Not copy: dev data, the CLIs, the server's entry point, declarations. */
export function isCensused(rel: string): boolean {
  if (!/\.(ts|tsx)$/.test(rel) || rel.endsWith('.d.ts')) return false;
  if (rel.split('/').includes('devData')) return false;
  if (/-cli\.ts$/.test(rel)) return false;
  if (rel === 'server/src/index.ts') return false;
  return true;
}

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, out);
    } else out.push(full);
  }
}

/** Every item under the roots (default: app/src and server/src), files repo-relative. */
export function collectCopy(roots: string[] = COPY_ROOTS): CopyItem[] {
  const items: CopyItem[] = [];
  for (const root of roots) {
    const files: string[] = [];
    walk(root, files);
    for (const full of files) {
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      if (!isCensused(rel)) continue;
      items.push(...extractCopy(rel, readFileSync(full, 'utf8')));
    }
  }
  return items;
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const all = process.argv.includes('--all');
  const oneLine = (s: string) => s.replace(/\t/g, ' ').replace(/\n/g, '\\n');
  console.log(['file', 'line', 'kind', 'text'].join('\t'));
  for (const it of collectCopy()) {
    if (all || it.prose) console.log([it.file, it.line, it.kind, oneLine(it.text)].join('\t'));
  }
}
