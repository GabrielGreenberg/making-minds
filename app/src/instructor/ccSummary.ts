// One-line summaries of a question's CC spec, shared by the editor and any other
// instructor view that lists questions.

import type { AssignmentQuestion, CCSpec } from '../types';

/** e.g. "x[3]" */
function groupLabel(name: string, width: number): string {
  return `${name}[${width}]`;
}

/** e.g. "y = 2 * x  ·  in: x[3]  ·  out: y[3]" */
export function summarizeSpec(spec: CCSpec): string {
  const formulas = spec.outputs.map((o) => `${o.name} = ${o.formula}`).join(', ');
  const ins = spec.inputs.map((g) => groupLabel(g.name, g.width)).join(', ');
  const outs = spec.outputs.map((g) => groupLabel(g.name, g.width)).join(', ');
  return `${formulas}  ·  in: ${ins}  ·  out: ${outs}`;
}

/** Summary line for a question row. Falls back gracefully when no cc_spec. */
export function summarizeQuestion(q: AssignmentQuestion): string {
  if (q.cc_spec) return summarizeSpec(q.cc_spec);
  if (q.test_cases?.length) return `${q.test_cases.length} test cases`;
  return q.statement ? q.statement.slice(0, 60) : 'No specification';
}
