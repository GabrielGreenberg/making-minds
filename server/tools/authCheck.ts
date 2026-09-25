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
//   [identity] task 036 — a person is their student ID, their emails are
//           aliases: sign-up with a personal class-list email or a UCLA one
//           (via the UID), sign-in by either, the refusals (wrong / claimed /
//           missing UID, a non-campus address), a registrar email change on
//           re-import, conflicts that never rebind, SSO resolution, the
//           invariants the Db enforces, and the boot that backfills `uid`.
//
// Exits non-zero on the first failed assertion (like every other tool here).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { placeRosterEntry } from '../src/identity';
import { importRosterCsv } from '../src/rosterImport';
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

// ═══ [unit] identity by UID (task 036) ═══════════════════════════
section('[identity]');

const idDb = new Db(':memory:');
// Two students whose class-list email is PERSONAL (43% of a real class list),
// one on a UCLA address, and an instructor with no UID (a manual add).
idDb.upsertUser({ email: 'gia.personal@gmail.com', name: 'Gia', role: 'student', studentId: '004-111-222' });
idDb.upsertUser({ email: 'hal.personal@yahoo.com', name: 'Hal', role: 'student', studentId: '004-555-666' });
idDb.upsertUser({ email: 'cam@ucla.edu', name: 'Cam', role: 'student', studentId: '004-333-444' });
idDb.upsertUser({ email: 'prof2@ucla.edu', name: 'Prof Two', role: 'instructor' });
const idPw = new PasswordAuthProvider(idDb);

check('the UID is stored normalised beside the ID as written', (() => {
  const gia = idDb.getUser('gia.personal@gmail.com');
  return gia?.uid === '4111222' && gia.studentId === '004-111-222';
})());
check('findUserByUid ignores dashes and leading zeros', idDb.findUserByUid('4111222')?.email === 'gia.personal@gmail.com');

const giaReg = await idPw.register({ email: 'Gia.Personal@gmail.com', password: 'giapassword', studentId: '004111222' });
check('sign-up with a personal class-list email + UID', giaReg.ok && giaReg.user.email === 'gia.personal@gmail.com');
check('…adds no alias (the email is the account key)', idDb.listEmailAliases('gia.personal@gmail.com').length === 0);

const halReg = await idPw.register({ email: 'hal@g.ucla.edu', password: 'halpassword1', studentId: '004-555-666' });
check('sign-up with a UCLA email via the UID', halReg.ok && halReg.user.email === 'hal.personal@yahoo.com', JSON.stringify(halReg));
check('…the account keeps its roster key (nothing to rekey)', halReg.ok && halReg.user.name === 'Hal');
check('…and the UCLA email becomes a sign-in address', idDb.listEmailAliases('hal.personal@yahoo.com').join() === 'hal@g.ucla.edu');
check('sign-in by the UCLA email', (await idPw.authenticate({ email: 'HAL@g.ucla.edu', password: 'halpassword1' }))?.email === 'hal.personal@yahoo.com');
check('sign-in by the class-list email', (await idPw.authenticate({ email: 'hal.personal@yahoo.com', password: 'halpassword1' }))?.email === 'hal.personal@yahoo.com');
check('a wrong password by the alias still fails', (await idPw.authenticate({ email: 'hal@g.ucla.edu', password: 'halpassword2' })) === null);

const wrongUid = await idPw.register({ email: 'someone@ucla.edu', password: 'longenough1', studentId: '004-999-999' });
check('a UID the roster does not have is refused (not on roster)', !wrongUid.ok && wrongUid.reason === 'not-on-roster');
const claimed = await idPw.register({ email: 'hal.other@ucla.edu', password: 'longenough1', studentId: '004555666' });
check('an already-claimed UID is refused', !claimed.ok && claimed.reason === 'already-registered');
check('…and the refused address is not stored', idDb.findUserByEmail('hal.other@ucla.edu') === null);
const othersEmail = await idPw.register({ email: 'gia.personal@gmail.com', password: 'longenough1', studentId: '004-333-444' });
check("a UID with another student's email is refused (id mismatch)", !othersEmail.ok && othersEmail.reason === 'id-mismatch');
const othersAlias = await idPw.register({ email: 'hal@g.ucla.edu', password: 'longenough1', studentId: '004-333-444' });
check(
  "another student's own sign-up address is refused as taken (not as an ID mismatch)",
  !othersAlias.ok && othersAlias.reason === 'email-taken',
);
const oracleReal = await idPw.register({ email: 'probe@gmail.com', password: 'longenough1', studentId: '004-333-444' });
const oracleFake = await idPw.register({ email: 'probe@gmail.com', password: 'longenough1', studentId: '004-000-001' });
check(
  'a refused address answers the same for a real and an unknown ID (no seat oracle)',
  !oracleReal.ok && !oracleFake.ok && oracleReal.reason === 'email-not-accepted' && oracleFake.reason === 'email-not-accepted',
);
const personal2 = await idPw.register({ email: 'cam.elsewhere@gmail.com', password: 'longenough1', studentId: '004-333-444' });
check(
  'a personal address that is not the class-list one is refused',
  !personal2.ok && personal2.reason === 'email-not-accepted' && personal2.message.includes('UCLA'),
);
const noUid = await idPw.register({ email: 'cam@ucla.edu', password: 'longenough1' });
check('no UID for an account that has one: asked for it', !noUid.ok && noUid.reason === 'id-required');
check('a malformed email is refused', !(await idPw.register({ email: 'nope', password: 'longenough1', studentId: '004333444' })).ok);
check(
  'an account with no UID (instructor) registers by email alone',
  (await idPw.register({ email: 'prof2@ucla.edu', password: 'longenough1' })).ok,
);
const camReg = await idPw.register({ email: 'cam@ucla.edu', password: 'campassword', studentId: '4333444' });
check('a UCLA class-list email + UID registers as before', camReg.ok && idDb.listEmailAliases('cam@ucla.edu').length === 0);

// The registrar changes Hal's preferred email mid-quarter (same UID).
const reImport = importRosterCsv(
  idDb,
  'UID,Name,Email\n004-555-666,Hal Personal,hal.new@outlook.com\n004-111-222,Gia,gia.personal@gmail.com\n',
  'student',
);
check('a re-import with a changed roster email updates the same person', reImport.added === 0 && reImport.updated === 2, JSON.stringify(reImport));
check('…under the same key (nothing rekeyed)', idDb.getUser('hal.new@outlook.com') === null && idDb.getUser('hal.personal@yahoo.com')?.name === 'Hal Personal');
check(
  '…the sign-up alias survives and the new roster email joins it',
  idDb.listEmailAliases('hal.personal@yahoo.com').sort().join() === 'hal.new@outlook.com,hal@g.ucla.edu',
);
check('…and all three sign in', await (async () => {
  for (const email of ['hal.personal@yahoo.com', 'hal@g.ucla.edu', 'hal.new@outlook.com']) {
    if ((await idPw.authenticate({ email, password: 'halpassword1' }))?.email !== 'hal.personal@yahoo.com') return false;
  }
  return true;
})());

const clash = importRosterCsv(idDb, 'UID,Name,Email\n004-111-222,Gia,cam@ucla.edu\n004-333-444,Cam,cam@ucla.edu\n', 'student');
check(
  "a row whose UID is one account's and email another's is an issue, not a write",
  clash.issues.some((i) => i.line === 2 && i.reason.includes('row not imported')) && idDb.listEmailAliases('gia.personal@gmail.com').length === 0,
  JSON.stringify(clash.issues),
);
const wrongIdForEmail = placeRosterEntry(idDb, { email: 'cam@ucla.edu', name: 'Cam', role: 'student', studentId: '004-777-888' }, 'instructor');
check('an email on file under a different UID is a conflict', wrongIdForEmail.kind === 'conflict' && idDb.findUserByUid('004777888') === null);
const manual = placeRosterEntry(idDb, { email: 'late@ucla.edu', name: '', role: 'student', studentId: '' }, 'instructor');
check('a manual add with no name takes the address', manual.kind === 'added' && manual.account.name === 'late');
const bindId = placeRosterEntry(idDb, { email: 'late@ucla.edu', name: '', role: 'student', studentId: '004-121-212' }, 'instructor');
const typoId = placeRosterEntry(idDb, { email: 'someone.new@ucla.edu', name: 'Some One', role: 'student', studentId: '004-121-212' }, 'instructor');
check(
  'the add form: an ID already on file under another email only adds the address (a typo never renames a classmate)',
  typoId.kind === 'updated' && typoId.account.name === 'late' && typoId.aliasAdded === 'someone.new@ucla.edu',
);
check('…a later entry binds its UID and keeps the name', bindId.kind === 'updated' && bindId.account.uid === '4121212' && bindId.account.name === 'late');
const byRequest = placeRosterEntry(idDb, { email: 'gia@g.ucla.edu', name: 'G. From A Request', role: 'instructor', studentId: '004111222' }, 'request');
check(
  "an approved request naming a roster UID adds the email to that account, roster facts untouched",
  byRequest.kind === 'updated' && byRequest.aliasAdded === 'gia@g.ucla.edu' && byRequest.account.name === 'Gia' && byRequest.account.role === 'student',
);

let aliasKeyRefused = false;
try {
  idDb.upsertUser({ email: 'hal@g.ucla.edu', name: 'Split', role: 'student' });
} catch {
  aliasKeyRefused = true;
}
check("invariant: an alias can never become another account's key", aliasKeyRefused && idDb.getUser('hal@g.ucla.edu') === null);
let twinUidRefused = false;
try {
  idDb.upsertUser({ email: 'twin@ucla.edu', name: 'Twin', role: 'student', studentId: '004-555-666' });
} catch {
  twinUidRefused = true;
}
check('invariant: a UID is on at most one account', twinUidRefused && idDb.getUser('twin@ucla.edu') === null);
check("addEmailAlias refuses another account's key or roster alias", idDb.addEmailAlias('cam@ucla.edu', 'hal.new@outlook.com', 'roster') === 'taken' && idDb.addEmailAlias('cam@ucla.edu', 'gia.personal@gmail.com', 'sso') === 'taken');

const idSso = new SsoAuthProvider(idDb, 'https://sso.ucla.edu/login');
const ssoCam = idSso.signInAsserted({ uid: '004333444', email: 'cam.logon@ucla.edu' });
check('SSO resolves the asserted UID to the roster account', ssoCam?.email === 'cam@ucla.edu');
check('…and its asserted email only becomes an alias', idDb.listEmailAliases('cam@ucla.edu').join() === 'cam.logon@ucla.edu');
check('SSO for a UID the roster lacks is refused', idSso.signInAsserted({ uid: '004000000', email: 'new@ucla.edu' }) === null);
check(
  "SSO never signs in by email to an account that has a different UID",
  idSso.signInAsserted({ uid: '004000000', email: 'cam@ucla.edu' }) === null,
);
const ssoProf = idSso.signInAsserted({ uid: '009-876-543', email: 'prof2@ucla.edu' });
check('SSO matches an account with no UID by email, and binds the asserted UID', ssoProf?.email === 'prof2@ucla.edu' && ssoProf.uid === '9876543');
check('dev provider signs in by an alias too', (await new DevAuthProvider(idDb).authenticate({ email: 'hal@g.ucla.edu' }))?.email === 'hal.personal@yahoo.com');
// Review findings (task 036): trust levels.
// (a) An access request's typed ID verifies nothing.
const reqRow = placeRosterEntry(idDb, { email: 'mal@example.org', name: 'Mal', role: 'student', studentId: '004-707-070' }, 'request');
check('a new row from an approved request keeps the typed ID unverified', reqRow.kind === 'added' && reqRow.account.uid === '' && reqRow.account.studentId === '004-707-070');
check('…which still asks for it at sign-up', (await idPw.register({ email: 'mal@example.org', password: 'longenough1' })).ok === false);
const carol = importRosterCsv(idDb, 'UID,Name,Email\n004-707-070,Carol Real,carol.real@gmail.com\n', 'student');
check(
  'a class-list row with an unverified ID is a conflict, never a merge into the requester',
  carol.added === 0 && carol.updated === 0 && carol.issues.some((i) => i.reason.includes('never verified')) && idDb.getUser('mal@example.org')?.name === 'Mal',
  JSON.stringify(carol),
);
const vouched = placeRosterEntry(idDb, { email: 'mal@example.org', name: '', role: 'student', studentId: '004-707-070' }, 'instructor');
check('the instructor settles it with the add form (email + that ID): now verified', vouched.kind === 'updated' && vouched.account.uid === '4707070');
const carolAgain = importRosterCsv(idDb, 'UID,Name,Email\n004-707-070,Carol Real,carol.real@gmail.com\n', 'student');
check('…and the class list then lands on that account', carolAgain.updated === 1 && idDb.findUserByEmail('carol.real@gmail.com')?.email === 'mal@example.org');
const malReg = await idPw.register({ email: 'mal@example.org', password: 'malpassword', studentId: '004707070' });
check('an unverified-ID row registers with its own email and that ID', malReg.ok);

// (b) A student's own sign-up alias yields to a stronger claim.
idDb.upsertUser({ email: 'dan@gmail.com', name: 'Dan', role: 'student', studentId: '004-818-181' });
idDb.upsertUser({ email: 'erin@yahoo.com', name: 'Erin', role: 'student', studentId: '004-828-282' });
check('Dan signs up with Erin\'s UCLA address', (await idPw.register({ email: 'erin@g.ucla.edu', password: 'danpassword', studentId: '004818181' })).ok);
const erinBlocked = await idPw.register({ email: 'erin@g.ucla.edu', password: 'erinpassword', studentId: '004828282' });
check('Erin is told the address is taken', !erinBlocked.ok && erinBlocked.reason === 'email-taken');
const erinList = importRosterCsv(idDb, 'UID,Name,Email\n004-828-282,Erin,erin@g.ucla.edu\n', 'student');
check(
  'the class list listing Erin under that address moves it to her (no conflict)',
  erinList.issues.length === 0 && idDb.findUserByEmail('erin@g.ucla.edu')?.email === 'erin@yahoo.com',
  JSON.stringify(erinList),
);
check('…Dan keeps his own account', idDb.listEmailAliases('dan@gmail.com').length === 0 && idDb.getUser('dan@gmail.com')?.registered === true);
check(
  'Dan signing in through it now fails',
  (await idPw.authenticate({ email: 'erin@g.ucla.edu', password: 'danpassword' })) === null &&
    (await idPw.authenticate({ email: 'dan@gmail.com', password: 'danpassword' }))?.email === 'dan@gmail.com',
);
idDb.addEmailAlias('dan@gmail.com', 'erin.sso@ucla.edu', 'signup');
check(
  "an SSO login takes back an address squatted as someone's sign-up alias",
  new SsoAuthProvider(idDb, '').signInAsserted({ uid: '004828282', email: 'erin.sso@ucla.edu' })?.email === 'erin@yahoo.com' &&
    idDb.findUserByEmail('erin.sso@ucla.edu')?.email === 'erin@yahoo.com',
);
idDb.addEmailAlias('dan@gmail.com', 'nobody.sure@ucla.edu', 'signup');
const noIdRow = placeRosterEntry(idDb, { email: 'nobody.sure@ucla.edu', name: 'Who', role: 'student', studentId: '' }, 'class-list');
check('an ID-less entry under a sign-up alias is a conflict (same person or not is unknowable)', noIdRow.kind === 'conflict');
check('a sign-up alias can never out-rank a stronger one', idDb.addEmailAlias('dan@gmail.com', 'erin@g.ucla.edu', 'signup') === 'taken');

// (c) The second row sharing an ID after the upgrade (unverified) still needs it.
idDb.upsertUser({ email: 'twin.b@ucla.edu', name: 'Twin B', role: 'student', studentId: '004-818-181' }, { verifiedId: false });
const twinNoId = await idPw.register({ email: 'twin.b@ucla.edu', password: 'longenough1' });
check('an unverified ID on file is still required at sign-up', !twinNoId.ok && twinNoId.reason === 'id-required');
const twinWithId = await idPw.register({ email: 'twin.b@ucla.edu', password: 'longenough1', studentId: '004818181' });
check('…and a verified holder of that ID blocks the claim', !twinWithId.ok && twinWithId.reason === 'id-mismatch');

idDb.removeUser('hal.personal@yahoo.com');
check('removing an account removes its aliases', idDb.findUserByEmail('hal@g.ucla.edu') === null && idDb.addEmailAlias('cam@ucla.edu', 'hal@g.ucla.edu', 'roster') === 'added');
idDb.close();

// The boot that brings task 036 to a database made before it: `uid` is
// backfilled from the IDs as written; of two rows sharing one, the first.
const migrateDir = mkdtempSync(join(tmpdir(), 'mm-auth-migrate-'));
const legacyPath = join(migrateDir, 'legacy.db');
const legacy = new DatabaseSync(legacyPath);
legacy.exec(`CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('student', 'instructor')));
  ALTER TABLE users ADD COLUMN student_id TEXT NOT NULL DEFAULT '';
  INSERT INTO users (email, name, role, student_id) VALUES
    ('old1@gmail.com', 'Old One', 'student', '004-222-333'),
    ('old2@ucla.edu', 'Old Two', 'student', '4222333'),
    ('old3@ucla.edu', 'Old Three', 'student', ''),
    ('old4@ucla.edu', 'Old Four', 'student', '004 444 555');`);
legacy.close();
const upgraded = new Db(legacyPath);
check('the upgrade boot backfills uid from the ID as written', upgraded.findUserByUid('004444555')?.email === 'old4@ucla.edu');
check('…a shared ID binds to the first row only', upgraded.findUserByUid('4222333')?.email === 'old1@gmail.com' && upgraded.getUser('old2@ucla.edu')?.uid === '');
check('…a row with no ID has none', upgraded.getUser('old3@ucla.edu')?.uid === '');
upgraded.close();
const rebooted = new Db(legacyPath);
check('…and a later boot changes nothing', rebooted.getUser('old2@ucla.edu')?.uid === '' && rebooted.listUsers().length === 4);
rebooted.close();
rmSync(migrateDir, { recursive: true, force: true });

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
  body: { email: 'stranger@ucla.edu', password: 'longenough1', studentId: '1' },
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

// The registrar's class list as exported — SYNTHETIC (invented names,
// @example.com). The pure reader is pinned in rosterCheck; this is the route.
type ImportReport = {
  added: number;
  headerLine: number | null;
  statusCounts: { label: string; count: number; imported: boolean }[];
  noLongerListed: { email: string; name: string; reason: string }[];
  columns: { section: string | null; status: string | null; role: string | null };
};
type RosterRowView = { email: string; name: string; section: string | null };
const classList = (rows: string[]) =>
  ['Term: 26F', 'Students: 4', '', 'UID,Name,E-mail,Major,Classification,Grade Type,Status,Section', ...rows].join('\r\n') + '\r\n';
const ANA = '999-000-101,"ZUBER, ANA",ana.zuber@example.com,Philosophy,Junior,LG,E,1B';
const ZED = '999-000-102,"ABLE, ZED",zed.able@example.com,Philosophy,Junior,LG,W,1A';
const MAX = '999-000-103,"MIDDLETON, MAX",max.middleton@example.com,Philosophy,Junior,LG,E,1A';
const DANA = '999-000-104,"DROPP, DANA",dana.dropp@example.com,Philosophy,Junior,LG,D,1A';
const exampleRows = async () =>
  (await api<{ roster: RosterRowView[] }>('GET', '/roster', { token: profToken })).json.roster.filter((r) =>
    r.email.endsWith('@example.com'),
  );

const classImport = await api<ImportReport>('POST', '/roster/import', {
  token: profToken,
  body: { csv: classList([ANA, ZED, MAX, DANA]) },
});
check('a registrar export imports as exported', classImport.status === 200 && classImport.json.added === 3);
check('…reporting the header line past the preamble', classImport.json.headerLine === 4);
check(
  '…the status counts (waitlisted imported, dropped not)',
  classImport.json.statusCounts.some((s) => s.label === 'waitlisted' && s.count === 1 && s.imported) &&
    classImport.json.statusCounts.some((s) => s.label === 'dropped' && s.count === 1 && !s.imported),
  JSON.stringify(classImport.json.statusCounts),
);
check(
  '…and the section + status columns (role NOT from Grade Type)',
  classImport.json.columns.section === 'Section' &&
    classImport.json.columns.status === 'Status' &&
    classImport.json.columns.role === null,
);
const listed = await exampleRows();
check(
  'GET /roster carries the display name and section',
  listed.some((r) => r.email === 'zed.able@example.com' && r.name === 'Zed Able' && r.section === '1A'),
  JSON.stringify(listed),
);
check(
  'GET /roster sorts by surname, not by the display name',
  listed.map((r) => r.email).join() === 'zed.able@example.com,max.middleton@example.com,ana.zuber@example.com',
  listed.map((r) => r.email).join(),
);

// The next export: Zed dropped, Max is gone.
const nextImport = await api<ImportReport>('POST', '/roster/import', {
  token: profToken,
  body: { csv: classList([ANA, ZED.replace(',W,', ',D,'), DANA]) },
});
const review = nextImport.json.noLongerListed;
check(
  'a re-import lists a student now dropped for review',
  review.some((r) => r.email === 'zed.able@example.com' && r.reason === 'status dropped'),
  JSON.stringify(review),
);
check(
  '…and one missing from the file',
  review.some((r) => r.email === 'max.middleton@example.com' && r.reason === 'not in this file'),
);
check('…never an instructor', !review.some((r) => r.email === 'prof@ucla.edu' || r.email === 'ta@ucla.edu'));
check(
  '…and removes nobody',
  (await exampleRows()).filter((r) => r.email === 'zed.able@example.com' || r.email === 'max.middleton@example.com')
    .length === 2,
);
const plainImport = await api<ImportReport>('POST', '/roster/import', {
  token: profToken,
  body: { csv: 'Email,Name\nana.zuber@example.com,Ana Zuber\n' },
});
check('a plain Email,Name import reviews nobody', plainImport.status === 200 && plainImport.json.noLongerListed.length === 0);
check(
  '…and a re-import without a Section column keeps the stored section',
  (await exampleRows()).find((r) => r.email === 'ana.zuber@example.com')?.section === '1B',
);

section('[http: identity by UID]');

// Pia's class-list email is personal; she signs up with her UCLA one.
await api('POST', '/roster/import', { token: profToken, body: { csv: 'UID,Name,Email\n004-800-001,Pia Personal,pia.p@gmail.com\n' } });
type RegisterReply = { token: string; user: { email: string }; reason: string };
const notCampus = await api<RegisterReply>('POST', '/auth/register', {
  body: { email: 'pia.other@hotmail.com', password: 'piapassword', studentId: '004800001' },
});
check('HTTP sign-up with a non-campus, non-roster email is a 400', notCampus.status === 400 && notCampus.json.reason === 'email-not-accepted');
const idRequired = await api<RegisterReply>('POST', '/auth/register', { body: { email: 'pia.p@gmail.com', password: 'piapassword' } });
check('HTTP sign-up without the UID an account has is a 400', idRequired.status === 400 && idRequired.json.reason === 'id-required');
const piaReg = await api<RegisterReply>('POST', '/auth/register', {
  body: { email: 'pia@g.ucla.edu', password: 'piapassword', studentId: '004-800-001' },
});
check('HTTP sign-up with a UCLA email via the UID', piaReg.status === 200 && piaReg.json.user.email === 'pia.p@gmail.com', JSON.stringify(piaReg.json));
const piaByAlias = await api<{ token: string; user: { email: string } }>('POST', '/auth/login', {
  body: { email: 'pia@g.ucla.edu', password: 'piapassword' },
});
check('HTTP sign-in by the UCLA email lands on the one account', piaByAlias.status === 200 && piaByAlias.json.user.email === 'pia.p@gmail.com');
check(
  '…whose session restores that account',
  (await api<{ user: { email: string } }>('GET', '/auth/me', { token: piaByAlias.json.token })).json.user.email === 'pia.p@gmail.com',
);
type AliasRow = { email: string; aliases: string[] };
const piaRow = async () =>
  (await api<{ roster: AliasRow[] }>('GET', '/roster', { token: profToken })).json.roster.find((r) => r.email === 'pia.p@gmail.com');
check('GET /roster lists the sign-in addresses', (await piaRow())?.aliases.join() === 'pia@g.ucla.edu');

const pendingEmails = async () =>
  (await api<{ requests: { email: string }[] }>('GET', '/access-requests?status=pending', { token: profToken })).json.requests.map((r) => r.email);
await api('POST', '/auth/access-requests', { body: { email: 'pia.p@gmail.com', name: 'Pia' } });
check('an access request under an account key records nothing (it is known)', !(await pendingEmails()).includes('pia.p@gmail.com'));
await api('POST', '/auth/access-requests', { body: { email: 'pia@g.ucla.edu', name: 'Not Pia' } });
check(
  "…but one under a student's own sign-up address is recorded (its real owner may be asking)",
  (await pendingEmails()).includes('pia@g.ucla.edu'),
);
await api('POST', '/auth/access-requests', { body: { email: 'pia.work@example.org', name: 'Pia P', studentId: '004800001' } });
const piaRequests = await api<{ requests: { id: number; email: string; match: { email: string } | null }[] }>(
  'GET',
  '/access-requests?status=pending',
  { token: profToken },
);
const piaRequest = piaRequests.json.requests.find((r) => r.email === 'pia.work@example.org');
check('the instructor sees which roster account a request names', piaRequest?.match?.email === 'pia.p@gmail.com', JSON.stringify(piaRequests.json));
const piaApprove = await api<{ account: string; aliasAdded: string | null }>('POST', `/access-requests/${piaRequest?.id}/approve`, { token: profToken });
check(
  '…and approving it adds the email to that account',
  piaApprove.status === 200 && piaApprove.json.account === 'pia.p@gmail.com' && piaApprove.json.aliasAdded === 'pia.work@example.org',
);
const addAlias = await api<{ updated: number; aliasAdded: string | null }>('POST', '/roster', {
  token: profToken,
  body: { email: 'pia.third@ucla.edu', studentId: '004800001' },
});
check('the add form with a known UID updates that person (+ alias)', addAlias.status === 200 && addAlias.json.updated === 1 && addAlias.json.aliasAdded === 'pia.third@ucla.edu');
check('…keeping the name on file', (await api<{ roster: { email: string; name: string }[] }>('GET', '/roster', { token: profToken })).json.roster.find((r) => r.email === 'pia.p@gmail.com')?.name === 'Pia Personal');
const addClash = await api<{ error: string }>('POST', '/roster', {
  token: profToken,
  body: { email: 'rosa@ucla.edu', studentId: '004800001' },
});
check("the add form refuses a UID with another person's email (409)", addClash.status === 409);

check('students cannot remove addresses', (await api('DELETE', '/roster/pia.p%40gmail.com/aliases/pia.work%40example.org', { token: piaByAlias.json.token })).status === 403);
const dropOther = await api<{ credentialCleared: boolean }>('DELETE', '/roster/pia.p%40gmail.com/aliases/pia.third%40ucla.edu', { token: profToken });
check('the instructor removes a sign-in address', dropOther.status === 200 && dropOther.json.credentialCleared === false);
check('…which no longer signs in', (await api('POST', '/auth/login', { body: { email: 'pia.third@ucla.edu', password: 'piapassword' } })).status === 401);
check('…while her password and sessions stand', (await api('GET', '/auth/me', { token: piaByAlias.json.token })).status === 200);
const dropSetup = await api<{ credentialCleared: boolean }>('DELETE', '/roster/pia.p%40gmail.com/aliases/pia%40g.ucla.edu', { token: profToken });
check('removing the address the account was set up through clears that password', dropSetup.status === 200 && dropSetup.json.credentialCleared === true);
check('…ends its sessions', (await api('GET', '/auth/me', { token: piaByAlias.json.token })).status === 401);
check('…and the password no longer works by any address', (await api('POST', '/auth/login', { body: { email: 'pia.p@gmail.com', password: 'piapassword' } })).status === 401);
check('removing it again is 404', (await api('DELETE', '/roster/pia.p%40gmail.com/aliases/pia%40g.ucla.edu', { token: profToken })).status === 404);

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

// One budget per ACCOUNT: an account's several addresses share it.
await api('POST', '/roster/import', { token: profToken, body: { csv: 'UID,Name,Email\n004-900-900,Quinn,quinn@gmail.com\n' } });
await api('POST', '/auth/register', { body: { email: 'quinn@g.ucla.edu', password: 'quinnpassword', studentId: '004900900' } });
await api('POST', '/roster', { token: profToken, body: { email: 'quinn.third@ucla.edu', studentId: '004900900' } });
let quinnTries = 0;
for (const email of ['quinn@gmail.com', 'quinn@g.ucla.edu', 'quinn.third@ucla.edu'].flatMap((e) => [e, e, e, e])) {
  if ((await api('POST', '/auth/login', { body: { email, password: 'wrongpass' } })).status === 429) break;
  quinnTries++;
}
check('sign-in guesses across one account\'s addresses share one budget (10)', quinnTries === 10, `got ${quinnTries}`);

// Sign-up refusals per IP, whatever email or ID each typed (the last check
// here: it closes registration from this address for the rest of the run).
let refused = 0;
let sawRegisterBudget = false;
for (let i = 0; i < 130; i++) {
  const r = await api('POST', '/auth/register', {
    body: { email: `guess${i}@ucla.edu`, password: 'longenough1', studentId: String(800000000 + i) },
  });
  if (r.status === 429) {
    sawRegisterBudget = true;
    break;
  }
  refused++;
}
check('ID guessing under fresh addresses meets a per-IP budget', sawRegisterBudget && refused <= 100, `refused ${refused} before 429`);

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
