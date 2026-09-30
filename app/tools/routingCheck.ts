// Headless checks for route-level access and the one front door
// (src/routing.ts — task 027, visitor mode; task 040, the front door).
//
//   cd app && npx tsx tools/routingCheck.ts
//
// Pins: [routeAccess] — the sandbox is the one public route; the student
// routes need sign-in; every instructor route needs the instructor role (and
// every Route kind is classified). [robot route] — the Dashboard's Robot tab
// (task 083, `#/instructor/robot`) round-trips, instructor-only; the shell
// renders it after Notes, current on its route, with no strip before an
// answer; the tab over a synthetic answer renders its four sections, the
// verdict, the student-fix tag, review marks as id + category, an unknown
// line, the local-mode reason, and a failed refresh beside the last answer.
// [case route] — `#/a/:id/q/:i/case/:k`
// ("Run this input") parses and round-trips, a malformed case segment is
// dropped (the question kept), and applying it loads case k of question i
// into the run after the question opens. [submission route] —
// `#/a/:id/submission/:n[/q/:i[/case/:k]]` (a submitted attempt shown
// read-only, task 003) parses and round-trips, a malformed attempt is dropped
// (the rest kept), and applying it shows the attempt (store viewSubmission)
// BEFORE the question opens; an unknown attempt repairs the URL to the live
// route; a superseded apply does nothing. [multi-part route: applied] (task
// 048) — a later part's route opens its problem's page (the first part's
// index), and applying it again, or another part's, is no swap. [grading routes] — the Grading
// tab's routes (task 065; the queue by student, 066) round-trip with the student key URI-encoded whole,
// a malformed queue problem is dropped (the queue kept), an unknown view is
// the Overview, and the retired gradebook URL
// (`#/instructor/assignments/:id/submissions`) parses to its Overview and is
// rewritten by canonicalHash, which leaves every other hash alone. [viewer
// route] — another student's attempt in the read-only editor (task 067,
// `#/instructor/grading/:asg/student/:sid/submission/:n[/q/:i[/case/:k]]`)
// round-trips, needs the instructor role, falls back to the student's page on
// a malformed attempt, leaves the own `#/a/:id/submission/:n` unchanged; and
// editorRoute keeps the owner on every in-editor navigation; [feedback
// context] — a Feedback report's context is the route's (task 076): an
// assignment route whose assignment is the one open gives its id (+ the
// question's, in range), every other route — Home, Grades, the sandbox, the
// Dashboard — none, whatever the store last held; local filing keeps the
// instructor role with no context key; the report form reads no store, no
// shell hides Feedback, and the Feedback tab files and reloads; [viewer apply]
// only an instructor's apply opens it (openSubmissionOf), and any other
// route leaves it. [front door] — the bare site (`#/`,
// or no hash) is Home, which needs sign-in, so anyone not signed in meets the
// sign-in screen whatever the browser's history; `#/sandbox` is open to a
// visitor; the retired "signed in before" trace (`mm:auth:known`, the
// sandbox landing redirect) is gone from src (grep gate). [held routes] — with
// nobody signed in, a route that needs sign-in is never applied to the store
// (no unauthenticated openAssignment), a public one is; signing in applies
// the held route (the deep-link-survives-sign-in guarantee). [boot] —
// initRouting on `#/` with nobody signed in keeps the URL and holds Home (no
// redirect, no sandbox opened behind the sign-in screen). [principal
// change] — every change of who is signed in re-applies the URL onto the
// store the auth provider has just reset (store.resetForPrincipal): the
// sandbox is re-entered (never a blank page), a signed-in route is held on
// sign-out and applied on the next sign-in.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import type { RobotStatus } from '../src/storage/robotStatus';

// The store and routing touch window / document / localStorage / location /
// history, so install minimal shims BEFORE dynamically importing them.
const noop = () => {};
const backing = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};
g.window = {
  setInterval: setInterval.bind(globalThis),
  clearInterval: clearInterval.bind(globalThis),
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => true,
};
g.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' };
const loc = { pathname: '/', search: '', hash: '#/' };
g.location = loc;
const setUrl = (_s: unknown, _t: string, url: string) => {
  loc.hash = url.slice(url.indexOf('#'));
};
g.history = { pushState: setUrl, replaceState: setUrl };

// The app's course backend (task 087), installed as main.tsx installs it.
await import('../src/storage/appBackend');
const { routeAccess, initRouting, setRoutingPrincipal, parseHash, routeToHash, navigate, canonicalHash, editorRoute, feedbackContextFor } = await import('../src/routing');
const { useStore } = await import('../src/store');
type Route = import('../src/routing').Route;

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

console.log('[routeAccess]');
const ALL: Route[] = [
  { kind: 'home' },
  { kind: 'sandbox' },
  { kind: 'grades' },
  { kind: 'grades', id: 'hw1' },
  { kind: 'assignment', id: 'hw1' },
  { kind: 'assignment', id: 'hw1', questionIndex: 2 },
  { kind: 'assignment', id: 'hw1', questionIndex: 2, caseIndex: 5 },
  { kind: 'assignment', id: 'hw1', attempt: 2 },
  { kind: 'assignment', id: 'hw1', attempt: 2, questionIndex: 3 },
  { kind: 'assignment', id: 'hw1', attempt: 2, questionIndex: 3, caseIndex: 1 },
  { kind: 'instructor' },
  { kind: 'instructor-new-assignment' },
  { kind: 'instructor-edit', id: 'hw1' },
  { kind: 'instructor-grading' },
  { kind: 'instructor-grading-assignment', id: 'hw1', view: 'overview' },
  { kind: 'instructor-grading-assignment', id: 'hw1', view: 'matrix' },
  { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue' },
  { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue', questionId: 7 },
  { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue', student: 'k1' },
  { kind: 'instructor-grading-student', id: 'hw1', student: 'k1' },
  { kind: 'instructor-student', student: 'k1' },
  { kind: 'instructor-roster' },
  { kind: 'instructor-feedback' },
  { kind: 'instructor-notes' },
  { kind: 'instructor-robot' },
];
check('the sandbox is public', routeAccess({ kind: 'sandbox' }) === 'public');
check('the sandbox is the ONLY public route', ALL.filter((r) => routeAccess(r) === 'public').length === 1);
for (const r of ALL.filter((r) => ['home', 'grades', 'assignment'].includes(r.kind))) {
  check(`${r.kind}${'id' in r ? ` ${r.id}` : ''} needs sign-in`, routeAccess(r) === 'signed-in');
}
check(
  'every instructor-* route needs the instructor role',
  ALL.filter((r) => r.kind.startsWith('instructor')).every((r) => routeAccess(r) === 'instructor'),
);

console.log('[robot route]');
{
  // The Dashboard's Robot tab (task 083): after Notes, instructor-only (the
  // ALL pin above), and its hash round-trips.
  const r = parseHash('#/instructor/robot');
  check("'#/instructor/robot' → the Robot tab", r.kind === 'instructor-robot');
  check('…and round-trips through routeToHash', routeToHash(r) === '#/instructor/robot');
  check('…instructor-only', routeAccess(r) === 'instructor');
}

console.log('[case route]');
{
  const r = parseHash('#/a/hw1/q/2/case/5');
  check("'#/a/hw1/q/2/case/5' → question 2, case 5",
    r.kind === 'assignment' && r.id === 'hw1' && r.questionIndex === 2 && r.caseIndex === 5);
  check('…and round-trips through routeToHash', routeToHash(r) === '#/a/hw1/q/2/case/5');
  for (const bad of ['-1', 'x', '1.5']) {
    const b = parseHash(`#/a/hw1/q/2/case/${bad}`);
    check(`'/case/${bad}' drops the case but keeps the question`,
      b.kind === 'assignment' && b.questionIndex === 2 && b.caseIndex === undefined);
  }
  const plain = parseHash('#/a/hw1/q/2');
  check('a question route has no case', plain.kind === 'assignment' && plain.caseIndex === undefined &&
    routeToHash(plain) === '#/a/hw1/q/2');
  check('a case without a question is not a route to one',
    routeToHash({ kind: 'assignment', id: 'hw1', caseIndex: 5 }) === '#/a/hw1');
  check('the case route needs sign-in', routeAccess(r) === 'signed-in');
}

console.log('[submission route]');
{
  for (const hash of ['#/a/hw1/submission/2', '#/a/hw1/submission/2/q/3', '#/a/hw1/submission/2/q/3/case/1']) {
    const r = parseHash(hash);
    check(`'${hash}' → attempt 2, and round-trips`,
      r.kind === 'assignment' && r.id === 'hw1' && r.attempt === 2 && routeToHash(r) === hash);
  }
  const deep = parseHash('#/a/hw1/submission/2/q/3/case/1');
  check('…the question and case after the attempt are kept',
    deep.kind === 'assignment' && deep.questionIndex === 3 && deep.caseIndex === 1);
  for (const bad of ['0', '-1', 'x', '1.5']) {
    const b = parseHash(`#/a/hw1/submission/${bad}/q/3`);
    check(`'/submission/${bad}' drops the attempt but keeps the question`,
      b.kind === 'assignment' && b.attempt === undefined && b.questionIndex === 3 && routeToHash(b) === '#/a/hw1/q/3');
  }
  const plain = parseHash('#/a/hw1/q/2');
  check('a plain question route has no attempt', plain.kind === 'assignment' && plain.attempt === undefined);
  check('the submission route needs sign-in', routeAccess(parseHash('#/a/hw1/submission/2')) === 'signed-in');
}

console.log('[grading routes]');
{
  // Every hash round-trips; a student segment is an opaque key, URI-encoded
  // whole (a local key is an email, so '@' — and a '/' must not split it).
  const key = 's01@example.com/x';
  const enc = encodeURIComponent(key);
  const cases: [string, Route][] = [
    ['#/instructor/grading', { kind: 'instructor-grading' }],
    ['#/instructor/grading/hw1', { kind: 'instructor-grading-assignment', id: 'hw1', view: 'overview' }],
    ['#/instructor/grading/hw1/matrix', { kind: 'instructor-grading-assignment', id: 'hw1', view: 'matrix' }],
    ['#/instructor/grading/hw1/queue', { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue' }],
    ['#/instructor/grading/hw1/queue/7', { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue', questionId: 7 }],
    // The queue by student (task 066): the student key, URI-encoded whole.
    ['#/instructor/grading/hw1/queue/student/abc', { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue', student: 'abc' }],
    [`#/instructor/grading/hw1/queue/student/${enc}`, { kind: 'instructor-grading-assignment', id: 'hw1', view: 'queue', student: key }],
    ['#/instructor/grading/hw1/student/k1', { kind: 'instructor-grading-student', id: 'hw1', student: 'k1' }],
    [`#/instructor/grading/hw1/student/${enc}`, { kind: 'instructor-grading-student', id: 'hw1', student: key }],
    ['#/instructor/students/k1', { kind: 'instructor-student', student: 'k1' }],
    [`#/instructor/students/${enc}`, { kind: 'instructor-student', student: key }],
  ];
  for (const [hash, want] of cases) {
    const r = parseHash(hash);
    check(`'${hash}' parses, and round-trips`, JSON.stringify(r) === JSON.stringify(want) && routeToHash(r) === hash);
  }
  check("the encoded key keeps its '@' and '/' out of the path",
    !routeToHash({ kind: 'instructor-student', student: key }).slice('#/instructor/students/'.length).match(/[@/]/));
  for (const bad of ['x', '-1', '1.5']) {
    const b = parseHash(`#/instructor/grading/hw1/queue/${bad}`);
    check(`'/queue/${bad}' drops the problem but keeps the queue`,
      b.kind === 'instructor-grading-assignment' && b.view === 'queue' && b.questionId === undefined);
  }
  const bare = parseHash('#/instructor/grading/hw1/queue/student');
  check("'/queue/student' with no key is the queue (no problem, no student)",
    bare.kind === 'instructor-grading-assignment' && bare.view === 'queue' && bare.questionId === undefined && bare.student === undefined);
  for (const odd of ['#/instructor/grading/hw1/nonsense', '#/instructor/grading/hw1/student']) {
    const o = parseHash(odd);
    check(`'${odd}' → the Overview`, o.kind === 'instructor-grading-assignment' && o.view === 'overview');
  }
  const legacy = '#/instructor/assignments/hw1/submissions';
  const lr = parseHash(legacy);
  check("the old gradebook URL parses to the assignment's grading Overview",
    lr.kind === 'instructor-grading-assignment' && lr.id === 'hw1' && lr.view === 'overview');
  check('…and canonicalHash rewrites it to #/instructor/grading/hw1', canonicalHash(legacy) === '#/instructor/grading/hw1');
  check('canonicalHash leaves every canonical hash unchanged',
    [...cases.map(([h]) => h), '#/', '#/a/hw1/q/2', '#/instructor/assignments/hw1/edit', '#/instructor/assignments/new', '#/instructor/grading/hw1/nonsense']
      .every((h) => canonicalHash(h) === h));
}

console.log('[viewer route]');
{
  // Another student's attempt in the read-only editor (task 067): the
  // student's page with `/submission/:n[/q/:i[/case/:k]]`, an `assignment`
  // route carrying the student's key — instructor-only.
  const key = 's01@example.com/x';
  const enc = encodeURIComponent(key);
  const base = `#/instructor/grading/hw1/student/${enc}/submission/2`;
  const cases: [string, Route][] = [
    [base, { kind: 'assignment', id: 'hw1', student: key, attempt: 2 }],
    [`${base}/q/3`, { kind: 'assignment', id: 'hw1', student: key, attempt: 2, questionIndex: 3 }],
    [`${base}/q/3/case/1`, { kind: 'assignment', id: 'hw1', student: key, attempt: 2, questionIndex: 3, caseIndex: 1 }],
  ];
  for (const [hash, want] of cases) {
    const r = parseHash(hash);
    check(`'${hash}' parses, and round-trips`, JSON.stringify(r) === JSON.stringify(want) && routeToHash(r) === hash);
    check('…and needs the instructor role', routeAccess(r) === 'instructor');
  }
  for (const bad of ['', '/0', '/x', '/1.5']) {
    const b = parseHash(`#/instructor/grading/hw1/student/k1/submission${bad}`);
    check(`'/submission${bad}' falls back to the student's submission page`,
      b.kind === 'instructor-grading-student' && b.id === 'hw1' && b.student === 'k1');
  }
  const own = parseHash('#/a/hw1/submission/2/q/3');
  check("the principal's own submission route is unchanged (no student, signed-in)",
    own.kind === 'assignment' && own.student === undefined && routeAccess(own) === 'signed-in' &&
      routeToHash(own) === '#/a/hw1/submission/2/q/3');
  check('canonicalHash leaves the viewer hash alone', canonicalHash(`${base}/q/3/case/1`) === `${base}/q/3/case/1`);
  // editorRoute: every in-editor navigation keeps whose attempt is on show.
  check('editorRoute keeps the owner and the attempt',
    routeToHash(editorRoute({ assignment: { id: 'hw1' }, viewingSubmission: { attempt: 2 }, viewingOwner: { key } }, 4)!) ===
      `${base}/q/4`);
  check("editorRoute on the principal's own work is the plain route",
    routeToHash(editorRoute({ assignment: { id: 'hw1' }, viewingSubmission: null, viewingOwner: null }, 4)!) === '#/a/hw1/q/4');
}

console.log('[feedback context]');
{
  // A report's context comes from the ROUTE, checked against the assignment
  // actually open (task 076) — never from what the editor store last held:
  // leaving the editor keeps its assignment in memory (store goHome), and the
  // instructor routes never touch the store. `A` plays that stale leftover.
  const A = { id: 'hw1', questions: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const h of ['#/', '#/grades', '#/grades/hw1', '#/sandbox', '#/instructor', '#/instructor/feedback',
    '#/instructor/assignments/hw1/edit', '#/instructor/grading/hw1']) {
    check(`'${h}' with a stale assignment in the store: no context`, feedbackContextFor(parseHash(h), A) === undefined);
  }
  check("the document page '#/a/hw1': the assignment alone",
    same(feedbackContextFor(parseHash('#/a/hw1'), A), { assignmentId: 'hw1' }));
  check("'#/a/hw1/q/2': the assignment and question index 2's id",
    same(feedbackContextFor(parseHash('#/a/hw1/q/2'), A), { assignmentId: 'hw1', questionId: 3 }));
  check("an out-of-range question '#/a/hw1/q/9': the assignment alone",
    same(feedbackContextFor(parseHash('#/a/hw1/q/9'), A), { assignmentId: 'hw1' }));
  check("'#/a/hw2/q/0' while hw1 is still the one open (hw2 opening): no context",
    feedbackContextFor(parseHash('#/a/hw2/q/0'), A) === undefined);
  check("'#/a/hw1/q/1' with nothing open: no context",
    feedbackContextFor(parseHash('#/a/hw1/q/1'), null) === undefined);
  const viewer = feedbackContextFor(parseHash('#/instructor/grading/hw1/student/abc/submission/1/q/0'), A);
  check("the viewer route: the assignment and question, ids only (never the student's key)",
    same(viewer, { assignmentId: 'hw1', questionId: 1 }) && !JSON.stringify(viewer).includes('abc'));

  // Filing: FeedbackPanel files `feedbackFromSession(user, form, context)`
  // through the feedbackStore seam, `user` being useAuth()'s. Driven here with
  // the SIGNED-IN account exactly as LocalAuthProvider restores it
  // (readPersistedAccount off the session key): the toy instructor's
  // Dashboard report takes its author and role from the session, not the form,
  // and carries no context — not even the key.
  const { localFeedbackStore, feedbackFromSession } = await import('../src/storage/feedbackStore');
  const { readPersistedAccount, SESSION_KEY } = await import('../src/auth/accounts');
  backing.delete('mm:feedback');
  backing.set(SESSION_KEY, 'instructor-ada');
  const prof = readPersistedAccount();
  const form = { category: 'platform design' as const, message: '  a report from the Dashboard\n', screenshots: [] };
  const filed = await localFeedbackStore.submit(
    feedbackFromSession(prof!, form, feedbackContextFor(parseHash('#/instructor/feedback'), A)));
  const listed = (await localFeedbackStore.list())[0];
  const raw = JSON.parse(backing.get('mm:feedback') ?? '[]') as Record<string, unknown>[];
  check("local: the signed-in instructor's Dashboard report lists under their email, with the instructor role, trimmed, no context",
    prof?.role === 'instructor' && listed?.id === filed.id && listed.student === prof.email &&
      listed.authorRole === 'instructor' && listed.message === 'a report from the Dashboard' && listed.context === undefined);
  check("local: the stored record has no 'context' key at all",
    raw.length === 1 && raw[0].id === filed.id && !('context' in raw[0]));
  // The same builder for a signed-in student in the editor: the student role,
  // and the route's context.
  backing.set(SESSION_KEY, 'student-jane');
  const stu = readPersistedAccount();
  const fromEditor = feedbackFromSession(stu!, form, feedbackContextFor(parseHash('#/a/hw1/q/2'), A));
  check("a signed-in student's report from '#/a/hw1/q/2': the student role and the route's context",
    stu?.role === 'student' && fromEditor.student === stu.email && fromEditor.authorRole === 'student' &&
      same(fromEditor.context, { assignmentId: 'hw1', questionId: 3 }));
  backing.delete(SESSION_KEY);
  backing.delete('mm:feedback');

  // Source pins: the panel's one filing path; the context from the route.
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const panel = read('components/FeedbackPanel.tsx');
  check("FeedbackPanel reads no editor store (no '../store' import, no useStore)",
    !/from '\.\.\/store'/.test(panel) && !/useStore\b/.test(panel));
  check("FeedbackPanel files feedbackFromSession(user, …) with useAuth()'s user, setting no author or role itself",
    /const \{ user \} = useAuth\(\)/.test(panel) &&
      /feedbackStore\.submit\(feedbackFromSession\(user, /.test(panel) && !/authorRole:/.test(panel));
  check('FeedbackPanel takes its context as a prop and announces a filed report',
    /context\?: FeedbackContext/.test(panel) && /dispatchEvent\(new Event\(FEEDBACK_FILED_EVENT\)\)/.test(panel));
  check('SessionControls derives the context from the route (feedbackContextFor)',
    /feedbackContextFor\(/.test(read('components/SessionControls.tsx')));
  const queue = read('instructor/FeedbackQueueView.tsx');
  check('the Feedback tab opens FeedbackPanel from its New report action, and reloads on a filed report',
    /<FeedbackPanel\b/.test(queue) && /addEventListener\(FEEDBACK_FILED_EVENT/.test(queue));
  // That the Dashboard shell SHOWS Feedback (and the tab New report) is a
  // real render: [dashboard shell], last (it signs the toy instructor in).
}

console.log('[front door]');
check('#/ is Home, which needs sign-in (the sign-in screen for anyone not signed in)',
  parseHash('#/').kind === 'home' && routeAccess(parseHash('#/')) === 'signed-in');
check('no hash at all is Home too', parseHash('').kind === 'home' && routeAccess(parseHash('')) === 'signed-in');
check('#/sandbox is open to a visitor', routeAccess(parseHash('#/sandbox')) === 'public');
{
  // The retired trace: nothing in src reads or writes it any more.
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
  const RETIRED = /mm:auth:known|KNOWN_KEY|markSignedInBefore|hasSignInTrace|landingRoute/;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (RETIRED.test(line)) hits.push(`${relative(SRC, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(SRC);
  check(`the "signed in before" trace is gone from src${hits.length ? ` (${hits.join(', ')})` : ''}`, hits.length === 0);
}

console.log('[held routes]');
// Spy on the store actions routing drives, so nothing real opens.
const opened: string[] = [];
let homes = 0;
function installSpies() {
  useStore.setState({
    openAssignment: async (id: string) => {
      opened.push(id);
      return true;
    },
    goHome: () => {
      homes++;
    },
  });
}
installSpies();
setRoutingPrincipal(null);

// [boot] first: initRouting runs once per page load.
loc.hash = '#/';
initRouting();
check('boot, nobody signed in, #/ → the URL is kept (no redirect)', loc.hash === '#/');
check('boot, nobody signed in, #/ → Home is held (goHome not called)', homes === 0);
check('boot, nobody signed in, #/ → no sandbox opened behind the sign-in screen',
  useStore.getState().workbookOpen === false && useStore.getState().assignment === null);

navigate({ kind: 'assignment', id: 'hw1', questionIndex: 1 });
check('visitor → #/a/hw1/q/1: the URL is kept (for after sign-in)', loc.hash === '#/a/hw1/q/1');
check('visitor → #/a/hw1/q/1: openAssignment NOT called', opened.length === 0);
navigate({ kind: 'home' });
check('visitor → #/: goHome NOT called', homes === 0);
navigate({ kind: 'sandbox' });
check('visitor → #/sandbox: applied (public)', useStore.getState().workbookOpen === true);

navigate({ kind: 'assignment', id: 'hw1' });
setRoutingPrincipal('a@x.test');
check('sign-in releases the held route: openAssignment(hw1)', opened.length === 1 && opened[0] === 'hw1');
setRoutingPrincipal('a@x.test');
check('a second signal for the SAME principal does not re-apply it', opened.length === 1);
navigate({ kind: 'home' });
check('signed in → #/: goHome applied', homes === 1);

setRoutingPrincipal(null);
check('signing out on #/ holds it (goHome not called)', homes === 1);
navigate({ kind: 'grades' });
check('signed out again → #/grades held (goHome not called)', homes === 1);
setRoutingPrincipal('a@x.test');
check('…and applied on the next sign-in', homes === 2);

// Applying a case route, signed in: the question opens (switchQuestion),
// THEN its case loads — by the opened question's id.
console.log('[case route: applied]');
{
  const loads: [number, number][] = [];
  const switched: number[] = [];
  const questions = [0, 1, 2].map((i) => ({ id: 100 + i, label: `Q${i}`, statement: '', buildMode: 'CC', representation: 'binary' }));
  useStore.setState({
    assignment: { id: 'hwc', title: 'case route', questions } as unknown as import('../src/types').AssignmentData,
    currentQuestionIndex: 0,
    switchQuestion: (i: number) => {
      switched.push(i);
      useStore.setState({ currentQuestionIndex: i });
    },
    loadCaseInput: async (qid: number, k: number) => {
      loads.push([qid, k]);
    },
  });
  navigate({ kind: 'assignment', id: 'hwc', questionIndex: 2, caseIndex: 5 });
  await new Promise((r) => setTimeout(r, 0));
  check('a case route opens the question, then loads its case (question id, case index)',
    switched.join() === '2' && loads.length === 1 && loads[0][0] === 102 && loads[0][1] === 5);
  navigate({ kind: 'assignment', id: 'hwc', questionIndex: 2, caseIndex: 1 });
  await new Promise((r) => setTimeout(r, 0));
  check('a case route to the question already open loads without a switch',
    switched.join() === '2' && loads.length === 2 && loads[1][1] === 1);
  navigate({ kind: 'assignment', id: 'hwc', questionIndex: 1 });
  await new Promise((r) => setTimeout(r, 0));
  check('a plain question route loads no case', loads.length === 2);
  useStore.setState({ assignment: null, currentQuestionIndex: 0 });
}

// Applying a submission route, signed in: the attempt is shown (the store's
// viewSubmission) BEFORE the question opens and its case loads; a plain route
// shows the live workbook; an attempt the store doesn't know repairs the URL.
console.log('[submission route: applied]');
{
  const calls: string[] = [];
  const questions = [0, 1, 2].map((i) => ({ id: 200 + i, label: `Q${i}`, statement: '', buildMode: 'CC', representation: 'binary' }));
  // Attempt 7's lookup stays in flight until the check releases it.
  const slow: { release?: (ok: boolean) => void } = {};
  useStore.setState({
    assignment: { id: 'hws', title: 'submission route', questions } as unknown as import('../src/types').AssignmentData,
    currentQuestionIndex: 0,
    viewSubmission: (target: number | null | object) => {
      const attempt = typeof target === 'object' && target !== null ? -1 : target;
      calls.push(`view:${attempt}`);
      if (attempt === 7) return new Promise<boolean>((r) => { slow.release = r; });
      return Promise.resolve(attempt !== 9);
    },
    switchQuestion: (i: number) => {
      calls.push(`switch:${i}`);
      useStore.setState({ currentQuestionIndex: i });
    },
    loadCaseInput: async (qid: number, k: number) => {
      calls.push(`case:${qid}:${k}`);
    },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  navigate({ kind: 'assignment', id: 'hws', attempt: 2, questionIndex: 1, caseIndex: 4 });
  await tick();
  check('an attempt route shows the attempt, THEN opens the question, THEN loads the case',
    calls.join() === 'view:2,switch:1,case:201:4');
  calls.length = 0;
  navigate({ kind: 'assignment', id: 'hws', questionIndex: 2 });
  await tick();
  check('a plain question route asks for the live workbook (viewSubmission(null)) first',
    calls.join() === 'view:null,switch:2');
  calls.length = 0;
  navigate({ kind: 'assignment', id: 'hws', attempt: 9, questionIndex: 1 });
  await tick();
  check('an unknown attempt repairs the URL to the live question route', loc.hash === '#/a/hws/q/1');
  check('…and applies that one (the live workbook, then the question)', calls.join() === 'view:9,view:null,switch:1');
  calls.length = 0;
  navigate({ kind: 'assignment', id: 'hws', attempt: 7, questionIndex: 0 });
  await tick();
  navigate({ kind: 'assignment', id: 'hws', questionIndex: 2 });
  await tick();
  slow.release?.(false);
  await tick();
  check('a superseded apply does nothing (no switch, no URL repair)',
    calls.join() === 'view:7,view:null,switch:2' && loc.hash === '#/a/hws/q/2');
  useStore.setState({ assignment: null, currentQuestionIndex: 0 });
}

// A later part of a multi-part problem (task 048) opens its problem's page:
// the store's own switchQuestion (spied) lands on the first part, and the
// same route applied again — or another part's — is no swap.
console.log('[multi-part route: applied]');
{
  const init = useStore.getInitialState();
  const switched: number[] = [];
  const w = (id: number, label: string, partOf?: number) =>
    ({ id, label, statement: `${label}.`, buildMode: 'open', representation: 'binary', ...(partOf ? { partOf } : {}) });
  const questions = [w(6, 'Problem 6a'), w(18, 'Problem 6b', 6), w(19, 'Problem 6c', 6), w(7, 'Problem 7')];
  useStore.setState({
    assignment: { id: 'hwp', title: 'parts', questions } as unknown as import('../src/types').AssignmentData,
    currentQuestionIndex: 3,
    questionCircuits: new Map(questions.map((q) => [q.id, { components: [], wires: [], boxes: [] }])),
    viewingSubmission: null,
    viewingOwner: null,
    submissions: {},
    // The assignment is open already; the rest are the store's own.
    openAssignment: async () => true,
    viewSubmission: init.viewSubmission,
    loadCaseInput: init.loadCaseInput,
    switchQuestion: (i: number) => {
      switched.push(i);
      init.switchQuestion(i);
    },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  navigate({ kind: 'assignment', id: 'hwp', questionIndex: 1 });
  await tick();
  check("#/a/hwp/q/1 (part b) opens problem 6's page: the first part's index",
    useStore.getState().currentQuestionIndex === 0 && switched.join() === '1' && useStore.getState().assignmentView === 'question');
  navigate({ kind: 'assignment', id: 'hwp', questionIndex: 1 }, { replace: true });
  await tick();
  navigate({ kind: 'assignment', id: 'hwp', questionIndex: 2 }, { replace: true });
  await tick();
  check('re-applying it, or another part\'s route, is stable (no swap)',
    useStore.getState().currentQuestionIndex === 0 && switched.join() === '1');
  navigate({ kind: 'assignment', id: 'hwp', questionIndex: 3 });
  await tick();
  check('…while another problem still switches', useStore.getState().currentQuestionIndex === 3 && switched.join() === '1,3');
  useStore.setState({ assignment: null, currentQuestionIndex: 0 });
}

// Last: these reset the whole store (as the auth provider does), which also
// replaces the spies installed above — so they are re-installed each time.
console.log('[principal change]');
function changePrincipal(email: string | null) {
  // What the app does on a change: the provider resets the store for the new
  // person (synchronously), then AuthGate's effect tells routing.
  useStore.getState().resetForPrincipal(email);
  installSpies();
  setRoutingPrincipal(email);
}
navigate({ kind: 'sandbox' });
check('signed in → #/sandbox: the sandbox is open', useStore.getState().workbookOpen === true);
changePrincipal(null);
check('sign-out on #/sandbox re-enters the (visitor) sandbox, not a blank page',
  useStore.getState().workbookOpen === true && useStore.getState().assignment === null);
changePrincipal('b@x.test');
check('sign-in on #/sandbox re-enters the sandbox (the new person\'s)', useStore.getState().workbookOpen === true);
navigate({ kind: 'assignment', id: 'hw2', questionIndex: 0 });
const openedBefore = opened.length;
check('signed in → #/a/hw2/q/0: openAssignment(hw2)', opened[openedBefore - 1] === 'hw2');
changePrincipal(null);
check('a 401/sign-out on #/a/hw2/q/0 holds it (no open)', opened.length === openedBefore && loc.hash === '#/a/hw2/q/0');
changePrincipal('c@x.test');
check('the next sign-in applies it for the new person: openAssignment(hw2)',
  opened.length === openedBefore + 1 && opened[opened.length - 1] === 'hw2');

// A remote boot with a stored token hands the store to the token's owner
// before me() settles (authProvider.tsx's principal hint) while routing still
// knows nobody. me() confirming them must not re-enter the sandbox over the
// live canvas; me() refusing them resets the store for the visitor while
// routing hears no change at all — the store keeps the sandbox open itself.
console.log('[viewer apply]');
{
  // Applying the viewer route: only an instructor opens another's attempt
  // (store openSubmissionOf); anyone else is sent Home. Any other route
  // leaves the view (leaveForeignView).
  const views: string[] = [];
  let leaves = 0;
  const spyViewer = () =>
    useStore.setState({
      openSubmissionOf: async (id: string, student: string, attempt: number) => {
        views.push(`${id}|${student}|${attempt}`);
        return true;
      },
      leaveForeignView: () => {
        leaves++;
      },
    });
  changePrincipal('stu@x.test');
  spyViewer();
  navigate({ kind: 'assignment', id: 'hw1', student: 'k1', attempt: 2, questionIndex: 0 });
  check('a student applying the viewer route is sent Home, nothing opened', views.length === 0 && loc.hash === '#/');
  backing.set('mm:auth:current', 'instructor-ada');
  navigate({ kind: 'assignment', id: 'hw1', student: 'k1', attempt: 2, questionIndex: 0 });
  await new Promise((r) => setTimeout(r, 10));
  check('an instructor applying it opens that attempt of that student',
    views.join() === 'hw1|k1|2' && loc.hash === '#/instructor/grading/hw1/student/k1/submission/2/q/0');
  useStore.setState({ viewingOwner: { key: 'k1', name: 'K' } });
  navigate({ kind: 'instructor-grading-student', id: 'hw1', student: 'k1' });
  check('another route leaves the view', leaves === 1);
  useStore.setState({ viewingOwner: null });
  backing.delete('mm:auth:current');
}

console.log('[token boot]');
changePrincipal(null);
navigate({ kind: 'sandbox' });
useStore.getState().resetForPrincipal('h@x.test'); // boot: the hint, routing still null
installSpies();
useStore.getState().addComponent('AND', 40, 40);
const liveIds = useStore.getState().components.map((c) => c.id).join();
setRoutingPrincipal('h@x.test'); // me() confirms: the store resets nothing
check('a confirmed token boot keeps the live sandbox canvas (no re-entry over it)',
  useStore.getState().workbookOpen && useStore.getState().components.map((c) => c.id).join() === liveIds && liveIds !== '');
changePrincipal(null);
navigate({ kind: 'sandbox' });
useStore.getState().resetForPrincipal('h2@x.test'); // boot: the hint, routing still null
installSpies();
useStore.getState().resetForPrincipal(null); // me() refuses: routing is not told (null → null)
check('a refused token boot on #/sandbox still shows a sandbox (the visitor\'s)',
  useStore.getState().workbookOpen === true && useStore.getState().assignment === null);

console.log('[dashboard shell]');
{
  // A REAL render (react-dom/server) of the Dashboard shell for the signed-in
  // toy instructor, through the real LocalAuthProvider: every Dashboard tab
  // shows the topbar Feedback button (task 076 — no role gate anywhere between
  // the shell and the button), and the Feedback tab its New report action.
  // Last in this tool: the provider signs the instructor in (store
  // resetForPrincipal). tsx compiles .tsx with the classic JSX transform
  // (tsconfig.json sets no `jsx`), so the components need a global React.
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AuthProvider } = await import('../src/auth');
  const { InstructorLayout } = await import('../src/instructor/InstructorLayout');
  const { FeedbackQueueView } = await import('../src/instructor/FeedbackQueueView');
  const { SESSION_KEY } = await import('../src/auth/accounts');
  g.React = React;
  backing.set(SESSION_KEY, 'instructor-ada');
  const shell = (hash: string, body: ReturnType<typeof React.createElement>) => {
    const route = parseHash(hash);
    if (!route.kind.startsWith('instructor')) return '';
    return renderToStaticMarkup(React.createElement(AuthProvider, {
      children: React.createElement(InstructorLayout, { route: route as Parameters<typeof InstructorLayout>[0]['route'], children: body }),
    }));
  };
  const session = (html: string) => /<div class="session">(.*?)<\/div>/.exec(html)?.[1] ?? '';
  for (const h of ['#/instructor', '#/instructor/grading', '#/instructor/grading/hw1', '#/instructor/roster',
    '#/instructor/feedback', '#/instructor/notes', '#/instructor/robot']) {
    const s = session(shell(h, React.createElement('p', null, 'tab')));
    check(`'${h}': the Dashboard shell's topbar shows the instructor a Feedback button`,
      /Prof\. Ada · Instructor/.test(s) && /<button type="button">Feedback<\/button>/.test(s));
  }
  // The Robot tab (task 083) closes the tab row, current on its own route;
  // before any answer (a static render runs no effect) there is no strip.
  const robotShell = shell('#/instructor/robot', React.createElement('p', null, 'tab'));
  check('the tab row ends Notes · Robot, Robot current on #/instructor/robot',
    /data-text="Notes"[^]*data-text="Robot"/.test(robotShell) &&
      /class="mm-tab mm-tab--active" aria-current="page" data-text="Robot" href="#\/instructor\/robot"/.test(robotShell));
  check('…and no robot strip before an answer', !/robot-strip/.test(robotShell));
  // The Robot tab itself over a synthetic answer (the layout's fetch is an
  // effect, which a static render never runs, so the answer is provided).
  const { RobotView } = await import('../src/instructor/RobotView');
  const { RobotStatusContext } = await import('../src/instructor/useRobotStatus');
  const answer: RobotStatus = {
    available: true,
    asOf: '2026-09-28T17:00:00.000Z',
    stale: null,
    live: { ok: true, sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'Merge robot/080-x: y', releasedAt: '2026-09-28T14:00:00.000Z', releasedAtSource: 'reflog', lastLanded: { id: '2026-09-27-080', title: 'The last one' } },
    release: {
      ok: true, head: 'b'.repeat(40), verdict: 'hold', line: 'held: the database schema and its migrations',
      reasons: [{ verdict: 'hold', brief: 'the database schema and its migrations', detail: 'the database schema and its migrations: server/src/db.ts' }],
      rows: [{ id: '2026-09-28-099', title: 'A test task', landedAt: '2026-09-28T16:00:00.000Z' }],
    },
    answers: { ok: true, tasks: [{ id: '2026-09-28-100', title: 'A student report', question: 'Work this student-reported fix? (yes / no)', studentFix: true }] },
    review: { ok: true, items: [{ id: 'fb-1', category: 'homework content' }] },
    activity: { ok: false, unknown: 'cannot read GitHub main\'s history: timed out' },
  };
  const robotTab = (value: RobotStatus | undefined, error: Error | null = null) =>
    shell('#/instructor/robot', React.createElement(RobotStatusContext.Provider, {
      value: { value, loading: false, error, refresh: () => {} },
      children: React.createElement(RobotView),
    }));
  const tabHtml = robotTab(answer);
  check('the Robot tab renders its four sections and Refresh',
    ['Live', 'Waiting for release', 'Waiting for your answer', 'Recent queue activity'].every((h) => tabHtml.includes(`<h2>${h}</h2>`)) &&
      /<button class="mm-btn">Refresh<\/button>/.test(tabHtml));
  check('…the verdict line, the waiting task, the student-fix tag',
    tabHtml.includes('held: the database schema and its migrations') && tabHtml.includes('2026-09-28-099') && tabHtml.includes('student fix'));
  check('…a review mark as its id and category, linking to the Feedback tab',
    /href="#\/instructor\/feedback"[^>]*><span class="mono robot-id mm-row-title">fb-1<\/span><span class="tag tag--ok">homework content<\/span>/.test(tabHtml));
  check('…and an unreadable section as one "Unknown:" line', tabHtml.includes('Unknown: cannot read GitHub main'));
  check('local mode: the tab says "Not available in local mode"', robotTab({ available: false, reason: 'Not available in local mode' }).includes('Not available in local mode'));
  const failed = robotTab(answer, new Error('Failed to fetch'));
  check('a failed refresh keeps the last answer beside a one-line error',
    failed.includes('Couldn’t refresh (Failed to fetch) — showing the last answer.') && failed.includes('<h2>Live</h2>'));
  check('a failed first load shows the error line and Refresh, no sections',
    /Couldn’t read the robot’s state: Failed to fetch/.test(robotTab(undefined, new Error('Failed to fetch'))) &&
      !robotTab(undefined, new Error('Failed to fetch')).includes('<h2>Live</h2>'));
  const tab = shell('#/instructor/feedback', React.createElement(FeedbackQueueView));
  check('the Feedback tab renders its New report action beside the filter',
    /<select class="mm-input">.*?<\/select><button class="mm-btn">New report<\/button>/.test(tab));
  backing.delete(SESSION_KEY);
  delete g.React;
}

console.log(failures === 0 ? '\nAll routing checks passed.' : `\n${failures} routing check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
