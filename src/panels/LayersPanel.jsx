import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore, resolveElement, resolveElementAnimations, resolveElementWithVariables, resolvePageLayout, isElementSelected, readStoredElementStyleClipboard, copyElementStylesToStoredClipboard, pasteStoredElementStylesToElement } from '../store/editorStore';
import { UIIcons } from '../components/UIIcons';

function LayerComponentCreateModal({ defaultName, errorMessage = '', onCancel, onSubmit }) {
  const [name, setName] = useState(defaultName || 'Component');

  useEffect(() => {
    setName(defaultName || 'Component');
  }, [defaultName]);

  return (
    <div className="fb-overlay-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="fb-overlay-modal__card" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <div className="fb-overlay-modal__head">Create component</div>
        <div className="fb-overlay-modal__body">
          <label className="fb-overlay-modal__label">Component name</label>
          <input
            className="fb-prop-input"
            autoFocus
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit(name);
              if (event.key === 'Escape') onCancel();
            }}
          />
          {errorMessage ? <div className="fb-artboard-bp-note" style={{ marginTop: 10, color: '#fda4af' }}>{errorMessage}</div> : null}
        </div>
        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="fb-primary-btn" onClick={() => onSubmit(name)}>Create</button>
        </div>
      </div>
    </div>
  );
}

const Icons = {
  frame: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <rect x="2" y="2" width="12" height="12" rx="1.5"/>
    </svg>
  ),
  frameAutoHorizontal: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <rect x="3" y="2.5" width="10" height="4" rx="1"/>
      <rect x="3" y="9.5" width="10" height="4" rx="1" opacity="0.62"/>
    </svg>
  ),
  frameAutoVertical: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <rect x="2.5" y="3" width="4" height="10" rx="1"/>
      <rect x="9.5" y="3" width="4" height="10" rx="1" opacity="0.62"/>
    </svg>
  ),
  text: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M3 3.5h10v2H9v7h2.5v1.5h-7v-1.5H7v-7H3z"/>
    </svg>
  ),
  image: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v9A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2Zm.3 10h10.4L10 8.5 8 10.6 5.6 8.2 2.8 12ZM5.5 5a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 5.5 5Z"/>
    </svg>
  ),
  embed: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 4 2.5 8l3 4" />
      <path d="M10.5 4 13.5 8l-3 4" />
      <path d="M8.9 2.5 7 13.5" />
    </svg>
  ),
  form: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 5.5h6" />
      <path d="M5 8h6" opacity="0.7" />
      <path d="M5 10.5h3.5" opacity="0.45" />
    </svg>
  ),
  'text-field': (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4" width="11" height="8" rx="2" />
      <path d="M5 8h5.5" />
    </svg>
  ),
  'textarea-field': (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.75" width="11" height="10.5" rx="1.8" />
      <path d="M5 5.25h6" />
      <path d="M5 8h6" />
      <path d="M5 10.75h4" />
    </svg>
  ),
  'rich-text-editor': (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.75" width="11" height="10.5" rx="1.8" />
      <path d="M4.75 5.25h2.5" />
      <path d="M5.5 5.25v4.75" />
      <path d="M8.75 5.25h2.5" />
      <path d="M10 5.25v4.75" />
      <path d="M8.75 7.75h2.5" />
    </svg>
  ),
  'radio-group': (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4.5" cy="5" r="1.75" />
      <circle cx="4.5" cy="10.75" r="1.75" />
      <path d="M8 5h4.5" />
      <path d="M8 10.75h4.5" opacity="0.7" />
    </svg>
  ),
  dropdown: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4" width="11" height="8" rx="2" />
      <path d="M10.5 7l1.75 1.75L14 7" />
    </svg>
  ),
  checkbox: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.25" width="4" height="4" rx="1" />
      <path d="M8.5 5.25H13" />
    </svg>
  ),
  'file-upload': (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="2" strokeDasharray="2 1.5" />
      <path d="M8 10V6.2" />
      <path d="m6.4 7.8 1.6-1.6 1.6 1.6" />
    </svg>
  ),
  captcha: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M5 8.25 7 10l4-4" />
    </svg>
  ),
  'submit-button': (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="2.2" />
      <path d="M5 8h6" />
      <path d="m9 6.25 2 1.75L9 9.75" />
    </svg>
  ),
  icon: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M8 1.8l1.93 3.91 4.32.63-3.12 3.04.74 4.3L8 11.65 4.13 13.68l.74-4.3-3.12-3.04 4.32-.63L8 1.8z"/>
    </svg>
  ),
  desktop: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M2 2h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9v2h3v1H4v-1h3v-2H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/>
    </svg>
  ),
  tablet: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M4.5 1h7A1.5 1.5 0 0 1 13 2.5v11A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-11A1.5 1.5 0 0 1 4.5 1ZM8 12.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z"/>
    </svg>
  ),
  mobile: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M5.25 1h5.5A1.25 1.25 0 0 1 12 2.25v11.5A1.25 1.25 0 0 1 10.75 15h-5.5A1.25 1.25 0 0 1 4 13.75V2.25A1.25 1.25 0 0 1 5.25 1ZM8 12.35a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4Z"/>
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
  if (el.type === 'form') return Icons.form;
  if (el.type !== 'frame') return Icons[el.type] ?? Icons.frame;
  const resolved = resolveElement(el, bpId || 'desktop');
  if (resolved.styles?.display === 'flex') {
    return resolved.styles?.flexDirection === 'row'
      ? Icons.frameAutoHorizontal
      : Icons.frameAutoVertical;
  }
  return Icons.frame;
}

function getLayerChildren(el, allElements) {
  return el?.children?.length
    ? el.children.map((childId) => allElements.find((candidate) => candidate.id === childId)).filter(Boolean)
    : allElements.filter((candidate) => candidate.parentId === el.id);
}

function hasHoveredDescendant(el, allElements, hoveredId) {
  if (!hoveredId) return false;
  const childIds = Array.isArray(el?.children) && el.children.length
    ? el.children
    : allElements.filter((candidate) => candidate.parentId === el.id).map((candidate) => candidate.id);
  for (const childId of childIds) {
    if (childId === hoveredId) return true;
    const child = allElements.find((candidate) => candidate.id === childId);
    if (child && hasHoveredDescendant(child, allElements, hoveredId)) return true;
  }
  return false;
}

function isFlowRootAtBreakpoint(el, bpId, currentPage) {
  if (!el || el.parentId) return false;
  const resolved = resolveElement(el, bpId);
  const pageLayout = resolvePageLayout(currentPage?.layout, bpId);
  return pageLayout !== null && !resolved.absoluteInLayout && resolved.positionType !== 'fixed';
}

function isDesktopOffCanvas(el, bpDefs, currentPage) {
  const desktopBp = bpDefs?.desktop;
  if (!desktopBp || !el || el.parentId) return false;
  const resolved = resolveElement(el, 'desktop');
  if (resolved.hidden) return false;
  if (isFlowRootAtBreakpoint(el, 'desktop', currentPage)) return false;
  return resolved.x + resolved.width <= 0
    || resolved.x >= desktopBp.width
    || resolved.y + resolved.height <= 0
    || resolved.y >= desktopBp.height;
}

// Mirror the artboard off-canvas rules so Layers and canvas classify roots the same way.
function checkOffCanvas(el, bpId, bpDef, bpDefs) {
  if (!bpDef || !el || el.parentId) return false;
  const currentPage = useEditorStore.getState().getCurrentPage?.() ?? null;
  const resolved = resolveElement(el, bpId);
  if (resolved.hidden) return false;
  if (bpId !== 'desktop' && isDesktopOffCanvas(el, bpDefs, currentPage)) return true;
  if (isFlowRootAtBreakpoint(el, bpId, currentPage)) return false;
  return resolved.x + resolved.width <= 0
    || resolved.x >= bpDef.width
    || resolved.y + resolved.height <= 0
    || resolved.y >= bpDef.height;
}

function LayerItem({ el, depth, bpId, onReparent, onReorder, onOpenContextMenu, offCanvas = false }) {
  const selection         = useEditorStore(s => s.selection);
  const setSelection      = useEditorStore(s => s.setSelection);
  const toggleSelection   = useEditorStore(s => s.toggleSelection);
  const setPrimarySelection = useEditorStore(s => s.setPrimarySelection);
  const hoveredId         = useEditorStore(s => s.layerHoveredId);
  const setHoveredId      = useEditorStore(s => s.setLayerHoveredId);
  const toggleVisibility  = useEditorStore(s => s.toggleElementVisibility);
  const updateElementBase = useEditorStore(s => s.updateElementBase);
  const openComponentEditor = useEditorStore(s => s.openComponentEditor);
  const activeSurface       = useEditorStore(s => s.activeSurface);
  const loopAnimationPreview = useEditorStore(s => s.loopAnimationPreview);
  const hoverAnimationPreview = useEditorStore(s => s.hoverAnimationPreview);
  const components          = useEditorStore(s => s.components);
  const currentPage         = useEditorStore(s => s.pages.find((page) => page.id === s.currentPageId) ?? null);
  const globalVariables     = useEditorStore(s => s.globalVariables);
  const allElements         = useEditorStore(s => s.getAllElements());
  const [expanded, setExpanded] = useState(true);
  const pageVariables = Array.isArray(currentPage?.variables) ? currentPage.variables : [];
  const children = useMemo(() => getLayerChildren(el, allElements), [el, allElements]);

  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [dragOverPart, setDragOverPart] = useState(null); // 'before' | 'into' | 'after'
  const itemRef = useRef(null);

  const isSel = isElementSelected(selection, el.id, bpId || 'desktop');
  const isHov = hoveredId === el.id;
  const isBranchActive = useMemo(
    () => hoveredId !== el.id && hasHoveredDescendant(el, allElements, hoveredId),
    [allElements, el, hoveredId],
  );
  const resolved = resolveElementWithVariables(el, bpId || 'desktop', pageVariables, globalVariables);
  const isLocked = !!(resolved.locked ?? el.locked ?? el.base?.locked);
  const isMainSurfaceComponent = activeSurface === 'page' && !!el.componentInstance;
  const componentMeta = el.componentInstance?.componentId
    ? components.find((component) => component.id === el.componentInstance.componentId)
    : null;
  const elementName = (typeof el.name === 'string' && el.name.trim())
    ? el.name.trim()
    : ((typeof el.base?.name === 'string' && el.base.name.trim()) ? el.base.name.trim() : '');
  const displayName = activeSurface === 'component' && el.componentRoot
    ? (el.componentVariantName || 'Primary')
    : (isMainSurfaceComponent ? (componentMeta?.name || elementName || el.type) : (elementName || el.type));
  const visibleChildren = isMainSurfaceComponent ? [] : children;
  const hasChildren = visibleChildren.length > 0;
  const activeLoopAnimation = resolveElementAnimations(el, bpId || 'desktop').find((entry) => entry.type === 'loop') ?? null;
  const activeHoverAnimation = resolveElementAnimations(el, bpId || 'desktop').find((entry) => entry.type === 'hover') ?? null;
  const hasLoopAnimation = !!activeLoopAnimation;
  const hasHoverAnimation = !!activeHoverAnimation;
  const loopIndicatorLive = !!activeLoopAnimation
    && loopAnimationPreview?.elementId === el.id
    && loopAnimationPreview?.bpId === (bpId || 'desktop')
    && loopAnimationPreview?.animationId === activeLoopAnimation.id;
  const hoverIndicatorLive = !!activeHoverAnimation
    && hoverAnimationPreview?.elementId === el.id
    && hoverAnimationPreview?.bpId === (bpId || 'desktop')
    && hoverAnimationPreview?.animationId === activeHoverAnimation.id;

  useEffect(() => {
    if (isSel && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSel]);

  const startRename = (e) => {
    e.stopPropagation();
    setRenameVal(elementName || el.type);
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
    <div className={`fb-layer-node${hasChildren ? ' fb-layer-node--parent' : ''}${el.componentInstance ? ' fb-layer-node--component' : ''}`}>
      <div
        ref={itemRef}
        className={`fb-layer-item${isSel ? ' fb-layer-item--selected' : ''}${isHov && !isSel ? ' fb-layer-item--hovered' : ''}${isBranchActive && !isSel && !isHov ? ' fb-layer-item--branch-active' : ''}${offCanvas ? ' fb-layer-item--offcanvas' : ''}${el.componentInstance ? ' fb-layer-item--component' : ''}${hasChildren ? ' fb-layer-item--parent' : ''}${dragOverPart === 'before' ? ' fb-layer-item--drag-before' : ''}${dragOverPart === 'after' ? ' fb-layer-item--drag-after' : ''}${dragOverPart === 'into' ? ' fb-layer-item--drag-into' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        data-depth={depth}
        draggable
        onClick={(e) => {
          const nextSelection = { elementId: el.id, bpId: bpId || 'desktop' };
          if (e.metaKey || e.ctrlKey || e.shiftKey) {
            toggleSelection(nextSelection);
            return;
          }
          if (isSel) {
            setPrimarySelection(el.id);
            return;
          }
          setSelection(nextSelection);
        }}
        onMouseEnter={() => setHoveredId(el.id)}
        onMouseLeave={() => setHoveredId(null)}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSelection({ elementId: el.id, bpId: bpId || 'desktop' });
          onOpenContextMenu?.({
            clientX: event.clientX,
            clientY: event.clientY,
            elementId: el.id,
            bpId: bpId || 'desktop',
            defaultName: displayName || el.type || 'Component',
            canCreateComponent: !el.componentRoot && !el.componentInstance,
          });
        }}
      >
        {hasChildren ? (
          <span
            className={`fb-layer-caret${expanded ? ' fb-layer-caret--open' : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="fb-layer-caret fb-layer-caret--placeholder" />
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
        <span className="fb-layer-actions">
          {hasLoopAnimation || hasHoverAnimation ? (
            <span className={`fb-loop-indicator fb-loop-indicator--layer${(hasLoopAnimation ? loopIndicatorLive : hoverIndicatorLive) ? ' is-live' : ''}`} aria-label={hasLoopAnimation ? 'Loop animation' : 'Hover animation'} title={hasLoopAnimation ? 'Loop animation' : 'Hover animation'} />
          ) : null}
          {isLocked ? (
            <span className="fb-layer-lock" aria-label="Locked layer" title="Locked layer">
              {UIIcons.lock}
            </span>
          ) : null}
          <span className={`fb-layer-vis${resolved.hidden ? ' fb-layer-vis--visible' : ''}`}
            title={resolved.hidden ? 'Show' : 'Hide'}
            onClick={(e) => {
              e.stopPropagation();
              toggleVisibility(el.id, bpId || 'desktop');
            }}
          >
            {resolved.hidden ? Icons.eyeOff : Icons.eye}
          </span>
        </span>
      </div>
      {expanded && hasChildren ? (
        <div className={`fb-layer-children${el.componentInstance ? ' fb-layer-children--component' : ''}${isBranchActive ? ' fb-layer-children--active' : ''}`}>
          {visibleChildren.map(child => (
            <LayerItem
              key={child.id}
              el={child}
              depth={depth + 1}
              bpId={bpId}
              onReparent={onReparent}
              onReorder={onReorder}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
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
  const deleteElement          = useEditorStore(s => s.deleteElement);
  const createComponentFromElement = useEditorStore(s => s.createComponentFromElement);
  const openComponentEditor    = useEditorStore(s => s.openComponentEditor);
  const selection       = useEditorStore(s => s.selection);
  const artboardSel     = useEditorStore(s => s.artboardSel);
  const setArtboardSel  = useEditorStore(s => s.setArtboardSel);
  const setSelection    = useEditorStore(s => s.setSelection);
  const [contextMenu, setContextMenu] = useState(null);
  const [componentModal, setComponentModal] = useState(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const handleDismiss = () => setContextMenu(null);
    const handleEscape = (event) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleDismiss);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handleDismiss);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

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

  const hasStoredStyleClipboard = !!readStoredElementStyleClipboard();

  const BP_ORDER  = ['desktop', 'tablet', 'mobile'];

  const outsideBpId = activeBpId ?? 'desktop';
  const outsideBp = bpDefs[outsideBpId] ?? bpDefs.desktop;
  const outsideEls = outsideBp
    ? rootEls.filter((el) => checkOffCanvas(el, outsideBpId, outsideBp, bpDefs))
    : [];

  return (
    <>
    <div
      className="fb-layers-tree"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleRootDrop}
      style={{ minHeight: '100%' }}
    >
      {activeSurface === 'component' ? (
        <>
          {rootEls.map(el => (
            <LayerItem key={el.id} el={el} depth={0} bpId="desktop" offCanvas={false} onReparent={handleReparent} onReorder={handleReorder} onOpenContextMenu={setContextMenu} />
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
        const visibleEls = rootEls.filter(el => !checkOffCanvas(el, bpId, bp, bpDefs));
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
              <LayerItem key={el.id} el={el} depth={0} bpId={bpId} offCanvas={false} onReparent={handleReparent} onReorder={handleReorder} onOpenContextMenu={setContextMenu} />
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
            <LayerItem key={el.id} el={el} depth={0} bpId={outsideBpId} offCanvas onReparent={handleReparent} onReorder={handleReorder} onOpenContextMenu={setContextMenu} />
          ))}
        </div>
      )}
        </>
      )}
    </div>
    {contextMenu && typeof document !== 'undefined' ? createPortal(
      <div
        className="fb-context-menu"
        style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="fb-context-menu__item"
          onClick={() => {
            copyElementStylesToStoredClipboard(contextMenu.elementId, contextMenu.bpId);
            setContextMenu(null);
          }}
          disabled={!contextMenu.elementId}
        >
          Copy style
        </button>
        <button
          type="button"
          className="fb-context-menu__item"
          onClick={() => {
            if (!pasteStoredElementStylesToElement(contextMenu.elementId, contextMenu.bpId)) return;
            pushHistory();
            setContextMenu(null);
          }}
          disabled={!contextMenu.elementId || !hasStoredStyleClipboard}
        >
          Paste style
        </button>
        <button
          type="button"
          className="fb-context-menu__item"
          onClick={() => {
            deleteElement(contextMenu.elementId);
            pushHistory();
            setContextMenu(null);
          }}
          disabled={!contextMenu.elementId}
        >
          Delete
        </button>
        <button
          type="button"
          className="fb-context-menu__item"
          onClick={() => {
            setComponentModal({ elementId: contextMenu.elementId, defaultName: contextMenu.defaultName, errorMessage: '' });
            setContextMenu(null);
          }}
          disabled={!contextMenu.canCreateComponent}
        >
          Create Component
        </button>
      </div>,
      document.body,
    ) : null}
    {componentModal && typeof document !== 'undefined' ? createPortal(
      <LayerComponentCreateModal
        defaultName={componentModal.defaultName}
        errorMessage={componentModal.errorMessage}
        onCancel={() => setComponentModal(null)}
        onSubmit={(name) => {
          const result = createComponentFromElement(componentModal.elementId, name);
          if (result?.componentId) {
            setComponentModal(null);
            pushHistory();
            openComponentEditor(result.componentId);
            return;
          }
          setComponentModal((current) => current ? {
            ...current,
            errorMessage: result?.error || 'Could not create component from this layer.',
          } : current);
        }}
      />,
      document.body,
    ) : null}
    </>
  );
}

