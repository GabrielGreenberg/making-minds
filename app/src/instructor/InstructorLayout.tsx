import type { ReactNode } from 'react';
import { PageShell, appNav, hashLink } from '../components/PageShell';
import type { ShellNavItem } from '../components/PageShell';
import { SessionControls } from '../components/SessionControls';
import type { InstructorRoute } from './useInstructorRoute';

/** The Dashboard's sections, shown as tabs at the top of the column on every
 *  instructor page; each names the route kinds it is current for (the
 *  Assignments tab owns the editor and the question creator, reached from it;
 *  the Grading tab every grading view and student page, task 065). */
const SECTIONS: { label: string; route: ShellNavItem['route']; kinds: InstructorRoute['kind'][] }[] = [
  {
    label: 'Assignments',
    route: { kind: 'instructor' },
    kinds: ['instructor', 'instructor-new-assignment', 'instructor-edit'],
  },
  {
    label: 'Grading',
    route: { kind: 'instructor-grading' },
    kinds: ['instructor-grading', 'instructor-grading-assignment', 'instructor-grading-student', 'instructor-student'],
  },
  { label: 'Roster & accounts', route: { kind: 'instructor-roster' }, kinds: ['instructor-roster'] },
  { label: 'Feedback', route: { kind: 'instructor-feedback' }, kinds: ['instructor-feedback'] },
  { label: 'Notes', route: { kind: 'instructor-notes' }, kinds: ['instructor-notes'] },
];

/**
 * The shell shared by all instructor views: the site's page shell with the
 * instructor's nav (Student view · Dashboard, the latter current), the
 * signed-in identity, Feedback (the same report form students use, filed with
 * the instructor tag — task 076) and Log out — and, inside the column, the
 * Dashboard's tab row. The chrome is the same one the student pages use, so
 * nothing moves on the crossing. Only instructor accounts get here
 * (InstructorGate).
 */
export function InstructorLayout({ route, children }: { route: InstructorRoute; children: ReactNode }) {
  return (
    <PageShell nav={appNav('dashboard', 'instructor')} session={<SessionControls />}>
      <nav className="mm-tabs" aria-label="Dashboard sections">
        <span className="eyebrow">Dashboard</span>
        {SECTIONS.map((s) => {
          const active = s.kinds.includes(route.kind);
          return (
            <a
              key={s.label}
              className={`mm-tab${active ? ' mm-tab--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              data-text={s.label}
              {...hashLink(s.route)}
            >
              {s.label}
            </a>
          );
        })}
      </nav>
      {children}
    </PageShell>
  );
}
