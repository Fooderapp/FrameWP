import React, { useMemo } from 'react';
import LeftPanel from '../panels/LeftPanel';
import InfiniteCanvas from '../canvas/InfiniteCanvas';
import PropertiesPanel from '../panels/PropertiesPanel';
import { useEditorStore, resolveElement } from '../store/editorStore';

export default function ComponentEditorOverlay() {
  const componentEditor = useEditorStore(s => s.componentEditor);
  const components = useEditorStore(s => s.components);
  const closeComponentEditor = useEditorStore(s => s.closeComponentEditor);
  const selectComponentEditorVariant = useEditorStore(s => s.selectComponentEditorVariant);
  const addComponentVariant = useEditorStore(s => s.addComponentVariant);

  const component = components.find(item => item.id === componentEditor.componentId);
  const activeVariantId = componentEditor.activeVariantId;
  const validationMessage = useMemo(() => {
    const elements = componentEditor.page?.elements ?? [];
    const variantRoots = elements.filter((el) => !el.parentId && el.componentRoot);
    if (!variantRoots.length) return 'Add at least one variant before closing the component editor.';
    for (const variantRoot of variantRoots) {
      const roots = elements.filter((el) => el.parentId === variantRoot.id);
      if (!roots.length) {
        return `${variantRoot.componentVariantName || 'Variant'} needs at least one layer inside it before closing the component editor.`;
      }
      const invalidFill = roots.find((el) => {
        const resolved = resolveElement(el, 'desktop');
        return resolved.widthMode === 'fill' || resolved.heightMode === 'fill';
      });
      if (invalidFill) {
        return `${variantRoot.componentVariantName || 'Variant'} has a top-level layer using Fill. Switch it to Fixed, Relative, or Hug.`;
      }
      const collapsed = roots.find((el) => {
        const resolved = resolveElement(el, 'desktop');
        return (resolved.width ?? 0) <= 20 || (resolved.height ?? 0) <= 20;
      });
      if (collapsed) {
        return `${variantRoot.componentVariantName || 'Variant'} has a collapsed top-level layer. Increase its width and height above 20px before closing.`;
      }
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