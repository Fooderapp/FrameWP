import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore, createFrame, createImage, createText, resolveElement, resolvePagePadding, resolvePageLayout } from '../store/editorStore';
import Artboard from './Artboard';

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
  const page                   = useEditorStore(s => s.pages?.find(p => p.id === s.currentPageId));
  const setDrilledContainerId  = useEditorStore(s => s.setDrilledContainerId);
  const setSelection           = useEditorStore(s => s.setSelection);
  const viewport               = useEditorStore(s => s.viewport);

  if (!selection) return null;
  const el = allElements.find(e => e.id === selection.elementId);
  if (!el) return null;

  const resolved = resolveElement(el, selection.bpId);
  if (resolved.hidden) return null;
  if (resolved.positionType === 'relative') return null; // handled by inline handles inside CanvasElement
  const isFixed = resolved.positionType === 'fixed';

  // Elements that flow inside an auto-layout artboard also render inline handles.
  const pageLayout = resolvePageLayout(page?.layout, selection.bpId);
  // Match CanvasElement's effectiveRelative: any root element in an auto-layout artboard
  // without absoluteInLayout is in-flow, regardless of stored positionType (except fixed).
  // NotE: explicitly 'absolute' elements inside auto-layout also render as flow children.
  const isFlowInLayout = pageLayout !== null && !resolved.absoluteInLayout && !el.parentId
    && resolved.positionType !== 'fixed';
  if (isFlowInLayout) return null;

  const bp = bpDefs[selection.bpId];
  if (!bp) return null;

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
  const overlayHandles = isFontResizeTextElement(el, resolved) ? ['se'] : OVERLAY_HANDLES;
  const rotateHandles = ['nw', 'ne', 'se', 'sw'];

  let worldX, worldY;
  let containerWorldLeft = bp.x;
  let containerWorldTop = bp.y;
  let containerWorldWidth = bp.width;
  let containerWorldHeight = isFixed ? viewportFoldH : bp.height;
  if (el.parentId) {
    // Nested element: the parent may be a flex container with no meaningful x/y in the
    // data model. Measure the parent's current screen position and add the element's own
    // x/y from the store. The parent DOM is stable (it's not the one being dragged),
    // and the element x/y in the store is always the latest value — even during drag.
    const sc       = viewport.scale ?? 1;
    const boardDom = document.querySelector(`.fb-artboard[data-bp="${bp.id}"]`);
    // Scope parent lookup to the correct artboard — querySelector without scope
    // would return the Desktop copy when the same element exists in all artboards.
    const parentDom = boardDom?.querySelector(`[data-id="${el.parentId}"]`);
    if (parentDom && boardDom) {
      const parentRect = parentDom.getBoundingClientRect();
      const boardRect  = boardDom.getBoundingClientRect();
      const parentOffX = (parentRect.left - boardRect.left) / sc;
      const parentOffY = (parentRect.top  - boardRect.top)  / sc;
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

  const overlayW = isDragging ? (dragOverlay.width ?? w) : w;
  const overlayH = isDragging ? (dragOverlay.height ?? h) : h;
  const midX = worldX + overlayW / 2;
  const midY = worldY + overlayH / 2;
  const guides = [];
  if (constraints.left) {
    guides.push({ key: 'left', style: { left: containerWorldLeft, top: midY, width: Math.max(0, worldX - containerWorldLeft), height: 0 } });
  }
  if (constraints.right) {
    const rightStart = worldX + overlayW;
    guides.push({ key: 'right', style: { left: rightStart, top: midY, width: Math.max(0, containerWorldLeft + containerWorldWidth - rightStart), height: 0 } });
  }
  if (constraints.top) {
    guides.push({ key: 'top', style: { left: midX, top: containerWorldTop, width: 0, height: Math.max(0, worldY - containerWorldTop) } });
  }
  if (constraints.bottom) {
    const bottomStart = worldY + overlayH;
    guides.push({ key: 'bottom', style: { left: midX, top: bottomStart, width: 0, height: Math.max(0, containerWorldTop + containerWorldHeight - bottomStart) } });
  }

  const elChildren = allElements.filter(e => e.parentId === el.id);
  const canDrill   = elChildren.length > 0;

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
        className="fb-sel-overlay"
        style={{
          left: worldX, top: worldY, width: overlayW, height: overlayH,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: '50% 50%',
        }}
      onMouseDown={(e) => {
        // Only trigger move on the overlay itself, not on its handle children
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        e.preventDefault();
        if (!el.locked) onStartMove(e, selection.bpId, el);
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        // Drill into this element — its children become single-click accessible
        if (canDrill) {
          setDrilledContainerId(el.id);
          setSelection(null);
        }
      }}
    >
      {!el.locked && !isDragging && overlayHandles.map(handle => (
        <div
          key={handle}
          className={`fb-sel-overlay__handle fb-sel-overlay__handle--${handle}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onStartResize(e, selection.bpId, el, handle);
          }}
        />
      ))}
      {!el.locked && !isDragging && rotateHandles.map(handle => (
        <div
          key={`rotate-${handle}`}
          className={`fb-sel-overlay__rotate-handle fb-sel-overlay__rotate-handle--${handle}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onStartResize(e, selection.bpId, el, `rotate-${handle}`);
          }}
        />
      ))}
        {!el.locked && !isDragging && onStartRadiusDrag && (() => {
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
              const sk    = corner ? `borderRadius${corner}` : 'borderRadius';
              const rv    = resolved.styles?.[sk] ?? resolved.styles?.borderRadius;
              const startR = typeof rv === 'number' ? rv : parseFloat(rv) || 0;
              onStartRadiusDrag(e, selection.bpId, el.id, startR, corner);
            }}
          />
        ));
      })()}
      </div>
    </>
  );
}

export default function InfiniteCanvas() {
  const containerRef = useRef(null);
  const worldRef     = useRef(null);

  const viewport      = useEditorStore(s => s.viewport);
  const setViewport   = useEditorStore(s => s.setViewport);
  const bpDefs        = useEditorStore(s => s.breakpointDefs);
  const setSelection  = useEditorStore(s => s.setSelection);
  const setArtboardSel = useEditorStore(s => s.setArtboardSel);
  const artboardSel    = useEditorStore(s => s.artboardSel);
  const setDrilled     = useEditorStore(s => s.setDrilledContainerId);
  const addElement          = useEditorStore(s => s.addElement);
  const reparentElement      = useEditorStore(s => s.reparentElement);
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
  const [dragOverlay,      setDragOverlay]      = useState(null); // { elementId, worldX, worldY, width, height }
  const [alignmentGuides,  setAlignmentGuides]  = useState([]); // [{ orientation, x?, y?, start, end }]
  const [draggingElementId, setDraggingElementId] = useState(null); // element being dragged (for ghost opacity)
  const clipboard = useRef(null);

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

    const projectedClientW = session.ghostClientW ?? ((session.ghostW ?? 100) * scale);
    const projectedClientH = session.ghostClientH ?? ((session.ghostH ?? 40) * scale);
    const clientLeft = clientX - (session.grabOffsetClientX ?? projectedClientW / 2);
    const clientTop = clientY - (session.grabOffsetClientY ?? projectedClientH / 2);
    const clientRight = clientLeft + projectedClientW;
    const clientBottom = clientTop + projectedClientH;
    const { worldX, worldY } = getProjectedWorldPoint(
      clientX,
      clientY,
      session.grabOffsetWorldX ?? (session.ghostW ?? 100) / 2,
      session.grabOffsetWorldY ?? (session.ghostH ?? 40) / 2,
    );

    const overlapRatioWithRect = (rect) => {
      if (!rect) return 0;
      const overlapW = Math.max(0, Math.min(clientRight, rect.right) - Math.max(clientLeft, rect.left));
      const overlapH = Math.max(0, Math.min(clientBottom, rect.bottom) - Math.max(clientTop, rect.top));
      return (overlapW * overlapH) / Math.max(1, projectedClientW * projectedClientH);
    };

    const offCanvas = !artboardRect || overlapRatioWithRect(artboardRect) < 0.35;
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
    } else {
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
      },
    };
  }, [getProjectedWorldPoint]);

  // ── Keyboard ───────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
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
      // Escape: cancel draw mode first, then exit drill level, then deselect
      if (e.key === 'Escape' && !e.target.matches('input,textarea')) {
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
          st.setSelection(null);
        } else if (st.selection) {
          st.setSelection(null);
        }
      }
      // Arrow nudge (1px, or 10px with Shift)
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && !e.target.matches('input,textarea')) {
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !e.target.matches('input,textarea')) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        const allEls = useEditorStore.getState().getAllElements();
        const rootEl = allEls.find(el => el.id === selection.elementId);
        if (!rootEl) return;
        const subtree = [];
        const collectSubtree = (id) => {
          const elem = allEls.find(el => el.id === id);
          if (!elem) return;
          subtree.push(elem);
          (elem.children ?? []).forEach(collectSubtree);
        };
        collectSubtree(rootEl.id);
        clipboard.current = { subtree, rootId: rootEl.id, bpId: selection.bpId };
      }
      // Paste (Cmd/Ctrl+V)
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !e.target.matches('input,textarea')) {
        if (!clipboard.current) return;
        const { subtree, rootId, bpId: copiedBpId } = clipboard.current;
        const currentBpId = useEditorStore.getState().selection?.bpId ?? copiedBpId;
        const cloned = cloneSubtree(subtree, rootId);
        useEditorStore.getState().addElements(cloned);
        useEditorStore.getState().setSelection({ elementId: cloned[0].id, bpId: currentBpId });
        useEditorStore.getState().pushHistory();
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
  }, []);

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

  // ── Mouse down (pan, draw, or canvas deselect) ─────────────
  const onMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      isPanning.current = true;
      panOrigin.current = { x: e.clientX, y: e.clientY };
      panStart.current  = { x: viewport.x, y: viewport.y };
      return;
    }
    // Draw mode: start rubber-band on any left-click on the canvas (not on a UI widget)
    if (e.button === 0 && (e.target === worldRef.current || e.target === containerRef.current)) {
      setSelection(null);
      setArtboardSel(null);
      setDrilled(null);
    }
  };

  // ── Mouse move (pan + element drag/resize) ─────────────────
  const onMouseMove = useCallback((e) => {
    // Pan — read scale from store to avoid stale closure
    if (isPanning.current) {
      const currentScale = useEditorStore.getState().viewport.scale;
      const dx = e.clientX - panOrigin.current.x;
      const dy = e.clientY - panOrigin.current.y;
      setViewport({ x: panStart.current.x + dx, y: panStart.current.y + dy, scale: currentScale });
      return;
    }

    // Element drag / resize
    if (!drag.current) return;

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
      const preview = resolveElementDragDrop(drag.current, e.clientX, e.clientY);
      if (!preview) {
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
  }, [setViewport]);

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
        if (session.hasMoved) {
          const drop = session.preview ?? resolveElementDragDrop(session, e.clientX, e.clientY);
          const st = useEditorStore.getState();
          const dragEl = st.getAllElements().find(el => el.id === session.elementId);
          if (drop && dragEl) {
            const fixedWidth = session.ghostW ?? resolveElement(dragEl, session.bpId).width ?? 100;
            const fixedHeight = session.ghostH ?? resolveElement(dragEl, session.bpId).height ?? 40;
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
              const containerRect = drop.dropContainer
                ? document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`)?.querySelector(`[data-id="${drop.targetParentId}"]`)?.getBoundingClientRect()
                : null;
              const localX = containerRect ? Math.round((drop.clientLeft - containerRect.left) / st.viewport.scale) : 0;
              const localY = containerRect ? Math.round((drop.clientTop - containerRect.top) / st.viewport.scale) : 0;
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
  }, [pushHistory, setInteracting, setDraggingElementId]);

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
    const domEl = boardDom?.querySelector(`[data-id="${el.id}"]`);
    const rect = domEl?.getBoundingClientRect();
    const scale = useEditorStore.getState().viewport.scale;
    const bpDef = useEditorStore.getState().breakpointDefs[bpId];
    const ghostW = resolved.width ?? el.base?.width ?? 100;
    const ghostH = resolved.height ?? el.base?.height ?? 40;
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
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      origParentId: el.parentId ?? null,
      origPositionType: resolved.positionType ?? 'absolute',
      origWasFlow: false,
      origWasOffCanvas: isGeomOffCanvas,
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
  }, [setInteracting, setDraggingElementId]);
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
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    setSelection({ elementId: el.id, bpId });
    const domEl = document.querySelector(`.fb-artboard[data-bp="${bpId}"] [data-id="${el.id}"]`);
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
    const page0 = useEditorStore.getState().getCurrentPage();
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
    if (domEl) {
      const dr = domEl.getBoundingClientRect();
      const sc0 = useEditorStore.getState().viewport.scale;
      ghostClientW = dr.width;
      ghostClientH = dr.height;
      grabOffsetClientX = e.clientX - dr.left;
      grabOffsetClientY = e.clientY - dr.top;
      ghostW = Math.round(dr.width  / sc0);
      ghostH = Math.round(dr.height / sc0);
    }
    const scale0 = useEditorStore.getState().viewport.scale;
    // Detect if element currently lives off the artboard (x/y outside bp bounds).
    // IMPORTANT: relative/flow elements are NEVER off-canvas (x/y are meaningless for flow).
    // Used at drop time: off-canvas elements dropped on auto-layout artboard become flow.
    const origWasOffCanvas = isFlowCtx ? false : isGeomOffCanvas;
    drag.current = {
      type: 'element-drag',
      dragMode: isFlowCtx ? 'flow' : 'free',
      bpId,
      elementId: el.id,
      startMX: e.clientX, startMY: e.clientY,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      origPositionType,
      origParentId: el.parentId ?? null,
      origWasFlow: isFlowCtx,
      origWasOffCanvas,
      ghostBgColor: resolved.styles?.backgroundColor ?? null,
      ghostW, ghostH,
      ghostClientW, ghostClientH,
      grabOffsetClientX,
      grabOffsetClientY,
      grabOffsetWorldX: grabOffsetClientX / scale0,
      grabOffsetWorldY: grabOffsetClientY / scale0,
    };
    setDraggingElementId(el.id);
    setInteracting(true);
  }, [setSelection, setArtboardSel, setInteracting, setDraggingElementId]);

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
    if (!type) return;

    const rect  = containerRef.current.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
    const worldX = (mx - panX) / scale;
    const worldY = (my - panY) / scale;

    // Detect which artboard the drop landed in
    let targetBpId = null;
    let elX = 80, elY = 80;
    for (const bp of Object.values(bpDefs)) {
      if (
        worldX >= bp.x && worldX <= bp.x + bp.width &&
        worldY >= bp.y && worldY <= bp.y + bp.height
      ) {
        targetBpId = bp.id;
        elX = Math.max(0, worldX - bp.x - 120);
        elY = Math.max(0, worldY - bp.y - 80);
        const dropPage = useEditorStore.getState().getCurrentPage();
        const dropPad  = resolvePagePadding(dropPage?.padding, targetBpId);
        elX = Math.max(0, elX - (dropPad?.left ?? 0));
        elY = Math.max(0, elY - (dropPad?.top  ?? 0));
        break;
      }
    }
    if (!targetBpId) targetBpId = 'desktop'; // fallback

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
  }, [bpDefs, addElement, pushHistory]);

  // ── Drop onto element for nesting ─────────────────────────
  const onDropOntoElement = useCallback((e, targetElementId) => {
    const type = e.dataTransfer.getData('fb-element-type');
    const draggedId = e.dataTransfer.getData('fb-element-id');
    if (type === 'frame') {
      const el = createFrame(20, 20);
      addElement(el, targetElementId);
      pushHistory();
    } else if (type === 'image') {
      const el = createImage(20, 20);
      addElement(el, targetElementId);
      pushHistory();
    } else if (type === 'text') {
      const el = createText(20, 20);
      addElement(el, targetElementId);
      pushHistory();
    } else if (draggedId && draggedId !== targetElementId) {
      reparentElement(draggedId, targetElementId);
      pushHistory();
    }
  }, [addElement, reparentElement, pushHistory]);

  const onDragOver = (e) => e.preventDefault();

  const cursor = pendingDraw
    ? 'crosshair'
    : spacePanCursor
    ? (isPanning.current ? 'grabbing' : 'grab')
    : isPanning.current
    ? 'grabbing'
    : 'default';

  const { x: panX, y: panY, scale } = viewport;

  return (
    <div
      ref={containerRef}
      className="fb-canvas-container"
      style={{ cursor }}
      onMouseDown={onMouseDown}
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
          />
        ))}
        <ViewportFoldOverlay onStartFoldDrag={startViewportFoldDrag} />
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
            }}
          />
        )}
        {draggingElementId && (
          <style>{`.fb-canvas-world [data-id="${draggingElementId.replace(/[^a-zA-Z0-9_-]/g, '')}"] { opacity: 0.4 !important; }`}</style>
        )}
      </div>
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
      {foldDragInfo && (
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
    </div>
  );
}
