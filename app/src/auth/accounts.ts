// Toy account table for the mockup auth system.
//
// A fixed, hardcoded set of identities the login screen offers. This exists only
// to demo the two perspectives (student vs. instructor) and exercise role gating
// + routing — there are no passwords and no security here. When real auth lands
// (Supabase + SSO), this table and the `localStorage` session below disappear;
// `Account.role` becomes the SSO role claim.

export type Role = 'student' | 'instructor';

export interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const TOY_ACCOUNTS: Account[] = [
  { id: 'student-john', email: 'john.doe@example.com', name: 'John Doe', role: 'student' },
  { id: 'instructor-ada', email: 'ada.instructor@example.com', name: 'Prof. Ada', role: 'instructor' },
];

/** Where the logged-in account id is persisted, so a reload keeps the session. */
export const SESSION_KEY = 'mm:auth:current';

export function findAccount(id: string | null | undefined): Account | null {
  if (!id) return null;
  return TOY_ACCOUNTS.find((a) => a.id === id) ?? null;
}

/** Read the persisted account directly (non-React). Returns null when logged out. */
export function readPersistedAccount(): Account | null {
  try {
    return findAccount(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
