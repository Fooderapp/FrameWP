import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { IconButton, UIIcons } from '../components/UIIcons';

export default function ComponentsPanel() {
  const components = useEditorStore(s => s.components);
  const openComponentEditor = useEditorStore(s => s.openComponentEditor);
  const deleteComponent = useEditorStore(s => s.deleteComponent);

  const handleDragStart = (e, component) => {
    e.dataTransfer.setData('fb-component-id', component.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div>
      <div className="fb-section-label">Components</div>
      <div className="fb-assets-list">
        {components.map((component) => (
          <div
            key={component.id}
            className="fb-asset-card"
            draggable
            onDragStart={(e) => handleDragStart(e, component)}
            onDoubleClick={() => openComponentEditor(component.id)}
          >
            <div className="fb-asset-card__icon">{UIIcons.component}</div>
            <div className="fb-asset-card__meta">
              <div className="fb-asset-card__title">{component.name}</div>
              <div className="fb-asset-card__sub">Global component</div>
            </div>
            <div className="fb-asset-card__actions">
              <IconButton
                icon={UIIcons.trash}
                title="Delete component"
                className="fb-asset-card__delete-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteComponent(component.id);
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {components.length === 0 && (
        <div className="fb-layers-empty" style={{ paddingTop: 16 }}>
          Create a component from the canvas, then drag it from here onto any artboard.
        </div>
      )}
    </div>
  );
}