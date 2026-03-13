import React, { useState } from 'react';
import LeftPanel from '../panels/LeftPanel';
import InfiniteCanvas from '../canvas/InfiniteCanvas';
import PropertiesPanel from '../panels/PropertiesPanel';
import { getLiveComponentEditorVariants, useEditorStore } from '../store/editorStore';
import ComponentPlayPreview from './ComponentPlayPreview';
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
  const componentEditor = useEditorStore(s => s.componentEditor);
  const components = useEditorStore(s => s.components);
  const previewVariants = useEditorStore(s => getLiveComponentEditorVariants(s.componentEditor));
  const closeComponentEditor = useEditorStore(s => s.closeComponentEditor);
  const selectComponentEditorVariant = useEditorStore(s => s.selectComponentEditorVariant);
  const addComponentVariant = useEditorStore(s => s.addComponentVariant);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);

  const component = components.find(item => item.id === componentEditor.componentId);
  const activeVariantId = componentEditor.activeVariantId;
  const defaultVariants = (componentEditor.variants ?? []).filter(isDefaultVariant);
  const activeBaseVariantId = getBaseVariantId(componentEditor.variants ?? [], activeVariantId);

  if (!componentEditor.isOpen || !component) return null;

  return (
    <div className="fb-component-editor-overlay">
      <div className="fb-component-editor-overlay__header">
        <div>
          <div className="fb-component-editor-overlay__eyebrow">Component</div>
          <div className="fb-component-editor-overlay__title">{component.name}</div>
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
        </div>
        <div className="fb-component-editor-overlay__actions">
          <IconButton icon={UIIcons.undo} title="Undo (Cmd/Ctrl+Z)" onClick={undo} />
          <IconButton icon={UIIcons.redo} title="Redo (Cmd/Ctrl+Shift+Z)" onClick={redo} />
          <IconButton icon={UIIcons.play} title="Play test" onClick={() => setPlayModeOpen(true)} />
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
        <div className="fb-side-shell fb-side-shell--left" style={{ width: 240 }}>
          <LeftPanel />
        </div>
        <InfiniteCanvas />
        <div className="fb-side-shell fb-side-shell--right" style={{ width: 312 }}>
          <PropertiesPanel />
        </div>
      </div>
      {playModeOpen ? (
        <ComponentPlayPreview
          componentName={component.name}
          variants={previewVariants}
          initialVariantId={activeVariantId}
          onClose={() => setPlayModeOpen(false)}
        />
      ) : null}
    </div>
  );
}