import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap, Flip } from 'gsap/all';
import { resolveElement } from '../store/editorStore';
import { familyToFontStack } from './googleFonts';

gsap.registerPlugin(Flip);

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function getMediaUrl(value) {
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
  return typeof value === 'string' ? value.trim() : '';
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override;
  const next = { ...base };
  Object.keys(override).forEach((key) => {
    next[key] = key in base ? deepMerge(base[key], override[key]) : override[key];
  });
  return next;
}

function getSnapshotRoot(snapshot = []) {
  const idSet = new Set(snapshot.map((el) => el.id));
  return snapshot.find((el) => !idSet.has(el.parentId)) ?? snapshot[0] ?? null;
}

function applyVariantOverrides(primarySnapshot = [], overrideSnapshot = []) {
  const baseMap = new Map(primarySnapshot.map((el) => [el.id, structuredClone(el)]));
  const deleteIds = new Set();

  const collectDeleteIds = (elementId) => {
    if (deleteIds.has(elementId)) return;
    deleteIds.add(elementId);
    const element = baseMap.get(elementId);
    (element?.children ?? []).forEach(collectDeleteIds);
  };

  overrideSnapshot.forEach((entry) => {
    if (entry?.__deleted) collectDeleteIds(entry.id);
  });

  const next = primarySnapshot
    .filter((el) => !deleteIds.has(el.id))
    .map((el) => ({ ...structuredClone(el), children: (el.children ?? []).filter((childId) => !deleteIds.has(childId)) }));

  const nextMap = new Map(next.map((el) => [el.id, el]));
  overrideSnapshot.forEach((entry) => {
    if (!entry || entry.__deleted) return;
    if (nextMap.has(entry.id)) {
      const merged = deepMerge(nextMap.get(entry.id), entry);
      delete merged.__added;
      nextMap.set(entry.id, merged);
      return;
    }
    const added = structuredClone(entry);
    delete added.__added;
    nextMap.set(added.id, added);
  });

  return Array.from(nextMap.values());
}

function isDefaultVariant(variant) {
  return (variant?.mode ?? 'default') === 'default';
}

function getBaseVariantId(variants = [], variantId = null) {
  const current = variants.find((variant) => variant.id === variantId) ?? null;
  if (!current) return getPrimaryVariant(variants)?.id ?? null;
  return isDefaultVariant(current) ? current.id : (current.parentVariantId ?? getPrimaryVariant(variants)?.id ?? null);
}

function findStateVariant(variants = [], baseVariantId, mode) {
  return variants.find((variant) => variant.mode === mode && variant.parentVariantId === baseVariantId) ?? null;
}

function getStateTransition() {
  return {
    type: 'ease',
    duration: 0.18,
    easePreset: 'easeInOut',
    springMode: 'time',
    bounce: 0,
    stiffness: 500,
    damping: 24,
    mass: 1,
    bezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
  };
}

function getPrimaryVariant(variants = []) {
  return variants.find(isDefaultVariant) ?? variants[0] ?? null;
}

function composeVariantSnapshot(variants = [], activeVariantId = null) {
  const primary = getPrimaryVariant(variants);
  if (!primary) return [];
  if (!activeVariantId || activeVariantId === primary.id) return structuredClone(primary.snapshot ?? []);
  const variant = variants.find((item) => item.id === activeVariantId) ?? primary;
  if (variant.id === primary.id) return structuredClone(primary.snapshot ?? []);
  if (isDefaultVariant(variant)) {
    return applyVariantOverrides(structuredClone(primary.snapshot ?? []), structuredClone(variant.snapshot ?? []));
  }
  const parent = variants.find((item) => item.id === variant.parentVariantId) ?? primary;
  return applyVariantOverrides(composeVariantSnapshot(variants, parent.id), structuredClone(variant.snapshot ?? []));
}

function normalizeTransition(transition) {
  const type = ['instant', 'ease', 'realistic'].includes(transition?.type) ? transition.type : 'instant';
  return {
    type,
    duration: Number.isFinite(transition?.duration) ? Math.max(0, transition.duration) : 0.3,
    easePreset: ['easeInOut', 'easeOut', 'easeIn', 'linear', 'custom'].includes(transition?.easePreset) ? transition.easePreset : 'easeInOut',
    springMode: transition?.springMode === 'physics' ? 'physics' : 'time',
    bounce: Number.isFinite(transition?.bounce) ? Math.max(0, Math.min(1, transition.bounce)) : 0.2,
    stiffness: Number.isFinite(transition?.stiffness) ? Math.max(1, transition.stiffness) : 500,
    damping: Number.isFinite(transition?.damping) ? Math.max(1, transition.damping) : 24,
    mass: Number.isFinite(transition?.mass) ? Math.max(0.1, transition.mass) : 1,
    bezier: {
      x1: Number.isFinite(transition?.bezier?.x1) ? Math.max(0, Math.min(1, transition.bezier.x1)) : 0.44,
      y1: Number.isFinite(transition?.bezier?.y1) ? Math.max(0, Math.min(1, transition.bezier.y1)) : 0,
      x2: Number.isFinite(transition?.bezier?.x2) ? Math.max(0, Math.min(1, transition.bezier.x2)) : 0.56,
      y2: Number.isFinite(transition?.bezier?.y2) ? Math.max(0, Math.min(1, transition.bezier.y2)) : 1,
    },
  };
}

function getTransitionDurationMs(transition) {
  if (!transition || transition.type === 'instant') return 0;
  if (transition.type === 'ease') return Math.max(120, transition.duration * 1000);
  if (transition.springMode === 'time') return Math.max(180, transition.duration * 1000);
  return getPhysicsSpringConfig(transition).duration * 1000;
}

function createBezierEase(bezier) {
  const x1 = Math.max(0, Math.min(1, bezier?.x1 ?? 0.44));
  const y1 = Math.max(0, Math.min(1, bezier?.y1 ?? 0));
  const x2 = Math.max(0, Math.min(1, bezier?.x2 ?? 0.56));
  const y2 = Math.max(0, Math.min(1, bezier?.y2 ?? 1));
  if (x1 === y1 && x2 === y2) return (value) => value;

  const calcBezier = (time, point1, point2) => {
    const a = 1 - (3 * point2) + (3 * point1);
    const b = (3 * point2) - (6 * point1);
    const c = 3 * point1;
    return (((a * time) + b) * time + c) * time;
  };
  const getSlope = (time, point1, point2) => {
    const a = 1 - (3 * point2) + (3 * point1);
    const b = (3 * point2) - (6 * point1);
    const c = 3 * point1;
    return (3 * a * time * time) + (2 * b * time) + c;
  };
  const binarySubdivide = (targetX, left, right) => {
    let currentX;
    let currentT;
    for (let index = 0; index < 8; index += 1) {
      currentT = left + ((right - left) * 0.5);
      currentX = calcBezier(currentT, x1, x2) - targetX;
      if (Math.abs(currentX) < 1e-5) return currentT;
      if (currentX > 0) right = currentT;
      else left = currentT;
    }
    return currentT;
  };
  const getTForX = (targetX) => {
    let guessT = targetX;
    for (let index = 0; index < 4; index += 1) {
      const slope = getSlope(guessT, x1, x2);
      if (Math.abs(slope) < 1e-6) break;
      const currentX = calcBezier(guessT, x1, x2) - targetX;
      guessT -= currentX / slope;
    }
    if (guessT >= 0 && guessT <= 1) return guessT;
    return binarySubdivide(targetX, 0, 1);
  };

  return (value) => calcBezier(getTForX(Math.max(0, Math.min(1, value))), y1, y2);
}

function getTransitionEasing(transition) {
  if (!transition || transition.type === 'instant') return 'linear';
  if (transition.type === 'ease') {
    return createBezierEase(transition.bezier);
  }
  return transition.springMode === 'physics'
    ? 'none'
    : `back.out(${1 + transition.bounce * 1.2})`;
}

function getRealisticOvershoot(transition) {
  if (!transition || transition.type !== 'realistic') return 1.03;
  if (transition.springMode === 'physics') {
    const spring = getPhysicsSpringConfig(transition);
    if (spring.dampingRatio >= 1) return 1;
    return 1 + Math.min(0.28, Math.max(0.04, 0.16 * (1 - spring.dampingRatio)));
  }
  return 1 + Math.max(0.06, transition.bounce * 0.18);
}

function getPhysicsSpringConfig(transition) {
  const mass = Math.max(0.1, transition?.mass ?? 1);
  const stiffness = Math.max(1, transition?.stiffness ?? 500);
  const damping = Math.max(1, transition?.damping ?? 24);
  const angularFrequency = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const duration = dampingRatio < 1
    ? Math.log(1 / 0.0025) / (Math.max(0.05, dampingRatio) * angularFrequency)
    : Math.log(1 / 0.0025) / angularFrequency;
  return {
    mass,
    stiffness,
    damping,
    angularFrequency,
    dampingRatio,
    duration: Math.max(0.45, Math.min(2.4, duration)),
  };
}

function sampleSpringValue(initialValue, elapsed, spring) {
  if (!initialValue) return 0;
  const velocity = 0;
  const { angularFrequency, dampingRatio } = spring;
  if (dampingRatio < 1) {
    const dampedFrequency = angularFrequency * Math.sqrt(1 - (dampingRatio * dampingRatio));
    const envelope = Math.exp(-dampingRatio * angularFrequency * elapsed);
    const coefficient = (velocity + (dampingRatio * angularFrequency * initialValue)) / dampedFrequency;
    return envelope * ((initialValue * Math.cos(dampedFrequency * elapsed)) + (coefficient * Math.sin(dampedFrequency * elapsed)));
  }
  if (Math.abs(dampingRatio - 1) < 0.0001) {
    return (initialValue + ((velocity + (angularFrequency * initialValue)) * elapsed)) * Math.exp(-angularFrequency * elapsed);
  }
  const decay = Math.sqrt((dampingRatio * dampingRatio) - 1);
  const rateA = -angularFrequency * (dampingRatio - decay);
  const rateB = -angularFrequency * (dampingRatio + decay);
  const coeffA = (velocity - (rateB * initialValue)) / (rateA - rateB);
  const coeffB = initialValue - coeffA;
  return (coeffA * Math.exp(rateA * elapsed)) + (coeffB * Math.exp(rateB * elapsed));
}

function addPhysicsSpringSequence(timeline, node, startState, spring, at = 0) {
  const stepCount = 24;
  let previousTime = 0;
  for (let index = 1; index <= stepCount; index += 1) {
    const elapsed = (spring.duration * index) / stepCount;
    const stepDuration = elapsed - previousTime;
    timeline.to(node, {
      x: sampleSpringValue(startState.x, elapsed, spring),
      y: sampleSpringValue(startState.y, elapsed, spring),
      scaleX: 1 + sampleSpringValue(startState.scaleX - 1, elapsed, spring),
      scaleY: 1 + sampleSpringValue(startState.scaleY - 1, elapsed, spring),
      rotation: sampleSpringValue(startState.rotation || 0, elapsed, spring),
      duration: stepDuration,
      ease: 'none',
      ...(index === stepCount ? { clearProps: 'transform' } : null),
    }, at + previousTime);
    previousTime = elapsed;
  }
}

function addWrapperPhysicsSequence(timeline, node, spring, at = 0) {
  gsap.set(node, { scaleX: 0.935, scaleY: 0.935, transformOrigin: 'top left' });
  addPhysicsSpringSequence(timeline, node, {
    x: 0,
    y: 0,
    scaleX: 0.935,
    scaleY: 0.935,
  }, spring, at);
}

function getRealisticProfile(transition) {
  const overshoot = Math.max(0.05, getRealisticOvershoot(transition) - 1);
  return {
    travelOvershoot: Math.max(0.12, overshoot * 1.55),
    scaleOvershoot: Math.max(0.05, overshoot * 1.1),
    pushDuration: Math.max(0.18, transition.duration * 0.42),
    settleDuration: Math.max(0.22, transition.duration * 0.58),
    pushEase: 'power2.out',
    settleEase: `back.out(${1.6 + (transition.bounce * 2.6)})`,
  };
}

function getEnterTweenVars(transition) {
  if (transition.type === 'realistic') {
    const overshoot = getRealisticOvershoot(transition);
    return {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: getTransitionDurationMs(transition) / 1000,
      ease: transition.springMode === 'physics' ? `elastic.out(1, ${Math.max(0.2, transition.mass * 0.45)})` : `back.out(${1 + transition.bounce * 1.2})`,
      clearProps: 'opacity,transform,visibility,pointerEvents',
      transformOrigin: 'top left',
      startAt: { opacity: 0, y: 0, scale: Math.max(0.94, overshoot - 0.06) },
    };
  }
  return {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: getTransitionDurationMs(transition) / 1000,
    ease: getTransitionEasing(transition),
    clearProps: 'opacity,transform,visibility,pointerEvents',
    transformOrigin: 'top left',
    startAt: { opacity: 0, y: 0, scale: 0.992 },
  };
}

function getExitTweenVars(transition) {
  return {
    opacity: 0,
    y: 0,
    scale: transition.type === 'realistic' ? 0.985 : 0.992,
    duration: getTransitionDurationMs(transition) / 1000,
    ease: transition.type === 'realistic' ? 'power2.in' : getTransitionEasing(transition),
    clearProps: 'opacity,transform,visibility,pointerEvents',
    transformOrigin: 'top left',
  };
}

function collectSharedElementPairs(container, currentVariant, nextVariant) {
  if (!container || !currentVariant || !nextVariant) return [];
  const containerRect = container.getBoundingClientRect();
  const currentNodes = new Map(
    Array.from(currentVariant.querySelectorAll('[data-fb-node-id]')).map((node) => [node.dataset.fbNodeId, node]),
  );
  return Array.from(nextVariant.querySelectorAll('[data-fb-node-id]')).reduce((pairs, nextNode) => {
    const nodeId = nextNode.dataset.fbNodeId;
    const currentNode = currentNodes.get(nodeId);
    if (!nodeId || !currentNode) return pairs;
    const currentRect = currentNode.getBoundingClientRect();
    const nextRect = nextNode.getBoundingClientRect();
    if (!currentRect.width || !currentRect.height || !nextRect.width || !nextRect.height) return pairs;
    pairs.push({
      currentNode,
      nextNode,
      deltaX: currentRect.left - nextRect.left,
      deltaY: currentRect.top - nextRect.top,
      scaleX: currentRect.width / nextRect.width,
      scaleY: currentRect.height / nextRect.height,
      insideViewport:
        currentRect.right >= containerRect.left
        && currentRect.left <= containerRect.right
        && currentRect.bottom >= containerRect.top
        && currentRect.top <= containerRect.bottom,
    });
    return pairs;
  }, []);
}

const ANIMATABLE_STYLE_PROPS = ['backgroundColor', 'color', 'borderRadius', 'borderColor', 'boxShadow', 'opacity'];
const CROSSFADE_STYLE_PROPS = ['backgroundImage'];
const FLIP_PROPS = 'opacity,backgroundColor,color,borderRadius,borderColor,boxShadow';

function getRotationFromComputedStyle(style) {
  const rotate = style?.rotate;
  if (rotate && rotate !== 'none') {
    const parsedRotate = parseFloat(rotate);
    if (Number.isFinite(parsedRotate)) return parsedRotate;
  }

  const transform = style?.transform;
  if (!transform || transform === 'none') return 0;

  const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrixMatch) {
    const values = matrixMatch[1].split(',').map((value) => parseFloat(value.trim()));
    if (values.length >= 2 && values.every((value) => Number.isFinite(value))) {
      return Math.atan2(values[1], values[0]) * (180 / Math.PI);
    }
  }

  const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/);
  if (matrix3dMatch) {
    const values = matrix3dMatch[1].split(',').map((value) => parseFloat(value.trim()));
    if (values.length >= 2 && values.every((value) => Number.isFinite(value))) {
      return Math.atan2(values[1], values[0]) * (180 / Math.PI);
    }
  }

  return 0;
}

function hasStyleDifference(currentValue, nextValue) {
  if (currentValue === nextValue) return false;
  const currentNumber = parseFloat(currentValue);
  const nextNumber = parseFloat(nextValue);
  if (Number.isFinite(currentNumber) && Number.isFinite(nextNumber)) {
    return Math.abs(currentNumber - nextNumber) > 0.01;
  }
  return true;
}

function getNodeAnimationChanges(currentNode, nextNode) {
  const currentRect = currentNode.getBoundingClientRect();
  const nextRect = nextNode.getBoundingClientRect();
  const currentStyle = window.getComputedStyle(currentNode);
  const nextStyle = window.getComputedStyle(nextNode);
  const styleFrom = {};
  const styleTo = {};

  ANIMATABLE_STYLE_PROPS.forEach((prop) => {
    const currentValue = currentStyle[prop];
    const nextValue = nextStyle[prop];
    if (!hasStyleDifference(currentValue, nextValue)) return;
    styleFrom[prop] = currentValue;
    styleTo[prop] = nextValue;
  });

  const unsupportedChange = CROSSFADE_STYLE_PROPS.some((prop) => hasStyleDifference(currentStyle[prop], nextStyle[prop]))
    || currentNode.textContent !== nextNode.textContent;
  const deltaX = currentRect.left - nextRect.left;
  const deltaY = currentRect.top - nextRect.top;
  const scaleX = currentRect.width / Math.max(nextRect.width, 0.01);
  const scaleY = currentRect.height / Math.max(nextRect.height, 0.01);
  const rotation = getRotationFromComputedStyle(currentStyle) - getRotationFromComputedStyle(nextStyle);
  const geometryChanged = Math.abs(deltaX) > 0.5
    || Math.abs(deltaY) > 0.5
    || Math.abs(scaleX - 1) > 0.01
    || Math.abs(scaleY - 1) > 0.01
    || Math.abs(rotation) > 0.5;

  return {
    geometryChanged,
    styleChanged: Object.keys(styleTo).length > 0,
    needsCrossfade: unsupportedChange,
    startState: {
      x: deltaX,
      y: deltaY,
      scaleX: Math.max(0.01, scaleX),
      scaleY: Math.max(0.01, scaleY),
      rotation,
    },
    styleFrom,
    styleTo,
    styleProps: Object.keys(styleTo),
  };
}

function prepareAnimatedPairs(pairs) {
  const pairEntries = pairs.map((pair) => ({ pair, changes: getNodeAnimationChanges(pair.currentNode, pair.nextNode) }));
  const byId = new Map(pairEntries.map((entry) => [entry.pair.nextNode.dataset.fbNodeId, entry]));
  return pairEntries.filter((entry) => {
    if (!entry.changes.geometryChanged && !entry.changes.styleChanged && !entry.changes.needsCrossfade) return false;
    let ancestor = entry.pair.nextNode.parentElement?.closest('[data-fb-node-id]');
    while (ancestor) {
      const ancestorEntry = byId.get(ancestor.dataset.fbNodeId);
      if (ancestorEntry?.changes?.geometryChanged || ancestorEntry?.changes?.needsCrossfade) return false;
      ancestor = ancestor.parentElement?.closest('[data-fb-node-id]');
    }
    return true;
  });
}

function collectTopLevelUnmatchedNodes(variantNode, matchedIds) {
  if (!variantNode) return [];
  const allNodes = Array.from(variantNode.querySelectorAll('[data-fb-node-id]'));
  return allNodes.filter((node) => {
    const nodeId = node.dataset.fbNodeId;
    if (!nodeId || matchedIds.has(nodeId)) return false;
    let ancestor = node.parentElement?.closest('[data-fb-node-id]');
    while (ancestor) {
      const ancestorId = ancestor.dataset.fbNodeId;
      if (ancestorId && !matchedIds.has(ancestorId)) return false;
      ancestor = ancestor.parentElement?.closest('[data-fb-node-id]');
    }
    return true;
  });
}

function PreviewNode({ element, indexById, bpId = 'desktop' }) {
  const resolved = resolveElement(element, bpId);
  const styles = resolved?.styles ?? {};
  const widthMode = resolved?.widthMode ?? 'fixed';
  const heightMode = resolved?.heightMode ?? 'fixed';
  const width = resolved?.width ?? 0;
  const height = resolved?.height ?? 0;
  const widthPct = resolved?.widthPct ?? width;
  const heightPct = resolved?.heightPct ?? height;
  const isRelative = (resolved?.positionType ?? 'absolute') === 'relative';
  const backgroundImageUrl = getMediaUrl(styles?.backgroundImage);
  const backgroundColor = styles?.backgroundColor && !String(styles.backgroundColor).includes('gradient(')
    ? styles.backgroundColor
    : undefined;
  const backgroundImage = String(styles?.backgroundColor ?? '').includes('gradient(')
    ? styles.backgroundColor
    : (backgroundImageUrl ? `url(${backgroundImageUrl})` : undefined);

  const style = {
    position: isRelative ? 'relative' : 'absolute',
    left: isRelative ? undefined : resolved?.x ?? 0,
    top: isRelative ? undefined : resolved?.y ?? 0,
    width: widthMode === 'hug' ? 'fit-content' : widthMode === 'relative' ? `${widthPct}%` : width,
    height: heightMode === 'hug' ? 'fit-content' : heightMode === 'relative' ? `${heightPct}%` : height,
    minWidth: resolved?.minW ?? undefined,
    maxWidth: resolved?.maxW ?? undefined,
    minHeight: resolved?.minH ?? undefined,
    maxHeight: resolved?.maxH ?? undefined,
    transform: resolved?.rotation ? `rotate(${resolved.rotation}deg)` : undefined,
    backgroundColor,
    backgroundImage,
    backgroundSize: backgroundImage ? (styles?.backgroundSize ?? 'cover') : undefined,
    backgroundPosition: backgroundImage ? (styles?.backgroundPosition ?? 'center center') : undefined,
    backgroundRepeat: styles?.backgroundSize === 'repeat' ? 'repeat' : 'no-repeat',
    borderRadius: styles?.borderRadiusMode === 'independent'
      ? `${styles?.borderRadiusTL ?? styles?.borderRadius ?? 0}px ${styles?.borderRadiusTR ?? styles?.borderRadius ?? 0}px ${styles?.borderRadiusBR ?? styles?.borderRadius ?? 0}px ${styles?.borderRadiusBL ?? styles?.borderRadius ?? 0}px`
      : (typeof styles?.borderRadius === 'number' ? `${styles.borderRadius}px` : styles?.borderRadius),
    border: styles?.borderWidth > 0 ? `${styles.borderWidth}px ${styles.borderStyle || 'solid'} ${styles.borderColor || '#000'}` : undefined,
    opacity: resolved?.hidden ? 0 : styles?.opacity,
    overflow: styles?.overflow,
    boxShadow: styles?.boxShadow,
    display: styles?.display,
    flexDirection: styles?.flexDirection,
    flexWrap: styles?.flexWrap,
    gap: typeof styles?.gap === 'number' ? `${styles.gap}px` : styles?.gap,
    paddingTop: typeof styles?.paddingTop === 'number' ? `${styles.paddingTop}px` : styles?.paddingTop,
    paddingRight: typeof styles?.paddingRight === 'number' ? `${styles.paddingRight}px` : styles?.paddingRight,
    paddingBottom: typeof styles?.paddingBottom === 'number' ? `${styles.paddingBottom}px` : styles?.paddingBottom,
    paddingLeft: typeof styles?.paddingLeft === 'number' ? `${styles.paddingLeft}px` : styles?.paddingLeft,
    alignItems: styles?.alignItems,
    justifyContent: styles?.justifyContent,
    boxSizing: 'border-box',
    pointerEvents: resolved?.hidden ? 'none' : undefined,
  };

  const textStyle = element.type === 'text' ? {
    fontFamily: familyToFontStack(styles?.fontFamily ?? 'Inter'),
    fontWeight: styles?.fontWeight ?? 400,
    fontStyle: styles?.fontStyle ?? 'normal',
    fontSize: `${styles?.fontSize ?? 42}${styles?.fontSizeUnit ?? 'px'}`,
    lineHeight: `${styles?.lineHeight ?? 1.2}${styles?.lineHeightUnit ?? 'em'}`,
    letterSpacing: `${styles?.letterSpacing ?? 0}${styles?.letterSpacingUnit ?? 'em'}`,
    color: styles?.color ?? '#000',
    textAlign: styles?.textAlign ?? 'left',
    textDecoration: styles?.textDecoration ?? 'none',
    whiteSpace: widthMode === 'hug' && heightMode === 'hug' ? 'pre' : 'pre-wrap',
    wordBreak: 'break-word',
    width: '100%',
    display: 'block',
  } : null;

  return (
    <div className="fb-component-play-preview__node" data-fb-node-id={element.id} data-flip-id={element.id} style={style}>
      {element.type === 'image' && getMediaUrl(resolved?.src) ? (
        <img
          src={getMediaUrl(resolved?.src)}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: styles?.objectFit ?? 'cover', borderRadius: 'inherit' }}
          draggable={false}
        />
      ) : null}
      {element.type === 'text' ? (
        <div className="fb-component-play-preview__text" data-flip-id={`${element.id}__content`} style={textStyle}>{resolved?.text ?? 'Text'}</div>
      ) : null}
      {(element.children ?? []).map((childId) => {
        const child = indexById.get(childId);
        return child ? <PreviewNode key={child.id} element={child} indexById={indexById} bpId={bpId} /> : null;
      })}
    </div>
  );
}

export default function ComponentPlayPreview({ componentName, variants, initialVariantId, onClose }) {
  const defaultVariants = useMemo(() => (variants ?? []).filter(isDefaultVariant), [variants]);
  const initialBaseVariantId = useMemo(() => {
    const selected = (variants ?? []).find((variant) => variant.id === initialVariantId) ?? null;
    if (!selected) return defaultVariants[0]?.id ?? null;
    return isDefaultVariant(selected) ? selected.id : (selected.parentVariantId ?? defaultVariants[0]?.id ?? null);
  }, [defaultVariants, initialVariantId, variants]);
  const [activeVariantId, setActiveVariantId] = useState(initialBaseVariantId);
  const stageRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setActiveVariantId(initialBaseVariantId);
  }, [initialBaseVariantId]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const variantStates = useMemo(() => (variants ?? []).map((variant) => {
    const snapshot = composeVariantSnapshot(variants ?? [], variant.id);
    const root = getSnapshotRoot(snapshot);
    return {
      variant,
      root,
      indexById: new Map(snapshot.map((element) => [element.id, element])),
    };
  }).filter((entry) => entry.root), [variants]);

  const variantStateMap = useMemo(
    () => new Map(variantStates.map((entry) => [entry.variant.id, entry])),
    [variantStates],
  );

  const activeVariant = activeVariantId ? (variantStateMap.get(activeVariantId)?.variant ?? null) : null;
  const activeBaseVariantId = useMemo(() => getBaseVariantId(variants ?? [], activeVariantId), [activeVariantId, variants]);
  const activeBaseVariant = activeBaseVariantId ? (variantStateMap.get(activeBaseVariantId)?.variant ?? null) : null;
  const stageSize = useMemo(() => variantStates.reduce((acc, entry) => {
    const resolvedRoot = resolveElement(entry.root, 'desktop');
    return {
      width: Math.max(acc.width, resolvedRoot?.width ?? 320),
      height: Math.max(acc.height, resolvedRoot?.height ?? 220),
    };
  }, { width: 320, height: 220 }), [variantStates]);

  const switchVariant = useCallback((targetVariantId, interaction, options = {}) => {
    if (!targetVariantId || targetVariantId === activeVariantId) return;
    const stage = stageRef.current;
    const next = stage?.querySelector(`[data-variant-id="${targetVariantId}"]`);
    const current = stage?.querySelector('.fb-component-play-preview__variant.is-active');
    if (!stage || !next || next === current) {
      setActiveVariantId(targetVariantId);
      return;
    }

    const transition = normalizeTransition(interaction?.transition);
    const duration = getTransitionDurationMs(transition);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !duration || transition.type === 'instant') {
      gsap.killTweensOf(stage.querySelectorAll('.fb-component-play-preview__variant'));
      stage.querySelectorAll('.fb-component-play-preview__variant').forEach((node) => {
        node.classList.toggle('is-active', node === next);
        node.classList.remove('is-present');
        node.style.opacity = '';
        node.style.transform = '';
      });
      setActiveVariantId(targetVariantId);
      return;
    }

    gsap.killTweensOf(stage.querySelectorAll('.fb-component-play-preview__variant'));
    const finish = () => {
      stage.querySelectorAll('.fb-component-play-preview__variant').forEach((node) => {
        const isActive = node === next;
        node.classList.toggle('is-active', isActive);
        node.classList.remove('is-present');
        node.style.opacity = '';
        node.style.transform = '';
        node.style.visibility = '';
        node.style.pointerEvents = '';
      });
      setActiveVariantId(targetVariantId);
    };

    const currentFlipTargets = current.querySelectorAll('[data-flip-id]');
    const state = Flip.getState(currentFlipTargets, { props: FLIP_PROPS, simple: false });
    const totalDuration = getTransitionDurationMs(transition) / 1000;
    const ease = transition.type === 'realistic'
      ? (transition.springMode === 'physics'
        ? `elastic.out(1, ${Math.max(0.2, transition.mass * 0.45)})`
        : `back.out(${1 + transition.bounce * 1.2})`)
      : getTransitionEasing(transition);

    current.classList.remove('is-active');
    current.classList.add('is-present');
    next.classList.add('is-present');
    next.classList.add('is-active');
    next.style.visibility = 'visible';
    next.style.pointerEvents = 'none';
    current.style.pointerEvents = 'none';

    Flip.from(state, {
      targets: [...current.querySelectorAll('[data-flip-id]'), ...next.querySelectorAll('[data-flip-id]')],
      absolute: true,
      nested: true,
      scale: true,
      simple: false,
      props: FLIP_PROPS,
      duration: totalDuration,
      ease,
      onEnter: (elements) => gsap.fromTo(elements, { opacity: 0 }, {
        opacity: 1,
        duration: totalDuration,
        ease,
        clearProps: 'opacity',
      }),
      onLeave: (elements) => gsap.to(elements, {
        opacity: 0,
        duration: totalDuration,
        ease,
        clearProps: 'opacity',
      }),
      onComplete: finish,
    });
  }, [activeVariantId]);

  const applyVisualState = useCallback((mode) => {
    const baseVariantId = getBaseVariantId(variants ?? [], activeVariantId);
    if (!baseVariantId) return;
    const targetVariantId = mode
      ? (findStateVariant(variants ?? [], baseVariantId, mode)?.id ?? baseVariantId)
      : baseVariantId;
    if (!targetVariantId || targetVariantId === activeVariantId) return;
    switchVariant(targetVariantId, { transition: getStateTransition() }, { transient: true });
  }, [activeVariantId, switchVariant, variants]);

  const runInteraction = useCallback((expectedTrigger) => {
    const interaction = activeBaseVariant?.interaction;
    if (!interaction?.targetVariantId || interaction.trigger !== expectedTrigger) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const delay = Math.max(0, Number(interaction.delay) || 0) * 1000;
    timerRef.current = window.setTimeout(() => {
      switchVariant(interaction.targetVariantId, interaction);
    }, delay);
  }, [activeBaseVariant, switchVariant]);

  useEffect(() => {
    const interaction = activeBaseVariant?.interaction;
    if (!interaction?.targetVariantId || interaction.trigger !== 'appear') return undefined;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      switchVariant(interaction.targetVariantId, interaction);
    }, Math.max(0, Number(interaction.delay) || 0) * 1000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [activeBaseVariant, switchVariant]);

  if (!variantStates.length) return null;

  return (
    <div className="fb-component-play-preview" onMouseDown={onClose}>
      <div className="fb-component-play-preview__panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fb-component-play-preview__header">
          <div>
            <div className="fb-component-play-preview__eyebrow">Play Test</div>
            <div className="fb-component-play-preview__title">{componentName}</div>
          </div>
          <button type="button" className="fb-secondary-btn" onClick={onClose}>Close</button>
        </div>
        <div className="fb-component-play-preview__toolbar">
          {defaultVariants.map((variant) => (
            <button
              key={variant.id}
              type="button"
              className={`fb-component-play-preview__chip${variant.id === activeBaseVariantId ? ' fb-component-play-preview__chip--active' : ''}`}
              onClick={() => switchVariant(
                variant.id,
                activeBaseVariant?.interaction?.targetVariantId === variant.id
                  ? activeBaseVariant.interaction
                  : { transition: activeBaseVariant?.interaction?.transition ?? variant.interaction?.transition ?? null },
              )}
            >
              {variant.name}
            </button>
          ))}
        </div>
        <div className="fb-component-play-preview__stage-wrap">
          <div
            className="fb-component-play-preview__stage"
            onClick={() => runInteraction('click')}
            onPointerDown={() => {
              applyVisualState('pressed');
              runInteraction('click-start');
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.matches(':hover')) applyVisualState('hover');
              else applyVisualState(null);
            }}
            onPointerCancel={() => applyVisualState(null)}
            onMouseEnter={() => {
              applyVisualState('hover');
              runInteraction('mouse-enter');
            }}
            onMouseLeave={() => {
              applyVisualState(null);
              runInteraction('mouse-leave');
            }}
          >
            <div ref={stageRef} className="fb-component-play-preview__surface" style={stageSize}>
              {variantStates.map(({ variant, root, indexById }) => (
                <div
                  key={variant.id}
                  data-variant-id={variant.id}
                  className={`fb-component-play-preview__variant${variant.id === activeVariantId ? ' is-active' : ''}`}
                >
                  <PreviewNode element={root} indexById={indexById} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
