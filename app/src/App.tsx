import { TabBar } from './components/TabBar';
import { EditorShell } from './components/EditorShell';
import { ComponentLibrary } from './components/ComponentLibrary';
import { CircuitCanvas } from './components/CircuitCanvas';
import { DataTable } from './components/DataTable';
import { SimulationToolbar } from './components/SimulationPanel';
import { SequentialTimeline } from './components/SequentialTimeline';
import { TMTapePanel } from './components/TMTapePanel';
import { TurbotTapePanel } from './components/TurbotTapePanel';
import { OpenResponsePanel } from './components/OpenResponsePanel';
import { FillInPanel } from './components/FillInPanel';
import { HomeScreen } from './components/HomeScreen';
import { AssignmentOverview } from './components/AssignmentOverview';
import { InstructorApp } from './instructor/InstructorApp';
import { useInstructorRoute } from './instructor/useInstructorRoute';
import { useStore, selectEffectiveMode } from './store';
import { useAuth } from './auth';
import { questionTask } from './types';
import { useEffect } from 'react';

function App() {
  const { user } = useAuth();
  const instructorRoute = useInstructorRoute();
  const workbookOpen = useStore((s) => s.workbookOpen);
  const buildMode = useStore((s) => s.buildMode);
  const effectiveMode = useStore(selectEffectiveMode);
  const assignment = useStore((s) => s.assignment);
  const assignmentView = useStore((s) => s.assignmentView);
  const currentQuestionIndex = useStore((s) => s.currentQuestionIndex);

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
  // top bar, the question panel, the workspace, the output panel). An open
  // question's workspace is a writing area and it has no output panel; a
  // fill-in question (types.ts questionTask) narrows the writing area to a
  // grid of labelled boxes, which IS autograded.
  if (buildMode === 'open') {
    const q = assignment?.questions[currentQuestionIndex];
    return <EditorShell>{q && questionTask(q) === 'fill-in' ? <FillInPanel /> : <OpenResponsePanel />}</EditorShell>;
  }

  return (
    <EditorShell output={<DataTable />}>
      {/* The sandbox's worksheet tabs, over its canvas (no question panel). */}
      {!assignment && <TabBar />}
      <SimulationToolbar />
      <div className="main-area">
        <ComponentLibrary />
        <div className="canvas-and-timeline">
          {/* Turbot questions: the arena ("Map") lives in the output panel
              (DataTable's turbot branch), not here — the canvas column is the
              inner machine's normal editor. A TM-brained turbot shows its
              internal tape (read-only: turbots start on a blank tape). */}
          <CircuitCanvas />
          {buildMode !== 'FSM' && buildMode !== 'TM' && buildMode !== 'turbot' && <SequentialTimeline />}
          {buildMode === 'TM' && <TMTapePanel />}
          {buildMode === 'turbot' && effectiveMode === 'TM' && <TurbotTapePanel />}
        </div>
      </div>
    </EditorShell>
  );
}

export default App;
