import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useEditorStore, resolveElement, resolveElementAnimations } from '../store/editorStore';

const MARKER_COLORS = ['#ff8a3d', '#41d1ff', '#b5ff4d', '#ff5db1', '#ffd84d'];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getMarkerAnchorTop(elementRect) {
  if (!elementRect) return 0;
  return typeof elementRect.anchorTop === 'number' ? elementRect.anchorTop : elementRect.top;
}

function getAnchorRatio(elementRect, boardHeight) {
  if (!elementRect || !boardHeight) return 0;
  return clamp(getMarkerAnchorTop(elementRect) / boardHeight, 0, 1);
}

function getResolvedMarkerRatio(value, anchorRatio, fallback = 0.5, offsetPx = null, boardHeight = 0) {
  const numericOffsetPx = typeof offsetPx === 'number' ? offsetPx : parseFloat(offsetPx);
  if (Number.isFinite(numericOffsetPx) && Number.isFinite(boardHeight) && boardHeight > 0) {
    return clamp(anchorRatio + (numericOffsetPx / boardHeight), 0, 1);
  }
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  return clamp(Number.isFinite(numericValue) ? numericValue : fallback, 0, 1);
}

function getResolvedMarkerLocalY(value, elementRect, boardHeight, fallback = 0.5, offsetPx = null) {
  const anchorRatio = getAnchorRatio(elementRect, boardHeight);
  return getResolvedMarkerRatio(value, anchorRatio, fallback, offsetPx, boardHeight) * boardHeight;
}

function getCanonicalMarkerOffsetPx(value, elementRect, boardHeight, fallback = 0.5, offsetPx = null) {
  const numericOffsetPx = typeof offsetPx === 'number' ? offsetPx : parseFloat(offsetPx);
  if (Number.isFinite(numericOffsetPx)) return numericOffsetPx;
  if (!elementRect || !boardHeight) return null;
  return getResolvedMarkerLocalY(value, elementRect, boardHeight, fallback, offsetPx) - getMarkerAnchorTop(elementRect);
}

function isStickyElement(target) {
  if (!target) return false;
  if (target.classList?.contains('fb-el--sticky')) return true;
  const position = window.getComputedStyle(target).position;
  return position === 'sticky' || position === '-webkit-sticky';
}

function getCumulativeOffsetTop(target) {
  if (!target) return 0;
  let offset = 0;
  let current = target;
  while (current) {
    offset += current.offsetTop || 0;
    current = current.offsetParent;
  }
  return offset;
}

function getLocalOffsetWithinAncestor(target, ancestor) {
  if (!target || !ancestor) return 0;
  return getCumulativeOffsetTop(target) - getCumulativeOffsetTop(ancestor);
}

function useElementRect(boardRef, elementId, deps) {
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    const update = () => {
      const board = boardRef.current;
      const target = board?.querySelector(`[data-id="${elementId}"]`);
      if (!board || !target) {
        setRect(null);
        return;
      }
      const boardRect = board.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scaleX = board.clientWidth > 0 ? (boardRect.width / board.clientWidth) : 1;
      const scaleY = board.clientHeight > 0 ? (boardRect.height / board.clientHeight) : 1;
      setRect({
        left: (targetRect.left - boardRect.left) / Math.max(scaleX, 0.0001),
        top: (targetRect.top - boardRect.top) / Math.max(scaleY, 0.0001),
        anchorTop: isStickyElement(target)
          ? (getLocalOffsetWithinAncestor(target, board) / Math.max(scaleY, 0.0001))
          : ((targetRect.top - boardRect.top) / Math.max(scaleY, 0.0001)),
        width: targetRect.width / Math.max(scaleX, 0.0001),
        height: targetRect.height / Math.max(scaleY, 0.0001),
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, deps);

  return rect;
}

export default function AnimationArtboardOverlay({ bpId, boardRef, surfaceMode = 'artboard' }) {
  const animationEditor = useEditorStore((state) => state.animationEditor);
  const scrollSequenceRangeEditor = useEditorStore((state) => state.scrollSequenceRangeEditor);
  const page = useEditorStore((state) => state.getCurrentPage());
  const elements = page?.elements ?? [];
  const components = useEditorStore((state) => state.components);
  const updateElementAnimation = useEditorStore((state) => state.updateElementAnimation);
  const updateElementLayout = useEditorStore((state) => state.updateElementLayout);
  const closeAnimationEditor = useEditorStore((state) => state.closeAnimationEditor);
  const closeScrollSequenceRangeEditor = useEditorStore((state) => state.closeScrollSequenceRangeEditor);

  const activeEditor = animationEditor?.elementId
    ? { kind: 'animation', ...animationEditor }
    : (scrollSequenceRangeEditor?.elementId ? { kind: 'scroll-sequence', ...scrollSequenceRangeEditor } : null);

  const activeElement = useMemo(
    () => elements.find((entry) => entry.id === activeEditor?.elementId) ?? null,
    [activeEditor?.elementId, elements]
  );

  const activeAnimation = useMemo(
    () => (activeEditor?.kind === 'animation' && activeElement && activeEditor?.bpId === bpId
      ? resolveElementAnimations(activeElement, bpId).find((entry) => entry.id === activeEditor.animationId) ?? null
      : null),
    [activeEditor, activeElement, bpId]
  );

  const activeScrollSequence = useMemo(
    () => (activeEditor?.kind === 'scroll-sequence' && activeElement && activeEditor?.bpId === bpId
      ? resolveElement(activeElement, bpId)
      : null),
    [activeEditor, activeElement, bpId]
  );

  const activeComponent = useMemo(
    () => activeEditor?.kind === 'animation' && activeElement?.componentInstance?.componentId
      ? components.find((entry) => entry.id === activeElement.componentInstance.componentId) ?? null
      : null,
    [activeEditor?.kind, activeElement, components]
  );

  const variantLabelMap = useMemo(
    () => new Map((activeComponent?.variants ?? []).map((variant) => [variant.id, variant.name])),
    [activeComponent]
  );

  const editorMode = activeEditor?.kind === 'scroll-sequence' ? 'scroll-range' : (activeEditor?.mode ?? null);
  const activeRange = activeEditor?.kind === 'scroll-sequence' ? activeScrollSequence : activeAnimation;
  const elementRect = useElementRect(boardRef, activeEditor?.elementId, [
    boardRef,
    activeEditor?.elementId,
    editorMode,
    activeAnimation?.start,
    activeAnimation?.end,
    activeAnimation?.marker,
    JSON.stringify(activeAnimation?.targets ?? []),
    activeScrollSequence?.scrollSequenceStart,
    activeScrollSequence?.scrollSequenceEnd,
    activeScrollSequence?.scrollSequenceStartOffsetPx,
    activeScrollSequence?.scrollSequenceEndOffsetPx,
  ]);

  const boardHeight = boardRef.current?.clientHeight ?? 0;
  const boardWidth = boardRef.current?.clientWidth ?? 0;
  const boardTop = boardRef.current?.offsetTop ?? 0;
  const boardLeft = boardRef.current?.offsetLeft ?? 0;

  useLayoutEffect(() => {
    if (!elementRect || !boardHeight || !activeEditor || !activeElement) return;

    if (activeEditor.kind === 'scroll-sequence' && activeScrollSequence) {
      const nextStartOffsetPx = getCanonicalMarkerOffsetPx(activeScrollSequence.scrollSequenceStart, elementRect, boardHeight, 0.2, activeScrollSequence.scrollSequenceStartOffsetPx);
      const nextEndOffsetPx = getCanonicalMarkerOffsetPx(activeScrollSequence.scrollSequenceEnd, elementRect, boardHeight, 0.68, activeScrollSequence.scrollSequenceEndOffsetPx);
      if (nextStartOffsetPx == null || nextEndOffsetPx == null) return;
      if (activeScrollSequence.scrollSequenceStartOffsetPx === nextStartOffsetPx && activeScrollSequence.scrollSequenceEndOffsetPx === nextEndOffsetPx) return;
      updateElementLayout(activeElement.id, bpId, {
        scrollSequenceStartOffsetPx: nextStartOffsetPx,
        scrollSequenceEndOffsetPx: nextEndOffsetPx,
      });
      return;
    }

    if (activeEditor.kind !== 'animation' || !activeAnimation) return;

    if (activeAnimation.type === 'scroll') {
      const nextStartOffsetPx = getCanonicalMarkerOffsetPx(activeAnimation.start, elementRect, boardHeight, 0.2, activeAnimation.startOffsetPx);
      const nextEndOffsetPx = getCanonicalMarkerOffsetPx(activeAnimation.end, elementRect, boardHeight, 0.68, activeAnimation.endOffsetPx);
      if (nextStartOffsetPx == null || nextEndOffsetPx == null) return;
      if (activeAnimation.startOffsetPx === nextStartOffsetPx && activeAnimation.endOffsetPx === nextEndOffsetPx) return;
      updateElementAnimation(activeElement.id, bpId, activeAnimation.id, {
        startOffsetPx: nextStartOffsetPx,
        endOffsetPx: nextEndOffsetPx,
      });
      return;
    }

    if (activeAnimation.type === 'scroll-variant') {
      const nextTargets = (activeAnimation.targets ?? []).map((target) => ({
        ...target,
        markerOffsetPx: getCanonicalMarkerOffsetPx(target.marker, elementRect, boardHeight, 0.5, target.markerOffsetPx),
      }));
      const changed = nextTargets.some((target, index) => target.markerOffsetPx !== (activeAnimation.targets ?? [])[index]?.markerOffsetPx);
      if (!changed) return;
      updateElementAnimation(activeElement.id, bpId, activeAnimation.id, {
        targets: nextTargets,
      });
    }
  }, [activeEditor, activeAnimation, activeElement, activeScrollSequence, boardHeight, bpId, elementRect, updateElementAnimation, updateElementLayout]);

  if (surfaceMode !== 'artboard' || !activeEditor || activeEditor.bpId !== bpId || !activeElement || !activeRange) {
    return null;
  }
  if (!boardHeight || !boardWidth) return null;

  const railOffset = 40;
  const railLeft = boardWidth + railOffset;
  const sidePanelWidth = 220;
  const anchorRatio = getAnchorRatio(elementRect, boardHeight);

  const handleOverlayExit = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeEditor.kind === 'scroll-sequence') closeScrollSequenceRangeEditor();
    else closeAnimationEditor();
  };

  const scrimPanels = elementRect && editorMode === 'scroll-effect'
    ? [
        { key: 'top', style: { left: 0, top: 0, width: boardWidth, height: Math.max(0, elementRect.top) } },
        { key: 'left', style: { left: 0, top: elementRect.top, width: Math.max(0, elementRect.left), height: elementRect.height } },
        { key: 'right', style: { left: elementRect.left + elementRect.width, top: elementRect.top, width: Math.max(0, boardWidth - (elementRect.left + elementRect.width)), height: elementRect.height } },
        { key: 'bottom', style: { left: 0, top: elementRect.top + elementRect.height, width: boardWidth, height: Math.max(0, boardHeight - (elementRect.top + elementRect.height)) } },
      ]
    : [{ key: 'full', style: { left: 0, top: 0, width: boardWidth, height: boardHeight } }];

  const startDrag = (field, targetId = null) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const boardScaleY = boardHeight > 0 ? (boardRect.height / boardHeight) : 1;
    const pointerToLocalY = (clientY) => ((clientY - boardRect.top) / Math.max(boardScaleY, 0.0001));
    const currentLocalY = (() => {
      if (field === 'marker' && activeEditor.kind === 'animation') {
        const target = (activeAnimation?.targets ?? []).find((entry) => entry.id === targetId) ?? null;
        return getResolvedMarkerLocalY(target?.marker, elementRect, boardHeight, 0.5, target?.markerOffsetPx);
      }
      if (field === 'start') {
        return getResolvedMarkerLocalY(
          activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceStart : activeAnimation?.start,
          elementRect,
          boardHeight,
          0.2,
          activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceStartOffsetPx : activeAnimation?.startOffsetPx
        );
      }
      return getResolvedMarkerLocalY(
        activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceEnd : activeAnimation?.end,
        elementRect,
        boardHeight,
        0.68,
        activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceEndOffsetPx : activeAnimation?.endOffsetPx
      );
    })();
    const pointerOffsetPx = currentLocalY - pointerToLocalY(event.clientY);
    const onMove = (moveEvent) => {
      const localY = clamp(pointerToLocalY(moveEvent.clientY) + pointerOffsetPx, 0, boardHeight);
      const ratio = clamp(localY / boardHeight, 0, 1);
      const markerAnchorTop = getMarkerAnchorTop(elementRect);
      const nextOffsetPx = elementRect ? (localY - markerAnchorTop) : ((ratio - anchorRatio) * boardHeight);
      if (activeEditor.kind === 'scroll-sequence') {
        if (field === 'start') {
          const resolvedEnd = getResolvedMarkerRatio(activeScrollSequence?.scrollSequenceEnd, anchorRatio, ratio, activeScrollSequence?.scrollSequenceEndOffsetPx, boardHeight);
          const nextStart = Math.min(ratio, resolvedEnd);
          const nextStartY = nextStart * boardHeight;
          updateElementLayout(activeElement.id, bpId, {
            scrollSequenceStart: nextStart,
            scrollSequenceStartOffsetPx: elementRect ? (nextStartY - markerAnchorTop) : nextOffsetPx,
          });
          return;
        }
        const resolvedStart = getResolvedMarkerRatio(activeScrollSequence?.scrollSequenceStart, anchorRatio, ratio, activeScrollSequence?.scrollSequenceStartOffsetPx, boardHeight);
        const nextEnd = Math.max(ratio, resolvedStart);
        const nextEndY = nextEnd * boardHeight;
        updateElementLayout(activeElement.id, bpId, {
          scrollSequenceEnd: nextEnd,
          scrollSequenceEndOffsetPx: elementRect ? (nextEndY - markerAnchorTop) : nextOffsetPx,
        });
        return;
      }
      updateElementAnimation(activeElement.id, bpId, activeAnimation.id, (entry) => {
        if (field === 'marker') {
          const nextTargets = (entry.targets ?? []).map((target) => (
            target.id === targetId ? { ...target, marker: ratio, markerOffsetPx: nextOffsetPx } : target
          )).sort((left, right) => (left.marker ?? 0) - (right.marker ?? 0));
          return {
            ...entry,
            targets: nextTargets,
            marker: nextTargets[0]?.marker ?? ratio,
            targetVariantId: nextTargets[0]?.targetVariantId ?? null,
          };
        }
        if (field === 'start') {
          const resolvedEnd = getResolvedMarkerRatio(entry.end, anchorRatio, ratio, entry.endOffsetPx, boardHeight);
          const nextStart = Math.min(ratio, resolvedEnd);
          const nextStartY = nextStart * boardHeight;
          return { ...entry, start: nextStart, startOffsetPx: elementRect ? (nextStartY - markerAnchorTop) : nextOffsetPx };
        }
        const resolvedStart = getResolvedMarkerRatio(entry.start, anchorRatio, ratio, entry.startOffsetPx, boardHeight);
        const nextEnd = Math.max(ratio, resolvedStart);
        const nextEndY = nextEnd * boardHeight;
        return { ...entry, end: nextEnd, endOffsetPx: elementRect ? (nextEndY - markerAnchorTop) : nextOffsetPx };
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderLine = (label, ratio, draggable, field, extraClass = '', color = '#41d1ff', targetId = null) => (
    <div
      key={targetId || `${field || 'line'}-${label}`}
      className={`fb-animation-overlay__line ${extraClass}`.trim()}
      style={{ top: `${ratio * 100}%`, '--fb-animation-marker-color': color }}
      onPointerDown={draggable ? startDrag(field, targetId) : undefined}
    >
      <div className="fb-animation-overlay__line-rail" />
      <div className={`fb-animation-overlay__line-pill${draggable ? ' is-draggable' : ''}`}>
        {label}
      </div>
    </div>
  );

  const start = getResolvedMarkerRatio(
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceStart : activeAnimation?.start,
    anchorRatio,
    0.2,
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceStartOffsetPx : activeAnimation?.startOffsetPx,
    boardHeight
  );
  const end = getResolvedMarkerRatio(
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceEnd : activeAnimation?.end,
    anchorRatio,
    0.68,
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceEndOffsetPx : activeAnimation?.endOffsetPx,
    boardHeight
  );
  const center = (start + end) / 2;
  const targets = activeEditor.kind === 'animation' && Array.isArray(activeAnimation?.targets) ? activeAnimation.targets : [];

  return (
    <div
      className={`fb-animation-overlay${editorMode === 'scroll-effect' ? ' is-end-state' : ''}`}
      style={{ left: boardLeft, top: boardTop, width: boardWidth + railOffset + sidePanelWidth, height: boardHeight }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {scrimPanels.map((panel) => (
        <div key={panel.key} className="fb-animation-overlay__scrim" style={panel.style} onPointerDown={handleOverlayExit} />
      ))}
      <div className="fb-animation-overlay__toolbar">
        <span>
          {activeEditor.kind === 'scroll-sequence'
            ? 'Drag the scroll sequence start and end markers'
            : (editorMode === 'enter-start'
              ? 'Editing appear start state'
              : (editorMode === 'scroll-effect'
                ? 'Editing scroll end state'
                : (editorMode === 'scroll-variant-marker' ? 'Drag each variant trigger marker' : 'Drag the start and end markers')))}
        </span>
        <button type="button" className="fb-secondary-btn" onClick={handleOverlayExit}>Exit Editing</button>
      </div>
      <div className="fb-animation-overlay__rail" style={{ left: railLeft }}>
        {editorMode === 'scroll-range' ? (
          <>
            {renderLine('Start', start, true, 'start', '', '#ff8a3d')}
            {renderLine('Progress', center, false, null, 'fb-animation-overlay__line--center', '#41d1ff')}
            {renderLine('End', end, true, 'end', '', '#b5ff4d')}
          </>
        ) : null}
        {editorMode === 'scroll-variant-marker'
          ? targets.map((target, index) => renderLine(
              `${variantLabelMap.get(target.targetVariantId) || `Variant ${index + 1}`}`,
              getResolvedMarkerRatio(target.marker, anchorRatio, 0.5, target.markerOffsetPx, boardHeight),
              true,
              'marker',
              '',
              MARKER_COLORS[index % MARKER_COLORS.length],
              target.id
            ))
          : null}
      </div>
    </div>
  );
}
