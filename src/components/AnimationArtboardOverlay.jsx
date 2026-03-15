import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useEditorStore, resolveElementAnimations } from '../store/editorStore';

const MARKER_COLORS = ['#ff8a3d', '#41d1ff', '#b5ff4d', '#ff5db1', '#ffd84d'];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getAnchorRatio(elementRect, boardHeight) {
  if (!elementRect || !boardHeight) return 0;
  return clamp(elementRect.top / boardHeight, 0, 1);
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
  const page = useEditorStore((state) => state.getCurrentPage());
  const elements = page?.elements ?? [];
  const components = useEditorStore((state) => state.components);
  const updateElementAnimation = useEditorStore((state) => state.updateElementAnimation);
  const closeAnimationEditor = useEditorStore((state) => state.closeAnimationEditor);

  const activeElement = useMemo(
    () => elements.find((entry) => entry.id === animationEditor?.elementId) ?? null,
    [animationEditor?.elementId, elements]
  );

  const activeAnimation = useMemo(
    () => (activeElement && animationEditor?.bpId === bpId
      ? resolveElementAnimations(activeElement, bpId).find((entry) => entry.id === animationEditor.animationId) ?? null
      : null),
    [activeElement, animationEditor, bpId]
  );

  const activeComponent = useMemo(
    () => activeElement?.componentInstance?.componentId
      ? components.find((entry) => entry.id === activeElement.componentInstance.componentId) ?? null
      : null,
    [activeElement, components]
  );

  const variantLabelMap = useMemo(
    () => new Map((activeComponent?.variants ?? []).map((variant) => [variant.id, variant.name])),
    [activeComponent]
  );

  const elementRect = useElementRect(boardRef, animationEditor?.elementId, [boardRef, animationEditor?.elementId, animationEditor?.mode, activeAnimation?.start, activeAnimation?.end, activeAnimation?.marker, JSON.stringify(activeAnimation?.targets ?? [])]);

  if (surfaceMode !== 'artboard' || !animationEditor || animationEditor.bpId !== bpId || !activeElement || !activeAnimation) {
    return null;
  }

  const boardHeight = boardRef.current?.clientHeight ?? 0;
  const boardWidth = boardRef.current?.clientWidth ?? 0;
  if (!boardHeight || !boardWidth) return null;

  const railRight = 18;
  const anchorRatio = getAnchorRatio(elementRect, boardHeight);

  const handleOverlayExit = (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeAnimationEditor();
  };

  const scrimPanels = elementRect && animationEditor.mode === 'scroll-effect'
    ? [
        { key: 'top', style: { left: 0, top: 0, width: '100%', height: Math.max(0, elementRect.top) } },
        { key: 'left', style: { left: 0, top: elementRect.top, width: Math.max(0, elementRect.left), height: elementRect.height } },
        { key: 'right', style: { left: elementRect.left + elementRect.width, top: elementRect.top, width: Math.max(0, boardWidth - (elementRect.left + elementRect.width)), height: elementRect.height } },
        { key: 'bottom', style: { left: 0, top: elementRect.top + elementRect.height, width: '100%', height: Math.max(0, boardHeight - (elementRect.top + elementRect.height)) } },
      ]
    : [{ key: 'full', style: { inset: 0 } }];

  const startDrag = (field, targetId = null) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const boardScaleY = boardHeight > 0 ? (boardRect.height / boardHeight) : 1;
    const pointerToLocalY = (clientY) => ((clientY - boardRect.top) / Math.max(boardScaleY, 0.0001));
    const currentLocalY = (() => {
      if (field === 'marker') {
        const target = (activeAnimation.targets ?? []).find((entry) => entry.id === targetId) ?? null;
        return getResolvedMarkerLocalY(target?.marker, elementRect, boardHeight, 0.5, target?.markerOffsetPx);
      }
      if (field === 'start') {
        return getResolvedMarkerLocalY(activeAnimation.start, elementRect, boardHeight, 0.2, activeAnimation.startOffsetPx);
      }
      return getResolvedMarkerLocalY(activeAnimation.end, elementRect, boardHeight, 0.68, activeAnimation.endOffsetPx);
    })();
    const pointerOffsetPx = currentLocalY - pointerToLocalY(event.clientY);
    const onMove = (moveEvent) => {
      const localY = clamp(pointerToLocalY(moveEvent.clientY) + pointerOffsetPx, 0, boardHeight);
      const ratio = clamp(localY / boardHeight, 0, 1);
      const nextOffsetPx = elementRect ? (localY - elementRect.top) : ((ratio - anchorRatio) * boardHeight);
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
          return { ...entry, start: nextStart, startOffsetPx: elementRect ? (nextStartY - elementRect.top) : nextOffsetPx };
        }
        const resolvedStart = getResolvedMarkerRatio(entry.start, anchorRatio, ratio, entry.startOffsetPx, boardHeight);
        const nextEnd = Math.max(ratio, resolvedStart);
        const nextEndY = nextEnd * boardHeight;
        return { ...entry, end: nextEnd, endOffsetPx: elementRect ? (nextEndY - elementRect.top) : nextOffsetPx };
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

  const start = getResolvedMarkerRatio(activeAnimation.start, anchorRatio, 0.2, activeAnimation.startOffsetPx, boardHeight);
  const end = getResolvedMarkerRatio(activeAnimation.end, anchorRatio, 0.68, activeAnimation.endOffsetPx, boardHeight);
  const center = (start + end) / 2;
  const targets = Array.isArray(activeAnimation.targets) ? activeAnimation.targets : [];

  return (
    <div className={`fb-animation-overlay${animationEditor.mode === 'scroll-effect' ? ' is-end-state' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
      {scrimPanels.map((panel) => (
        <div key={panel.key} className="fb-animation-overlay__scrim" style={panel.style} onPointerDown={handleOverlayExit} />
      ))}
      <div className="fb-animation-overlay__toolbar">
        <span>
          {animationEditor.mode === 'enter-start'
            ? 'Editing appear start state'
            : (animationEditor.mode === 'scroll-effect'
              ? 'Editing scroll end state'
              : (animationEditor.mode === 'scroll-variant-marker' ? 'Drag each variant trigger marker' : 'Drag the start and end markers'))}
        </span>
        <button type="button" className="fb-secondary-btn" onClick={closeAnimationEditor}>Exit Editing</button>
      </div>
      <div className="fb-animation-overlay__rail" style={{ right: railRight }}>
        {animationEditor.mode === 'scroll-range' ? (
          <>
            {renderLine('Start', start, true, 'start', '', '#ff8a3d')}
            {renderLine('Progress', center, false, null, 'fb-animation-overlay__line--center', '#41d1ff')}
            {renderLine('End', end, true, 'end', '', '#b5ff4d')}
          </>
        ) : null}
        {animationEditor.mode === 'scroll-variant-marker'
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
