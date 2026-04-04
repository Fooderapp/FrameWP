import React, { useEffect, useRef, useState } from 'react';
import LeftPanel from '../panels/LeftPanel';
import InfiniteCanvas from '../canvas/InfiniteCanvas';
import PropertiesPanel from '../panels/PropertiesPanel';
import { ASSET_STORAGE_COMPONENT_ID, getLiveComponentEditorVariants, useEditorStore } from '../store/editorStore';
import ComponentPlayPreview from './ComponentPlayPreview';
import ComponentVariablesModal from './ComponentVariablesModal';
import BottomToolbar from './BottomToolbar';
import { IconButton, UIIcons } from './UIIcons';

function isDefaultVariant(variant) {
  return (variant?.mode ?? 'default') === 'default';
}

function getBaseVariantId(variants, variantId) {
  const current = (variants ?? []).find((variant) => variant.id === variantId) ?? null;
  if (!current) return (variants ?? []).find(isDefaultVariant)?.id ?? null;
  return isDefaultVariant(current) ? current.id : (current.parentVariantId ?? null);
}

export default function ComponentEditorOverlay() {
  const [playModeOpen, setPlayModeOpen] = useState(false);
  const [variablesModalOpen, setVariablesModalOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(312);
  const resizeStateRef = useRef(null);
  const componentEditor = useEditorStore(s => s.componentEditor);
  const components = useEditorStore(s => s.components);
  const previewVariants = useEditorStore(s => getLiveComponentEditorVariants(s.componentEditor));
  const closeComponentEditor = useEditorStore(s => s.closeComponentEditor);
  const selectComponentEditorVariant = useEditorStore(s => s.selectComponentEditorVariant);
  const addComponentVariant = useEditorStore(s => s.addComponentVariant);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);

  const component = components.find(item => item.id === componentEditor.componentId);
  const isAssetStorage = componentEditor.componentId === ASSET_STORAGE_COMPONENT_ID;
  const activeVariantId = componentEditor.activeVariantId;
  const componentName = componentEditor.page?.title || component?.name || 'Component';
  const defaultVariants = (componentEditor.variants ?? []).filter(isDefaultVariant);
  const activeBaseVariantId = getBaseVariantId(componentEditor.variants ?? [], activeVariantId);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const state = resizeStateRef.current;
      if (!state) return;
      if (state.side === 'left') {
        const nextWidth = Math.min(420, Math.max(220, event.clientX - state.containerLeft));
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

  if (!componentEditor.isOpen || !component) return null;

  return (
    <div className="fb-component-editor-overlay">
      <div className="fb-component-editor-overlay__header">
        <div>
          <div className="fb-component-editor-overlay__eyebrow">{isAssetStorage ? 'Assets' : 'Component'}</div>
          <div className="fb-component-editor-overlay__title">{componentName}</div>
          {!isAssetStorage ? (
            <div className="fb-component-editor-overlay__variants">
              {defaultVariants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  className={`fb-component-editor-overlay__chip${variant.id === activeBaseVariantId ? ' fb-component-editor-overlay__chip--active' : ''}`}
                  onClick={() => selectComponentEditorVariant(variant.id)}
                >
                  {variant.name}
                </button>
              ))}
              {activeVariantId ? (
                <button
                  type="button"
                  className="fb-component-editor-overlay__chip-add"
                  title="Add variant from selection"
                  onClick={addComponentVariant}
                >
                  +
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="fb-component-editor-overlay__actions">
          <IconButton icon={UIIcons.undo} title="Undo (Cmd/Ctrl+Z)" onClick={undo} />
          <IconButton icon={UIIcons.redo} title="Redo (Cmd/Ctrl+Shift+Z)" onClick={redo} />
          {!isAssetStorage ? (
            <>
              <IconButton icon={UIIcons.variables} title="Component variables" onClick={() => setVariablesModalOpen(true)} />
              <button
                type="button"
                className="fb-secondary-btn"
                onClick={() => setVariablesModalOpen(true)}
              >
                Variables
              </button>
            </>
          ) : null}
          {!isAssetStorage ? <IconButton icon={UIIcons.play} title="Play test" onClick={() => setPlayModeOpen(true)} /> : null}
          <button
            type="button"
            className="fb-secondary-btn"
            onClick={closeComponentEditor}
          >
            Close
          </button>
        </div>
      </div>
      <div className="fb-editor fb-component-editor-overlay__body">
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
      <BottomToolbar showComments={false} />
      {variablesModalOpen && !isAssetStorage ? (
        <ComponentVariablesModal onClose={() => setVariablesModalOpen(false)} />
      ) : null}
      {playModeOpen && !isAssetStorage ? (
        <ComponentPlayPreview
          componentName={componentName}
          variants={previewVariants}
          initialVariantId={activeVariantId}
          onClose={() => setPlayModeOpen(false)}
        />
      ) : null}
    </div>
  );
}