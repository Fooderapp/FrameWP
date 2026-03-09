import React, { useEffect } from 'react';
import TopBar from './panels/TopBar';
import LeftPanel from './panels/LeftPanel';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import PropertiesPanel from './panels/PropertiesPanel';
import { useEditorStore } from './store/editorStore';

export default function App() {
  const loadLayout = useEditorStore(s => s.loadLayout);
  const pushHistory = useEditorStore(s => s.pushHistory);

  useEffect(() => {
    loadLayout().then(() => pushHistory());
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
    </div>
  );
}
