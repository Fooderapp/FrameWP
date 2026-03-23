export const ARTBOARD_HEADER_HEIGHT = 36;

export function resolveArtboardGroupStyle(bp, scale, isComponentSurface) {
  return {
    left: bp.x,
    top: isComponentSurface ? bp.y : bp.y - ARTBOARD_HEADER_HEIGHT / scale,
  };
}

export function resolveArtboardSurfaceStyle(bp, background, isComponentSurface) {
  return {
    width: bp.width,
    height: bp.height,
    background: isComponentSurface ? 'transparent' : background,
  };
}

export function resolveArtboardHeaderStyle(bp) {
  return { width: bp.width };
}

export function resolveArtboardResizeHandleStyle(bp) {
  return { width: bp.width };
}