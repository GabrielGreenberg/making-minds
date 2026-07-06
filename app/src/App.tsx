import { TabBar } from './components/TabBar';
import { MenuBar } from './components/MenuBar';
import { ComponentLibrary } from './components/ComponentLibrary';
import { CircuitCanvas } from './components/CircuitCanvas';
import { DataTable } from './components/DataTable';
import { SimulationToolbar } from './components/SimulationPanel';
import { SequentialTimeline } from './components/SequentialTimeline';
import { TMTapePanel } from './components/TMTapePanel';
import { TurbotTapePanel } from './components/TurbotTapePanel';
import { HomeScreen } from './components/HomeScreen';
import { AssignmentOverview } from './components/AssignmentOverview';
import { InstructorApp } from './instructor/InstructorApp';
import { useInstructorRoute } from './instructor/useInstructorRoute';
import { useStore, selectEffectiveMode } from './store';

function App() {
  const instructorRoute = useInstructorRoute();
  const workbookOpen = useStore((s) => s.workbookOpen);
  const buildMode = useStore((s) => s.buildMode);
  const effectiveMode = useStore(selectEffectiveMode);
  const assignment = useStore((s) => s.assignment);
  const assignmentView = useStore((s) => s.assignmentView);

  // Instructor frontend: a separate mode of the same SPA, gated behind the
  // instructor role. It bypasses the student Zustand store and reads the hash
  // directly (see useInstructorRoute).
  if (instructorRoute) return <InstructorApp route={instructorRoute} />;

  if (!workbookOpen) return <HomeScreen />;

  // An open assignment shows its question list first; a question's dedicated
  // canvas (below) is entered by picking a question (#/a/:id/q/:i).
  if (assignment && assignmentView === 'overview') return <AssignmentOverview />;

  return (
    <div className="app">
      <MenuBar />
      <TabBar />
      <SimulationToolbar />
      <div className="main-area">
        <ComponentLibrary />
        <div className="canvas-and-timeline">
          {/* Turbot questions: the arena ("Map") lives in the right data
              panel (DataTable's turbot branch), not here — the canvas column
              is the inner machine's normal editor. A TM-brained turbot shows
              its internal tape (read-only: turbots start on a blank tape). */}
          <CircuitCanvas />
          {buildMode !== 'FSM' && buildMode !== 'TM' && buildMode !== 'turbot' && <SequentialTimeline />}
          {buildMode === 'TM' && <TMTapePanel />}
          {buildMode === 'turbot' && effectiveMode === 'TM' && <TurbotTapePanel />}
        </div>
        <DataTable />
      </div>
    </div>
  );
}

export default App;
