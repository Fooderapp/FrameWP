import React, { useEffect, useRef, useState } from 'react';
import TopBar from './panels/TopBar';
import LeftPanel from './panels/LeftPanel';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import PropertiesPanel from './panels/PropertiesPanel';
import ComponentEditorOverlay from './components/ComponentEditorOverlay';
import VariablesModal from './components/VariablesModal';
import { useEditorStore } from './store/editorStore';

export default function App() {
  const loadLayout = useEditorStore(s => s.loadLayout);
  const loadComponents = useEditorStore(s => s.loadComponents);
  const loadGlobalVariables = useEditorStore(s => s.loadGlobalVariables);
  const loadVariableSources = useEditorStore(s => s.loadVariableSources);
  const pushHistory = useEditorStore(s => s.pushHistory);
  const saveLayout = useEditorStore(s => s.saveLayout);
  const componentEditorOpen = useEditorStore(s => s.componentEditor.isOpen);
  const pages = useEditorStore(s => s.pages);
  const currentPageId = useEditorStore(s => s.currentPageId);
  const breakpointDefs = useEditorStore(s => s.breakpointDefs);
  const activeSurface = useEditorStore(s => s.activeSurface);
  const componentEditor = useEditorStore(s => s.componentEditor);
  const components = useEditorStore(s => s.components);
  const variablesModalOpen = useEditorStore(s => s.variablesModalOpen);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(312);
  const resizeStateRef = useRef(null);
  const autoSaveReadyRef = useRef(false);
  const autoSaveTimerRef = useRef(null);

  useEffect(() => {
    (async () => {
      const layoutState = await loadLayout();
      await Promise.all([
        layoutState?.hasStoredComponentLibrary ? Promise.resolve() : loadComponents(),
        loadGlobalVariables(),
        loadVariableSources(),
      ]);
      pushHistory();
      autoSaveReadyRef.current = true;
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
  }, []);

  useEffect(() => {
    if (!autoSaveReadyRef.current) return;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      saveLayout();
    }, 700);
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [saveLayout, pages, currentPageId, breakpointDefs, activeSurface, componentEditor, components]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const state = resizeStateRef.current;
      if (!state) return;
      if (state.side === 'left') {
        const nextWidth = Math.min(420, Math.max(180, event.clientX - state.containerLeft));
        setLeftWidth(nextWidth);
        return;
      }
      const nextWidth = Math.min(420, Math.max(260, state.containerRight - event.clientX));
      setRightWidth(nextWidth);
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      document.body.classList.remove('fb-is-resizing-panels');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, []);

  const startResize = (side) => (event) => {
    const container = event.currentTarget.parentElement;
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    resizeStateRef.current = {
      side,
      containerLeft: rect.left,
      containerRight: rect.right,
    };
    document.body.classList.add('fb-is-resizing-panels');
    event.preventDefault();
  };

  return (
    <div className="fb-app">
      <TopBar />
      <div className="fb-editor">
        <div className="fb-side-shell fb-side-shell--left" style={{ width: leftWidth }}>
          <LeftPanel />
          <button type="button" className="fb-panel-resize-handle fb-panel-resize-handle--left" aria-label="Resize left panel" onPointerDown={startResize('left')} />
        </div>
        <InfiniteCanvas />
        <div className="fb-side-shell fb-side-shell--right" style={{ width: rightWidth }}>
          <button type="button" className="fb-panel-resize-handle fb-panel-resize-handle--right" aria-label="Resize right panel" onPointerDown={startResize('right')} />
          <PropertiesPanel />
        </div>
      </div>
        {variablesModalOpen ? <VariablesModal /> : null}
      {componentEditorOpen ? <ComponentEditorOverlay /> : null}
    </div>
  );
}
