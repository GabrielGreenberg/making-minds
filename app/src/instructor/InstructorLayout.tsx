import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import { navigate } from '../routing';

/**
 * Thin shell shared by all instructor views: a header bar with the title, the
 * signed-in identity, a link back to the student view, and Log out — plus a
 * content area for the active view.
 */
export function InstructorLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate({ kind: 'home' });
  };

  return (
    <div className="instructor-app">
      <header className="instructor-header">
        <button
          className="instructor-header-title"
          onClick={() => navigate({ kind: 'instructor' })}
        >
          Instructor — Making Minds
        </button>
        <div className="instructor-header-actions">
          {user && <span className="session-chip">{user.name} · Instructor</span>}
          <button className="instructor-header-exit" onClick={() => navigate({ kind: 'home' })}>
            Student view
          </button>
          <button className="instructor-header-exit" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="instructor-content">{children}</main>
    </div>
  );
}
