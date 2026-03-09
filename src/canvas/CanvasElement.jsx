import React, { useState } from 'react';
import { useEditorStore, resolveElement } from '../store/editorStore';

export default function CanvasElement({ elementId, bpId, isSelected, onStartDrag, onStartResize, onDropOntoElement }) {
  const [dropOver, setDropOver] = useState(false);

  const el             = useEditorStore(s => s.getAllElements().find(e => e.id === elementId));
  const children       = useEditorStore(s => s.getChildElements(elementId));
  const setSelection   = useEditorStore(s => s.setSelection);
  const deleteElement  = useEditorStore(s => s.deleteElement);
  const selection      = useEditorStore(s => s.selection);
  const isHovered      = useEditorStore(s => s.hoveredId === elementId);
  const bpDef          = useEditorStore(s => s.breakpointDefs[bpId]);

  if (!el) return null;

  const resolved = resolveElement(el, bpId);
  const { id, locked } = el;
  const { x, y, width, height, hidden, rotation, styles, positionType, widthMode, heightMode } = resolved;

  if (hidden) return null;

  const isRelative = positionType === 'relative';
  const csW = widthMode === 'fill' ? '100%' : widthMode === 'hug' ? 'fit-content' : width;
  const csH = heightMode === 'fill' ? '100%' : heightMode === 'hug' ? 'fit-content' : height;

  // Off-canvas: element is completely outside this artboard's bounds (root elements only)
  const isOffCanvas = !el.parentId && bpDef && !isRelative
    ? (x + width <= 0 || x >= bpDef.width || y + height <= 0 || y >= bpDef.height)
    : false;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (locked) {
      setSelection({ elementId: id, bpId });
      return;
    }
    onStartDrag(e);
  };

  const handleKeyDown = (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.matches('input,textarea')) {
      if (isSelected) deleteElement(id);
    }
  };

  // ── Drop-onto for nesting ──────────────────────────────────
  const handleDragOver = (e) => {
    if (onDropOntoElement) {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(true);
    }
  };
  const handleDragLeave = () => setDropOver(false);
  const handleDrop = (e) => {
    setDropOver(false);
    if (onDropOntoElement) {
      e.preventDefault();
      e.stopPropagation();
      onDropOntoElement(e, id);
    }
  };

  const inlineStyle = {
    position: isRelative ? 'relative' : 'absolute',
    ...(isRelative
      ? { width: csW, height: csH }
      : { left: x, top: y, width: csW, height: csH }
    ),
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    backgroundColor:  styles?.backgroundColor,
    borderRadius:     typeof styles?.borderRadius === 'number' ? styles.borderRadius + 'px' : styles?.borderRadius,
    border: (styles?.borderWidth > 0)
      ? `${styles.borderWidth}px ${styles.borderStyle || 'solid'} ${styles.borderColor || '#000'}`
      : undefined,
    opacity:          styles?.opacity,
    overflow:         styles?.overflow,
    display:          styles?.display,
    flexDirection:    styles?.flexDirection,
    flexWrap:         styles?.flexWrap,
    gap:              typeof styles?.gap === 'number' ? styles.gap + 'px' : styles?.gap,
    paddingTop:       typeof styles?.paddingTop === 'number' ? styles.paddingTop + 'px' : styles?.paddingTop,
    paddingRight:     typeof styles?.paddingRight === 'number' ? styles.paddingRight + 'px' : styles?.paddingRight,
    paddingBottom:    typeof styles?.paddingBottom === 'number' ? styles.paddingBottom + 'px' : styles?.paddingBottom,
    paddingLeft:      typeof styles?.paddingLeft === 'number' ? styles.paddingLeft + 'px' : styles?.paddingLeft,
    alignItems:       styles?.alignItems,
    justifyContent:   styles?.justifyContent,
    boxShadow:        styles?.boxShadow || undefined,
    outline: dropOver ? '2px dashed #3b82f6' : undefined,
    cursor:  locked ? 'not-allowed' : 'move',
    zIndex:  isSelected ? 9999 : undefined,
    boxSizing: 'border-box',
  };

  return (
    <div
      className={`fb-el${isSelected ? ' fb-el--selected' : ''}${!isSelected && isHovered ? ' fb-el--hovered' : ''}${locked ? ' fb-el--locked' : ''}${isOffCanvas ? ' fb-el--offcanvas' : ''}`}
      style={inlineStyle}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={isSelected ? 0 : -1}
      data-id={id}
    >
      {/* Inline resize handles for relative-positioned selected elements */}
      {isRelative && isSelected && !locked && (
        <div className="fb-el-handles-wrap">
          {['nw','n','ne','e','se','s','sw','w'].map(h => (
            <div
              key={h}
              className={`fb-sel-overlay__handle fb-sel-overlay__handle--${h}`}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartResize && onStartResize(e, h); }}
            />
          ))}
        </div>
      )}

      {/* Child elements — rendered relative to this element */}
      {children.map(child => (
        <CanvasElement
          key={child.id}
          elementId={child.id}
          bpId={bpId}
          isSelected={selection?.elementId === child.id}
          onStartDrag={(e) => {
            e.stopPropagation();
            onStartDrag(e);
          }}
          onStartResize={(e, handle) => {
            e.stopPropagation();
            onStartResize(e, handle);
          }}
          onDropOntoElement={onDropOntoElement}
        />
      ))}
    </div>
  );
}
