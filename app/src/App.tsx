import { TabBar } from './components/TabBar';
import { MenuBar } from './components/MenuBar';
import { ComponentLibrary } from './components/ComponentLibrary';
import { CircuitCanvas } from './components/CircuitCanvas';
import { DataTable } from './components/DataTable';
import { SimulationToolbar } from './components/SimulationPanel';
import { SequentialTimeline } from './components/SequentialTimeline';
import { HomeScreen } from './components/HomeScreen';
import { useStore } from './store';

function App() {
  const workbookOpen = useStore((s) => s.workbookOpen);
  const buildMode = useStore((s) => s.buildMode);

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
