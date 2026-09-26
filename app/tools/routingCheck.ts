// Headless checks for route-level access and the one front door
// (src/routing.ts — task 027, visitor mode; task 040, the front door).
//
//   cd app && npx tsx tools/routingCheck.ts
//
// Pins: [routeAccess] — the sandbox is the one public route; the student
// routes need sign-in; every instructor route needs the instructor role (and
// every Route kind is classified). [case route] — `#/a/:id/q/:i/case/:k`
// ("Run this input") parses and round-trips, a malformed case segment is
// dropped (the question kept), and applying it loads case k of question i
// into the run after the question opens. [submission route] —
// `#/a/:id/submission/:n[/q/:i[/case/:k]]` (a submitted attempt shown
// read-only, task 003) parses and round-trips, a malformed attempt is dropped
// (the rest kept), and applying it shows the attempt (store viewSubmission)
// BEFORE the question opens; an unknown attempt repairs the URL to the live
// route; a superseded apply does nothing. [front door] — the bare site (`#/`,
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

const { routeAccess, initRouting, setRoutingPrincipal, parseHash, routeToHash, navigate } = await import('../src/routing');
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
  { kind: 'instructor-submissions', id: 'hw1' },
  { kind: 'instructor-roster' },
  { kind: 'instructor-feedback' },
  { kind: 'instructor-notes' },
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
    viewSubmission: (attempt: number | null) => {
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

console.log(failures === 0 ? '\nAll routing checks passed.' : `\n${failures} routing check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
