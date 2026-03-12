import React, { useRef, useEffect, useCallback, useLayoutEffect, useState } from 'react';
import { useEditorStore, createFrame, createImage, createText, resolveElement, resolvePagePadding, resolvePageLayout } from '../store/editorStore';
import Artboard from './Artboard';
import VariantInteractionModal from '../components/VariantInteractionModal';

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;
const SNAP_THRESHOLD_PX = 6;

const OVERLAY_HANDLES = ['nw','n','ne','e','se','s','sw','w'];

function isFontResizeTextElement(el, resolved) {
  if ((el?.type ?? '') !== 'text') return false;
  const widthMode = resolved?.widthMode ?? 'fixed';
  const heightMode = resolved?.heightMode ?? 'fixed';
  return (widthMode === 'hug' && heightMode === 'hug')
    || (widthMode === 'fixed' && heightMode === 'hug');
}

// ── Copy/paste helpers ─────────────────────────────────────────
let _cpSeq = 0;
function cloneSubtree(subtree, rootId) {
  const idMap = {};
  subtree.forEach(el => {
    idMap[el.id] = `fr-${Date.now()}-${++_cpSeq}-${Math.random().toString(36).slice(2, 5)}`;
  });
  return subtree.map(el => ({
    ...el,
    id: idMap[el.id],
    parentId: idMap[el.parentId] ?? null,
    children: (el.children ?? []).map(cid => idMap[cid]).filter(Boolean),
    base: el.id === rootId
      ? { ...el.base, x: (el.base.x ?? 0) + 20, y: (el.base.y ?? 0) + 20 }
      : { ...el.base },
    overrides: { ...(el.overrides ?? {}) },
  }));
}

function collectDescendantIds(allEls, rootId) {
  const ids = new Set([rootId]);
  const visit = (id) => {
    const el = allEls.find(item => item.id === id);
    (el?.children ?? []).forEach((childId) => {
      if (ids.has(childId)) return;
      ids.add(childId);
      visit(childId);
    });
  };
  visit(rootId);
  return ids;
}

function getSiblingIds(allEls, parentId, excludedId) {
  if (parentId) {
    const parent = allEls.find(el => el.id === parentId);
    return (parent?.children ?? []).filter(id => id !== excludedId);
  }
  return allEls.filter(el => !el.parentId && el.id !== excludedId).map(el => el.id);
}

function getInsertBeforeIdFromDom(parentDom, siblingIds, clientX, clientY, axis = 'y') {
  if (!parentDom) return null;
  for (const siblingId of siblingIds) {
    const node = parentDom.querySelector(`[data-id="${siblingId}"]`);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    const midpoint = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const cursor = axis === 'x' ? clientX : clientY;
    if (cursor < midpoint) return siblingId;
  }
  return null;
}

function getNodeWorldRect(node, boardDom, bp, scale) {
  if (!node || !boardDom || !bp || !scale) return null;
  const rect = node.getBoundingClientRect();
  const boardRect = boardDom.getBoundingClientRect();
  const left = bp.x + (rect.left - boardRect.left) / scale;
  const top = bp.y + (rect.top - boardRect.top) / scale;
  const width = rect.width / scale;
  const height = rect.height / scale;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function getFlexAxis(node) {
  if (!node) return 'y';
  const style = window.getComputedStyle(node);
  return (style.flexDirection ?? 'column').startsWith('row') ? 'x' : 'y';
}

function pointInClientRect(clientX, clientY, rect) {
  if (!rect) return false;
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function buildConnectorPath(start, end) {
  const deltaX = Math.max(48, Math.abs(end.x - start.x) * 0.35);
  return `M ${start.x} ${start.y} C ${start.x + deltaX} ${start.y}, ${end.x - deltaX} ${end.y}, ${end.x} ${end.y}`;
}

function toContainerPoint(rect, point) {
  if (!point) return null;
  return {
    x: point.x - (rect?.left ?? 0),
    y: point.y - (rect?.top ?? 0),
  };
}

function clientToWorldPoint(containerRect, viewport, point) {
  if (!point) return null;
  const scale = viewport?.scale ?? 1;
  return {
    x: (point.x - (containerRect?.left ?? 0) - (viewport?.x ?? 0)) / scale,
    y: (point.y - (containerRect?.top ?? 0) - (viewport?.y ?? 0)) / scale,
  };
}

function getElementWorldMetrics({ el, bpId, bp, page, boardDom, scale }) {
  if (!el || !bp) return null;

  const resolved = resolveElement(el, bpId);
  const pageLayout = resolvePageLayout(page?.layout, bpId);
  const pad = resolvePagePadding(page?.padding, bpId);
  const width = resolved.width ?? 100;
  const height = resolved.height ?? 100;
  const selectedDom = boardDom?.querySelector(`[data-id="${el.id}"]`) ?? null;
  const selectedRect = selectedDom?.getBoundingClientRect() ?? null;
  const boardRect = boardDom?.getBoundingClientRect() ?? null;
  const isFixed = resolved.positionType === 'fixed';
  const isFlowInLayout = pageLayout !== null && !resolved.absoluteInLayout && !el.parentId && resolved.positionType !== 'fixed';

  let modelWorldX = bp.x;
  let modelWorldY = bp.y;

  if (el.parentId) {
    const parentDom = boardDom?.querySelector(`[data-id="${el.parentId}"]`) ?? null;
    if (parentDom && boardRect) {
      const parentRect = parentDom.getBoundingClientRect();
      const parentOffsetX = (parentRect.left - boardRect.left + parentDom.clientLeft) / scale;
      const parentOffsetY = (parentRect.top - boardRect.top + parentDom.clientTop) / scale;
      modelWorldX = bp.x + parentOffsetX + (resolved.x ?? 0);
      modelWorldY = bp.y + parentOffsetY + (resolved.y ?? 0);
    } else {
      modelWorldX = bp.x + (resolved.x ?? 0);
      modelWorldY = bp.y + (resolved.y ?? 0);
    }
  } else {
    const absX = resolved.x ?? 0;
    const absY = resolved.y ?? 0;
    const isOffCanvas = absX + width <= 0 || absX >= bp.width || absY + height <= 0 || absY >= bp.height;
    const isAutoLayoutException = pageLayout !== null && !!resolved.absoluteInLayout;
    const offsetLeft = isFixed || isOffCanvas || isAutoLayoutException ? 0 : (pad?.left ?? 0);
    const offsetTop = isFixed || isOffCanvas || isAutoLayoutException ? 0 : (pad?.top ?? 0);
    modelWorldX = bp.x + offsetLeft + absX;
    modelWorldY = bp.y + offsetTop + absY;
  }

  const domWorldX = selectedRect && boardRect ? bp.x + (selectedRect.left - boardRect.left) / scale : modelWorldX;
  const domWorldY = selectedRect && boardRect ? bp.y + (selectedRect.top - boardRect.top) / scale : modelWorldY;

  return {
    resolved,
    selectedRect,
    modelWorldX,
    modelWorldY,
    domWorldX,
    domWorldY,
    domWidth: selectedRect ? selectedRect.width / scale : width,
    domHeight: selectedRect ? selectedRect.height / scale : height,
    width,
    height,
    rotation: parseFloat(resolved.rotation) || 0,
    isFixed,
    isFlowInLayout,
  };
}

function rotatePointAround(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos) - (dy * sin),
    y: center.y + (dx * sin) + (dy * cos),
  };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function offsetFromCenter(point, center, distance) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (dx / length) * distance,
    y: point.y + (dy / length) * distance,
  };
}

function getDragSessionWorldPosition(session, clientX, clientY, getProjectedWorldPoint) {
  const pointerWorld = getProjectedWorldPoint(clientX, clientY, 0, 0);
  let worldX = pointerWorld.worldX - (session.pointerOffsetWorldX ?? 0);
  let worldY = pointerWorld.worldY - (session.pointerOffsetWorldY ?? 0);

  if (session.hasRotation) {
    const ghostW = session.ghostW ?? 100;
    const ghostH = session.ghostH ?? 40;
    const localAnchorX = Number.isFinite(session.localAnchorX) ? session.localAnchorX : (ghostW / 2);
    const localAnchorY = Number.isFinite(session.localAnchorY) ? session.localAnchorY : (ghostH / 2);
    const anchorFromCenterX = localAnchorX - ghostW / 2;
    const anchorFromCenterY = localAnchorY - ghostH / 2;
    const radians = ((session.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const rotatedAnchorX = (anchorFromCenterX * cos) - (anchorFromCenterY * sin);
    const rotatedAnchorY = (anchorFromCenterX * sin) + (anchorFromCenterY * cos);
    const centerWorldX = pointerWorld.worldX - rotatedAnchorX;
    const centerWorldY = pointerWorld.worldY - rotatedAnchorY;
    worldX = centerWorldX - ghostW / 2;
    worldY = centerWorldY - ghostH / 2;
  }

  return { worldX, worldY };
}

function buildFallbackDragPreview({ session, worldX, worldY, bp, pagePadding, pageLayout, artboardDom, artboardRect }) {
  return {
    bp,
    pagePadding,
    pageLayout,
    artboardDom,
    artboardRect,
    dropContainer: null,
    targetParentId: null,
    mode: session.origPositionType === 'fixed' ? 'fixed-root' : 'root-free',
    insertBeforeId: null,
    reorderTarget: null,
    alignmentGuides: [],
    dropTargetId: null,
    hint: 'Free',
    clientLeft: null,
    clientTop: null,
    worldX,
    worldY,
    ghost: {
      worldX,
      worldY,
      width: session.ghostW ?? 100,
      height: session.ghostH ?? 40,
      bgColor: session.ghostBgColor,
      rotation: session.rotation ?? 0,
    },
  };
}

function shouldUseDirectRotatedMove(session) {
  if (!session?.hasRotation) return false;
  if (session.dragMode === 'flow' || session.origWasFlow || session.origPositionType === 'relative') return false;
  return true;
}

function getAxisAlignedBounds(rect) {
  if (!rect) return null;
  const left = rect.left;
  const top = rect.top;
  const width = rect.width;
  const height = rect.height;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function CanvasContextMenu({ menu, hasClipboard, onClose, onCopy, onCut, onPaste, onDelete }) {
  if (!menu) return null;

  return (
    <div
      className="fb-context-menu"
      style={{ left: menu.clientX, top: menu.clientY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onCopy(); onClose(); }}
        disabled={!menu.elementId}
      >
        Copy
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onCut(); onClose(); }}
        disabled={!menu.elementId}
      >
        Cut
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onPaste(); onClose(); }}
        disabled={!hasClipboard || !menu.canPasteIntoFrame}
      >
        Paste
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onDelete(); onClose(); }}
        disabled={!menu.elementId}
      >
        Delete
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { menu.onCreateComponent?.(); onClose(); }}
        disabled={!menu.elementId}
      >
        Create Component
      </button>
    </div>
  );
}

function ComponentCreateModal({ defaultName, onCancel, onSubmit }) {
  const [name, setName] = useState(defaultName || 'Component');

  return (
    <div className="fb-overlay-modal" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="fb-overlay-modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fb-overlay-modal__head">Create component</div>
        <div className="fb-overlay-modal__body">
          <label className="fb-overlay-modal__label">Component name</label>
          <input
            className="fb-prop-input"
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit(name);
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="fb-primary-btn" onClick={() => onSubmit(name)}>Create</button>
        </div>
      </div>
    </div>
  );
}

/** Draggable viewport-fold line, rendered at world-space for every breakpoint. */
function ViewportFoldOverlay({ onStartFoldDrag }) {
  const bpDefs = useEditorStore(s => s.breakpointDefs);
  return (
    <>
      {Object.values(bpDefs).map(bp => {
        const autoFoldH = bp.id === 'desktop'
          ? Math.round(bp.width * 9 / 16)
          : Math.round(bp.width * 16 / 9);
        const foldH = bp.viewportFoldH ?? autoFoldH;
        return (
          <div
            key={bp.id}
            className="fb-viewport-indicator fb-viewport-indicator--draggable"
            style={{ position: 'absolute', left: bp.x, top: bp.y + foldH, width: bp.width }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartFoldDrag(e, bp.id, foldH); }}
          >
            <div className="fb-viewport-indicator__line" />
            <span className="fb-viewport-indicator__pill">Viewport fold</span>
          </div>
        );
      })}
    </>
  );
}

/** Renders a bounding-box overlay in world-space, as a sibling of artboards.
 *  Not clipped by artboard's overflow:hidden, so it shows even for overflowing elements. */
function SelectionOverlay({ onStartResize, onStartMove, onStartRadiusDrag, dragOverlay }) {
  const selection              = useEditorStore(s => s.selection);
  const bpDefs                 = useEditorStore(s => s.breakpointDefs);
  const allElements            = useEditorStore(s => s.getAllElements());
  const page                   = useEditorStore(s => s.getCurrentPage());
  const activeSurface          = useEditorStore(s => s.activeSurface);
  const componentEditor        = useEditorStore(s => s.componentEditor);
  const setDrilledContainerId  = useEditorStore(s => s.setDrilledContainerId);
  const setSelection           = useEditorStore(s => s.setSelection);
  const viewport               = useEditorStore(s => s.viewport);
  const [measuredRect, setMeasuredRect] = useState(null);

  const selectedElementId = selection?.elementId ?? null;
  const selectedBpId = selection?.bpId ?? null;
  const selectedEl = selectedElementId ? allElements.find(e => e.id === selectedElementId) : null;

  useLayoutEffect(() => {
    if (!selectedBpId || !selectedEl) {
      setMeasuredRect(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      const currentBoard = document.querySelector(`.fb-artboard[data-bp="${selectedBpId}"]`);
      const currentNode = currentBoard?.querySelector(`[data-id="${selectedEl.id}"]`) ?? null;
      const currentBoardRect = currentBoard?.getBoundingClientRect() ?? null;
      const currentRect = currentNode?.getBoundingClientRect() ?? null;
      if (!currentBoardRect || !currentRect) {
        setMeasuredRect(null);
        return;
      }
      const currentBp = useEditorStore.getState().breakpointDefs[selectedBpId];
      const currentScale = useEditorStore.getState().viewport.scale ?? 1;
      const left = currentBp.x + (currentRect.left - currentBoardRect.left) / currentScale;
      const top = currentBp.y + (currentRect.top - currentBoardRect.top) / currentScale;
      const width = currentRect.width / currentScale;
      const height = currentRect.height / currentScale;
      setMeasuredRect((prev) => (
        prev && Math.abs(prev.left - left) < 0.01 && Math.abs(prev.top - top) < 0.01 && Math.abs(prev.width - width) < 0.01 && Math.abs(prev.height - height) < 0.01
          ? prev
          : { left, top, width, height }
      ));
    };

    frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedBpId, selectedEl, viewport.scale, viewport.x, viewport.y]);

  if (!selection) return null;
  const el = selectedEl;
  if (!el) return null;

  const bp = bpDefs[selection.bpId];
  if (!bp) return null;
  const scale = viewport.scale ?? 1;
  const boardDom = document.querySelector(`.fb-artboard[data-bp="${bp.id}"]`);
  const metrics = getElementWorldMetrics({ el, bpId: selection.bpId, bp, page, boardDom, scale });
  const resolved = metrics?.resolved ?? resolveElement(el, selection.bpId);
  if (resolved.hidden) return null;
  const pageLayout = resolvePageLayout(page?.layout, selection.bpId);
  const boardRect = boardDom?.getBoundingClientRect() ?? null;
  const selectedRect = metrics?.selectedRect ?? null;
  const isFixed = metrics?.isFixed ?? (resolved.positionType === 'fixed');
  const isFlowInLayout = metrics?.isFlowInLayout ?? false;

  // Viewport fold height based on device aspect ratio (desktop 16:9, others 9:16)
  const viewportFoldH = bp.id === 'desktop'
    ? Math.round(bp.width * 9 / 16)
    : Math.round(bp.width * 16 / 9);

  const pad    = resolvePagePadding(page?.padding, selection.bpId);
  const w        = resolved.width  ?? 100;
  const h        = resolved.height ?? 100;
  const rotation = resolved.rotation;
  const constraints = { top: true, left: true, right: false, bottom: false, ...(resolved.constraints ?? {}) };
  const isDragging = dragOverlay?.elementId === el.id;
  const canMoveOverlay = !el.locked && !isDragging && resolved.positionType !== 'relative' && !isFlowInLayout;
  const isActiveComponentVariantRoot = activeSurface === 'component'
    && !!el.componentRoot
    && !!el.componentEditorVariantId
    && componentEditor?.activeVariantId === el.componentEditorVariantId;
  const overlayHandles = (isFontResizeTextElement(el, resolved) ? ['se'] : OVERLAY_HANDLES)
    .filter((handle) => !(isActiveComponentVariantRoot && handle === 'e'));
  const rotateHandles = ['nw', 'ne', 'se', 'sw'];
  const overlayCapturesPointer = canMoveOverlay && el.type !== 'text' && Math.abs(parseFloat(rotation) || 0) <= 0.01;

  let worldX = metrics?.modelWorldX ?? bp.x;
  let worldY = metrics?.modelWorldY ?? bp.y;
  let containerWorldLeft = bp.x;
  let containerWorldTop = bp.y;
  let containerWorldWidth = bp.width;
  let containerWorldHeight = isFixed ? viewportFoldH : bp.height;
  if (el.parentId) {
    // Nested element: the parent may be a flex container with no meaningful x/y in the
    // data model. Measure the parent's current screen position and add the element's own
    // x/y from the store. The parent DOM is stable (it's not the one being dragged),
    // and the element x/y in the store is always the latest value — even during drag.
    const sc       = scale;
    // Scope parent lookup to the correct artboard — querySelector without scope
    // would return the Desktop copy when the same element exists in all artboards.
    const parentDom = boardDom?.querySelector(`[data-id="${el.parentId}"]`);
    if (parentDom && boardDom) {
      const parentRect = parentDom.getBoundingClientRect();
      const boardRect  = boardDom.getBoundingClientRect();
      const parentOffX = (parentRect.left - boardRect.left + parentDom.clientLeft) / sc;
      const parentOffY = (parentRect.top  - boardRect.top  + parentDom.clientTop) / sc;
      containerWorldLeft = bp.x + parentOffX;
      containerWorldTop = bp.y + parentOffY;
      containerWorldWidth = parentRect.width / sc;
      containerWorldHeight = parentRect.height / sc;
      worldX = bp.x + parentOffX + (resolved.x ?? 0);
      worldY = bp.y + parentOffY + (resolved.y ?? 0);
    } else {
      // Fallback: no DOM available (SSR / unmounted)
      worldX = bp.x + (resolved.x ?? 0);
      worldY = bp.y + (resolved.y ?? 0);
    }
  } else {
    // Root-level element: use data-model values + page padding
    const absX = resolved.x ?? 0;
    const absY = resolved.y ?? 0;
    const isElOffCanvas = (
      absX + w <= 0 || absX >= bp.width ||
      absY + h <= 0 || absY >= bp.height
    );
    // absoluteInLayout elements are positioned absolute inside artboard-content
    // which carries no additional offset — do NOT add page padding.
    const isAutoLayoutException = pageLayout !== null && !!resolved.absoluteInLayout;
    const offsetLeft = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.left ?? 0);
    const offsetTop = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.top ?? 0);
    const offsetRight = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.right ?? 0);
    const offsetBottom = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.bottom ?? 0);
    containerWorldLeft = bp.x + offsetLeft;
    containerWorldTop = bp.y + offsetTop;
    containerWorldWidth = bp.width - offsetLeft - offsetRight;
    containerWorldHeight = (isFixed ? viewportFoldH : bp.height) - offsetTop - offsetBottom;
    worldX = containerWorldLeft + absX;
    worldY = containerWorldTop + absY;
  }

  if (isDragging) {
    worldX = dragOverlay.worldX;
    worldY = dragOverlay.worldY;
  }

  const hasRotation = Math.abs(parseFloat(rotation) || 0) > 0.01;
  const visualRect = measuredRect ?? (selectedRect && boardRect
    ? {
        left: metrics?.domWorldX ?? (bp.x + (selectedRect.left - boardRect.left) / scale),
        top: metrics?.domWorldY ?? (bp.y + (selectedRect.top - boardRect.top) / scale),
        width: metrics?.domWidth ?? (selectedRect.width / scale),
        height: metrics?.domHeight ?? (selectedRect.height / scale),
      }
    : null);
  const shouldUseVisualPosition = !!visualRect;
  const shouldUseVisualSize = !!visualRect && (resolved.positionType === 'relative' || isFlowInLayout || resolved.widthMode === 'hug' || resolved.heightMode === 'hug');
  const overlayW = isDragging
    ? (dragOverlay.width ?? w)
    : (hasRotation ? w : (shouldUseVisualSize ? visualRect.width : w));
  const overlayH = isDragging
    ? (dragOverlay.height ?? h)
    : (hasRotation ? h : (shouldUseVisualSize ? visualRect.height : h));
  if (!isDragging && visualRect) {
    if (hasRotation) {
      worldX = visualRect.left + (visualRect.width / 2) - (overlayW / 2);
      worldY = visualRect.top + (visualRect.height / 2) - (overlayH / 2);
    } else if (shouldUseVisualPosition) {
      worldX = visualRect.left;
      worldY = visualRect.top;
    }
  }
  if (![worldX, worldY, overlayW, overlayH].every(Number.isFinite)) return null;
  const center = { x: worldX + overlayW / 2, y: worldY + overlayH / 2 };
  const selectionRotation = parseFloat(rotation) || 0;
  const tl = rotatePointAround({ x: worldX, y: worldY }, center, selectionRotation);
  const tr = rotatePointAround({ x: worldX + overlayW, y: worldY }, center, selectionRotation);
  const br = rotatePointAround({ x: worldX + overlayW, y: worldY + overlayH }, center, selectionRotation);
  const bl = rotatePointAround({ x: worldX, y: worldY + overlayH }, center, selectionRotation);
  if (![center, tl, tr, br, bl].every(isFinitePoint)) return null;
  const handlePoints = {
    nw: tl,
    n: midpoint(tl, tr),
    ne: tr,
    e: midpoint(tr, br),
    se: br,
    s: midpoint(bl, br),
    sw: bl,
    w: midpoint(tl, bl),
  };
  const rotatePoints = {
    nw: offsetFromCenter(tl, center, 20 / scale),
    ne: offsetFromCenter(tr, center, 20 / scale),
    se: offsetFromCenter(br, center, 20 / scale),
    sw: offsetFromCenter(bl, center, 20 / scale),
  };
  const guideBounds = getAxisAlignedBounds(hasRotation && visualRect ? visualRect : {
    left: worldX,
    top: worldY,
    width: overlayW,
    height: overlayH,
  });
  const midX = guideBounds?.centerX ?? center.x;
  const midY = guideBounds?.centerY ?? center.y;
  const guides = [];
  if (canMoveOverlay && constraints.left) {
    guides.push({ key: 'left', style: { left: containerWorldLeft, top: midY, width: Math.max(0, (guideBounds?.left ?? worldX) - containerWorldLeft), height: 0 } });
  }
  if (canMoveOverlay && constraints.right) {
    const rightStart = guideBounds?.right ?? (worldX + overlayW);
    guides.push({ key: 'right', style: { left: rightStart, top: midY, width: Math.max(0, containerWorldLeft + containerWorldWidth - rightStart), height: 0 } });
  }
  if (canMoveOverlay && constraints.top) {
    guides.push({ key: 'top', style: { left: midX, top: containerWorldTop, width: 0, height: Math.max(0, (guideBounds?.top ?? worldY) - containerWorldTop) } });
  }
  if (canMoveOverlay && constraints.bottom) {
    const bottomStart = guideBounds?.bottom ?? (worldY + overlayH);
    guides.push({ key: 'bottom', style: { left: midX, top: bottomStart, width: 0, height: Math.max(0, containerWorldTop + containerWorldHeight - bottomStart) } });
  }

  const elChildren = allElements.filter(e => e.parentId === el.id);
  const canDrill   = elChildren.length > 0;
  const svgWidth = Math.max(...Object.values(bpDefs).map((entry) => entry.x + entry.width), worldX + overlayW) + 400;
  const svgHeight = Math.max(...Object.values(bpDefs).map((entry) => entry.y + entry.height), worldY + overlayH) + 400;
  const useComponentSelectionAccent = activeSurface === 'component' || el.componentInstance;
  const outlineColor = useComponentSelectionAccent ? 'var(--component-accent)' : 'var(--accent-light)';
  const outlineShadow = useComponentSelectionAccent ? 'var(--component-accent-strong)' : 'transparent';
  const overlayHitRect = hasRotation && visualRect
    ? visualRect
    : { left: worldX, top: worldY, width: overlayW, height: overlayH };
  const overlayBoxStyle = {
    left: overlayHitRect.left,
    top: overlayHitRect.top,
    width: overlayHitRect.width,
    height: overlayHitRect.height,
    transform: hasRotation ? undefined : (selectionRotation ? `rotate(${selectionRotation}deg)` : undefined),
    transformOrigin: '50% 50%',
    pointerEvents: overlayCapturesPointer ? 'auto' : 'none',
    borderColor: hasRotation ? 'transparent' : outlineColor,
    boxShadow: !hasRotation && outlineShadow !== 'transparent'
      ? `0 0 0 calc(1px * var(--inv-scale, 1)) ${outlineShadow}`
      : undefined,
    background: 'rgba(0,0,0,0.001)',
  };
  const handleSize = 8 / scale;
  const rotateHandleSize = 14 / scale;
  const radiusHandleSize = 8 / scale;
  const radiusInset = 10 / scale;
  const radiusAnchorPoints = (() => {
    const anchors = resolved.styles?.borderRadiusMode === 'independent'
      ? {
          TL: { x: worldX + radiusInset, y: worldY + radiusInset },
          TR: { x: worldX + overlayW - radiusInset, y: worldY + radiusInset },
          BL: { x: worldX + radiusInset, y: worldY + overlayH - radiusInset },
          BR: { x: worldX + overlayW - radiusInset, y: worldY + overlayH - radiusInset },
        }
      : { all: { x: worldX + radiusInset, y: worldY + radiusInset } };
    return Object.fromEntries(Object.entries(anchors).map(([key, point]) => [key, rotatePointAround(point, center, selectionRotation)]));
  })();
  if (!Object.values(handlePoints).every(isFinitePoint)) return null;
  if (!Object.values(rotatePoints).every(isFinitePoint)) return null;
  if (!Object.values(radiusAnchorPoints).every(isFinitePoint)) return null;
  const polygonPoints = [tl, tr, br, bl].map((point) => `${point.x},${point.y}`).join(' ');
  const edgeResizeLines = !el.locked && !isDragging
    ? [
        { key: 'n', start: tl, end: tr, handle: 'n', enabled: overlayHandles.includes('n') },
        { key: 'e', start: tr, end: br, handle: 'e', enabled: OVERLAY_HANDLES.includes('e') },
        { key: 's', start: bl, end: br, handle: 's', enabled: overlayHandles.includes('s') },
        { key: 'w', start: tl, end: bl, handle: 'w', enabled: overlayHandles.includes('w') },
      ].filter((edge) => edge.enabled)
    : [];

  return (
    <>
      {guides.map((guide) => (
        <div
          key={guide.key}
          className={`fb-constraint-guide fb-constraint-guide--${guide.key}`}
          style={guide.style}
        />
      ))}
      <div
        className={`fb-sel-overlay${el.componentInstance ? ' fb-sel-overlay--component' : ''}`}
        style={overlayBoxStyle}
        onMouseDown={(e) => {
          if (!overlayCapturesPointer || e.target !== e.currentTarget) return;
          e.stopPropagation();
          e.preventDefault();
          onStartMove(e, selection.bpId, el);
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          e.stopPropagation();
          if (canDrill) {
            setDrilledContainerId(el.id);
            setSelection({ elementId: el.id, bpId: selection.bpId });
          }
        }}
      />
      <svg
        className="fb-sel-overlay-svg"
        width={svgWidth}
        height={svgHeight}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 10000 }}
      >
        <polygon
          points={polygonPoints}
          fill="none"
          stroke={outlineColor}
          strokeWidth={2 / scale}
          vectorEffect="non-scaling-stroke"
          style={{ filter: outlineShadow !== 'transparent' ? `drop-shadow(0 0 ${1 / scale}px ${outlineShadow})` : undefined }}
        />
        {edgeResizeLines.map((edge) => (
          <line
            key={`edge-${edge.key}`}
            x1={edge.start.x}
            y1={edge.start.y}
            x2={edge.end.x}
            y2={edge.end.y}
            stroke="rgba(0,0,0,0.001)"
            strokeWidth={16 / scale}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            style={{ cursor: `${edge.handle}-resize` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onStartResize(e, selection.bpId, el, edge.handle);
            }}
          />
        ))}
        {!el.locked && !isDragging && overlayHandles.map((handle) => {
          const point = handlePoints[handle];
          return (
            <rect
              key={handle}
              x={point.x - handleSize / 2}
              y={point.y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={2 / scale}
              ry={2 / scale}
              fill={useComponentSelectionAccent ? 'var(--component-accent)' : '#fff'}
              stroke={outlineColor}
              strokeWidth={1.5 / scale}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
              style={{ cursor: `${handle}-resize` }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartResize(e, selection.bpId, el, handle);
              }}
            />
          );
        })}
        {!el.locked && !isDragging && rotateHandles.map((handle) => {
          const point = rotatePoints[handle];
          return (
            <rect
              key={`rotate-${handle}`}
              x={point.x - rotateHandleSize / 2}
              y={point.y - rotateHandleSize / 2}
              width={rotateHandleSize}
              height={rotateHandleSize}
              fill="rgba(0,0,0,0.001)"
              pointerEvents="all"
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartResize(e, selection.bpId, el, `rotate-${handle}`);
              }}
            />
          );
        })}
        {!el.locked && !isDragging && onStartRadiusDrag && Object.entries(radiusAnchorPoints).map(([corner, point]) => {
          const styleKey = corner === 'all' ? 'borderRadius' : `borderRadius${corner}`;
          const radiusValue = resolved.styles?.[styleKey] ?? resolved.styles?.borderRadius;
          const startRadius = typeof radiusValue === 'number' ? radiusValue : parseFloat(radiusValue) || 0;
          return (
            <circle
              key={`radius-${corner}`}
              cx={point.x}
              cy={point.y}
              r={radiusHandleSize / 2}
              fill="#fff"
              stroke="#3b82f6"
              strokeWidth={1.5 / scale}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
              style={{ cursor: 'crosshair' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartRadiusDrag(e, selection.bpId, el.id, startRadius, corner === 'all' ? null : corner);
              }}
            />
          );
        })}
      </svg>
    </>
  );
}

export default function InfiniteCanvas() {
  const containerRef = useRef(null);
  const worldRef     = useRef(null);
  const lastPointerClientRef = useRef({ x: null, y: null });

  const viewport      = useEditorStore(s => s.viewport);
  const setViewport   = useEditorStore(s => s.setViewport);
  const activeSurface = useEditorStore(s => s.activeSurface);
  const componentEditor = useEditorStore(s => s.componentEditor);
  const bpDefs        = useEditorStore(s => s.breakpointDefs);
  const setSelection  = useEditorStore(s => s.setSelection);
  const setArtboardSel = useEditorStore(s => s.setArtboardSel);
  const artboardSel    = useEditorStore(s => s.artboardSel);
  const setDrilled     = useEditorStore(s => s.setDrilledContainerId);
  const addElement          = useEditorStore(s => s.addElement);
  const addElements         = useEditorStore(s => s.addElements);
  const createComponentFromElement = useEditorStore(s => s.createComponentFromElement);
  const insertComponentInstance = useEditorStore(s => s.insertComponentInstance);
  const openComponentEditor = useEditorStore(s => s.openComponentEditor);
  const addComponentVariant = useEditorStore(s => s.addComponentVariant);
  const updateComponentEditorVariantInteraction = useEditorStore(s => s.updateComponentEditorVariantInteraction);
  const deleteElement       = useEditorStore(s => s.deleteElement);
  const reparentElement      = useEditorStore(s => s.reparentElement);
  const setHoveredId         = useEditorStore(s => s.setHoveredId);
  const hoveredId            = useEditorStore(s => s.hoveredId);
  const pushHistory          = useEditorStore(s => s.pushHistory);
  const setInteracting       = useEditorStore(s => s.setInteracting);
  const pendingDraw          = useEditorStore(s => s.pendingDraw);
  const setPendingDraw       = useEditorStore(s => s.setPendingDraw);

  // Draw-mode rubber-band preview rect (screen coords)
  const [drawRect, setDrawRect] = useState(null); // { left, top, width, height } in screen px

  // ── Pan state ──────────────────────────────────────────────
  const isPanning  = useRef(false);
  const panOrigin  = useRef({ x: 0, y: 0 });
  const panStart   = useRef({ x: 0, y: 0 });
  const spaceDown  = useRef(false);
  const [spacePanCursor, setSpacePanCursor] = useState(false);
  const [reorderTarget,    setReorderTarget]    = useState(null); // { insertBeforeId, bpId, parentId, dragId }
  const [dropTargetId,     setDropTargetId]     = useState(null); // elementId hovered during a 'move' drag
  const [radiusDragInfo,   setRadiusDragInfo]   = useState(null); // { value, clientX, clientY }
  const [paddingDragInfo,  setPaddingDragInfo]  = useState(null); // { value, side, clientX, clientY }
  const [gapDragInfo,      setGapDragInfo]      = useState(null); // { value, clientX, clientY }
  const [foldDragInfo,     setFoldDragInfo]     = useState(null); // { value, clientX, clientY }
  const [textSizeDragInfo, setTextSizeDragInfo] = useState(null); // { value, clientX, clientY }
  const [dragHint,         setDragHint]         = useState(null); // { label, clientX, clientY }
  const [reorderGhost,     setReorderGhost]     = useState(null); // { worldX, worldY, width, height, bgColor? }
  const [reorderIndicatorOverlay, setReorderIndicatorOverlay] = useState(null); // { left, top, width, height, axis } in client px
  const [dragOverlay,      setDragOverlay]      = useState(null); // { elementId, worldX, worldY, width, height }
  const [alignmentGuides,  setAlignmentGuides]  = useState([]); // [{ orientation, x?, y?, start, end }]
  const [draggingElementId, setDraggingElementId] = useState(null); // element being dragged (for ghost opacity)
  const [variantRootLayout, setVariantRootLayout] = useState({});
  const [variantConnectionDraft, setVariantConnectionDraft] = useState(null); // { sourceVariantId, clientX, clientY }
  const [variantInteractionModal, setVariantInteractionModal] = useState(null); // { sourceVariantId, targetVariantId, initialInteraction }
  const [contextMenu,      setContextMenu]      = useState(null);
  const [componentModal,   setComponentModal]   = useState(null);
  const clipboard = useRef(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const resolveVariantRootAtClientPoint = useCallback((clientX, clientY, { excludeVariantId = null } = {}) => {
    const container = containerRef.current;
    if (!container || activeSurface !== 'component') return null;

    const elementIndex = new Map((componentEditor.page?.elements ?? []).map((element) => [element.id, element]));
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      if (!container.contains(node)) continue;
      if (node.closest('.fb-context-menu, .fb-right, .fb-left, .fb-topbar, .fb-overlay-modal')) return null;
      const target = node.closest?.('[data-id]');
      if (!target || !container.contains(target)) continue;

      let cursor = elementIndex.get(target.dataset.id ?? '') ?? null;
      while (cursor?.parentId) {
        cursor = elementIndex.get(cursor.parentId) ?? null;
      }
      if (!cursor?.componentRoot || !cursor?.componentEditorVariantId) continue;
      if (cursor.componentEditorVariantId === excludeVariantId) continue;

      const layout = variantRootLayout[cursor.componentEditorVariantId] ?? null;
      if (!layout) continue;
      return layout;
    }

    return null;
  }, [activeSurface, componentEditor.page?.elements, variantRootLayout]);

  const openVariantInteractionModal = useCallback((sourceVariantId, targetVariantId) => {
    if (!sourceVariantId || !targetVariantId) return;
    const sourceVariant = (componentEditor.variants ?? []).find((variant) => variant.id === sourceVariantId) ?? null;
    if (!sourceVariant) return;

    setVariantInteractionModal({
      sourceVariantId,
      targetVariantId,
      initialInteraction: sourceVariant?.interaction?.targetVariantId === targetVariantId
        ? {
            targetVariantId,
            trigger: sourceVariant.interaction.trigger,
            delay: sourceVariant.interaction.delay ?? 0,
          }
        : {
            targetVariantId,
            trigger: sourceVariant.interaction?.trigger ?? 'click',
            delay: sourceVariant.interaction?.targetVariantId ? (sourceVariant.interaction.delay ?? 0) : 0,
          },
    });
  }, [componentEditor.variants]);

  useLayoutEffect(() => {
    if (!reorderTarget?.bpId) {
      setReorderIndicatorOverlay(null);
      return;
    }

    const st = useEditorStore.getState();
    const artboardDom = document.querySelector(`.fb-artboard[data-bp="${reorderTarget.bpId}"]`);
    const parentDom = reorderTarget.parentId
      ? artboardDom?.querySelector(`[data-id="${reorderTarget.parentId}"]`)
      : artboardDom?.querySelector('.fb-artboard-content');

    if (!artboardDom || !parentDom) {
      setReorderIndicatorOverlay(null);
      return;
    }

    const parentRect = parentDom.getBoundingClientRect();
    if (!parentRect) {
      setReorderIndicatorOverlay(null);
      return;
    }

    const siblingIds = getSiblingIds(st.getAllElements(), reorderTarget.parentId, reorderTarget.dragId);
    const siblingNodes = siblingIds
      .map((id) => ({ id, node: artboardDom.querySelector(`[data-id="${id}"]`) }))
      .filter((entry) => entry.node);
    const axis = getFlexAxis(parentDom);
    const thickness = 3;
    const insertIndex = reorderTarget.insertBeforeId
      ? siblingNodes.findIndex((entry) => entry.id === reorderTarget.insertBeforeId)
      : siblingNodes.length;

    const beforeNode = insertIndex > 0 ? siblingNodes[insertIndex - 1]?.node : null;
    const beforeRect = beforeNode ? beforeNode.getBoundingClientRect() : null;
    const targetNode = reorderTarget.insertBeforeId
      ? siblingNodes.find((entry) => entry.id === reorderTarget.insertBeforeId)?.node ?? null
      : null;
    const targetRect = targetNode ? targetNode.getBoundingClientRect() : null;

    if (axis === 'x') {
      const left = targetRect
        ? targetRect.left - (thickness / 2)
        : beforeRect
          ? beforeRect.right - (thickness / 2)
          : parentRect.left - (thickness / 2);
      setReorderIndicatorOverlay({
        left,
        top: parentRect.top,
        width: thickness,
        height: Math.max(parentRect.height, 16),
        axis,
      });
      return;
    }

    const top = targetRect
      ? targetRect.top - (thickness / 2)
      : beforeRect
        ? beforeRect.bottom - (thickness / 2)
        : parentRect.top - (thickness / 2);
    setReorderIndicatorOverlay({
      left: parentRect.left,
      top,
      width: Math.max(parentRect.width, 16),
      height: thickness,
      axis,
    });
  }, [reorderTarget, viewport.scale]);

  useLayoutEffect(() => {
    if (activeSurface !== 'component' || !componentEditor?.isOpen) {
      setVariantRootLayout({});
      return;
    }

    const boardDom = document.querySelector('.fb-artboard[data-bp="desktop"]');
    const roots = (componentEditor.page?.elements ?? []).filter((el) => !el.parentId && el.componentRoot);
    if (!boardDom || !roots.length) {
      setVariantRootLayout({});
      return;
    }

    const nextLayout = {};
    roots.forEach((root) => {
      const node = boardDom.querySelector(`[data-id="${root.id}"]`);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const currentBp = useEditorStore.getState().breakpointDefs.desktop;
      const currentScale = useEditorStore.getState().viewport.scale ?? 1;
      const boardRect = boardDom.getBoundingClientRect();
      const left = currentBp.x + (rect.left - boardRect.left) / currentScale;
      const top = currentBp.y + (rect.top - boardRect.top) / currentScale;
      const width = rect.width / currentScale;
      const height = rect.height / currentScale;
      const centerY = top + (height / 2);
      const connectorX = left + width;
      const from = { x: connectorX, y: centerY };
      const to = { x: left, y: centerY };
      nextLayout[root.componentEditorVariantId] = {
        variantId: root.componentEditorVariantId,
        rootId: root.id,
        name: root.componentVariantName || 'Primary',
        rect,
        worldRect: {
          left,
          top,
          width,
          height,
        },
        from,
        to,
        connector: from,
      };
    });
    setVariantRootLayout(nextLayout);
  }, [activeSurface, componentEditor?.isOpen, componentEditor?.page?.elements, viewport.x, viewport.y, viewport.scale, componentEditor?.activeVariantId]);

  useEffect(() => {
    if (!variantConnectionDraft) return undefined;

    const handleMove = (e) => {
      setVariantConnectionDraft((current) => (current
        ? { ...current, clientX: e.clientX, clientY: e.clientY }
        : current));
    };

    const handleUp = (e) => {
      setVariantConnectionDraft((current) => {
        if (!current) return current;
        const target = resolveVariantRootAtClientPoint(e.clientX, e.clientY, { excludeVariantId: current.sourceVariantId });

        if (target) {
          openVariantInteractionModal(current.sourceVariantId, target.variantId);
        }

        return null;
      });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [openVariantInteractionModal, resolveVariantRootAtClientPoint, variantConnectionDraft]);

  const canPasteIntoFrame = useCallback((bpId = null, elementId = null) => {
    if (!clipboard.current) return false;
    const st = useEditorStore.getState();
    const resolvedBpId = bpId || st.selection?.bpId || clipboard.current.bpId || 'desktop';
    const candidateId = elementId ?? st.selection?.elementId ?? null;
    if (!candidateId) return false;
    const candidate = st.getAllElements().find((el) => el.id === candidateId) ?? null;
    if (!candidate || candidate.type !== 'frame') return false;
    const resolved = resolveElement(candidate, resolvedBpId);
    return !resolved.hidden;
  }, []);

  const copyElementToClipboard = useCallback((elementId, bpId) => {
    if (!elementId) return false;
    const allEls = useEditorStore.getState().getAllElements();
    const rootEl = allEls.find(el => el.id === elementId);
    if (!rootEl) return false;
    const subtree = [];
    const collectSubtree = (id) => {
      const elem = allEls.find(el => el.id === id);
      if (!elem) return;
      subtree.push(elem);
      (elem.children ?? []).forEach(collectSubtree);
    };
    collectSubtree(rootEl.id);
    clipboard.current = { subtree, rootId: rootEl.id, bpId };
    return true;
  }, []);

  const cutElementToClipboard = useCallback((elementId, bpId) => {
    if (!copyElementToClipboard(elementId, bpId)) return false;
    deleteElement(elementId);
    pushHistory();
    return true;
  }, [copyElementToClipboard, deleteElement, pushHistory]);

  // ── Drag state ─────────────────────────────────────────────
  const drag = useRef(null);
  // drag.current shape:
  // { type:'element-drag'|'resize'|'artboard-move', bpId, elementId?, handle?,
  //   startMX, startMY, startX?, startY?, startW?, startH?, startBpX?, startBpY? }

  const getProjectedWorldPoint = useCallback((clientX, clientY, grabOffsetWorldX = 0, grabOffsetWorldY = 0) => {
    const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
    const containerRect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      worldX: (clientX - containerRect.left - panX) / scale - grabOffsetWorldX,
      worldY: (clientY - containerRect.top - panY) / scale - grabOffsetWorldY,
    };
  }, []);

  const getPlacementFromClient = useCallback((clientX, clientY, bpHint = null) => {
    if (clientX == null || clientY == null) return null;
    const st = useEditorStore.getState();
    const { worldX, worldY } = getProjectedWorldPoint(clientX, clientY, 0, 0);
    const bpList = Object.values(st.breakpointDefs);
    const hintedBp = bpHint ? st.breakpointDefs[bpHint] ?? null : null;
    const containingBp = bpList.find((bp) => (
      worldX >= bp.x && worldX <= bp.x + bp.width &&
      worldY >= bp.y && worldY <= bp.y + bp.height
    )) ?? null;
    const bp = containingBp ?? hintedBp ?? st.breakpointDefs[st.selection?.bpId ?? ''] ?? st.breakpointDefs.desktop ?? bpList[0] ?? null;
    if (!bp) return null;
    const page = st.getCurrentPage?.();
    const pad = resolvePagePadding(page?.padding, bp.id);
    return {
      bpId: bp.id,
      worldX,
      worldY,
      x: Math.round(worldX - bp.x - (pad?.left ?? 0)),
      y: Math.round(worldY - bp.y - (pad?.top ?? 0)),
    };
  }, [getProjectedWorldPoint]);

  const getParentPlacementFromClient = useCallback((clientX, clientY, bpId, parentId) => {
    if (clientX == null || clientY == null || !bpId || !parentId) return null;
    const { scale } = useEditorStore.getState().viewport;
    const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
    const parentDom = boardDom?.querySelector(`[data-id="${parentId}"]`) ?? null;
    if (!parentDom) return null;
    const rect = parentDom.getBoundingClientRect();
    return {
      x: Math.round((clientX - rect.left - parentDom.clientLeft) / scale),
      y: Math.round((clientY - rect.top - parentDom.clientTop) / scale),
    };
  }, []);

  const pasteClipboardAt = useCallback(({ bpId = null, parentId = null, x = null, y = null, clientX = null, clientY = null }) => {
    if (!clipboard.current) return false;
    const st = useEditorStore.getState();
    const { subtree, rootId, bpId: copiedBpId } = clipboard.current;
    const targetBpId = bpId || st.selection?.bpId || copiedBpId || 'desktop';
    const selectedEl = st.getSelectedElement?.() ?? null;
    const activeSelectedFrameId = selectedEl && selectedEl.type === 'frame' && st.selection?.bpId === targetBpId
      ? selectedEl.id
      : null;
    const targetParentId = parentId ?? activeSelectedFrameId ?? null;
    if (!targetParentId) return false;
    const cursorPlacement = getPlacementFromClient(
      clientX ?? lastPointerClientRef.current.x,
      clientY ?? lastPointerClientRef.current.y,
      targetBpId,
    );
    const parentPlacement = targetParentId
      ? getParentPlacementFromClient(
          clientX ?? lastPointerClientRef.current.x,
          clientY ?? lastPointerClientRef.current.y,
          targetBpId,
          targetParentId,
        )
      : null;
    const targetX = parentPlacement?.x ?? cursorPlacement?.x ?? x ?? 20;
    const targetY = parentPlacement?.y ?? cursorPlacement?.y ?? y ?? 20;
    const cloned = cloneSubtree(subtree, rootId).map((el) => {
      if (targetBpId === 'desktop') return el;
      return {
        ...el,
        base: { ...el.base, hidden: true },
        overrides: {
          ...el.overrides,
          [targetBpId]: {
            ...(el.overrides?.[targetBpId] ?? {}),
            hidden: false,
          },
        },
      };
    });
    const root = cloned[0];
    if (!root) return false;
    if (targetBpId === 'desktop') {
      root.base = { ...root.base, x: targetX, y: targetY };
    } else {
      root.overrides = {
        ...root.overrides,
        [targetBpId]: {
          ...(root.overrides?.[targetBpId] ?? {}),
          x: targetX,
          y: targetY,
          hidden: false,
        },
      };
    }
    addElements(cloned);
    if (targetParentId) {
      st.reparentElement(root.id, targetParentId);
    }
    useEditorStore.getState().setSelection({ elementId: root.id, bpId: targetBpId });
    pushHistory();
    return true;
  }, [addElements, getParentPlacementFromClient, getPlacementFromClient, pushHistory]);

  const resolveHoveredElementId = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return null;
    if (variantConnectionDraft) {
      const eligibleRoot = resolveVariantRootAtClientPoint(clientX, clientY, { excludeVariantId: variantConnectionDraft.sourceVariantId });
      return eligibleRoot?.rootId ?? null;
    }
    const topNode = document.elementFromPoint(clientX, clientY);
    if (!topNode || !container.contains(topNode)) return null;
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      if (!container.contains(node)) continue;
      if (node.closest('.fb-context-menu, .fb-right, .fb-left, .fb-topbar, .fb-overlay-modal')) return null;
      const target = node.closest?.('[data-id]');
      if (!target || !container.contains(target)) continue;
      return target.dataset.id ?? null;
    }
    return null;
  }, [resolveVariantRootAtClientPoint, variantConnectionDraft]);

  const resolveElementDragDrop = useCallback((session, clientX, clientY) => {
    const st = useEditorStore.getState();
    const allEls = st.getAllElements();
    const draggedEl = allEls.find(el => el.id === session.elementId);
    if (!draggedEl) return null;

    const bp = st.breakpointDefs[session.bpId];
    if (!bp) return null;

    const page = st.getCurrentPage?.();
    const pagePadding = resolvePagePadding(page?.padding, session.bpId);
    const pageLayout = resolvePageLayout(page?.layout, session.bpId);
    const artboardDom = document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`);
    const artboardRect = artboardDom?.getBoundingClientRect() ?? null;
    const { scale } = st.viewport;
    const { worldX: projectedWorldX, worldY: projectedWorldY } = getDragSessionWorldPosition(session, clientX, clientY, getProjectedWorldPoint);

    const projectedClientW = session.ghostClientW ?? ((session.ghostW ?? 100) * scale);
    const projectedClientH = session.ghostClientH ?? ((session.ghostH ?? 40) * scale);
    const clientLeft = clientX - (session.grabOffsetClientX ?? projectedClientW / 2);
    const clientTop = clientY - (session.grabOffsetClientY ?? projectedClientH / 2);
    const clientRight = clientLeft + projectedClientW;
    const clientBottom = clientTop + projectedClientH;
    let worldX = projectedWorldX;
    let worldY = projectedWorldY;

    const overlapRatioWithRect = (rect) => {
      if (!rect) return 0;
      const overlapW = Math.max(0, Math.min(clientRight, rect.right) - Math.max(clientLeft, rect.left));
      const overlapH = Math.max(0, Math.min(clientBottom, rect.bottom) - Math.max(clientTop, rect.top));
      return (overlapW * overlapH) / Math.max(1, projectedClientW * projectedClientH);
    };

    const pointerInsideArtboard = !!artboardRect
      && clientX >= artboardRect.left
      && clientX <= artboardRect.right
      && clientY >= artboardRect.top
      && clientY <= artboardRect.bottom;
    const treatAsFlowDrag = session.origWasFlow || session.dragMode === 'flow' || session.origPositionType === 'relative';
    const offCanvas = treatAsFlowDrag
      ? !pointerInsideArtboard
      : (!artboardRect || overlapRatioWithRect(artboardRect) < 0.35);
    const descendants = collectDescendantIds(allEls, session.elementId);
    let dropContainer = null;
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      const dataId = node.dataset?.id;
      if (!dataId || descendants.has(dataId)) continue;
      const candidate = allEls.find(el => el.id === dataId);
      if (!candidate || candidate.type !== 'frame') continue;
      const candidateResolved = resolveElement(candidate, session.bpId);
      if (candidateResolved.hidden) continue;
      dropContainer = candidate;
      break;
    }

    const containerResolved = dropContainer ? resolveElement(dropContainer, session.bpId) : null;
    const containerIsFlex = containerResolved?.styles?.display === 'flex';
    const wasRootLevel = session.origParentId == null;
    const canRootFlow = !!pageLayout
      && session.origPositionType !== 'fixed'
      && wasRootLevel
      && (session.origWasFlow || session.origWasOffCanvas || session.dragMode === 'flow');

    let mode = 'root-free';
    let targetParentId = null;
    if (session.origPositionType === 'fixed') {
      mode = 'fixed-root';
    } else if (offCanvas) {
      mode = 'offcanvas';
    } else if (dropContainer) {
      targetParentId = dropContainer.id;
      mode = containerIsFlex ? 'container-flow' : 'container-free';
    } else if (canRootFlow) {
      mode = 'root-flow';
    }

    let reorderTarget = null;
    let insertBeforeId = null;
    let snappedWorldX = worldX;
    let snappedWorldY = worldY;
    let alignmentGuideData = [];
    if (mode === 'root-flow' || mode === 'container-flow') {
      const reorderParentId = mode === 'container-flow' ? targetParentId : null;
      const siblingIds = getSiblingIds(allEls, reorderParentId, session.elementId);
      const parentDom = reorderParentId ? artboardDom?.querySelector(`[data-id="${reorderParentId}"]`) : artboardDom;
      const axis = reorderParentId
        ? ((containerResolved?.styles?.flexDirection ?? 'column') === 'row' ? 'x' : 'y')
        : ((pageLayout?.flexDirection ?? 'column') === 'row' ? 'x' : 'y');
      insertBeforeId = getInsertBeforeIdFromDom(parentDom, siblingIds, clientX, clientY, axis);
      reorderTarget = {
        insertBeforeId,
        bpId: session.bpId,
        parentId: reorderParentId,
        dragId: session.elementId,
      };
    } else if (!session.hasRotation) {
      const snapParentId = mode === 'container-free' ? targetParentId : null;
      const snapSiblingIds = getSiblingIds(allEls, snapParentId, session.elementId);
      const snapParentDom = snapParentId ? artboardDom?.querySelector(`[data-id="${snapParentId}"]`) : artboardDom;
      const draggedRect = {
        left: worldX,
        top: worldY,
        width: session.ghostW ?? 100,
        height: session.ghostH ?? 40,
        right: worldX + (session.ghostW ?? 100),
        bottom: worldY + (session.ghostH ?? 40),
        centerX: worldX + (session.ghostW ?? 100) / 2,
        centerY: worldY + (session.ghostH ?? 40) / 2,
      };
      let bestSnapX = null;
      let bestSnapY = null;
      for (const siblingId of snapSiblingIds) {
        const node = snapParentDom?.querySelector(`[data-id="${siblingId}"]`);
        const siblingRect = getNodeWorldRect(node, artboardDom, bp, scale);
        if (!siblingRect) continue;
        const xPairs = [
          { target: siblingRect.left, source: draggedRect.left },
          { target: siblingRect.centerX, source: draggedRect.centerX },
          { target: siblingRect.right, source: draggedRect.right },
        ];
        const yPairs = [
          { target: siblingRect.top, source: draggedRect.top },
          { target: siblingRect.centerY, source: draggedRect.centerY },
          { target: siblingRect.bottom, source: draggedRect.bottom },
        ];
        for (const pair of xPairs) {
          const delta = pair.target - pair.source;
          const distancePx = Math.abs(delta) * scale;
          if (distancePx > SNAP_THRESHOLD_PX) continue;
          if (!bestSnapX || distancePx < bestSnapX.distancePx) {
            bestSnapX = {
              delta,
              distancePx,
              guide: {
                orientation: 'vertical',
                x: pair.target,
                start: Math.min(draggedRect.top, siblingRect.top),
                end: Math.max(draggedRect.bottom, siblingRect.bottom),
              },
            };
          }
        }
        for (const pair of yPairs) {
          const delta = pair.target - pair.source;
          const distancePx = Math.abs(delta) * scale;
          if (distancePx > SNAP_THRESHOLD_PX) continue;
          if (!bestSnapY || distancePx < bestSnapY.distancePx) {
            bestSnapY = {
              delta,
              distancePx,
              guide: {
                orientation: 'horizontal',
                y: pair.target,
                start: Math.min(draggedRect.left, siblingRect.left),
                end: Math.max(draggedRect.right, siblingRect.right),
              },
            };
          }
        }
      }
      if (bestSnapX) {
        snappedWorldX += bestSnapX.delta;
        alignmentGuideData.push(bestSnapX.guide);
      }
      if (bestSnapY) {
        snappedWorldY += bestSnapY.delta;
        alignmentGuideData.push(bestSnapY.guide);
      }
    }

    return {
      bp,
      pagePadding,
      pageLayout,
      artboardDom,
      artboardRect,
      dropContainer,
      targetParentId,
      mode,
      insertBeforeId,
      reorderTarget,
      alignmentGuides: alignmentGuideData,
      dropTargetId: dropContainer?.id ?? null,
      hint: mode === 'root-flow' || mode === 'container-flow' ? 'Auto' : 'Free',
      clientLeft,
      clientTop,
      worldX: snappedWorldX,
      worldY: snappedWorldY,
      ghost: {
        worldX: snappedWorldX,
        worldY: snappedWorldY,
        width: session.ghostW ?? 100,
        height: session.ghostH ?? 40,
        bgColor: session.ghostBgColor,
        rotation: session.rotation ?? 0,
      },
    };
  }, [getProjectedWorldPoint]);

  // ── Keyboard ───────────────────────────────────────────────
  useEffect(() => {
    const handlePointerDown = () => setContextMenu(null);
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const isEditableTarget = e.target.matches('input,textarea') || e.target.isContentEditable;
      if (e.code === 'Space' && !e.target.matches('input,textarea')) {
        e.preventDefault();
        spaceDown.current = true;
        setSpacePanCursor(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      }
      // Escape: cancel draw mode first, then move one level up in drill mode.
      if (e.key === 'Escape' && !isEditableTarget) {
        const st = useEditorStore.getState();
        if (st.pendingDraw) {
          st.setPendingDraw(null);
          return;
        }
        const drilled = st.drilledContainerId;
        if (drilled !== null) {
          const drilledEl = st.getAllElements().find(el => el.id === drilled);
          const parentId = drilledEl?.parentId ?? null;
          st.setDrilledContainerId(parentId);
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        const selectedEl = useEditorStore.getState().getAllElements().find((el) => el.id === selection.elementId);
        if (!selectedEl || selectedEl.locked) return;
        e.preventDefault();
        deleteElement(selection.elementId);
        pushHistory();
        return;
      }
      // Arrow nudge (1px, or 10px with Shift)
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        e.preventDefault();
        const nudgeEl = useEditorStore.getState().getAllElements().find(el => el.id === selection.elementId);
        if (!nudgeEl || nudgeEl.locked) return;
        const nudgeRes = resolveElement(nudgeEl, selection.bpId);
        if (nudgeRes.positionType === 'relative') return;
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
        useEditorStore.getState().updateElementLayout(selection.elementId, selection.bpId, {
          x: (nudgeRes.x ?? 0) + dx,
          y: (nudgeRes.y ?? 0) + dy,
        });
        useEditorStore.getState().pushHistory();
      }
      // Copy (Cmd/Ctrl+C)
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        copyElementToClipboard(selection.elementId, selection.bpId);
      }
      // Cut (Cmd/Ctrl+X)
      if ((e.metaKey || e.ctrlKey) && e.key === 'x' && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        cutElementToClipboard(selection.elementId, selection.bpId);
      }
      // Paste (Cmd/Ctrl+V)
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !isEditableTarget) {
        if (!clipboard.current) return;
        const currentBpId = useEditorStore.getState().selection?.bpId ?? clipboard.current.bpId;
        if (!canPasteIntoFrame(currentBpId)) return;
        pasteClipboardAt({
          bpId: currentBpId,
          clientX: lastPointerClientRef.current.x,
          clientY: lastPointerClientRef.current.y,
        });
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        setSpacePanCursor(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [canPasteIntoFrame, copyElementToClipboard, cutElementToClipboard, deleteElement, pasteClipboardAt, pushHistory]);

  // ── Initial fit-to-canvas ─────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    // All artboards total width
    const bps = Object.values(bpDefs);
    const totalW = bps.reduce((sum, b, i) => sum + b.width + (i < bps.length - 1 ? 100 : 0), 0) + 200;
    const totalH = Math.max(...bps.map(b => b.height)) + 280;
    const scaleX = (width - 60) / totalW;
    const scaleY = (height - 60) / totalH;
    const scale  = Math.min(scaleX, scaleY, 0.9);
    const worldW = totalW * scale;
    const worldH = totalH * scale;
    setViewport({ x: (width - worldW) / 2, y: (height - worldH) / 2 + 20, scale });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wheel (zoom + pan) ─────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Zoom towards pointer
      setViewport((vp) => {
        const factor   = e.deltaY > 0 ? 0.92 : 1.08;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * factor));
        const ratio    = newScale / vp.scale;
        return {
          x: mx - (mx - vp.x) * ratio,
          y: my - (my - vp.y) * ratio,
          scale: newScale,
        };
      });
    } else {
      // Pan
      setViewport((vp) => ({
        ...vp,
        x: vp.x - e.deltaX,
        y: vp.y - e.deltaY,
      }));
    }
  }, [setViewport]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Mouse down (pan only; empty-space clicks keep selection) ─────────────
  const onMouseDown = (e) => {
    if (contextMenu) setContextMenu(null);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      isPanning.current = true;
      panOrigin.current = { x: e.clientX, y: e.clientY };
      panStart.current  = { x: viewport.x, y: viewport.y };
      return;
    }
    if (e.button === 0 && e.target === e.currentTarget) {
      setSelection(null);
      setArtboardSel(null);
      setDrilled(null);
    }
  };

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const artboardNode = e.target.closest('.fb-artboard[data-bp]');
    const bpId = artboardNode?.dataset.bp ?? useEditorStore.getState().selection?.bpId ?? 'desktop';
    const elementNode = e.target.closest('[data-id]');
    const elementId = elementNode?.dataset.id ?? null;
    const bp = useEditorStore.getState().breakpointDefs[bpId];
    const page = useEditorStore.getState().getCurrentPage();
    const pad = resolvePagePadding(page?.padding, bpId);
    const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
    const worldX = (e.clientX - containerRect.left - panX) / scale;
    const worldY = (e.clientY - containerRect.top - panY) / scale;
    const localX = bp ? Math.max(0, Math.round(worldX - bp.x - (pad?.left ?? 0))) : 80;
    const localY = bp ? Math.max(0, Math.round(worldY - bp.y - (pad?.top ?? 0))) : 80;

    if (elementId) {
      setSelection({ elementId, bpId });
      setArtboardSel(null);
    }

    setContextMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      bpId,
      elementId,
      canPasteIntoFrame: canPasteIntoFrame(bpId, elementId),
      localX,
      localY,
      onCreateComponent: () => {
        if (!elementId) return;
        const element = useEditorStore.getState().getAllElements().find(el => el.id === elementId);
        setComponentModal({
          elementId,
          defaultName: element?.name || 'Component',
        });
      },
    });
  }, [canPasteIntoFrame, setArtboardSel, setSelection]);

  // ── Mouse move (pan + element drag/resize) ─────────────────
  const onMouseMove = useCallback((e) => {
    lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
    // Pan — read scale from store to avoid stale closure
    if (isPanning.current) {
      const currentScale = useEditorStore.getState().viewport.scale;
      const dx = e.clientX - panOrigin.current.x;
      const dy = e.clientY - panOrigin.current.y;
      setViewport({ x: panStart.current.x + dx, y: panStart.current.y + dy, scale: currentScale });
      return;
    }

    // Element hover
    if (!drag.current) {
      const hoveredId = resolveHoveredElementId(e.clientX, e.clientY);
      if (useEditorStore.getState().hoveredId !== hoveredId) {
        setHoveredId(hoveredId);
      }
      return;
    }

    // ── Draw rubber-band preview ────────────────────────────
    if (drag.current.type === 'draw') {
      const rect = containerRef.current.getBoundingClientRect();
      const rawW = e.clientX - drag.current.startMX;
      const rawH = e.clientY - drag.current.startMY;
      setDrawRect({
        left:   rect.left + Math.min(drag.current.startMX, e.clientX) - rect.left,
        top:    rect.top  + Math.min(drag.current.startMY, e.clientY) - rect.top,
        width:  Math.abs(rawW),
        height: Math.abs(rawH),
      });
      return;
    }

    const { type, bpId, elementId, handle,
            startMX, startMY, startX, startY, startW, startH } = drag.current;
    const { scale } = useEditorStore.getState().viewport;

    const dxScreen = e.clientX - startMX;
    const dyScreen = e.clientY - startMY;
    const dxWorld  = dxScreen / scale;
    const dyWorld  = dyScreen / scale;
    // Track last mouse position (used for off-canvas eject)
    drag.current.lastMX = e.clientX;
    drag.current.lastMY = e.clientY;

    if (type === 'element-drag') {
      const hasMoved = Math.abs(e.clientX - drag.current.startMX) > 4 ||
        Math.abs(e.clientY - drag.current.startMY) > 4;
      if (hasMoved) drag.current.hasMoved = true;
      if (shouldUseDirectRotatedMove(drag.current)) {
        useEditorStore.getState().updateElementLayout(elementId, bpId, {
          x: drag.current.startX + dxWorld,
          y: drag.current.startY + dyWorld,
        });
        setReorderTarget(null);
        setDropTargetId(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
        setDragHint(null);
        return;
      }
      const resolvedPreview = resolveElementDragDrop(drag.current, e.clientX, e.clientY);
      const fallbackWorld = getDragSessionWorldPosition(drag.current, e.clientX, e.clientY, getProjectedWorldPoint);
      const fallbackPreview = buildFallbackDragPreview({
        session: drag.current,
        worldX: fallbackWorld.worldX,
        worldY: fallbackWorld.worldY,
        bp: useEditorStore.getState().breakpointDefs[drag.current.bpId] ?? null,
        pagePadding: resolvePagePadding(useEditorStore.getState().getCurrentPage?.()?.padding, drag.current.bpId),
        pageLayout: resolvePageLayout(useEditorStore.getState().getCurrentPage?.()?.layout, drag.current.bpId),
        artboardDom: document.querySelector(`.fb-artboard[data-bp="${drag.current.bpId}"]`),
        artboardRect: document.querySelector(`.fb-artboard[data-bp="${drag.current.bpId}"]`)?.getBoundingClientRect?.() ?? null,
      });
      const preview = resolvedPreview ?? fallbackPreview;
      const previewIsValid = preview
        && [preview.worldX, preview.worldY, preview.ghost?.worldX, preview.ghost?.worldY, preview.ghost?.width, preview.ghost?.height].every(Number.isFinite);
      if (!previewIsValid) {
        setReorderTarget(null);
        setDropTargetId(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
        setDragHint(null);
        return;
      }
      drag.current.preview = preview;
      setReorderTarget(preview.reorderTarget);
      setDropTargetId(preview.dropTargetId);
      setDragOverlay({ elementId, ...preview.ghost });
      setReorderGhost(preview.hint === 'Auto' ? preview.ghost : null);
      setAlignmentGuides(preview.alignmentGuides ?? []);
      setDragHint({ label: preview.hint, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'artboard-move') {
      useEditorStore.getState().updateBreakpointDef(bpId, {
        x: drag.current.startBpX + dxWorld,
        y: drag.current.startBpY + dyWorld,
      });
    } else if (type === 'artboard-resize') {
      useEditorStore.getState().updateBreakpointDef(bpId, {
        height: Math.max(100, drag.current.startH + dyWorld),
      });
    } else if (type === 'artboard-padding') {
      const { side, startPad } = drag.current;
      const newPad = { ...startPad };
      if (side === 'top')    newPad.top    = Math.max(0, startPad.top    + dyWorld);
      if (side === 'bottom') newPad.bottom = Math.max(0, startPad.bottom - dyWorld);
      if (side === 'left')   newPad.left   = Math.max(0, startPad.left   + dxWorld);
      if (side === 'right')  newPad.right  = Math.max(0, startPad.right  - dxWorld);
      useEditorStore.getState().setPagePadding(bpId, newPad);
      setPaddingDragInfo({ side, value: Math.round(newPad[side]), clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'artboard-gap') {
      const { isRow, startGap, layout } = drag.current;
      const newGap = Math.max(0, Math.round(startGap + (isRow ? dxWorld : dyWorld)));
      useEditorStore.getState().setPageLayout(bpId, { ...layout, gap: newGap });
      setGapDragInfo({ value: newGap, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'rotate') {
      const { elementId: rotId, startRotation = 0, startAngle = 0, centerX = 0, centerY = 0 } = drag.current;
      const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      let nextRotation = Math.round((startRotation + currentAngle - startAngle) * 10) / 10;
      if (e.shiftKey) nextRotation = Math.round(nextRotation / 15) * 15;
      useEditorStore.getState().updateElementLayout(rotId, bpId, { rotation: nextRotation });
      setDragHint({ label: `${Math.round(nextRotation)}deg`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'resize') {
      let newX = startX, newY = startY, newW = startW, newH = startH;
      switch (handle) {
        case 'se': newW = Math.max(20, startW + dxWorld); newH = Math.max(20, startH + dyWorld); break;
        case 'sw': newX = startX + dxWorld; newW = Math.max(20, startW - dxWorld); newH = Math.max(20, startH + dyWorld); break;
        case 'ne': newW = Math.max(20, startW + dxWorld); newY = startY + dyWorld; newH = Math.max(20, startH - dyWorld); break;
        case 'nw': newX = startX + dxWorld; newY = startY + dyWorld; newW = Math.max(20, startW - dxWorld); newH = Math.max(20, startH - dyWorld); break;
        case 'n':  newY = startY + dyWorld; newH = Math.max(20, startH - dyWorld); break;
        case 's':  newH = Math.max(20, startH + dyWorld); break;
        case 'e':  newW = Math.max(20, startW + dxWorld); break;
        case 'w':  newX = startX + dxWorld; newW = Math.max(20, startW - dxWorld); break;
        default: break;
      }
      useEditorStore.getState().updateElementLayout(elementId, bpId, { x: newX, y: newY, width: newW, height: newH });
    } else if (type === 'text-font-size') {
      const { elementId: textId, bpId: textBpId, startFontSize } = drag.current;
      const delta = Math.max(dxWorld, dyWorld);
      let nextFontSize = Math.max(4, Math.round((startFontSize + delta) * 10) / 10);
      if (e.shiftKey) nextFontSize = Math.max(4, Math.round(nextFontSize / 4) * 4);
      useEditorStore.getState().updateElementStyles(textId, textBpId, { fontSize: nextFontSize, fontSizeUnit: 'px' });
      setTextSizeDragInfo({ value: nextFontSize, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'radius') {
      const { elementId: radId, bpId: radBp, startRadius, corner } = drag.current;
      const allEls = useEditorStore.getState().getAllElements();
      const radEl  = allEls.find(el => el.id === radId);
      if (!radEl) return;
      const res    = resolveElement(radEl, radBp);
      const maxR   = Math.floor(Math.min(res.width ?? 9999, res.height ?? 9999) / 2);
      const newR   = Math.max(0, Math.min(maxR, Math.round(startRadius + dxWorld)));
      const styleKey = corner ? `borderRadius${corner}` : 'borderRadius';
      useEditorStore.getState().updateElementStyles(radId, radBp, { [styleKey]: newR });
      setRadiusDragInfo({ value: newR, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'element-padding') {
      const { side, startPad, elementId: elId, bpId: elBp } = drag.current;
      const newPad = { ...startPad };
      if (side === 'top')    newPad.paddingTop    = Math.max(0, Math.round(startPad.paddingTop    + dyWorld));
      if (side === 'bottom') newPad.paddingBottom = Math.max(0, Math.round(startPad.paddingBottom - dyWorld));
      if (side === 'left')   newPad.paddingLeft   = Math.max(0, Math.round(startPad.paddingLeft   + dxWorld));
      if (side === 'right')  newPad.paddingRight  = Math.max(0, Math.round(startPad.paddingRight  - dxWorld));
      const capKey = side.charAt(0).toUpperCase() + side.slice(1);
      useEditorStore.getState().updateElementStyles(elId, elBp, newPad);
      setPaddingDragInfo({ side, value: newPad[`padding${capKey}`], clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'viewport-fold') {
      const { startFoldH, bpId: foldBpId, initialFixedEls } = drag.current;
      const newFoldH = Math.max(100, Math.round(startFoldH + dyWorld));
      useEditorStore.getState().updateBreakpointDef(foldBpId, { viewportFoldH: newFoldH });
      // Move fixed elements with bottom constraint: maintain their distance from the fold
      if (initialFixedEls?.length) {
        const foldDelta = newFoldH - startFoldH;
        initialFixedEls.forEach(({ id, y }) => {
          useEditorStore.getState().updateElementLayout(id, foldBpId, { y: y + foldDelta });
        });
      }
      setFoldDragInfo({ value: newFoldH, clientX: e.clientX, clientY: e.clientY });
    }
  }, [getProjectedWorldPoint, resolveElementDragDrop, resolveHoveredElementId, setHoveredId, setViewport]);

  const onMouseUp = useCallback((e) => {
    if (isPanning.current) {
      isPanning.current = false;
    }
    // ── Commit draw ─────────────────────────────────────────
    if (drag.current?.type === 'draw') {
      const { drawType, startMX, startMY, startWorldX, startWorldY } = drag.current;
      drag.current = null;
      setDrawRect(null);
      const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
      const rect = containerRef.current.getBoundingClientRect();
      const endWorldX = (e.clientX - rect.left - panX) / scale;
      const endWorldY = (e.clientY - rect.top  - panY) / scale;
      const rawW = endWorldX - startWorldX;
      const rawH = endWorldY - startWorldY;
      const elX = Math.round(Math.min(startWorldX, endWorldX));
      const elY = Math.round(Math.min(startWorldY, endWorldY));
      const elW = Math.max(20, Math.round(Math.abs(rawW)));
      const elH = Math.max(20, Math.round(Math.abs(rawH)));
      // Detect which artboard: check which bp contains the DRAW-START point.
      // Falls back to nearest artboard centre so drawing outside artboards still works.
      const bpDefsNow = useEditorStore.getState().breakpointDefs;
      let targetBpId = null;
      for (const bp of Object.values(bpDefsNow)) {
        if (startWorldX >= bp.x && startWorldX <= bp.x + bp.width &&
            startWorldY >= bp.y && startWorldY <= bp.y + bp.height) {
          targetBpId = bp.id; break;
        }
      }
      if (!targetBpId) {
        // Off-canvas draw: assign to nearest artboard
        let minDist = Infinity;
        for (const bp of Object.values(bpDefsNow)) {
          const d = Math.hypot(startWorldX - (bp.x + bp.width / 2), startWorldY - (bp.y + bp.height / 2));
          if (d < minDist) { minDist = d; targetBpId = bp.id; }
        }
      }
      if (!targetBpId) { setPendingDraw(null); return; }
      const targetBpDef = bpDefsNow[targetBpId];
      const page2 = useEditorStore.getState().getCurrentPage();
      const pad2  = resolvePagePadding(page2?.padding, targetBpId);
      let localX = Math.round(elX - targetBpDef.x - (pad2?.left ?? 0));
      let localY = Math.round(elY - targetBpDef.y - (pad2?.top  ?? 0));
      // Hit-test at the START of the draw to find the parent container
      let parentId = null;
      {
        const hits = document.elementsFromPoint(startMX, startMY);
        const allEls = useEditorStore.getState().getAllElements();
        for (const domEl of hits) {
          const dataId = domEl.dataset?.id;
          if (!dataId) continue;
          const candidate = allEls.find(el => el.id === dataId);
          if (!candidate || candidate.type !== 'frame') continue;
          const candidateResolved = resolveElement(candidate, targetBpId);
          if (candidateResolved.hidden) continue;
          parentId = dataId;
          const cRect = domEl.getBoundingClientRect();
          const aRect = containerRef.current.getBoundingClientRect();
          const { x: panX2, y: panY2, scale: sc2 } = useEditorStore.getState().viewport;
          const cWorldX = (cRect.left - aRect.left - panX2) / sc2;
          const cWorldY = (cRect.top  - aRect.top  - panY2) / sc2;
          localX = Math.round(elX - cWorldX);
          localY = Math.round(elY - cWorldY);
          break;
        }
      }
      const newEl = drawType === 'image'
        ? createImage(localX, localY)
        : drawType === 'text'
          ? createText(localX, localY)
          : createFrame(localX, localY);
      newEl.base.width  = elW;
      newEl.base.height = elH;
      addElement(newEl, parentId, targetBpId);
      // If drawn inside a container, drill into it so the element is interactable
      if (parentId) useEditorStore.getState().setDrilledContainerId(parentId);
      useEditorStore.getState().setSelection({ elementId: newEl.id, bpId: targetBpId });
      pushHistory();
      setPendingDraw(null);
      return;
    }
    if (drag.current) {
      let shouldPushHistory = drag.current.type !== 'element-drag' || !!drag.current.hasMoved;
      if (drag.current.type === 'viewport-fold') {
        setFoldDragInfo(null);
        drag.current = null;
        setInteracting(false);
        return;
      }
      if (drag.current.type === 'element-drag') {
        const session = drag.current;
        shouldPushHistory = !!session.hasMoved;
        if (shouldUseDirectRotatedMove(session)) {
          setReorderTarget(null);
          setDropTargetId(null);
        } else if (session.hasMoved) {
          const fallbackWorld = getDragSessionWorldPosition(session, e.clientX, e.clientY, getProjectedWorldPoint);
          const fallbackDrop = buildFallbackDragPreview({
            session,
            worldX: fallbackWorld.worldX,
            worldY: fallbackWorld.worldY,
            bp: useEditorStore.getState().breakpointDefs[session.bpId] ?? null,
            pagePadding: resolvePagePadding(useEditorStore.getState().getCurrentPage?.()?.padding, session.bpId),
            pageLayout: resolvePageLayout(useEditorStore.getState().getCurrentPage?.()?.layout, session.bpId),
            artboardDom: document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`),
            artboardRect: document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`)?.getBoundingClientRect?.() ?? null,
          });
          const drop = session.preview ?? resolveElementDragDrop(session, e.clientX, e.clientY) ?? fallbackDrop;
          const st = useEditorStore.getState();
          const dragEl = st.getAllElements().find(el => el.id === session.elementId);
          if (drop && dragEl) {
            const resolvedDragEl = resolveElement(dragEl, session.bpId);
            const fixedWidth = session.layoutW ?? resolvedDragEl.width ?? 100;
            const fixedHeight = session.layoutH ?? resolvedDragEl.height ?? 40;
            const moveToParent = (nextParentId) => {
              const currentEl = st.getAllElements().find(el => el.id === session.elementId);
              if ((currentEl?.parentId ?? null) !== (nextParentId ?? null)) {
                st.reparentElement(session.elementId, nextParentId ?? null);
              }
            };
            const reorderWithinParent = (parentId, insertBeforeId) => {
              const siblingIds = getSiblingIds(st.getAllElements(), parentId, session.elementId);
              let nextIndex = insertBeforeId ? siblingIds.indexOf(insertBeforeId) : siblingIds.length;
              if (nextIndex < 0) nextIndex = siblingIds.length;
              st.reorderElementInParent(session.elementId, nextIndex);
            };

            if (drop.mode === 'container-flow' || drop.mode === 'root-flow') {
              moveToParent(drop.mode === 'container-flow' ? drop.targetParentId : null);
              if (drop.mode === 'container-flow') st.setDrilledContainerId(drop.targetParentId);
              else st.setDrilledContainerId(null);
              st.updateElementLayout(session.elementId, session.bpId, {
                positionType: 'relative',
                absoluteInLayout: false,
                x: 0,
                y: 0,
                widthMode: 'fixed',
                heightMode: 'fixed',
                width: fixedWidth,
                height: fixedHeight,
              });
              reorderWithinParent(drop.mode === 'container-flow' ? drop.targetParentId : null, drop.insertBeforeId);
            } else if (drop.mode === 'container-free') {
              moveToParent(drop.targetParentId);
              st.setDrilledContainerId(drop.targetParentId);
              const containerNode = drop.dropContainer
                ? document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`)?.querySelector(`[data-id="${drop.targetParentId}"]`)
                : null;
              const containerWorldRect = getNodeWorldRect(containerNode, drop.artboardDom, drop.bp, st.viewport.scale);
              const localX = containerWorldRect ? Math.round(drop.worldX - containerWorldRect.left - ((containerNode?.clientLeft ?? 0) / st.viewport.scale)) : 0;
              const localY = containerWorldRect ? Math.round(drop.worldY - containerWorldRect.top - ((containerNode?.clientTop ?? 0) / st.viewport.scale)) : 0;
              st.updateElementLayout(session.elementId, session.bpId, {
                positionType: 'absolute',
                absoluteInLayout: false,
                widthMode: 'fixed',
                heightMode: 'fixed',
                width: fixedWidth,
                height: fixedHeight,
                x: localX,
                y: localY,
              });
            } else {
              moveToParent(null);
              st.setDrilledContainerId(null);
              const absoluteInLayout = drop.mode !== 'fixed-root' && !!drop.pageLayout;
              const offsetX = absoluteInLayout ? 0 : (drop.pagePadding?.left ?? 0);
              const offsetY = absoluteInLayout ? 0 : (drop.pagePadding?.top ?? 0);
              st.updateElementLayout(session.elementId, session.bpId, {
                positionType: drop.mode === 'fixed-root' ? 'fixed' : 'absolute',
                absoluteInLayout: drop.mode === 'fixed-root' ? false : absoluteInLayout,
                widthMode: 'fixed',
                heightMode: 'fixed',
                width: fixedWidth,
                height: fixedHeight,
                x: Math.round(drop.worldX - drop.bp.x - offsetX),
                y: Math.round(drop.worldY - drop.bp.y - offsetY),
              });
            }
            st.setSelection({ elementId: session.elementId, bpId: session.bpId });
          } else {
            shouldPushHistory = false;
          }
        }
        setReorderTarget(null);
        setDropTargetId(null);
      }
      if (drag.current.type === 'radius') {
        setRadiusDragInfo(null);
      }
      if (drag.current.type === 'element-padding' || drag.current.type === 'artboard-padding') {
        setPaddingDragInfo(null);
      }
      if (drag.current.type === 'artboard-gap') {
        setGapDragInfo(null);
      }
      if (drag.current.type === 'text-font-size') {
        setTextSizeDragInfo(null);
      }
      if (drag.current.type === 'element-drag') {
        setDragHint(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
      }
      if (drag.current.type === 'rotate') {
        setDragHint(null);
      }
      setDraggingElementId(null);
      if (shouldPushHistory) pushHistory();
      drag.current = null;
      setInteracting(false);
    }
  }, [getProjectedWorldPoint, pushHistory, resolveElementDragDrop, setInteracting, setDraggingElementId]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // ── Draw mode: capture-phase mousedown so child stopPropagation can't block it
  // Always registered (empty deps) — reads fresh store state each time to avoid
  // stale-closure bugs where pendingDraw was set to null but the old listener
  // is still active because React hasn't yet re-run the cleanup effect.
  useEffect(() => {
    const handleCaptureDown = (e) => {
      const drawType = useEditorStore.getState().pendingDraw; // always fresh
      if (!drawType) return;
      if (e.button !== 0 || spaceDown.current) return;
      if (!containerRef.current?.contains(e.target)) return;
      if (e.target.closest('.fb-artboard-header, .fb-right, .fb-left, .fb-topbar')) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current.getBoundingClientRect();
      const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
      const worldX = (e.clientX - rect.left - panX) / scale;
      const worldY = (e.clientY - rect.top  - panY) / scale;
      drag.current = {
        type: 'draw', drawType,
        startMX: e.clientX, startMY: e.clientY,
        startWorldX: worldX, startWorldY: worldY,
      };
      setDrawRect({ left: e.clientX - rect.left, top: e.clientY - rect.top, width: 0, height: 0 });
    };
    window.addEventListener('mousedown', handleCaptureDown, true);
    return () => window.removeEventListener('mousedown', handleCaptureDown, true);
  }, []); // empty — handler reads store directly
  // ── Start move from overlay (for elements clipped by artboard overflow) ───
  const startMoveFromOverlay = useCallback((e, bpId, element) => {
    const { getAllElements } = useEditorStore.getState();
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
    const page = useEditorStore.getState().getCurrentPage();
    const domEl = boardDom?.querySelector(`[data-id="${el.id}"]`);
    const rect = domEl?.getBoundingClientRect() ?? e.currentTarget?.getBoundingClientRect?.();
    const scale = useEditorStore.getState().viewport.scale;
    const bpDef = useEditorStore.getState().breakpointDefs[bpId];
    const metrics = getElementWorldMetrics({ el, bpId, bp: bpDef, page, boardDom, scale });
    const ghostW = rect ? (rect.width / scale) : (resolved.width ?? el.base?.width ?? 100);
    const ghostH = rect ? (rect.height / scale) : (resolved.height ?? el.base?.height ?? 40);
    const startWorldX = metrics?.modelWorldX ?? (resolved.x ?? el.base?.x ?? 0);
    const startWorldY = metrics?.modelWorldY ?? (resolved.y ?? el.base?.y ?? 0);
    const pointerWorld = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
    const pointerPoint = { x: pointerWorld.worldX, y: pointerWorld.worldY };
    const rotationValue = Math.abs(parseFloat(resolved.rotation) || 0);
    const rotationDegrees = parseFloat(resolved.rotation) || 0;
    const center = { x: startWorldX + ghostW / 2, y: startWorldY + ghostH / 2 };
    const unrotatedPointer = rotationValue > 0.01
      ? rotatePointAround(pointerPoint, center, -rotationDegrees)
      : pointerPoint;
    const isGeomOffCanvas = !el.parentId && bpDef
      ? ((resolved.x ?? 0) + ghostW <= 0 || (resolved.x ?? 0) >= bpDef.width || (resolved.y ?? 0) + ghostH <= 0 || (resolved.y ?? 0) >= bpDef.height)
      : false;
    const grabOffsetClientX = rect ? (e.clientX - rect.left) : 0;
    const grabOffsetClientY = rect ? (e.clientY - rect.top) : 0;
    drag.current = {
      type: 'element-drag',
      dragMode: 'free',
      bpId,
      elementId: el.id,
      startMX: e.clientX, startMY: e.clientY,
      startWorldX,
      startWorldY,
      previewStartWorldX: metrics?.domWorldX ?? startWorldX,
      previewStartWorldY: metrics?.domWorldY ?? startWorldY,
      pointerOffsetWorldX: pointerWorld.worldX - startWorldX,
      pointerOffsetWorldY: pointerWorld.worldY - startWorldY,
      localAnchorX: unrotatedPointer.x - startWorldX,
      localAnchorY: unrotatedPointer.y - startWorldY,
      rotation: rotationDegrees,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      layoutW: resolved.width ?? el.base?.width ?? 100,
      layoutH: resolved.height ?? el.base?.height ?? 40,
      origParentId: el.parentId ?? null,
      origPositionType: resolved.positionType ?? 'absolute',
      origWasFlow: false,
      origWasOffCanvas: isGeomOffCanvas,
      hasRotation: rotationValue > 0.01,
      ghostBgColor: resolved.styles?.backgroundColor ?? null,
      ghostW,
      ghostH,
      ghostClientW: rect?.width ?? ghostW * scale,
      ghostClientH: rect?.height ?? ghostH * scale,
      grabOffsetClientX,
      grabOffsetClientY,
      grabOffsetWorldX: grabOffsetClientX / scale,
      grabOffsetWorldY: grabOffsetClientY / scale,
    };
    setDraggingElementId(el.id);
    setInteracting(true);
  }, [getProjectedWorldPoint, setInteracting, setDraggingElementId]);
  // ── Start artboard drag (called from Artboard header) ───────
  const startArtboardDrag = useCallback((e, bpId) => {
    const bp = useEditorStore.getState().breakpointDefs[bpId];
    drag.current = {
      type: 'artboard-move', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startBpX: bp.x, startBpY: bp.y,
    };
    setInteracting(true);
  }, [setInteracting]);

  // ── Start artboard resize (drag bottom handle) ────────────
  const startArtboardResize = useCallback((e, bpId) => {
    e.stopPropagation();
    const bp = useEditorStore.getState().breakpointDefs[bpId];
    drag.current = {
      type: 'artboard-resize', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startH: bp.height,
    };
    setInteracting(true);
  }, [setInteracting]);

  // ── Start artboard padding drag ──────────────────────────
  const startArtboardPaddingDrag = useCallback((e, bpId, side) => {
    e.stopPropagation();
    const page = useEditorStore.getState().getCurrentPage();
    const pad  = resolvePagePadding(page?.padding, bpId);
    drag.current = {
      type: 'artboard-padding', bpId, side,
      startMX: e.clientX, startMY: e.clientY,
      startPad: { ...pad },
    };
    setInteracting(true);
  }, [setInteracting]);
  // ── Start artboard gap drag ───────────────────────────
  const startArtboardGapDrag = useCallback((e, bpId) => {
    e.stopPropagation();
    const page   = useEditorStore.getState().getCurrentPage();
    const layout = resolvePageLayout(page?.layout, bpId);
    if (!layout) return;
    drag.current = {
      type: 'artboard-gap', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startGap: layout.gap ?? 0,
      isRow: layout.flexDirection === 'row',
      layout: { ...layout },
    };
    setGapDragInfo({ value: layout.gap ?? 0, clientX: e.clientX, clientY: e.clientY });
    setInteracting(true);
  }, [setInteracting]);
  // ── Start viewport-fold drag ───────────────────────────────
  const startViewportFoldDrag = useCallback((e, bpId, startFoldH) => {
    const allEls0 = useEditorStore.getState().getAllElements();
    // Capture current y of fixed root elements constrained to bottom so they can follow fold
    const initialFixedEls = allEls0
      .filter(el => !el.parentId)
      .flatMap(el => {
        const r = resolveElement(el, bpId);
        if (r.positionType !== 'fixed') return [];
        if (!r.constraints?.bottom) return [];
        return [{ id: el.id, y: r.y ?? 0 }];
      });
    drag.current = {
      type: 'viewport-fold', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startFoldH,
      initialFixedEls,
    };
    setInteracting(true);
  }, [setInteracting]);

  // ── Start element padding drag ─────────────────────────────
  const startElementPaddingDrag = useCallback((e, bpId, elementId, side) => {
    e.stopPropagation();
    e.preventDefault();
    const el = useEditorStore.getState().getAllElements().find(el => el.id === elementId);
    if (!el) return;
    const s = resolveElement(el, bpId).styles ?? {};
    const toNum = v => typeof v === 'number' ? v : parseFloat(v) || 0;
    const startPad = {
      paddingTop:    toNum(s.paddingTop),
      paddingRight:  toNum(s.paddingRight),
      paddingBottom: toNum(s.paddingBottom),
      paddingLeft:   toNum(s.paddingLeft),
    };
    drag.current = {
      type: 'element-padding', bpId, elementId, side,
      startMX: e.clientX, startMY: e.clientY,
      startPad,
    };
    const capKey = side.charAt(0).toUpperCase() + side.slice(1);
    setPaddingDragInfo({ side, value: startPad[`padding${capKey}`], clientX: e.clientX, clientY: e.clientY });
    setInteracting(true);
  }, [setInteracting]);

  // ── Start border-radius drag ──────────────────────────────
  const startRadiusDrag = useCallback((e, bpId, elementId, startRadius, corner = null) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = {
      type: 'radius', bpId, elementId, corner,
      startMX: e.clientX, startMY: e.clientY,
      startRadius: startRadius ?? 0,
    };
    setInteracting(true);
  }, [setInteracting]);


  // ── Select artboard (deselects any element) ───────────────
  const onSelectArtboard = useCallback((bpId) => {
    setArtboardSel(bpId);
    setSelection(null);
    setDrilled(null);
  }, [setArtboardSel, setSelection, setDrilled]);

  // ── Start element drag (called from child) ─────────────────
  // When an element is selected, clear artboard selection
  const startElementDrag = useCallback((e, bpId, element) => {
    e.stopPropagation();
    setArtboardSel(null);
    const { getAllElements } = useEditorStore.getState();
    const clickedEl = getAllElements().find(ee => ee.id === element.id) ?? element;
    const activeSelection = useEditorStore.getState().selection;
    const dragElementId = activeSelection?.elementId === clickedEl.id ? activeSelection.elementId : clickedEl.id;
    const el = getAllElements().find(ee => ee.id === dragElementId) ?? clickedEl;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    const page0 = useEditorStore.getState().getCurrentPage();
    const boardDom0 = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
    const metrics = getElementWorldMetrics({
      el,
      bpId,
      bp: useEditorStore.getState().breakpointDefs[bpId],
      page: page0,
      boardDom: boardDom0,
      scale: useEditorStore.getState().viewport.scale,
    });
    const pointerWorld = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
    if (dragElementId !== activeSelection?.elementId || activeSelection?.bpId !== bpId) {
      setSelection({ elementId: dragElementId, bpId });
    }
    const domEl = document.querySelector(`.fb-artboard[data-bp="${bpId}"] [data-id="${dragElementId}"]`) ?? e.currentTarget;
    const computedPosition = domEl ? window.getComputedStyle(domEl).position : null;
    const bpDef0 = useEditorStore.getState().breakpointDefs[bpId];
    const elX0 = resolved.x ?? el.base?.x ?? 0;
    const elY0 = resolved.y ?? el.base?.y ?? 0;
    const elW0 = resolved.width ?? el.base?.width ?? 100;
    const elH0 = resolved.height ?? el.base?.height ?? 40;
    const isGeomOffCanvas = !el.parentId && bpDef0
      ? (elX0 + elW0 <= 0 || elX0 >= bpDef0.width || elY0 + elH0 <= 0 || elY0 >= bpDef0.height)
      : false;
    // Flow context: explicitly relative, OR root-level element in auto-layout artboard
    // that hasn't been pinned as absoluteInLayout (matches CanvasElement's effectiveRelative logic).
    // Root auto-layout exceptions that are geometrically off-canvas are not flow items.
    const pgLayout = resolvePageLayout(page0?.layout, bpId);
    const heuristicFlowCtx = (resolved.positionType ?? 'absolute') === 'relative'
      || (!el.parentId && pgLayout !== null && !resolved.absoluteInLayout
          && resolved.positionType !== 'fixed' && !isGeomOffCanvas);
    const isFlowCtx = computedPosition != null
      ? computedPosition === 'relative'
      : heuristicFlowCtx;
    const origPositionType = isFlowCtx ? 'relative' : (resolved.positionType ?? 'absolute');
    // For ghost sizing during reorder drag, try to get actual rendered dimensions from DOM
    let ghostW = resolved.width ?? 100;
    let ghostH = resolved.height ?? 40;
    let ghostClientW = ghostW * useEditorStore.getState().viewport.scale;
    let ghostClientH = ghostH * useEditorStore.getState().viewport.scale;
    let grabOffsetClientX = ghostClientW / 2;
    let grabOffsetClientY = ghostClientH / 2;
    const rotationValue = Math.abs(parseFloat(resolved.rotation) || 0);
    if (domEl) {
      const dr = domEl.getBoundingClientRect();
      const sc0 = useEditorStore.getState().viewport.scale;
      ghostClientW = dr.width;
      ghostClientH = dr.height;
      grabOffsetClientX = e.clientX - dr.left;
      grabOffsetClientY = e.clientY - dr.top;
      ghostW = dr.width / sc0;
      ghostH = dr.height / sc0;
    }
    const scale0 = useEditorStore.getState().viewport.scale;
    const startWorldX = (isFlowCtx ? (metrics?.domWorldX ?? metrics?.modelWorldX) : metrics?.modelWorldX) ?? 0;
    const startWorldY = (isFlowCtx ? (metrics?.domWorldY ?? metrics?.modelWorldY) : metrics?.modelWorldY) ?? 0;
    const rotationDegrees = parseFloat(resolved.rotation) || 0;
    const center = { x: startWorldX + ghostW / 2, y: startWorldY + ghostH / 2 };
    const pointerPoint = { x: pointerWorld.worldX, y: pointerWorld.worldY };
    const unrotatedPointer = rotationValue > 0.01
      ? rotatePointAround(pointerPoint, center, -rotationDegrees)
      : pointerPoint;
    // Detect if element currently lives off the artboard (x/y outside bp bounds).
    // IMPORTANT: relative/flow elements are NEVER off-canvas (x/y are meaningless for flow).
    // Used at drop time: off-canvas elements dropped on auto-layout artboard become flow.
    const origWasOffCanvas = isFlowCtx ? false : isGeomOffCanvas;
    drag.current = {
      type: 'element-drag',
      dragMode: isFlowCtx ? 'flow' : 'free',
      bpId,
      elementId: dragElementId,
      startMX: e.clientX, startMY: e.clientY,
      startWorldX,
      startWorldY,
      previewStartWorldX: metrics?.domWorldX ?? startWorldX,
      previewStartWorldY: metrics?.domWorldY ?? startWorldY,
      pointerOffsetWorldX: pointerWorld.worldX - startWorldX,
      pointerOffsetWorldY: pointerWorld.worldY - startWorldY,
      localAnchorX: unrotatedPointer.x - startWorldX,
      localAnchorY: unrotatedPointer.y - startWorldY,
      rotation: rotationDegrees,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      layoutW: resolved.width ?? el.base?.width ?? 100,
      layoutH: resolved.height ?? el.base?.height ?? 40,
      origPositionType,
      origParentId: el.parentId ?? null,
      origWasFlow: isFlowCtx,
      origWasOffCanvas,
      hasRotation: rotationValue > 0.01,
      ghostBgColor: resolved.styles?.backgroundColor ?? null,
      ghostW, ghostH,
      ghostClientW, ghostClientH,
      grabOffsetClientX,
      grabOffsetClientY,
      grabOffsetWorldX: grabOffsetClientX / scale0,
      grabOffsetWorldY: grabOffsetClientY / scale0,
    };
    setDraggingElementId(dragElementId);
    setInteracting(true);
  }, [getProjectedWorldPoint, setSelection, setArtboardSel, setInteracting, setDraggingElementId]);

  // ── Start resize (called from child) ──────────────────────
  const startResize = useCallback((e, bpId, element, handle) => {
    e.stopPropagation();
    e.preventDefault();
    const { getAllElements } = useEditorStore.getState();
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    setSelection({ elementId: el.id, bpId });
    if (String(handle).startsWith('rotate-')) {
      const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
      const domEl = boardDom?.querySelector(`[data-id="${el.id}"]`);
      const rect = domEl?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : e.clientX;
      const centerY = rect ? rect.top + rect.height / 2 : e.clientY;
      const startRotation = typeof resolved.rotation === 'number' ? resolved.rotation : parseFloat(resolved.rotation) || 0;
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      drag.current = {
        type: 'rotate', bpId, elementId: el.id, handle,
        startMX: e.clientX, startMY: e.clientY,
        startRotation,
        startAngle,
        centerX,
        centerY,
      };
      setDragHint({ label: `${Math.round(startRotation)}deg`, clientX: e.clientX, clientY: e.clientY });
      setInteracting(true);
      return;
    }
    if (handle === 'se' && isFontResizeTextElement(el, resolved)) {
      drag.current = {
        type: 'text-font-size', bpId, elementId: el.id, handle,
        startMX: e.clientX, startMY: e.clientY,
        startFontSize: typeof resolved.styles?.fontSize === 'number'
          ? resolved.styles.fontSize
          : parseFloat(resolved.styles?.fontSize) || 42,
      };
      setTextSizeDragInfo({
        value: typeof resolved.styles?.fontSize === 'number'
          ? resolved.styles.fontSize
          : parseFloat(resolved.styles?.fontSize) || 42,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      setInteracting(true);
      return;
    }
    drag.current = {
      type: 'resize', bpId, elementId: el.id, handle,
      startMX: e.clientX, startMY: e.clientY,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      startW: resolved.width ?? el.base?.width ?? 100,
      startH: resolved.height ?? el.base?.height ?? 100,
    };
    setInteracting(true);
  }, [setSelection, setInteracting]);

  // ── Drop from elements panel ───────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('fb-element-type');
    const componentId = e.dataTransfer.getData('fb-component-id');
    const placement = getPlacementFromClient(e.clientX, e.clientY, useEditorStore.getState().selection?.bpId ?? null);
    if (componentId) {
      const rootId = insertComponentInstance(componentId, {
        bpId: placement?.bpId ?? 'desktop',
        x: placement?.x ?? 80,
        y: placement?.y ?? 80,
      });
      if (rootId) pushHistory();
      return;
    }
    if (!type) return;
    const targetBpId = placement?.bpId ?? 'desktop';
    const elX = placement?.x ?? 80;
    const elY = placement?.y ?? 80;

    if (type === 'frame') {
      const el = createFrame(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'image') {
      const el = createImage(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'text') {
      const el = createText(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    }
  }, [addElement, getPlacementFromClient, insertComponentInstance, pushHistory]);

  // ── Drop onto element for nesting ─────────────────────────
  const onDropOntoElement = useCallback((e, targetElementId) => {
    const type = e.dataTransfer.getData('fb-element-type');
    const draggedId = e.dataTransfer.getData('fb-element-id');
    const componentId = e.dataTransfer.getData('fb-component-id');
    const targetBpId = e.target.closest('.fb-artboard[data-bp]')?.dataset.bp ?? useEditorStore.getState().selection?.bpId ?? 'desktop';
    const localPlacement = getParentPlacementFromClient(e.clientX, e.clientY, targetBpId, targetElementId);
    const localX = localPlacement?.x ?? 20;
    const localY = localPlacement?.y ?? 20;
    if (componentId) {
      const rootId = insertComponentInstance(componentId, { parentId: targetElementId, x: localX, y: localY });
      if (rootId) pushHistory();
      return;
    }
    if (type === 'frame') {
      const el = createFrame(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'image') {
      const el = createImage(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'text') {
      const el = createText(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (draggedId && draggedId !== targetElementId) {
      reparentElement(draggedId, targetElementId);
      pushHistory();
    }
  }, [addElement, getParentPlacementFromClient, insertComponentInstance, reparentElement, pushHistory]);

  const onDragOver = (e) => e.preventDefault();

  const cursor = pendingDraw
    ? 'crosshair'
    : spacePanCursor
    ? (isPanning.current ? 'grabbing' : 'grab')
    : isPanning.current
    ? 'grabbing'
    : 'default';

  const { x: panX, y: panY, scale } = viewport;
  const componentVariantRoots = activeSurface === 'component'
    ? (componentEditor.page?.elements ?? [])
        .filter((el) => !el.parentId && el.componentRoot)
        .sort((left, right) => (left.base?.x ?? 0) - (right.base?.x ?? 0))
    : [];
  const lastVariantRoot = componentVariantRoots[componentVariantRoots.length - 1] ?? null;
  const canvasAddVariantPos = activeSurface === 'component' && lastVariantRoot && bpDefs.desktop
    ? {
        left: bpDefs.desktop.x + (lastVariantRoot.base?.x ?? 0) + (lastVariantRoot.base?.width ?? 240) + (44 / Math.max(0.001, scale)),
        top: bpDefs.desktop.y + (lastVariantRoot.base?.y ?? 0) + ((lastVariantRoot.base?.height ?? 160) * 0.5),
      }
    : null;
  const activeDragPreview = dragOverlay && drag.current?.type === 'element-drag'
    ? {
        elementId: dragOverlay.elementId,
        dx: dragOverlay.worldX - (drag.current?.previewStartWorldX ?? drag.current?.startWorldX ?? dragOverlay.worldX),
        dy: dragOverlay.worldY - (drag.current?.previewStartWorldY ?? drag.current?.startWorldY ?? dragOverlay.worldY),
      }
    : null;
  const rotatedCursorGhost = dragOverlay && drag.current?.type === 'element-drag' && drag.current?.hasRotation
    ? {
        left: (drag.current?.lastMX ?? drag.current?.startMX ?? 0) - (drag.current?.grabOffsetClientX ?? 0),
        top: (drag.current?.lastMY ?? drag.current?.startMY ?? 0) - (drag.current?.grabOffsetClientY ?? 0),
        width: drag.current?.ghostClientW ?? 0,
        height: drag.current?.ghostClientH ?? 0,
        bgColor: dragOverlay.bgColor,
        rotation: drag.current?.rotation ?? 0,
      }
    : null;
  const activeVariantConnector = activeSurface === 'component'
    ? (variantRootLayout[componentEditor.activeVariantId] ?? null)
    : null;
  const connectorContainerRect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const connectorWorldBounds = {
    width: Math.max(...Object.values(bpDefs).map((entry) => entry.x + entry.width), ...Object.values(variantRootLayout).map((entry) => (entry.worldRect?.left ?? 0) + (entry.worldRect?.width ?? 0)), 0) + 400,
    height: Math.max(...Object.values(bpDefs).map((entry) => entry.y + entry.height), ...Object.values(variantRootLayout).map((entry) => (entry.worldRect?.top ?? 0) + (entry.worldRect?.height ?? 0)), 0) + 400,
  };
  const variantConnectionLines = activeSurface === 'component'
    ? (componentEditor.variants ?? []).flatMap((variant) => {
        if (variant.id !== componentEditor.activeVariantId) return [];
        const source = variantRootLayout[variant.id];
        const target = variant.interaction?.targetVariantId ? variantRootLayout[variant.interaction.targetVariantId] : null;
        if (!source || !target) return [];
        return [{
          key: `${variant.id}-${variant.interaction.targetVariantId}`,
          sourceVariantId: variant.id,
          targetVariantId: variant.interaction.targetVariantId,
          path: buildConnectorPath(source.from, target.to),
          end: target.to,
          trigger: variant.interaction.trigger,
          delay: variant.interaction.delay ?? 0,
        }];
      })
    : [];
  const draftHoverTarget = variantConnectionDraft
    ? resolveVariantRootAtClientPoint(variantConnectionDraft.clientX, variantConnectionDraft.clientY, { excludeVariantId: variantConnectionDraft.sourceVariantId })
    : null;
  const draftEndpoint = draftHoverTarget?.to ?? (variantConnectionDraft
    ? clientToWorldPoint(connectorContainerRect, viewport, { x: variantConnectionDraft.clientX, y: variantConnectionDraft.clientY })
    : null);
  const variantDraftPath = variantConnectionDraft && variantRootLayout[variantConnectionDraft.sourceVariantId]
    ? buildConnectorPath(variantRootLayout[variantConnectionDraft.sourceVariantId].from, draftEndpoint)
    : null;
  const variantInteractionSource = variantInteractionModal
    ? (componentEditor.variants ?? []).find((variant) => variant.id === variantInteractionModal.sourceVariantId) ?? null
    : null;
  const variantInteractionTarget = variantInteractionModal
    ? (componentEditor.variants ?? []).find((variant) => variant.id === variantInteractionModal.targetVariantId) ?? null
    : null;
  const saveVariantInteraction = useCallback((nextInteraction) => {
    if (!variantInteractionModal?.sourceVariantId || !variantInteractionModal?.targetVariantId) return;
    updateComponentEditorVariantInteraction(variantInteractionModal.sourceVariantId, {
      targetVariantId: variantInteractionModal.targetVariantId,
      trigger: nextInteraction.trigger,
      delay: nextInteraction.delay,
    });
    setVariantInteractionModal(null);
  }, [updateComponentEditorVariantInteraction, variantInteractionModal]);
  const disconnectVariantInteraction = useCallback(() => {
    if (!variantInteractionModal?.sourceVariantId) return;
    updateComponentEditorVariantInteraction(variantInteractionModal.sourceVariantId, null);
    setVariantInteractionModal(null);
  }, [updateComponentEditorVariantInteraction, variantInteractionModal]);

  return (
    <div
      ref={containerRef}
      className="fb-canvas-container"
      style={{ cursor }}
      onMouseDown={onMouseDown}
      onMouseLeave={() => setHoveredId(null)}
      onContextMenu={onContextMenu}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div
        ref={worldRef}
        className="fb-canvas-world"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          '--inv-scale': 1 / scale,
        }}
      >
        {Object.values(bpDefs).map(bp => (
          <Artboard
            key={bp.id}
            bp={bp}
            surfaceMode={activeSurface === 'component' ? 'component' : 'artboard'}
            onStartElementDrag={startElementDrag}
            onStartResize={startResize}
            onStartRotate={startResize}
            onDropOntoElement={onDropOntoElement}
            onStartArtboardDrag={startArtboardDrag}
            onStartArtboardResize={startArtboardResize}
            onStartArtboardPaddingDrag={startArtboardPaddingDrag}
            onStartArtboardGapDrag={startArtboardGapDrag}
            onSelectArtboard={onSelectArtboard}
            isArtboardSelected={artboardSel === bp.id}
            onStartRadiusDrag={startRadiusDrag}
            onStartPaddingDrag={startElementPaddingDrag}
            reorderTarget={reorderTarget}
            dropTargetId={dropTargetId}
            dragPreview={activeDragPreview}
            draggingElementId={draggingElementId}
          />
        ))}
        {activeSurface !== 'component' ? <ViewportFoldOverlay onStartFoldDrag={startViewportFoldDrag} /> : null}
        <SelectionOverlay onStartResize={startResize} onStartMove={startMoveFromOverlay} onStartRadiusDrag={startRadiusDrag} dragOverlay={dragOverlay} />
        {alignmentGuides.map((guide, index) => (
          <div
            key={`${guide.orientation}-${index}`}
            className={`fb-alignment-guide fb-alignment-guide--${guide.orientation}`}
            style={guide.orientation === 'vertical'
              ? { left: guide.x, top: guide.start, height: Math.max(0, guide.end - guide.start) }
              : { left: guide.start, top: guide.y, width: Math.max(0, guide.end - guide.start) }}
          />
        ))}
        {reorderGhost && (
          <div
            className="fb-reorder-ghost"
            style={{
              position: 'absolute',
              left: reorderGhost.worldX,
              top: reorderGhost.worldY,
              width: reorderGhost.width,
              height: reorderGhost.height,
              pointerEvents: 'none',
              opacity: 0.65,
              background: reorderGhost.bgColor || undefined,
              transform: (Math.abs(reorderGhost.rotation ?? 0) > 0.01) ? `rotate(${reorderGhost.rotation}deg)` : undefined,
              transformOrigin: 'center center',
            }}
          />
        )}
        {canvasAddVariantPos ? (
          <button
            type="button"
            className="fb-component-canvas-add-variant"
            style={{
              left: canvasAddVariantPos.left,
              top: canvasAddVariantPos.top,
              transform: `translateY(-50%) scale(${1 / Math.max(0.001, scale)})`,
              transformOrigin: 'left center',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => addComponentVariant()}
          >
            + Variant
          </button>
        ) : null}
        {activeSurface === 'component' && (variantConnectionLines.length || variantDraftPath) ? (
          <svg
            className="fb-variant-connector-layer"
            width={connectorWorldBounds.width}
            height={connectorWorldBounds.height}
          >
            {variantConnectionLines.map((line) => (
              <g key={line.key}>
                <path className="fb-variant-connector-line fb-variant-connector-line--glow" d={line.path} />
                <path
                  className="fb-variant-connector-line fb-variant-connector-line--interactive"
                  d={line.path}
                  style={{ pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openVariantInteractionModal(line.sourceVariantId, line.targetVariantId);
                  }}
                />
                <circle
                  className="fb-variant-connector-end-dot fb-variant-connector-end-dot--interactive"
                  cx={line.end.x}
                  cy={line.end.y}
                  r="4.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openVariantInteractionModal(line.sourceVariantId, line.targetVariantId);
                  }}
                />
              </g>
            ))}
            {variantDraftPath ? (
              <g>
                <path className="fb-variant-connector-line fb-variant-connector-line--draft" d={variantDraftPath} />
                <circle className="fb-variant-connector-end-dot fb-variant-connector-end-dot--draft" cx={draftEndpoint.x} cy={draftEndpoint.y} r="4.5" />
              </g>
            ) : null}
          </svg>
        ) : null}
        {draftHoverTarget ? (
          <div
            className="fb-variant-connector-target"
            style={{
              left: draftHoverTarget.worldRect.left,
              top: draftHoverTarget.worldRect.top,
              width: draftHoverTarget.worldRect.width,
              height: draftHoverTarget.worldRect.height,
            }}
          />
        ) : null}
        {activeVariantConnector ? (
          <button
            type="button"
            className="fb-variant-connector-handle"
            style={{
              left: activeVariantConnector.connector.x,
              top: activeVariantConnector.connector.y,
              transform: `translate(-50%, -50%) scale(${1 / Math.max(0.001, scale)})`,
              transformOrigin: 'center center',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setVariantConnectionDraft({
                sourceVariantId: activeVariantConnector.variantId,
                clientX: e.clientX,
                clientY: e.clientY,
              });
            }}
            title={`Connect ${activeVariantConnector.name}`}
          >
            <span className="fb-variant-connector-handle__dot" />
            <span className="fb-variant-connector-handle__core" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {reorderIndicatorOverlay && (
        <div
          className={`fb-reorder-indicator-overlay fb-reorder-indicator-overlay--${reorderIndicatorOverlay.axis}`}
          style={{
            left: reorderIndicatorOverlay.left,
            top: reorderIndicatorOverlay.top,
            width: reorderIndicatorOverlay.width,
            height: reorderIndicatorOverlay.height,
          }}
        />
      )}
      {rotatedCursorGhost && (
        <div
          className="fb-drag-cursor-ghost"
          style={{
            left: rotatedCursorGhost.left,
            top: rotatedCursorGhost.top,
            width: rotatedCursorGhost.width,
            height: rotatedCursorGhost.height,
            pointerEvents: 'none',
            background: rotatedCursorGhost.bgColor || undefined,
            transform: Math.abs(rotatedCursorGhost.rotation ?? 0) > 0.01 ? `rotate(${rotatedCursorGhost.rotation}deg)` : undefined,
            transformOrigin: 'center center',
          }}
        />
      )}
      {variantInteractionModal && variantInteractionSource && variantInteractionTarget ? (
        <VariantInteractionModal
          sourceName={variantInteractionSource.name}
          targetName={variantInteractionTarget.name}
          initialInteraction={variantInteractionModal.initialInteraction}
          onCancel={() => setVariantInteractionModal(null)}
          onSave={saveVariantInteraction}
          onDisconnect={variantInteractionSource.interaction ? disconnectVariantInteraction : null}
        />
      ) : null}
      {radiusDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: radiusDragInfo.clientX + 14, top: radiusDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          {radiusDragInfo.value}px
        </div>
      )}
      {paddingDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: paddingDragInfo.clientX + 14, top: paddingDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          {paddingDragInfo.side}: {paddingDragInfo.value}px
        </div>
      )}
      {gapDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: gapDragInfo.clientX + 14, top: gapDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          gap: {gapDragInfo.value}px
        </div>
      )}
      {activeSurface !== 'component' && foldDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: foldDragInfo.clientX + 14, top: foldDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          viewport fold: {foldDragInfo.value}px
        </div>
      )}
      {textSizeDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: textSizeDragInfo.clientX + 14, top: textSizeDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          font size: {textSizeDragInfo.value}px
        </div>
      )}
      {dragHint && (
        <div className="fb-drag-hint" style={{ position: 'fixed', left: dragHint.clientX + 16, top: dragHint.clientY - 30, pointerEvents: 'none', zIndex: 99999 }}>
          {dragHint.label}
        </div>
      )}
      {drawRect && (
        <div style={{
          position: 'fixed',
          left: drawRect.left,
          top: drawRect.top,
          width: drawRect.width,
          height: drawRect.height,
          border: '1.5px dashed var(--accent-light)',
          background: 'rgba(99,179,237,0.08)',
          pointerEvents: 'none',
          zIndex: 99999,
        }} />
      )}
      <CanvasContextMenu
        menu={contextMenu}
        hasClipboard={!!clipboard.current}
        onClose={closeContextMenu}
        onCopy={() => contextMenu?.elementId && copyElementToClipboard(contextMenu.elementId, contextMenu.bpId)}
        onCut={() => contextMenu?.elementId && cutElementToClipboard(contextMenu.elementId, contextMenu.bpId)}
        onPaste={() => contextMenu?.canPasteIntoFrame && pasteClipboardAt({ bpId: contextMenu.bpId, parentId: contextMenu.elementId, clientX: contextMenu.clientX, clientY: contextMenu.clientY })}
        onDelete={() => {
          if (!contextMenu?.elementId) return;
          deleteElement(contextMenu.elementId);
          pushHistory();
        }}
      />
      {componentModal && (
        <ComponentCreateModal
          defaultName={componentModal.defaultName}
          onCancel={() => setComponentModal(null)}
          onSubmit={(name) => {
            const result = createComponentFromElement(componentModal.elementId, name);
            setComponentModal(null);
            if (result?.componentId) {
              pushHistory();
              openComponentEditor(result.componentId);
            }
          }}
        />
      )}
    </div>
  );
}
