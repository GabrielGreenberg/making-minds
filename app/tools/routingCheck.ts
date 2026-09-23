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
// landing rule by replacing the URL, then opens the sandbox. [principal
// change] — every change of who is signed in re-applies the URL onto the
// store the auth provider has just reset (store.resetForPrincipal): the
// sandbox is re-entered (never a blank page), a signed-in route is held on
// sign-out and applied on the next sign-in.

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

const { routeAccess, landingRoute, initRouting, setRoutingPrincipal, parseHash, navigate } = await import('../src/routing');
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
