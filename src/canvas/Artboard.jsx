import React, { useState } from 'react';
import { useEditorStore, resolveBackground, resolveElement, resolvePagePadding } from '../store/editorStore';
import CanvasElement from './CanvasElement';

const HEADER_H = 36;

/** Simple number input that allows clearing the field before retyping */
function ArtboardNumInput({ value, min = 100, onChange }) {
  const fmt = v => String(v);
  const [draft, setDraft] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  React.useEffect(() => { if (!focused) setDraft(fmt(value)); }, [value, focused]);
  return (
    <input
      className="fb-artboard-header__width-input"
      type="number"
      value={focused ? draft : fmt(value)}
      min={min}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onFocus={e => { setFocused(true); setDraft(fmt(value)); e.target.select(); }}
      onBlur={() => {
        setFocused(false);
        const n = parseInt(draft);
        if (!isNaN(n) && n >= min) onChange(n);
        else setDraft(fmt(value));
      }}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseInt(raw);
        if (!isNaN(n) && n >= min) onChange(n);
      }}
    />
  );
}

export default function Artboard({
  bp,
  onStartElementDrag,
  onStartResize,
  onDropOntoElement,
  onStartArtboardDrag,
  onStartArtboardResize,
  onStartArtboardPaddingDrag,
  onSelectArtboard,
  isArtboardSelected,
}) {
  const allElements      = useEditorStore(s => s.getAllElements());
  const breakpointDefs   = useEditorStore(s => s.breakpointDefs);
  const selection        = useEditorStore(s => s.selection);
  const setSelection     = useEditorStore(s => s.setSelection);
  const updateBreakpointDef = useEditorStore(s => s.updateBreakpointDef);
  const page             = useEditorStore(s => s.getCurrentPage());
  const background       = resolveBackground(page?.background, bp.id);
  const resolvedPad      = resolvePagePadding(page?.padding, bp.id);
  const scale            = useEditorStore(s => s.viewport.scale);

  // Root-level elements only (parentId === null)
  const rootEls = allElements.filter(e => !e.parentId);

  // One-way inheritance: if an element is off-canvas on desktop, it is completely
  // excluded from tablet/mobile artboards (not even shown as ghost).
  const desktopBp = breakpointDefs['desktop'];
  const isDesktopOffCanvas = (el) => {
    if (bp.id === 'desktop' || !desktopBp) return false;
    const r = resolveElement(el, 'desktop');
    if (r.hidden) return false; // hidden-on-desktop elements (bp-specific) are kept
    return (r.x + r.width <= 0 || r.x >= desktopBp.width || r.y + r.height <= 0 || r.y >= desktopBp.height);
  };

  // Split into on-canvas and off-canvas for this bp, after excluding desktop-off-canvas
  const isOffCanvas = (el) => {
    const r = resolveElement(el, bp.id);
    if (r.hidden) return false;
    return (r.x + r.width <= 0 || r.x >= bp.width || r.y + r.height <= 0 || r.y >= bp.height);
  };
  const eligibleEls  = rootEls.filter(el => !isDesktopOffCanvas(el));
  const onCanvasEls  = eligibleEls.filter(el => !isOffCanvas(el));
  const offCanvasEls = eligibleEls.filter(el => isOffCanvas(el));

  const handleBoardClick = (e) => {
    if (e.target === e.currentTarget) {
      setSelection(null);
      onSelectArtboard(bp.id);
    }
  };
  const handleContentClick = handleBoardClick;

  return (
    /* Group: positioned so content starts at (bp.x, bp.y), header is above */
    <div
      className="fb-artboard-group"
      style={{ left: bp.x, top: bp.y - HEADER_H / scale }}
    >
      {/* Draggable header */}
      <div
        className={`fb-artboard-header${isArtboardSelected ? ' fb-artboard-header--selected' : ''}`}
        style={{ width: bp.width }}
        onMouseDown={(e) => {
          if (e.target.tagName === 'INPUT') return;
          e.stopPropagation();
          onSelectArtboard(bp.id);
          onStartArtboardDrag(e, bp.id);
        }}
      >
        <span className="fb-artboard-header__name">{bp.name}</span>
        <ArtboardNumInput
          value={bp.width}
          min={100}
          onChange={v => updateBreakpointDef(bp.id, { width: v })}
        />
        <span className="fb-artboard-header__unit">W</span>
        <ArtboardNumInput
          value={bp.height}
          min={100}
          onChange={v => updateBreakpointDef(bp.id, { height: v })}
        />
        <span className="fb-artboard-header__unit">H</span>
      </div>

      {/* Artboard content — overflow:hidden clips on-canvas elements */}
      <div
        className={`fb-artboard${isArtboardSelected ? ' fb-artboard--selected' : ''}`}
        data-bp={bp.id}
        style={{ width: bp.width, height: bp.height, background }}
        onClick={handleBoardClick}
      >
        {/* Content area — elements are positioned relative to this padded inner origin */}
        <div
          className="fb-artboard-content"
          style={{
            position: 'absolute',
            top: resolvedPad.top,
            left: resolvedPad.left,
            right: resolvedPad.right,
            bottom: resolvedPad.bottom,
          }}
          onClick={handleContentClick}
        >
          {onCanvasEls.map(el => (
            <CanvasElement
              key={el.id}
              elementId={el.id}
              bpId={bp.id}
              isSelected={selection?.elementId === el.id}
              onStartDrag={(e) => onStartElementDrag(e, bp.id, el)}
              onStartResize={(e, handle) => onStartResize(e, bp.id, el, handle)}
              onDropOntoElement={onDropOntoElement}
            />
          ))}
        </div>
        {/* Artboard padding visual handles — shaded zones + pink drag lines */}
        {isArtboardSelected && onStartArtboardPaddingDrag && (
          <>
            {/* Padding zone shading */}
            <div className="fb-pad-zone fb-pad-zone--top"    style={{ height: resolvedPad.top }} />
            <div className="fb-pad-zone fb-pad-zone--bottom" style={{ height: resolvedPad.bottom }} />
            <div className="fb-pad-zone fb-pad-zone--left"   style={{ width: resolvedPad.left, top: resolvedPad.top, bottom: resolvedPad.bottom }} />
            <div className="fb-pad-zone fb-pad-zone--right"  style={{ width: resolvedPad.right, top: resolvedPad.top, bottom: resolvedPad.bottom }} />
            {/* Drag lines */}
            <div className="fb-pad-line fb-pad-line--top"    style={{ top:    resolvedPad.top    }} onMouseDown={e => { e.stopPropagation(); onStartArtboardPaddingDrag(e, bp.id, 'top');    }} />
            <div className="fb-pad-line fb-pad-line--bottom" style={{ bottom: resolvedPad.bottom }} onMouseDown={e => { e.stopPropagation(); onStartArtboardPaddingDrag(e, bp.id, 'bottom'); }} />
            <div className="fb-pad-line fb-pad-line--left"   style={{ left:   resolvedPad.left   }} onMouseDown={e => { e.stopPropagation(); onStartArtboardPaddingDrag(e, bp.id, 'left');   }} />
            <div className="fb-pad-line fb-pad-line--right"  style={{ right:  resolvedPad.right  }} onMouseDown={e => { e.stopPropagation(); onStartArtboardPaddingDrag(e, bp.id, 'right');  }} />
          </>
        )}
      </div>

      {/* Off-canvas layer — zero-size div at artboard origin, overflow visible.
          Elements here are outside artboard bounds so not clipped. */}
      {offCanvasEls.length > 0 && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: HEADER_H / scale,
          width: 0,
          height: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}>
          <div style={{ position: 'relative', pointerEvents: 'all' }}>
            {offCanvasEls.map(el => (
              <CanvasElement
                key={el.id}
                elementId={el.id}
                bpId={bp.id}
                isSelected={selection?.elementId === el.id}
                onStartDrag={(e) => onStartElementDrag(e, bp.id, el)}
                onStartResize={(e, handle) => onStartResize(e, bp.id, el, handle)}
                onDropOntoElement={onDropOntoElement}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom resize handle */}
      <div
        className="fb-artboard-resize-handle"
        onMouseDown={(e) => {
          e.stopPropagation();
          onSelectArtboard(bp.id);
          onStartArtboardResize(e, bp.id);
        }}
      />
    </div>
  );
}
