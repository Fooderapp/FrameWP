import { getShapePresetKind } from './editorStore';

export const FB_ASSET_PAYLOAD_MIME = 'application/x-framebuilder-asset';
export const FB_ASSET_PAYLOAD_FALLBACK = 'fb-asset-payload';

const KNOWN_ELEMENT_TYPES = new Set(['frame', 'text', 'icon', 'image', 'video', 'embed', 'scroll-sequence']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStyleProps(styleProps) {
  return isPlainObject(styleProps) ? { ...styleProps } : {};
}

function buildColorStyleUpdates(targetElement, value) {
  if (!targetElement || typeof value !== 'string' || !value.trim()) return null;
  if (targetElement.type === 'text') return { color: value };
  if (targetElement.type === 'frame') return { backgroundColor: value };
  if (targetElement.type === 'icon') {
    return getShapePresetKind(targetElement) === 'line'
      ? { strokeColor: value }
      : { color: value };
  }
  return null;
}

export function createAssetDragPayload(assetType, asset) {
  if (!assetType || !isPlainObject(asset)) return '';

  const basePayload = {
    kind: 'fb-asset',
    assetType,
    id: typeof asset.id === 'string' ? asset.id : '',
    name: typeof asset.name === 'string' ? asset.name : '',
  };

  if (assetType === 'color') {
    return JSON.stringify({
      ...basePayload,
      value: typeof asset.value === 'string' ? asset.value : '',
    });
  }

  if (assetType === 'text-style') {
    return JSON.stringify({
      ...basePayload,
      styleType: 'text',
      styleProps: sanitizeStyleProps(asset.styleProps),
    });
  }

  if (assetType === 'element-style') {
    return JSON.stringify({
      ...basePayload,
      styleType: typeof asset.type === 'string' ? asset.type : 'element',
      styleProps: sanitizeStyleProps(asset.styleProps),
    });
  }

  return '';
}

export function parseAssetDragPayload(dataTransfer) {
  if (!dataTransfer?.getData) return null;
  const rawPayload = dataTransfer.getData(FB_ASSET_PAYLOAD_MIME)
    || dataTransfer.getData(FB_ASSET_PAYLOAD_FALLBACK)
    || dataTransfer.getData('text/plain');
  if (!rawPayload) return null;

  try {
    const parsed = JSON.parse(rawPayload);
    if (parsed?.kind !== 'fb-asset') return null;
    if (!['color', 'text-style', 'element-style'].includes(parsed.assetType)) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

export function getAssetStyleUpdatesForElement(targetElement, payload) {
  if (!targetElement || !payload || typeof payload !== 'object') return null;

  if (payload.assetType === 'color') {
    return buildColorStyleUpdates(targetElement, payload.value);
  }

  if (payload.assetType === 'text-style') {
    if (targetElement.type !== 'text') return null;
    const styleProps = sanitizeStyleProps(payload.styleProps);
    return Object.keys(styleProps).length ? styleProps : null;
  }

  if (payload.assetType === 'element-style') {
    const sourceType = typeof payload.styleType === 'string' ? payload.styleType : 'element';
    if (KNOWN_ELEMENT_TYPES.has(sourceType) && sourceType !== targetElement.type) return null;
    const styleProps = sanitizeStyleProps(payload.styleProps);
    return Object.keys(styleProps).length ? styleProps : null;
  }

  return null;
}

export function canAssetApplyToElement(targetElement, payload) {
  return !!getAssetStyleUpdatesForElement(targetElement, payload);
}