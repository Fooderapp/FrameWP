import React, { useEffect, useRef, useState } from 'react';
import TopBar from './panels/TopBar';
import LeftPanel from './panels/LeftPanel';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import PropertiesPanel from './panels/PropertiesPanel';
import CommentsPanel from './panels/CommentsPanel';
import ComponentEditorOverlay from './components/ComponentEditorOverlay';
import IconLibraryModal from './components/IconLibraryModal';
import FlowEditorModal from './components/FlowEditorModal';
import VariablesModal from './components/VariablesModal';
import BottomToolbar from './components/BottomToolbar';
import { ICON_PACK_MANIFEST, warmIconPackPreviewCache } from './components/iconCatalog';
import { useEditorStore } from './store/editorStore';

export default function App() {
  const loadLayout = useEditorStore(s => s.loadLayout);
  const loadComponents = useEditorStore(s => s.loadComponents);
  const loadGlobalVariables = useEditorStore(s => s.loadGlobalVariables);
  const loadVariableSources = useEditorStore(s => s.loadVariableSources);
  const repairComponentEditorState = useEditorStore(s => s.repairComponentEditorState);
  const acquireDocumentLock = useEditorStore(s => s.acquireDocumentLock);
  const refreshDocumentLock = useEditorStore(s => s.refreshDocumentLock);
  const releaseDocumentLock = useEditorStore(s => s.releaseDocumentLock);
  const documentLock = useEditorStore(s => s.documentLock);
  const pushHistory = useEditorStore(s => s.pushHistory);
  const saveLayout = useEditorStore(s => s.saveLayout);
  const componentEditorOpen = useEditorStore(s => s.componentEditor.isOpen);
  const pages = useEditorStore(s => s.pages);
  const currentPageId = useEditorStore(s => s.currentPageId);
  const breakpointDefs = useEditorStore(s => s.breakpointDefs);
  const activeSurface = useEditorStore(s => s.activeSurface);
  const components = useEditorStore(s => s.components);
  const componentEditorComponentId = useEditorStore(s => s.componentEditor.componentId);
  const componentEditorActiveVariantId = useEditorStore(s => s.componentEditor.activeVariantId);
  const componentEditorVariantCount = useEditorStore(s => s.componentEditor.variants?.length ?? 0);
  const componentEditorPageElementCount = useEditorStore(s => s.componentEditor.page?.elements?.length ?? 0);
  const componentHistoryIndex = useEditorStore(s => s.componentHistoryIndex);
  const variablesModalOpen = useEditorStore(s => s.variablesModalOpen);
  const flowEditorState = useEditorStore(s => s.flowEditorState);
  const iconLibraryModal = useEditorStore(s => s.iconLibraryModal);
  const closeIconLibraryModal = useEditorStore(s => s.closeIconLibraryModal);
  const applyIconLibrarySelection = useEditorStore(s => s.applyIconLibrarySelection);
  const getAllElements = useEditorStore(s => s.getAllElements);
  const activeCanvasTool = useEditorStore(s => s.activeCanvasTool);
  const activeCommentId = useEditorStore(s => s.activeCommentId);
  const [leftWidth, setLeftWidth] = useState(244);
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
      await acquireDocumentLock();
      repairComponentEditorState();
      pushHistory();
      autoSaveReadyRef.current = true;
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    repairComponentEditorState();
  }, [
    repairComponentEditorState,
    activeSurface,
    componentEditorOpen,
    componentEditorComponentId,
    componentEditorActiveVariantId,
    componentEditorVariantCount,
    components,
  ]);

  useEffect(() => () => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
  }, []);

  useEffect(() => {
    const postId = parseInt(window.fbData?.postId, 10);
    if (!window.fbData || !(postId > 0)) return undefined;

    const intervalId = window.setInterval(() => {
      refreshDocumentLock();
    }, 45000);

    return () => window.clearInterval(intervalId);
  }, [refreshDocumentLock]);

  useEffect(() => {
    const handlePageHide = () => {
      if (!useEditorStore.getState().documentLock.isOwner) return;
      useEditorStore.getState().releaseDocumentLock({ useBeacon: true });
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [releaseDocumentLock]);

  useEffect(() => {
    const warmPacks = () => {
      ICON_PACK_MANIFEST.forEach((pack) => {
        warmIconPackPreviewCache(pack.id, 64).catch(() => {});
      });
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(warmPacks, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timer = window.setTimeout(warmPacks, 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!autoSaveReadyRef.current) return;
    if (documentLock.isLockedByOther) {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      return undefined;
    }
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      saveLayout();
    }, 700);
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    saveLayout,
    documentLock.isLockedByOther,
    pages,
    currentPageId,
    breakpointDefs,
    activeSurface,
    componentEditorOpen,
    componentEditorComponentId,
    componentHistoryIndex,
  ]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const state = resizeStateRef.current;
      if (!state) return;
      if (state.side === 'left') {
        const nextWidth = Math.min(320, Math.max(220, event.clientX - state.containerLeft));
        setLeftWidth(nextWidth);
        return;
      }
      const nextWidth = Math.min(360, Math.max(280, state.containerRight - event.clientX));
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

  const iconLibraryTarget = iconLibraryModal?.targetId
    ? getAllElements().find((element) => element.id === iconLibraryModal.targetId) ?? null
    : null;

  const handleIconLibrarySelect = (icon) => {
    applyIconLibrarySelection(icon);
  };

  const showCommentsPanel = activeSurface === 'page' && (activeCanvasTool === 'comment' || !!activeCommentId);
  const lockHolderName = documentLock.holder?.displayName?.trim() || 'Another editor';
  const isReadOnly = documentLock.isLockedByOther;
  const handleRetryDocumentLock = () => {
    refreshDocumentLock();
  };

  return (
    <div className="fb-app">
      <TopBar />
      <div className={`fb-editor${isReadOnly ? ' fb-editor--locked' : ''}`}>
        <div className="fb-side-shell fb-side-shell--left" style={{ width: leftWidth }}>
          <LeftPanel />
          <button type="button" className="fb-panel-resize-handle fb-panel-resize-handle--left" aria-label="Resize left panel" onPointerDown={startResize('left')} />
        </div>
        <InfiniteCanvas />
        <div className="fb-side-shell fb-side-shell--right" style={{ width: rightWidth }}>
          <button type="button" className="fb-panel-resize-handle fb-panel-resize-handle--right" aria-label="Resize right panel" onPointerDown={startResize('right')} />
          {showCommentsPanel ? <CommentsPanel /> : <PropertiesPanel />}
        </div>
        {isReadOnly ? (
          <div className="fb-editor-lock-overlay" role="status" aria-live="polite">
            <div className="fb-editor-lock-overlay__card">
              <span className="fb-editor-lock-overlay__eyebrow">Read only</span>
              <h2>{lockHolderName} is editing this page</h2>
              <p>
                Editing is temporarily locked to avoid conflicting changes. This screen will unlock automatically when the lock is released.
              </p>
              <button type="button" className="fb-secondary-btn" onClick={handleRetryDocumentLock}>
                Check again
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {isReadOnly ? null : <BottomToolbar />}
      {flowEditorState.open ? <FlowEditorModal /> : null}
      {variablesModalOpen ? <VariablesModal /> : null}
      {iconLibraryModal ? (
        <IconLibraryModal
          onClose={closeIconLibraryModal}
          onSelect={handleIconLibrarySelect}
          isTargetMissing={!iconLibraryTarget || iconLibraryTarget.type !== 'icon'}
        />
      ) : null}
      {componentEditorOpen ? <ComponentEditorOverlay /> : null}
    </div>
  );
}
