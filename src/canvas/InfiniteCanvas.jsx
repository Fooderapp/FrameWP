import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore, createFrame, createImage, resolveElement, resolvePagePadding, resolvePageLayout } from '../store/editorStore';
import Artboard from './Artboard';

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;

const OVERLAY_HANDLES = ['nw','n','ne','e','se','s','sw','w'];

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

/** Renders a bounding-box overlay in world-space, as a sibling of artboards.
 *  Not clipped by artboard's overflow:hidden, so it shows even for overflowing elements. */
function SelectionOverlay({ onStartResize, onStartMove, onStartRadiusDrag }) {
  const selection              = useEditorStore(s => s.selection);
  const bpDefs                 = useEditorStore(s => s.breakpointDefs);
  const allElements            = useEditorStore(s => s.getAllElements());
  const page                   = useEditorStore(s => s.pages?.find(p => p.id === s.currentPageId));
  const setDrilledContainerId  = useEditorStore(s => s.setDrilledContainerId);
  const setSelection           = useEditorStore(s => s.setSelection);

  if (!selection) return null;
  const el = allElements.find(e => e.id === selection.elementId);
  if (!el) return null;

  const resolved = resolveElement(el, selection.bpId);
  if (resolved.hidden) return null;
  if (resolved.positionType === 'relative') return null; // handled by inline handles inside CanvasElement

  // Elements that flow inside an auto-layout artboard also render inline handles.
  const pageLayout = resolvePageLayout(page?.layout, selection.bpId);
  const isFlowInLayout = pageLayout !== null && !resolved.absoluteInLayout && !el.parentId;
  if (isFlowInLayout) return null;

  const bp = bpDefs[selection.bpId];
  if (!bp) return null;

  // Walk parent chain to compute absolute position within artboard content area
  let absX = resolved.x ?? 0;
  let absY = resolved.y ?? 0;
  let cur = el;
  while (cur.parentId) {
    const parent = allElements.find(e => e.id === cur.parentId);
    if (!parent) break;
    const pr = resolveElement(parent, selection.bpId);
    absX += pr.x ?? 0;
    absY += pr.y ?? 0;
    cur = parent;
  }
  const pad    = resolvePagePadding(page?.padding, selection.bpId);
  const w        = resolved.width  ?? 100;
  const h        = resolved.height ?? 100;
  const rotation = resolved.rotation;
  // Off-canvas root elements live outside fb-bp-inner (no padding offset applied)
  const isElOffCanvas = !el.parentId && (
    absX + w <= 0 || absX >= bp.width ||
    absY + h <= 0 || absY >= bp.height
  );
  // Auto-layout exception elements (absoluteInLayout) are positioned absolute within
  // the artboard-content div which is not offset — so do NOT add page padding here.
  const isAutoLayoutException = !el.parentId && pageLayout !== null && !!resolved.absoluteInLayout;
  const worldX = bp.x + (isElOffCanvas || isAutoLayoutException ? 0 : (pad?.left ?? 0)) + absX;
  const worldY = bp.y + (isElOffCanvas || isAutoLayoutException ? 0 : (pad?.top  ?? 0)) + absY;

  const elChildren = allElements.filter(e => e.parentId === el.id);
  const canDrill   = elChildren.length > 0;

  return (
    <div
      className="fb-sel-overlay"
      style={{
        left: worldX, top: worldY, width: w, height: h,
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
      {!el.locked && OVERLAY_HANDLES.map(handle => (
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
      {!el.locked && onStartRadiusDrag && (() => {
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
  const updateElementLayout  = useEditorStore(s => s.updateElementLayout);
  const reparentElement      = useEditorStore(s => s.reparentElement);
  const pushHistory          = useEditorStore(s => s.pushHistory);
  const setInteracting       = useEditorStore(s => s.setInteracting);

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
  const clipboard = useRef(null);

  // ── Drag state ─────────────────────────────────────────────
  const drag = useRef(null);
  // drag.current shape:
  // { type:'move'|'resize'|'artboard-move', bpId, elementId?, handle?,
  //   startMX, startMY, startX?, startY?, startW?, startH?, startBpX?, startBpY? }

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
      // Escape: exit one drill level, or deselect
      if (e.key === 'Escape' && !e.target.matches('input,textarea')) {
        const st = useEditorStore.getState();
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

  // ── Mouse down (pan or canvas deselect) ────────────────────
  const onMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      isPanning.current = true;
      panOrigin.current = { x: e.clientX, y: e.clientY };
      panStart.current  = { x: viewport.x, y: viewport.y };
    } else if (e.button === 0 && (e.target === worldRef.current || e.target === containerRef.current)) {
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

    if (type === 'move') {
      // If nested, check whether cursor has left the parent container → eject to root
      (() => {
        const st = useEditorStore.getState();
        const els = st.getAllElements();
        const mvEl = els.find(ee => ee.id === elementId);
        if (!mvEl?.parentId || drag.current.wasEjected) return;
        // Only eject from parent container on desktop; on tablet/mobile keep inside parent
        if (bpId !== 'desktop') return;
        const artboardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
        const parentDom   = artboardDom?.querySelector(`[data-id="${mvEl.parentId}"]`);
        const parentRect  = parentDom?.getBoundingClientRect();
        if (!parentRect) return;
        const outside = e.clientX < parentRect.left || e.clientX > parentRect.right ||
                        e.clientY < parentRect.top  || e.clientY > parentRect.bottom;
        if (!outside) return;
        drag.current.wasEjected = true;
        const { x: pX, y: pY, scale: sc } = st.viewport;
        const bp2  = st.breakpointDefs[bpId];
        const pad2 = resolvePagePadding(st.getCurrentPage?.()?.padding, bpId);
        const cRect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
        const nx = Math.round((e.clientX - cRect.left - pX) / sc - bp2.x - (pad2?.left ?? 0) - (startW ?? 100) / 2);
        const ny = Math.round((e.clientY - cRect.top  - pY) / sc - bp2.y - (pad2?.top  ?? 0) - (startH ?? 40)  / 2);
        st.reparentElement(elementId, null);
        st.updateElementLayout(elementId, bpId, { positionType: drag.current.origPositionType ?? 'absolute', x: nx, y: ny });
        drag.current = { type: 'move', bpId, elementId, startMX: e.clientX, startMY: e.clientY, startX: nx, startY: ny, wasEjected: true, origPositionType: drag.current.origPositionType ?? 'absolute' };
        setDropTargetId(null);
      })();
      const hasMoved = Math.abs(e.clientX - drag.current.startMX) > 4 ||
                        Math.abs(e.clientY - drag.current.startMY) > 4;
      if (hasMoved) drag.current.hasMoved = true;
      if (drag.current.wasEjected && drag.current.startMX !== undefined) {
        // recalc after possible mutation above
        const { startMX: sMX2, startMY: sMY2, startX: sX2, startY: sY2 } = drag.current;
        const { scale: sc2 } = useEditorStore.getState().viewport;
        useEditorStore.getState().updateElementLayout(elementId, bpId, {
          x: sX2 + (e.clientX - sMX2) / sc2,
          y: sY2 + (e.clientY - sMY2) / sc2,
        });
      } else {
        const { scale: sc2 } = useEditorStore.getState().viewport;
        let nx = startX + dxWorld;
        let ny = startY + dyWorld;
        // On tablet/mobile clamp root elements to artboard bounds so they can't go off-canvas
        if (bpId !== 'desktop') {
          const st2   = useEditorStore.getState();
          const mvEl2 = st2.getAllElements().find(ee => ee.id === elementId);
          if (mvEl2 && !mvEl2.parentId) {
            const bp2 = st2.breakpointDefs[bpId];
            const res2 = resolveElement(mvEl2, bpId);
            const elW2 = res2.width  ?? 100;
            const elH2 = res2.height ?? 40;
            if (bp2) {
              nx = Math.max(0, Math.min(bp2.width  - elW2, nx));
              ny = Math.max(0, Math.min(bp2.height - elH2, ny));
            }
          }
        }
        useEditorStore.getState().updateElementLayout(elementId, bpId, { x: nx, y: ny });
      }
      // Live hit-test: find deepest .fb-el container under cursor that isn't the dragged element or its descendants
      (() => {
        const mvSt = useEditorStore.getState();
        const mvEls = mvSt.getAllElements();
        const mvEl = mvEls.find(e => e.id === elementId);
        if (!mvEl) { setDropTargetId(null); return; }
        const desc = new Set([elementId]);
        const collectD = (id) => { const e = mvEls.find(x => x.id === id); (e?.children ?? []).forEach(cid => { desc.add(cid); collectD(cid); }); };
        collectD(elementId);
        const hits = document.elementsFromPoint(e.clientX, e.clientY);
        let best = null;
        for (const node of hits) {
          const did = node.dataset?.id;
          if (!did || desc.has(did)) continue;
          const candidate = mvEls.find(x => x.id === did);
          if (candidate) { best = candidate; break; }
        }
        setDropTargetId(best?.id ?? null);
      })();
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
    } else if (type === 'reorder') {
      drag.current.hasMoved = true;
      const allEls = useEditorStore.getState().getAllElements();
      const rEl    = allEls.find(el => el.id === elementId);
      if (!rEl) return;
      const parentId = rEl.parentId;
      const artboardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
      const artboardRect = artboardDom?.getBoundingClientRect();

      // Check if cursor left the parent container (drag out from container)
      if (parentId && !drag.current.wasEjected) {
        const parentDom  = artboardDom?.querySelector(`[data-id="${parentId}"]`);
        const parentRect = parentDom?.getBoundingClientRect();
        if (parentRect && (
          e.clientX < parentRect.left || e.clientX > parentRect.right ||
          e.clientY < parentRect.top  || e.clientY > parentRect.bottom
        )) {
          drag.current.wasEjected = true;
          const state2 = useEditorStore.getState();
          const rect2  = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
          const { x: pX2, y: pY2, scale: sc2 } = state2.viewport;
          const bp2  = state2.breakpointDefs[bpId];
          const pad2 = resolvePagePadding(state2.getCurrentPage?.()?.padding, bpId);
          const wx2  = (e.clientX - rect2.left - pX2) / sc2 - bp2.x - (pad2?.left ?? 0);
          const wy2  = (e.clientY - rect2.top  - pY2) / sc2 - bp2.y - (pad2?.top  ?? 0);
          const rEl2 = state2.getAllElements().find(el => el.id === elementId);
          const res2 = resolveElement(rEl2, bpId);
          const nx2  = Math.round(wx2 - (res2.width  ?? 100) / 2);
          const ny2  = Math.round(wy2 - (res2.height ?? 40)  / 2);
          state2.reparentElement(elementId, null);
          state2.updateElementLayout(elementId, bpId, { positionType: drag.current.origPositionType ?? 'absolute', x: nx2, y: ny2 });
          drag.current = { type: 'move', bpId, elementId, startMX: e.clientX, startMY: e.clientY, startX: nx2, startY: ny2, wasEjected: true, origPositionType: drag.current.origPositionType ?? 'absolute' };
          setReorderTarget(null);
          setDropTargetId(null);
          return;
        }
      }

      // Check if cursor is outside artboard bounds → off-canvas eject mode (desktop only)
      const bp = useEditorStore.getState().breakpointDefs[bpId];
      const isOutside = bpId === 'desktop' && artboardRect
        ? (e.clientX < artboardRect.left || e.clientX > artboardRect.right ||
           e.clientY < artboardRect.top  || e.clientY > artboardRect.bottom)
        : false;
      drag.current.reorderOffCanvas = isOutside;
      if (isOutside) {
        setReorderTarget(null);
        // Immediately eject to absolute so element tracks cursor visually
        if (!drag.current.wasEjected) {
          drag.current.wasEjected = true;
          const state2 = useEditorStore.getState();
          const rect2  = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
          const { x: pX2, y: pY2, scale: sc2 } = state2.viewport;
          const bp2  = state2.breakpointDefs[bpId];
          const wx2  = (e.clientX - rect2.left - pX2) / sc2 - bp2.x;
          const wy2  = (e.clientY - rect2.top  - pY2) / sc2 - bp2.y;
          const rEl2 = state2.getAllElements().find(el => el.id === elementId);
          const res2 = resolveElement(rEl2, bpId);
          const nx2  = Math.round(wx2 - (res2.width  ?? 100) / 2);
          const ny2  = Math.round(wy2 - (res2.height ?? 40)  / 2);
          state2.reparentElement(elementId, null);
          state2.updateElementLayout(elementId, bpId, { positionType: drag.current.origPositionType ?? 'absolute', x: nx2, y: ny2 });
          drag.current = {
            type: 'move', bpId, elementId,
            startMX: e.clientX, startMY: e.clientY,
            startX: nx2, startY: ny2,
            wasEjected: true,
            origPositionType: drag.current.origPositionType ?? 'absolute',
          };
        }
        return;
      }
      // Determine axis from parent flex direction
      let axis = 'y';
      if (parentId) {
        const parent = allEls.find(p => p.id === parentId);
        if (parent && resolveElement(parent, bpId)?.styles?.flexDirection === 'row') axis = 'x';
      }
      const siblingIds = parentId
        ? (allEls.find(p => p.id === parentId)?.children ?? []).filter(id => id !== elementId)
        : allEls.filter(el => !el.parentId && el.id !== elementId).map(el => el.id);
      let insertBeforeId = null;
      // Search siblings within the parent DOM element if possible (avoids wrong-level matches)
      const parentDomEl = parentId
        ? artboardDom?.querySelector(`[data-id="${parentId}"]`)
        : artboardDom;
      for (const sibId of siblingIds) {
        const domEl = parentDomEl?.querySelector(`[data-id="${sibId}"]`);
        if (!domEl) continue;
        const rect = domEl.getBoundingClientRect();
        const mid    = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        const cursor = axis === 'x' ? e.clientX : e.clientY;
        if (cursor < mid) { insertBeforeId = sibId; break; }
      }
      drag.current.insertBeforeId = insertBeforeId;
      setReorderTarget({ insertBeforeId, bpId, parentId, dragId: elementId });
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
    }
  }, [setViewport]);

  const onMouseUp = useCallback(() => {
    if (isPanning.current) {
      isPanning.current = false;
    }
    if (drag.current) {
      if (drag.current.type === 'reorder') {
        const { elementId, insertBeforeId, reorderOffCanvas, hasMoved, bpId: rBpId } = drag.current;
        if (hasMoved) {
          const state  = useEditorStore.getState();
          const allEls = state.getAllElements();
          const rEl    = allEls.find(e => e.id === elementId);
          if (rEl) {
            if (reorderOffCanvas) {
              // Eject: convert to absolute positioned off-canvas element
              const bp        = state.breakpointDefs[rBpId];
              const { x: panX, y: panY, scale } = state.viewport;
              const lastMX    = drag.current.lastMX ?? drag.current.startMX;
              const lastMY    = drag.current.lastMY ?? drag.current.startMY;
              const rect      = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
              const worldX    = (lastMX - rect.left - panX) / scale - bp.x;
              const worldY    = (lastMY - rect.top  - panY) / scale - bp.y;
              const resolved  = resolveElement(rEl, rBpId);
              state.updateElementLayout(elementId, rBpId, {
                positionType: 'absolute',
                x: Math.round(worldX - (resolved.width ?? 100) / 2),
                y: Math.round(worldY - (resolved.height ?? 40) / 2),
              });
            } else {
              // Cross-container hit-test: check if cursor is over a different container
              const lastMXr  = drag.current.lastMX ?? drag.current.startMX;
              const lastMYr  = drag.current.lastMY ?? drag.current.startMY;
              const descR    = new Set([elementId]);
              const collectR = (id) => { const e = allEls.find(x => x.id === id); (e?.children ?? []).forEach(cid => { descR.add(cid); collectR(cid); }); };
              collectR(elementId);
              const hitsR = document.elementsFromPoint(lastMXr, lastMYr);
              let crossTarget = null;
              for (const node of hitsR) {
                const did = node.dataset?.id;
                if (!did || descR.has(did)) continue;
                const candidate = allEls.find(x => x.id === did);
                if (candidate && candidate.id !== rEl.parentId) { crossTarget = candidate; break; }
              }
              if (crossTarget) {
                // Drop into a different container
                const tRes = resolveElement(crossTarget, rBpId);
                const isAutoLayout = tRes.styles?.display === 'flex';
                if (isAutoLayout) {
                  state.updateElementLayout(elementId, rBpId, { positionType: 'relative' });
                  state.reparentElement(elementId, crossTarget.id);
                } else {
                  const artboardDomR = document.querySelector(`.fb-artboard[data-bp="${rBpId}"]`);
                  const parentDomR   = artboardDomR?.querySelector(`[data-id="${crossTarget.id}"]`);
                  const elDomR       = artboardDomR?.querySelector(`[data-id="${elementId}"]`);
                  const parentRectR  = parentDomR?.getBoundingClientRect();
                  const elRectR      = elDomR?.getBoundingClientRect();
                  const { scale: scR } = state.viewport;
                  const relXr = parentRectR && elRectR ? Math.round((elRectR.left - parentRectR.left) / scR) : 0;
                  const relYr = parentRectR && elRectR ? Math.round((elRectR.top  - parentRectR.top)  / scR) : 0;
                  const resR = resolveElement(rEl, rBpId);
                  state.updateElementLayout(elementId, rBpId, {
                    positionType: 'absolute',
                    widthMode: 'fixed', heightMode: 'fixed',
                    width: resR.width ?? 100, height: resR.height ?? 40,
                    x: relXr, y: relYr,
                  });
                  state.reparentElement(elementId, crossTarget.id);
                }
              } else {
                // Same parent reorder
                const parentId = rEl.parentId;
                const siblings = parentId
                  ? (allEls.find(p => p.id === parentId)?.children ?? []).filter(id => id !== elementId)
                  : allEls.filter(e => !e.parentId && e.id !== elementId).map(e => e.id);
                let newIndex = insertBeforeId != null ? siblings.indexOf(insertBeforeId) : siblings.length;
                if (newIndex < 0) newIndex = siblings.length;
                state.reorderElementInParent(elementId, newIndex);
              }
            }
          }
        }
        setReorderTarget(null);
      }
      setDropTargetId(null);
      if (drag.current.type === 'move') {
        const { elementId: mvId, bpId: mvBpId } = drag.current;
        const mvState = useEditorStore.getState();
        const mvAllEls = mvState.getAllElements();
        const mvEl = mvAllEls.find(e => e.id === mvId);
        // DOM-based hit-test: find deepest .fb-el under last cursor position that isn't the dragged element
        // Only run nesting/positioning logic if the element was actually dragged, not just clicked
        // Fixed elements never reparent into containers — they always stay root-level
        if (mvEl && drag.current.hasMoved && drag.current.origPositionType !== 'fixed') {
          const resolved = resolveElement(mvEl, mvBpId);
          const bp = mvState.breakpointDefs[mvBpId];
          if (bp) {
            const elW = typeof resolved.width  === 'number' ? resolved.width  : 100;
            const elH = typeof resolved.height === 'number' ? resolved.height :  40;
            const lastMX2 = drag.current.lastMX ?? drag.current.startMX;
            const lastMY2 = drag.current.lastMY ?? drag.current.startMY;
            const desc2 = new Set([mvId]);
            const collectD2 = (id) => { const e = mvAllEls.find(x => x.id === id); (e?.children ?? []).forEach(cid => { desc2.add(cid); collectD2(cid); }); };
            collectD2(mvId);
            const hits2 = document.elementsFromPoint(lastMX2, lastMY2);
            let targetContainer = null;
            for (const node of hits2) {
              const did = node.dataset?.id;
              if (!did || desc2.has(did)) continue;
              const candidate = mvAllEls.find(x => x.id === did);
              if (candidate) { targetContainer = candidate; break; }
            }
            if (targetContainer) {
              const tRes = resolveElement(targetContainer, mvBpId);
              const isAutoLayout = tRes.styles?.display === 'flex';
              if (isAutoLayout) {
                mvState.updateElementLayout(mvId, mvBpId, { positionType: 'relative' });
                mvState.reparentElement(mvId, targetContainer.id);
              } else {
                // Compute position relative to the target container via DOM
                const artboardDom2 = document.querySelector(`.fb-artboard[data-bp="${mvBpId}"]`);
                const parentDom2   = artboardDom2?.querySelector(`[data-id="${targetContainer.id}"]`);
                const elDom2       = artboardDom2?.querySelector(`[data-id="${mvId}"]`);
                const parentRect2  = parentDom2?.getBoundingClientRect();
                const elRect2      = elDom2?.getBoundingClientRect();
                const { scale: sc3 } = mvState.viewport;
                const relX = parentRect2 && elRect2 ? Math.round((elRect2.left - parentRect2.left) / sc3) : 0;
                const relY = parentRect2 && elRect2 ? Math.round((elRect2.top  - parentRect2.top)  / sc3) : 0;
                mvState.updateElementLayout(mvId, mvBpId, {
                  positionType: 'absolute',
                  widthMode: 'fixed', heightMode: 'fixed',
                  width: elW, height: elH,
                  x: relX, y: relY,
                });
                mvState.reparentElement(mvId, targetContainer.id);
              }
            } else {
              // Dropped on artboard / empty canvas → preserve position type (fixed stays fixed)
              if (mvEl.parentId) {
                mvState.reparentElement(mvId, null);
              }
              mvState.updateElementLayout(mvId, mvBpId, {
                positionType: drag.current.origPositionType ?? 'absolute',
                widthMode: 'fixed', heightMode: 'fixed',
                width: elW, height: elH,
              });
            }
          }
        }
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
      pushHistory();
      drag.current = null;
      setInteracting(false);
    }
  }, [pushHistory, setInteracting]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);
  // ── Start move from overlay (for elements clipped by artboard overflow) ───
  const startMoveFromOverlay = useCallback((e, bpId, element) => {
    const { getAllElements } = useEditorStore.getState();
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    drag.current = {
      type: 'move', bpId, elementId: el.id,
      startMX: e.clientX, startMY: e.clientY,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      origPositionType: resolved.positionType ?? 'absolute',
    };
    setInteracting(true);
  }, [setInteracting]);
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
    const isRelative = (resolved.positionType ?? 'absolute') === 'relative';
    drag.current = {
      type: isRelative ? 'reorder' : 'move',
      bpId, elementId: el.id,
      startMX: e.clientX, startMY: e.clientY,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      origPositionType: resolved.positionType ?? 'absolute',
    };
    setInteracting(true);
  }, [setSelection, setArtboardSel, setInteracting]);

  // ── Start resize (called from child) ──────────────────────
  const startResize = useCallback((e, bpId, element, handle) => {
    e.stopPropagation();
    e.preventDefault();
    const { getAllElements } = useEditorStore.getState();
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    setSelection({ elementId: el.id, bpId });
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
    } else if (draggedId && draggedId !== targetElementId) {
      reparentElement(draggedId, targetElementId);
      pushHistory();
    }
  }, [addElement, reparentElement, pushHistory]);

  const onDragOver = (e) => e.preventDefault();

  const cursor = spacePanCursor
    ? (isPanning.current ? 'grabbing' : 'grab')
    : isPanning.current
    ? 'grabbing'
    : drag.current
    ? 'default'
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
        <SelectionOverlay onStartResize={startResize} onStartMove={startMoveFromOverlay} onStartRadiusDrag={startRadiusDrag} />
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
    </div>
  );
}
