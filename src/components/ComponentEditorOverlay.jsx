import React, { useState } from 'react';
import LeftPanel from '../panels/LeftPanel';
import InfiniteCanvas from '../canvas/InfiniteCanvas';
import PropertiesPanel from '../panels/PropertiesPanel';
import { useEditorStore } from '../store/editorStore';
import ComponentPlayPreview from './ComponentPlayPreview';
import { IconButton, UIIcons } from './UIIcons';

export default function ComponentEditorOverlay() {
  const [playModeOpen, setPlayModeOpen] = useState(false);
  const componentEditor = useEditorStore(s => s.componentEditor);
  const components = useEditorStore(s => s.components);
  const closeComponentEditor = useEditorStore(s => s.closeComponentEditor);
  const selectComponentEditorVariant = useEditorStore(s => s.selectComponentEditorVariant);
  const addComponentVariant = useEditorStore(s => s.addComponentVariant);

  const component = components.find(item => item.id === componentEditor.componentId);
  const activeVariantId = componentEditor.activeVariantId;

  if (!componentEditor.isOpen || !component) return null;

  return (
    <div className="fb-component-editor-overlay">
      <div className="fb-component-editor-overlay__header">
        <div>
          <div className="fb-component-editor-overlay__eyebrow">Component</div>
          <div className="fb-component-editor-overlay__title">{component.name}</div>
          <div className="fb-component-editor-overlay__variants">
            {(componentEditor.variants ?? []).map((variant) => (
              <button
                key={variant.id}
                type="button"
                className={`fb-component-editor-overlay__chip${variant.id === activeVariantId ? ' fb-component-editor-overlay__chip--active' : ''}`}
                onClick={() => selectComponentEditorVariant(variant.id)}
              >
                {variant.name}
              </button>
            ))}
            <button
              type="button"
              className="fb-component-editor-overlay__chip-add"
              title="Add variant"
              onClick={addComponentVariant}
            >
              +
            </button>
          </div>
        </div>
        <div className="fb-component-editor-overlay__actions">
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
        <LeftPanel />
        <InfiniteCanvas />
        <PropertiesPanel />
      </div>
      {playModeOpen ? (
        <ComponentPlayPreview
          componentName={component.name}
          variants={componentEditor.variants ?? []}
          initialVariantId={activeVariantId}
          onClose={() => setPlayModeOpen(false)}
        />
      ) : null}
    </div>
  );
}