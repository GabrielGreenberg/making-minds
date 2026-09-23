// Headless checks for route-level access and the visitor landing rule
// (src/routing.ts — task 027, visitor mode).
//
//   cd app && npx tsx tools/routingCheck.ts
//
// Pins: [routeAccess] — the sandbox is the one public route; the student
// routes need sign-in; every instructor route needs the instructor role (and
// every Route kind is classified). [landing] — a browser with no trace of a
// previous sign-in opening `#/` lands in the sandbox; one with a trace, or
// any deep link, is left alone. [held routes] — with nobody signed in, a
// route that needs sign-in is never applied to the store (no unauthenticated
// openAssignment), a public one is; signing in applies the held route (the
// deep-link-survives-sign-in guarantee). [boot] — initRouting applies the
// landing rule by replacing the URL, then opens the sandbox.

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

const { routeAccess, landingRoute, initRouting, setRoutingSignedIn, parseHash, navigate } = await import('../src/routing');
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

console.log('[landing]');
check('no trace + #/ → the sandbox', landingRoute(parseHash('#/'), false)?.kind === 'sandbox');
check('no trace + empty hash → the sandbox', landingRoute(parseHash(''), false)?.kind === 'sandbox');
check('a trace + #/ → left alone (restore or sign in)', landingRoute(parseHash('#/'), true) === null);
check('no trace + a deep link #/a/hw1 → left alone', landingRoute(parseHash('#/a/hw1'), false) === null);
check('no trace + #/grades → left alone', landingRoute(parseHash('#/grades'), false) === null);
check('no trace + #/instructor → left alone', landingRoute(parseHash('#/instructor'), false) === null);

console.log('[held routes]');
// Spy on the store actions routing drives, so nothing real opens.
const opened: string[] = [];
let homes = 0;
useStore.setState({
  openAssignment: async (id: string) => {
    opened.push(id);
    return true;
  },
  goHome: () => {
    homes++;
  },
});
setRoutingSignedIn(false);

// [boot] first: initRouting runs once per page load.
loc.hash = '#/';
initRouting({ hasSignInTrace: false });
check('boot, no trace, #/ → the URL is replaced with #/sandbox', loc.hash === '#/sandbox');
check('boot, no trace, #/ → the sandbox is open', useStore.getState().workbookOpen === true && useStore.getState().assignment === null);
check('boot → Home was never applied', homes === 0);

navigate({ kind: 'assignment', id: 'hw1', questionIndex: 1 });
check('visitor → #/a/hw1/q/1: the URL is kept (for after sign-in)', loc.hash === '#/a/hw1/q/1');
check('visitor → #/a/hw1/q/1: openAssignment NOT called', opened.length === 0);
navigate({ kind: 'home' });
check('visitor → #/: goHome NOT called', homes === 0);
navigate({ kind: 'sandbox' });
check('visitor → #/sandbox: applied (public)', useStore.getState().workbookOpen === true);

navigate({ kind: 'assignment', id: 'hw1' });
setRoutingSignedIn(true);
check('sign-in releases the held route: openAssignment(hw1)', opened.length === 1 && opened[0] === 'hw1');
setRoutingSignedIn(true);
check('a second sign-in signal does not re-apply it', opened.length === 1);
navigate({ kind: 'home' });
check('signed in → #/: goHome applied', homes === 1);

setRoutingSignedIn(false);
navigate({ kind: 'grades' });
check('signed out again → #/grades held (goHome not called)', homes === 1);
setRoutingSignedIn(true);
check('…and applied on the next sign-in', homes === 2);

console.log(failures === 0 ? '\nAll routing checks passed.' : `\n${failures} routing check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
