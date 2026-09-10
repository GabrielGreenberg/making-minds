// Pins the question-statement markup grammar (src/statementFormat.ts) — the
// parse only; rendering is components/StatementBody.tsx.
//
//   cd app && npx tsx tools/statementFormatCheck.ts
//
// The load-bearing property is CONSERVATISM: every statement already written
// as plain prose must come back as plain text, so adding markup support can
// never silently reflow existing homework. The corpus sweep at the bottom
// asserts that over the real HW1-HW7 statements.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseStatement, parseInline, statementProse, type Inline } from '../src/statementFormat';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}

const kinds = (nodes: Inline[]) => nodes.map((n) => n.kind).join(',');

console.log('[inline: math]');
{
  const n = parseInline('compute $x + 1$ now');
  check('inline math splits into text,math,text', kinds(n) === 'text,math,text');
  check('inline math carries trimmed TeX',
    n[1].kind === 'math' && n[1].tex === 'x + 1' && n[1].display === false);

  const d = parseInline('$$\\sum_i x_i$$');
  check('display math is flagged', d.length === 1 && d[0].kind === 'math' && d[0].display === true);

  check('an unclosed $ stays literal text',
    kinds(parseInline('costs $5 and more')) === 'text');
  check('a $ pair may not span a newline',
    kinds(parseInline('a $b\nc$ d')) === 'text');
}

console.log('\n[inline: code and emphasis]');
{
  check('backticks make code', kinds(parseInline('wire `IN1` up')) === 'text,code,text');
  const c = parseInline('`IN1`');
  check('code keeps its literal text', c[0].kind === 'code' && c[0].text === 'IN1');
  check('bold before italic', kinds(parseInline('**a** and *b*')) === 'strong,text,em');
  const b = parseInline('**very *odd* thing**');
  check('bold nests italic', b.length === 1 && b[0].kind === 'strong' && kinds(b[0].children) === 'text,em,text');
  check('code contents are opaque to emphasis',
    kinds(parseInline('`a*b*c`')) === 'code');
  check('math contents are opaque to emphasis',
    kinds(parseInline('$a*b*c$')) === 'math');
  check('a lone asterisk stays literal', kinds(parseInline('2 * x')) === 'text');
}

console.log('\n[blocks]');
{
  check('a blank line splits paragraphs', parseStatement('one\n\ntwo').length === 2);
  check('a single newline does not', parseStatement('one\ntwo').length === 1);
  check('an empty statement has no blocks', parseStatement('   \n\n  ').length === 0);
}

console.log('\n[prose flattening]');
{
  check('statementProse strips every marker',
    statementProse('Build **the** `AND` of $x$ and $y$.') === 'Build the AND of x and y.');
  check('statementProse joins paragraphs with a space',
    statementProse('one\n\ntwo') === 'one two');
}

console.log('\n[corpus: real homework statements are untouched prose]');
{
  const dir = join(import.meta.dirname, '../src/devData/homeworks');
  let statements = 0;
  const reflowed: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const hw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      questions: { label: string; statement: string }[];
    };
    for (const q of hw.questions) {
      statements++;
      const blocks = parseStatement(q.statement);
      // Prose is one paragraph of pure text unless the author added markup.
      const plain = blocks.every((b) => b.content.every((n) => n.kind === 'text'));
      const roundTrips = blocks.map((b) => b.content.map((n) => (n.kind === 'text' ? n.text : '')).join('')).join('\n\n')
        === q.statement.split(/\n\s*\n/).map((c) => c.trim()).filter((c) => c).join('\n\n');
      if (!plain || !roundTrips) reflowed.push(`${f} ${q.label}`);
    }
  }
  check(`swept ${statements} HW1-HW7 statements`, statements > 0);
  check(`none reflowed by the parser${reflowed.length ? ' — ' + reflowed.join(', ') : ''}`,
    reflowed.length === 0);
}

console.log(`\nstatementFormatCheck: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('STATEMENT FORMAT OK');
