import type { ReactNode } from 'react';
import { PageShell, appNav } from '../components/PageShell';
import type { ShellNavItem } from '../components/PageShell';
import { SessionControls } from '../components/SessionControls';
import type { InstructorRoute } from './useInstructorRoute';

/** The instructor's sections, shown as the shell's sub-nav; each names the
 *  route kinds it is "current" for (the dashboard owns the editor and the
 *  gradebook, which are reached from it). */
const SECTIONS: { label: string; route: ShellNavItem['route']; kinds: InstructorRoute['kind'][] }[] = [
  {
    label: 'Dashboard',
    route: { kind: 'instructor' },
    kinds: ['instructor', 'instructor-new-assignment', 'instructor-edit', 'instructor-submissions'],
  },
  { label: 'Roster & accounts', route: { kind: 'instructor-roster' }, kinds: ['instructor-roster'] },
  { label: 'Feedback', route: { kind: 'instructor-feedback' }, kinds: ['instructor-feedback'] },
  { label: 'Notes', route: { kind: 'instructor-notes' }, kinds: ['instructor-notes'] },
];

/**
 * The shell shared by all instructor views: the site's page shell with the
 * app nav (Instructor current), the instructor sections as a sub-nav, the
 * signed-in identity and Log out, and a wide content column for the
 * gradebook and roster tables. Only instructor accounts get here
 * (InstructorGate), so the Instructor nav item is a given.
 */
export function InstructorLayout({ route, children }: { route: InstructorRoute; children: ReactNode }) {
  const subnav = SECTIONS.map((s) => ({ label: s.label, route: s.route, current: s.kinds.includes(route.kind) }));
  return (
    <PageShell
      nav={appNav('instructor', true)}
      subnav={subnav}
      width="wide"
      session={<SessionControls feedback={false} />}
    >
      {children}
    </PageShell>
  );
}
