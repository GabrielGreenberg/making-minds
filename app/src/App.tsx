import { TabBar } from './components/TabBar';
import { ComponentLibrary } from './components/ComponentLibrary';
import { CircuitCanvas } from './components/CircuitCanvas';
import { DataTable } from './components/DataTable';
import { SimulationToolbar } from './components/SimulationPanel';
import { SequentialTimeline } from './components/SequentialTimeline';
import { useStore } from './store';

function App() {
  const buildMode = useStore((s) => s.buildMode);

  return (
    <div className="app">
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
