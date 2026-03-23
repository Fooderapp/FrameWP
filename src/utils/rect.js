export function toViewportRect(source) {
  if (!source) return null;
  const rect = typeof source.getBoundingClientRect === 'function' ? source.getBoundingClientRect() : source;
  if (!rect) return null;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function resolveFloatingInspectorPosition({
  anchorRect,
  containerRect,
  modalWidth = 340,
  panelPadding = 12,
  anchorGap = 14,
  fallbackTop = 88,
} = {}) {
  const fallbackLeft = -modalWidth - anchorGap;
  if (!anchorRect || !containerRect) {
    return {
      position: 'absolute',
      top: fallbackTop,
      left: fallbackLeft,
    };
  }

  const containerWidth = Math.max(0, containerRect.width || 0);
  const containerHeight = Math.max(0, containerRect.height || 0);
  const anchorRight = anchorRect.right - containerRect.left;
  const anchorTop = anchorRect.top - containerRect.top;
  const alternateLeft = anchorRight + anchorGap;
  const maxLeft = Math.max(panelPadding, containerWidth - modalWidth - panelPadding);
  const canFloatLeft = (containerRect.left || 0) >= (modalWidth + anchorGap + panelPadding);
  const left = canFloatLeft
    ? fallbackLeft
    : Math.min(
      Math.max(panelPadding, alternateLeft),
      maxLeft,
    );
  const top = Math.min(
    Math.max(panelPadding, anchorTop - 10),
    Math.max(panelPadding, containerHeight - 140),
  );

  return {
    position: 'absolute',
    top,
    left,
  };
}