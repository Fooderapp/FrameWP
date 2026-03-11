import React, { useMemo } from 'react';
import LeftPanel from '../panels/LeftPanel';
import InfiniteCanvas from '../canvas/InfiniteCanvas';
import PropertiesPanel from '../panels/PropertiesPanel';
import { useEditorStore, resolveElement } from '../store/editorStore';

export default function ComponentEditorOverlay() {
  const componentEditor = useEditorStore(s => s.componentEditor);
  const components = useEditorStore(s => s.components);
  const closeComponentEditor = useEditorStore(s => s.closeComponentEditor);

  const component = components.find(item => item.id === componentEditor.componentId);
  const validationMessage = useMemo(() => {
    const elements = componentEditor.page?.elements ?? [];
    const primaryRoot = elements.find((el) => !el.parentId && el.componentRoot);
    const roots = primaryRoot
      ? elements.filter((el) => el.parentId === primaryRoot.id)
      : elements.filter((el) => !el.parentId && !el.componentRoot);
    if (roots.length === 0) return 'Add at least one layer inside Primary before closing the component editor.';
    const invalidFill = roots.find((el) => {
      const resolved = resolveElement(el, 'desktop');
      return resolved.widthMode === 'fill' || resolved.heightMode === 'fill';
    });
    if (invalidFill) {
      return 'Top-level component layers cannot use Fill on the free canvas. Switch them to Fixed, Relative, or Hug.';
    }
    const collapsed = roots.find((el) => {
      const resolved = resolveElement(el, 'desktop');
      return (resolved.width ?? 0) <= 20 || (resolved.height ?? 0) <= 20;
    });
    if (collapsed) {
      return 'A top-level component layer is collapsed. Increase its width and height above 20px before closing.';
    }
    return null;
  }, [componentEditor.page?.elements]);

  if (!componentEditor.isOpen || !component) return null;

  return (
    <div className="fb-component-editor-overlay">
      <div className="fb-component-editor-overlay__header">
        <div>
          <div className="fb-component-editor-overlay__eyebrow">Component</div>
          <div className="fb-component-editor-overlay__title">{component.name}</div>
          <div className="fb-component-editor-overlay__chip">Primary</div>
        </div>
        <button
          type="button"
          className="fb-secondary-btn"
          onClick={closeComponentEditor}
        >
          Close
        </button>
      </div>
      {validationMessage ? (
        <div className="fb-component-editor-overlay__warning">
          {validationMessage}
        </div>
      ) : null}
      <div className="fb-editor fb-component-editor-overlay__body">
        <LeftPanel />
        <InfiniteCanvas />
        <PropertiesPanel />
      </div>
    </div>
  );
}