// Pins the question-statement markup grammar (src/statementFormat.ts) and the
// problem-set document model (src/problemSet.ts) — the pure halves; rendering
// is components/StatementBody.tsx and components/ProblemSetDocument.tsx.
//
//   cd app && npx tsx tools/statementFormatCheck.ts
//
// The load-bearing properties: CONSERVATISM — plain prose comes back as plain
// text, so markup support never silently reflows a statement nobody re-read —
// and DOCUMENT INTEGRITY — every seeded homework's sections partition its
// question ids, every callout has a known kind, every figure's file exists
// and holds no cropped-in piece of a neighbour (tools/figureCrop.ts, task 077),
// and every piece of markup in the corpus parses and renders to prose. The
// corpus sweep at the bottom asserts both over the real HW1-HW7 JSON.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseStatement, parseInline, statementProse, type Block, type Inline } from '../src/statementFormat';
import {
  collectFigures,
  documentSections,
  figureUrl,
  pageIndexOf,
  problemGroups,
  problemLabel,
  problemNumber,
  problemPartIds,
  problemRuns,
  problemShape,
  sectionOf,
  validateDocument,
  writtenKind,
} from '../src/problemSet';
import type { AssignmentData, AssignmentQuestion } from '../src/types';
import { figureCropFaults } from './figureCrop';

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
  // A fill-in table's key must be whole rows with distinct arguments (task
  // 079; engine/fillIn.ts fillInKeyProblem) — the every-HW loop below holds
  // HW1 P14 and P9b to it.
  const table = (fill_in_answers: string[]): AssignmentData => ({
    id: 't', title: 'T', questions: [q(1, 'Define f with a table.', {
      buildMode: 'open',
      fill_in: { table: { columns: ['Argument', 'Value'], argColumns: 1, rows: 3 } },
      fill_in_answers,
    })],
  });
  check('validateDocument accepts a sound fill-in table',
    validateDocument(table(['a', '1', 'b', '0'])).length === 0);
  check('validateDocument flags a table key that is not whole rows',
    validateDocument(table(['a', '1', 'b'])).some((m) => /^Problem 1: .*not whole rows of 2 cells/.test(m)));
  check('validateDocument flags a table key with repeated arguments',
    validateDocument(table(['a', '1', ' a', '0'])).some((m) => /^Problem 1: .*rows 1 and 2 have the same arguments a/.test(m)));
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

console.log('\n[multi-part problems]');
{
  // Task 048: a printed problem's parts are written questions grouped by
  // `partOf` (problemSet.ts problemGroups) — display only, each part still
  // its own grading unit.
  const w = (id: number, label: string, extra: Partial<AssignmentQuestion> = {}): AssignmentQuestion =>
    ({ id, label, statement: `${label}.`, buildMode: 'open', representation: 'binary', ...extra });
  const doc: AssignmentData = {
    id: 'mp', title: 'MP',
    questions: [
      w(5, 'Problem 5'),
      w(6, 'Problem 6a', { stem: 'Consider *m*.', closing: 'Show your work.' }),
      w(18, 'Problem 6b', { partOf: 6, answerField: 'line' }),
      w(19, 'Problem 6c', { partOf: 6, fill_in: { labels: ['Places'] }, fill_in_answers: ['3'] }),
      w(7, 'Problem 7'),
    ],
    sections: [{ heading: 'I', questionIds: [5, 6, 18, 19, 7] }],
  };
  const [sec] = documentSections(doc);
  const six = sec.problems[1];
  check('a contiguous partOf run folds into ONE problem (3 problems, not 5)',
    sec.problems.length === 3 && problemGroups(doc).length === 3 && six.parts.map((p) => p.question.id).join() === '6,18,19');
  check('its number is the first part\'s minus its letter, its parts lettered a/b/c',
    six.number === '6' && six.parts.map((p) => p.letter).join('') === 'abc' && six.index === 1);
  check('problemLabel names the problem ("Problem 6"); a single question keeps its label',
    problemLabel(doc, 3) === 'Problem 6' && six.label === 'Problem 6' && problemLabel(doc, 0) === 'Problem 5' &&
      sec.problems[0].parts.length === 1 && sec.problems[0].parts[0].letter === '');
  check('every part\'s index opens the first part\'s page; problemPartIds lists the parts',
    [1, 2, 3].every((i) => pageIndexOf(doc, i) === 1) && pageIndexOf(doc, 4) === 4 &&
      problemPartIds(doc, 3).join() === '6,18,19' && problemPartIds(doc, 0).join() === '5' && problemPartIds(doc, 99).length === 0);
  check('a multi-part (or stemmed) problem is full width', six.shape === 'full');
  check('letters come by position when the labels carry none',
    documentSections({ ...doc, questions: doc.questions.map((q) => ({ ...q, label: `Q${q.id}` })) })[0].problems[1].parts.map((p) => p.letter).join('') === 'abc');
  check('a well-formed multi-part document is valid', validateDocument(doc).length === 0);
  check('writtenKind: a line, a paragraph (the default), blanks, a table — none for a machine',
    writtenKind(doc.questions[2]) === 'line' && writtenKind(doc.questions[1]) === 'paragraph' &&
      writtenKind(doc.questions[3]) === 'blanks' &&
      writtenKind(w(1, 'T', { fill_in: { table: { columns: ['x', 'f'], argColumns: 1, rows: 2 } } })) === 'table' &&
      writtenKind({ ...w(1, 'C'), buildMode: 'CC' }) === null);

  // A broken group degrades to separate problems, and validateDocument names it.
  const broken = (edit: (d: AssignmentData) => AssignmentData) => {
    const d = edit(structuredClone(doc));
    return { problems: documentSections(d).flatMap((x) => x.problems).length, issues: validateDocument(d) };
  };
  const apart = broken((d) => ({ ...d, sections: [{ heading: 'I', questionIds: [5, 6, 18, 7, 19] }] }));
  check('not contiguous (another problem between): the stray part stands alone, named',
    apart.problems === 4 && apart.issues.some((m) => /Problem 6c: part of 6, but it must follow Problem 6a's parts directly/.test(m)));
  const split = broken((d) => ({ ...d, sections: [{ heading: 'I', questionIds: [5, 6, 18] }, { heading: 'II', questionIds: [19, 7] }] }));
  check('in another section: stands alone, named',
    split.problems === 4 && split.issues.some((m) => /Problem 6c: part of 6, but it must follow/.test(m)));
  const missing = broken((d) => { d.questions[2].partOf = 99; return d; });
  // (Part c then follows no part of problem 6 either: it stands alone too.)
  check('its first part missing: stands alone, named',
    missing.problems === 5 && missing.issues.some((m) => /Problem 6b: part of 99, but no question has id 99/.test(m)));
  const nested = broken((d) => { d.questions[3].partOf = 18; return d; });
  check('nested (a part of a part): stands alone, named',
    nested.problems === 4 && nested.issues.some((m) => /Problem 6c: part of 18, but Problem 6b is itself a part/.test(m)));
  const machine = broken((d) => { d.questions[2].buildMode = 'CC'; delete d.questions[2].answerField; return d; });
  check('a machine question is never a part: stands alone, named',
    machine.problems === 5 && machine.issues.some((m) => /Problem 6b: part of 6, but only written \(open\) questions have parts/.test(m)));
  const stemmed = broken((d) => { d.questions[2].stem = 'x'; return d; });
  check('a stem on a part is named (it belongs to the first part)',
    stemmed.problems === 3 && stemmed.issues.some((m) => /Problem 6b: a part carries no stem or closing/.test(m)));
  const field = broken((d) => { d.questions[0] = { ...d.questions[0], buildMode: 'CC', answerField: 'line' }; return d; });
  check('answerField on a non-written question is named',
    field.issues.some((m) => /Problem 5: answerField is for a written \(open\) question/.test(m)));
  check('…and on a fill-in one',
    broken((d) => { d.questions[3].answerField = 'line'; return d; }).issues.some((m) => /Problem 6c: answerField is for a written/.test(m)));

  // The real HW1 (task 048): its lettered questions fold back into four problems.
  const hw1 = JSON.parse(readFileSync(join(import.meta.dirname, '../src/devData/homeworks/hw1.json'), 'utf8')) as AssignmentData;
  const multi = documentSections(hw1).flatMap((x) => x.problems).filter((p) => p.parts.length > 1)
    .map((p) => `${p.number}[${p.parts.map((x) => x.question.id).join(',')}]`);
  check(`HW1 has exactly problems 6[6,18,19], 9[9,20], 10[10,21,22] and 13[13,23] (${multi.join(' ')})`,
    multi.join(' ') === '6[6,18,19] 9[9,20] 10[10,21,22] 13[13,23]' && problemGroups(hw1).length === 17);
  check('…and no part\'s prompt points back at another part ("from 6a", "9a")',
    hw1.questions.filter((q) => q.partOf !== undefined).every((q) => !/\b\d+[a-c]\b/.test(q.statement)));
}

console.log('\n[figures: no cropped-in neighbours]');
{
  // The figures are hand crops of the HW PDFs, so a crop can keep a sliver of
  // the shape beside the drawing (task 077; the rule and its blind spots:
  // tools/figureCrop.ts). The offending lines below are the pre-077 files'
  // own, verbatim — the fixture; the check never reads git history (CI clones
  // are shallow).
  const svg = (viewBox: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}">\n${body}\n</svg>\n`;
  const faultsOf = (viewBox: string, body: string) => figureCropFaults(svg(viewBox, body));
  const HW1_WHITE = '<rect x="-12.5" y="-8" width="150" height="96" fill="rgb(100%, 100%, 100%)" fill-opacity="1"/>';
  const HW1_HINT_SLIVER = '<path fill-rule="nonzero" fill="rgb(93.331909%, 91.763306%, 92.941284%)" fill-opacity="1" d="M -349.621094 3.605469 L 0.605469 3.605469 L 0.605469 67.742188 L -349.621094 67.742188 Z M -349.621094 3.605469 "/>';
  const HW2_FORMAT_GREY = '<path fill-rule="nonzero" fill="rgb(93.331909%, 91.763306%, 92.941284%)" fill-opacity="1" d="M -220.492188 -71.042969 L 242.492188 -71.042969 L 242.492188 222.46875 L -220.492188 222.46875 Z M -220.492188 -71.042969 "/>';
  const HW2_ARROWHEAD = '<defs>\n<clipPath id="clip-16">\n<path clip-rule="nonzero" d="M 105 51.136719 L 106 51.136719 L 106 57.507812 L 105 57.507812 Z M 105 51.136719 "/>\n</clipPath>\n</defs>\n' +
    '<g clip-path="url(#clip-16)">\n<path fill-rule="nonzero" fill="rgb(0%, 0%, 0%)" fill-opacity="1" d="M 105.976562 57.089844 L 111.511719 54.324219 L 105.976562 51.554688 Z M 105.976562 57.089844 "/>\n</g>';
  const HW2_LONG_GREY = '<rect x="-22" y="-9.2" width="264" height="110.4" fill="rgb(93.331909%, 91.763306%, 92.941284%)" fill-opacity="1"/>';
  const HW3_TERMINAL = '<path fill-rule="nonzero" fill="rgb(0%, 0%, 0%)" fill-opacity="1" d="M -1.550781 29.101562 L 3.0625 29.101562 L 3.0625 33.710938 L -1.550781 33.710938 Z M -1.550781 29.101562 "/>';

  const hw1 = faultsOf('0 0 125 80', `${HW1_WHITE}\n${HW1_HINT_SLIVER}`);
  check('the pre-077 HW1 schematic fails: the hint box\'s last 0.6 units, past the left edge, 0.2% inside',
    hw1.length === 1 && /runs past the left edge/.test(hw1[0]) && /with 0\.2% inside/.test(hw1[0]));
  check('…and without that path it is clean', faultsOf('0 0 125 80', HW1_WHITE).length === 0);
  const sliver = faultsOf('0 0 100 50', '<rect x="90" y="10" width="100" height="20" fill="#888"/>');
  check('a neighbour entering from the right edge, 10% inside, fails',
    sliver.length === 1 && /right edge/.test(sliver[0]) && /10\.0% inside/.test(sliver[0]));
  const short = faultsOf('0 0 245 92', HW2_FORMAT_GREY);
  check('a background that stops short of an edge fails (the pre-077 HW2 machine-format grey)',
    short.length === 1 && /stops 2\.51 short of the right edge/.test(short[0]));
  const head = faultsOf('0 0 106 126', HW2_ARROWHEAD);
  check('a remnant the crop cut away fails even under a <g clip-path> (the pre-077 HW2 retina arrowhead)',
    head.length === 1 && /right edge/.test(head[0]));
  check('…and passes once the frame takes the whole head (112 wide)', faultsOf('0 0 112 126', HW2_ARROWHEAD).length === 0);
  check('full-frame backgrounds pass: a rect, a path, the exact frame, a band across the width',
    faultsOf('0 0 220 92', `${HW2_LONG_GREY}\n<path fill="#eee" d="M -5 -5 L 230 -5 L 230 100 L -5 100 Z"/>`).length === 0 &&
    faultsOf('0 0 100 50', '<rect x="0" y="0" width="100" height="50" fill="#eee"/>').length === 0 &&
    faultsOf('0 0 100 50', '<rect x="-3" y="10" width="106" height="20" fill="#eee"/>').length === 0);
  const trimmed = faultsOf('0 0 112 138', HW3_TERMINAL);
  check('no exemption for how much is kept: the figure\'s own shape, trimmed (a pre-077 hw3-retina terminal, 66.4% inside), fails',
    trimmed.length === 1 && /left edge/.test(trimmed[0]) && /66\.4% inside/.test(trimmed[0]));
  check('…and passes once the frame takes the whole square (viewBox -2 0 114 138)', faultsOf('-2 0 114 138', HW3_TERMINAL).length === 0);
  check('a thin neighbour mostly inside the frame fails: a 0.4-wide rule 62% in, a grey bar 60% in, a wider one 67% in',
    faultsOf('0 0 125 80', `${HW1_WHITE}\n<rect x="-0.15" y="4" width="0.4" height="60" fill="black"/>`).length === 1 &&
    faultsOf('0 0 125 80', `${HW1_WHITE}\n<path fill="rgb(93.33%, 91.76%, 92.94%)" d="M -0.8 3.6 L 1.2 3.6 L 1.2 67.7 L -0.8 67.7 Z"/>`).length === 1 &&
    faultsOf('0 0 125 80', `${HW1_WHITE}\n<path fill="rgb(93.33%, 91.76%, 92.94%)" d="M -0.3 3.6 L 0.6 3.6 L 0.6 67.7 L -0.3 67.7 Z"/>`).length === 1);
  check('…as does a neighbour covering 41% of the frame from the left, and an arrowhead 55% inside the right edge',
    faultsOf('0 0 245 92', '<rect x="-10" y="-5" width="110" height="102" fill="#eee"/>').length === 1 &&
    faultsOf('0 0 106 126', '<path d="M 103 57 L 108.5 54.3 L 103 51.5 Z"/>').length === 1);
  check('ignored: <defs> (nested <g>s and all), comments, fill="none" strokes, fill-opacity 0, <use> glyphs, a shape wholly outside the frame',
    faultsOf('0 0 100 50', [
      '<defs><g><g id="glyph-0"><path d="M -50 0 L 5 0 L 5 5 Z"/></g></g><rect id="r" x="-80" width="81" height="9"/></defs><defs/>',
      '<!-- <rect x="-80" width="81" height="9"/> -->',
      '<path fill="none" stroke="rgb(0%, 0%, 0%)" d="M 60 20 L 140 20"/>',
      '<g fill="none"><path stroke="black" d="M -40 5 L 3 5 L 3 9 Z"/></g>',
      '<rect x="-80" y="5" width="81" height="9" fill="#888" fill-opacity="0"/>',
      '<g fill="black"><use xlink:href="#glyph-0" x="98" y="30"/></g>',
      '<rect x="200" y="5" width="30" height="9" fill="#888"/><rect x="-30" y="5" width="30" height="9" fill="#888"/>',
    ].join('\n')).length === 0);
  check('fill inherits: from an ancestor <g>, else the SVG default black',
    faultsOf('0 0 100 50', '<g fill="rgb(50%, 50%, 50%)"><g><path d="M -40 5 L 3 5 L 3 9 L -40 9 Z"/></g></g>').length === 1 &&
    faultsOf('0 0 100 50', '<path d="M -40 5 L 3 5 L 3 9 L -40 9 Z"/>').length === 1 &&
    faultsOf('0 0 100 50', '<rect style="fill:none" x="-40" y="5" width="43" height="4"/>').length === 0);
  check('transforms apply: an in-frame rect moved out by an ancestor\'s matrix, or by its own translate, fails',
    faultsOf('0 0 100 50', '<g transform="matrix(1, 0, 0, 1, -45, 0)"><rect x="10" y="10" width="50" height="20"/></g>').length === 1 &&
    faultsOf('0 0 100 50', '<rect x="10" y="10" width="50" height="20" transform="translate(-45)"/>').length === 1 &&
    faultsOf('0 0 100 50', '<g transform="translate(100 0)"><rect x="-90" y="10" width="20" height="20"/></g>').length === 0);
  check('…the element\'s own transform first, then its ancestors\' (outward)',
    faultsOf('0 0 100 50', '<g transform="matrix(2,0,0,2,0,0)"><rect x="44" y="5" width="4" height="4" transform="translate(10)"/></g>').length === 0 &&
    faultsOf('0 0 100 50', '<g transform="translate(10)"><rect x="44" y="5" width="4" height="4" transform="matrix(2,0,0,2,0,0)"/></g>').length === 1);
  const unread = (viewBox: string, body: string) => faultsOf(viewBox, body).some((f) => /cannot be judged/.test(f));
  check('geometry it cannot read is a fault, never a silent pass: rotate(), relative / H / V / A commands, a % rect, circle / ellipse / polygon, no viewBox',
    unread('0 0 100 50', '<rect x="10" y="10" width="10" height="10" transform="rotate(45)"/>') &&
    unread('0 0 100 50', '<g transform="rotate(45)"><g><rect x="10" y="10" width="10" height="10"/></g></g>') &&
    unread('0 0 100 50', '<path d="m 10 10 l 5 0 l 0 5 z"/>') &&
    unread('0 0 100 50', '<path d="M 10 10 H 20 V 20 Z"/>') &&
    unread('0 0 100 50', '<path d="M 10 10 A 5 5 0 0 1 20 20 Z"/>') &&
    unread('0 0 100 50', '<rect width="100%" height="100%" fill="#fff"/>') &&
    unread('0 0 100 50', '<circle cx="0" cy="0" r="5"/>') &&
    unread('0 0 100 50', '<ellipse cx="0" cy="0" rx="5" ry="3" fill="#888"/>') &&
    unread('0 0 100 50', '<polygon points="0,0 5,0 5,5"/>') &&
    faultsOf('0 0 100 50', '<circle cx="0" cy="0" r="5" fill="none" stroke="black"/>').length === 0 &&
    figureCropFaults('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>').some((f) => /viewBox/.test(f)));
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
  const cropFaults: string[] = [];
  const judgedSvgs = new Set<string>();
  const missingPdf: string[] = [];
  const emptyDoc: string[] = [];
  // Every piece of markup the document renders, parsed and flattened: a
  // throw here would blank a page.
  const render = (where: string, text: string | undefined) => {
    if (!text) return;
    markup++;
    try { parseStatement(text); statementProse(text); } catch (e) { invalid.push(`${where}: ${(e as Error).message}`); }
  };
  // A homework whose app version departs from its printed PDF does not link
  // it: the link would invite confusion (Gabriel, 2026-09-25 — HW1 after
  // task 046's lettered parts and marks; task 050).
  const UNLINKED_PDF = new Set(['hw1']);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const hw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as AssignmentData;
    const name = f.replace('.json', '');
    for (const m of validateDocument(hw)) invalid.push(`${name}: ${m}`);
    if (!hw.sections?.length || (!hw.sourcePdf && !UNLINKED_PDF.has(name))) emptyDoc.push(name);
    if (hw.sourcePdf && UNLINKED_PDF.has(name)) emptyDoc.push(`${name} links the PDF it must not`);
    if (hw.sourcePdf && !existsSync(join(publicDir, hw.sourcePdf))) missingPdf.push(`${name}: ${hw.sourcePdf}`);
    for (const { where, figure } of collectFigures(hw)) {
      // A data: URL is an upload from the question creator, judged by no file
      // (none in the corpus); a missing file is the check below's to report.
      if (/^data:/.test(figure.src)) continue;
      const file = join(publicDir, figure.src);
      if (!existsSync(file)) { missingFigures.push(`${name} ${where}: ${figure.src}`); continue; }
      if (!figure.src.endsWith('.svg') || judgedSvgs.has(figure.src)) continue;
      judgedSvgs.add(figure.src);
      for (const fault of figureCropFaults(readFileSync(file, 'utf8'))) cropFaults.push(`${name} ${where}: ${figure.src} — ${fault}`);
    }
    render(`${name} preamble`, hw.preamble);
    for (const s of hw.sections ?? []) {
      render(`${name} § ${s.heading}`, s.intro);
      for (const c of s.callouts ?? []) render(`${name} § ${s.heading} callout`, c.body);
    }
    for (const q of hw.questions) {
      statements++;
      render(`${name} ${q.label}`, q.statement);
      render(`${name} ${q.label} stem`, q.stem);
      render(`${name} ${q.label} closing`, q.closing);
      render(`${name} ${q.label} hint`, q.hint);
      for (const c of q.callouts ?? []) render(`${name} ${q.label} callout`, c.body);
      const blocks = parseStatement(q.statement);
      if (blocks.some((b) => b.kind === 'io-table')) tabulated.push(`${name} ${q.label}`);
      if (blocks.some((b) => b.kind === 'para' && b.part)) parted.push(`${name} ${q.label}`);
    }
  }
  check(`swept ${statements} HW1-HW7 statements and ${markup} pieces of markup`, statements > 0 && markup > statements);
  check(`every document is valid${invalid.length ? ' — ' + invalid.join('; ') : ''}`, invalid.length === 0);
  check(`every HW carries sections and its source PDF (HW1 deliberately unlinked)${emptyDoc.length ? ' — ' + emptyDoc.join(', ') : ''}`, emptyDoc.length === 0);
  check(`every source PDF exists under public/${missingPdf.length ? ' — ' + missingPdf.join(', ') : ''}`, missingPdf.length === 0);
  check(`every figure file exists under public/${missingFigures.length ? ' — ' + missingFigures.join(', ') : ''}`, missingFigures.length === 0);
  check(`every figure is free of cropped-in neighbours (${judgedSvgs.size} SVGs)${cropFaults.length ? ' — ' + cropFaults.join('; ') : ''}`,
    judgedSvgs.size > 0 && cropFaults.length === 0);
  // The five HW1 truth-table problems are exactly the ones that tabulate;
  // anything else joining them is a false positive of the profile regex.
  check(`exactly the five HW1 truth tables tabulate (${tabulated.join(', ')})`,
    tabulated.join('|') === 'hw1 Problem 1|hw1 Problem 2|hw1 Problem 3|hw1 Problem 4|hw1 Problem 5');
  // No statement splits into parts: HW1's multi-part problems are parts
  // authored as questions (`partOf`, task 048 — [multi-part problems]
  // above), and no "p(1, 2)", "j(⋅)" or "(1)" reference is mistaken for a
  // marker anywhere. (The part grammar itself is pinned in [multi-part
  // questions] above.)
  check(`no HW statement splits into parts (${parted.join(', ') || 'none'})`,
    parted.length === 0);
}

console.log(`\nstatementFormatCheck: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('STATEMENT FORMAT OK');
