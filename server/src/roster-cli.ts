// Roster + account administration from the box's shell — the deploy-day tool.
// Everything it does is also available to an instructor in the web UI; this
// exists because the FIRST instructor account has to come from somewhere, and
// because importing 80 students is easier with a file path than a paste box.
//
//   npm run roster -- import ~/rosters/class-list.csv [--role instructor]
//       (the registrar's export as-is; class lists never live in the repo)
//   npm run roster -- add ada@ucla.edu --name "Prof. Ada" --role instructor
//   npm run roster -- set-password ada@ucla.edu [--password ...]
//   npm run roster -- reset student@ucla.edu      # clear password + sessions
//   npm run roster -- remove student@ucla.edu
//   npm run roster -- list [--unregistered]
//   npm run roster -- requests                    # pending access requests
//
// MM_DB_PATH selects the database, exactly as for the server itself.

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from './config';
import { Db } from './db';
import { normalizeEmail, isEmail } from './roster';
import { importRosterCsv, formatRosterReport } from './rosterImport';
import { placeRosterEntry } from './identity';
import { hashPassword, passwordProblem } from './password';

const argv = process.argv.slice(2);
const command = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith('--'));

function flag(name: string): string | undefined {
  const exact = argv.indexOf(`--${name}`);
  if (exact >= 0 && argv[exact + 1] && !argv[exact + 1].startsWith('--')) return argv[exact + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}
const hasFlag = (name: string): boolean => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const USAGE = `usage: npm run roster -- <command>

  import <file.csv> [--role student|instructor]   upsert roster rows from a CSV
  add <email> [--name N] [--role R] [--id ID]     add or update one person
  set-password <email> [--password P]             set a password (prompts if omitted)
  reset <email>                                   clear the password + all sessions
  remove <email>                                  delete the roster row
  list [--unregistered]                           print the roster
  requests [--all]                                print access requests
`;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function promptPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('New password: ')).trim();
  } finally {
    rl.close();
  }
}

const config = loadConfig();
const db = new Db(config.dbPath);

const requireEmail = (value: string | undefined): string => {
  const email = normalizeEmail(value);
  if (!email || !isEmail(email)) die(`not a valid email address: ${value ?? '(missing)'}`);
  return email;
};

switch (command) {
  case 'import': {
    const path = positional[0];
    if (!path) die(USAGE);
    const defaultRole = flag('role') === 'instructor' ? 'instructor' : 'student';
    const report = importRosterCsv(db, readFileSync(path, 'utf8'), defaultRole);
    for (const line of formatRosterReport(report)) console.log(line);
    break;
  }

  case 'add': {
    // Through the identity module, like the import and the dashboard's form.
    const email = requireEmail(positional[0]);
    const known = db.findUserByEmail(email) ?? db.findUserByUid(flag('id') ?? '');
    const placed = placeRosterEntry(db, {
      email,
      name: flag('name') ?? '',
      role: flag('role') === 'instructor' ? 'instructor' : (known?.role ?? 'student'),
      studentId: flag('id') ?? '',
    }, 'instructor');
    if (placed.kind === 'conflict') die(placed.reason);
    else if (placed.kind === 'added') console.log(`added ${email}`);
    else console.log(`updated ${placed.account.email}${placed.aliasAdded ? ` (+ sign-in address ${placed.aliasAdded})` : ''}`);
    break;
  }

  case 'set-password': {
    const email = requireEmail(positional[0]);
    if (!db.getUser(email)) die(`${email} is not on the roster — add them first`);
    const password = flag('password') ?? (await promptPassword());
    const problem = passwordProblem(password);
    if (problem) die(problem);
    db.setPasswordHash(email, hashPassword(password));
    db.deleteSessionsFor(email);
    console.log(`password set for ${email}`);
    break;
  }

  case 'reset': {
    const email = requireEmail(positional[0]);
    if (!db.getUser(email)) die(`unknown account: ${email}`);
    db.setPasswordHash(email, null);
    db.deleteSessionsFor(email);
    console.log(`${email} can now create their account again`);
    break;
  }

  case 'remove': {
    const email = requireEmail(positional[0]);
    if (!db.getUser(email)) die(`unknown account: ${email}`);
    db.removeUser(email);
    console.log(`removed ${email} (their submissions are kept)`);
    break;
  }

  case 'list': {
    const rows = db.listUsers().filter((r) => !hasFlag('unregistered') || !r.registered);
    for (const r of rows) {
      const mark = r.registered ? '✓' : '·';
      console.log(
        `${mark} ${r.email.padEnd(32)} ${r.role.padEnd(10)} ${r.studentId.padEnd(12)} ${(r.section ?? '').padEnd(4)} ${r.name}` +
          (r.aliases.length > 0 ? `  (also ${r.aliases.join(', ')})` : ''),
      );
    }
    console.log(`${rows.length} row(s); ✓ = account created`);
    break;
  }

  case 'requests': {
    const rows = db.listAccessRequests(hasFlag('all') ? undefined : 'pending');
    for (const r of rows) {
      console.log(`#${r.id} [${r.status}] ${r.email} — ${r.name} ${r.studentId} — ${r.message}`);
    }
    console.log(`${rows.length} request(s)`);
    break;
  }

  default:
    console.log(USAGE);
    if (command) process.exitCode = 1;
}

db.close();
