import React, { useState } from 'react';
import { useEditorStore, resolveElement } from '../store/editorStore';

export default function CanvasElement({ elementId, bpId, isSelected, isDropTarget, dropTargetId, onStartElementDrag, onStartElementResize, onDropOntoElement, onStartRadiusDrag, onStartPaddingDrag, reorderTarget, artboardLayoutOn }) {
  const [dropOver, setDropOver] = useState(false);

  const el             = useEditorStore(s => s.getAllElements().find(e => e.id === elementId));
  const children       = useEditorStore(s => s.getChildElements(elementId));
  const setSelection   = useEditorStore(s => s.setSelection);
  const setHoveredId   = useEditorStore(s => s.setHoveredId);
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
  const isFixed    = positionType === 'fixed';
  // Auto-layout: treat as flow (relative) unless manually pinned with absoluteInLayout
  const isFlowInLayout = !!artboardLayoutOn && !resolved.absoluteInLayout;
  const effectiveRelative = isRelative || isFlowInLayout;
  const csW = widthMode === 'fill' ? '100%' : widthMode === 'hug' ? 'fit-content' : width;
  const csH = heightMode === 'fill' ? '100%' : heightMode === 'hug' ? 'fit-content' : height;

  // Off-canvas: only meaningful on desktop — tablet/mobile inherit desktop positions
  // which may overflow their narrower artboard, but that's expected behaviour not an error.
  const isOffCanvas = bpId === 'desktop' && !el.parentId && bpDef && !isRelative
    ? (x + width <= 0 || x >= bpDef.width || y + height <= 0 || y >= bpDef.height)
    : false;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (locked) {
      setSelection({ elementId: id, bpId });
      return;
    }
    onStartElementDrag && onStartElementDrag(e, bpId, { id });
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
    position: effectiveRelative ? 'relative' : 'absolute',
    ...(effectiveRelative
      ? { width: csW, height: csH }
      : { left: x, top: y, width: csW, height: csH }
    ),
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    backgroundColor:  styles?.backgroundColor,
    borderRadius: (() => {
      if (styles?.borderRadiusMode === 'independent') {
        const tl = typeof styles.borderRadiusTL === 'number' ? styles.borderRadiusTL : (styles.borderRadius ?? 0);
        const tr = typeof styles.borderRadiusTR === 'number' ? styles.borderRadiusTR : (styles.borderRadius ?? 0);
        const br = typeof styles.borderRadiusBR === 'number' ? styles.borderRadiusBR : (styles.borderRadius ?? 0);
        const bl = typeof styles.borderRadiusBL === 'number' ? styles.borderRadiusBL : (styles.borderRadius ?? 0);
        return `${tl}px ${tr}px ${br}px ${bl}px`;
      }
      return typeof styles?.borderRadius === 'number' ? styles.borderRadius + 'px' : styles?.borderRadius;
    })(),
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
    // Background image (frame fill)
    backgroundImage:    styles?.backgroundImage ? `url(${styles.backgroundImage})` : undefined,
    backgroundSize:     styles?.backgroundImage ? (styles?.backgroundSize ?? 'cover') : undefined,
    backgroundPosition: styles?.backgroundImage ? (styles?.backgroundPosition ?? 'center center') : undefined,
    backgroundRepeat:   styles?.backgroundImage && styles?.backgroundSize === 'repeat' ? 'repeat' : (styles?.backgroundImage ? 'no-repeat' : undefined),
    outline: dropOver ? '2px dashed #3b82f6' : isDropTarget ? '2px solid var(--accent-light)' : undefined,
    cursor:  locked ? 'not-allowed' : 'move',
    zIndex:  isSelected ? 9999 : undefined,
    boxSizing: 'border-box',
  };

  return (
    <div
      className={`fb-el${isSelected ? ' fb-el--selected' : ''}${!isSelected && isHovered ? ' fb-el--hovered' : ''}${!isSelected && isDropTarget ? ' fb-el--drop-target' : ''}${locked ? ' fb-el--locked' : ''}${isOffCanvas ? ' fb-el--offcanvas' : ''}${isFixed ? ' fb-el--fixed' : ''}${isFlowInLayout ? ' fb-el--flow' : ''}`}
      style={inlineStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={(e) => { e.stopPropagation(); setHoveredId(id); }}
      onMouseLeave={() => setHoveredId(null)}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={isSelected ? 0 : -1}
      data-id={id}
    >
      {/* Image element content */}
      {el.type === 'image' && (() => {
        const src = resolved.src ?? '';
        return src
          ? <img
              src={src}
              alt={el.name || ''}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: styles?.objectFit ?? 'cover',
                borderRadius: 'inherit',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
              draggable={false}
            />
          : <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(120,120,140,0.6)', fontSize: 11, pointerEvents: 'none',
              border: '1.5px dashed rgba(120,120,160,0.35)', borderRadius: 'inherit',
              gap: 4, flexDirection: 'column',
            }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="2" width="14" height="12" rx="1.5"/>
                <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
                <path d="M1 12l4-3.5 3 2.5 2.5-2 4.5 4"/>
              </svg>
              <span>Image</span>
            </div>;
      })()}
      {/* Padding handles — shaded zones + drag lines (when selected and padding > 0) */}
      {isSelected && !locked && onStartPaddingDrag && (() => {
        const toNum = v => typeof v === 'number' ? v : parseFloat(v) || 0;
        const pt = toNum(styles?.paddingTop);
        const pr = toNum(styles?.paddingRight);
        const pb = toNum(styles?.paddingBottom);
        const pl = toNum(styles?.paddingLeft);
        if (pt === 0 && pr === 0 && pb === 0 && pl === 0) return null;
        return (
          <>
            {pt > 0 && <div className="fb-pad-zone fb-pad-zone--top"    style={{ height: pt }} />}
            {pb > 0 && <div className="fb-pad-zone fb-pad-zone--bottom" style={{ height: pb }} />}
            {pl > 0 && <div className="fb-pad-zone fb-pad-zone--left"   style={{ width: pl, top: pt, bottom: pb }} />}
            {pr > 0 && <div className="fb-pad-zone fb-pad-zone--right"  style={{ width: pr, top: pt, bottom: pb }} />}
            {pt > 0 && <div className="fb-pad-line fb-pad-line--top"    style={{ top:    pt }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'top');    }} />}
            {pb > 0 && <div className="fb-pad-line fb-pad-line--bottom" style={{ bottom: pb }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'bottom'); }} />}
            {pl > 0 && <div className="fb-pad-line fb-pad-line--left"   style={{ left:   pl }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'left');   }} />}
            {pr > 0 && <div className="fb-pad-line fb-pad-line--right"  style={{ right:  pr }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'right');  }} />}
          </>
        );
      })()}
      {/* Inline resize handles for relative-positioned selected elements */}
      {(effectiveRelative) && isSelected && !locked && (
        <div className="fb-el-handles-wrap">
          {['nw','n','ne','e','se','s','sw','w'].map(h => (
            <div
              key={h}
              className={`fb-sel-overlay__handle fb-sel-overlay__handle--${h}`}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartElementResize && onStartElementResize(e, bpId, { id }, h); }}
            />
          ))}
          {onStartRadiusDrag && (() => {
            const isIndep = resolved.styles?.borderRadiusMode === 'independent';
            const corners = isIndep
              ? [
                  { corner: 'TL', style: { top: 'calc(10px * var(--inv-scale,1))',    left:  'calc(10px * var(--inv-scale,1))' } },
                  { corner: 'TR', style: { top: 'calc(10px * var(--inv-scale,1))',    right: 'calc(10px * var(--inv-scale,1))' } },
                  { corner: 'BL', style: { bottom: 'calc(10px * var(--inv-scale,1))', left:  'calc(10px * var(--inv-scale,1))' } },
                  { corner: 'BR', style: { bottom: 'calc(10px * var(--inv-scale,1))', right: 'calc(10px * var(--inv-scale,1))' } },
                ]
              : [{ corner: null, style: { top: 'calc(10px * var(--inv-scale,1))', left: 'calc(10px * var(--inv-scale,1))' } }];
            return corners.map(({ corner, style }) => (
              <div
                key={corner ?? 'all'}
                className="fb-radius-handle"
                style={style}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const sk   = corner ? `borderRadius${corner}` : 'borderRadius';
                  const rv   = resolved.styles?.[sk] ?? resolved.styles?.borderRadius;
                  const startR = typeof rv === 'number' ? rv : parseFloat(rv) || 0;
                  onStartRadiusDrag(e, id, startR, corner);
                }}
              />
            ));
          })()}
        </div>
      )}

      {/* Child elements — rendered relative to this element */}
      {children.map(child => {
        const showBefore = reorderTarget?.bpId === bpId
          && reorderTarget?.parentId === id
          && reorderTarget?.insertBeforeId === child.id;
        return (
          <React.Fragment key={child.id}>
            {showBefore && <div className="fb-reorder-indicator" />}
            <CanvasElement
              elementId={child.id}
              bpId={bpId}
              isSelected={selection?.elementId === child.id}
              isDropTarget={dropTargetId === child.id}
              dropTargetId={dropTargetId}
              onStartElementDrag={onStartElementDrag}
              onStartElementResize={onStartElementResize}
              onDropOntoElement={onDropOntoElement}
              onStartRadiusDrag={onStartRadiusDrag}
              onStartPaddingDrag={onStartPaddingDrag}
              reorderTarget={reorderTarget}
            />
          </React.Fragment>
        );
      })}
      {reorderTarget?.bpId === bpId && reorderTarget?.parentId === id && !reorderTarget?.insertBeforeId && (
        <div className="fb-reorder-indicator" />
      )}
    </div>
  );
}
