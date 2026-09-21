import type { ReactNode } from 'react';
import { PageShell, appNav } from '../components/PageShell';
import { SessionControls } from '../components/SessionControls';

/**
 * The shell shared by all instructor views: the site's page shell with the
 * app nav (Instructor current), the signed-in identity and Log out, and a
 * wide content column for the gradebook and roster tables. Only instructor
 * accounts get here (InstructorGate), so the Instructor nav item is a given.
 */
export function InstructorLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell nav={appNav('instructor', true)} width="wide" session={<SessionControls feedback={false} />}>
      {children}
    </PageShell>
  );
}
