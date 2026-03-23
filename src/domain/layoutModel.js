const LAYOUT_NUMERIC_KEYS = new Set([
  'x', 'y', 'width', 'height', 'rotation', 'rotationX', 'rotationY',
  'minW', 'maxW', 'minH', 'maxH',
  'widthPct', 'heightPct', 'widthFr', 'heightFr',
]);

function normalizeConstraintAxisMode(mode, axis = 'horizontal') {
  const normalized = typeof mode === 'string' ? mode.toLowerCase().trim() : '';
  const supported = axis === 'horizontal'
    ? ['left', 'center', 'right', 'stretch', 'scale']
    : ['top', 'center', 'bottom', 'stretch', 'scale'];
  return supported.includes(normalized) ? normalized : (axis === 'horizontal' ? 'left' : 'top');
}

function getConstraintAxisMode(value, axis = 'horizontal') {
  const raw = value && typeof value === 'object' ? value : {};
  if (axis === 'horizontal') {
    if (raw.horizontal != null) return normalizeConstraintAxisMode(raw.horizontal, 'horizontal');
    if (raw.left && raw.right) return 'stretch';
    if (raw.right && !raw.left) return 'right';
    return 'left';
  }
  if (raw.vertical != null) return normalizeConstraintAxisMode(raw.vertical, 'vertical');
  if (raw.top && raw.bottom) return 'stretch';
  if (raw.bottom && !raw.top) return 'bottom';
  return 'top';
}

function getConstraintPins(horizontal, vertical) {
  return {
    left: horizontal === 'left' || horizontal === 'stretch',
    right: horizontal === 'right' || horizontal === 'stretch',
    top: vertical === 'top' || vertical === 'stretch',
    bottom: vertical === 'bottom' || vertical === 'stretch',
  };
}

export function normalizeConstraints(value, { allowStretch = true } = {}) {
  let horizontal = getConstraintAxisMode(value, 'horizontal');
  let vertical = getConstraintAxisMode(value, 'vertical');

  if (!allowStretch && horizontal === 'stretch') horizontal = 'left';
  if (!allowStretch && vertical === 'stretch') vertical = 'top';

  return {
    horizontal,
    vertical,
    ...getConstraintPins(horizontal, vertical),
  };
}

export function sanitizeLayoutUpdates(updates) {
  if (!updates || typeof updates !== 'object') return updates;

  return Object.fromEntries(
    Object.entries(updates).flatMap(([key, value]) => {
      if (key === 'constraints') return [[key, normalizeConstraints(value)]];
      if (!LAYOUT_NUMERIC_KEYS.has(key) || value == null) return [[key, value]];
      const numericValue = typeof value === 'number' ? value : parseFloat(value);
      return Number.isFinite(numericValue) ? [[key, numericValue]] : [];
    })
  );
}