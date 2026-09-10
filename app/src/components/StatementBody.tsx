// The one renderer for a question statement, shared by the student workspace
// panel, the open-question panel and the instructor's live preview, so the
// markup a statement is written in means the same thing everywhere.
// The grammar and the parse live in src/statementFormat.ts.

import { useMemo } from 'react';
import katex from 'katex';
import { parseStatement, type Block, type Inline } from '../statementFormat';

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

function BlockNode({ block }: { block: Block }) {
  return (
    <p className="statement-para">
      <InlineNodes nodes={block.content} />
    </p>
  );
}

export function StatementBody({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseStatement(text), [text]);
  return (
    <div className={className ? `statement ${className}` : 'statement'}>
      {blocks.map((b, i) => <BlockNode key={i} block={b} />)}
    </div>
  );
}
