// Seed the server database with everything the prototype bundles client-side:
// the toy roster, the bundled cc-basics assignment, and (with --sample) the
// five-mode sample assignment plus its graded demo submissions — the server
// twin of app/src/devData/seed.ts. Idempotent: reruns upsert/replace.
//
//   MM_DB_PATH=making-minds.sqlite npm run seed          # roster + cc-basics
//   MM_DB_PATH=making-minds.sqlite npm run seed -- --sample

import { loadConfig } from './config';
import { Db } from './db';
import { hashPassword } from './password';
import { gradeSubmission } from '../../app/src/engine/grader';
import { TOY_ACCOUNTS } from '../../app/src/auth/accounts';
import type { AssignmentData } from '../../app/src/types';
import ccBasics from '../../app/src/assignments/cc-basics.json';
import {
  buildSampleAssignment,
  buildSampleSubmissions,
  SAMPLE_ASSIGNMENT_ID,
} from '../../app/src/devData/sampleData';

const config = loadConfig();
const db = new Db(config.dbPath);

// `--password X` also gives every toy account the password X, so a box running
// the real (password) auth mode is immediately usable for a demo. Without it
// the toy accounts exist on the roster with no credential — exactly like a
// real student before they create their account.
const passwordArg = process.argv.find((a) => a.startsWith('--password='));
const toyPassword = passwordArg ? passwordArg.slice('--password='.length) : null;

for (const account of TOY_ACCOUNTS) {
  const email = account.email.toLowerCase();
  db.upsertUser({ email, name: account.name, role: account.role });
  if (toyPassword) db.setPasswordHash(email, hashPassword(toyPassword));
}
console.log(
  `roster: ${TOY_ACCOUNTS.length} accounts${toyPassword ? ' (with the given demo password)' : ''}`,
);

const bundled = ccBasics as unknown as AssignmentData;
db.saveAssignment(bundled);
console.log(`assignment: ${bundled.id} (${bundled.questions.length} questions)`);

if (process.argv.includes('--sample')) {
  const sample = buildSampleAssignment();
  db.saveAssignment(sample);
  db.clearSubmissions(SAMPLE_ASSIGNMENT_ID);
  for (const s of buildSampleSubmissions()) {
    const submission = { ...s, submittedAt: new Date().toISOString() };
    const email = submission.student ?? 'unknown@example.com';
    db.upsertUser({ email, name: email.split('@')[0], role: 'student' });
    const result = gradeSubmission(sample, submission);
    db.addSubmission(SAMPLE_ASSIGNMENT_ID, email, submission, result);
    console.log(
      `submission: ${email} → ${result.passed}/${result.total} cases`,
    );
  }
  console.log(`assignment: ${sample.id} (${sample.questions.length} questions) + demo submissions`);
}

db.close();
console.log(`seeded ${config.dbPath}`);
