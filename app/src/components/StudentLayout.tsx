import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import { PageShell, appNav, hashLink } from './PageShell';
import { SessionControls } from './SessionControls';

/** The student Home's sections, shown as tabs at the top of the column on
 *  the catalog, the Grades page and an assignment's overview (which belongs
 *  to Assignments, as the instructor's editor belongs to its Assignments tab). */
const TABS: { key: 'assignments' | 'grades'; label: string; route: { kind: 'home' } | { kind: 'grades' } }[] = [
  { key: 'assignments', label: 'Assignments', route: { kind: 'home' } },
  { key: 'grades', label: 'Grades', route: { kind: 'grades' } },
];

/**
 * The twin of InstructorLayout for the student side: the page shell with the
 * nav by role (Home for a student; Student view · Dashboard for an instructor,
 * whose Student view IS this page), and inside the column an eyebrow that
 * repeats the nav label plus the tab row Assignments · Grades. Same chrome,
 * same column as everywhere else, so nothing moves between tabs or roles.
 */
export function StudentLayout({ current, children }: { current: 'assignments' | 'grades'; children: ReactNode }) {
  const { user } = useAuth();
  const nav = appNav('student', user?.role === 'instructor' ? 'instructor' : 'student');
  const home = nav[0].label;
  return (
    <PageShell nav={nav} session={<SessionControls />}>
      <nav className="mm-tabs" aria-label={`${home} sections`}>
        <span className="eyebrow">{home}</span>
        {TABS.map((t) => (
          <a
            key={t.key}
            className={`mm-tab${current === t.key ? ' mm-tab--active' : ''}`}
            aria-current={current === t.key ? 'page' : undefined}
            data-text={t.label}
            {...hashLink(t.route)}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {children}
    </PageShell>
  );
}
