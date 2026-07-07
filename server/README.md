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
npm run seed -- --sample   # roster + cc-basics + the five-mode sample assignment/submissions
npm run dev                # http://localhost:8133
```

Sanity: `curl localhost:8133/api/health` → `{"ok":true}`.

Checks:

```sh
npm run typecheck   # tsc --noEmit over server + the shared app sources
npm run check       # tools/serverCheck.ts — boots the app on an ephemeral port
                    # against an in-memory DB and drives the full student →
                    # instructor flow over HTTP (22 assertions)
```

## Configuration (environment)

| Variable                 | Default               | Meaning                                                        |
| ------------------------ | --------------------- | -------------------------------------------------------------- |
| `PORT`                   | `8133`                | Listen port                                                     |
| `MM_DB_PATH`             | `making-minds.sqlite` | SQLite file (`:memory:` for tests)                              |
| `MM_CORS_ORIGINS`        | *(empty)*             | Comma-separated allowed origins (the Cloudflare Pages URL). Empty = no CORS headers (same-origin only) |
| `MM_AUTH_MODE`           | `dev`                 | `dev` = passwordless roster-email login. `sso` = reserved for UCLA SSO (throws until implemented) |
| `MM_SESSION_TTL_SECONDS` | 30 days               | Bearer-token session lifetime                                   |

## API

All routes are under `/api`, JSON in/out, auth via `Authorization: Bearer <token>`.

| Method + path                          | Who        | What                                                                 |
| -------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `GET /api/health`                       | anyone     | liveness probe                                                       |
| `POST /api/auth/login`                  | anyone     | `{email}` → `{token, user}` (dev mode: any roster email)             |
| `POST /api/auth/logout`                 | logged in  | invalidates the token                                                |
| `GET /api/auth/me`                      | logged in  | `{user}`                                                             |
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
| `src/auth.ts`           | the auth seam: `AuthProvider` interface, `DevAuthProvider`, session issue/lookup, `requireAuth`/`requireInstructor` middleware. UCLA SSO plugs in here (`MM_AUTH_MODE=sso`) |
| `src/sanitize.ts`       | student-facing redaction: `stripAnswers` (no `test_cases`), `stripResultDetail` (scores only), `studentRecord` (no grade at all until grades are released) |
| `src/app.ts`            | the Express app (factory, no `listen`) — all routes                     |
| `src/index.ts`          | entry point: config → db → listen, graceful shutdown                    |
| `src/seed.ts`           | seed roster + bundled/sample assignments (`npm run seed [-- --sample]`) |
| `tools/serverCheck.ts`  | end-to-end HTTP smoke test (`npm run check`)                            |

Deployment (Lightsail + Cloudflare Pages) lives in `../deploy/`.
