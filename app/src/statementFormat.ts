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
// One construct is recognised rather than marked up: a run of two or more
// "IN1=0,IN2=1 -> OUT=1" rows — an input-output profile written inline — is
// lifted out of the prose and rendered as a table. Statements are authored as
// prose (and the same strings are pinned verbatim by tools/coverageCheck.ts's
// statement lint and duplicated in the reference fixtures), so the profile is
// READ as a table at display time; nothing rewrites the stored text.
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

export interface IoProfileRow {
  inputs: string[];
  outputs: string[];
}

export type Block =
  | { kind: 'para'; content: Inline[] }
  | {
      kind: 'io-table';
      inputNames: string[];
      outputNames: string[];
      rows: IoProfileRow[];
    };

// An input-output profile spelled inline. Deliberately strict: both sides of
// every row must assign the SAME column names in the same order, and a single
// "IN1=1 -> OUT=0" mid-sentence stays prose — one row is an example, not a
// table.
const NAME = '[A-Za-z][A-Za-z0-9_]*';
const VALUE = '[A-Za-z0-9*]+';
const ASSIGN = `${NAME}\\s*=\\s*${VALUE}`;
const SIDE = `${ASSIGN}(?:\\s*,\\s*${ASSIGN})*`;
const ARROW = '(?:-->|->|→|⇒)';
const ROW = `${SIDE}\\s*${ARROW}\\s*${SIDE}`;
const PROFILE = new RegExp(`${ROW}(?:\\s*[;\\n]\\s*${ROW})+\\s*\\.?`, 'g');
const ARROW_SPLIT = /-->|->|→|⇒/;

function parseSide(text: string): { names: string[]; values: string[] } {
  const names: string[] = [];
  const values: string[] = [];
  for (const part of text.split(',')) {
    const [n, v] = part.split('=');
    names.push(n.trim());
    values.push(v.trim());
  }
  return { names, values };
}

/** The profile table a matched run denotes, or null if its rows disagree
 *  about their columns (in which case the run stays prose). */
function profileTable(match: string): Extract<Block, { kind: 'io-table' }> | null {
  const rows = match
    .replace(/\.\s*$/, '')
    .split(/[;\n]/)
    .map((r) => {
      const [lhs, rhs] = r.split(ARROW_SPLIT);
      return { l: parseSide(lhs), r: parseSide(rhs) };
    });
  const inputNames = rows[0].l.names;
  const outputNames = rows[0].r.names;
  const key = (ns: string[]) => ns.join('\u0000');
  const consistent = rows.every(
    (row) => key(row.l.names) === key(inputNames) && key(row.r.names) === key(outputNames),
  );
  if (!consistent) return null;
  return {
    kind: 'io-table',
    inputNames,
    outputNames,
    rows: rows.map((row) => ({ inputs: row.l.values, outputs: row.r.values })),
  };
}

/** Split one paragraph's text into prose runs and the profile tables between
 *  them, preserving order. */
function splitProfiles(chunk: string): Block[] {
  const out: Block[] = [];
  let last = 0;
  const prose = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) out.push({ kind: 'para', content: parseInline(trimmed) });
  };
  PROFILE.lastIndex = 0;
  for (const m of chunk.matchAll(PROFILE)) {
    const table = profileTable(m[0]);
    if (!table) continue;
    prose(chunk.slice(last, m.index));
    out.push(table);
    last = m.index + m[0].length;
  }
  prose(chunk.slice(last));
  return out;
}

/** Split a statement into blocks. Blank lines separate paragraphs; a single
 *  newline inside one is kept as a soft break by the renderer. */
export function parseStatement(text: string): Block[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .flatMap(splitProfiles);
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
  return parseStatement(text)
    .map((b) =>
      b.kind === 'para'
        ? strip(b.content)
        : b.rows
            .map((r) =>
              `${b.inputNames.map((n, i) => `${n}=${r.inputs[i]}`).join(',')} -> ` +
              `${b.outputNames.map((n, i) => `${n}=${r.outputs[i]}`).join(',')}`,
            )
            .join('; '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
