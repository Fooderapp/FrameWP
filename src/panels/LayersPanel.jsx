import React, { useState, useRef, useEffect } from 'react';
import { useEditorStore, resolveElement } from '../store/editorStore';
import { UIIcons } from '../components/UIIcons';

const Icons = {
  frame: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1.5"/>
    </svg>
  ),
  frameAutoHorizontal: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2.5" width="10" height="4" rx="1"/>
      <rect x="3" y="9.5" width="10" height="4" rx="1"/>
    </svg>
  ),
  frameAutoVertical: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="4" height="10" rx="1"/>
      <rect x="9.5" y="3" width="4" height="10" rx="1"/>
    </svg>
  ),
  text: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10M8 4v8M6 12h4"/>
    </svg>
  ),
  image: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="12" rx="1.5"/>
      <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
      <path d="M1 12l4-3.5 3 2.5 2.5-2 4.5 4"/>
    </svg>
  ),
  desktop: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="9" rx="1"/>
      <path d="M5 14h6M8 11v3"/>
    </svg>
  ),
  tablet: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="1" width="10" height="14" rx="1.5"/>
      <circle cx="8" cy="12.5" r="0.8" fill="currentColor" stroke="none"/>
    </svg>
  ),
  mobile: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="1" width="7" height="14" rx="1.5"/>
      <circle cx="8" cy="12.5" r="0.75" fill="currentColor" stroke="none"/>
    </svg>
  ),
  eye: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/>
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>
    </svg>
  ),
  eyeOff: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 2l12 12"/>
      <path d="M7 4.6C7.3 4.5 7.7 4.5 8 4.5c4.5 0 7 3.5 7 3.5s-.8 1.6-2.3 2.8"/>
      <path d="M4.6 5.8C2.6 7 1 9 1 9s2.5 5 7 5c1.5 0 2.9-.5 4-.9"/>
    </svg>
  ),
};

function getIconForElement(el, bpId) {
  if (el.componentInstance) return UIIcons.component;
  if (el.type !== 'frame') return Icons[el.type] ?? Icons.frame;
  const resolved = resolveElement(el, bpId || 'desktop');
  if (resolved.styles?.display === 'flex') {
    return resolved.styles?.flexDirection === 'row'
      ? Icons.frameAutoHorizontal
      : Icons.frameAutoVertical;
  }
  return Icons.frame;
}

// Is a root element off-canvas for a given bp?
function checkOffCanvas(el, bpId, bpDef) {
  if (!bpDef || el.parentId) return false;
  const r = resolveElement(el, bpId);
  return (r.x + r.width <= 0 || r.x >= bpDef.width || r.y + r.height <= 0 || r.y >= bpDef.height);
}

function LayerItem({ el, depth, bpId, onReparent, onReorder, offCanvas = false }) {
  const selection         = useEditorStore(s => s.selection);
  const setSelection      = useEditorStore(s => s.setSelection);
  const hoveredId         = useEditorStore(s => s.hoveredId);
  const setHoveredId      = useEditorStore(s => s.setHoveredId);
  const toggleVisibility  = useEditorStore(s => s.toggleElementVisibility);
  const updateElementBase = useEditorStore(s => s.updateElementBase);
  const openComponentEditor = useEditorStore(s => s.openComponentEditor);
  const activeSurface       = useEditorStore(s => s.activeSurface);
  const components          = useEditorStore(s => s.components);
  const children          = useEditorStore(s => s.getChildElements(el.id));
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [dragOverPart, setDragOverPart] = useState(null); // 'before' | 'into' | 'after'
  const itemRef = useRef(null);

  const isSel = selection?.elementId === el.id;
  const isHov = hoveredId === el.id;
  const resolved = resolveElement(el, bpId || 'desktop');
  const isMainSurfaceComponent = activeSurface === 'page' && !!el.componentInstance;
  const componentMeta = el.componentInstance?.componentId
    ? components.find((component) => component.id === el.componentInstance.componentId)
    : null;
  const displayName = activeSurface === 'component' && el.componentRoot
    ? 'Primary'
    : (isMainSurfaceComponent ? (componentMeta?.name || el.base?.name || el.type) : (el.base?.name || el.type));
  const visibleChildren = isMainSurfaceComponent ? [] : children;

  useEffect(() => {
    if (isSel && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSel]);

  const startRename = (e) => {
    e.stopPropagation();
    setRenameVal(el.base?.name || el.type);
    setRenaming(true);
  };
  const commitRename = () => {
    setRenaming(false);
    const trimmed = renameVal.trim();
    if (trimmed) updateElementBase(el.id, { name: trimmed });
  };

  const handleDragStart = (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('fb-layer-id', el.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = itemRef.current?.getBoundingClientRect();
    if (rect) {
      const rel = (e.clientY - rect.top) / rect.height;
      setDragOverPart(rel < 0.33 ? 'before' : rel > 0.67 ? 'after' : 'into');
    }
  };
  const handleDragLeave = (e) => {
    if (!itemRef.current?.contains(e.relatedTarget)) setDragOverPart(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const part = dragOverPart;
    setDragOverPart(null);
    const draggedId = e.dataTransfer.getData('fb-layer-id');
    if (draggedId && draggedId !== el.id) {
      if (part === 'before') onReorder(draggedId, el.id, false);
      else if (part === 'after') onReorder(draggedId, el.id, true);
      else onReparent(draggedId, el.id);
    }
  };

  return (
    <>
      <div
        ref={itemRef}
        className={`fb-layer-item${isSel ? ' fb-layer-item--selected' : ''}${isHov && !isSel ? ' fb-layer-item--hovered' : ''}${offCanvas ? ' fb-layer-item--offcanvas' : ''}${el.componentInstance ? ' fb-layer-item--component' : ''}${dragOverPart === 'before' ? ' fb-layer-item--drag-before' : ''}${dragOverPart === 'after' ? ' fb-layer-item--drag-after' : ''}${dragOverPart === 'into' ? ' fb-layer-item--drag-into' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        draggable
        onClick={() => setSelection({ elementId: el.id, bpId: bpId || 'desktop' })}
        onMouseEnter={() => setHoveredId(el.id)}
        onMouseLeave={() => setHoveredId(null)}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {visibleChildren.length > 0 ? (
          <span
            style={{ cursor: 'pointer', marginRight: 4, fontSize: 9, color: 'var(--text-muted)' }}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{ display: 'inline-block', width: 13 }} />
        )}
        <span
          className="fb-layer-icon"
          onDoubleClick={el.componentInstance?.componentId
            ? (e) => {
                e.stopPropagation();
                openComponentEditor(el.componentInstance.componentId);
              }
            : undefined}
        >
          {getIconForElement(el, bpId)}
        </span>
        {renaming ? (
          <input
            className="fb-layer-rename"
            autoFocus
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
              e.stopPropagation();
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="fb-layer-name"
            style={{ opacity: resolved.hidden ? 0.4 : 1 }}
            onDoubleClick={startRename}
          >
            {displayName}
          </span>
        )}
        <span className={`fb-layer-vis${resolved.hidden ? ' fb-layer-vis--visible' : ''}`}
          title={resolved.hidden ? 'Show' : 'Hide'}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisibility(el.id, bpId || 'desktop');
          }}
        >
          {resolved.hidden ? Icons.eyeOff : Icons.eye}
        </span>
      </div>
      {expanded && visibleChildren.map(child => (
        <LayerItem
          key={child.id}
          el={child}
          depth={depth + 1}
          bpId={bpId}
          onReparent={onReparent}
          onReorder={onReorder}
        />
      ))}
    </>
  );
}

export default function LayersPanel() {
  const allElements     = useEditorStore(s => s.getAllElements());
  const bpDefs          = useEditorStore(s => s.breakpointDefs);
  const activeSurface   = useEditorStore(s => s.activeSurface);
  const reparentElement        = useEditorStore(s => s.reparentElement);
  const ejectElement           = useEditorStore(s => s.ejectElement);
  const reorderElementInParent = useEditorStore(s => s.reorderElementInParent);
  const pushHistory            = useEditorStore(s => s.pushHistory);
  const selection       = useEditorStore(s => s.selection);
  const artboardSel     = useEditorStore(s => s.artboardSel);
  const setArtboardSel  = useEditorStore(s => s.setArtboardSel);
  const setSelection    = useEditorStore(s => s.setSelection);

  const activeBpId = selection?.bpId ?? artboardSel ?? null;
  const rootEls = allElements.filter(e => !e.parentId);

  const handleReparent = (draggedId, newParentId) => {
    reparentElement(draggedId, newParentId);
    pushHistory();
  };
  const handleReorder = (draggedId, targetId, insertAfter) => {
    const allEls = useEditorStore.getState().getAllElements();
    const target = allEls.find(e => e.id === targetId);
    const dragged = allEls.find(e => e.id === draggedId);
    if (!target || !dragged) return;
    const targetParentId = target.parentId;
    if (dragged.parentId !== targetParentId) {
      reparentElement(draggedId, targetParentId ?? null);
    }
    const updEls = useEditorStore.getState().getAllElements();
    const siblings = targetParentId
      ? (updEls.find(e => e.id === targetParentId)?.children ?? []).filter(id => id !== draggedId)
      : updEls.filter(e => !e.parentId && e.id !== draggedId).map(e => e.id);
    let idx = siblings.indexOf(targetId);
    if (insertAfter) idx = Math.max(0, idx + 1);
    if (idx < 0) idx = 0;
    reorderElementInParent(draggedId, idx);
    pushHistory();
  };

  const handleRootDrop = (e) => {
    const draggedId = e.dataTransfer.getData('fb-layer-id');
    if (draggedId) {
      const bp = bpDefs[activeBpId] ?? bpDefs['desktop'];
      ejectElement(draggedId, { toOffCanvas: true, artboardWidth: bp?.width ?? 1440 });
      pushHistory();
    }
  };

  const handleArtboardHeaderDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('fb-layer-id');
    if (draggedId) {
      ejectElement(draggedId, { toOffCanvas: false });
      pushHistory();
    }
  };

  const BP_ORDER  = ['desktop', 'tablet', 'mobile'];

  // An element is "outside" if it's off-canvas on ANY breakpoint.
  // It is excluded from that bp's artboard group and listed in "Outside Artboards".
  const outsideEls = rootEls.filter(el =>
    BP_ORDER.some(bpId => checkOffCanvas(el, bpId, bpDefs[bpId]))
  );

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleRootDrop}
      style={{ minHeight: '100%' }}
    >
      {activeSurface === 'component' ? (
        <>
          {rootEls.map(el => (
            <LayerItem key={el.id} el={el} depth={0} bpId="desktop" offCanvas={false} onReparent={handleReparent} onReorder={handleReorder} />
          ))}
          {rootEls.length === 0 && (
            <div className="fb-layers-empty fb-layers-empty--bp">No elements</div>
          )}
        </>
      ) : (
        <>
      {BP_ORDER.map(bpId => {
        const bp = bpDefs[bpId];
        if (!bp) return null;
        const isActive = activeBpId === bpId;
        // Show all on-canvas elements for this bp, including hidden ones.
        const visibleEls = rootEls.filter(el => !checkOffCanvas(el, bpId, bp));
        return (
          <div key={bpId} className={`fb-layer-artboard${isActive ? ' fb-layer-artboard--active' : ''}`}>
            <div
              className="fb-layer-artboard-header"
              onClick={() => { setArtboardSel(bpId); setSelection(null); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleArtboardHeaderDrop}
            >
              <span className="fb-layer-artboard-icon">{Icons[bpId] ?? Icons.desktop}</span>
              <span className="fb-layer-artboard-name">{bp.name}</span>
              <span className="fb-layer-artboard-dim">{bp.width}×{bp.height}</span>
            </div>
            {visibleEls.map(el => (
              <LayerItem key={el.id} el={el} depth={0} bpId={bpId} offCanvas={false} onReparent={handleReparent} onReorder={handleReorder} />
            ))}
            {visibleEls.length === 0 && (
              <div className="fb-layers-empty fb-layers-empty--bp">No elements</div>
            )}
          </div>
        );
      })}

      {/* Outside Artboards — elements off-canvas on any breakpoint */}
      {outsideEls.length > 0 && (
        <div
          className="fb-layer-outside"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.dataTransfer.getData('fb-layer-id');
            if (id) {
              const bp = bpDefs['desktop'];
              ejectElement(id, { toOffCanvas: true, artboardWidth: bp?.width ?? 1440 });
              pushHistory();
            }
          }}
        >
          <div className="fb-layer-outside-header">
            <span>⚠</span>
            <span>Outside Artboards</span>
            <span className="fb-layer-artboard-dim">{outsideEls.length}</span>
          </div>
          {outsideEls.map(el => (
            <LayerItem key={el.id} el={el} depth={0} bpId="desktop" offCanvas onReparent={handleReparent} onReorder={handleReorder} />
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

