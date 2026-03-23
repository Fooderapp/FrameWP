import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useEditorStore, resolveElement, resolveElementAnimations } from '../store/editorStore';

const MARKER_COLORS = ['#ff8a3d', '#41d1ff', '#b5ff4d', '#ff5db1', '#ffd84d'];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getMarkerAnchorTop(measurement) {
  if (!measurement) return 0;
  return Number.isFinite(measurement.anchorTop) ? measurement.anchorTop : 0;
}

function getMarkerLocalY(value, offsetPx, measurement, boardHeight, fallbackRatio = 0.5) {
  if (!measurement || !boardHeight) return 0;
  const explicitOffsetPx = toFiniteNumber(offsetPx);
  if (explicitOffsetPx != null) {
    return getMarkerAnchorTop(measurement) + explicitOffsetPx;
  }
  const ratioValue = toFiniteNumber(value);
  const resolvedRatio = clamp(ratioValue != null ? ratioValue : fallbackRatio, 0, 1);
  return clamp(resolvedRatio * boardHeight, 0, boardHeight);
}

function getMarkerRatio(value, offsetPx, measurement, boardHeight, fallbackRatio = 0.5) {
  if (!boardHeight) return 0;
  return clamp(getMarkerLocalY(value, offsetPx, measurement, boardHeight, fallbackRatio) / boardHeight, 0, 1);
}

function getMarkerOffsetPx(value, offsetPx, measurement, boardHeight, fallbackRatio = 0.5) {
  const explicitOffsetPx = toFiniteNumber(offsetPx);
  if (explicitOffsetPx != null) return explicitOffsetPx;
  if (!measurement || !boardHeight) return null;
  return getMarkerLocalY(value, offsetPx, measurement, boardHeight, fallbackRatio) - getMarkerAnchorTop(measurement);
}

function getMarkerStateForLocalY(localY, measurement, boardHeight) {
  const clampedLocalY = clamp(localY, 0, boardHeight);
  return {
    localY: clampedLocalY,
    ratio: boardHeight > 0 ? clamp(clampedLocalY / boardHeight, 0, 1) : 0,
    offsetPx: clampedLocalY - getMarkerAnchorTop(measurement),
  };
}

function useScrollMarkerMeasurement(boardRef, elementId, deps) {
  const [measurement, setMeasurement] = useState(null);

  useLayoutEffect(() => {
    const update = () => {
      const board = boardRef.current;
      const target = board?.querySelector(`[data-id="${elementId}"]`);
      if (!board || !target) {
        setMeasurement(null);
        return;
      }
      const boardRect = board.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scaleX = board.clientWidth > 0 ? (boardRect.width / board.clientWidth) : 1;
      const scaleY = board.clientHeight > 0 ? (boardRect.height / board.clientHeight) : 1;
      setMeasurement({
        left: (targetRect.left - boardRect.left) / Math.max(scaleX, 0.0001),
        top: (targetRect.top - boardRect.top) / Math.max(scaleY, 0.0001),
        anchorTop: ((targetRect.top - boardRect.top) + (board.scrollTop || 0)) / Math.max(scaleY, 0.0001),
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

  return measurement;
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
  const markerMeasurement = useScrollMarkerMeasurement(boardRef, activeEditor?.elementId, [
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
    if (!markerMeasurement || !boardHeight || !activeEditor || !activeElement) return;

    if (activeEditor.kind === 'scroll-sequence' && activeScrollSequence) {
      const nextStartOffsetPx = getMarkerOffsetPx(activeScrollSequence.scrollSequenceStart, activeScrollSequence.scrollSequenceStartOffsetPx, markerMeasurement, boardHeight, 0.2);
      const nextEndOffsetPx = getMarkerOffsetPx(activeScrollSequence.scrollSequenceEnd, activeScrollSequence.scrollSequenceEndOffsetPx, markerMeasurement, boardHeight, 0.68);
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
      const nextStartOffsetPx = getMarkerOffsetPx(activeAnimation.start, activeAnimation.startOffsetPx, markerMeasurement, boardHeight, 0.2);
      const nextEndOffsetPx = getMarkerOffsetPx(activeAnimation.end, activeAnimation.endOffsetPx, markerMeasurement, boardHeight, 0.68);
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
        markerOffsetPx: getMarkerOffsetPx(target.marker, target.markerOffsetPx, markerMeasurement, boardHeight, 0.5),
      }));
      const changed = nextTargets.some((target, index) => target.markerOffsetPx !== (activeAnimation.targets ?? [])[index]?.markerOffsetPx);
      if (!changed) return;
      updateElementAnimation(activeElement.id, bpId, activeAnimation.id, {
        targets: nextTargets,
      });
    }
  }, [activeEditor, activeAnimation, activeElement, activeScrollSequence, boardHeight, bpId, markerMeasurement, updateElementAnimation, updateElementLayout]);

  if (surfaceMode !== 'artboard' || !activeEditor || activeEditor.bpId !== bpId || !activeElement || !activeRange) {
    return null;
  }
  if (!boardHeight || !boardWidth) return null;

  const railOffset = 40;
  const railLeft = boardWidth + railOffset;
  const sidePanelWidth = 220;
  const anchorTop = getMarkerAnchorTop(markerMeasurement);

  const handleOverlayExit = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeEditor.kind === 'scroll-sequence') closeScrollSequenceRangeEditor();
    else closeAnimationEditor();
  };

  const scrimPanels = markerMeasurement && (editorMode === 'scroll-start' || editorMode === 'scroll-effect')
    ? [
        { key: 'top', style: { left: 0, top: 0, width: boardWidth, height: Math.max(0, markerMeasurement.top) } },
        { key: 'left', style: { left: 0, top: markerMeasurement.top, width: Math.max(0, markerMeasurement.left), height: markerMeasurement.height } },
        { key: 'right', style: { left: markerMeasurement.left + markerMeasurement.width, top: markerMeasurement.top, width: Math.max(0, boardWidth - (markerMeasurement.left + markerMeasurement.width)), height: markerMeasurement.height } },
        { key: 'bottom', style: { left: 0, top: markerMeasurement.top + markerMeasurement.height, width: boardWidth, height: Math.max(0, boardHeight - (markerMeasurement.top + markerMeasurement.height)) } },
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
    const onMove = (moveEvent) => {
      const localY = clamp(pointerToLocalY(moveEvent.clientY), 0, boardHeight);
      if (activeEditor.kind === 'scroll-sequence') {
        if (field === 'start') {
          const resolvedEndLocalY = getMarkerLocalY(activeScrollSequence?.scrollSequenceEnd, activeScrollSequence?.scrollSequenceEndOffsetPx, markerMeasurement, boardHeight, 0.68);
          const nextStartState = getMarkerStateForLocalY(Math.min(localY, resolvedEndLocalY), markerMeasurement, boardHeight);
          updateElementLayout(activeElement.id, bpId, {
            scrollSequenceStart: nextStartState.ratio,
            scrollSequenceStartOffsetPx: nextStartState.offsetPx,
          });
          return;
        }
        const resolvedStartLocalY = getMarkerLocalY(activeScrollSequence?.scrollSequenceStart, activeScrollSequence?.scrollSequenceStartOffsetPx, markerMeasurement, boardHeight, 0.2);
        const nextEndState = getMarkerStateForLocalY(Math.max(localY, resolvedStartLocalY), markerMeasurement, boardHeight);
        updateElementLayout(activeElement.id, bpId, {
          scrollSequenceEnd: nextEndState.ratio,
          scrollSequenceEndOffsetPx: nextEndState.offsetPx,
        });
        return;
      }
      updateElementAnimation(activeElement.id, bpId, activeAnimation.id, (entry) => {
        if (field === 'marker') {
          const nextMarkerState = getMarkerStateForLocalY(localY, markerMeasurement, boardHeight);
          const nextTargets = (entry.targets ?? []).map((target) => (
            target.id === targetId ? { ...target, marker: nextMarkerState.ratio, markerOffsetPx: nextMarkerState.offsetPx } : target
          )).sort((left, right) => {
            const leftLocalY = getMarkerLocalY(left.marker, left.markerOffsetPx, markerMeasurement, boardHeight, 0.5);
            const rightLocalY = getMarkerLocalY(right.marker, right.markerOffsetPx, markerMeasurement, boardHeight, 0.5);
            return leftLocalY - rightLocalY;
          });
          return {
            ...entry,
            targets: nextTargets,
            marker: nextTargets[0]?.marker ?? nextMarkerState.ratio,
            targetVariantId: nextTargets[0]?.targetVariantId ?? null,
          };
        }
        if (field === 'start') {
          const resolvedEndLocalY = getMarkerLocalY(entry.end, entry.endOffsetPx, markerMeasurement, boardHeight, 0.68);
          const nextStartState = getMarkerStateForLocalY(Math.min(localY, resolvedEndLocalY), markerMeasurement, boardHeight);
          return { ...entry, start: nextStartState.ratio, startOffsetPx: nextStartState.offsetPx };
        }
        const resolvedStartLocalY = getMarkerLocalY(entry.start, entry.startOffsetPx, markerMeasurement, boardHeight, 0.2);
        const nextEndState = getMarkerStateForLocalY(Math.max(localY, resolvedStartLocalY), markerMeasurement, boardHeight);
        return { ...entry, end: nextEndState.ratio, endOffsetPx: nextEndState.offsetPx };
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

  const startRatio = getMarkerRatio(
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceStart : activeAnimation?.start,
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceStartOffsetPx : activeAnimation?.startOffsetPx,
    markerMeasurement,
    boardHeight,
    0.2
  );
  const endRatio = getMarkerRatio(
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceEnd : activeAnimation?.end,
    activeEditor.kind === 'scroll-sequence' ? activeScrollSequence?.scrollSequenceEndOffsetPx : activeAnimation?.endOffsetPx,
    markerMeasurement,
    boardHeight,
    0.68
  );
  const center = (startRatio + endRatio) / 2;
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
              : (editorMode === 'scroll-start'
                ? 'Editing scroll start state'
                : (editorMode === 'scroll-effect'
                  ? 'Editing scroll end state'
                  : (editorMode === 'scroll-variant-marker'
                    ? 'Drag each variant trigger marker'
                    : 'Drag the start and end markers'))))}
        </span>
        <button type="button" className="fb-secondary-btn" onClick={handleOverlayExit}>Exit Editing</button>
      </div>
      <div className="fb-animation-overlay__rail" style={{ left: railLeft }}>
        {editorMode === 'scroll-range' ? (
          <>
            {renderLine('Start', startRatio, true, 'start', '', '#ff8a3d')}
            {renderLine('Progress', center, false, null, 'fb-animation-overlay__line--center', '#41d1ff')}
            {renderLine('End', endRatio, true, 'end', '', '#b5ff4d')}
          </>
        ) : null}
        {editorMode === 'scroll-variant-marker'
          ? targets.map((target, index) => renderLine(
              `${variantLabelMap.get(target.targetVariantId) || `Variant ${index + 1}`}`,
              getMarkerRatio(target.marker, target.markerOffsetPx, markerMeasurement, boardHeight, 0.5),
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
