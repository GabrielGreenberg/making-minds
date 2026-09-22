// The one renderer for statement markup — question statements, section
// intros, preambles and callout bodies — shared by the problem-set document,
// the student workspace panels and the instructor's live preview, so the
// markup means the same thing everywhere. The grammar and the parse live in
// src/statementFormat.ts.

import { useMemo, type ReactNode } from 'react';
import katex from 'katex';
import { parseInline, parseStatement, type Block, type Inline, type ListItem } from '../statementFormat';

/** KaTeX renders to an HTML string. It is called in throwOnError:false mode,
 *  so malformed TeX shows in red rather than blanking the statement — an
 *  instructor typo must never hide the problem text from a student. */
function mathHtml(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    output: 'html',
  });
}

/** One line of inline markup (a problem title, a caption) — no blocks. */
export function InlineMarkup({ text }: { text: string }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <InlineNodes nodes={nodes} />;
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case 'text':
            return <span key={i}>{n.text}</span>;
          case 'code':
            return <code key={i} className="statement-code">{n.text}</code>;
          case 'math':
            return (
              <span
                key={i}
                className={n.display ? 'statement-math statement-math--display' : 'statement-math'}
                // KaTeX's own output; the input is instructor-authored TeX.
                dangerouslySetInnerHTML={{ __html: mathHtml(n.tex, n.display) }}
              />
            );
          case 'strong':
            return <strong key={i}><InlineNodes nodes={n.children} /></strong>;
          case 'em':
            return <em key={i}><InlineNodes nodes={n.children} /></em>;
        }
      })}
    </>
  );
}

function IoProfile({ table }: { table: Extract<Block, { kind: 'io-table' }> }) {
  const { inputNames, outputNames, rows } = table;
  return (
    <div className="statement-io-wrap">
      <table className="statement-io-table">
        <thead>
          <tr>
            {inputNames.map((n) => <th key={`in-${n}`}>{n}</th>)}
            {outputNames.map((n, i) => (
              <th key={`out-${n}`} className={i === 0 ? 'statement-io-out' : undefined}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.inputs.map((v, i) => <td key={`in-${i}`}>{v}</td>)}
              {r.outputs.map((v, i) => (
                <td key={`out-${i}`} className={i === 0 ? 'statement-io-out' : undefined}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Items carry a depth; nest them as real sub-lists so indentation, markers
 *  and screen readers all agree. */
function nestList(items: ListItem[], depth: number, ordered: boolean): ReactNode {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.depth < depth) break;
    const children: ListItem[] = [];
    let j = i + 1;
    while (j < items.length && items[j].depth > depth) children.push(items[j++]);
    out.push(
      <li key={i}>
        <InlineNodes nodes={item.content} />
        {children.length > 0 && nestList(children, depth + 1, ordered)}
      </li>,
    );
    i = j;
  }
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag className="statement-list">{out}</Tag>;
}

function BlockNode({ block, lead }: { block: Block; lead?: ReactNode }) {
  if (block.kind === 'io-table') return <IoProfile table={block} />;
  if (block.kind === 'list') return <>{nestList(block.items, 0, block.ordered)}</>;
  if (block.part) {
    return (
      <p className="statement-para statement-part">
        <span className="statement-part-marker">{block.part}.</span>
        <InlineNodes nodes={block.content} />
      </p>
    );
  }
  return (
    <p className="statement-para">
      {lead}
      {lead !== undefined && ' '}
      <InlineNodes nodes={block.content} />
    </p>
  );
}

/**
 * `lead` is run into the first paragraph (a problem's bold title, a callout's
 * "Hint:" heading — the PDFs' run-in idiom); when the text opens with a table,
 * a list or a part, it stands on its own line instead.
 */
export function StatementBody({ text, className, lead }: { text: string; className?: string; lead?: ReactNode }) {
  const blocks = useMemo(() => parseStatement(text), [text]);
  const runIn = lead !== undefined && blocks.length > 0 && blocks[0].kind === 'para' && !blocks[0].part;
  return (
    <div className={className ? `statement ${className}` : 'statement'}>
      {lead !== undefined && !runIn && <p className="statement-para">{lead}</p>}
      {blocks.map((b, i) => <BlockNode key={i} block={b} lead={i === 0 && runIn ? lead : undefined} />)}
    </div>
  );
}
