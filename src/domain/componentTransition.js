const COMPONENT_TRANSITION_TYPES = new Set(['instant', 'ease', 'realistic']);
const COMPONENT_EASE_PRESETS = new Set(['easeInOut', 'easeOut', 'easeIn', 'linear', 'custom']);

export function clampFinite(value, fallback, min = -Infinity, max = Infinity) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function normalizeComponentBezier(bezier) {
  return {
    x1: clampFinite(bezier?.x1, 0.44, 0, 1),
    y1: clampFinite(bezier?.y1, 0, 0, 1),
    x2: clampFinite(bezier?.x2, 0.56, 0, 1),
    y2: clampFinite(bezier?.y2, 1, 0, 1),
  };
}

export function normalizeViewportValue(viewport, fallback = { x: 80, y: 80, scale: 0.55 }) {
  return {
    x: clampFinite(viewport?.x, fallback?.x ?? 80, -100000, 100000),
    y: clampFinite(viewport?.y, fallback?.y ?? 80, -100000, 100000),
    scale: clampFinite(viewport?.scale, fallback?.scale ?? 0.55, 0.08, 8),
  };
}

export function normalizeComponentTransition(transition) {
  const type = COMPONENT_TRANSITION_TYPES.has(transition?.type) ? transition.type : 'instant';
  const easePreset = COMPONENT_EASE_PRESETS.has(transition?.easePreset) ? transition.easePreset : 'easeInOut';
  const springMode = transition?.springMode === 'physics' ? 'physics' : 'time';
  const duration = clampFinite(transition?.duration, 0.3, 0, 20);
  return {
    type,
    duration,
    easePreset,
    springMode,
    physicsDuration: clampFinite(transition?.physicsDuration, duration, 0, 20),
    bounce: clampFinite(transition?.bounce, 0.2, 0, 1),
    stiffness: clampFinite(transition?.stiffness, 500, 1, 2000),
    damping: clampFinite(transition?.damping, 24, 1, 300),
    mass: clampFinite(transition?.mass, 1, 0.1, 20),
    bezier: normalizeComponentBezier(transition?.bezier),
  };
}