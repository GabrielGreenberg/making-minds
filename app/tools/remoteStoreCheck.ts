// Headless check for the REMOTE storage seams (S3 of
// docs/buildout/designs/remote-stores.md).
//
//   cd app && npx tsx tools/remoteStoreCheck.ts
//
// Boots the REAL API server (server/src) on an ephemeral port against an
// in-memory SQLite DB — the serverCheck pattern — then drives the app's
// Remote{Workbook,Assignment,Submission}Store instances against it through
// api/client.ts (base URL injected via setApiBase; localStorage shimmed for
// the token), pinning:
//
//   - the grader-import grep gate: remote-store modules must never pull in
//     the engine grader (remote students must not grade client-side)
//   - 401 handling: unauthenticated/dead-token seam calls reject with
//     ApiError(401) AND fire the client's onUnauthorized hook
//   - the full round-trip: instructor creates an assignment → student's copy
//     is answer-stripped → workbook save/load → submit (answers only;
//     identity + timestamp are the server's word; no grade shown) →
//     instructor reads server grades → manual review through the seam →
//     release/unrelease gates what the student's records carry
//
// S4 additions (the cutover's resilience slice):
//
//   - the boot health probe: api.health() true against the live server,
//     false on a 503 answer AND on a dead port (HealthGate's retry screen)
//   - the fill-empty migration decision table (storage/migrateLocal.ts):
//     server-null + local-present → upload; server-present → NEVER touch;
//     per-email guard key; idempotent with and without the guard; student
//     role never publishes locally carried authored assignments
//   - the crash-buffer journal (storage/journal.ts): keyed per email (shared
//     lab browsers), replay supersedes the fetched server state, re-uploads
//     through the seam, and clears itself on the confirmed upload
//
// Exits non-zero on the first tally of failures.

// The api client reads the bearer token from localStorage (lazily, per call);
// give Node a minimal shim BEFORE importing anything that might touch it.
const backing = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  // length/key(i): migrateLocalData scans localStorage by prefix.
  get length() {
    return backing.size;
  },
  key: (i: number) => Array.from(backing.keys())[i] ?? null,
};

const { readFileSync } = await import('node:fs');
const { createApp } = await import('../../server/src/app');
const { Db } = await import('../../server/src/db');
const api = await import('../src/api/client');
const { remoteWorkbookStore, remoteAssignmentStore, remoteSubmissionStore } = await import(
  '../src/storage/remoteStores'
);
const { TOY_ACCOUNTS } = await import('../src/auth/accounts');
const {
  buildSampleAssignment,
  buildCorrectSubmission,
  buildIncorrectSubmission,
  SAMPLE_ASSIGNMENT_ID,
} = await import('../src/devData/sampleData');

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ── grep gate: no grader in the remote-store module graph ────────
// House pattern from notationCheck: the modules a remote student's browser
// necessarily loads for storage I/O must not import the engine grader —
// grading stays where the test cases are (the server).
for (const rel of [
  '../src/storage/remoteStores.ts',
  '../src/storage/backend.ts',
  '../src/api/client.ts',
  '../src/storage/journal.ts',
  '../src/storage/migrateLocal.ts',
]) {
  const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
  check(
    `grep gate: ${rel.replace('../src/', '')} imports no grader`,
    !/engine\/grader|gradeSubmission|gradeQuestion|gradeTurbot/.test(source),
  );
}

// ── boot the real server on an ephemeral port ────────────────────
const db = new Db(':memory:');
for (const a of TOY_ACCOUNTS) {
  db.upsertUser({ email: a.email.toLowerCase(), name: a.name, role: a.role });
}
db.saveAssignment(buildSampleAssignment());

const app = createApp(
  { port: 0, dbPath: ':memory:', corsOrigins: [], authMode: 'dev', sessionTtlSeconds: 3600 },
  db,
);
const server = app.listen(0);
await new Promise<void>((resolve) => server.on('listening', resolve));
const address = server.address();
api.setApiBase(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);

const student = TOY_ACCOUNTS.find((a) => a.role === 'student')!;
const instructor = TOY_ACCOUNTS.find((a) => a.role === 'instructor')!;

// ── 401 before any login: seam rejects AND the hook fires ────────
let unauthorizedFires = 0;
api.setOnUnauthorized(() => unauthorizedFires++);

const unauthenticated = await remoteWorkbookStore
  .loadAssignmentState(SAMPLE_ASSIGNMENT_ID)
  .then(() => null as api.ApiError | null)
  .catch((e: unknown) => (e instanceof api.ApiError ? e : null));
check('unauthenticated seam call rejects with ApiError(401)', unauthenticated?.status === 401);
check('…and fires the onUnauthorized hook', unauthorizedFires === 1);

// ── instructor: assignment CRUD + release through the seam ───────
await api.login(instructor.email);
const iTok = api.getToken();
check('instructor login stored a bearer token', typeof iTok === 'string' && iTok.length > 0);

const seededList = await remoteAssignmentStore.list();
const seededRow = seededList.find((a) => a.id === SAMPLE_ASSIGNMENT_ID);
check(
  'list() reports the seeded assignment (gradesReleased false)',
  seededRow != null && seededRow.gradesReleased === false && seededRow.questionCount > 0,
);

const created = { ...buildSampleAssignment(), id: 'remote-check-asg', title: 'Remote Check' };
await remoteAssignmentStore.save(created);
const createdBack = await remoteAssignmentStore.get('remote-check-asg');
check(
  'save() → get() round-trips a created assignment',
  createdBack?.assignment.title === 'Remote Check' &&
    createdBack.assignment.questions.length === created.questions.length,
);
check(
  'instructor get() keeps test_cases (the server trusts the role)',
  createdBack?.assignment.questions.some((q) => (q.test_cases ?? []).length > 0) === true,
);
await remoteAssignmentStore.remove('remote-check-asg');
check('remove() → get() resolves null (404 → seam null)', (await remoteAssignmentStore.get('remote-check-asg')) === null);
check('get() of an unknown id resolves null', (await remoteAssignmentStore.get('never-existed')) === null);

await remoteAssignmentStore.setGradesReleased(SAMPLE_ASSIGNMENT_ID, true);
check('setGradesReleased(true) → getGradesReleased() true', (await remoteAssignmentStore.getGradesReleased(SAMPLE_ASSIGNMENT_ID)) === true);
await remoteAssignmentStore.setGradesReleased(SAMPLE_ASSIGNMENT_ID, false);
check('…and back to false', (await remoteAssignmentStore.getGradesReleased(SAMPLE_ASSIGNMENT_ID)) === false);

// ── student: sanitized assignment + workbook round-trip ──────────
await api.login(student.email);
const sTok = api.getToken();

const studentCopy = await remoteAssignmentStore.get(SAMPLE_ASSIGNMENT_ID);
check(
  'student get() is answer-stripped (every test_cases empty)',
  studentCopy != null && studentCopy.assignment.questions.every((q) => (q.test_cases ?? []).length === 0),
);
check(
  'student get() keeps turbot arenas (statement, not answer key)',
  studentCopy?.assignment.questions.some((q) => (q.turbot_cases ?? []).length > 0) === true,
);

check('workbook load before any save resolves null', (await remoteWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID)) === null);
await remoteWorkbookStore.saveAssignmentState(SAMPLE_ASSIGNMENT_ID, {
  currentQuestionIndex: 2,
  questionCircuits: { 1: { components: [], wires: [], textElements: [], comments: [], boxes: [] } },
});
const wbBack = await remoteWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID);
check(
  'workbook save/load round-trips',
  wbBack?.currentQuestionIndex === 2 && wbBack.questionCircuits[1] != null,
);

// ── student: submit — answers only, server's word, no grade ──────
const spoofed = {
  ...buildCorrectSubmission(student.email),
  student: 'spoof@evil.com',
  submittedAt: '1999-01-01T00:00:00.000Z',
};
const rec1 = await remoteSubmissionStore.submit(SAMPLE_ASSIGNMENT_ID, spoofed);
check('first submit is attempt 1', rec1.attempt === 1);
check('pre-release submit returns NO grade', rec1.result === undefined);
check(
  'identity is the server’s word (spoofed student ignored)',
  rec1.submission.student === student.email.toLowerCase(),
);
check(
  'timestamp is the server’s word (spoofed submittedAt ignored)',
  rec1.submittedAt !== spoofed.submittedAt && !Number.isNaN(Date.parse(rec1.submittedAt)),
);

const rec2 = await remoteSubmissionStore.submit(SAMPLE_ASSIGNMENT_ID, buildIncorrectSubmission(student.email));
check('second submit is attempt 2', rec2.attempt === 2);
check('getLatest() returns the newest attempt', (await remoteSubmissionStore.getLatest(SAMPLE_ASSIGNMENT_ID))?.attempt === 2);

// ── instructor: server grades + manual review through the seam ───
api.setToken(iTok);
const graded = await remoteSubmissionStore.listSubmissions(SAMPLE_ASSIGNMENT_ID);
const g1 = graded.find((r) => r.attempt === 1)?.result;
const g2 = graded.find((r) => r.attempt === 2)?.result;
check(
  'instructor listSubmissions carries server grades (correct all-pass, incorrect fails)',
  !!g1 && g1.passed === g1.total && g1.total > 0 && !!g2 && g2.passed < g2.total,
  JSON.stringify({ first: [g1?.passed, g1?.total], second: [g2?.passed, g2?.total] }),
);

const openQ = createdBack!.assignment.questions.find((q) => q.buildMode === 'open')!;
const reviewed = await remoteSubmissionStore.recordManualReview(
  SAMPLE_ASSIGNMENT_ID,
  student.email,
  1,
  openQ.id,
  { pass: true, note: 'clear justification' },
);
const verdict = reviewed?.result?.questions.find((q) => q.questionId === openQ.id)?.manual;
check(
  'recordManualReview lands the verdict on the returned record',
  verdict?.pass === true && verdict.note === 'clear justification',
);
const notPending = await remoteSubmissionStore.recordManualReview(
  SAMPLE_ASSIGNMENT_ID,
  student.email,
  1,
  createdBack!.assignment.questions[0].id, // autograded, never pending
  { pass: true },
);
check('review of a non-pending question resolves null (404 → seam null)', notPending === null);

// ── release gates what the student's records carry ───────────────
await remoteAssignmentStore.setGradesReleased(SAMPLE_ASSIGNMENT_ID, true);
api.setToken(sTok);
const releasedLatest = await remoteSubmissionStore.getLatest(SAMPLE_ASSIGNMENT_ID);
check('after release, student getLatest() carries scores', releasedLatest?.result != null);
check(
  'released student records still hide per-case detail',
  (releasedLatest?.result?.questions ?? []).every(
    (q) => q.cases.length === 0 && (q.turbotCases ?? []).length === 0,
  ),
);
check(
  'released summaries report gradesReleased to the student',
  (await remoteAssignmentStore.list()).find((a) => a.id === SAMPLE_ASSIGNMENT_ID)?.gradesReleased === true,
);

api.setToken(iTok);
await remoteAssignmentStore.setGradesReleased(SAMPLE_ASSIGNMENT_ID, false);
api.setToken(sTok);
check(
  'unrelease hides grades again',
  (await remoteSubmissionStore.getLatest(SAMPLE_ASSIGNMENT_ID))?.result === undefined,
);

// ── dead token: 401 hook fires on an authenticated-looking call ──
api.setToken('garbage-token');
const dead = await remoteSubmissionStore
  .listSubmissions(SAMPLE_ASSIGNMENT_ID)
  .then(() => null as api.ApiError | null)
  .catch((e: unknown) => (e instanceof api.ApiError ? e : null));
check('dead token rejects with ApiError(401) and fires the hook', dead?.status === 401 && unauthorizedFires === 2);

// ═══ S4: health probe · fill-empty migration · crash-buffer journal ═══

// ── health probe (auth/HealthGate.tsx's boot decision) ───────────
const liveBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
check('health() true against the live server', (await api.health()) === true);

const { createServer } = await import('node:http');
const sick = createServer((_req, res) => {
  res.statusCode = 503;
  res.end('{"ok":false}');
});
sick.listen(0);
await new Promise<void>((resolve) => sick.on('listening', resolve));
const sickAddress = sick.address();
const sickPort = typeof sickAddress === 'object' && sickAddress ? sickAddress.port : 0;
api.setApiBase(`http://127.0.0.1:${sickPort}`);
check('health() false when the server answers 503', (await api.health()) === false);
await new Promise<void>((resolve) => sick.close(() => resolve()));
check('health() false against a dead port (connection refused)', (await api.health()) === false);
api.setApiBase(liveBase);

// ── fill-empty migration (storage/migrateLocal.ts) ───────────────
// The decision table: server-null + local-present → upload; server-present →
// never touch; guard key per email; idempotent with AND without the guard.
const { migrateLocalData } = await import('../src/storage/migrateLocal');
const { localAssignmentStore } = await import('../src/storage/AssignmentStore');

await api.login(instructor.email);
const wbLocal = {
  currentQuestionIndex: 1,
  questionCircuits: { 5: { components: [], wires: [], textElements: [], comments: [], boxes: [] } },
};
const wbServerPre = {
  currentQuestionIndex: 4,
  questionCircuits: { 9: { components: [], wires: [], textElements: [], comments: [], boxes: [] } },
};
// Local prototype data in the shimmed browser localStorage:
backing.set('mm:asg:' + SAMPLE_ASSIGNMENT_ID, JSON.stringify(wbLocal)); // instructor has NO server copy
backing.set('mm:asg:wb-taken', JSON.stringify({ ...wbLocal, currentQuestionIndex: 2 }));
await remoteWorkbookStore.saveAssignmentState('wb-taken', wbServerPre); // server-present
const localOnlyAsg = { ...buildSampleAssignment(), id: 'migrated-local-asg', title: 'Authored Locally' };
await localAssignmentStore.save(localOnlyAsg); // writes mm:inst-asg:migrated-local-asg to the shim
await localAssignmentStore.save({ ...buildSampleAssignment(), title: 'LOCAL EDIT, MUST NOT WIN' }); // id collides with the seeded server row

const mig1 = await migrateLocalData({ email: instructor.email, role: 'instructor' });
check('migration ran and uploaded exactly the two server-empty items',
  mig1.ran && mig1.workbooksUploaded === 1 && mig1.assignmentsUploaded === 1,
  JSON.stringify(mig1));
const migratedWb = await remoteWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID);
check('server-null + local-present → workbook uploaded',
  migratedWb?.currentQuestionIndex === 1 && migratedWb.questionCircuits[5] != null);
const untouchedWb = await remoteWorkbookStore.loadAssignmentState('wb-taken');
check('server-present workbook NEVER touched',
  untouchedWb?.currentQuestionIndex === 4 && untouchedWb.questionCircuits[9] != null);
check('local-only authored assignment uploaded',
  (await remoteAssignmentStore.get('migrated-local-asg'))?.assignment.title === 'Authored Locally');
check('server-present assignment NEVER touched (local title edit loses)',
  (await remoteAssignmentStore.get(SAMPLE_ASSIGNMENT_ID))?.assignment.title !== 'LOCAL EDIT, MUST NOT WIN');
const guardKey = 'mm:migrated:' + instructor.email.toLowerCase();
check('per-email guard key set after a successful pass', backing.has(guardKey));

// Idempotence via the guard: mutate local, re-run → nothing re-uploads.
backing.set('mm:asg:' + SAMPLE_ASSIGNMENT_ID, JSON.stringify({ ...wbLocal, currentQuestionIndex: 3 }));
const mig2 = await migrateLocalData({ email: instructor.email, role: 'instructor' });
check('second run is a guard-key no-op', mig2.ran === false && mig2.workbooksUploaded === 0);
check('…and the server copy is unchanged',
  (await remoteWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID))?.currentQuestionIndex === 1);

// Idempotence WITHOUT the guard: fill-empty itself never overwrites.
backing.delete(guardKey);
const mig3 = await migrateLocalData({ email: instructor.email, role: 'instructor' });
check('guard-less re-run uploads nothing (everything is server-present now)',
  mig3.ran && mig3.workbooksUploaded === 0 && mig3.assignmentsUploaded === 0,
  JSON.stringify(mig3));
check('…wb-taken still carries the pre-migration server state',
  (await remoteWorkbookStore.loadAssignmentState('wb-taken'))?.currentQuestionIndex === 4);

// Student role: workbooks migrate per-user; authored assignments do NOT.
await api.login(student.email);
await localAssignmentStore.save({ ...buildSampleAssignment(), id: 'student-carried-asg', title: 'Not Mine To Publish' });
const migS = await migrateLocalData({ email: student.email, role: 'student' });
check('student migration runs without throwing (assignments skipped by role)',
  migS.ran && migS.assignmentsUploaded === 0, JSON.stringify(migS));
check('student’s existing server workbook untouched (per-user fill-empty)',
  (await remoteWorkbookStore.loadAssignmentState(SAMPLE_ASSIGNMENT_ID))?.currentQuestionIndex === 2);
api.setToken(iTok);
check('the student-carried authored assignment never reached the server',
  (await remoteAssignmentStore.get('student-carried-asg')) === null);

// ── crash-buffer journal (storage/journal.ts) ────────────────────
const { writeJournal, readJournal, clearJournal, reconcileJournal } = await import(
  '../src/storage/journal'
);
const jState = {
  currentQuestionIndex: 7,
  questionCircuits: { 3: { components: [], wires: [], textElements: [], comments: [], boxes: [] } },
};
writeJournal('alice@example.com', 'jr-asg', jState);
check('journal keyed per email: another user reads null',
  readJournal('bob@example.com', 'jr-asg') === null);
check('journal round-trips for its own (email, assignment)',
  readJournal('alice@example.com', 'jr-asg')?.currentQuestionIndex === 7);
clearJournal('alice@example.com', 'jr-asg');
check('clearJournal removes the buffer', readJournal('alice@example.com', 'jr-asg') === null);

// Replay: a surviving buffer supersedes the fetched server state, is
// re-uploaded through the seam, and is cleared on the confirmed upload.
api.setToken(sTok);
const jServer = { ...jState, currentQuestionIndex: 0 };
await remoteWorkbookStore.saveAssignmentState('jr-asg', jServer);
writeJournal(student.email, 'jr-asg', jState);
const replayed = await reconcileJournal(student.email, 'jr-asg', jServer, remoteWorkbookStore);
check('reconcile returns the buffered state (replay wins over the fetched copy)',
  replayed?.currentQuestionIndex === 7);
check('replay uploaded the buffer to the server',
  (await remoteWorkbookStore.loadAssignmentState('jr-asg'))?.currentQuestionIndex === 7);
check('replay cleared the journal key', readJournal(student.email, 'jr-asg') === null);
const passthrough = await reconcileJournal(student.email, 'jr-asg', jServer, remoteWorkbookStore);
check('no buffer → the fetched state passes through untouched',
  passthrough === jServer);

server.close();
db.close();

console.log(
  failures === 0 ? '\nremoteStoreCheck: all checks passed' : `\nremoteStoreCheck: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
