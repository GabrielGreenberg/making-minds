import { MenuBar } from './components/MenuBar';
import { TabBar } from './components/TabBar';
import { ComponentLibrary } from './components/ComponentLibrary';
import { CircuitCanvas } from './components/CircuitCanvas';
import { DataTable } from './components/DataTable';
import { SimulationToolbar } from './components/SimulationPanel';
import { SequentialTimeline } from './components/SequentialTimeline';

function App() {
  return (
    <div className="app">
      <MenuBar />
      <TabBar />
      <SimulationToolbar />
      <div className="main-area">
        <ComponentLibrary />
        <div className="canvas-and-timeline">
          <CircuitCanvas />
          <SequentialTimeline />
        </div>
        <DataTable />
      </div>
    </div>
  );
}

export default App;
