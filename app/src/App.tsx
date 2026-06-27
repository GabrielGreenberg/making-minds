import { TabBar } from './components/TabBar';
import { MenuBar } from './components/MenuBar';
import { ComponentLibrary } from './components/ComponentLibrary';
import { CircuitCanvas } from './components/CircuitCanvas';
import { DataTable } from './components/DataTable';
import { SimulationToolbar } from './components/SimulationPanel';
import { SequentialTimeline } from './components/SequentialTimeline';
import { HomeScreen } from './components/HomeScreen';
import { InstructorApp } from './instructor/InstructorApp';
import { useInstructorRoute } from './instructor/useInstructorRoute';
import { useStore } from './store';

function App() {
  const instructorRoute = useInstructorRoute();
  const workbookOpen = useStore((s) => s.workbookOpen);
  const buildMode = useStore((s) => s.buildMode);

  // Instructor frontend: a separate mode of the same SPA, gated behind the
  // instructor role. It bypasses the student Zustand store and reads the hash
  // directly (see useInstructorRoute).
  if (instructorRoute) return <InstructorApp route={instructorRoute} />;

  if (!workbookOpen) return <HomeScreen />;

  return (
    <div className="app">
      <MenuBar />
      <TabBar />
      <SimulationToolbar />
      <div className="main-area">
        <ComponentLibrary />
        <div className="canvas-and-timeline">
          <CircuitCanvas />
          {buildMode !== 'FSM' && <SequentialTimeline />}
        </div>
        <DataTable />
      </div>
    </div>
  );
}

export default App;
