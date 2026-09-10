// Question-statement markup — the parse half (pure: no React, no DOM, so
// tools/statementFormatCheck.ts can pin it headlessly). The render half is
// components/StatementBody.tsx.
//
// Statements are instructor-authored prose. They are read as a small, fixed
// subset of Markdown plus LaTeX math, chosen to cover what PHIL 133 problems
// actually need and nothing else:
//
//   $x + 1$ / $$…$$   LaTeX math, inline or displayed (rendered by KaTeX)
//   `IN1`             code / machine literals
//   **bold**  *italic*
//   blank line        paragraph break
//
// Anything unmatched stays literal text, so an existing plain-prose statement
// renders exactly as before. A `$` that does not close is literal too — prices
// and stray dollar signs must not silently swallow the rest of a sentence.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'math'; tex: string; display: boolean }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] };

export type Block = { kind: 'para'; content: Inline[] };

/** Split a statement into blocks. Blank lines separate paragraphs; a single
 *  newline inside one is kept as a soft break by the renderer. */
export function parseStatement(text: string): Block[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => ({ kind: 'para' as const, content: parseInline(chunk) }));
}

// Ordered by precedence: math and code are opaque (their contents are never
// re-scanned for emphasis), so they must be matched before ** and *.
const TOKEN = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|`[^`\n]+?`|\*\*[\s\S]+?\*\*|\*[^*\n]+?\*)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = TOKEN.exec(rest);
    if (!m || m.index === undefined) break;
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith('$$')) {
      out.push({ kind: 'math', tex: tok.slice(2, -2).trim(), display: true });
    } else if (tok.startsWith('$')) {
      out.push({ kind: 'math', tex: tok.slice(1, -1).trim(), display: false });
    } else if (tok.startsWith('`')) {
      out.push({ kind: 'code', text: tok.slice(1, -1) });
    } else if (tok.startsWith('**')) {
      out.push({ kind: 'strong', children: parseInline(tok.slice(2, -2)) });
    } else {
      out.push({ kind: 'em', children: parseInline(tok.slice(1, -1)) });
    }
    rest = rest.slice(m.index + tok.length);
  }
  if (rest.length > 0) out.push({ kind: 'text', text: rest });
  return out;
}

/** The statement as plain text — every marker stripped, math left as its TeX.
 *  For the places that show a one-line preview (the question list, the
 *  instructor's question summary) rather than rendered markup. */
export function statementProse(text: string): string {
  const strip = (nodes: Inline[]): string =>
    nodes
      .map((n) => {
        switch (n.kind) {
          case 'text': return n.text;
          case 'code': return n.text;
          case 'math': return n.tex;
          default: return strip(n.children);
        }
      })
      .join('');
  return parseStatement(text).map((b) => strip(b.content)).join(' ').replace(/\s+/g, ' ').trim();
}
