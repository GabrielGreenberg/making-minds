// Pins the question-statement markup grammar (src/statementFormat.ts) and the
// problem-set document model (src/problemSet.ts) — the pure halves; rendering
// is components/StatementBody.tsx and components/ProblemSetDocument.tsx.
//
//   cd app && npx tsx tools/statementFormatCheck.ts
//
// The load-bearing properties: CONSERVATISM — plain prose comes back as plain
// text, so markup support never silently reflows a statement nobody re-read —
// and DOCUMENT INTEGRITY — every seeded homework's sections partition its
// question ids, every callout has a known kind, every figure's file exists,
// and every piece of markup in the corpus parses and renders to prose. The
// corpus sweep at the bottom asserts both over the real HW1-HW7 JSON.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseStatement, parseInline, statementProse, type Block, type Inline } from '../src/statementFormat';
import {
  collectFigures,
  documentSections,
  figureUrl,
  problemNumber,
  problemRuns,
  problemShape,
  sectionOf,
  validateDocument,
} from '../src/problemSet';
import type { AssignmentData, AssignmentQuestion } from '../src/types';

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

console.log('\n[io profiles]');
{
  const t = parseStatement('Profile: IN1=0,IN2=0 -> OUT=0; IN1=1,IN2=1 -> OUT=1. Do not use OR.');
  check('a profile splits prose / table / prose', t.map((b) => b.kind).join(',') === 'para,io-table,para');
  const table = t[1] as Extract<Block, { kind: 'io-table' }>;
  check('columns come from the first row',
    table.inputNames.join(',') === 'IN1,IN2' && table.outputNames.join(',') === 'OUT');
  check('every row is captured', table.rows.length === 2);
  check('values keep their order',
    table.rows[1].inputs.join('') === '11' && table.rows[1].outputs.join('') === '1');
  check('the trailing period is not a row',
    (t[2] as Extract<Block, { kind: 'para' }>).content.map((n) => (n.kind === 'text' ? n.text : '')).join('').trim()
      === 'Do not use OR.');

  check('ONE assignment row stays prose',
    parseStatement('For example IN1=1 -> OUT=0 here.').every((b) => b.kind === 'para'));
  check('rows with mismatched columns stay prose',
    parseStatement('IN1=0 -> OUT=0; IN2=1,IN3=0 -> OUT1=1').every((b) => b.kind === 'para'));
  check('newline-separated rows also form a table',
    parseStatement('IN1=0 -> OUT=0\nIN1=1 -> OUT=1').some((b) => b.kind === 'io-table'));
  check('an arrow with no assignments is not a profile',
    parseStatement('I -> [M] -> O1, O2').every((b) => b.kind === 'para'));
  check('statementProse re-flattens a table back to its inline form',
    statementProse('Profile: IN1=0 -> OUT=0; IN1=1 -> OUT=1.')
      === 'Profile: IN1=0 -> OUT=0; IN1=1 -> OUT=1');
}

console.log('\n[multi-part questions]');
{
  const b = parseStatement('Consider f. (a) Do this. (b) Do that. (c) And this.');
  check('lead-in plus one block per part', b.length === 4);
  check('the lead-in keeps no part marker', b[0].kind === 'para' && b[0].part === undefined);
  check('parts are labelled in order',
    b.slice(1).map((x) => (x.kind === 'para' ? x.part : '?')).join('') === 'abc');
  check('a part carries only its own text',
    b[1].kind === 'para' && b[1].content.map((n) => (n.kind === 'text' ? n.text : '')).join('') === 'Do this.');

  check('ONE marker is prose, not a list',
    parseStatement('Then (a) happens.').every((x) => x.kind === 'para' && x.part === undefined));
  check('a function application is not a marker',
    parseStatement('Given p(1, 2) = 5 and j( ) undefined, define p().')
      .every((x) => x.kind === 'para' && x.part === undefined));
  check('statementProse puts the markers back',
    statementProse('Consider f. (a) One. (b) Two.') === 'Consider f. (a) One. (b) Two.');
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

console.log('\n[blocks: lists, line breaks, dotted parts]');
{
  const list = parseStatement('- one\n- two\n  - two point one\n- three');
  check('a run of "- " lines is one list', list.length === 1 && list[0].kind === 'list' && !list[0].ordered);
  check('items carry their depth (two spaces per level)',
    list[0].kind === 'list' && list[0].items.map((i) => i.depth).join(',') === '0,0,1,0');
  const ordered = parseStatement('1. first\n2. second');
  check('a run of "N. " lines is an ordered list', ordered.length === 1 && ordered[0].kind === 'list' && ordered[0].ordered);
  const mixed = parseStatement('**Goal:** find food.\n- **A1:** it is NE.\n- **A2:** the world is 30 X 30.');
  check('a paragraph followed by items in the same chunk gives para + list',
    mixed.map((b) => b.kind).join(',') === 'para,list');
  const cont = parseStatement('- an item that\n  continues here\n- next');
  check('an indented non-item line continues the item above it',
    cont[0].kind === 'list' && cont[0].items.length === 2 && statementProse('- an item that\n  continues here') === '• an item that continues here');
  check('a "*"-bulleted line is NOT a list (it would collide with emphasis)',
    parseStatement('* not a list').every((b) => b.kind === 'para'));
  check('"1." mid-sentence is prose, and a lone "(1)" is not a part',
    parseStatement('Use your solution from (1). See 2. above').every((b) => b.kind === 'para' && !b.part));
  const dotted = parseStatement('Consider m.\na. Describe it.\nb. Define it.\nc. How many places?');
  check('line-start "a. " markers split into parts (the PDF form)',
    dotted.map((b) => (b.kind === 'para' ? b.part ?? '-' : b.kind)).join(',') === '-,a,b,c');
  check('"e.g." and "i.e." never read as parts',
    parseStatement('Look these up, e.g. in the reading.\ni.e. anywhere.').every((b) => b.kind === 'para' && !b.part));
  check('a lone line-start "a. " is prose',
    parseStatement('a. only one').every((b) => b.kind === 'para' && !b.part));
  check('statementProse flattens a list with markers',
    statementProse('- one\n- two') === '• one • two' && statementProse('1. one\n2. two') === '1. one 2. two');
}

console.log('\n[problem set: sections, numbering, shapes, runs]');
{
  const q = (id: number, statement: string, extra: Partial<AssignmentQuestion> = {}): AssignmentQuestion =>
    ({ id, label: `Problem ${id}`, statement, buildMode: 'CC', representation: 'binary', ...extra });
  const flat: AssignmentData = { id: 'x', title: 'X', questions: [q(1, 'one'), q(2, 'two')] };
  const flatSections = documentSections(flat);
  check('no sections → one unnamed section holding every question in order',
    flatSections.length === 1 && flatSections[0].heading === '' &&
    flatSections[0].problems.map((p) => p.question.id).join(',') === '1,2');
  const structured: AssignmentData = {
    ...flat,
    questions: [q(1, 'one'), q(2, 'two'), q(3, 'three')],
    sections: [{ heading: 'I', questionIds: [2, 1, 99] }],
  };
  const ss = documentSections(structured);
  check('sections order their problems; unknown ids are dropped; unlisted questions trail unnamed',
    ss.length === 2 && ss[0].problems.map((p) => p.question.id).join(',') === '2,1' &&
    ss[1].heading === '' && ss[1].problems.map((p) => p.question.id).join(',') === '3');
  check('validateDocument names the unlisted question and the unknown id',
    validateDocument(structured).some((m) => /99/.test(m)) && validateDocument(structured).some((m) => /Problem 3/.test(m)));
  check('validateDocument flags a duplicate id, a bad callout kind and a figure without alt', (() => {
    const bad: AssignmentData = {
      ...flat,
      sections: [{ heading: 'I', questionIds: [1, 1, 2], callouts: [{ kind: 'wat' as never, body: 'x' }] }],
      questions: [q(1, 'a', { figures: [{ src: 'p.svg', alt: '' }] }), q(2, 'b')],
    };
    const m = validateDocument(bad);
    return m.some((x) => /twice/.test(x)) && m.some((x) => /unknown kind/.test(x)) && m.some((x) => /empty alt/.test(x));
  })());
  check('validateDocument is empty for a well-formed document',
    validateDocument({ ...flat, sections: [{ heading: 'I', questionIds: [1] }, { heading: '', questionIds: [2] }] }).length === 0);
  check('sectionOf finds a question\'s section',
    sectionOf(structured, 3)?.heading === '' && sectionOf(structured, 1)?.heading === 'I');
  check('problemNumber reads the label, else the position',
    problemNumber('Problem 12', 0) === '12' && problemNumber('Q2a', 0) === '2a' && problemNumber('Warm-up', 4) === '5');
  check('shapes: a table problem, a one-liner, a paragraph',
    problemShape(q(1, 'IN1=0 -> OUT=1; IN1=1 -> OUT=0')) === 'table' &&
    problemShape(q(1, '+1 T')) === 'compact' &&
    problemShape(q(1, 'x'.repeat(200))) === 'full' &&
    problemShape(q(1, 'a. one\nb. two')) === 'full');
  check('a problem with a figure or a boxed callout is full width',
    problemShape(q(1, '+1 T', { figures: [{ src: 's', alt: 'a' }] })) === 'full' &&
    problemShape(q(1, '+1 T', { callouts: [{ kind: 'hint', body: 'h' }] })) === 'full' &&
    problemShape(q(1, '+1 T', { callouts: [{ kind: 'caution', body: 'c', placement: 'aside' }] })) === 'compact');
  const mixedDoc: AssignmentData = {
    ...flat,
    questions: [q(1, '+1 T'), q(2, '+2 T'), q(3, 'IN1=0 -> OUT=1; IN1=1 -> OUT=0'), q(4, 'x'.repeat(200))],
    sections: [{ heading: 'I', questionIds: [1, 2, 3, 4] }],
  };
  const runs = problemRuns(documentSections(mixedDoc)[0]);
  check('auto layout: compact run → columns, table → grid, long → stack',
    runs.map((r) => `${r.flow}:${r.problems.length}`).join(' ') === 'columns:2 grid:1 stack:1');
  const listed = problemRuns(documentSections({ ...mixedDoc, sections: [{ heading: 'I', questionIds: [1, 2, 3, 4], layout: 'list' }] })[0]);
  check('layout "list" stacks everything', listed.length === 1 && listed[0].flow === 'stack');
  const grid = problemRuns(documentSections({ ...mixedDoc, sections: [{ heading: 'I', questionIds: [1, 2, 3, 4], layout: 'grid' }] })[0]);
  check('layout "grid" flows compact and table problems together, long ones still stack',
    grid.map((r) => `${r.flow}:${r.problems.length}`).join(' ') === 'grid:3 stack:1');
  check('figureUrl: data/absolute verbatim, public paths under the base URL',
    figureUrl('data:image/svg+xml;base64,AA', '/making-minds/') === 'data:image/svg+xml;base64,AA' &&
    figureUrl('problem-sets/x.svg', '/making-minds/') === '/making-minds/problem-sets/x.svg' &&
    figureUrl('./problem-sets/x.svg', '/') === '/problem-sets/x.svg' &&
    figureUrl('https://a/b.png', '/making-minds/') === 'https://a/b.png');
}

console.log('\n[corpus: the seeded HW1-HW7 documents]');
{
  const dir = join(import.meta.dirname, '../src/devData/homeworks');
  const publicDir = join(import.meta.dirname, '../public');
  let statements = 0;
  let markup = 0;
  const tabulated: string[] = [];
  const parted: string[] = [];
  const invalid: string[] = [];
  const missingFigures: string[] = [];
  const missingPdf: string[] = [];
  const emptyDoc: string[] = [];
  // Every piece of markup the document renders, parsed and flattened: a
  // throw here would blank a page.
  const render = (where: string, text: string | undefined) => {
    if (!text) return;
    markup++;
    try { parseStatement(text); statementProse(text); } catch (e) { invalid.push(`${where}: ${(e as Error).message}`); }
  };
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const hw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as AssignmentData;
    const name = f.replace('.json', '');
    for (const m of validateDocument(hw)) invalid.push(`${name}: ${m}`);
    if (!hw.sections?.length || !hw.sourcePdf) emptyDoc.push(name);
    if (hw.sourcePdf && !existsSync(join(publicDir, hw.sourcePdf))) missingPdf.push(`${name}: ${hw.sourcePdf}`);
    for (const { where, figure } of collectFigures(hw)) {
      if (!/^data:/.test(figure.src) && !existsSync(join(publicDir, figure.src))) missingFigures.push(`${name} ${where}: ${figure.src}`);
    }
    render(`${name} preamble`, hw.preamble);
    for (const s of hw.sections ?? []) {
      render(`${name} § ${s.heading}`, s.intro);
      for (const c of s.callouts ?? []) render(`${name} § ${s.heading} callout`, c.body);
    }
    for (const q of hw.questions) {
      statements++;
      render(`${name} ${q.label}`, q.statement);
      render(`${name} ${q.label} hint`, q.hint);
      for (const c of q.callouts ?? []) render(`${name} ${q.label} callout`, c.body);
      const blocks = parseStatement(q.statement);
      if (blocks.some((b) => b.kind === 'io-table')) tabulated.push(`${name} ${q.label}`);
      if (blocks.some((b) => b.kind === 'para' && b.part)) parted.push(`${name} ${q.label}`);
    }
  }
  check(`swept ${statements} HW1-HW7 statements and ${markup} pieces of markup`, statements > 0 && markup > statements);
  check(`every document is valid${invalid.length ? ' — ' + invalid.join('; ') : ''}`, invalid.length === 0);
  check(`every HW carries sections and its source PDF${emptyDoc.length ? ' — ' + emptyDoc.join(', ') : ''}`, emptyDoc.length === 0);
  check(`every source PDF exists under public/${missingPdf.length ? ' — ' + missingPdf.join(', ') : ''}`, missingPdf.length === 0);
  check(`every figure file exists under public/${missingFigures.length ? ' — ' + missingFigures.join(', ') : ''}`, missingFigures.length === 0);
  // The five HW1 truth-table problems are exactly the ones that tabulate;
  // anything else joining them is a false positive of the profile regex.
  check(`exactly the five HW1 truth tables tabulate (${tabulated.join(', ')})`,
    tabulated.join('|') === 'hw1 Problem 1|hw1 Problem 2|hw1 Problem 3|hw1 Problem 4|hw1 Problem 5');
  // Only the four genuinely multi-part HW1 questions split into parts — no
  // "p(1, 2)", "j( )" or "(1)" reference is mistaken for a marker anywhere.
  check(`exactly the four multi-part HW1 questions split (${parted.join(', ')})`,
    parted.join('|') === 'hw1 Problem 6|hw1 Problem 9|hw1 Problem 10|hw1 Problem 13');
}

console.log(`\nstatementFormatCheck: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('STATEMENT FORMAT OK');
