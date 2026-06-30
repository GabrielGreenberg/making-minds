# Plan — mockup auth with account-based role gating

> **Status: PLANNED — NOT YET BUILT.** Session-handoff doc. The goal is a *toy* auth system to
> demo the two perspectives — a **student** (John Doe) and an **instructor** — and to exercise
> **gating + routing**, not security. Read `../instructor/frontend.md` ("Seams") and the auth
> files (`auth/stubAuth.tsx`, `auth/AuthGate.tsx`, `auth/instructorRole.ts`, `auth/types.ts`)
> first. Keep this file in sync as the work lands; **delete it once shipped** and update
> `../instructor/frontend.md` + the seam tables in `CLAUDE.md` (Identity / Instructor role rows).

## The problem with today's setup

Two facts about the current code drive the whole redesign:

1. **There is no login.** `auth/stubAuth.tsx` hardcodes `STUB_USER` (John Doe) into a context
   value that never changes; `loading` is always `false` and `user` is never `null`. So
   `AuthGate`'s `!user` branch (`auth/AuthGate.tsx:23`) is **unreachable** — the app renders
   immediately as John Doe.
2. **Role is orthogonal to identity.** Instructor access is a *separate* `sessionStorage` flag
   (`mm:instructor`) in `auth/instructorRole.ts`, set by an **"Enter Instructor Mode" button that
   anyone can click** (`instructor/InstructorGate.tsx:28`). It is not tied to *who* is logged in.

So "student" and "instructor" aren't accounts today — they're a toggle on a single always-on
identity. The fix: **make role a property of the logged-in account, and gate on it.**

## Target behavior (the demo we want)

- App opens to a **login screen** (no auto-login). Pick one of a fixed set of toy accounts:
  **John Doe (student)** or **Prof. Ada (instructor)**.
- Logging in as a **student** lands on the student Home (`HomeScreen`); the instructor area is
  **not linked** and visiting `#/instructor` directly shows an **"access denied — instructors
  only"** screen (this is the gating demo).
- Logging in as an **instructor** shows a link into the instructor area; `#/instructor` renders
  the dashboard as it does today.
- A **logout** control returns to the login screen. Session **persists across reload** (so
  student resume still works) until logout.

## Design decisions (recommended; alternatives noted)

- **Role lives on the account, derived everywhere.** Fold `role: 'student' | 'instructor'` into
  the identity. `instructorRole.isInstructor()` stops reading a `sessionStorage` flag and instead
  reads `currentAccount.role === 'instructor'`. This is exactly the product seam ("the SSO token
  carries a role claim and `isInstructor()` reads it") and lets us keep the `InstructorGate`
  consumer unchanged. The `enter()` / `exit()` methods become dead — remove them and the unlock
  button. _(Alternative: keep role separate. Rejected — it's the thing we're trying to unify, and
  it's what lets a single login pick the view.)_
- **Login by picking an account, not email+password.** A short list of buttons. Passwords add
  nothing to a gating/routing demo. _(Alternative: an email field matched against the account
  table with the password ignored — slightly more "real-looking" but more UI for no test value.
  Easy to add later behind the same `login()` call.)_
- **Persist the session in `localStorage`** (key `mm:auth:current` = account id), so a reload
  keeps you logged in and student resume keeps working. Logout clears it. _(The old instructor
  flag used `sessionStorage` to auto-clear on tab close; that rationale — "never touch student
  localStorage" — goes away once role is just a field on the chosen account.)_

## File-by-file changes

### `auth/accounts.ts` (new) — the toy account table
```ts
export type Role = 'student' | 'instructor';
export interface Account { id: string; email: string; name: string; role: Role; }
export const TOY_ACCOUNTS: Account[] = [
  { id: 'student-john',   email: 'john.doe@example.com',       name: 'John Doe',  role: 'student' },
  { id: 'instructor-ada', email: 'ada.instructor@example.com', name: 'Prof. Ada', role: 'instructor' },
];
export const findAccount = (id: string | null) =>
  TOY_ACCOUNTS.find((a) => a.id === id) ?? null;
```

### `auth/types.ts` — extend the stable interface
- Add `role: Role` to `AuthUser`.
- Add imperative methods to `AuthContextValue`: `login(accountId: string): void` and
  `logout(): void`. (`user: AuthUser | null` already models the logged-out state — it just never
  occurs today.)

### `auth/stubAuth.tsx` — make the provider stateful
- Replace the frozen `STUB_VALUE` with React state seeded from `localStorage['mm:auth:current']`
  via `findAccount(...)`.
- `login(id)`: write the key, set state. `logout()`: remove the key, set `null`.
- `getCurrentUserEmail()`: read the persisted account's email (non-hook accessor; current call
  sites in `components/MenuBar.tsx:82,103` and `components/HomeScreen.tsx:23` only run behind
  `AuthGate`, so a user is always present there — but guard with a clear throw/`''` for safety).
- Keep the **same exports** (`AuthProvider` / `useAuth` / `getCurrentUserEmail`) so `main.tsx`
  and the `index.ts` barrel are untouched.

### `auth/AuthGate.tsx` — become a real gate
- The existing `!user` branch (`AuthGate.tsx:23`) is the seam — render `<LoginScreen />` there
  instead of `null`. `loading` branch stays.

### `auth/LoginScreen.tsx` (new)
- Render one button per `TOY_ACCOUNTS` entry ("Continue as John Doe — Student", "Continue as
  Prof. Ada — Instructor"), each calling `useAuth().login(account.id)`. Mirror the visual style
  of the existing `instructor-unlock-card` (`instructor/InstructorGate.tsx`).

### `auth/instructorRole.ts` — derive role from the session
- Reimplement `isInstructor()` to read `findAccount(localStorage['mm:auth:current'])?.role ===
  'instructor'` (or expose a tiny `getCurrentAccount()` from `stubAuth` and read that — avoids
  duplicating the storage key). Drop `enter()` / `exit()`. Keep the `instructorRole.isInstructor`
  export so `InstructorGate` is a one-line-or-zero-line change.

### `instructor/InstructorGate.tsx` — deny instead of unlock
- Replace the "Enter Instructor Mode" unlock card with an **access-denied** card shown when
  `!isInstructor()`: "This area is for instructors. You're signed in as a student." + a button to
  `navigate({ kind: 'home' })`. Remove the `force`/`enter()` re-render dance.

### Nav affordances (the routing demo surface)
- **Instructor link, instructor-only.** In `components/MenuBar.tsx` (student chrome), show a
  "Instructor view" link → `#/instructor` **only when** `useAuth().user?.role === 'instructor'`.
  Students never see it; the only way they reach `#/instructor` is by typing the URL → the
  access-denied screen above. That asymmetry *is* the gating test.
- **User chip + Logout.** Add the signed-in name/email and a Logout button to `MenuBar` and to
  the instructor header (`instructor/InstructorLayout.tsx`). Logout → `useAuth().logout()` and
  `navigate({ kind: 'home' })`, which drops to the login screen via `AuthGate`.

## Routing & gating notes

- **Component-level gating is enough.** `routing.ts` `applyRoute` already no-ops for instructor
  routes (`routing.ts:79-87`) and lets `InstructorGate` decide. Keep that — the denied screen is
  more informative than a silent redirect. _(Optional hardening: also bounce students to Home in
  `applyRoute` for instructor routes; not needed for the demo and loses the teaching message.)_
- `App.tsx:21` still renders `<InstructorApp>` for instructor hashes regardless of role; the gate
  inside `InstructorApp` (`InstructorGate`) is what enforces role. No change to `App.tsx` needed.

## Caveats / things to watch

- **Per-user data isolation is out of scope.** `WorkbookStore` autosave is per-browser, and
  submissions are tagged with `getCurrentUserEmail()` (`MenuBar.tsx:103`, `HomeScreen.tsx:23`).
  Switching accounts does **not** partition student work — fine for a two-perspective demo
  (the instructor doesn't do student work), but note it so it isn't mistaken for real
  multi-tenancy. If we later want clean separation, key the workbook store by account id.
- **`getCurrentUserEmail()` when logged out.** Only reachable behind `AuthGate`, so a user is
  always present at those call sites. Still, make it fail loudly rather than silently return the
  old stub email.

## What this sets up for the product

This is the same seam boundary the backend phase replaces: `login/logout` + a persisted session
become Supabase auth; `Account.role` becomes the SSO role claim; `isInstructor()` reads that
claim. Consumers (`AuthGate`, `InstructorGate`, `MenuBar`) don't change again.

## Testing (manual, since it's UI gating)

1. Open app → login screen (not auto-logged-in).
2. Log in as **John Doe** → Home, no instructor link. Visit `#/instructor` by URL → access
   denied. Logout → login screen.
3. Log in as **Prof. Ada** → instructor link visible; `#/instructor` → dashboard. Logout.
4. Reload while logged in → still logged in, same view.
