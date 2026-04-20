import { getShapePresetKind } from './editorStore';

export const FB_ASSET_PAYLOAD_MIME = 'application/x-framebuilder-asset';
export const FB_ASSET_PAYLOAD_FALLBACK = 'fb-asset-payload';

const KNOWN_ELEMENT_TYPES = new Set(['frame', 'loop', 'text', 'icon', 'image', 'video', 'embed', 'scroll-sequence']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStyleProps(styleProps) {
  return isPlainObject(styleProps) ? { ...styleProps } : {};
}

function buildColorStyleUpdates(targetElement, value) {
  if (!targetElement || typeof value !== 'string' || !value.trim()) return null;
  if (targetElement.type === 'text') return { color: value };
  if (targetElement.type === 'icon') {
    return getShapePresetKind(targetElement) === 'line'
      ? { strokeColor: value }
      : { color: value };
  }
  // All container-like and form elements → backgroundColor (fill)
  if (KNOWN_ELEMENT_TYPES.has(targetElement.type) || FORM_ELEMENT_TYPES.has(targetElement.type)) {
    return { backgroundColor: value };
  }
  return null;
}

const FORM_ELEMENT_TYPES = new Set([
  'form', 'text-field', 'textarea-field', 'dropdown', 'checkbox',
  'radio-group', 'file-upload', 'submit-button', 'captcha',
]);

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

/**
 * Return asset binding entries for the style keys an asset would affect on this element.
 * Shape: { 'styles.color': { assetType, assetId }, … } or null.
 */
export function getAssetBindingsForElement(targetElement, payload) {
  if (!targetElement || !payload || typeof payload !== 'object') return null;
  const assetId = typeof payload.id === 'string' ? payload.id : '';
  if (!assetId) return null;

  if (payload.assetType === 'color') {
    const styleUpdates = buildColorStyleUpdates(targetElement, payload.value);
    if (!styleUpdates) return null;
    const bindings = {};
    Object.keys(styleUpdates).forEach(key => {
      bindings[`styles.${key}`] = { assetType: 'color', assetId };
    });
    return bindings;
  }

  if (payload.assetType === 'text-style') {
    if (targetElement.type !== 'text') return null;
    const styleProps = sanitizeStyleProps(payload.styleProps);
    if (!Object.keys(styleProps).length) return null;
    const bindings = {};
    Object.keys(styleProps).forEach(key => {
      bindings[`styles.${key}`] = { assetType: 'text-style', assetId };
    });
    return bindings;
  }

  if (payload.assetType === 'element-style') {
    const sourceType = typeof payload.styleType === 'string' ? payload.styleType : 'element';
    if (KNOWN_ELEMENT_TYPES.has(sourceType) && sourceType !== targetElement.type) return null;
    const styleProps = sanitizeStyleProps(payload.styleProps);
    if (!Object.keys(styleProps).length) return null;
    const bindings = {};
    Object.keys(styleProps).forEach(key => {
      bindings[`styles.${key}`] = { assetType: 'element-style', assetId };
    });
    return bindings;
  }

  return null;
}