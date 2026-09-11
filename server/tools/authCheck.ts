// Account-system check (`npm run check`, beside serverCheck + parityCheck).
//
// Two halves:
//   [unit]  the pure pieces — CSV roster parsing, password hashing/policy, the
//           providers' decision tables against an in-memory database.
//   [http]  the real Express app on an ephemeral port in PASSWORD mode, driven
//           end to end: roster import → a student creates an account → signs in
//           → session survives → changes their password → an off-roster person
//           files an access request → the instructor approves it → that person
//           can now register. Plus the refusals: off-roster registration,
//           double registration, wrong password, wrong student ID, throttling,
//           student-role access to instructor roster routes.
//
// Exits non-zero on the first failed assertion (like every other tool here).

import { createApp } from '../src/app';
import { Db } from '../src/db';
import type { ServerConfig } from '../src/config';
import { parseRoster, parseCsv, normalizeEmail, isEmail } from '../src/roster';
import { hashPassword, verifyPassword, passwordProblem, PASSWORD_MIN_LENGTH } from '../src/password';
import { PasswordAuthProvider, DevAuthProvider, SsoAuthProvider, createAuthProvider, LoginThrottle } from '../src/auth';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
function section(name: string) {
  console.log(`\n${name}`);
}

// ═══ [unit] CSV roster parsing ═══════════════════════════════════
section('[roster parsing]');

const plain = parseRoster('Email,Name,Student ID\nAda@UCLA.edu,Ada Lovelace,004123456\n');
check('header-driven columns', plain.entries.length === 1);
check('email lowercased + trimmed', plain.entries[0]?.email === 'ada@ucla.edu');
check('name read', plain.entries[0]?.name === 'Ada Lovelace');
check('student id read', plain.entries[0]?.studentId === '004123456');
check('default role is student', plain.entries[0]?.role === 'student');
check(
  'recognised columns reported',
  plain.columns.email === 'Email' && plain.columns.studentId === 'Student ID',
);

const quoted = parseCsv('a,"b,c","he said ""hi"""\r\nd,e,f\r\n');
check('quoted commas', quoted[0]?.[1] === 'b,c');
check('escaped quotes', quoted[0]?.[2] === 'he said "hi"');
check('CRLF rows', quoted.length === 2 && quoted[1]?.[0] === 'd');
check('BOM stripped', parseCsv('﻿Email\nx@y.edu\n')[0]?.[0] === 'Email');

const split = parseRoster('Last Name,First Name,Email Address,UID\nHopper,Grace,grace@ucla.edu,987\n');
check('first+last name columns joined', split.entries[0]?.name === 'Grace Hopper');
check('"Email Address" found', split.entries[0]?.email === 'grace@ucla.edu');
check('"UID" read as the student id', split.entries[0]?.studentId === '987');

const messy = parseRoster(
  [
    'Email,Name',
    'ok@ucla.edu,Fine',
    ',No Email',
    'not-an-email,Bad',
    'OK@ucla.edu,Duplicate',
    '',
    'second@ucla.edu,Also Fine',
  ].join('\n'),
);
check('valid rows kept', messy.entries.length === 2);
check('blank lines skipped silently', messy.issues.every((i) => i.reason !== ''));
check('missing email reported', messy.issues.some((i) => i.reason.includes('no email address')));
check('invalid email reported', messy.issues.some((i) => i.reason.includes('not a valid email')));
check(
  'case-insensitive duplicate reported, first kept',
  messy.issues.some((i) => i.reason.includes('duplicate')) && messy.entries[0]?.name === 'Fine',
);
check('issue line numbers are 1-based incl. header', messy.issues[0]?.line === 3);

const roles = parseRoster('Email,Name,Role\na@ucla.edu,A,instructor\nb@ucla.edu,B,student\nc@ucla.edu,C,\n');
check('role column honoured', roles.entries[0]?.role === 'instructor' && roles.entries[1]?.role === 'student');
check('blank role falls back to the default', roles.entries[2]?.role === 'student');
check(
  'defaultRole applies to a role-less CSV',
  parseRoster('Email\nta@ucla.edu\n', 'instructor').entries[0]?.role === 'instructor',
);
check(
  'nameless row gets the email local part',
  parseRoster('Email\nsolo@ucla.edu\n').entries[0]?.name === 'solo',
);
check('no email column is a reported failure, not a crash', parseRoster('Name\nX\n').issues[0].reason.includes('no email column'));
check('empty file reported', parseRoster('').issues[0]?.reason.includes('empty'));
check('normalizeEmail trims + lowercases', normalizeEmail('  A@B.EDU ') === 'a@b.edu');
check('isEmail rejects garbage', !isEmail('nope') && isEmail('x@y.edu'));

// ═══ [unit] passwords ════════════════════════════════════════════
section('[passwords]');

const hash = hashPassword('correct horse battery');
check('hash is self-describing scrypt', hash.startsWith('scrypt$'));
check('salted: same password hashes differently', hashPassword('correct horse battery') !== hash);
check('correct password verifies', verifyPassword('correct horse battery', hash));
check('wrong password rejected', !verifyPassword('correct horse batterY', hash));
check('null credential rejects everything', !verifyPassword('anything', null));
check('malformed credential rejects', !verifyPassword('x', 'not-a-hash'));
check('truncated credential rejects', !verifyPassword('x', 'scrypt$16384$8$1$abc'));
check('short password refused', passwordProblem('short') !== null);
check(`min length is ${PASSWORD_MIN_LENGTH}`, passwordProblem('a'.repeat(PASSWORD_MIN_LENGTH)) === null);
check('empty password refused', passwordProblem('') !== null);
check('whitespace-only password refused', passwordProblem('          ') !== null);
check('over-long password refused', passwordProblem('a'.repeat(500)) !== null);
check('non-string password refused', passwordProblem(undefined) !== null);

// ═══ [unit] providers ════════════════════════════════════════════
section('[providers]');

const unitDb = new Db(':memory:');
unitDb.upsertUser({ email: 'stu@ucla.edu', name: 'Stu', role: 'student', studentId: '004123456' });
unitDb.upsertUser({ email: 'noid@ucla.edu', name: 'No Id', role: 'student' });
const pw = new PasswordAuthProvider(unitDb);

check('capabilities: password mode offers registration + requests', (() => {
  const c = pw.capabilities();
  return c.mode === 'password' && c.usesPassword && c.allowsRegistration && c.allowsAccessRequests;
})());

check('unregistered roster member cannot sign in', (await pw.authenticate({ email: 'stu@ucla.edu', password: 'whatever1' })) === null);

const offRoster = await pw.register({ email: 'nobody@ucla.edu', password: 'goodpassword' });
check('off-roster registration refused', !offRoster.ok && offRoster.reason === 'not-on-roster');

const badId = await pw.register({ email: 'stu@ucla.edu', password: 'goodpassword', studentId: '999' });
check('wrong student id refused', !badId.ok && badId.reason === 'id-mismatch');

const weak = await pw.register({ email: 'stu@ucla.edu', password: 'abc', studentId: '004123456' });
check('weak password refused', !weak.ok && weak.reason === 'weak-password');

const ok = await pw.register({ email: 'STU@ucla.edu ', password: 'goodpassword', studentId: '4123456' });
check('registration succeeds (email normalized, id compared without leading zeros)', ok.ok);
check('registered flag set on the identity', ok.ok && ok.user.registered === true);

const twice = await pw.register({ email: 'stu@ucla.edu', password: 'otherpassword', studentId: '004123456' });
check('second registration refused', !twice.ok && twice.reason === 'already-registered');

check('correct password authenticates', (await pw.authenticate({ email: 'stu@ucla.edu', password: 'goodpassword' }))?.email === 'stu@ucla.edu');
check('wrong password rejected', (await pw.authenticate({ email: 'stu@ucla.edu', password: 'Goodpassword' })) === null);
check('missing password rejected', (await pw.authenticate({ email: 'stu@ucla.edu' })) === null);
check('unknown email rejected', (await pw.authenticate({ email: 'ghost@ucla.edu', password: 'goodpassword' })) === null);

const noIdReg = await pw.register({ email: 'noid@ucla.edu', password: 'goodpassword' });
check('no roster id ⇒ no id required', noIdReg.ok);

unitDb.setPasswordHash('stu@ucla.edu', null);
check('cleared credential blocks sign-in again', (await pw.authenticate({ email: 'stu@ucla.edu', password: 'goodpassword' })) === null);
check('cleared credential re-opens registration', (await pw.register({ email: 'stu@ucla.edu', password: 'anotherpassword', studentId: '004123456' })).ok);

const dev = new DevAuthProvider(unitDb);
check('dev provider: passwordless login by roster email', (await dev.authenticate({ email: 'noid@ucla.edu' }))?.role === 'student');
check('dev provider: unknown email still rejected', (await dev.authenticate({ email: 'ghost@ucla.edu' })) === null);
check('dev provider advertises no password/registration', (() => {
  const c = dev.capabilities();
  return !c.usesPassword && !c.allowsRegistration && !c.allowsAccessRequests;
})());
check('dev provider refuses registration', !(await dev.register()).ok);

const sso = new SsoAuthProvider(unitDb, 'https://sso.ucla.edu/login');
check('sso capabilities carry the login url + hide the password form', (() => {
  const c = sso.capabilities();
  return c.mode === 'sso' && !c.usesPassword && c.ssoLoginUrl === 'https://sso.ucla.edu/login';
})());
check('sso role comes from the roster', sso.roleFor('noid@ucla.edu') === 'student');
check('sso authenticate is an honest not-implemented', await sso.authenticate({}).then(() => false, () => true));

const base: ServerConfig = { port: 0, dbPath: ':memory:', corsOrigins: [], authMode: 'password', sessionTtlSeconds: 3600 };
check('factory: password mode', createAuthProvider(base, unitDb).capabilities().mode === 'password');
check('factory: dev mode', createAuthProvider({ ...base, authMode: 'dev' }, unitDb).capabilities().mode === 'dev');
check('factory: sso mode', createAuthProvider({ ...base, authMode: 'sso' }, unitDb).capabilities().mode === 'sso');

const throttle = new LoginThrottle(3, 60_000);
check('throttle is open initially', throttle.retryAfter('a@b.edu', '1.1.1.1') === 0);
throttle.recordFailure('a@b.edu', '1.1.1.1');
throttle.recordFailure('a@b.edu', '1.1.1.1');
check('under the limit stays open', throttle.retryAfter('a@b.edu', '1.1.1.1') === 0);
throttle.recordFailure('a@b.edu', '1.1.1.1');
check('at the limit closes', throttle.retryAfter('a@b.edu', '1.1.1.1') > 0);
check('another IP is unaffected (no lockout by proxy)', throttle.retryAfter('a@b.edu', '2.2.2.2') === 0);
check('another email is unaffected', throttle.retryAfter('z@b.edu', '1.1.1.1') === 0);
throttle.recordSuccess('a@b.edu', '1.1.1.1');
check('a success clears the counter', throttle.retryAfter('a@b.edu', '1.1.1.1') === 0);

unitDb.close();

// ═══ [http] the real server in password mode ═════════════════════
section('[http: account lifecycle]');

const config: ServerConfig = {
  port: 0,
  dbPath: ':memory:',
  corsOrigins: [],
  authMode: 'password',
  sessionTtlSeconds: 3600,
};
const db = new Db(config.dbPath);
db.upsertUser({ email: 'prof@ucla.edu', name: 'Prof', role: 'instructor' });
db.setPasswordHash('prof@ucla.edu', hashPassword('instructorpass'));

const app = createApp(config, db);
const server = app.listen(0);
await new Promise<void>((resolve) => server.on('listening', resolve));
const address = server.address();
const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;

async function api<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(url + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

const caps = await api<{ mode: string; usesPassword: boolean; allowsRegistration: boolean; passwordMinLength: number }>('GET', '/auth/config');
check('auth config is unauthenticated', caps.status === 200);
check('auth config reports password mode', caps.json.mode === 'password' && caps.json.usesPassword);
check('auth config carries the min length', caps.json.passwordMinLength === PASSWORD_MIN_LENGTH);

const profLogin = await api<{ token: string; user: { role: string } }>('POST', '/auth/login', {
  body: { email: 'prof@ucla.edu', password: 'instructorpass' },
});
check('instructor signs in', profLogin.status === 200 && profLogin.json.user.role === 'instructor');
const profToken = profLogin.json.token;

const CSV = 'Email,Name,Student ID\nrosa@ucla.edu,Rosa Luxemburg,004000111\nkurt@ucla.edu,Kurt Gödel,004000222\nbroken,Bad Row,0\n';
const importRes = await api<{ added: number; updated: number; issues: { line: number }[] }>('POST', '/roster/import', {
  token: profToken,
  body: { csv: CSV },
});
check('roster import adds the good rows', importRes.status === 200 && importRes.json.added === 2);
check('roster import reports the bad row', importRes.json.issues.length === 1);

const reimport = await api<{ added: number; updated: number }>('POST', '/roster/import', {
  token: profToken,
  body: { csv: CSV },
});
check('re-import updates rather than duplicates', reimport.json.added === 0 && reimport.json.updated === 2);

const preLogin = await api('POST', '/auth/login', { body: { email: 'rosa@ucla.edu', password: 'anything1' } });
check('roster member with no account cannot sign in', preLogin.status === 401);

const noRosterReg = await api<{ reason: string }>('POST', '/auth/register', {
  body: { email: 'stranger@gmail.com', password: 'longenough1', studentId: '1' },
});
check('off-roster registration is 403', noRosterReg.status === 403 && noRosterReg.json.reason === 'not-on-roster');

const wrongId = await api<{ reason: string }>('POST', '/auth/register', {
  body: { email: 'rosa@ucla.edu', password: 'longenough1', studentId: '000999' },
});
check('registration with the wrong student id is refused', wrongId.status === 409 && wrongId.json.reason === 'id-mismatch');

const reg = await api<{ token: string; user: { email: string; name: string; role: string } }>('POST', '/auth/register', {
  body: { email: 'rosa@ucla.edu', password: 'longenough1', studentId: '004000111' },
});
check('registration succeeds for a roster member', reg.status === 200);
check('registration signs you straight in', typeof reg.json.token === 'string' && reg.json.token.length > 0);
check('identity comes from the roster, not the form', reg.json.user.name === 'Rosa Luxemburg' && reg.json.user.role === 'student');
const rosaToken = reg.json.token;

const weakOverHttp = await api<{ reason: string }>('POST', '/auth/register', {
  body: { email: 'kurt@ucla.edu', password: 'short', studentId: '004000222' },
});
check('a too-short password is a 400', weakOverHttp.status === 400 && weakOverHttp.json.reason === 'weak-password');

const dup = await api<{ reason: string }>('POST', '/auth/register', {
  body: { email: 'rosa@ucla.edu', password: 'differentpass', studentId: '004000111' },
});
check('re-registration is refused (no password overwrite)', dup.status === 409 && dup.json.reason === 'already-registered');

const me = await api<{ user: { email: string } }>('GET', '/auth/me', { token: rosaToken });
check('session restores the identity', me.status === 200 && me.json.user.email === 'rosa@ucla.edu');

const wrongPass = await api<{ error: string }>('POST', '/auth/login', { body: { email: 'rosa@ucla.edu', password: 'longenough2' } });
check('wrong password is 401', wrongPass.status === 401);
const unknownEmail = await api<{ error: string }>('POST', '/auth/login', { body: { email: 'ghost@ucla.edu', password: 'longenough1' } });
check(
  'unknown email and wrong password are indistinguishable (no roster enumeration)',
  unknownEmail.json.error === wrongPass.json.error,
);

const rosaLogin = await api<{ token: string }>('POST', '/auth/login', { body: { email: 'ROSA@ucla.edu', password: 'longenough1' } });
check('sign-in works, email case-insensitively', rosaLogin.status === 200);

section('[http: password change]');

const badChange = await api('POST', '/auth/password', {
  token: rosaToken,
  body: { currentPassword: 'wrong', newPassword: 'brandnewpass' },
});
check('password change needs the current password', badChange.status === 403);

const shortChange = await api('POST', '/auth/password', {
  token: rosaToken,
  body: { currentPassword: 'longenough1', newPassword: 'short' },
});
check('password change enforces the policy', shortChange.status === 400);

const changed = await api<{ token: string }>('POST', '/auth/password', {
  token: rosaToken,
  body: { currentPassword: 'longenough1', newPassword: 'brandnewpass' },
});
check('password change succeeds', changed.status === 200);
check('the changing device is re-issued a session', typeof changed.json.token === 'string');
check(
  'old sessions are ended',
  (await api('GET', '/auth/me', { token: rosaLogin.json.token })).status === 401,
);
check('the new session works', (await api('GET', '/auth/me', { token: changed.json.token })).status === 200);
check('old password no longer signs in', (await api('POST', '/auth/login', { body: { email: 'rosa@ucla.edu', password: 'longenough1' } })).status === 401);
const reLogin = await api<{ token: string }>('POST', '/auth/login', { body: { email: 'rosa@ucla.edu', password: 'brandnewpass' } });
check('new password signs in', reLogin.status === 200);
// Every later student-perspective assertion uses THIS token: the two above
// were deliberately invalidated by the password change.
const studentToken = reLogin.json.token;

section('[http: access requests]');

const req1 = await api('POST', '/auth/access-requests', {
  body: { email: 'transfer@g.ucla.edu', name: 'Late Addition', studentId: '004000333', message: 'I enrolled in week 2.' },
});
check('anyone may file an access request', req1.status === 200);

await api('POST', '/auth/access-requests', { body: { email: 'transfer@g.ucla.edu', name: 'Late Addition' } });
const pending = await api<{ requests: { id: number; email: string; status: string }[] }>('GET', '/access-requests?status=pending', { token: profToken });
check('the instructor sees the request', pending.status === 200 && pending.json.requests.length === 1);
check('a repeat request does not duplicate', pending.json.requests.filter((r) => r.email === 'transfer@g.ucla.edu').length === 1);

const onRoster = await api('POST', '/auth/access-requests', { body: { email: 'rosa@ucla.edu', name: 'Rosa' } });
check('a request for a roster email answers ok but records nothing', onRoster.status === 200);
check(
  'no request stored for a roster email (endpoint reveals nothing)',
  (await api<{ requests: unknown[] }>('GET', '/access-requests?status=pending', { token: profToken })).json.requests.length === 1,
);

check('a nameless request is refused', (await api('POST', '/auth/access-requests', { body: { email: 'x@ucla.edu' } })).status === 400);
check('a malformed email is refused', (await api('POST', '/auth/access-requests', { body: { email: 'nope', name: 'N' } })).status === 400);

const requestId = pending.json.requests[0].id;
check('students cannot read access requests', (await api('GET', '/access-requests', { token: studentToken })).status === 403);
check('students cannot approve one', (await api('POST', `/access-requests/${requestId}/approve`, { token: studentToken })).status === 403);
check('approving an unknown request is 404', (await api('POST', '/access-requests/9999/approve', { token: profToken })).status === 404);

const approve = await api<{ email: string }>('POST', `/access-requests/${requestId}/approve`, { token: profToken });
check('the instructor approves it', approve.status === 200 && approve.json.email === 'transfer@g.ucla.edu');
check(
  'approval resolves the request',
  (await api<{ requests: unknown[] }>('GET', '/access-requests?status=pending', { token: profToken })).json.requests.length === 0,
);

const transferReg = await api<{ user: { name: string } }>('POST', '/auth/register', {
  body: { email: 'transfer@g.ucla.edu', password: 'transferpass', studentId: '004000333' },
});
check('the approved person can now create an account', transferReg.status === 200);
check('their roster row came from the request', transferReg.json.user.name === 'Late Addition');

const req2 = await api('POST', '/auth/access-requests', { body: { email: 'rejectme@ucla.edu', name: 'Nope' } });
check('a second request is filed', req2.status === 200);
const pending2 = await api<{ requests: { id: number }[] }>('GET', '/access-requests?status=pending', { token: profToken });
const rejectRes = await api('POST', `/access-requests/${pending2.json.requests[0].id}/reject`, { token: profToken });
check('the instructor rejects it', rejectRes.status === 200);
check(
  'a rejected request adds nobody to the roster',
  (await api<{ reason: string }>('POST', '/auth/register', { body: { email: 'rejectme@ucla.edu', password: 'longenough1' } })).status === 403,
);

section('[http: roster administration]');

check('students cannot read the roster', (await api('GET', '/roster', { token: studentToken })).status === 403);
check('students cannot import a roster', (await api('POST', '/roster/import', { token: studentToken, body: { csv: CSV } })).status === 403);
check('an anonymous caller cannot read the roster', (await api('GET', '/roster')).status === 401);

const roster = await api<{ roster: { email: string; registered: boolean; studentId: string }[] }>('GET', '/roster', { token: profToken });
check('the instructor reads the roster', roster.status === 200);
check(
  'account state is visible per row',
  roster.json.roster.find((r) => r.email === 'rosa@ucla.edu')?.registered === true &&
    roster.json.roster.find((r) => r.email === 'kurt@ucla.edu')?.registered === false,
);
check('no password material is ever sent', JSON.stringify(roster.json).includes('scrypt') === false);

const addOne = await api('POST', '/roster', { token: profToken, body: { email: 'ta@ucla.edu', name: 'A TA', role: 'instructor' } });
check('the instructor adds one person', addOne.status === 200);
check('a malformed email is refused', (await api('POST', '/roster', { token: profToken, body: { email: 'bad' } })).status === 400);

const resetTarget = 'rosa@ucla.edu';
const reset = await api('POST', `/roster/${encodeURIComponent(resetTarget)}/reset-password`, { token: profToken });
check('the instructor resets a forgotten password', reset.status === 200);
check('the reset ends their sessions', (await api('GET', '/auth/me', { token: changed.json.token })).status === 401);
check('the old password no longer works', (await api('POST', '/auth/login', { body: { email: resetTarget, password: 'brandnewpass' } })).status === 401);
const reReg = await api('POST', '/auth/register', { body: { email: resetTarget, password: 'freshpassword', studentId: '004000111' } });
check('they can create their account again', reReg.status === 200);
check('resetting an unknown account is 404', (await api('POST', '/roster/ghost%40ucla.edu/reset-password', { token: profToken })).status === 404);

db.addSubmission(
  'some-assignment',
  'kurt@ucla.edu',
  { assignmentTitle: 'Some Assignment', student: 'kurt@ucla.edu', answers: [], submittedAt: new Date().toISOString() },
  undefined,
);
const removed = await api('DELETE', '/roster/kurt%40ucla.edu', { token: profToken });
check('the instructor removes someone from the roster', removed.status === 200);
check('their submitted work survives the removal', db.listSubmissions('some-assignment').length === 1);
check('a removed person cannot register', (await api('POST', '/auth/register', { token: undefined, body: { email: 'kurt@ucla.edu', password: 'longenough1' } })).status === 403);
check('the instructor cannot remove themselves', (await api('DELETE', '/roster/prof%40ucla.edu', { token: profToken })).status === 400);

section('[http: throttling]');

const target = 'ta@ucla.edu';
db.upsertUser({ email: target, name: 'A TA', role: 'instructor' });
let sawThrottle = false;
for (let i = 0; i < 12; i++) {
  const r = await api('POST', '/auth/login', { body: { email: target, password: `wrong${i}` } });
  if (r.status === 429) {
    sawThrottle = true;
    break;
  }
}
check('repeated wrong passwords are throttled', sawThrottle);
check(
  'a different email is unaffected by the throttle',
  (await api('POST', '/auth/login', { body: { email: 'prof@ucla.edu', password: 'instructorpass' } })).status === 200,
);

section('[http: dev mode is still a separate world]');

const devConfig: ServerConfig = { ...config, authMode: 'dev' };
const devDb = new Db(':memory:');
devDb.upsertUser({ email: 'dev@ucla.edu', name: 'Dev', role: 'student' });
const devApp = createApp(devConfig, devDb);
const devServer = devApp.listen(0);
await new Promise<void>((resolve) => devServer.on('listening', resolve));
const devAddr = devServer.address();
const devUrl = `http://127.0.0.1:${typeof devAddr === 'object' && devAddr ? devAddr.port : 0}/api`;
const devPost = async (path: string, body: unknown) => {
  const res = await fetch(devUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};
const devCaps = (await (await fetch(`${devUrl}/auth/config`)).json()) as {
  mode: string;
  allowsRegistration: boolean;
};
check('dev mode advertises no registration', devCaps.mode === 'dev' && devCaps.allowsRegistration === false);
check('dev mode logs in passwordless', (await devPost('/auth/login', { email: 'dev@ucla.edu' })).status === 200);
check('dev mode refuses registration', (await devPost('/auth/register', { email: 'dev@ucla.edu', password: 'longenough1' })).status === 400);
check('dev mode refuses access requests', (await devPost('/auth/access-requests', { email: 'x@ucla.edu', name: 'X' })).status === 400);
devServer.close();
devDb.close();

server.close();
db.close();

console.log(`\n${failures === 0 ? 'all auth checks passed' : `${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
