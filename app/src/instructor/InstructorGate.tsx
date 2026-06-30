import type { ReactNode } from 'react';
import { instructorRole } from '../auth/instructorRole';
import { useAuth } from '../auth';
import { navigate } from '../routing';

/**
 * Gates the instructor frontend on the logged-in account's role. Mirrors AuthGate,
 * but for the instructor role.
 *
 * Instructor accounts render the wrapped instructor UI. A student who reaches an
 * instructor route (only by typing the URL — the link is hidden from students)
 * gets an access-denied screen, not the instructor views. This is the gating demo.
 *
 * Later, the SSO token carries the role claim; this component is unchanged — only
 * `instructorRole.isInstructor()` gains real behavior.
 */
export function InstructorGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!instructorRole.isInstructor()) {
    return (
      <div className="instructor-unlock">
        <div className="instructor-unlock-card">
          <h1 className="instructor-unlock-title">Instructors only</h1>
          <p className="instructor-unlock-text">
            This area is for authoring assignments and reviewing submissions. You are
            signed in as {user ? `${user.name} (student)` : 'a student'}, so it isn't
            available to you.
          </p>
          <button
            className="instructor-unlock-button"
            onClick={() => navigate({ kind: 'home' })}
          >
            Back to my assignments
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
