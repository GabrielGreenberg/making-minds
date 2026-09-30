import { TabBar } from './components/TabBar';
import { EditorShell } from './components/EditorShell';
import { EditorTopBar } from './components/EditorTopBar';
import { EditorWorkspace } from './components/EditorWorkspace';
import { questionSidePanel } from './components/QuestionPanel';
import { VisitorBanner } from './components/VisitorBanner';
import { OutputPanel } from './components/OutputPanel';
import { Worksheet } from './components/Worksheet';
import { HomeScreen } from './components/HomeScreen';
import { AssignmentOverview } from './components/AssignmentOverview';
import { InstructorApp } from './instructor/InstructorApp';
import { useInstructorRoute } from './instructor/useInstructorRoute';
import { InstructorGate } from './instructor/InstructorGate';
import { useRoute } from './useRoute';
import { useStore } from './store';
import { useAuth } from './auth';
import { useEffect } from 'react';

function App() {
  const route = useRoute();
  // Another person's attempt in the editor (task 067) is the instructor's
  // alone: the editor renders behind the same gate as the instructor area.
  const foreign = route.kind === 'assignment' && route.student != null;
  const editor = <AppEditor />;
  return foreign ? <InstructorGate>{editor}</InstructorGate> : editor;
}

function AppEditor() {
  const { user, isVisitor } = useAuth();
  const instructorRoute = useInstructorRoute();
  const workbookOpen = useStore((s) => s.workbookOpen);
  const buildMode = useStore((s) => s.buildMode);
  const assignment = useStore((s) => s.assignment);
  const assignmentView = useStore((s) => s.assignmentView);

  // Hydrate the latest-submission map from the submission seam once someone
  // is signed in (a visitor's sandbox reads no seam). Idempotent, so
  // StrictMode's double effect and a re-sign-in are harmless.
  useEffect(() => {
    if (!user) return;
    // A transient fetch failure just leaves the latest-submission map empty
    // (cards read "Not submitted" until the next mount); don't crash the shell.
    useStore.getState().hydrateSubmissions().catch((e: unknown) => {
      console.warn('submission hydration failed:', e);
    });
  }, [user]);

  // Instructor frontend: a separate mode of the same SPA, gated behind the
  // instructor role. It bypasses the student Zustand store and reads the hash
  // directly (see useInstructorRoute).
  if (instructorRoute) return <InstructorApp route={instructorRoute} />;

  // A visitor only ever reaches the sandbox (AuthGate), which the routing
  // opens in an effect — render nothing for that first frame, never Home.
  if (!workbookOpen) return user ? <HomeScreen /> : null;

  // An open assignment shows its question list first; a question's dedicated
  // canvas (below) is entered by picking a question (#/a/:id/q/:i).
  if (assignment && assignmentView === 'overview') return <AssignmentOverview />;

  // Every question and the sandbox render inside ONE frame (EditorShell: the
  // top bar, the question panel, the workspace, the output panel), the app
  // handing it its chrome (task 087): its top bar, the visitor banner, and the
  // question panel only in an assignment. A written problem's workspace is its
  // worksheet — the problem's text with each part's field (a line, a
  // paragraph, blanks or a table) after its prompt — and it has no output
  // panel.
  const bar = <EditorTopBar />;
  const banner = isVisitor ? <VisitorBanner /> : undefined;
  const question = assignment ? questionSidePanel : undefined;
  if (buildMode === 'open') {
    return <EditorShell bar={bar} banner={banner} question={question}><Worksheet /></EditorShell>;
  }

  return (
    <EditorShell bar={bar} banner={banner} question={question} output={<OutputPanel />}>
      {/* The sandbox's worksheet tabs, over its canvas (no question panel). */}
      {!assignment && <TabBar />}
      <EditorWorkspace />
    </EditorShell>
  );
}

export default App;
