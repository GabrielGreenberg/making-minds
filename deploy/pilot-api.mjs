// The pilot API, as an instructor, from a script on the instructor's (or the
// robot's) machine — shared by tasks/tools/feedback.mjs (task 018) and
// deploy/release-gate.mjs (task 042), so both sign in the same way.
//
// Credentials come from a gitignored env file (default <repo>/secrets/feedback.env):
//   MM_API_BASE=https://100-22-69-95.sslip.io
//   MM_FEEDBACK_EMAIL=<an instructor account's email>
//   MM_FEEDBACK_PASSWORD=<its password>
// Every session is signed out again when its work is done. Plain Node (>= 22),
// no dependencies.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ENV = join(REPO, 'secrets', 'feedback.env');

/** A failure with a message meant for the person running the script. */
export class PilotError extends Error {}

/** Read the credentials file: `{ base, email, password }`. */
export function readEnv(path = DEFAULT_ENV) {
  if (!existsSync(path)) {
    throw new PilotError(
      `No credentials file at ${path}.\n` +
        'Create it (secrets/ is gitignored) with three lines:\n' +
        '  MM_API_BASE=https://<the API server>\n' +
        '  MM_FEEDBACK_EMAIL=<an instructor account>\n' +
        '  MM_FEEDBACK_PASSWORD=<its password>',
    );
  }
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const key of ['MM_API_BASE', 'MM_FEEDBACK_EMAIL', 'MM_FEEDBACK_PASSWORD']) {
    if (!env[key]) throw new PilotError(`${path} has no ${key}`);
  }
  return {
    base: env.MM_API_BASE.replace(/\/+$/, '').replace(/\/api$/, ''),
    email: env.MM_FEEDBACK_EMAIL,
    password: env.MM_FEEDBACK_PASSWORD,
  };
}

/** One API call: `{ status, json }` (json null when the reply isn't JSON). */
export async function call(base, method, path, { token, body } = {}) {
  let res;
  try {
    res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new PilotError(`Cannot reach the server at ${base} (${e.cause?.code ?? e.name ?? e.message}).`);
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const json = isJson ? await res.json() : null;
  return { status: res.status, json };
}

async function signIn(env) {
  const r = await call(env.base, 'POST', '/auth/login', { body: { email: env.email, password: env.password } });
  if (r.status === 429) throw new PilotError('Sign-in throttled after failed attempts — wait a few minutes.');
  if (r.status !== 200 || !r.json?.token) {
    throw new PilotError(`Sign-in refused (${r.status}): check MM_FEEDBACK_EMAIL / MM_FEEDBACK_PASSWORD.`);
  }
  if (r.json.user?.role !== 'instructor') {
    await call(env.base, 'POST', '/auth/logout', { token: r.json.token }).catch(() => {});
    throw new PilotError(`${env.email} is not an instructor account.`);
  }
  return r.json.token;
}

/** Sign in, run `body` with the token, always sign out again (no session
 *  left lying around on the server). */
export async function withSession(env, body) {
  const token = await signIn(env);
  try {
    return await body(token);
  } finally {
    await call(env.base, 'POST', '/auth/logout', { token }).catch(() => {});
  }
}
