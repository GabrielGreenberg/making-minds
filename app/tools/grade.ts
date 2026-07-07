/**
 * Making Minds grading CLI.
 *
 *   npm run grade -- <assignment.json> <submission.json | dir> [...]
 *
 * Reuses the same headless grader the app uses (src/engine). Prints a
 * per-student / per-question report and writes grades.csv to the working
 * directory. Exits non-zero if any input fails to parse.
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { basename, join, extname } from 'node:path';
import { gradeSubmission } from '../src/engine';
import type { AssignmentData, SubmissionData } from '../src/types';

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Expand args into a flat list of .json file paths (dirs are scanned). */
function collectFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    let st;
    try { st = statSync(p); } catch { fail(`no such file or directory: ${p}`); }
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) {
        if (extname(f) === '.json') out.push(join(p, f));
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

function readJson<T>(path: string): T {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { fail(`cannot read ${path}`); }
  try { return JSON.parse(text) as T; } catch { fail(`invalid JSON in ${path}`); }
}

const [assignmentPath, ...submissionArgs] = process.argv.slice(2);
if (!assignmentPath || submissionArgs.length === 0) {
  fail('usage: npm run grade -- <assignment.json> <submission.json | dir> [...]');
}

const assignment = readJson<AssignmentData>(assignmentPath);

const submissionFiles = collectFiles(submissionArgs);
const csvRows: string[] = ['student,questionId,status,passed,total'];

console.log(`Assignment: ${assignment.title}\n`);

for (const file of submissionFiles) {
  const submission = readJson<SubmissionData>(file);
  if (!submission.student) submission.student = basename(file, '.json');

  const result = gradeSubmission(assignment, submission);
  console.log(`── ${result.student}  (${result.passed}/${result.total} cases) ──`);

  for (const qr of result.questions) {
    if (qr.status === 'pending') {
      const words = qr.response?.trim() ? qr.response.trim().split(/\s+/).length : 0;
      console.log(`  ✎ Q${qr.questionId}: open question — needs manual review (${words} words)`);
    } else if (qr.status === 'skipped') {
      console.log(`  Q${qr.questionId}: skipped — ${qr.reason}`);
    } else {
      const mark = qr.passed === qr.total ? '✓' : '✗';
      console.log(`  ${mark} Q${qr.questionId}: ${qr.passed}/${qr.total}`);
      for (const c of qr.cases.filter((c) => !c.pass)) {
        const got = c.reason ?? `[${c.got.join(', ')}]`;
        console.log(`      in [${c.input.join(', ')}]  expected [${c.expected.join(', ')}]  got ${got}`);
      }
    }
    csvRows.push(`${result.student},${qr.questionId},${qr.status},${qr.passed},${qr.total}`);
  }
  console.log('');
}

const csvPath = 'grades.csv';
writeFileSync(csvPath, csvRows.join('\n') + '\n');
console.log(`Wrote ${csvPath} (${csvRows.length - 1} rows).`);
