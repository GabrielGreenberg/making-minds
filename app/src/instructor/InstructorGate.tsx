import type { ReactNode } from 'react';
import { instructorRole } from '../auth/instructorRole';
import { useAuth } from '../auth';
import { navigate } from '../routing';
import { PageShell, appNav } from '../components/PageShell';
import { SessionControls } from '../components/SessionControls';

/**
 * Gates the instructor frontend on the logged-in account's role. Mirrors AuthGate,
 * but for the instructor role.
 *
 * Instructor accounts render the wrapped instructor UI. A student who reaches an
 * instructor route (only by typing the URL — the link is hidden from students)
 * gets an access-denied card in the ordinary page shell, not the instructor
 * views. This is the gating demo.
 *
 * Later, the SSO token carries the role claim; this component is unchanged — only
 * `instructorRole.isInstructor()` gains real behavior.
 */
export function InstructorGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!instructorRole.isInstructor()) {
    return (
      <PageShell variant="card" nav={appNav('assignments', false)} session={<SessionControls />}>
        <div className="mm-card mm-card--narrow">
          <h1>Instructors only</h1>
          <p className="mm-lede">
            This area is for authoring assignments and reviewing submissions. You are
            signed in as {user ? `${user.name} (student)` : 'a student'}, so it isn't
            available to you.
          </p>
          <button className="mm-btn mm-btn--primary" onClick={() => navigate({ kind: 'home' })}>
            Back to my assignments
          </button>
        </div>
      </PageShell>
    );
  }

  return <>{children}</>;
}
