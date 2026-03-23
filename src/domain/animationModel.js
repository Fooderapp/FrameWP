import { makeId } from '../utils/id.js';
import { clampFinite, normalizeComponentTransition } from './componentTransition.js';
import { sanitizeLayoutUpdates } from './layoutModel.js';

const ELEMENT_ANIMATION_TYPES = new Set(['enter', 'scroll', 'scroll-variant', 'loop', 'hover']);
const ELEMENT_ANIMATION_PLAYBACK = new Set(['once', 'replay']);
const LOOP_ANIMATION_TYPES = new Set(['loop', 'mirror']);
const LOOP_ANIMATION_OFFSCREEN = new Set(['play', 'pause']);

const ENTER_EFFECT_PRESETS = {
  fadeUp: { opacity: 0, scale: 1, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 40 },
  fadeIn: { opacity: 0, scale: 1, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 0 },
  scaleIn: { opacity: 0, scale: 0.92, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 0 },
  slideLeft: { opacity: 0, scale: 1, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: -48, offsetY: 0 },
};

export function makeDefaultElementAnimations() {
  return { desktop: [], tablet: null, mobile: null };
}

function normalizeAnimationTransition(transition, fallback = { type: 'ease', duration: 0.6, easePreset: 'easeInOut' }) {
  return normalizeComponentTransition({
    ...fallback,
    ...(transition ?? {}),
  });
}

function normalizeEnterEffect(effect, preset = 'fadeUp') {
  const presetValues = ENTER_EFFECT_PRESETS[preset] ?? ENTER_EFFECT_PRESETS.fadeUp;
  const rotateMode = effect?.rotateMode === '3d' ? '3d' : '2d';
  return {
    opacity: clampFinite(effect?.opacity, presetValues.opacity, 0, 1),
    scale: clampFinite(effect?.scale, presetValues.scale, 0.1, 4),
    rotateMode,
    rotate: clampFinite(effect?.rotate, presetValues.rotate, -1080, 1080),
    rotateX: clampFinite(effect?.rotateX, presetValues.rotateX, -1080, 1080),
    rotateY: clampFinite(effect?.rotateY, presetValues.rotateY, -1080, 1080),
    skewX: clampFinite(effect?.skewX, presetValues.skewX, -180, 180),
    skewY: clampFinite(effect?.skewY, presetValues.skewY, -180, 180),
    offsetX: clampFinite(effect?.offsetX, presetValues.offsetX, -4000, 4000),
    offsetY: clampFinite(effect?.offsetY, presetValues.offsetY, -4000, 4000),
  };
}

export function normalizeAnimationPatchState(state) {
  return {
    layout: sanitizeLayoutUpdates(state?.layout ?? {}) ?? {},
    styles: { ...(state?.styles ?? {}) },
  };
}

export function normalizeAnimationMarkerOffset(value) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return null;
  return Math.min(2, Math.max(-2, numericValue));
}

export function normalizeAnimationMarkerOffsetPx(value) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return null;
  return Math.min(20000, Math.max(-20000, numericValue));
}

function normalizeScrollVariantTargets(targets, legacyTargetVariantId = null, legacyMarker = 0.5) {
  const source = Array.isArray(targets) && targets.length
    ? targets
    : [{ targetVariantId: legacyTargetVariantId, marker: legacyMarker }];
  const normalized = source.map((target, index) => ({
    id: typeof target?.id === 'string' && target.id ? target.id : makeId('animtarget'),
    targetVariantId: typeof target?.targetVariantId === 'string' && target.targetVariantId ? target.targetVariantId : null,
    marker: clampFinite(target?.marker, index === 0 ? legacyMarker : Math.min(0.9, 0.35 + (index * 0.2)), 0, 1),
    markerOffset: normalizeAnimationMarkerOffset(target?.markerOffset),
    markerOffsetPx: normalizeAnimationMarkerOffsetPx(target?.markerOffsetPx),
  }));
  normalized.sort((left, right) => (left.marker ?? 0) - (right.marker ?? 0));
  return normalized;
}

function normalizeLoopEffect(effect) {
  return normalizeEnterEffect(effect, 'fadeUp');
}

function normalizeHoverEffect(effect) {
  return normalizeEnterEffect(effect, 'fadeUp');
}

export function normalizeElementAnimation(animation, index = 0) {
  const type = ELEMENT_ANIMATION_TYPES.has(animation?.type) ? animation.type : 'enter';
  const preset = typeof animation?.preset === 'string' && animation.preset
    ? animation.preset
    : (type === 'scroll-variant' || type === 'loop' || type === 'hover' ? 'custom' : 'fadeUp');
  const transitionFallback = type === 'scroll-variant'
    ? { type: 'ease', duration: 0.45, easePreset: 'easeInOut' }
    : (type === 'loop'
      ? { type: 'ease', duration: 1.2, easePreset: 'linear', bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } }
      : (type === 'hover'
        ? { type: 'ease', duration: 0.22, easePreset: 'easeInOut' }
        : { type: 'ease', duration: 0.7, easePreset: 'easeInOut' }));
  const base = {
    id: typeof animation?.id === 'string' && animation.id ? animation.id : makeId('anim'),
    type,
    name: typeof animation?.name === 'string' && animation.name.trim()
      ? animation.name.trim()
      : (type === 'enter'
        ? 'Appear'
        : (type === 'scroll'
          ? 'Scroll animation'
          : (type === 'loop'
            ? 'Loop animation'
            : (type === 'hover' ? 'Hover animation' : 'Scroll variant')))),
    preset,
    transition: normalizeAnimationTransition(animation?.transition, transitionFallback),
  };

  if (type === 'enter') {
    return {
      ...base,
      playback: ELEMENT_ANIMATION_PLAYBACK.has(animation?.playback) ? animation.playback : 'once',
      effect: normalizeEnterEffect(animation?.effect, preset),
      startState: normalizeAnimationPatchState(animation?.startState),
    };
  }

  if (type === 'scroll') {
    return {
      ...base,
      start: clampFinite(animation?.start, 0.2, 0, 1),
      end: clampFinite(animation?.end, 0.68, 0, 1),
      startOffset: normalizeAnimationMarkerOffset(animation?.startOffset),
      endOffset: normalizeAnimationMarkerOffset(animation?.endOffset),
      startOffsetPx: normalizeAnimationMarkerOffsetPx(animation?.startOffsetPx),
      endOffsetPx: normalizeAnimationMarkerOffsetPx(animation?.endOffsetPx),
      playback: ELEMENT_ANIMATION_PLAYBACK.has(animation?.playback) ? animation.playback : 'once',
      effect: normalizeEnterEffect(animation?.effect, preset),
      startState: normalizeAnimationPatchState(animation?.startState),
      endState: normalizeAnimationPatchState(animation?.endState),
    };
  }

  if (type === 'loop') {
    return {
      ...base,
      loopType: LOOP_ANIMATION_TYPES.has(animation?.loopType) ? animation.loopType : 'loop',
      offscreenBehavior: LOOP_ANIMATION_OFFSCREEN.has(animation?.offscreenBehavior) ? animation.offscreenBehavior : 'pause',
      delay: clampFinite(animation?.delay, 0, 0, 60),
      effect: normalizeLoopEffect(animation?.effect),
    };
  }

  if (type === 'hover') {
    return {
      ...base,
      effect: normalizeHoverEffect(animation?.effect),
    };
  }

  const targets = normalizeScrollVariantTargets(animation?.targets, animation?.targetVariantId, animation?.marker);
  return {
    ...base,
    marker: targets[0]?.marker ?? 0.5,
    targetVariantId: targets[0]?.targetVariantId ?? null,
    targets,
    playback: ELEMENT_ANIMATION_PLAYBACK.has(animation?.playback) ? animation.playback : 'once',
    order: clampFinite(animation?.order, index, 0, 999),
  };
}

function normalizeElementAnimationCollection(collection) {
  if (!Array.isArray(collection)) return [];
  return collection.map((entry, index) => normalizeElementAnimation(entry, index));
}

export function normalizeElementAnimations(animations) {
  const safe = animations && typeof animations === 'object' ? animations : {};
  return {
    desktop: normalizeElementAnimationCollection(safe.desktop),
    tablet: Array.isArray(safe.tablet) ? normalizeElementAnimationCollection(safe.tablet) : null,
    mobile: Array.isArray(safe.mobile) ? normalizeElementAnimationCollection(safe.mobile) : null,
  };
}

export function resolveElementAnimations(element, bpId) {
  const animations = normalizeElementAnimations(element?.animations);
  if (bpId === 'mobile') return animations.mobile ?? animations.tablet ?? animations.desktop;
  if (bpId === 'tablet') return animations.tablet ?? animations.desktop;
  return animations.desktop;
}

function getAnimationCollectionForWrite(element, bpId) {
  const animations = normalizeElementAnimations(element?.animations);
  if (bpId === 'desktop') return animations.desktop.slice();
  if (Array.isArray(animations?.[bpId])) return animations[bpId].slice();
  return resolveElementAnimations(element, bpId).slice();
}

export function updateElementAnimationCollection(element, bpId, updater) {
  const animations = normalizeElementAnimations(element?.animations);
  const current = getAnimationCollectionForWrite(element, bpId);
  const nextCollection = normalizeElementAnimationCollection(updater(current));
  return {
    ...element,
    animations: {
      ...animations,
      [bpId]: nextCollection,
    },
  };
}

export function updateAnimationEndState(entry, key, updates) {
  return normalizeElementAnimation({
    ...entry,
    endState: {
      ...entry?.endState,
      [key]: key === 'layout'
        ? { ...(entry?.endState?.layout ?? {}), ...(sanitizeLayoutUpdates(updates) ?? {}) }
        : { ...(entry?.endState?.styles ?? {}), ...(updates ?? {}) },
    },
  });
}

export function applyAnimationPreviewPatch(resolved, patch, options = {}) {
  if (!patch) return resolved;
  const nextLayout = { ...(patch.layout ?? {}) };
  const isFlowPositioned = options?.treatAsFlowPositioned === true
    || ['relative', 'sticky'].includes(resolved?.positionType ?? 'absolute');
  const hasAnimatedSizeOverride = Object.prototype.hasOwnProperty.call(nextLayout, 'width') || Object.prototype.hasOwnProperty.call(nextLayout, 'height');

  if (isFlowPositioned && hasAnimatedSizeOverride) {
    const baseX = typeof resolved?.x === 'number' ? resolved.x : (parseFloat(resolved?.x) || 0);
    const baseY = typeof resolved?.y === 'number' ? resolved.y : (parseFloat(resolved?.y) || 0);
    const baseWidth = typeof resolved?.width === 'number' ? resolved.width : (parseFloat(resolved?.width) || 0);
    const baseHeight = typeof resolved?.height === 'number' ? resolved.height : (parseFloat(resolved?.height) || 0);
    const nextWidth = Object.prototype.hasOwnProperty.call(nextLayout, 'width') ? (parseFloat(nextLayout.width) || 0) : baseWidth;
    const nextHeight = Object.prototype.hasOwnProperty.call(nextLayout, 'height') ? (parseFloat(nextLayout.height) || 0) : baseHeight;

    nextLayout.x = baseX + ((baseWidth - nextWidth) / 2);
    nextLayout.y = baseY + ((baseHeight - nextHeight) / 2);
  }

  return {
    ...resolved,
    ...nextLayout,
    styles: {
      ...(resolved?.styles ?? {}),
      ...(patch.styles ?? {}),
    },
  };
}

export function getAnimationEditorPreviewPatch(element, bpId, animationEditor) {
  if (!animationEditor || animationEditor.elementId !== element?.id || animationEditor.bpId !== bpId) return null;
  const entry = resolveElementAnimations(element, bpId).find((item) => item.id === animationEditor.animationId) ?? null;
  if (!entry) return null;
  if (animationEditor.mode === 'scroll-start' && entry.type === 'scroll') return entry?.startState ?? null;
  if (animationEditor.mode === 'scroll-effect' && entry.type === 'scroll') return entry?.endState ?? null;
  if (animationEditor.mode === 'enter-start' && entry.type === 'enter') return entry?.startState ?? null;
  return null;
}