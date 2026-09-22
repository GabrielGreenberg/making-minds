# Making Minds — API server

The server half of the platform: auth, assignment CRUD, per-student workbook
sync, and the submission endpoint with **server-side autograding**. It imports
the app's pure `engine/` (grader, codec, simulators) and domain types directly
from `../app/src` — one grading implementation, zero duplication.

- **Runtime**: Node ≥ 22.5 (uses the built-in `node:sqlite` — no native deps to
  compile on the server box), Express 5, run via `tsx`.
- **Storage**: a single SQLite file (`MM_DB_PATH`). WAL mode; backup = copy the
  file. Plenty for a ~80-student course on one Lightsail box.
- **Security posture**: the DB stores full assignments *including* `test_cases`
  (the answer bank). The API strips them from student responses, strips
  per-case grading detail from student results, and stamps submission
  identity/timestamps server-side. Grading happens on receipt of a submission.

## Quick start

```sh
cd server
npm install
npm run seed -- --sample   # toy roster + the five-mode sample assignment/submissions
npm run dev                # http://localhost:8133
```

Sanity: `curl localhost:8133/api/health` → `{"ok":true}`.

Checks:

```sh
npm run typecheck   # tsc --noEmit over server + the shared app sources
npm run check       # serverCheck (full student → instructor flow over HTTP)
                    # + authCheck (the account system: roster parsing, password
                    #   hashing, the providers, registration/sign-in/reset/access
                    #   requests end to end)
                    # + parityCheck (server grades ≡ in-process grades)
npm run roster      # roster + account admin CLI; see "Accounts" below
```

## Configuration (environment)

| Variable                 | Default               | Meaning                                                        |
| ------------------------ | --------------------- | -------------------------------------------------------------- |
| `PORT`                   | `8133`                | Listen port                                                     |
| `MM_DB_PATH`             | `making-minds.sqlite` | SQLite file (`:memory:` for tests)                              |
| `MM_CORS_ORIGINS`        | *(empty)*             | Comma-separated allowed origins (the Cloudflare Pages URL). Empty = no CORS headers (same-origin only) |
| `MM_AUTH_MODE`           | `password`            | `password` = email + password against the roster (the real system). `dev` = **passwordless** roster-email login, development only. `sso` = UCLA SSO (capabilities reported; authentication unimplemented) |
| `MM_SSO_LOGIN_URL`       | `/api/auth/sso/start` | Where the browser goes to start SSO, when `MM_AUTH_MODE=sso`     |
| `MM_SESSION_TTL_SECONDS` | 30 days               | Bearer-token session lifetime                                   |

## API

All routes are under `/api`, JSON in/out, auth via `Authorization: Bearer <token>`.

| Method + path                          | Who        | What                                                                 |
| -------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `GET /api/health`                       | anyone     | liveness probe                                                       |
| `GET /api/auth/config`                  | anyone     | what the sign-in system offers — the login screen renders from this  |
| `POST /api/auth/login`                  | anyone     | `{email, password}` → `{token, user}` (password omitted in dev mode); throttled per email+IP; one message for every failure, so the roster can't be enumerated |
| `POST /api/auth/register`               | anyone     | `{email, password, studentId?}` → creates the account for a **roster member** and signs them in |
| `POST /api/auth/password`               | logged in  | `{currentPassword, newPassword}` — ends every other session, re-issues this one |
| `POST /api/auth/logout`                 | logged in  | invalidates the token                                                |
| `GET /api/auth/me`                      | logged in  | `{user}`                                                             |
| `POST /api/auth/access-requests`        | anyone     | `{email, name, studentId?, message?}` — "my email isn't on the roster"; always answers ok |
| `GET /api/roster`                       | instructor | the roster with per-row account state                                |
| `POST /api/roster/import`               | instructor | `{csv, defaultRole?}` → upsert; never removes anyone, never touches a password |
| `POST /api/roster`                      | instructor | add or update one person                                             |
| `DELETE /api/roster/:email`             | instructor | remove from the roster (their submitted work is kept)                |
| `POST /api/roster/:email/reset-password`| instructor | clear the credential + all their sessions; they register again       |
| `GET /api/access-requests`              | instructor | `?status=pending\|approved\|rejected`                                |
| `POST /api/access-requests/:id/approve` | instructor | adds them to the roster and resolves the request                     |
| `POST /api/access-requests/:id/reject`  | instructor | resolves the request, adding nobody                                  |
| `GET /api/assignments`                  | logged in  | `{assignments: [{id, title, questionCount}]}`                        |
| `GET /api/assignments/:id`              | logged in  | full assignment; **students get `test_cases` stripped**              |
| `PUT /api/assignments/:id`              | instructor | create/update (body = full `AssignmentData`, id must match URL)      |
| `DELETE /api/assignments/:id`           | instructor | remove                                                               |
| `PUT /api/assignments/:id/grades-release` | instructor | `{released: boolean}` — grades are hidden from students until released; unrelease hides them again |
| `GET /api/workbooks/:assignmentId`      | logged in  | the caller's saved canvas state (`{state}` — null if none)           |
| `PUT /api/workbooks/:assignmentId`      | logged in  | autosave target (body = `AssignmentState`)                           |
| `POST /api/assignments/:id/submissions` | logged in  | `{answers}` → server stamps identity/time, **grades**, stores, returns `{record}`; the student's copy carries **no grade** until grades are released (then scores only, never per-case detail) |
| `GET /api/assignments/:id/submissions`  | logged in  | student: own attempts — no grades before release, scores-only after; instructor: all attempts, full detail (the gradebook feed) |

The browser counterpart is `app/src/api/client.ts` — a typed function per
endpoint, ready to back `Remote*` implementations of the `WorkbookStore` /
`AssignmentStore` / `SubmissionStore` seams.

## Layout

| File                    | What's there                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| `src/config.ts`         | env-driven `ServerConfig`                                               |
| `src/db.ts`             | `node:sqlite` schema + typed accessors (users, sessions, assignments, workbooks, submissions) |
| `src/auth.ts`           | the auth seam: `AuthProvider` (authenticate / register / capabilities) with `PasswordAuthProvider`, `DevAuthProvider`, `SsoAuthProvider`; `createAuthProvider` is the one mode decision. Plus session issue/lookup, `requireAuth`/`requireInstructor`, and the failed-login `LoginThrottle` |
| `src/password.ts`       | scrypt hashing (self-describing `scrypt$N$r$p$salt$hash`), constant-time verify, the length policy |
| `src/roster.ts`         | pure CSV roster parsing: RFC-4180 reader + tolerant header detection (email / name or first+last / student ID / role), per-row issues |
| `src/sanitize.ts`       | student-facing redaction: `stripAnswers` (no `test_cases`), `stripResultDetail` (scores only), `studentRecord` (no grade at all until grades are released) |
| `src/app.ts`            | the Express app (factory, no `listen`) — all routes                     |
| `src/index.ts`          | entry point: config → db → listen, graceful shutdown                    |
| `src/seed.ts`           | seed the toy roster (+ the sample assignment) (`npm run seed [-- --sample] [-- --password=X]`) |
| `src/roster-cli.ts`     | roster + account admin from the shell (`npm run roster -- <command>`)   |
| `tools/serverCheck.ts`  | end-to-end HTTP smoke test (`npm run check`)                            |
| `tools/authCheck.ts`    | the account system: roster parsing, passwords, providers, and the whole sign-in lifecycle over HTTP |

## Accounts

The roster decides **who may have an account**; each person creates their own by
choosing a password. Nobody can register for an email the roster doesn't carry —
they file an access request instead, and an instructor approves it.

```sh
npm run roster -- import roster.csv      # any CSV with an email column
npm run roster -- add x@ucla.edu --role instructor
npm run roster -- set-password x@ucla.edu    # bootstrap the first instructor
npm run roster -- list --unregistered
npm run roster -- reset x@ucla.edu       # forgotten password → they re-register
npm run roster -- requests               # pending access requests
```

Everything above is also in the instructor UI ("Roster & accounts"). The CLI
exists because the *first* instructor account has to come from somewhere.

Passwords are scrypt-hashed with per-password salts and the cost parameters
stored alongside each hash, so raising the cost later doesn't invalidate
anyone. There is no password-reset email (no mail server): an instructor clears
the credential and the student registers again with the same email — their
saved work and submissions are untouched.

Swapping in UCLA SSO is one class: fill in `SsoAuthProvider.authenticate` and
set `MM_AUTH_MODE=sso`. Sessions, every route, the role gate, and the frontend
are already provider-agnostic — the login screen reads
`GET /api/auth/config` and renders the SSO button on its own.

Deployment (Lightsail + Cloudflare Pages) lives in `../deploy/`.
