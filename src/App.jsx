import React, { useEffect } from 'react';
import TopBar from './panels/TopBar';
import LeftPanel from './panels/LeftPanel';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import PropertiesPanel from './panels/PropertiesPanel';
import ComponentEditorOverlay from './components/ComponentEditorOverlay';
import { useEditorStore } from './store/editorStore';

export default function App() {
  const loadLayout = useEditorStore(s => s.loadLayout);
  const loadComponents = useEditorStore(s => s.loadComponents);
  const pushHistory = useEditorStore(s => s.pushHistory);
  const componentEditorOpen = useEditorStore(s => s.componentEditor.isOpen);

  useEffect(() => {
    Promise.all([loadLayout(), loadComponents()]).then(() => pushHistory());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fb-app">
      <TopBar />
      <div className="fb-editor">
        <LeftPanel />
        <InfiniteCanvas />
        <PropertiesPanel />
      </div>
      {componentEditorOpen ? <ComponentEditorOverlay /> : null}
    </div>
  );
}
