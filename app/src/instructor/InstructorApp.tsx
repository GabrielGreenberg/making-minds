// Instructor frontend root. Switches between the instructor views based on the
// current instructor route, wrapped in the role gate and shared layout. Rendered
// by App when the URL hash is under #/instructor (see App.tsx).

import { InstructorGate } from './InstructorGate';
import { InstructorLayout } from './InstructorLayout';
import { InstructorDashboard } from './InstructorDashboard';
import { AssignmentEditor } from './AssignmentEditor';
import { GradebookView } from './GradebookView';
import type { InstructorRoute } from './useInstructorRoute';

export function InstructorApp({ route }: { route: InstructorRoute }) {
  return (
    <InstructorGate>
      <InstructorLayout>
        <InstructorView route={route} />
      </InstructorLayout>
    </InstructorGate>
  );
}

function InstructorView({ route }: { route: InstructorRoute }) {
  // The new-assignment route is created straight from the dashboard (it prompts
  // for a title and navigates to the editor), so it is only reachable via a deep
  // link — show the dashboard rather than a dead end.
  switch (route.kind) {
    case 'instructor':
    case 'instructor-new-assignment':
      return <InstructorDashboard />;
    case 'instructor-edit':
      return <AssignmentEditor id={route.id} />;
    case 'instructor-submissions':
      return <GradebookView id={route.id} />;
  }
}
