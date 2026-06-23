/**
 * Making Minds grading CLI.
 *
 *   npm run grade -- <homework.json> <submission.json | dir> [...]
 *
 * Reuses the same headless grader the app uses (src/engine). Prints a
 * per-student / per-problem report and writes grades.csv next to the homework
 * file's working directory. Exits non-zero if any input fails to parse.
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { basename, join, extname } from 'node:path';
import { gradeSubmission, interpretBits } from '../src/engine';
import type { HomeworkData, SubmissionData, RepSystem } from '../src/types';

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

const [homeworkPath, ...submissionArgs] = process.argv.slice(2);
if (!homeworkPath || submissionArgs.length === 0) {
  fail('usage: npm run grade -- <homework.json> <submission.json | dir> [...]');
}

const homework = readJson<HomeworkData>(homeworkPath);
// Map problem id -> representation, for readable interpreted values in the report.
const repById = new Map<number, RepSystem>(homework.problems.map((p) => [p.id, p.representation]));

const submissionFiles = collectFiles(submissionArgs);
const csvRows: string[] = ['student,problemId,status,passed,total'];

console.log(`Homework: ${homework.title}\n`);

for (const file of submissionFiles) {
  const submission = readJson<SubmissionData>(file);
  if (!submission.student) submission.student = basename(file, '.json');

  const result = gradeSubmission(homework, submission);
  console.log(`── ${result.student}  (${result.passed}/${result.total} cases) ──`);

  for (const pr of result.problems) {
    const rep = repById.get(pr.problemId) ?? 'binary';
    if (pr.status === 'skipped') {
      console.log(`  Q${pr.problemId}: skipped — ${pr.reason}`);
    } else {
      const mark = pr.passed === pr.total ? '✓' : '✗';
      console.log(`  ${mark} Q${pr.problemId}: ${pr.passed}/${pr.total}`);
      for (const c of pr.cases.filter((c) => !c.pass)) {
        console.log(
          `      in [${c.input.join('')}]  expected ${interpretBits(c.expected, rep)} [${c.expected.join('')}]` +
          `  got ${interpretBits(c.got, rep)} [${c.got.join('')}]`
        );
      }
    }
    csvRows.push(`${result.student},${pr.problemId},${pr.status},${pr.passed},${pr.total}`);
  }
  console.log('');
}

const csvPath = 'grades.csv';
writeFileSync(csvPath, csvRows.join('\n') + '\n');
console.log(`Wrote ${csvPath} (${csvRows.length - 1} rows).`);
