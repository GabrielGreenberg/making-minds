import type { ReactNode } from 'react';
import { instructorRole } from '../auth/instructorRole';
import { navigate } from '../routing';

/**
 * Thin shell shared by all instructor views: a header bar with the title and an
 * "Exit Instructor Mode" link, plus a content area for the active view.
 */
export function InstructorLayout({ children }: { children: ReactNode }) {
  const handleExit = () => {
    instructorRole.exit();
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
        <button className="instructor-header-exit" onClick={handleExit}>
          Exit Instructor Mode
        </button>
      </header>
      <main className="instructor-content">{children}</main>
    </div>
  );
}
