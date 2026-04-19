import { gzip as gzipBytes } from 'pako';
import { create } from 'zustand';
import {
  getDefaultPackedIcon,
  getIconPresetMarkup,
  getSvgStrokeWidth,
  hasSvgVisibleStroke,
  removeSvgStroke,
  sanitizeSvgMarkup,
  setSvgStrokeWidth,
} from '../components/iconLibrary.js';
import { clearRichTextInlineStyle, plainTextToRichTextHtml, richTextHtmlToPlainText, sanitizeRichTextHtml } from '../components/richText.js';
import { makeId } from '../utils/id.js';
import { applyAnimationPreviewPatch, getAnimationEditorPreviewPatch, makeDefaultElementAnimations, normalizeAnimationMarkerOffsetPx, normalizeElementAnimation, normalizeElementAnimations, resolveElementAnimations, updateAnimationEndState, updateElementAnimationCollection } from '../domain/animationModel.js';
import { COMPONENT_VARIANT_STATE_ORDER, getBaseComponentVariantId, getComponentControlValue, getComponentVariantStateLabel, getDefaultComponentVariants, getPrimaryComponentVariant, insertStateVariant, insertVariantAfterFamily, isDefaultComponentVariant, normalizeComponentControl, normalizeComponentControls, normalizeComponentControlValue, normalizeComponentInstanceProps, normalizeComponentInteraction, resolveComponentVariantMode } from '../domain/componentModel.js';
import { applyVariantOverrides, composeVariantSnapshot, ensureComponentPrimaryRoot, extractVariantOverrides, getEditorVariantRoot, getLiveComponentEditorVariants as syncComponentEditorVariants, getSnapshotRoot, instantiateEditorVariantSnapshot, makeComponentPrimaryRoot } from '../domain/componentSnapshotModel.js';
import { clampFinite, normalizeComponentTransition, normalizeViewportValue } from '../domain/componentTransition.js';
import { createSubmissionNodeConfig, normalizeSubmissionFieldEntries } from '../domain/formSubmissionModel.js';
import { normalizeConstraints, sanitizeLayoutUpdates } from '../domain/layoutModel.js';
import { getDefaultFormConfig, getDefaultFormOptions, isFormContainerType, isFormFieldType } from '../domain/formModel.js';
import { getDefaultLoopConfig, isLoopElementType, normalizeLoopConfig } from '../domain/loopModel.js';
import { FORM_STYLE_DEFAULTS } from '../domain/formStyleModel.js';

export { applyAnimationPreviewPatch, getAnimationEditorPreviewPatch, resolveElementAnimations } from '../domain/animationModel.js';
export { getLiveComponentEditorVariants } from '../domain/componentSnapshotModel.js';

function getMediaUrl(value) {
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
  return typeof value === 'string' ? value.trim() : '';
}

// ── Pending asset upload tracking ────────────────────────────
let _pendingAssetUploads = [];

export function registerPendingAssetUpload(promise) {
  _pendingAssetUploads.push(promise);
  promise.finally(() => {
    _pendingAssetUploads = _pendingAssetUploads.filter(p => p !== promise);
  });
}

async function awaitPendingAssetUploads(timeoutMs = 15000) {
  if (!_pendingAssetUploads.length) return;
  const deadline = new Promise(resolve => setTimeout(resolve, timeoutMs));
  await Promise.race([Promise.allSettled([..._pendingAssetUploads]), deadline]);
}

function isDataUri(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

function stripEmbeddedDataUris(value) {
  if (typeof value !== 'string') return value;
  if (isDataUri(value)) return '';

  let next = value;
  next = next.replace(/url\((['"]?)data:[^)\s'"]+\1\)/gi, '');
  next = next.replace(/(['"])data:[^'"\s<>]+\1/gi, '$1$1');
  next = next.replace(/\b(?:href|xlink:href|src)=(["'])data:[^"']*\1/gi, '');
  next = next.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s_-]+/gi, '');
  return next;
}

function deepStripDataUris(value) {
  if (Array.isArray(value)) return value.map(deepStripDataUris);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, deepStripDataUris(entryValue)])
    );
  }
  return stripEmbeddedDataUris(value);
}

function stripDataUrisFromElement(element) {
  if (!element || typeof element !== 'object') return element;
  let next = element;
  let changed = false;

  if (isDataUri(next.base?.src)) {
    next = { ...next, base: { ...next.base, src: '' } };
    changed = true;
  }
  if (isDataUri(next.base?.styles?.backgroundImage)) {
    if (!changed) next = { ...next };
    next.base = { ...next.base, styles: { ...next.base.styles, backgroundImage: '' } };
    changed = true;
  }

  if (next.overrides && typeof next.overrides === 'object') {
    let ovChanged = false;
    const nextOv = { ...next.overrides };
    for (const bp of Object.keys(nextOv)) {
      const ov = nextOv[bp];
      if (isDataUri(ov?.styles?.backgroundImage)) {
        nextOv[bp] = { ...ov, styles: { ...ov.styles, backgroundImage: '' } };
        ovChanged = true;
      }
      if (isDataUri(ov?.src)) {
        nextOv[bp] = { ...(nextOv[bp] || ov), src: '' };
        ovChanged = true;
      }
    }
    if (ovChanged) {
      if (!changed) next = { ...next };
      next.overrides = nextOv;
    }
  }
  return next;
}

function stripDataUrisFromElements(elements) {
  if (!Array.isArray(elements)) return elements;
  return elements.map((element) => deepStripDataUris(stripDataUrisFromElement(element)));
}

function uint8ArrayToBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: 'application/gzip' }));
  });
}

function gzipJsonPayload(data) {
  try {
    return gzipBytes(JSON.stringify(data));
  } catch {
    return null;
  }
}

async function compressJsonPayload(data) {
  try {
    const compressedBytes = gzipJsonPayload(data);
    if (!compressedBytes) return null;
    return await uint8ArrayToBase64(compressedBytes);
  } catch {
    return null;
  }
}

export const ASSET_STORAGE_COMPONENT_ID = '__fb_asset_storage__';

export function isAssetStorageComponentId(componentId) {
  return componentId === ASSET_STORAGE_COMPONENT_ID;
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

const ELEMENT_STYLE_CLIPBOARD_KEY = 'fb:element-style-clipboard';
const ELEMENT_CLIPBOARD_KEY = 'fb:element-clipboard';

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (obj && key in obj) acc[key] = obj[key];
    return acc;
  }, {});
}

export function readStoredElementStyleClipboard() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ELEMENT_STYLE_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.styles || typeof parsed.styles !== 'object') return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

export function readStoredElementClipboard() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ELEMENT_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.subtree) || !parsed.rootId) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

export function writeStoredElementStyleClipboard(payload) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(ELEMENT_STYLE_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch (error) {
    return;
  }
}

export function writeStoredElementClipboard(payload) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!payload || !Array.isArray(payload.subtree) || !payload.rootId) {
      window.localStorage.removeItem(ELEMENT_CLIPBOARD_KEY);
      return;
    }
    window.localStorage.setItem(ELEMENT_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch (error) {
    return;
  }
}

export function copyElementStylesToStoredClipboard(elementId, bpId = 'desktop') {
  if (!elementId) return null;
  const state = useEditorStore.getState();
  const element = state.getAllElements().find((entry) => entry.id === elementId) ?? null;
  if (!element) return null;
  const payload = {
    sourceElementId: elementId,
    sourceElementType: element.type ?? null,
    sourceBpId: bpId || 'desktop',
    styles: deepClone(resolveElement(element, bpId || 'desktop')?.styles ?? {}),
  };
  writeStoredElementStyleClipboard(payload);
  return payload;
}

export function pasteStoredElementStylesToElement(elementId, bpId = 'desktop') {
  if (!elementId) return false;
  const payload = readStoredElementStyleClipboard();
  if (!payload?.styles || typeof payload.styles !== 'object') return false;
  const state = useEditorStore.getState();
  const element = state.getAllElements().find((entry) => entry.id === elementId) ?? null;
  if (!element) return false;
  state.updateElementStyles(elementId, bpId || 'desktop', deepClone(payload.styles));
  return true;
}

function getAjaxUrl() {
  if (window.fbData?.ajaxUrl) return window.fbData.ajaxUrl;
  if (window.fbData?.adminUrl) return `${window.fbData.adminUrl.replace(/\/?$/, '/')}admin-ajax.php`;
  return '/wp-admin/admin-ajax.php';
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      const parseError = new Error(`Unexpected response from ${url}`);
      parseError.status = response.status;
      parseError.responseText = text;
      throw parseError;
    }
  }

  if (!response.ok) {
    const requestError = new Error(data?.message || response.statusText || 'Request failed');
    requestError.status = response.status;
    requestError.data = data;
    throw requestError;
  }

  return data ?? {};
}

function appendAjaxField(formData, key, value) {
  if (value == null) return;
  if (typeof value === 'object') {
    formData.append(key, JSON.stringify(value));
    return;
  }
  formData.append(key, `${value}`);
}

function isLikelySafariBrowser() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = `${navigator.userAgent || ''}`;
  return /Safari/i.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)/i.test(userAgent);
}

async function postMultipartAjaxAction(ajaxAction, fields = {}, files = {}) {
  const formData = new FormData();
  formData.append('action', ajaxAction);

  Object.entries(fields).forEach(([key, value]) => appendAjaxField(formData, key, value));
  Object.entries(files).forEach(([key, fileSpec]) => {
    if (!fileSpec?.blob) return;
    formData.append(key, fileSpec.blob, fileSpec.filename || 'upload.bin');
  });

  return requestJson(getAjaxUrl(), {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  });
}

async function requestWordPressEndpoint(restPath, ajaxAction, options = {}) {
  const { method = 'GET', body = null } = options;
  const nonce = window.fbData?.nonce;
  const restUrl = new URL(`${window.fbData?.restUrl || ''}${restPath}`, window.location.origin);

  if (method === 'GET' && body && typeof body === 'object') {
    Object.entries(body).forEach(([key, value]) => {
      if (value == null) return;
      restUrl.searchParams.set(key, `${value}`);
    });
  }
  restUrl.searchParams.set('_wpnonce', nonce || '');

  try {
    return await requestJson(restUrl.toString(), {
      method,
      credentials: 'same-origin',
      headers: method === 'GET'
        ? { 'X-WP-Nonce': nonce || '' }
        : { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce || '' },
      ...(method === 'GET' || !body ? {} : { body: JSON.stringify(body) }),
    });
  } catch (restError) {
    const formData = new FormData();
    formData.append('action', ajaxAction);
    formData.append('_wpnonce', nonce || '');
    if (body && typeof body === 'object') {
      Object.entries(body).forEach(([key, value]) => appendAjaxField(formData, key, value));
    }

    return requestJson(getAjaxUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
  }
}

async function postWordPressAction(restPath, ajaxAction, body) {
  return requestWordPressEndpoint(restPath, ajaxAction, { method: 'POST', body });
}

function getDefaultDocumentLock() {
  return {
    status: 'idle',
    isOwner: false,
    isLockedByOther: false,
    holder: null,
    expiresAt: null,
    lastUpdatedAt: 0,
    error: null,
  };
}

function normalizeDocumentLockPayload(payload) {
  const lock = payload?.lock && typeof payload.lock === 'object' ? payload.lock : {};
  const state = typeof lock.state === 'string' ? lock.state : 'available';
  const holder = lock.holder && typeof lock.holder === 'object'
    ? {
        id: Number.isFinite(Number(lock.holder.id)) ? Number(lock.holder.id) : null,
        displayName: typeof lock.holder.displayName === 'string' ? lock.holder.displayName : '',
        avatarUrl: typeof lock.holder.avatarUrl === 'string' ? lock.holder.avatarUrl : '',
      }
    : null;
  const expiresAt = Number.isFinite(Number(lock.expiresAt)) ? Number(lock.expiresAt) : null;

  return {
    status: state,
    isOwner: lock.ownedByCurrentUser === true || state === 'owned',
    isLockedByOther: lock.lockedByOther === true || state === 'locked',
    holder,
    expiresAt,
    lastUpdatedAt: Date.now(),
    error: null,
  };
}

function releaseDocumentLockWithBeacon(postId) {
  if (!postId || !window.fbData?.nonce) return;
  const formData = new FormData();
  formData.append('action', 'framebuilder_release_document_lock');
  formData.append('_wpnonce', window.fbData.nonce);
  formData.append('post_id', `${postId}`);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(getAjaxUrl(), formData);
    return;
  }

  fetch(getAjaxUrl(), {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    body: formData,
  }).catch(() => {});
}

const VARIABLE_TYPES = new Set(['string', 'boolean', 'color', 'number', 'image', 'post', 'product']);
const VARIABLE_SCOPES = new Set(['page', 'global']);
const VARIABLE_BINDING_SCOPES = new Set(['page', 'global', 'loop-item']);
const VARIABLE_BINDING_BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
const VARIABLE_PROPERTY_COMPATIBILITY = {
  text: ['string', 'number'],
  hidden: ['boolean'],
  linkUrl: ['string'],
  'styles.backgroundColor': ['color'],
  'styles.backgroundImage': ['image'],
  'styles.color': ['color'],
  'styles.zIndex': ['number'],
  'styles.fontFamily': ['string'],
  src: ['image'],
};

function normalizeElementConstraints(element) {
  if (!element || typeof element !== 'object') return element;
  const nextBase = {
    ...(element.base ?? {}),
    constraints: normalizeConstraints(element.base?.constraints),
  };
  const nextOverrides = { ...(element.overrides ?? {}) };
  ['tablet', 'mobile'].forEach((bpId) => {
    const override = nextOverrides[bpId];
    if (!override || typeof override !== 'object' || override.constraints == null) return;
    nextOverrides[bpId] = {
      ...override,
      constraints: normalizeConstraints(override.constraints),
    };
  });
  return {
    ...element,
    base: nextBase,
    overrides: nextOverrides,
  };
}

function syncElementLockedFlag(element) {
  if (!element || typeof element !== 'object') return element;
  const locked = !!(element.base?.locked ?? element.locked ?? false);
  return {
    ...element,
    locked,
    base: {
      ...(element.base ?? {}),
      locked,
    },
  };
}

function normalizeRootFlowInsertion(element, bpId, currentPage) {
  if (!element || element.parentId) return element;
  const pageLayout = resolvePageLayout(currentPage?.layout, bpId);
  const shouldFlowAtRoot = pageLayout !== null
    && (element.base?.positionType == null || element.base.positionType === 'absolute')
    && !element.base?.absoluteInLayout;

  if (!shouldFlowAtRoot) return element;

  const nextElement = {
    ...element,
    base: {
      ...element.base,
      positionType: 'relative',
      absoluteInLayout: false,
    },
  };

  if (bpId === 'desktop') return nextElement;

  return {
    ...nextElement,
    overrides: {
      ...nextElement.overrides,
      [bpId]: {
        ...(nextElement.overrides?.[bpId] ?? {}),
        positionType: 'relative',
        absoluteInLayout: false,
      },
    },
  };
}

function applyElementLayoutUpdate(elements, elementId, bpId, safeUpdates) {
  return elements.map((el) => {
    if (el.id !== elementId) return el;
    const syncedName = typeof safeUpdates?.name === 'string' ? safeUpdates.name : null;
    if (bpId === 'desktop') {
      if (el.type === 'text') {
        return syncElementLockedFlag(pruneElementBreakpointOverrides({
          ...el,
          ...(syncedName != null ? { name: syncedName } : {}),
          base: {
            ...el.base,
            ...safeUpdates,
            ...normalizeTextFields({ ...el.base, ...safeUpdates }),
          },
        }));
      }
      return syncElementLockedFlag(pruneElementBreakpointOverrides({
        ...el,
        ...(syncedName != null ? { name: syncedName } : {}),
        base: { ...el.base, ...safeUpdates },
      }));
    }
    const ov = el.overrides?.[bpId] ?? {};
    if (el.type === 'text') {
      const hasExplicitTextUpdate = safeUpdates.text != null || safeUpdates.richTextHtml != null;
      const hasExistingExplicitText = ov.text != null || ov.richTextHtml != null;
      const nextOverride = {
        ...ov,
        ...safeUpdates,
      };

      if (hasExplicitTextUpdate || hasExistingExplicitText) {
        Object.assign(nextOverride, normalizeTextFields({
          ...el.base,
          ...ov,
          ...safeUpdates,
        }));
      }

      return syncElementLockedFlag(pruneElementBreakpointOverrides({
        ...el,
        overrides: {
          ...el.overrides,
          [bpId]: nextOverride,
        },
      }));
    }
    return syncElementLockedFlag(pruneElementBreakpointOverrides({ ...el, overrides: { ...el.overrides, [bpId]: { ...ov, ...safeUpdates } } }));
  });
}

function getDefaultVariableValue(type) {
  switch (type) {
    case 'boolean': return false;
    case 'color': return '#000000';
    case 'image': return '';
    case 'number': return 0;
    case 'post':
    case 'product':
      return null;
    case 'string':
    default:
      return '';
  }
}

function normalizeVariableValue(type, value) {
  switch (type) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off' || normalized === '') return false;
      }
      if (typeof value === 'number') return value !== 0;
      return !!value;
    case 'color':
      return typeof value === 'string' && value ? value : '#000000';
    case 'image':
      return getMediaUrl(value);
    case 'number': {
      const parsed = typeof value === 'number' ? value : parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'post':
    case 'product':
      if (!value || typeof value !== 'object') return null;
      return {
        id: typeof value.id === 'number' ? value.id : parseInt(value.id, 10) || 0,
        title: typeof value.title === 'string' ? value.title : '',
        url: typeof value.url === 'string' ? value.url : '',
        postType: typeof value.postType === 'string' ? value.postType : (type === 'product' ? 'product' : 'post'),
      };
    case 'string':
    default:
      return typeof value === 'string' ? value : `${value ?? ''}`;
  }
}

function normalizeVariableDefinition(variable, scope = 'page') {
  const normalizedScope = VARIABLE_BINDING_SCOPES.has(variable?.scope) ? variable.scope : scope;
  const type = VARIABLE_TYPES.has(variable?.type) ? variable.type : 'string';
  const name = typeof variable?.name === 'string' && variable.name.trim()
    ? variable.name.trim()
    : 'Variable';
  const category = typeof variable?.category === 'string' && variable.category.trim()
    ? variable.category.trim()
    : 'General';
  return {
    id: typeof variable?.id === 'string' && variable.id ? variable.id : makeId('var'),
    scope: normalizedScope,
    type,
    name,
    category,
    persistent: !!variable?.persistent,
    value: normalizeVariableValue(type, variable?.value ?? getDefaultVariableValue(type)),
  };
}

function normalizeVariableList(variables, scope = 'page') {
  if (!Array.isArray(variables)) return [];
  return variables.map((variable) => normalizeVariableDefinition(variable, scope));
}

function normalizeBindingDefinition(binding) {
  if (!binding || typeof binding !== 'object') return null;
  const scope = VARIABLE_BINDING_SCOPES.has(binding.scope) ? binding.scope : 'page';
  const variableId = typeof binding.variableId === 'string' && binding.variableId ? binding.variableId : null;
  if (!variableId) return null;
  return {
    scope,
    variableId,
  };
}

function normalizeElementBindings(bindings) {
  const normalized = { desktop: {}, tablet: {}, mobile: {} };
  VARIABLE_BINDING_BREAKPOINTS.forEach((bpId) => {
    const bpBindings = bindings?.[bpId];
    if (!bpBindings || typeof bpBindings !== 'object') return;
    Object.entries(bpBindings).forEach(([propertyKey, binding]) => {
      const normalizedBinding = normalizeBindingDefinition(binding);
      if (!normalizedBinding) return;
      normalized[bpId][propertyKey] = normalizedBinding;
    });
  });
  return normalized;
}

function resolveElementBinding(bindings, bpId, propertyKey) {
  const normalized = normalizeElementBindings(bindings);
  if (bpId === 'mobile') return normalized.mobile[propertyKey] ?? normalized.tablet[propertyKey] ?? normalized.desktop[propertyKey] ?? null;
  if (bpId === 'tablet') return normalized.tablet[propertyKey] ?? normalized.desktop[propertyKey] ?? null;
  return normalized.desktop[propertyKey] ?? null;
}

function normalizeElementInteraction(interaction) {
  if (!interaction || typeof interaction !== 'object') return null;
  const type = interaction.type === 'set-variable' ? 'set-variable' : (interaction.type === 'navigate' ? 'navigate' : null);
  if (!type) return null;
  if (type === 'navigate') {
    const destinationSource = interaction.destinationSource === 'variable' ? 'variable' : 'page';
    if (destinationSource === 'variable') {
      const variableId = typeof interaction.variableId === 'string' && interaction.variableId ? interaction.variableId : '';
      if (!variableId) return null;
      return {
        id: typeof interaction.id === 'string' && interaction.id ? interaction.id : makeId('int'),
        type,
        destinationSource,
        variableScope: VARIABLE_BINDING_SCOPES.has(interaction.variableScope) ? interaction.variableScope : 'page',
        variableId,
        variableType: VARIABLE_TYPES.has(interaction.variableType) ? interaction.variableType : 'string',
        autoLoopNavigate: interaction.autoLoopNavigate === true,
      };
    }
    const pageUrl = typeof interaction.pageUrl === 'string' ? interaction.pageUrl : '';
    if (!pageUrl) return null;
    return {
      id: typeof interaction.id === 'string' && interaction.id ? interaction.id : makeId('int'),
      type,
      destinationSource,
      pageId: typeof interaction.pageId === 'number' ? interaction.pageId : parseInt(interaction.pageId, 10) || 0,
      pageTitle: typeof interaction.pageTitle === 'string' ? interaction.pageTitle : '',
      pageUrl,
      autoLoopNavigate: interaction.autoLoopNavigate === true,
    };
  }

  const variableId = typeof interaction.variableId === 'string' && interaction.variableId ? interaction.variableId : '';
  const variableScope = VARIABLE_SCOPES.has(interaction.variableScope) ? interaction.variableScope : 'page';
  const variableType = VARIABLE_TYPES.has(interaction.variableType) ? interaction.variableType : 'string';
  if (!variableId) return null;
  return {
    id: typeof interaction.id === 'string' && interaction.id ? interaction.id : makeId('int'),
    type,
    variableId,
    variableScope,
    variableType,
    operation: typeof interaction.operation === 'string' ? interaction.operation : 'set',
    value: normalizeVariableValue(variableType, interaction.value ?? getDefaultVariableValue(variableType)),
  };
}

function normalizeElementInteractions(interactions) {
  if (!Array.isArray(interactions)) return [];
  return interactions.map(normalizeElementInteraction).filter(Boolean);
}

const FLOW_TRIGGER_TYPES = new Set(['element-click', 'page-load', 'form-submit', 'custom']);
const FLOW_NODE_TYPES = new Set([
  'trigger',
  'submission-form',
  'condition',
  'navigate',
  'set-variable',
  'delay',
  'end',
]);

function getDefaultFlowName(flow) {
  if (typeof flow?.name === 'string' && flow.name.trim()) return flow.name.trim();
  return 'Untitled Flow';
}

function normalizeFlowTrigger(trigger) {
  const type = FLOW_TRIGGER_TYPES.has(trigger?.type) ? trigger.type : 'custom';
  return {
    type,
    elementId: typeof trigger?.elementId === 'string' && trigger.elementId ? trigger.elementId : '',
    event: typeof trigger?.event === 'string' && trigger.event ? trigger.event : (type === 'element-click' ? 'click' : ''),
    formId: typeof trigger?.formId === 'string' && trigger.formId ? trigger.formId : '',
  };
}

function normalizeFlowNode(node) {
  if (!node || typeof node !== 'object') return null;
  const type = FLOW_NODE_TYPES.has(node.type) ? node.type : null;
  if (!type) return null;
  const position = node.position && typeof node.position === 'object' ? node.position : {};
  return {
    id: typeof node.id === 'string' && node.id ? node.id : makeId('flow-node'),
    type,
    label: typeof node.label === 'string' && node.label.trim() ? node.label.trim() : type,
    position: {
      x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0,
      y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
    },
    config: node.config && typeof node.config === 'object' ? deepClone(node.config) : {},
  };
}

function normalizeFlowEdge(edge, nodeIds) {
  if (!edge || typeof edge !== 'object') return null;
  const source = typeof edge.source === 'string' ? edge.source : '';
  const target = typeof edge.target === 'string' ? edge.target : '';
  if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return null;
  return {
    id: typeof edge.id === 'string' && edge.id ? edge.id : makeId('flow-edge'),
    source,
    target,
    sourcePort: typeof edge.sourcePort === 'string' && edge.sourcePort ? edge.sourcePort : 'next',
    targetPort: typeof edge.targetPort === 'string' && edge.targetPort ? edge.targetPort : 'in',
  };
}

function normalizePageFlow(flow) {
  if (!flow || typeof flow !== 'object') return null;
  const nodes = Array.isArray(flow.nodes) ? flow.nodes.map(normalizeFlowNode).filter(Boolean) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    id: typeof flow.id === 'string' && flow.id ? flow.id : makeId('flow'),
    name: getDefaultFlowName(flow),
    trigger: normalizeFlowTrigger(flow.trigger),
    nodes,
    edges: Array.isArray(flow.edges) ? flow.edges.map((edge) => normalizeFlowEdge(edge, nodeIds)).filter(Boolean) : [],
    legacySourceElementId: typeof flow.legacySourceElementId === 'string' && flow.legacySourceElementId ? flow.legacySourceElementId : '',
    isLegacyProxy: flow.isLegacyProxy === true,
  };
}

function normalizePageFlowList(flows) {
  if (!Array.isArray(flows)) return [];
  return flows.map(normalizePageFlow).filter(Boolean);
}

function buildLegacyFlowFromElement(element) {
  const interactions = normalizeElementInteractions(element?.interactions);
  if (!element?.id || !interactions.length) return null;

  const triggerNodeId = `flow-node-trigger-${element.id}`;
  const nodes = [{
    id: triggerNodeId,
    type: 'trigger',
    label: 'Trigger',
    position: { x: 0, y: 0 },
    config: { triggerType: 'element-click', elementId: element.id, event: 'click' },
  }];
  const edges = [];
  let previousNodeId = triggerNodeId;

  interactions.forEach((interaction, index) => {
    const nodeId = `flow-node-${element.id}-${index + 1}`;
    nodes.push({
      id: nodeId,
      type: interaction.type,
      label: interaction.type === 'navigate' ? 'Navigate' : 'Set Variable',
      position: { x: 240 * (index + 1), y: 0 },
      config: { ...deepClone(interaction) },
    });
    edges.push({
      id: `flow-edge-${element.id}-${index + 1}`,
      source: previousNodeId,
      target: nodeId,
      sourcePort: 'next',
      targetPort: 'in',
    });
    previousNodeId = nodeId;
  });

  return normalizePageFlow({
    id: `legacy-flow-${element.id}`,
    name: `${element.name || 'Element'} click flow`,
    trigger: { type: 'element-click', elementId: element.id, event: 'click' },
    nodes,
    edges,
    legacySourceElementId: element.id,
    isLegacyProxy: true,
  });
}

function getLegacyElementFlowsForPage(page) {
  const elements = Array.isArray(page?.elements) ? page.elements : [];
  return elements.map(buildLegacyFlowFromElement).filter(Boolean);
}

function flowHasSubmissionFormNode(flow) {
  return Array.isArray(flow?.nodes) && flow.nodes.some((node) => node?.type === 'submission-form');
}

function getFirstSubmissionFormNode(flow) {
  return Array.isArray(flow?.nodes) ? flow.nodes.find((node) => node?.type === 'submission-form') || null : null;
}

function getFormRelatedElementIds(elements, formId) {
  const normalizedElements = Array.isArray(elements) ? elements : [];
  const childIdsByParent = new Map();
  let formExists = false;

  normalizedElements.forEach((element) => {
    if (!element || typeof element !== 'object' || !element.id) return;
    const elementId = `${element.id}`;
    if (elementId === formId && isFormContainerType(element.type)) formExists = true;
    const parentId = typeof element.parentId === 'string' ? element.parentId : '';
    if (!parentId) return;
    const existing = childIdsByParent.get(parentId) ?? [];
    existing.push(elementId);
    childIdsByParent.set(parentId, existing);
  });

  if (!formExists) return new Set([formId]);

  const relatedIds = new Set([formId]);
  const queue = [formId];
  while (queue.length) {
    const currentId = queue.shift();
    (childIdsByParent.get(currentId) ?? []).forEach((childId) => {
      if (relatedIds.has(childId)) return;
      relatedIds.add(childId);
      queue.push(childId);
    });
  }

  return relatedIds;
}

function getFormFieldValueType(type) {
  if (type === 'checkbox') return 'boolean';
  if (type === 'file-upload') return 'image';
  return 'string';
}

function normalizeFormFieldNameForSubmission(element) {
  const base = element?.base && typeof element.base === 'object' ? element.base : {};
  return `${base.fieldName || element?.name || element?.id || ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || `field_${element?.id || 'field'}`;
}

function buildSubmissionFieldEntries(elements, formId) {
  const normalizedElements = Array.isArray(elements) ? elements : [];
  const byId = new Map(normalizedElements.map((element) => [element.id, element]));
  const formElement = byId.get(formId) ?? null;
  if (!formElement) return [];
  const childIds = Array.isArray(formElement.children) ? formElement.children : [];
  const ordered = childIds
    .map((childId) => byId.get(childId) || null)
    .filter((element) => element && isFormFieldType(element.type));
  const fallback = normalizedElements.filter((element) => element?.parentId === formId && isFormFieldType(element.type));
  const fields = ordered.length ? ordered : fallback;
  return fields.map((field) => {
    const fieldName = normalizeFormFieldNameForSubmission(field);
    return {
      id: field.id,
      fieldName,
      label: `${field?.base?.label || field?.name || 'Field'}`.trim() || 'Field',
      type: field.type,
      valueType: getFormFieldValueType(field.type),
      path: `submission.values.${fieldName}`,
    };
  });
}

function createFormTriggerNode(formId, existingNode = null) {
  const position = existingNode?.position && typeof existingNode.position === 'object' ? existingNode.position : { x: 0, y: 0 };
  return {
    id: typeof existingNode?.id === 'string' && existingNode.id ? existingNode.id : makeId('flow-node'),
    type: 'trigger',
    label: typeof existingNode?.label === 'string' && existingNode.label.trim() ? existingNode.label.trim() : 'Trigger',
    position: {
      x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0,
      y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
    },
    config: {
      triggerType: 'form-submit',
      formId,
    },
  };
}

function createCanonicalSubmissionNode(existingNode, elements, formId) {
  const normalizedFields = normalizeSubmissionFieldEntries(existingNode?.config?.fields);
  const fields = normalizedFields.length ? normalizedFields : buildSubmissionFieldEntries(elements, formId);
  const position = existingNode?.position && typeof existingNode.position === 'object' ? existingNode.position : { x: 240, y: 0 };
  return {
    id: typeof existingNode?.id === 'string' && existingNode.id ? existingNode.id : makeId('flow-node'),
    type: 'submission-form',
    label: typeof existingNode?.label === 'string' && existingNode.label.trim() ? existingNode.label.trim() : 'Submission Form',
    position: {
      x: Number.isFinite(Number(position.x)) ? Number(position.x) : 240,
      y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
    },
    config: createSubmissionNodeConfig(fields, existingNode?.config?.actions),
  };
}

function findPreferredFormSubmissionFlow(flows, formId, relatedIds, preferredFlowId = '') {
  const exactFlows = flows.filter((flow) => flow?.trigger?.type === 'form-submit' && flow.trigger?.formId === formId);
  const legacyFlows = flows.filter((flow) => (
    flowHasSubmissionFormNode(flow)
      && flow?.trigger?.type === 'element-click'
      && relatedIds.has(flow.trigger?.elementId)
  ));

  return exactFlows.find((flow) => flow.id === preferredFlowId)
    || exactFlows.find((flow) => flowHasSubmissionFormNode(flow))
    || exactFlows[0]
    || legacyFlows.find((flow) => flow.id === preferredFlowId)
    || legacyFlows[0]
    || null;
}

function canonicalizeFormSubmissionFlowList(flows, elements, formId, options = {}) {
  const normalizedFlows = normalizePageFlowList(flows);
  const relatedIds = getFormRelatedElementIds(elements, formId);
  const preferredFlow = findPreferredFormSubmissionFlow(normalizedFlows, formId, relatedIds, options.preferredFlowId || '');
  const preferredSubmissionNode = getFirstSubmissionFormNode(preferredFlow);
  const triggerNode = createFormTriggerNode(formId, preferredFlow?.nodes?.find((node) => node?.type === 'trigger') || null);
  const submissionNode = createCanonicalSubmissionNode(preferredSubmissionNode, elements, formId);

  const keptNodes = Array.isArray(preferredFlow?.nodes)
    ? preferredFlow.nodes.filter((node) => node?.type !== 'trigger' && node?.type !== 'submission-form')
    : [];
  const keptNodeIds = new Set([triggerNode.id, submissionNode.id, ...keptNodes.map((node) => node.id)]);
  let nextEdges = Array.isArray(preferredFlow?.edges)
    ? preferredFlow.edges.filter((edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target))
    : [];

  const priorSubmittedEdge = Array.isArray(preferredFlow?.edges)
    ? preferredFlow.edges.find((edge) => edge?.source === triggerNode.id && edge?.sourcePort === 'submitted' && edge?.target !== submissionNode.id) || null
    : null;

  nextEdges = nextEdges.filter((edge) => !(edge.source === triggerNode.id && edge.sourcePort === 'submitted'));
  if (!nextEdges.some((edge) => edge.source === triggerNode.id && edge.target === submissionNode.id && edge.sourcePort === 'submitted')) {
    nextEdges.push({
      id: makeId('flow-edge'),
      source: triggerNode.id,
      target: submissionNode.id,
      sourcePort: 'submitted',
      targetPort: 'in',
    });
  }
  if (priorSubmittedEdge && !nextEdges.some((edge) => edge.source === submissionNode.id && edge.target === priorSubmittedEdge.target && edge.sourcePort === 'next')) {
    nextEdges.push({
      id: makeId('flow-edge'),
      source: submissionNode.id,
      target: priorSubmittedEdge.target,
      sourcePort: 'next',
      targetPort: priorSubmittedEdge.targetPort || 'in',
    });
  }

  const canonicalFlow = normalizePageFlow({
    ...(preferredFlow ?? {}),
    id: preferredFlow?.id || makeId('flow'),
    name: typeof options.name === 'string' && options.name.trim() ? options.name.trim() : getDefaultFlowName(preferredFlow),
    trigger: { type: 'form-submit', formId },
    nodes: [triggerNode, submissionNode, ...keptNodes],
    edges: nextEdges,
    legacySourceElementId: '',
    isLegacyProxy: false,
  });

  const nextFlows = normalizedFlows.filter((flow) => {
    if (!flow || flow.id === canonicalFlow.id) return false;
    if (flow.trigger?.type === 'form-submit' && flow.trigger?.formId === formId) return false;
    if (flowHasSubmissionFormNode(flow) && flow.trigger?.type === 'element-click' && relatedIds.has(flow.trigger?.elementId)) return false;
    return true;
  });

  const nextFlowList = [...nextFlows, canonicalFlow];
  const didChange = JSON.stringify(nextFlowList) !== JSON.stringify(normalizedFlows);

  return {
    flow: canonicalFlow,
    flows: didChange ? nextFlowList : normalizedFlows,
    didChange,
  };
}

function removeVariableReferencesFromFlow(flow, variableScope, variableId) {
  const normalizedFlow = normalizePageFlow(flow);
  if (!normalizedFlow) return null;
  return {
    ...normalizedFlow,
    nodes: normalizedFlow.nodes.map((node) => {
      if (node.type === 'set-variable') {
        if (node.config?.variableScope !== variableScope || node.config?.variableId !== variableId) return node;
        return {
          ...node,
          config: {
            ...node.config,
            variableId: '',
          },
        };
      }
      if (node.type === 'condition') {
        const nextConfig = { ...node.config };
        let didChange = false;
        if (nextConfig.variableScope === variableScope && nextConfig.variableId === variableId) {
          nextConfig.variableId = '';
          didChange = true;
        }
        if (nextConfig.compareSource === 'variable' && nextConfig.compareVariableScope === variableScope && nextConfig.compareVariableId === variableId) {
          nextConfig.compareVariableId = '';
          didChange = true;
        }
        return didChange ? { ...node, config: nextConfig } : node;
      }
      return node;
    }),
  };
}

function valuesMatchForAnimationOverride(nextValue, baseValue) {
  if (Object.is(nextValue, baseValue)) return true;
  if (nextValue == null && baseValue == null) return true;
  if (typeof nextValue === 'number' || typeof baseValue === 'number') {
    const left = typeof nextValue === 'number' ? nextValue : parseFloat(nextValue);
    const right = typeof baseValue === 'number' ? baseValue : parseFloat(baseValue);
    if (Number.isFinite(left) && Number.isFinite(right)) return Math.abs(left - right) < 0.0001;
  }
  return `${nextValue ?? ''}` === `${baseValue ?? ''}`;
}

function stripInheritedTextOverride(override = {}, inheritedSource = {}) {
  const hasTextField = override.text != null || override.richTextHtml != null;
  if (!hasTextField) return override;

  const inheritedText = normalizeTextFields(inheritedSource);
  const resolvedOverrideText = normalizeTextFields({
    ...inheritedText,
    ...override,
  });

  if (
    resolvedOverrideText.text !== inheritedText.text
    || resolvedOverrideText.richTextHtml !== inheritedText.richTextHtml
  ) {
    return {
      ...override,
      ...resolvedOverrideText,
    };
  }

  const nextOverride = { ...override };
  delete nextOverride.text;
  delete nextOverride.richTextHtml;
  return nextOverride;
}

function pruneBreakpointOverride(override = {}, inheritedSource = {}, elementType = null) {
  let nextOverride = { ...(override ?? {}) };

  if (elementType === 'text') {
    nextOverride = stripInheritedTextOverride(nextOverride, inheritedSource);
  }

  if (nextOverride.styles && typeof nextOverride.styles === 'object') {
    const nextStyles = { ...nextOverride.styles };
    Object.keys(nextStyles).forEach((styleKey) => {
      if (valuesMatchForAnimationOverride(nextStyles[styleKey], inheritedSource?.styles?.[styleKey])) {
        delete nextStyles[styleKey];
      }
    });
    if (Object.keys(nextStyles).length) nextOverride.styles = nextStyles;
    else delete nextOverride.styles;
  }

  Object.keys(nextOverride).forEach((key) => {
    if (key === 'styles') return;
    if ((key === 'text' || key === 'richTextHtml') && elementType === 'text') return;
    if (valuesMatchForAnimationOverride(nextOverride[key], inheritedSource?.[key])) {
      delete nextOverride[key];
    }
  });

  return nextOverride;
}

function pruneElementBreakpointOverrides(element) {
  if (!element || typeof element !== 'object') return element;

  const nextOverrides = { ...(element.overrides ?? {}) };
  const tabletOverride = pruneBreakpointOverride(nextOverrides.tablet ?? {}, element.base ?? {}, element.type);
  const tabletResolved = {
    ...(element.base ?? {}),
    ...tabletOverride,
    styles: { ...(element.base?.styles ?? {}), ...(tabletOverride.styles ?? {}) },
  };
  const mobileOverride = pruneBreakpointOverride(nextOverrides.mobile ?? {}, tabletResolved, element.type);

  return {
    ...element,
    overrides: {
      ...nextOverrides,
      tablet: tabletOverride,
      mobile: mobileOverride,
    },
  };
}

function getElementIdPrefix(type) {
  if (type === 'text') return 'txt';
  if (type === 'form') return 'frm';
  if (type === 'text-field') return 'fld';
  if (type === 'textarea-field') return 'txa';
  if (type === 'rich-text-editor') return 'rte';
  if (type === 'radio-group') return 'rad';
  if (type === 'dropdown') return 'drp';
  if (type === 'checkbox') return 'chk';
  if (type === 'file-upload') return 'upl';
  if (type === 'captcha') return 'cap';
  if (type === 'submit-button') return 'sbt';
  if (type === 'image') return 'img';
  if (type === 'icon') return 'ico';
  if (type === 'video') return 'vid';
  if (type === 'scroll-sequence') return 'seq';
  if (type === 'embed') return 'emb';
  return 'fr';
}

function normalizeIconFields(source = {}) {
  const fallbackIcon = getDefaultPackedIcon();
  const iconSource = source?.iconSource === 'custom' ? 'custom' : 'preset';
  const iconName = typeof source?.iconName === 'string' && source.iconName.trim()
    ? source.iconName.trim()
    : fallbackIcon.value;
  const presetMarkup = getIconPresetMarkup(iconName);
  const svgMarkup = sanitizeSvgMarkup(source?.svgMarkup ?? '', { forceCurrentColor: iconSource !== 'custom' }) || presetMarkup;
  return {
    iconSource,
    iconName,
    svgMarkup,
  };
}

function normalizeTextFields(source = {}) {
  const hasExplicitText = typeof source?.text === 'string';
  const hasExplicitRichText = typeof source?.richTextHtml === 'string';
  const text = hasExplicitText
    ? source.text
    : (hasExplicitRichText ? richTextHtmlToPlainText(source.richTextHtml) : 'Text');
  const richTextHtml = sanitizeRichTextHtml(source?.richTextHtml ?? '') || plainTextToRichTextHtml(text);
  return {
    text,
    richTextHtml,
  };
}

function normalizeVideoFields(source = {}) {
  const videoProvider = ['youtube', 'vimeo', 'upload'].includes(source?.videoProvider)
    ? source.videoProvider
    : 'upload';
  return {
    src: getMediaUrl(source?.src ?? ''),
    videoProvider,
    videoControls: source?.videoControls !== false,
    videoLoop: source?.videoLoop === true,
    videoMuted: source?.videoMuted === true,
    videoAutoplay: source?.videoAutoplay === true,
    videoDisableAutoplayInBuilder: source?.videoDisableAutoplayInBuilder === true,
  };
}

function normalizeEmbedFields(source = {}) {
  const embedMode = ['html', 'shortcode', 'php', 'react'].includes(source?.embedMode)
    ? source.embedMode
    : 'html';
  return {
    embedMode,
    embedCode: typeof source?.embedCode === 'string' ? source.embedCode : '',
  };
}

function normalizeScrollSequenceFrameList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => getMediaUrl(entry))
    .filter(Boolean);
}

function normalizeScrollSequenceFields(source = {}) {
  const scrollSequenceType = ['video', 'image-sequence', 'gif'].includes(source?.scrollSequenceType)
    ? source.scrollSequenceType
    : 'video';
  const scrollSequenceSourceMode = source?.scrollSequenceSourceMode === 'url' ? 'url' : 'library';
  return {
    scrollSequenceType,
    scrollSequenceSourceMode,
    scrollSequenceSrc: getMediaUrl(source?.scrollSequenceSrc ?? ''),
    scrollSequenceFrames: normalizeScrollSequenceFrameList(source?.scrollSequenceFrames),
    scrollSequenceStart: clampFinite(source?.scrollSequenceStart, 0.2, 0, 1),
    scrollSequenceEnd: clampFinite(source?.scrollSequenceEnd, 0.68, 0, 1),
    scrollSequenceStartOffsetPx: normalizeAnimationMarkerOffsetPx(source?.scrollSequenceStartOffsetPx),
    scrollSequenceEndOffsetPx: normalizeAnimationMarkerOffsetPx(source?.scrollSequenceEndOffsetPx),
  };
}

function normalizeCommentMessage(message = {}) {
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  return {
    id: typeof message?.id === 'string' && message.id ? message.id : makeId('comment-msg'),
    author: typeof message?.author === 'string' && message.author.trim() ? message.author.trim() : 'You',
    avatarUrl: typeof message?.avatarUrl === 'string' ? message.avatarUrl : '',
    text,
    createdAt: Number.isFinite(message?.createdAt) ? message.createdAt : Date.now(),
  };
}

function normalizeCommentThread(comment = {}) {
  const messages = Array.isArray(comment?.messages)
    ? comment.messages.map(normalizeCommentMessage).filter((entry) => entry.text)
    : [];
  return {
    id: typeof comment?.id === 'string' && comment.id ? comment.id : makeId('comment'),
    bpId: ['desktop', 'tablet', 'mobile'].includes(comment?.bpId) ? comment.bpId : 'desktop',
    x: Number.isFinite(comment?.x) ? comment.x : 0,
    y: Number.isFinite(comment?.y) ? comment.y : 0,
    author: typeof comment?.author === 'string' && comment.author.trim() ? comment.author.trim() : 'You',
    avatarUrl: typeof comment?.avatarUrl === 'string' ? comment.avatarUrl : '',
    resolved: comment?.resolved === true,
    createdAt: Number.isFinite(comment?.createdAt) ? comment.createdAt : Date.now(),
    updatedAt: Number.isFinite(comment?.updatedAt) ? comment.updatedAt : Date.now(),
    messages,
  };
}

function getCurrentCommentAuthor() {
  return {
    author: typeof window?.fbData?.currentUser?.displayName === 'string' && window.fbData.currentUser.displayName.trim()
      ? window.fbData.currentUser.displayName.trim()
      : 'You',
    avatarUrl: typeof window?.fbData?.currentUser?.avatarUrl === 'string' ? window.fbData.currentUser.avatarUrl : '',
  };
}

function normalizeCommentThreads(comments) {
  if (!Array.isArray(comments)) return [];
  return comments.map(normalizeCommentThread);
}

function normalizeTextElementFields(element) {
  if (!element || element.type !== 'text') return element;

  const normalizedBase = {
    ...(element.base ?? {}),
    ...normalizeTextFields(element.base ?? {}),
  };
  const normalizedOverrides = { ...(element.overrides ?? {}) };

  return pruneElementBreakpointOverrides({
    ...element,
    base: normalizedBase,
    overrides: normalizedOverrides,
  });
}

function getTextStyleDrivenFieldUpdates(element, bpId, styleUpdates) {
  if (!element || element.type !== 'text' || styleUpdates?.color == null) return {};
  const rawSource = bpId === 'desktop'
    ? (element.base ?? {})
    : { ...(element.base ?? {}), ...(element.overrides?.[bpId] ?? {}) };
  const fallbackText = typeof rawSource.text === 'string' ? rawSource.text : 'Text';
  const sourceRichTextHtml = sanitizeRichTextHtml(rawSource.richTextHtml ?? '') || plainTextToRichTextHtml(fallbackText);
  return {
    richTextHtml: clearRichTextInlineStyle(sourceRichTextHtml, 'color') || plainTextToRichTextHtml(fallbackText),
  };
}

function normalizeIconElementFields(element) {
  if (!element || element.type !== 'icon') return element;

  const normalizedBase = {
    ...(element.base ?? {}),
    ...normalizeIconFields(element.base ?? {}),
  };
  const normalizedOverrides = { ...(element.overrides ?? {}) };

  ['tablet', 'mobile'].forEach((bpId) => {
    const bpOverride = normalizedOverrides[bpId];
    if (!bpOverride) return;
    const hasIconField = bpOverride.iconSource != null || bpOverride.iconName != null || bpOverride.svgMarkup != null;
    if (!hasIconField) return;
    normalizedOverrides[bpId] = {
      ...bpOverride,
      ...normalizeIconFields({
        ...normalizedBase,
        ...bpOverride,
      }),
    };
  });

  return {
    ...element,
    base: normalizedBase,
    overrides: normalizedOverrides,
  };
}

function normalizeVideoElementFields(element) {
  if (!element || element.type !== 'video') return element;

  const normalizedBase = {
    ...(element.base ?? {}),
    ...normalizeVideoFields(element.base ?? {}),
  };
  const normalizedOverrides = { ...(element.overrides ?? {}) };

  ['tablet', 'mobile'].forEach((bpId) => {
    const bpOverride = normalizedOverrides[bpId];
    if (!bpOverride) return;
    const hasVideoField = bpOverride.src != null
      || bpOverride.videoProvider != null
      || bpOverride.videoControls != null
      || bpOverride.videoLoop != null
      || bpOverride.videoMuted != null
      || bpOverride.videoAutoplay != null
      || bpOverride.videoDisableAutoplayInBuilder != null;
    if (!hasVideoField) return;
    normalizedOverrides[bpId] = {
      ...bpOverride,
      ...normalizeVideoFields({
        ...normalizedBase,
        ...bpOverride,
      }),
    };
  });

  return {
    ...element,
    base: normalizedBase,
    overrides: normalizedOverrides,
  };
}

function normalizeScrollSequenceElementFields(element) {
  if (!element || element.type !== 'scroll-sequence') return element;

  const normalizedBase = {
    ...(element.base ?? {}),
    ...normalizeScrollSequenceFields(element.base ?? {}),
  };
  const normalizedOverrides = { ...(element.overrides ?? {}) };

  ['tablet', 'mobile'].forEach((bpId) => {
    const bpOverride = normalizedOverrides[bpId];
    if (!bpOverride) return;
    const hasSequenceField = bpOverride.scrollSequenceType != null
      || bpOverride.scrollSequenceSourceMode != null
      || bpOverride.scrollSequenceSrc != null
      || bpOverride.scrollSequenceFrames != null
      || bpOverride.scrollSequenceStart != null
      || bpOverride.scrollSequenceEnd != null
      || bpOverride.scrollSequenceStartOffsetPx != null
      || bpOverride.scrollSequenceEndOffsetPx != null;
    if (!hasSequenceField) return;
    normalizedOverrides[bpId] = {
      ...bpOverride,
      ...normalizeScrollSequenceFields({
        ...normalizedBase,
        ...bpOverride,
      }),
    };
  });

  return {
    ...element,
    base: normalizedBase,
    overrides: normalizedOverrides,
  };
}

function normalizeEmbedElementFields(element) {
  if (!element || element.type !== 'embed') return element;

  const normalizedBase = {
    ...(element.base ?? {}),
    ...normalizeEmbedFields(element.base ?? {}),
  };
  const normalizedOverrides = { ...(element.overrides ?? {}) };

  ['tablet', 'mobile'].forEach((bpId) => {
    const bpOverride = normalizedOverrides[bpId];
    if (!bpOverride) return;
    const hasEmbedField = bpOverride.embedMode != null || bpOverride.embedCode != null;
    if (!hasEmbedField) return;
    normalizedOverrides[bpId] = {
      ...bpOverride,
      ...normalizeEmbedFields({
        ...normalizedBase,
        ...bpOverride,
      }),
    };
  });

  return {
    ...element,
    base: normalizedBase,
    overrides: normalizedOverrides,
  };
}

function normalizeLoopElementFields(element) {
  if (!element || !isLoopElementType(element.type)) return element;

  const normalizedBase = {
    ...(element.base ?? {}),
    loop: normalizeLoopConfig(element.base?.loop),
  };
  const normalizedOverrides = { ...(element.overrides ?? {}) };

  ['tablet', 'mobile'].forEach((bpId) => {
    const bpOverride = normalizedOverrides[bpId];
    if (!bpOverride || bpOverride.loop == null) return;
    normalizedOverrides[bpId] = {
      ...bpOverride,
      loop: normalizeLoopConfig({
        ...normalizedBase.loop,
        ...bpOverride.loop,
      }),
    };
  });

  return {
    ...element,
    base: normalizedBase,
    overrides: normalizedOverrides,
  };
}

function normalizeElementDynamicFields(element) {
  const normalizedElement = normalizeElementConstraints(pruneElementBreakpointOverrides(
    normalizeLoopElementFields(normalizeEmbedElementFields(normalizeScrollSequenceElementFields(normalizeVideoElementFields(normalizeIconElementFields(normalizeTextElementFields(element))))))
  ));
  return syncElementLockedFlag({
    ...normalizedElement,
    animations: normalizeElementAnimations(element?.animations),
    bindings: normalizeElementBindings(element?.bindings),
    interactions: normalizeElementInteractions(element?.interactions),
  });
}

function getVariableMap(pageVariables = [], globalVariables = [], loopItemVariables = []) {
  const pageMap = new Map(normalizeVariableList(pageVariables, 'page').map((variable) => [variable.id, variable]));
  const globalMap = new Map(normalizeVariableList(globalVariables, 'global').map((variable) => [variable.id, variable]));
  const loopItemMap = new Map(normalizeVariableList(loopItemVariables, 'loop-item').map((variable) => [variable.id, variable]));
  return { page: pageMap, global: globalMap, 'loop-item': loopItemMap };
}

function applyVariableBindingValue(resolved, propertyKey, variable) {
  if (!resolved || !propertyKey || !variable) return resolved;
  const next = { ...resolved, styles: { ...(resolved.styles ?? {}) } };
  const value = variable.value;
  switch (propertyKey) {
    case 'text':
      next.text = value == null ? '' : `${value}`;
      next.richTextHtml = plainTextToRichTextHtml(next.text);
      break;
    case 'hidden':
      next.hidden = !value;
      break;
    case 'linkUrl':
      next.linkUrl = value == null ? '' : `${value}`;
      break;
    case 'styles.backgroundImage':
      next.styles.backgroundImage = getMediaUrl(value);
      break;
    case 'styles.backgroundColor':
      next.styles.backgroundColor = typeof value === 'string' ? value : '#000000';
      break;
    case 'styles.color':
      next.styles.color = typeof value === 'string' ? value : '#000000';
      break;
    case 'styles.zIndex':
      next.styles.zIndex = typeof value === 'number' ? value : parseFloat(value) || 0;
      break;
    case 'styles.fontFamily':
      next.styles.fontFamily = typeof value === 'string' ? value : `${value ?? ''}`;
      break;
    case 'src':
      next.src = getMediaUrl(value);
      break;
    default:
      break;
  }
  return next;
}

// ── Breakpoint definitions ────────────────────────────────────

const BREAKPOINTS = {
  desktop: { id: 'desktop', name: 'Desktop', icon: '🖥', width: 1440, height: 900, x: 100,  y: 120, viewportFoldH: null },
  tablet:  { id: 'tablet',  name: 'Tablet',  icon: '📟', width: 768,  height: 1024, x: 1600, y: 120, viewportFoldH: null },
  mobile:  { id: 'mobile',  name: 'Mobile',  icon: '📱', width: 390,  height: 844,  x: 2440, y: 120, viewportFoldH: null },
};

const COMPONENT_EDITOR_BREAKPOINTS = {
  desktop: { id: 'desktop', name: 'Component', icon: '⬢', width: 820, height: 560, x: 120, y: 120, viewportFoldH: null },
};

function isComponentEditorBreakpointDefs(defs) {
  if (!defs || typeof defs !== 'object') return false;
  const keys = Object.keys(defs);
  if (keys.length !== 1 || !defs.desktop) return false;
  return defs.desktop.name === 'Component';
}

function normalizePageBreakpointDefs(defs) {
  if (!defs || typeof defs !== 'object' || isComponentEditorBreakpointDefs(defs)) {
    return deepClone(BREAKPOINTS);
  }
  return {
    desktop: { ...BREAKPOINTS.desktop, ...(defs.desktop ?? {}) },
    tablet: { ...BREAKPOINTS.tablet, ...(defs.tablet ?? {}) },
    mobile: { ...BREAKPOINTS.mobile, ...(defs.mobile ?? {}) },
  };
}

const COMPONENT_EDITOR_VARIANT_GAP = 140;
const COMPONENT_EDITOR_VARIANT_TOP = 100;
const COMPONENT_EDITOR_VARIANT_SIDE_PAD = 120;

function setValueAtPath(target, path, value) {
  if (!target || !Array.isArray(path) || !path.length) return;
  let cursor = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = value;
}

function applyComponentBindingValue(element, binding, control, value) {
  if (!element?.base || !binding?.property) return;
  if (binding.property === 'variant') return;

  if (binding.property === 'text') {
    const nextText = typeof value === 'string' ? value : `${value ?? ''}`;
    element.base.text = nextText;
    if (typeof element.base.richTextHtml === 'string') {
      element.base.richTextHtml = plainTextToRichTextHtml(nextText || 'Text');
    }
    return;
  }

  if (binding.property === 'src') {
    element.base.src = typeof value === 'string' ? value : `${value ?? ''}`;
    return;
  }

  if (binding.property === 'linkUrl') {
    element.base.linkUrl = typeof value === 'string' ? value : `${value ?? ''}`;
    return;
  }

  if (binding.property === 'hidden') {
    element.base.hidden = value === true;
    return;
  }

  if (!binding.property.startsWith('styles.')) return;

  const styleKey = binding.property.replace(/^styles\./, '');
  const nextValue = control.type === 'number'
    ? clampFinite(value, element.base?.styles?.[styleKey] ?? 0)
    : (control.type === 'boolean' ? value === true : value);
  setValueAtPath(element.base, ['styles', styleKey], nextValue);
}

function normalizeComponentInstancePropBindings(bindings) {
  if (!bindings || typeof bindings !== 'object') return {};
  return Object.fromEntries(
    Object.entries(bindings)
      .map(([controlId, binding]) => [controlId, normalizeBindingDefinition(binding)])
      .filter(([, binding]) => !!binding),
  );
}

function resolveComponentInstanceBoundProps(component, propBindings = {}, pageVariables = [], globalVariables = []) {
  if (!(component?.controls ?? []).length) return {};
  const variableMaps = getVariableMap(pageVariables, globalVariables, []);
  return Object.fromEntries(
    (component.controls ?? []).flatMap((control) => {
      const binding = propBindings?.[control.id] ?? null;
      if (!binding) return [];
      const variable = variableMaps[binding.scope]?.get(binding.variableId) ?? null;
      if (!variable) return [];
      return [[control.id, normalizeComponentControlValue(control.type, variable.value, control.options ?? [])]];
    }),
  );
}

function applyComponentControlPropsToSnapshot(snapshot, component, props = {}, propBindings = {}) {
  if (!Array.isArray(snapshot) || !snapshot.length || !(component?.controls ?? []).length) return deepClone(snapshot ?? []);

  const nextSnapshot = deepClone(snapshot);
  const elementMap = new Map(nextSnapshot.map((entry) => [entry.id, entry]));
  const normalizedPropBindings = normalizeComponentInstancePropBindings(propBindings);

  component.controls.forEach((control) => {
    const value = getComponentControlValue(control, props);
    const instanceBinding = normalizedPropBindings[control.id] ?? null;
    (control.bindings ?? []).forEach((binding) => {
      const target = elementMap.get(binding.elementId);
      if (!target) return;
      if (instanceBinding && binding.property !== 'variant') {
        const nextBindings = normalizeElementBindings(target.bindings);
        nextBindings.desktop = {
          ...(nextBindings.desktop ?? {}),
          [binding.property]: instanceBinding,
        };
        target.bindings = nextBindings;
        return;
      }
      applyComponentBindingValue(target, binding, control, value);
    });
  });

  return nextSnapshot;
}

function resolveComponentInstanceVariantId(component, fallbackVariantId, props = {}) {
  let nextVariantId = getComponentVariant(component, fallbackVariantId)?.id
    ?? component?.defaultVariantId
    ?? component?.variants?.[0]?.id
    ?? null;

  (component?.controls ?? []).forEach((control) => {
    if (!Object.prototype.hasOwnProperty.call(props, control.id)) return;
    const hasVariantBinding = (control.bindings ?? []).some((binding) => binding.property === 'variant');
    if (!hasVariantBinding) return;
    const requestedVariantId = typeof props[control.id] === 'string' ? props[control.id] : null;
    if (!requestedVariantId) return;
    const matchedVariant = getComponentVariant(component, requestedVariantId);
    if (matchedVariant?.id) nextVariantId = matchedVariant.id;
  });

  return nextVariantId;
}

function buildComponentInstanceSubtree(component, {
  rootEl = null,
  targetRootId = null,
  targetParentId = null,
  rootPosition = null,
  bpId = 'desktop',
  variantId = null,
  props = null,
  propBindings = null,
  role = 'instance',
  getState = null,
} = {}) {
  if (!component?.variants?.length) return { instantiated: [], root: null, variant: null, props: {} };

  const state = typeof getState === 'function' ? getState() : {};
  const currentPage = (state.pages ?? []).find((page) => page.id === state.currentPageId) ?? null;
  const nextProps = normalizeComponentInstanceProps(component, props ?? rootEl?.componentInstance?.props ?? {});
  const nextPropBindings = normalizeComponentInstancePropBindings(propBindings ?? rootEl?.componentInstance?.bindings ?? {});
  const boundProps = resolveComponentInstanceBoundProps(
    component,
    nextPropBindings,
    Array.isArray(currentPage?.variables) ? currentPage.variables : [],
    state.globalVariables ?? [],
  );
  const effectiveProps = { ...nextProps, ...boundProps };
  const nextVariantId = resolveComponentInstanceVariantId(
    component,
    variantId ?? rootEl?.componentInstance?.variantId ?? component.defaultVariantId,
    effectiveProps,
  );
  const variant = getComponentVariant(component, nextVariantId);
  const composedSnapshot = composeVariantSnapshot(component, variant?.id ?? component?.defaultVariantId);
  if (!variant || !composedSnapshot.length) return { instantiated: [], root: null, variant: null, props: nextProps };

  const resolvedSnapshot = applyComponentControlPropsToSnapshot(composedSnapshot, component, effectiveProps, nextPropBindings);
  const instantiated = instantiateComponentSnapshot(resolvedSnapshot, {
    targetRootId,
    targetParentId,
    rootPosition,
    bpId,
    componentInstance: {
      ...(rootEl?.componentInstance ?? {}),
      componentId: component.id,
      variantId: variant.id,
      role: rootEl?.componentInstance?.role ?? role,
      props: nextProps,
      bindings: nextPropBindings,
    },
  });
  return {
    instantiated,
    root: getSnapshotRoot(instantiated),
    variant,
    props: nextProps,
  };
}

function normalizeComponentVariant(variant, fallbackName = 'Variant', { primary = false } = {}) {
  const mode = resolveComponentVariantMode(variant?.mode, { primary });
  const parentVariantId = mode === 'default'
    ? null
    : (typeof variant?.parentVariantId === 'string' && variant.parentVariantId ? variant.parentVariantId : null);
  return {
    id: variant?.id ?? makeId('cmp-var'),
    name: primary
      ? 'Primary'
      : (mode === 'default' ? (variant?.name || fallbackName).trim() : getComponentVariantStateLabel(mode)),
    mode,
    parentVariantId,
    snapshot: primary
      ? ensureComponentPrimaryRoot(variant?.snapshot ?? [])
      : deepClone(Array.isArray(variant?.snapshot) ? variant.snapshot : []),
    interaction: mode === 'default' ? normalizeComponentInteraction(variant?.interaction) : null,
    childTransition: mode === 'default' ? normalizeComponentTransition(variant?.childTransition) : null,
  };
}

function normalizeStoredComponent(component) {
  const variants = Array.isArray(component?.variants) && component.variants.length
    ? component.variants.map((variant, index) => normalizeComponentVariant(variant, index === 0 ? 'Primary' : `Variant ${index + 1}`, { primary: index === 0 }))
    : [normalizeComponentVariant({
        id: component?.defaultVariantId ?? makeId('cmp-var'),
        name: 'Primary',
        snapshot: component?.snapshot ?? [],
      }, 'Primary', { primary: true })];

  const normalizedVariants = variants.map((variant, index) => {
    if (index === 0) return { ...variant, name: 'Primary', mode: 'default', parentVariantId: null };
    if (!isDefaultComponentVariant(variant)) return { ...variant, name: getComponentVariantStateLabel(variant.mode) };
    return variant;
  });
  const variantIds = new Set(normalizedVariants.map((variant) => variant.id));
  const defaultVariantIds = new Set(normalizedVariants.filter(isDefaultComponentVariant).map((variant) => variant.id));
  const sanitizedVariants = normalizedVariants.map((variant) => {
    if (!isDefaultComponentVariant(variant)) {
      const nextParentVariantId = defaultVariantIds.has(variant.parentVariantId)
        ? variant.parentVariantId
        : normalizedVariants[0]?.id ?? null;
      return {
        ...variant,
        parentVariantId: nextParentVariantId,
        interaction: null,
        name: getComponentVariantStateLabel(variant.mode),
      };
    }
    const interaction = variant.interaction;
    if (!interaction?.targetVariantId || !variantIds.has(interaction.targetVariantId) || interaction.targetVariantId === variant.id) {
      return { ...variant, mode: 'default', parentVariantId: null, interaction: null };
    }
    return { ...variant, mode: 'default', parentVariantId: null };
  });
  const defaultVariantId = sanitizedVariants.some((variant) => variant.id === component?.defaultVariantId && isDefaultComponentVariant(variant))
    ? component.defaultVariantId
    : sanitizedVariants.find(isDefaultComponentVariant)?.id ?? sanitizedVariants[0]?.id ?? null;
  const controls = normalizeComponentControls(component?.controls);

  return {
    ...component,
    defaultVariantId,
    controls,
    variants: sanitizedVariants,
    snapshot: sanitizedVariants[0]?.snapshot ?? [],
  };
}

function getComponentVariant(component, variantId = null) {
  if (!component?.variants?.length) return null;
  return component.variants.find((variant) => variant.id === variantId)
    ?? component.variants.find((variant) => variant.id === component.defaultVariantId)
    ?? component.variants[0]
    ?? null;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function diffValue(baseValue, nextValue) {
  if (Array.isArray(baseValue) || Array.isArray(nextValue)) {
    return JSON.stringify(baseValue ?? null) === JSON.stringify(nextValue ?? null)
      ? undefined
      : deepClone(nextValue);
  }

  if (isPlainObject(baseValue) && isPlainObject(nextValue)) {
    const diff = {};
    const keys = new Set([...Object.keys(baseValue ?? {}), ...Object.keys(nextValue ?? {})]);
    keys.forEach((key) => {
      const childDiff = diffValue(baseValue?.[key], nextValue?.[key]);
      if (childDiff !== undefined) diff[key] = childDiff;
    });
    return Object.keys(diff).length ? diff : undefined;
  }

  return JSON.stringify(baseValue ?? null) === JSON.stringify(nextValue ?? null)
    ? undefined
    : deepClone(nextValue);
}

function deepMerge(baseValue, patchValue) {
  if (Array.isArray(baseValue) || Array.isArray(patchValue)) return deepClone(patchValue);
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) return deepClone(patchValue);

  const merged = { ...deepClone(baseValue) };
  Object.entries(patchValue).forEach(([key, value]) => {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? deepMerge(merged[key], value)
      : deepClone(value);
  });
  return merged;
}

function buildComponentEditorElements(component) {
  const defaultVariants = getDefaultComponentVariants(component);
  let cursorX = COMPONENT_EDITOR_VARIANT_SIDE_PAD;
  let maxBottom = COMPONENT_EDITOR_VARIANT_TOP + 320;
  const elements = [];

  defaultVariants.forEach((variant, index) => {
    const family = [variant, ...(component?.variants ?? []).filter((entry) => !isDefaultComponentVariant(entry) && entry.parentVariantId === variant.id)];
    let familyMaxWidth = 240;
    let familyBottom = COMPONENT_EDITOR_VARIANT_TOP;
    let cursorY = COMPONENT_EDITOR_VARIANT_TOP;

    family.forEach((entry) => {
      const snapshot = composeVariantSnapshot(component, entry.id);
      const root = getSnapshotRoot(snapshot);
      if (!root) return;
      const runtimeSnapshot = instantiateEditorVariantSnapshot(snapshot, entry, index, cursorX, cursorY);
      elements.push(...runtimeSnapshot);
      familyMaxWidth = Math.max(familyMaxWidth, root.base?.width ?? 240);
      familyBottom = Math.max(familyBottom, cursorY + (root.base?.height ?? 160));
      cursorY = familyBottom + 120;
    });

    cursorX += familyMaxWidth + COMPONENT_EDITOR_VARIANT_GAP;
    maxBottom = Math.max(maxBottom, familyBottom);
  });

  return {
    elements,
    width: Math.max(1400, cursorX + COMPONENT_EDITOR_VARIANT_SIDE_PAD),
    height: Math.max(960, maxBottom + 360),
  };
}

function buildComponentLibraryForPersistence(state) {
  const componentEditorOpen = state.activeSurface === 'component' && state.componentEditor?.isOpen;
  if (!componentEditorOpen) return state.components;

  return state.components.map((component) => {
    if (component.id !== state.componentEditor.componentId) return component;
    const syncedVariants = syncComponentEditorVariants(state.componentEditor);
    return normalizeStoredComponent({
      ...component,
      updatedAt: Date.now(),
      defaultVariantId: component.defaultVariantId ?? syncedVariants[0]?.id ?? null,
      controls: state.componentEditor.controls ?? component.controls ?? [],
      variants: syncedVariants,
      snapshot: syncedVariants[0]?.snapshot ?? [],
    });
  });
}

function makeComponentEditorBreakpoints(elements = []) {
  const variantRoots = (elements ?? []).filter((el) => !el.parentId && el.componentRoot);
  const width = Math.max(1400, ...variantRoots.map((root) => (root.base?.x ?? 0) + (root.base?.width ?? 240) + COMPONENT_EDITOR_VARIANT_SIDE_PAD));
  const height = Math.max(960, ...variantRoots.map((root) => (root.base?.y ?? 0) + (root.base?.height ?? 160) + 360));
  return {
    desktop: {
      ...COMPONENT_EDITOR_BREAKPOINTS.desktop,
      width,
      height,
    },
  };
}

// Elements live in a flat page.elements array.
// Every element has base (desktop truth) + overrides per breakpoint.
// Adding/moving always writes to base. Tablet/Mobile inherit + can override.
const makeDefaultPage = () => ({
  id: 'page-1',
  title: 'Untitled Page',
  // Template / detail-page marking (Phase 4)
  templateType: 'regular',      // 'regular' | 'post-single' | 'post-archive' | 'woo-product' | 'woo-category' | 'woo-shop'
  templateTarget: '',           // post type slug (e.g. 'post', 'product') or taxonomy slug
  // tablet/mobile start as null = inherit from parent breakpoint
  background: { desktop: '#ffffff', tablet: null, mobile: null },
  smoothScroll: { desktop: false, tablet: null, mobile: null },
  // padding: null per bp = inherit from parent breakpoint
  padding: { desktop: { top: 0, right: 0, bottom: 0, left: 0 }, tablet: null, mobile: null },
  // layout: null per bp = inherit; object = { flexDirection, alignItems, justifyContent, flexWrap, gap }
  layout: { desktop: null, tablet: null, mobile: null },
  variables: [],
  flows: [],
  comments: [],
  elements: [],
});

const makeComponentEditorPage = () => ({
  ...makeDefaultPage(),
  title: 'Component',
  background: { desktop: '#16161c', tablet: null, mobile: null },
  padding: { desktop: { top: 0, right: 0, bottom: 0, left: 0 }, tablet: null, mobile: null },
});

function makeEmptyComponentEditor() {
  return {
    isOpen: false,
    componentId: null,
    activeVariantId: null,
    controls: [],
    variants: [],
    page: makeComponentEditorPage(),
    breakpointDefs: deepClone(COMPONENT_EDITOR_BREAKPOINTS),
    uiRestore: null,
  };
}

function buildComponentEditorResetState(componentEditor, fallbackBreakpointDefs = BREAKPOINTS) {
  return {
    activeSurface: 'page',
    selection: normalizeSelection(componentEditor?.uiRestore?.selection),
    artboardSel: componentEditor?.uiRestore?.artboardSel ?? null,
    hoveredId: componentEditor?.uiRestore?.hoveredId ?? null,
    layerHoveredId: null,
    drilledContainerId: componentEditor?.uiRestore?.drilledContainerId ?? null,
    pendingDraw: componentEditor?.uiRestore?.pendingDraw ?? null,
    leftTab: componentEditor?.uiRestore?.leftTab ?? 'layers',
    breakpointDefs: normalizePageBreakpointDefs(componentEditor?.uiRestore?.breakpointDefs ?? fallbackBreakpointDefs),
    componentEditor: makeEmptyComponentEditor(),
    componentHistory: [],
    componentHistoryIndex: -1,
  };
}


function buildPersistableLayoutPayload(state) {
  const page = state.pages.find((item) => item.id === state.currentPageId);
  const components = deepStripDataUris(buildComponentLibraryForPersistence(state));
  const persistedBreakpointDefs = state.activeSurface === 'component' && state.componentEditor?.isOpen
    ? normalizePageBreakpointDefs(state.componentEditor?.uiRestore?.breakpointDefs)
    : normalizePageBreakpointDefs(state.breakpointDefs);

  return deepStripDataUris({
    ...page,
    elements: stripDataUrisFromElements(page?.elements),
    variables: normalizeVariableList(page?.variables, 'page'),
    flows: normalizePageFlowList(page?.flows),
    _breakpointDefs: persistedBreakpointDefs,
    _componentLibrary: components,
  });
}

function normalizePageData(page) {
  const fallback = makeDefaultPage();
  return {
    ...fallback,
    ...(page ?? {}),
    background: { ...fallback.background, ...(page?.background ?? {}) },
    smoothScroll: { ...fallback.smoothScroll, ...(page?.smoothScroll ?? {}) },
    padding: { ...fallback.padding, ...(page?.padding ?? {}) },
    layout: { ...fallback.layout, ...(page?.layout ?? {}) },
    variables: normalizeVariableList(page?.variables, 'page'),
    flows: normalizePageFlowList(page?.flows),
    comments: normalizeCommentThreads(page?.comments),
    elements: Array.isArray(page?.elements) ? page.elements.map(normalizeElementDynamicFields) : [],
  };
}
// ── Element factory ──────────────────────────────────────────

export function createFrame(x = 80, y = 80, name) {
  return {
    id: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'frame',
    name: name || 'Frame',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 160, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      styles: {
        backgroundColor: 'rgba(180,180,200,0.18)',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, mixBlendMode: 'normal', overflow: 'visible', display: 'flex', flexDirection: 'row',
        flexWrap: 'nowrap', gap: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0,
        paddingLeft: 0, alignItems: 'flex-start', justifyContent: 'flex-start', boxShadow: '', zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createLoop(x = 80, y = 80, name) {
  const frame = createFrame(x, y, name || 'Loop');
  const loop = getDefaultLoopConfig();
  return {
    ...frame,
    id: `lop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'loop',
    name: name || 'Loop',
    base: {
      ...frame.base,
      width: 280,
      height: 240,
      loop,
      styles: {
        ...frame.base.styles,
        backgroundColor: 'rgba(123, 227, 0, 0.08)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(123, 227, 0, 0.32)',
        borderStyle: 'dashed',
        display: 'flex',
        flexDirection: 'column',
        flexWrap: 'nowrap',
        gap: loop.gap,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
      },
    },
  };
}

function createLoopTemplateElement(loopElement, bpId = 'desktop') {
  const loopConfig = normalizeLoopConfig(loopElement?.base?.loop);
  const template = createFrame(0, 0, 'Loop Item');
  const paddingLeft = Math.max(0, parseFloat(loopElement?.base?.styles?.paddingLeft) || 0);
  const paddingRight = Math.max(0, parseFloat(loopElement?.base?.styles?.paddingRight) || 0);
  const width = Math.max(80, (parseFloat(loopElement?.base?.width) || 280) - paddingLeft - paddingRight);
  const nextTemplate = {
    ...template,
    name: 'Loop Item',
    parentId: loopElement?.id ?? null,
    loopTemplateRootFor: loopElement?.id ?? null,
    generatedLoopTemplateShell: true,
    base: {
      ...template.base,
      x: 0,
      y: 0,
      width,
      height: 120,
      positionType: 'relative',
      absoluteInLayout: false,
      styles: {
        ...template.base.styles,
        backgroundColor: 'rgba(255,255,255,0.52)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(123, 227, 0, 0.18)',
        borderStyle: 'solid',
        display: 'flex',
        flexDirection: 'column',
        flexWrap: 'nowrap',
        gap: loopConfig.gap,
        paddingTop: 12,
        paddingRight: 12,
        paddingBottom: 12,
        paddingLeft: 12,
      },
    },
  };

  if (bpId && bpId !== 'desktop') {
    nextTemplate.base = { ...nextTemplate.base, hidden: true };
    nextTemplate.overrides = {
      ...nextTemplate.overrides,
      [bpId]: {
        ...(nextTemplate.overrides?.[bpId] ?? {}),
        hidden: false,
      },
    };
  }

  return nextTemplate;
}

function isGeneratedLoopTemplateShell(element) {
  if (!element || !element.loopTemplateRootFor) return false;
  const childCount = Array.isArray(element.children) ? element.children.length : 0;
  if (childCount > 0) return false;
  if (element.generatedLoopTemplateShell === true) return true;
  return element.type === 'frame' && `${element.name ?? ''}`.trim().toLowerCase() === 'loop item';
}

export function loopTemplateRootHasContent(element) {
  if (!element || !element.loopTemplateRootFor) return false;
  return !isGeneratedLoopTemplateShell(element);
}

function getLoopTemplateRootId(loopElement, elements = []) {
  if (!loopElement || !isLoopElementType(loopElement.type)) return null;
  const directChildIds = Array.isArray(loopElement.children) ? loopElement.children : [];
  const configuredId = loopElement.base?.loop?.templateRootId;
  if (configuredId && directChildIds.includes(configuredId)) return configuredId;
  const directChildren = directChildIds
    .map((childId) => elements.find((candidate) => candidate.id === childId) ?? null)
    .filter(Boolean);
  const explicitTemplate = directChildren.find((child) => child.loopTemplateRootFor === loopElement.id);
  if (explicitTemplate) return explicitTemplate.id;
  return directChildren[0]?.id ?? null;
}

function getLoopElementForTemplateDescendant(element, elements = []) {
  if (!element || !Array.isArray(elements) || !elements.length) return null;
  const byId = new Map(elements.map((entry) => [entry.id, entry]));
  let current = element;

  while (current) {
    if (current.loopTemplateRootFor) {
      const loopElement = current.parentId ? byId.get(current.parentId) ?? null : null;
      return loopElement && isLoopElementType(loopElement.type) ? loopElement : null;
    }
    if (!current.parentId) return null;
    const parent = byId.get(current.parentId) ?? null;
    if (parent && isLoopElementType(parent.type)) {
      const templateRootId = getLoopTemplateRootId(parent, elements);
      return templateRootId === current.id ? parent : null;
    }
    current = parent;
  }

  return null;
}

export function getLoopTemplateRootForElement(element, elements = []) {
  if (!element || !Array.isArray(elements) || !elements.length) return null;
  const byId = new Map(elements.map((entry) => [entry.id, entry]));
  if (element.loopTemplateRootFor) return element;

  let current = element;
  while (current) {
    if (!current.parentId) return null;
    const parent = byId.get(current.parentId) ?? null;
    if (!parent) return null;
    if (isLoopElementType(parent.type)) {
      const templateRootId = getLoopTemplateRootId(parent, elements);
      return templateRootId ? (byId.get(templateRootId) ?? null) : null;
    }
    if (current.loopTemplateRootFor) return current;
    current = parent;
  }

  return null;
}

function isAutoLoopNavigateInteraction(interaction) {
  return !!interaction
    && interaction.type === 'navigate'
    && interaction.destinationSource === 'variable'
    && interaction.variableScope === 'loop-item'
    && interaction.variableId === 'loop-item-url'
    && interaction.autoLoopNavigate === true;
}

function isLoopItemUrlNavigateNode(node) {
  return !!node
    && node.type === 'navigate'
    && node.config?.destinationSource === 'variable'
    && node.config?.variableScope === 'loop-item'
    && node.config?.variableId === 'loop-item-url';
}

function isAutoLoopNavigateNode(node) {
  return isLoopItemUrlNavigateNode(node) && node.config?.autoLoopNavigate === true;
}

function buildAutoLoopNavigateNode() {
  return {
    id: makeId('flow-node'),
    type: 'navigate',
    label: 'Navigate',
    position: { x: 0, y: 0 },
    config: {
      destinationSource: 'variable',
      variableScope: 'loop-item',
      variableId: 'loop-item-url',
      variableType: 'string',
      autoLoopNavigate: true,
    },
  };
}

function buildAutoLoopNavigateFlow(element) {
  if (!element?.id) return null;
  const triggerNodeId = makeId('flow-node');
  const navigateNode = buildAutoLoopNavigateNode();
  return normalizePageFlow({
    id: makeId('flow'),
    name: `${element?.name || 'Loop Item'} interaction`,
    trigger: { type: 'element-click', elementId: element.id, event: 'click' },
    nodes: [
      {
        id: triggerNodeId,
        type: 'trigger',
        label: 'Trigger',
        position: { x: 0, y: 0 },
        config: { triggerType: 'element-click', elementId: element.id, event: 'click' },
      },
      navigateNode,
    ],
    edges: [{
      id: makeId('flow-edge'),
      source: triggerNodeId,
      sourcePort: 'next',
      target: navigateNode.id,
      targetPort: 'in',
    }],
  });
}

function stripAutoLoopNavigateInteractions(elements) {
  return (Array.isArray(elements) ? elements : []).map((element) => {
    const existingInteractions = normalizeElementInteractions(element?.interactions ?? []);
    const nextInteractions = existingInteractions.filter((interaction) => !isAutoLoopNavigateInteraction(interaction));
    if (existingInteractions.length === nextInteractions.length) return element;
    return {
      ...element,
      interactions: nextInteractions,
    };
  });
}

function removeAutoLoopNavigateNodesFromFlow(flow) {
  if (!flow) return null;
  const autoNodeIds = new Set((flow.nodes ?? []).filter((node) => isAutoLoopNavigateNode(node)).map((node) => node.id));
  if (!autoNodeIds.size) return flow;
  const nextFlow = normalizePageFlow({
    ...flow,
    nodes: (flow.nodes ?? []).filter((node) => !autoNodeIds.has(node.id)),
    edges: (flow.edges ?? []).filter((edge) => !autoNodeIds.has(edge.source) && !autoNodeIds.has(edge.target)),
  });
  if (!nextFlow) return null;
  const nonTriggerNodes = (nextFlow.nodes ?? []).filter((node) => node.type !== 'trigger');
  return nonTriggerNodes.length ? nextFlow : null;
}

function syncLoopTemplateNavigateFlows(page) {
  const elements = Array.isArray(page?.elements) ? page.elements : [];
  const flows = normalizePageFlowList(page?.flows);
  const templateRoots = elements.filter((element) => element?.loopTemplateRootFor);
  const shouldNavigateByElementId = new Map(templateRoots.map((element) => [element.id, loopTemplateRootHasContent(element)]));
  const flowsByElementId = new Map();

  flows.forEach((flow) => {
    if (flow?.trigger?.type !== 'element-click' || !flow?.trigger?.elementId) return;
    if (!flowsByElementId.has(flow.trigger.elementId)) flowsByElementId.set(flow.trigger.elementId, []);
    flowsByElementId.get(flow.trigger.elementId).push(flow);
  });

  const nextFlows = [];
  flows.forEach((flow) => {
    const elementId = flow?.trigger?.type === 'element-click' ? flow?.trigger?.elementId : '';
    if (!elementId || !shouldNavigateByElementId.has(elementId)) {
      nextFlows.push(flow);
      return;
    }
    if (shouldNavigateByElementId.get(elementId)) {
      nextFlows.push(flow);
      return;
    }
    const cleanedFlow = removeAutoLoopNavigateNodesFromFlow(flow);
    if (cleanedFlow) nextFlows.push(cleanedFlow);
  });

  templateRoots.forEach((element) => {
    if (!shouldNavigateByElementId.get(element.id)) return;
    const existingFlows = (flowsByElementId.get(element.id) ?? []).filter(Boolean);
    const hasLoopUrlNavigate = existingFlows.some((flow) => (flow.nodes ?? []).some((node) => isLoopItemUrlNavigateNode(node)));
    if (existingFlows.length && hasLoopUrlNavigate) return;
    if (existingFlows.length) return;
    const autoFlow = buildAutoLoopNavigateFlow(element);
    if (autoFlow) nextFlows.push(autoFlow);
  });

  return {
    ...page,
    flows: normalizePageFlowList(nextFlows),
  };
}

function getLoopCollectionSourceItems(collection, variableSources = {}) {
  return Array.isArray(variableSources?.[collection]) ? variableSources[collection] : [];
}

function findLoopPreviewVariable(loopConfig, pageVariables = [], globalVariables = []) {
  const variableBinding = loopConfig?.query?.variable;
  if (!variableBinding?.variableId) return null;
  const sourceVariables = variableBinding.scope === 'global' ? globalVariables : pageVariables;
  return normalizeVariableList(sourceVariables, variableBinding.scope === 'global' ? 'global' : 'page')
    .find((variable) => variable.id === variableBinding.variableId) ?? null;
}

function buildLoopPreviewItems(loopElement, variableSources = {}, pageVariables = [], globalVariables = []) {
  if (!loopElement || !isLoopElementType(loopElement.type)) return [];
  const loopConfig = normalizeLoopConfig(loopElement.base?.loop);
  const collection = loopConfig.query?.collection ?? 'posts';
  let sourceItems = getLoopCollectionSourceItems(collection, variableSources);
  const sourceType = loopConfig.query?.source ?? 'collection';
  const categoryIds = Array.isArray(loopConfig.query?.categoryIds) ? loopConfig.query.categoryIds : [];

  if (categoryIds.length && ['posts', 'products'].includes(collection)) {
    sourceItems = sourceItems.filter((item) => {
      const itemTermIds = Array.isArray(item?.termIds) ? item.termIds : [];
      return itemTermIds.some((termId) => categoryIds.includes(parseInt(termId, 10)));
    });
  }

  if (collection !== 'pages' && (loopConfig.query?.order ?? 'desc') === 'asc') {
    sourceItems = [...sourceItems].reverse();
  }

  if (sourceType === 'selected') {
    const selectedIds = Array.isArray(loopConfig.query?.selectedIds) ? loopConfig.query.selectedIds : [];
    const sourceById = new Map(sourceItems.map((item) => [item?.id, item]));
    return selectedIds
      .map((id) => sourceById.get(id) ?? null)
      .filter((item) => item && typeof item === 'object');
  }

  if (sourceType === 'variable') {
    const variable = findLoopPreviewVariable(loopConfig, pageVariables, globalVariables);
    if (!variable || !['post', 'product'].includes(variable.type) || !variable.value || typeof variable.value !== 'object') return [];
    const normalizedId = parseInt(variable.value.id, 10) || 0;
    const matchedItem = normalizedId
      ? sourceItems.find((item) => parseInt(item?.id, 10) === normalizedId) ?? null
      : null;
    if (matchedItem) return [matchedItem];
    return [{
      id: normalizedId,
      title: typeof variable.value.title === 'string' ? variable.value.title : '',
      url: typeof variable.value.url === 'string' ? variable.value.url : '',
      postType: typeof variable.value.postType === 'string' ? variable.value.postType : (variable.type === 'product' ? 'product' : 'post'),
      image: '',
      excerpt: '',
      date: '',
    }];
  }

  return sourceItems.slice(0, Math.max(1, loopConfig.query?.limit ?? 1));
}

function buildLoopItemPreviewVariables(loopElement, variableSources = {}, pageVariables = [], globalVariables = []) {
  const previewItems = buildLoopPreviewItems(loopElement, variableSources, pageVariables, globalVariables);
  const sample = previewItems[0] && typeof previewItems[0] === 'object' ? previewItems[0] : {};
  const variableEntries = [
    {
      id: 'loop-item-title',
      scope: 'loop-item',
      type: 'string',
      name: 'Item Title',
      category: 'Loop Item',
      value: typeof sample.title === 'string' ? sample.title : '',
    },
    {
      id: 'loop-item-url',
      scope: 'loop-item',
      type: 'string',
      name: 'Item URL',
      category: 'Loop Item',
      value: typeof sample.url === 'string' ? sample.url : '',
    },
    {
      id: 'loop-item-excerpt',
      scope: 'loop-item',
      type: 'string',
      name: 'Item Excerpt',
      category: 'Loop Item',
      value: typeof sample.excerpt === 'string' ? sample.excerpt : '',
    },
    {
      id: 'loop-item-date',
      scope: 'loop-item',
      type: 'string',
      name: 'Item Date',
      category: 'Loop Item',
      value: typeof sample.date === 'string' ? sample.date : '',
    },
    {
      id: 'loop-item-image',
      scope: 'loop-item',
      type: 'image',
      name: 'Item Image',
      category: 'Loop Item',
      value: typeof sample.image === 'string' ? sample.image : '',
    },
  ];

  if (typeof sample.price === 'string' && sample.price.trim()) {
    variableEntries.push({
      id: 'loop-item-price',
      scope: 'loop-item',
      type: 'string',
      name: 'Item Price',
      category: 'Loop Item',
      value: sample.price,
    });
  }

  return normalizeVariableList(variableEntries, 'loop-item');
}

export function getLoopItemPreviewVariables(element, elements = [], variableSources = {}, pageVariables = [], globalVariables = []) {
  const loopElement = getLoopElementForTemplateDescendant(element, elements);
  return loopElement ? buildLoopItemPreviewVariables(loopElement, variableSources, pageVariables, globalVariables) : [];
}

function resolveLoopInsertionParentId(elements, parentId = null) {
  if (!parentId) return null;
  const parentElement = elements.find((candidate) => candidate.id === parentId) ?? null;
  if (!parentElement || !isLoopElementType(parentElement.type)) return parentId;
  // Manual source: children are direct items, no template redirect
  const loopSource = normalizeLoopConfig(parentElement?.base?.loop)?.source ?? 'query';
  if (loopSource === 'manual') return parentId;
  const templateRootId = getLoopTemplateRootId(parentElement, elements);
  const templateRoot = templateRootId
    ? (elements.find((candidate) => candidate.id === templateRootId) ?? null)
    : null;
  const templateIsEmpty = !!templateRoot
    && templateRoot.loopTemplateRootFor === parentElement.id
    && !loopTemplateRootHasContent(templateRoot);
  if (!templateRootId || templateIsEmpty) return parentId;
  return templateRootId;
}

function ensureLoopTemplateStructure(elements, bpId = 'desktop') {
  let nextElements = Array.isArray(elements) ? [...elements] : [];

  nextElements = nextElements.map((element) => (
    element?.loopTemplateRootFor && element.parentId !== element.loopTemplateRootFor
      ? { ...element, loopTemplateRootFor: null }
      : element
  ));

  nextElements
    .filter((element) => isLoopElementType(element?.type))
    .forEach((loopElement) => {
      // Skip template auto-creation for manual/component source modes
      const loopSource = normalizeLoopConfig(loopElement?.base?.loop)?.source ?? 'query';
      if (loopSource !== 'query') return;

      const currentLoop = nextElements.find((candidate) => candidate.id === loopElement.id) ?? loopElement;
      const directChildIds = Array.isArray(currentLoop.children) ? [...currentLoop.children] : [];
      let templateId = getLoopTemplateRootId(currentLoop, nextElements);

      if (!templateId) {
        const templateElement = createLoopTemplateElement(currentLoop, bpId);
        templateId = templateElement.id;
        nextElements = [...nextElements, templateElement];
      }

      const templateElement = nextElements.find((candidate) => candidate.id === templateId) ?? null;
      const siblingIds = directChildIds.filter((childId) => childId !== templateId);

      if (
        templateElement
        && templateElement.loopTemplateRootFor === currentLoop.id
        && (!Array.isArray(templateElement.children) || templateElement.children.length === 0)
        && siblingIds.length === 1
      ) {
        const promotedId = siblingIds[0];
        nextElements = nextElements
          .filter((candidate) => candidate.id !== templateId)
          .map((candidate) => {
            if (candidate.id === currentLoop.id) {
              return {
                ...candidate,
                children: [promotedId],
                base: {
                  ...candidate.base,
                  loop: {
                    ...normalizeLoopConfig(candidate.base?.loop),
                    templateRootId: promotedId,
                  },
                },
              };
            }
            if (candidate.id === promotedId) {
              return {
                ...candidate,
                parentId: currentLoop.id,
                loopTemplateRootFor: currentLoop.id,
              };
            }
            return candidate;
          });
        return;
      }

      nextElements = nextElements.map((candidate) => {
        if (candidate.id === currentLoop.id) {
          return {
            ...candidate,
            children: [templateId],
            base: {
              ...candidate.base,
              loop: {
                ...normalizeLoopConfig(candidate.base?.loop),
                templateRootId: templateId,
              },
            },
          };
        }
        if (candidate.id === templateId) {
          return {
            ...candidate,
            parentId: currentLoop.id,
            loopTemplateRootFor: currentLoop.id,
            children: Array.from(new Set([...(templateElement?.children ?? candidate.children ?? []), ...siblingIds])),
          };
        }
        if (siblingIds.includes(candidate.id)) {
          return { ...candidate, parentId: templateId };
        }
        return candidate;
      });
    });

  return stripAutoLoopNavigateInteractions(nextElements);
}

export function createForm(x = 80, y = 80, name) {
  const frame = createFrame(x, y, name || 'Form');
  return {
    ...frame,
    id: `frm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'form',
    name: name || 'Form',
    base: {
      ...frame.base,
      width: 360,
      height: 280,
      formConfig: getDefaultFormConfig(),
      styles: {
        ...frame.base.styles,
        backgroundColor: 'rgba(248,250,252,0.96)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.42)',
        borderStyle: 'solid',
        borderRadius: 20,
        boxShadow: '0 12px 28px rgba(15,23,42,0.08)',
        flexDirection: 'column',
        gap: 14,
        paddingTop: 18,
        paddingRight: 18,
        paddingBottom: 18,
        paddingLeft: 18,
      },
    },
  };
}

function createBaseFormField(type, x = 80, y = 80, name, config = {}) {
  return {
    id: `${getElementIdPrefix(type)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    name,
    parentId: null,
    children: [],
    base: {
      x,
      y,
      width: config.width ?? 280,
      height: config.height ?? 48,
      rotation: 0,
      locked: false,
      hidden: false,
      widthMode: config.widthMode ?? 'fixed',
      heightMode: config.heightMode ?? 'fixed',
      positionType: 'relative',
      absoluteInLayout: false,
      lockAspectRatio: false,
      minW: null,
      maxW: null,
      minH: null,
      maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      fieldName: config.fieldName ?? '',
      label: config.label ?? name,
      placeholder: config.placeholder ?? '',
      helperText: config.helperText ?? '',
      required: config.required === true,
      defaultValue: config.defaultValue ?? '',
      fieldOptions: config.fieldOptions ?? [],
      styles: {
        backgroundColor: config.backgroundColor ?? '#ffffff',
        borderRadius: config.borderRadius ?? 14,
        borderWidth: config.borderWidth ?? 1,
        borderColor: config.borderColor ?? 'rgba(15,23,42,0.12)',
        borderStyle: 'solid',
        gap: config.gap ?? FORM_STYLE_DEFAULTS.fieldGap,
        paddingTop: config.paddingTop ?? FORM_STYLE_DEFAULTS.fieldPaddingTop,
        paddingRight: config.paddingRight ?? FORM_STYLE_DEFAULTS.fieldPaddingRight,
        paddingBottom: config.paddingBottom ?? FORM_STYLE_DEFAULTS.fieldPaddingBottom,
        paddingLeft: config.paddingLeft ?? FORM_STYLE_DEFAULTS.fieldPaddingLeft,
        color: config.color ?? '#0f172a',
        checkboxAccentColor: config.checkboxAccentColor ?? FORM_STYLE_DEFAULTS.checkboxAccentColor,
        placeholderColor: config.placeholderColor ?? FORM_STYLE_DEFAULTS.placeholderColor,
        helperColor: config.helperColor ?? FORM_STYLE_DEFAULTS.helperColor,
        iconColor: config.iconColor ?? FORM_STYLE_DEFAULTS.iconColor,
        selectIcon: config.selectIcon ?? FORM_STYLE_DEFAULTS.selectIcon,
        formStatePreview: config.formStatePreview ?? FORM_STYLE_DEFAULTS.formStatePreview,
        hoverBorderColor: config.hoverBorderColor ?? FORM_STYLE_DEFAULTS.hoverBorderColor,
        hoverBackgroundColor: config.hoverBackgroundColor ?? FORM_STYLE_DEFAULTS.hoverBackgroundColor,
        focusBorderColor: config.focusBorderColor ?? FORM_STYLE_DEFAULTS.focusBorderColor,
        focusBackgroundColor: config.focusBackgroundColor ?? FORM_STYLE_DEFAULTS.focusBackgroundColor,
        focusBoxShadow: config.focusBoxShadow ?? FORM_STYLE_DEFAULTS.focusBoxShadow,
        focusRingColor: config.focusRingColor ?? FORM_STYLE_DEFAULTS.focusRingColor,
        focusRingWidth: config.focusRingWidth ?? FORM_STYLE_DEFAULTS.focusRingWidth,
        checkedBorderColor: config.checkedBorderColor ?? FORM_STYLE_DEFAULTS.checkedBorderColor,
        checkedBackgroundColor: config.checkedBackgroundColor ?? FORM_STYLE_DEFAULTS.checkedBackgroundColor,
        checkedBoxShadow: config.checkedBoxShadow ?? FORM_STYLE_DEFAULTS.checkedBoxShadow,
        stateTransitionDuration: config.stateTransitionDuration ?? FORM_STYLE_DEFAULTS.stateTransitionDuration,
        stateTransitionEasing: config.stateTransitionEasing ?? FORM_STYLE_DEFAULTS.stateTransitionEasing,
        fontFamily: config.fontFamily ?? 'Inter',
        fontWeight: config.fontWeight ?? 500,
        fontStyle: config.fontStyle ?? 'normal',
        fontSize: config.fontSize ?? 14,
        fontSizeUnit: 'px',
        lineHeight: config.lineHeight ?? 1.4,
        lineHeightUnit: 'em',
        letterSpacing: config.letterSpacing ?? 0,
        letterSpacingUnit: 'em',
        textAlign: config.textAlign ?? 'left',
        textDecoration: config.textDecoration ?? 'none',
        opacity: 1,
        mixBlendMode: 'normal',
        overflow: 'visible',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createFormTextField(x = 80, y = 80, name) {
  return createBaseFormField('text-field', x, y, name || 'Text Field', {
    placeholder: 'Type here...',
  });
}

export function createFormTextareaField(x = 80, y = 80, name) {
  return createBaseFormField('textarea-field', x, y, name || 'Textarea Field', {
    width: 280,
    height: 112,
    placeholder: 'Write a longer message...',
    helperText: 'Multi-line plain text is submitted as text.',
  });
}

export function createFormRichTextEditor(x = 80, y = 80, name) {
  return createBaseFormField('rich-text-editor', x, y, name || 'Rich Text Editor', {
    width: 280,
    height: 180,
    heightMode: 'hug',
    placeholder: 'Write formatted content...',
    helperText: 'Rich text content is submitted as HTML.',
  });
}

export function createFormDropdown(x = 80, y = 80, name) {
  return createBaseFormField('dropdown', x, y, name || 'Dropdown', {
    placeholder: 'Select an option',
    fieldOptions: getDefaultFormOptions('dropdown'),
  });
}

export function createFormCheckbox(x = 80, y = 80, name) {
  return createBaseFormField('checkbox', x, y, name || 'Checkbox', {
    width: 280,
    height: 32,
    defaultValue: false,
  });
}

export function createFormRadioGroup(x = 80, y = 80, name) {
  return createBaseFormField('radio-group', x, y, name || 'Radio Group', {
    width: 280,
    height: 112,
    fieldOptions: getDefaultFormOptions('radio-group'),
  });
}

export function createFormFileUpload(x = 80, y = 80, name) {
  return createBaseFormField('file-upload', x, y, name || 'File Upload', {
    width: 280,
    height: 108,
    placeholder: 'Drop files here or browse',
    helperText: 'Choose a file or drop it here before submitting.',
    allowMultipleFiles: false,
  });
}

export function createFormCaptcha(x = 80, y = 80, name) {
  return createBaseFormField('captcha', x, y, name || 'Captcha', {
    width: 280,
    height: 74,
    placeholder: 'Captcha provider block',
    backgroundColor: 'rgba(236,253,245,0.98)',
    borderColor: 'rgba(16,185,129,0.28)',
  });
}

export function createFormSubmitButton(x = 80, y = 80, name) {
  return {
    id: `${getElementIdPrefix('submit-button')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'submit-button',
    name: name || 'Submit Button',
    parentId: null,
    children: [],
    base: {
      x,
      y,
      width: 180,
      height: 48,
      rotation: 0,
      locked: false,
      hidden: false,
      widthMode: 'fixed',
      heightMode: 'fixed',
      positionType: 'relative',
      absoluteInLayout: false,
      lockAspectRatio: false,
      minW: null,
      maxW: null,
      minH: null,
      maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      label: 'Submit',
      styles: {
        backgroundColor: '#0f172a',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(15,23,42,0.14)',
        borderStyle: 'solid',
        gap: FORM_STYLE_DEFAULTS.fieldGap,
        paddingTop: FORM_STYLE_DEFAULTS.submitPaddingTop,
        paddingRight: FORM_STYLE_DEFAULTS.submitPaddingRight,
        paddingBottom: FORM_STYLE_DEFAULTS.submitPaddingBottom,
        paddingLeft: FORM_STYLE_DEFAULTS.submitPaddingLeft,
        color: '#ffffff',
        formButtonStatePreview: FORM_STYLE_DEFAULTS.formButtonStatePreview,
        hoverBackgroundColor: '#1f2937',
        hoverBorderColor: 'rgba(15,23,42,0.22)',
        hoverTextColor: '#ffffff',
        pressedBackgroundColor: FORM_STYLE_DEFAULTS.pressedBackgroundColor,
        pressedBorderColor: FORM_STYLE_DEFAULTS.pressedBorderColor,
        pressedTextColor: FORM_STYLE_DEFAULTS.pressedTextColor,
        processingBackgroundColor: FORM_STYLE_DEFAULTS.processingBackgroundColor,
        processingBorderColor: FORM_STYLE_DEFAULTS.processingBorderColor,
        processingTextColor: FORM_STYLE_DEFAULTS.processingTextColor,
        successBackgroundColor: FORM_STYLE_DEFAULTS.successBackgroundColor,
        successBorderColor: FORM_STYLE_DEFAULTS.successBorderColor,
        successTextColor: FORM_STYLE_DEFAULTS.successTextColor,
        errorBackgroundColor: FORM_STYLE_DEFAULTS.errorBackgroundColor,
        errorBorderColor: FORM_STYLE_DEFAULTS.errorBorderColor,
        errorTextColor: FORM_STYLE_DEFAULTS.errorTextColor,
        focusRingColor: FORM_STYLE_DEFAULTS.focusRingColor,
        focusRingWidth: FORM_STYLE_DEFAULTS.focusRingWidth,
        fontFamily: 'Inter',
        fontWeight: 600,
        fontStyle: 'normal',
        fontSize: 14,
        fontSizeUnit: 'px',
        lineHeight: 1.2,
        lineHeightUnit: 'em',
        letterSpacing: 0,
        letterSpacingUnit: 'em',
        textAlign: 'center',
        textDecoration: 'none',
        opacity: 1,
        mixBlendMode: 'normal',
        overflow: 'hidden',
        boxShadow: '0 8px 18px rgba(15,23,42,0.16)',
        zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createImage(x = 80, y = 80, name) {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'image',
    name: name || 'Image',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 160, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      src: '',
      styles: {
        backgroundColor: 'transparent',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, mixBlendMode: 'normal', objectFit: 'cover', boxShadow: '', zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createVideo(x = 80, y = 80, name) {
  return {
    id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'video',
    name: name || 'Video',
    parentId: null,
    children: [],
    base: {
      x, y, width: 320, height: 180, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      src: '',
      videoProvider: 'upload',
      videoControls: true,
      videoLoop: false,
      videoMuted: false,
      videoAutoplay: false,
      videoDisableAutoplayInBuilder: false,
      styles: {
        backgroundColor: 'transparent',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, objectFit: 'cover', boxShadow: '', zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createScrollSequence(x = 80, y = 80, name) {
  return {
    id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'scroll-sequence',
    name: name || 'Scroll Sequence',
    parentId: null,
    children: [],
    base: {
      x, y, width: 360, height: 240, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      scrollSequenceType: 'video',
      scrollSequenceSourceMode: 'library',
      scrollSequenceSrc: '',
      scrollSequenceFrames: [],
      scrollSequenceStart: 0.2,
      scrollSequenceEnd: 0.68,
      scrollSequenceStartOffsetPx: null,
      scrollSequenceEndOffsetPx: null,
      styles: {
        backgroundColor: '#050816',
        borderRadius: 16, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, mixBlendMode: 'normal', objectFit: 'cover', overflow: 'hidden', boxShadow: '', zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createEmbed(x = 80, y = 80, name) {
  return {
    id: `emb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'embed',
    name: name || 'Embed',
    parentId: null,
    children: [],
    base: {
      x, y, width: 360, height: 220, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      embedMode: 'html',
      embedCode: '',
      styles: {
        backgroundColor: '#ffffff',
        borderRadius: 12, borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.08)', borderStyle: 'solid',
        opacity: 1, mixBlendMode: 'normal', overflow: 'hidden', boxShadow: '', zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createIcon(x = 80, y = 80, name) {
  const defaultIcon = getDefaultPackedIcon();
  const iconName = defaultIcon.value;
  return {
    id: `ico-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'icon',
    name: name || 'Icon',
    parentId: null,
    children: [],
    base: {
      x, y, width: 48, height: 48, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      iconSource: 'preset',
      iconName,
      svgMarkup: defaultIcon.markup,
      styles: {
        backgroundColor: 'transparent',
        color: '#111827',
        opacity: 1,
        mixBlendMode: 'normal',
        boxShadow: '',
        zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

function createCustomShapeIcon({ x = 80, y = 80, name = 'Shape', width = 120, height = 120, markup, color = '#7c3aed', strokeWidth = 0, strokeColor = '#7c3aed' }) {
  return {
    id: `ico-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'icon',
    name,
    parentId: null,
    children: [],
    base: {
      x, y, width, height, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      iconSource: 'custom',
      iconName: name.toLowerCase().replace(/\s+/g, '-'),
      shapeType: null,
      svgMarkup: sanitizeSvgMarkup(markup),
      styles: {
        color,
        strokeWidth,
        strokeColor,
        opacity: 1,
        mixBlendMode: 'normal',
        zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

function normalizePolygonSides(value, fallback = 6) {
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(3, Math.min(12, Math.round(parsed)));
}

function roundVectorNumber(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed * 1000) / 1000;
}

function buildVectorPoint(point, fallbackX = 0, fallbackY = 0) {
  const x = roundVectorNumber(point?.x, fallbackX);
  const y = roundVectorNumber(point?.y, fallbackY);
  const inX = roundVectorNumber(point?.inX, x);
  const inY = roundVectorNumber(point?.inY, y);
  const outX = roundVectorNumber(point?.outX, x);
  const outY = roundVectorNumber(point?.outY, y);
  const mode = point?.mode === 'smooth' || point?.mode === 'corner'
    ? point.mode
    : ((isDistinctVectorHandle(x, y, inX, inY) && isDistinctVectorHandle(x, y, outX, outY)) ? 'smooth' : 'corner');
  return {
    x,
    y,
    inX,
    inY,
    outX,
    outY,
    mode,
  };
}

function lerpNumber(start, end, t) {
  return start + ((end - start) * t);
}

function lerpPoint(start, end, t) {
  return {
    x: roundVectorNumber(lerpNumber(start.x, end.x, t)),
    y: roundVectorNumber(lerpNumber(start.y, end.y, t)),
  };
}

function getMirroredHandle(anchor, handle) {
  return {
    x: roundVectorNumber((anchor.x * 2) - handle.x),
    y: roundVectorNumber((anchor.y * 2) - handle.y),
  };
}

function getHandleVector(anchor, handle) {
  return {
    dx: roundVectorNumber(handle.x - anchor.x),
    dy: roundVectorNumber(handle.y - anchor.y),
  };
}

function getHandleLength(vector) {
  return Math.hypot(vector.dx, vector.dy) || 0;
}

function createAnchorPoint(point, fallbackX = 0, fallbackY = 0) {
  const base = buildVectorPoint(point, fallbackX, fallbackY);
  return {
    ...base,
    inX: base.x,
    inY: base.y,
    outX: base.x,
    outY: base.y,
    mode: 'corner',
  };
}

function getVectorSegmentCount(data) {
  if (!data?.points?.length) return 0;
  if (data.closed) return data.points.length;
  return Math.max(0, data.points.length - 1);
}

function getVectorSegmentEndpoints(data, segmentIndex) {
  const points = data?.points ?? [];
  const startPoint = points[segmentIndex] ?? null;
  if (!startPoint) return null;
  const nextIndex = segmentIndex === points.length - 1 ? 0 : segmentIndex + 1;
  const endPoint = points[nextIndex] ?? null;
  if (!endPoint) return null;
  return {
    startIndex: segmentIndex,
    endIndex: nextIndex,
    startPoint,
    endPoint,
  };
}

function getCubicPoint(startPoint, endPoint, t) {
  const p0 = { x: startPoint.x, y: startPoint.y };
  const p1 = { x: startPoint.outX, y: startPoint.outY };
  const p2 = { x: endPoint.inX, y: endPoint.inY };
  const p3 = { x: endPoint.x, y: endPoint.y };
  const q0 = lerpPoint(p0, p1, t);
  const q1 = lerpPoint(p1, p2, t);
  const q2 = lerpPoint(p2, p3, t);
  const r0 = lerpPoint(q0, q1, t);
  const r1 = lerpPoint(q1, q2, t);
  return lerpPoint(r0, r1, t);
}

function splitVectorSegment(startPoint, endPoint, t = 0.5) {
  const p0 = { x: startPoint.x, y: startPoint.y };
  const p1 = { x: startPoint.outX, y: startPoint.outY };
  const p2 = { x: endPoint.inX, y: endPoint.inY };
  const p3 = { x: endPoint.x, y: endPoint.y };
  const q0 = lerpPoint(p0, p1, t);
  const q1 = lerpPoint(p1, p2, t);
  const q2 = lerpPoint(p2, p3, t);
  const r0 = lerpPoint(q0, q1, t);
  const r1 = lerpPoint(q1, q2, t);
  const s = lerpPoint(r0, r1, t);
  return {
    startOut: q0,
    insertedIn: r0,
    insertedAnchor: s,
    insertedOut: r1,
    endIn: q2,
  };
}

function getDistanceToSegmentSample(point, startPoint, endPoint, sampleCount = 24) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestT = 0.5;
  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const sample = getCubicPoint(startPoint, endPoint, t);
    const distance = Math.hypot(point.x - sample.x, point.y - sample.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }
  return { distance: bestDistance, t: bestT };
}

function isDistinctVectorHandle(anchorX, anchorY, handleX, handleY) {
  return Math.abs(handleX - anchorX) > 0.001 || Math.abs(handleY - anchorY) > 0.001;
}

export function normalizeVectorShapeData(data, fallbackKind = 'path') {
  const kind = data?.kind === 'line' || fallbackKind === 'line' ? 'line' : 'path';
  const rawPoints = Array.isArray(data?.points) ? data.points : [];
  const fallbackPoints = kind === 'line'
    ? [{ x: 0, y: 0 }, { x: 160, y: 0 }]
    : [{ x: 10, y: 90 }, { x: 84, y: 34 }, { x: 150, y: 24 }];
  const points = (rawPoints.length ? rawPoints : fallbackPoints).map((point, index) => {
    const fallbackPoint = fallbackPoints[Math.min(index, fallbackPoints.length - 1)] ?? fallbackPoints[0];
    return buildVectorPoint(point, fallbackPoint.x, fallbackPoint.y);
  });

  if (kind === 'line') {
    const first = points[0] ?? buildVectorPoint(null, 0, 12);
    const second = points[1] ?? buildVectorPoint(null, 160, 12);
    return {
      kind: 'line',
      closed: false,
      points: [
        { ...first, inX: first.x, inY: first.y, outX: first.x, outY: first.y },
        { ...second, inX: second.x, inY: second.y, outX: second.x, outY: second.y },
      ],
    };
  }

  return {
    kind: 'path',
    closed: data?.closed === true,
    points,
  };
}

export function setVectorAnchorMode(vectorData, pointIndex, mode = 'corner') {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  if (data.kind === 'line') return data;
  if (!['corner', 'smooth'].includes(mode)) return data;
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= data.points.length) return data;
  const points = data.points.map((point, index) => {
    if (index !== pointIndex) return { ...point };
    const nextPoint = { ...point, mode };
    if (mode === 'corner') {
      nextPoint.inX = nextPoint.x;
      nextPoint.inY = nextPoint.y;
      nextPoint.outX = nextPoint.x;
      nextPoint.outY = nextPoint.y;
      return nextPoint;
    }

    const previousIndex = pointIndex > 0 ? pointIndex - 1 : (data.closed ? data.points.length - 1 : -1);
    const nextIndex = pointIndex < data.points.length - 1 ? pointIndex + 1 : (data.closed ? 0 : -1);
    const previousPoint = previousIndex >= 0 ? data.points[previousIndex] : null;
    const followingPoint = nextIndex >= 0 ? data.points[nextIndex] : null;
    const incomingVector = getHandleVector(nextPoint, { x: nextPoint.inX, y: nextPoint.inY });
    const outgoingVector = getHandleVector(nextPoint, { x: nextPoint.outX, y: nextPoint.outY });
    const incomingLength = getHandleLength(incomingVector);
    const outgoingLength = getHandleLength(outgoingVector);
    let tangentDx = 0;
    let tangentDy = 0;
    if (previousPoint && followingPoint) {
      tangentDx = followingPoint.x - previousPoint.x;
      tangentDy = followingPoint.y - previousPoint.y;
    } else if (followingPoint) {
      tangentDx = followingPoint.x - nextPoint.x;
      tangentDy = followingPoint.y - nextPoint.y;
    } else if (previousPoint) {
      tangentDx = nextPoint.x - previousPoint.x;
      tangentDy = nextPoint.y - previousPoint.y;
    } else if (incomingLength > 0) {
      tangentDx = -incomingVector.dx;
      tangentDy = -incomingVector.dy;
    } else if (outgoingLength > 0) {
      tangentDx = outgoingVector.dx;
      tangentDy = outgoingVector.dy;
    } else {
      tangentDx = 48;
      tangentDy = 0;
    }
    const tangentLength = Math.hypot(tangentDx, tangentDy) || 1;
    const normalizedDx = tangentDx / tangentLength;
    const normalizedDy = tangentDy / tangentLength;
    const nextInLength = incomingLength || (previousPoint ? Math.max(16, Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) / 3) : 24);
    const nextOutLength = outgoingLength || (followingPoint ? Math.max(16, Math.hypot(followingPoint.x - nextPoint.x, followingPoint.y - nextPoint.y) / 3) : nextInLength);
    nextPoint.inX = roundVectorNumber(nextPoint.x - (normalizedDx * nextInLength));
    nextPoint.inY = roundVectorNumber(nextPoint.y - (normalizedDy * nextInLength));
    nextPoint.outX = roundVectorNumber(nextPoint.x + (normalizedDx * nextOutLength));
    nextPoint.outY = roundVectorNumber(nextPoint.y + (normalizedDy * nextOutLength));
    return nextPoint;
  });
  return { ...data, points };
}

export function updateVectorHandle(vectorData, pointIndex, handleKey, handlePosition, mirror = true) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  if (data.kind === 'line') return data;
  if (!['in', 'out'].includes(handleKey)) return data;
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= data.points.length) return data;
  const points = data.points.map((point, index) => {
    if (index !== pointIndex) return { ...point };
    const nextPoint = { ...point };
    const handleXKey = handleKey === 'in' ? 'inX' : 'outX';
    const handleYKey = handleKey === 'in' ? 'inY' : 'outY';
    nextPoint[handleXKey] = roundVectorNumber(handlePosition.x, nextPoint[handleXKey]);
    nextPoint[handleYKey] = roundVectorNumber(handlePosition.y, nextPoint[handleYKey]);
    if (nextPoint.mode === 'smooth' && mirror) {
      const opposite = getMirroredHandle({ x: nextPoint.x, y: nextPoint.y }, { x: nextPoint[handleXKey], y: nextPoint[handleYKey] });
      if (handleKey === 'in') {
        nextPoint.outX = opposite.x;
        nextPoint.outY = opposite.y;
      } else {
        nextPoint.inX = opposite.x;
        nextPoint.inY = opposite.y;
      }
    }
    return nextPoint;
  });
  return { ...data, points };
}

export function moveVectorAnchor(vectorData, pointIndex, nextPosition) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= data.points.length) return data;
  const points = data.points.map((point, index) => {
    if (index !== pointIndex) return { ...point };
    const dx = roundVectorNumber(nextPosition.x, point.x) - point.x;
    const dy = roundVectorNumber(nextPosition.y, point.y) - point.y;
    return {
      ...point,
      x: roundVectorNumber(point.x + dx),
      y: roundVectorNumber(point.y + dy),
      inX: roundVectorNumber(point.inX + dx),
      inY: roundVectorNumber(point.inY + dy),
      outX: roundVectorNumber(point.outX + dx),
      outY: roundVectorNumber(point.outY + dy),
    };
  });
  return { ...data, points };
}

export function insertVectorAnchorAtSegment(vectorData, segmentIndex, t = 0.5) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  if (data.kind === 'line') return { vectorData: data, insertedIndex: -1 };
  const segmentCount = getVectorSegmentCount(data);
  if (segmentCount < 1 || segmentIndex < 0 || segmentIndex >= segmentCount) return { vectorData: data, insertedIndex: -1 };
  const segment = getVectorSegmentEndpoints(data, segmentIndex);
  if (!segment) return { vectorData: data, insertedIndex: -1 };
  const split = splitVectorSegment(segment.startPoint, segment.endPoint, Math.max(0.05, Math.min(0.95, t)));
  const points = data.points.map((point) => ({ ...point }));
  points[segment.startIndex] = {
    ...points[segment.startIndex],
    outX: split.startOut.x,
    outY: split.startOut.y,
  };
  points[segment.endIndex] = {
    ...points[segment.endIndex],
    inX: split.endIn.x,
    inY: split.endIn.y,
  };
  const insertedPoint = buildVectorPoint({
    x: split.insertedAnchor.x,
    y: split.insertedAnchor.y,
    inX: split.insertedIn.x,
    inY: split.insertedIn.y,
    outX: split.insertedOut.x,
    outY: split.insertedOut.y,
    mode: 'smooth',
  }, split.insertedAnchor.x, split.insertedAnchor.y);
  const insertIndex = segment.startIndex + 1;
  points.splice(insertIndex, 0, insertedPoint);
  return { vectorData: { ...data, points }, insertedIndex: insertIndex };
}

export function removeVectorAnchor(vectorData, pointIndex) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  if (data.kind === 'line') return { vectorData: data, removed: false };
  const minimumPoints = data.closed ? 3 : 2;
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= data.points.length || data.points.length <= minimumPoints) {
    return { vectorData: data, removed: false };
  }
  const points = data.points.map((point) => ({ ...point }));
  points.splice(pointIndex, 1);
  return { vectorData: { ...data, points }, removed: true };
}

export function toggleVectorPathClosed(vectorData) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  if (data.kind === 'line' || data.points.length < 3) return data;
  return { ...data, closed: !data.closed };
}

export function findClosestVectorSegment(vectorData, worldPoint) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  const segmentCount = getVectorSegmentCount(data);
  if (segmentCount < 1) return null;
  let closest = null;
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const segment = getVectorSegmentEndpoints(data, segmentIndex);
    if (!segment) continue;
    const sample = getDistanceToSegmentSample(worldPoint, segment.startPoint, segment.endPoint);
    if (!closest || sample.distance < closest.distance) {
      closest = { segmentIndex, distance: sample.distance, t: sample.t };
    }
  }
  return closest;
}

export function scaleVectorShapeToBounds(vectorData, nextBounds) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  const startBounds = getVectorShapeBounds(data);
  const safeWidth = Math.max(1, roundVectorNumber(nextBounds.width, startBounds.width));
  const safeHeight = Math.max(1, roundVectorNumber(nextBounds.height, startBounds.height));
  const scaleX = safeWidth / Math.max(startBounds.width, 0.0001);
  const scaleY = safeHeight / Math.max(startBounds.height, 0.0001);
  return {
    ...data,
    points: data.points.map((point) => ({
      ...point,
      x: roundVectorNumber((point.x - startBounds.minX) * scaleX + (nextBounds.minX ?? 0)),
      y: roundVectorNumber((point.y - startBounds.minY) * scaleY + (nextBounds.minY ?? 0)),
      inX: roundVectorNumber((point.inX - startBounds.minX) * scaleX + (nextBounds.minX ?? 0)),
      inY: roundVectorNumber((point.inY - startBounds.minY) * scaleY + (nextBounds.minY ?? 0)),
      outX: roundVectorNumber((point.outX - startBounds.minX) * scaleX + (nextBounds.minX ?? 0)),
      outY: roundVectorNumber((point.outY - startBounds.minY) * scaleY + (nextBounds.minY ?? 0)),
    })),
  };
}

export function createVectorLineData(width = 160, height = 1) {
  const safeWidth = Math.max(1, roundVectorNumber(width, 160));
  return normalizeVectorShapeData({
    kind: 'line',
    points: [
      { x: 0, y: 0 },
      { x: safeWidth, y: 0 },
    ],
  }, 'line');
}

export function createDefaultBezierPathData(kind = 'path') {
  if (kind === 'pen') {
    return normalizeVectorShapeData({
      kind: 'path',
      closed: false,
      points: [
        { x: 10, y: 90 },
        { x: 44, y: 28 },
        { x: 85, y: 68 },
        { x: 116, y: 18 },
        { x: 150, y: 88 },
      ],
    }, 'path');
  }

  return normalizeVectorShapeData({
    kind: 'path',
    closed: false,
    points: [
      { x: 8, y: 96, outX: 32, outY: 28 },
      { x: 84, y: 34, inX: 58, inY: 16, outX: 103, outY: 47 },
      { x: 152, y: 24, inX: 113, inY: 88 },
    ],
  }, 'path');
}

export function getVectorShapeBounds(vectorData) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  const values = [];
  data.points.forEach((point) => {
    values.push({ x: point.x, y: point.y });
    if (data.kind !== 'line') {
      values.push({ x: point.inX, y: point.inY });
      values.push({ x: point.outX, y: point.outY });
    }
  });
  const xs = values.map((point) => point.x);
  const ys = values.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, roundVectorNumber(maxX - minX, 1)),
    height: Math.max(1, roundVectorNumber(maxY - minY, 1)),
  };
}

export function reframeVectorShapeData(vectorData) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  const bounds = getVectorShapeBounds(data);
  return {
    offsetX: bounds.minX,
    offsetY: bounds.minY,
    width: bounds.width,
    height: bounds.height,
    vectorData: {
      ...data,
      points: data.points.map((point) => ({
        ...point,
        x: roundVectorNumber(point.x - bounds.minX),
        y: roundVectorNumber(point.y - bounds.minY),
        inX: roundVectorNumber(point.inX - bounds.minX),
        inY: roundVectorNumber(point.inY - bounds.minY),
        outX: roundVectorNumber(point.outX - bounds.minX),
        outY: roundVectorNumber(point.outY - bounds.minY),
      })),
    },
  };
}

export function getVectorShapePathD(vectorData) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  const [firstPoint, ...restPoints] = data.points;
  if (!firstPoint) return '';
  const commands = [`M ${firstPoint.x} ${firstPoint.y}`];

  restPoints.forEach((point, index) => {
    const previous = data.points[index];
    const useCurve = data.kind !== 'line' && (
      isDistinctVectorHandle(previous.x, previous.y, previous.outX, previous.outY)
      || isDistinctVectorHandle(point.x, point.y, point.inX, point.inY)
    );
    if (useCurve) commands.push(`C ${previous.outX} ${previous.outY} ${point.inX} ${point.inY} ${point.x} ${point.y}`);
    else commands.push(`L ${point.x} ${point.y}`);
  });

  if (data.kind !== 'line' && data.closed && data.points.length > 2) {
    const lastPoint = data.points[data.points.length - 1];
    const useCurve = isDistinctVectorHandle(lastPoint.x, lastPoint.y, lastPoint.outX, lastPoint.outY)
      || isDistinctVectorHandle(firstPoint.x, firstPoint.y, firstPoint.inX, firstPoint.inY);
    if (useCurve) commands.push(`C ${lastPoint.outX} ${lastPoint.outY} ${firstPoint.inX} ${firstPoint.inY} ${firstPoint.x} ${firstPoint.y}`);
    else commands.push(`L ${firstPoint.x} ${firstPoint.y}`);
    commands.push('Z');
  }

  return commands.join(' ');
}

export function buildVectorShapeSvgMarkup(vectorData, options = {}) {
  const data = normalizeVectorShapeData(vectorData, vectorData?.kind === 'line' ? 'line' : 'path');
  const bounds = getVectorShapeBounds(data);
  const width = Math.max(1, roundVectorNumber(options.width, bounds.width));
  const height = Math.max(1, roundVectorNumber(options.height, bounds.height));
  const pathD = getVectorShapePathD(data);
  const fill = typeof options.fill === 'string' ? options.fill : 'none';
  const stroke = typeof options.stroke === 'string' ? options.stroke : '#111827';
  const strokeWidth = Math.max(0, roundVectorNumber(options.strokeWidth, 1.5));
  const lineCap = options.lineCap ?? 'round';
  const lineJoin = options.lineJoin ?? 'round';
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="${pathD}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}"/></svg>`;
}

// ── Line tool (Figma-style: rotation-based, no viewBox distortion) ──────

export function buildLineSvgMarkup(options = {}) {
  const stroke = typeof options.stroke === 'string' ? options.stroke : '#111827';
  const strokeWidth = Math.max(0.5, options.strokeWidth ?? 2);
  const lineCap = options.lineCap ?? 'round';
  return `<svg width="100%" height="100%" overflow="visible" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="50%" x2="100%" y2="50%" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${lineCap}"/></svg>`;
}

export function getLineEndpoints(element) {
  const x = element?.x ?? element?.base?.x ?? 0;
  const y = element?.y ?? element?.base?.y ?? 0;
  const w = element?.width ?? element?.base?.width ?? 100;
  const h = element?.height ?? element?.base?.height ?? 1;
  const rotDeg = element?.rotation ?? element?.base?.rotation ?? 0;
  const rad = rotDeg * Math.PI / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Rotate the left-edge and right-edge midpoints around center.
  // These match the SVG <line x1="0" y1="50%" x2="100%" y2="50%"> endpoints.
  return [
    { x: cx - (w / 2) * Math.cos(rad), y: cy - (w / 2) * Math.sin(rad) },
    { x: cx + (w / 2) * Math.cos(rad), y: cy + (w / 2) * Math.sin(rad) },
  ];
}

export function getVectorShapeData(element = null) {
  if (!element || typeof element !== 'object') return null;
  const shapeKind = getShapePresetKind(element);
  if (!shapeKind || !['path', 'pen'].includes(shapeKind)) return null;

  const raw = element.vectorData ?? element.base?.vectorData ?? null;
  if (raw) return normalizeVectorShapeData(raw, 'path');
  return createDefaultBezierPathData(shapeKind === 'pen' ? 'pen' : 'path');
}

export function buildPolygonSvgMarkup(sides = 6) {
  const count = normalizePolygonSides(sides);
  const cx = 60;
  const cy = 52;
  const radius = 48;
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count);
    const px = cx + (Math.cos(angle) * radius);
    const py = cy + (Math.sin(angle) * radius);
    return `${Math.round(px * 100) / 100},${Math.round(py * 100) / 100}`;
  }).join(' ');
  return `<svg viewBox="0 0 120 104" xmlns="http://www.w3.org/2000/svg"><polygon points="${points}" fill="currentColor"/></svg>`;
}

export function buildCircleSvgMarkup() {
  return '<svg viewBox="0 0 120 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="60" fill="currentColor"/></svg>';
}

export function getShapePresetKind(element = null) {
  if (!element || typeof element !== 'object') return null;

  const explicitType = typeof element.shapeType === 'string' && element.shapeType
    ? element.shapeType
    : (typeof element.base?.shapeType === 'string' && element.base.shapeType ? element.base.shapeType : null);
  if (explicitType) return explicitType;

  if (element.type === 'frame' || isFormContainerType(element.type)) {
    const name = `${element.name ?? element.base?.name ?? ''}`.trim().toLowerCase();
    if (name === 'circle') return 'circle';
    if (name === 'line') return 'line';
  }

  if (element.type === 'icon') {
    const iconName = `${element.iconName ?? element.base?.iconName ?? ''}`.trim().toLowerCase();
    if (iconName === 'line') return 'line';
    if (iconName === 'polygon') return 'polygon';
    if (iconName === 'path') return 'path';
    if (iconName === 'pen-path') return 'pen';
  }

  return null;
}

export function createShapePreset(shapeType, x = 80, y = 80) {
  if (shapeType === 'circle') {
    const element = createCustomShapeIcon({
      x,
      y,
      name: 'Circle',
      width: 120,
      height: 120,
      color: '#7c3aed',
      markup: buildCircleSvgMarkup(),
    });
    element.base.shapeType = 'circle';
    element.base.lockAspectRatio = true;
    element.base.styles = {
      ...element.base.styles,
      backgroundColor: 'transparent',
      color: '#7c3aed',
      borderRadius: 0,
      borderWidth: 0,
    };
    return element;
  }

  if (shapeType === 'line') {
    const lineMarkup = buildLineSvgMarkup({ stroke: '#111827', strokeWidth: 2, lineCap: 'round' });
    const element = createCustomShapeIcon({
      x,
      y,
      name: 'Line',
      width: 160,
      height: 1,
      color: 'transparent',
      strokeWidth: 2,
      strokeColor: '#111827',
      markup: lineMarkup,
    });
    element.base.shapeType = 'line';
    element.base.styles = {
      ...element.base.styles,
      backgroundColor: 'transparent',
      overflow: 'visible',
    };
    return element;
  }

  if (shapeType === 'polygon') {
    const element = createCustomShapeIcon({
      x,
      y,
      name: 'Polygon',
      width: 120,
      height: 104,
      color: '#0f766e',
      markup: buildPolygonSvgMarkup(6),
    });
    element.base.shapeType = 'polygon';
    element.base.polygonSides = 6;
    return element;
  }

  const reframedVector = reframeVectorShapeData(createDefaultBezierPathData(shapeType === 'path' ? 'path' : 'pen'));
  const vectorData = reframedVector.vectorData;
  const width = reframedVector.width;
  const height = reframedVector.height;
  const strokeColor = '#2563eb';
  const element = createCustomShapeIcon({
    x,
    y,
    name: shapeType === 'path' ? 'Path' : 'Pen Path',
    width,
    height,
    color: 'transparent',
    strokeWidth: 1.5,
    strokeColor,
    markup: buildVectorShapeSvgMarkup(vectorData, { width, height, fill: 'none', stroke: strokeColor, strokeWidth: 1.5 }),
  });
  element.base.shapeType = shapeType === 'path' ? 'path' : 'pen';
  element.base.vectorData = vectorData;
  return element;
}

export function createText(x = 80, y = 80, name) {
  const defaultText = 'Text';
  return {
    id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    name: name || 'Text',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 60, rotation: 0, locked: false, hidden: false,
      widthMode: 'hug', heightMode: 'hug',
      lockAspectRatio: false,
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      text: defaultText,
      richTextHtml: plainTextToRichTextHtml(defaultText),
      styles: {
        backgroundColor: 'transparent',
        color: '#000000',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        fontSize: 42,
        fontSizeUnit: 'px',
        letterSpacing: 0,
        letterSpacingUnit: 'em',
        lineHeight: 1.2,
        lineHeightUnit: 'em',
        textAlign: 'left',
        textDecoration: 'none',
        boxShadow: '',
        opacity: 1,
        mixBlendMode: 'normal',
        zIndex: 1,
      },
    },
    animations: makeDefaultElementAnimations(),
    overrides: { tablet: {}, mobile: {} },
  };
}

// Merge base + breakpoint overrides into rendered props.
// Cascade: desktop (base)  →  tablet  →  mobile
export function resolveElement(el, bpId) {
  if (bpId === 'desktop') return { ...el.base, styles: { ...el.base.styles } };

  const tabOv = pruneBreakpointOverride(el.overrides?.tablet ?? {}, el.base ?? {}, el.type);
  if (bpId === 'tablet') {
    return { ...el.base, ...tabOv, styles: { ...el.base.styles, ...(tabOv.styles ?? {}) } };
  }
  // mobile: base  →  tablet override  →  mobile override
  const mobOv = pruneBreakpointOverride(el.overrides?.mobile ?? {}, {
    ...el.base,
    ...tabOv,
    styles: { ...(el.base?.styles ?? {}), ...(tabOv.styles ?? {}) },
  }, el.type);
  return {
    ...el.base, ...tabOv, ...mobOv,
    styles: { ...el.base.styles, ...(tabOv.styles ?? {}), ...(mobOv.styles ?? {}) },
  };
}

export function resolveElementWithVariables(el, bpId, pageVariables = [], globalVariables = [], loopItemVariables = []) {
  const resolved = resolveElement(el, bpId);
  const bindings = normalizeElementBindings(el?.bindings);
  const variableMaps = getVariableMap(pageVariables, globalVariables, loopItemVariables);
  let next = resolved;

  Object.keys(bindings?.desktop ?? {})
    .concat(Object.keys(bindings?.tablet ?? {}), Object.keys(bindings?.mobile ?? {}))
    .filter((propertyKey, index, allKeys) => allKeys.indexOf(propertyKey) === index)
    .forEach((propertyKey) => {
      const binding = resolveElementBinding(bindings, bpId, propertyKey);
      if (!binding) return;
      const variable = variableMaps[binding.scope]?.get(binding.variableId) ?? null;
      if (!variable) return;
      next = applyVariableBindingValue(next, propertyKey, variable);
    });

  return next;
}

export function getRootElements(elements) { return elements.filter(e => !e.parentId); }

// Cascade background: tablet/mobile inherit from parent breakpoint when null
export function resolveBackground(background, bpId) {
  const bg = background ?? {};
  if (bpId === 'mobile') return bg.mobile ?? bg.tablet ?? bg.desktop ?? '#ffffff';
  if (bpId === 'tablet') return bg.tablet ?? bg.desktop ?? '#ffffff';
  return bg.desktop ?? '#ffffff';
}

export function resolvePageSmoothScroll(smoothScroll, bpId) {
  const value = smoothScroll ?? {};
  if (bpId === 'mobile') return value.mobile ?? value.tablet ?? value.desktop ?? false;
  if (bpId === 'tablet') return value.tablet ?? value.desktop ?? false;
  return value.desktop ?? false;
}

// Cascade page padding: null = inherit from parent breakpoint
const ZERO_PAD = { top: 0, right: 0, bottom: 0, left: 0 };
export function resolvePagePadding(padding, bpId) {
  const p = padding ?? {};
  if (bpId === 'mobile') return p.mobile ?? p.tablet ?? p.desktop ?? ZERO_PAD;
  if (bpId === 'tablet') return p.tablet ?? p.desktop ?? ZERO_PAD;
  return p.desktop ?? ZERO_PAD;
}

// Cascade page layout: null = inherit / disabled
export function resolvePageLayout(layout, bpId) {
  const l = layout ?? {};
  if (bpId === 'mobile') return l.mobile ?? l.tablet ?? l.desktop ?? null;
  if (bpId === 'tablet') return l.tablet ?? l.desktop ?? null;
  return l.desktop ?? null;
}
export function getChildEls(elements, parentId) {
  const parent = elements.find(e => e.id === parentId);
  if (parent?.children?.length) {
    // Return in parent.children order so reorderElementInParent is reflected
    return parent.children.map(cid => elements.find(e => e.id === cid)).filter(Boolean);
  }
  return elements.filter(e => e.parentId === parentId);
}
export function findEl(elements, id) { return elements.find(e => e.id === id) ?? null; }

export function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object') return null;

  const seen = new Set();
  const ids = [];
  const pushId = (value) => {
    if (typeof value !== 'string' || !value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };

  pushId(selection.elementId);
  (selection.elementIds ?? []).forEach(pushId);

  if (!ids.length) return null;

  const primaryId = typeof selection.elementId === 'string' && ids.includes(selection.elementId)
    ? selection.elementId
    : ids[0];
  const orderedIds = [primaryId, ...ids.filter((id) => id !== primaryId)];

  return {
    ...selection,
    elementId: primaryId,
    elementIds: orderedIds,
    bpId: selection.bpId ?? 'desktop',
  };
}

export function getSelectionElementIds(selection) {
  return normalizeSelection(selection)?.elementIds ?? [];
}

export function isElementSelected(selection, elementId, bpId = null) {
  if (!elementId) return false;
  const normalized = normalizeSelection(selection);
  if (!normalized) return false;
  if (bpId && normalized.bpId !== bpId) return false;
  return normalized.elementIds.includes(elementId);
}

function buildSelection(elementIds, bpId = 'desktop', primaryId = null) {
  const ids = Array.from(new Set((elementIds ?? []).filter((id) => typeof id === 'string' && id)));
  if (!ids.length) return null;
  const anchorId = primaryId && ids.includes(primaryId) ? primaryId : ids[0];
  return normalizeSelection({ elementId: anchorId, elementIds: ids, bpId });
}

function removeSelectionIds(selection, idsToRemove) {
  const normalized = normalizeSelection(selection);
  if (!normalized) return null;

  const blocked = new Set(idsToRemove ?? []);
  const nextIds = normalized.elementIds.filter((id) => !blocked.has(id));
  if (!nextIds.length) return null;
  return buildSelection(nextIds, normalized.bpId, nextIds[0]);
}

function collectSubtree(elements, rootId) {
  const subtree = [];
  const visit = (id) => {
    const el = findEl(elements, id);
    if (!el) return;
    subtree.push(el);
    (el.children ?? []).forEach(visit);
  };
  visit(rootId);
  return subtree;
}

function normalizeComponentSnapshot(subtree, rootId) {
  const normalized = deepClone(subtree).map((el) => {
    const next = { ...el };
    if (el.id === rootId) next.parentId = null;
    delete next.componentInstance;
    return next;
  });
  return ensureComponentPrimaryRoot(normalized);
}

function instantiateComponentSnapshot(snapshot, {
  targetRootId = null,
  targetParentId = null,
  rootPosition = null,
  bpId = 'desktop',
  componentInstance = null,
} = {}) {
  const root = getSnapshotRoot(snapshot);
  if (!root) return [];

  const idMap = {};
  snapshot.forEach((el) => {
    idMap[el.id] = el.id === root.id && targetRootId ? targetRootId : makeId(getElementIdPrefix(el.type));
  });

  return deepClone(snapshot).map((el) => {
    const isRoot = el.id === root.id;
    const mappedId = idMap[el.id];
    const next = {
      ...el,
      id: mappedId,
      parentId: isRoot ? targetParentId : (idMap[el.parentId] ?? null),
      children: (el.children ?? []).map(cid => idMap[cid]).filter(Boolean),
      overrides: deepClone(el.overrides ?? { tablet: {}, mobile: {} }),
    };

    if (bpId !== 'desktop') {
      next.base = { ...next.base, hidden: true };
      next.overrides = {
        ...next.overrides,
        [bpId]: {
          ...(next.overrides?.[bpId] ?? {}),
          hidden: false,
        },
      };
    }

    if (isRoot && rootPosition) {
      if (bpId === 'desktop') {
        next.base = { ...next.base, x: rootPosition.x, y: rootPosition.y };
      } else {
        next.overrides = {
          ...next.overrides,
          [bpId]: {
            ...(next.overrides?.[bpId] ?? {}),
            x: rootPosition.x,
            y: rootPosition.y,
          },
        };
      }
    }

    if (isRoot && componentInstance) {
      next.componentInstance = { ...componentInstance };
    } else {
      delete next.componentInstance;
    }

    return next;
  });
}

function preserveComponentRootPlacement(nextRoot, currentRoot) {
  if (!nextRoot || !currentRoot) return nextRoot;
  const layoutKeys = [
    'x', 'y', 'width', 'height', 'rotation', 'rotationX', 'rotationY',
    'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
    'minW', 'maxW', 'minH', 'maxH',
    'hidden', 'locked', 'positionType', 'absoluteInLayout', 'constraints', 'lockAspectRatio',
  ];
  const result = {
    ...nextRoot,
    parentId: currentRoot.parentId ?? null,
    base: { ...nextRoot.base, ...pick(currentRoot.base ?? {}, layoutKeys) },
    componentInstance: nextRoot.componentInstance
      ? { ...(currentRoot.componentInstance ?? {}), ...(nextRoot.componentInstance ?? {}) }
      : (currentRoot.componentInstance ? { ...currentRoot.componentInstance } : nextRoot.componentInstance),
    overrides: deepClone(nextRoot.overrides ?? { tablet: {}, mobile: {} }),
  };

  ['tablet', 'mobile'].forEach((bpId) => {
    const preserved = pick(currentRoot.overrides?.[bpId] ?? {}, [
      'x', 'y', 'width', 'height', 'rotation', 'rotationX', 'rotationY',
      'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
      'minW', 'maxW', 'minH', 'maxH',
      'hidden', 'positionType', 'absoluteInLayout', 'constraints', 'lockAspectRatio',
    ]);
    if (Object.keys(preserved).length) {
      result.overrides = {
        ...result.overrides,
        [bpId]: {
          ...(result.overrides?.[bpId] ?? {}),
          ...preserved,
        },
      };
    }
  });

  return result;
}

function replaceSubtree(elements, rootId, nextSubtree) {
  const currentRoot = findEl(elements, rootId);
  if (!currentRoot || !nextSubtree.length) return elements;

  const toDelete = new Set();
  const visit = (id) => {
    toDelete.add(id);
    const el = findEl(elements, id);
    (el?.children ?? []).forEach(visit);
  };
  visit(rootId);

  const rootNext = getSnapshotRoot(nextSubtree);
  const rootOrder = elements.filter(el => !el.parentId).map(el => el.id);
  const rootInsertIndex = currentRoot.parentId == null ? rootOrder.indexOf(rootId) : -1;
  const filtered = elements
    .filter(el => !toDelete.has(el.id))
    .map(el => ({ ...el, children: (el.children ?? []).filter(cid => !toDelete.has(cid) || cid === rootId) }));

  const replaced = filtered.map((el) => {
    if (el.id !== currentRoot.parentId) return el;
    const existing = (el.children ?? []).filter(cid => cid !== rootId);
    const insertIndex = (currentRoot.parentId ? (el.children ?? []).indexOf(rootId) : -1);
    const nextChildren = [...existing];
    if (insertIndex >= 0) nextChildren.splice(insertIndex, 0, rootNext.id);
    else nextChildren.push(rootNext.id);
    return { ...el, children: nextChildren };
  });

  if (currentRoot.parentId == null) {
    const rootIdsAfter = replaced.filter(el => !el.parentId).map(el => el.id);
    const insertionIndex = rootInsertIndex >= 0 ? Math.min(rootInsertIndex, rootIdsAfter.length) : rootIdsAfter.length;
    const rootIdSet = new Set(rootIdsAfter);
    const rootEntries = replaced.filter(el => !el.parentId);
    const nestedEntries = replaced.filter(el => el.parentId);
    const nextRootEntries = nextSubtree.filter(el => !el.parentId);
    const nextNestedEntries = nextSubtree.filter(el => el.parentId);
    const orderedRoots = [...rootEntries];
    orderedRoots.splice(insertionIndex, 0, ...nextRootEntries);
    return [...orderedRoots, ...nestedEntries, ...nextNestedEntries.filter(el => !rootIdSet.has(el.id))];
  }

  return replaced.concat(nextSubtree);
}

function upsertComponent(components, component) {
  const exists = components.some(item => item.id === component.id);
  if (exists) return components.map(item => item.id === component.id ? component : item);
  return [...components, component];
}

// ── History helpers ──────────────────────────────────────────

function snapshotPages(pages) { return JSON.stringify(pages); }

function snapshotComponentEditorState(state) {
  return JSON.stringify({
    breakpointDefs: state.breakpointDefs,
    selection: normalizeSelection(state.selection),
    artboardSel: state.artboardSel ?? null,
    hoveredId: state.hoveredId ?? null,
    drilledContainerId: state.drilledContainerId ?? null,
    pendingDraw: state.pendingDraw ?? null,
    activeCanvasTool: state.activeCanvasTool ?? 'select',
    activeCommentId: state.activeCommentId ?? null,
    leftTab: state.leftTab ?? 'layers',
    componentEditor: state.componentEditor,
  });
}

function restoreComponentEditorSnapshot(snapshot) {
  const parsed = JSON.parse(snapshot);
  return {
    activeSurface: 'component',
    breakpointDefs: parsed.breakpointDefs ?? BREAKPOINTS,
    selection: normalizeSelection(parsed.selection),
    artboardSel: parsed.artboardSel ?? null,
    hoveredId: parsed.hoveredId ?? null,
    drilledContainerId: parsed.drilledContainerId ?? null,
    pendingDraw: parsed.pendingDraw ?? null,
    activeCanvasTool: parsed.activeCanvasTool ?? 'select',
    activeCommentId: parsed.activeCommentId ?? null,
    leftTab: parsed.leftTab ?? 'layers',
    componentEditor: parsed.componentEditor
      ? { ...parsed.componentEditor, isOpen: true }
      : makeEmptyComponentEditor(),
  };
}
const MAX_HISTORY = 60;

// ── Store ────────────────────────────────────────────────────

export const useEditorStore = create((set, get) => {
  // Helper: update elements array of current page
  const withPage = (updater) =>
    set(state => {
      const syncPage = (page) => syncLoopTemplateNavigateFlows({
        ...page,
        elements: updater(page?.elements ?? []),
      });
      if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
        return {
          componentEditor: {
            ...state.componentEditor,
            page: syncPage(state.componentEditor.page ?? {}),
          },
        };
      }
      return {
        pages: state.pages.map(p =>
          p.id === state.currentPageId ? syncPage(p) : p
        ),
      };
    });

  const getEls = () => {
    const s = get();
    if (s.activeSurface === 'component' && s.componentEditor?.isOpen) {
      return s.componentEditor.page?.elements ?? [];
    }
    return s.pages.find(p => p.id === s.currentPageId)?.elements ?? [];
  };

  const getActivePage = () => {
    const s = get();
    if (s.activeSurface === 'component' && s.componentEditor?.isOpen) return s.componentEditor.page;
    return s.pages.find(p => p.id === s.currentPageId) ?? s.pages[0];
  };

  // ── Cached element-by-ID lookup ─────────────────────────
  let _cachedEls = null;
  let _cachedElsById = {};

  const getElsById = () => {
    const els = getEls();
    if (els !== _cachedEls) {
      _cachedEls = els;
      const map = {};
      for (let i = 0; i < els.length; i++) map[els[i].id] = els[i];
      _cachedElsById = map;
    }
    return _cachedElsById;
  };

  return {
    // ── Viewport ───────────────────────────────────────────
    viewport: { x: 80, y: 80, scale: 0.55 },
    setViewport: (vp) => set(state => ({
      viewport: normalizeViewportValue(
        typeof vp === 'function' ? vp(state.viewport) : vp,
        state.viewport,
      ),
    })),

    // ── Pages ──────────────────────────────────────────────
    pages: [normalizePageData(makeDefaultPage())],
    currentPageId: 'page-1',
    breakpointDefs: BREAKPOINTS,
    activeSurface: 'page',
    componentEditor: makeEmptyComponentEditor(),

    // ── Color styles (site-wide) ───────────────────────────
    colorStyles: [],
    setColorStyles: (styles) => set({ colorStyles: styles }),
    textStyles: [],
    setTextStyles: (styles) => set({ textStyles: Array.isArray(styles) ? styles : [] }),
    elementStyles: [],
    setElementStyles: (styles) => set({ elementStyles: Array.isArray(styles) ? styles : [] }),

    // ── Variables (page + site-wide) ──────────────────────
    globalVariables: [],
    setGlobalVariables: (variables) => set({ globalVariables: normalizeVariableList(variables, 'global') }),
    variableSources: { pages: [], posts: [], products: [], postCategories: [], productCategories: [], formTargets: {} },
    setVariableSources: (sources) => set({
      variableSources: {
        pages: Array.isArray(sources?.pages) ? sources.pages : [],
        posts: Array.isArray(sources?.posts) ? sources.posts : [],
        products: Array.isArray(sources?.products) ? sources.products : [],
        postCategories: Array.isArray(sources?.postCategories) ? sources.postCategories : [],
        productCategories: Array.isArray(sources?.productCategories) ? sources.productCategories : [],
        formTargets: sources?.formTargets && typeof sources.formTargets === 'object' ? sources.formTargets : {},
      },
    }),
    variablesModalOpen: false,
    setVariablesModalOpen: (open) => set({ variablesModalOpen: !!open }),
    pageSettingsModalOpen: false,
    setPageSettingsModalOpen: (open) => set({ pageSettingsModalOpen: !!open }),
    updatePageSettings: (patch = {}) => {
      set((state) => ({
        pages: state.pages.map((page) => (
          page.id === state.currentPageId
            ? {
                ...page,
                ...(patch.title != null ? { title: String(patch.title) } : {}),
                ...(patch.templateType != null ? { templateType: String(patch.templateType) } : {}),
                ...(patch.templateTarget != null ? { templateTarget: String(patch.templateTarget) } : {}),
              }
            : page
        )),
      }));
      get().pushHistory?.();
    },
    flowEditorState: { open: false, elementId: '', flowId: '' },
    openFlowEditor: (context = {}) => {
      const elementId = typeof context.elementId === 'string' ? context.elementId : '';
      let flowId = typeof context.flowId === 'string' ? context.flowId : '';
      if (elementId) {
        const page = getActivePage();
        const element = (page?.elements ?? []).find((entry) => entry.id === elementId) || null;
        if (isFormContainerType(element?.type)) {
          flowId = get().ensureFormSubmissionFlow(elementId, {
            name: `${element?.name || 'Element'} submission`,
            flowId,
          }) || flowId;
        } else if (!flowId) {
          flowId = get().ensureElementFlow(elementId, {
            triggerType: 'element-click',
            name: `${element?.name || 'Element'} interaction`,
          }) || flowId;
        }
      }
      set({
        flowEditorState: {
          open: true,
          elementId,
          flowId,
        },
      });
    },
    closeFlowEditor: () => set({ flowEditorState: { open: false, elementId: '', flowId: '' } }),

    getCurrentPageVariables() {
      return normalizeVariableList(getActivePage()?.variables, 'page');
    },

    getCurrentPageFlows(options = {}) {
      const includeLegacy = options.includeLegacy !== false;
      const page = getActivePage();
      const explicitFlows = normalizePageFlowList(page?.flows);
      if (!includeLegacy) return explicitFlows;
      return [...explicitFlows, ...getLegacyElementFlowsForPage(page)];
    },

    getAllVariables() {
      return [
        ...normalizeVariableList(get().getCurrentPageVariables(), 'page'),
        ...normalizeVariableList(get().globalVariables, 'global'),
      ];
    },

    getCompatibleVariables(propertyKey, additionalVariables = []) {
      const allowedTypes = VARIABLE_PROPERTY_COMPATIBILITY[propertyKey] ?? [];
      return [...get().getAllVariables(), ...normalizeVariableList(additionalVariables, 'loop-item')]
        .filter((variable) => allowedTypes.includes(variable.type));
    },

    async loadGlobalVariables() {
      try {
        if (window.fbData?.restUrl) {
          const data = await requestWordPressEndpoint('variables', 'framebuilder_get_variables');
          if (data.success && Array.isArray(data.variables)) {
            set({ globalVariables: normalizeVariableList(data.variables, 'global') });
          }
        } else {
          const stored = localStorage.getItem('fb_global_variables');
          if (stored) set({ globalVariables: normalizeVariableList(JSON.parse(stored), 'global') });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadGlobalVariables failed', e);
      }
    },

    async saveGlobalVariables(variables) {
      const normalizedVariables = normalizeVariableList(variables, 'global');
      set({ globalVariables: normalizedVariables });
      try {
        if (window.fbData?.restUrl) {
          await requestWordPressEndpoint('variables', 'framebuilder_save_variables', {
            method: 'POST',
            body: { variables: normalizedVariables },
          });
        } else {
          localStorage.setItem('fb_global_variables', JSON.stringify(normalizedVariables));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveGlobalVariables failed', e);
      }
    },

    async loadVariableSources() {
      try {
        if (window.fbData?.restUrl) {
          const data = await requestWordPressEndpoint('variable-sources', 'framebuilder_get_variable_sources');
          if (data.success) {
            set({
              variableSources: {
                pages: Array.isArray(data.pages) ? data.pages : [],
                posts: Array.isArray(data.posts) ? data.posts : [],
                products: Array.isArray(data.products) ? data.products : [],
                postCategories: Array.isArray(data.postCategories) ? data.postCategories : [],
                productCategories: Array.isArray(data.productCategories) ? data.productCategories : [],
                formTargets: data.formTargets && typeof data.formTargets === 'object' ? data.formTargets : {},
              },
            });
          }
        }
      } catch (e) {
        console.error('[FrameBuilder] loadVariableSources failed', e);
      }
    },

    upsertPageVariable(variable) {
      const normalizedVariable = normalizeVariableDefinition(variable, 'page');
      set((state) => ({
        pages: state.pages.map((page) => (
          page.id !== state.currentPageId
            ? page
            : {
                ...page,
                variables: (() => {
                  const currentVariables = normalizeVariableList(page.variables, 'page');
                  const existingIndex = currentVariables.findIndex((entry) => entry.id === normalizedVariable.id);
                  if (existingIndex === -1) return [...currentVariables, normalizedVariable];
                  return currentVariables.map((entry, index) => index === existingIndex ? normalizedVariable : entry);
                })(),
              }
        )),
      }));
    },

    removePageVariable(variableId) {
      set((state) => ({
        pages: state.pages.map((page) => (
          page.id !== state.currentPageId
            ? page
            : {
                ...page,
                variables: normalizeVariableList(page.variables, 'page').filter((variable) => variable.id !== variableId),
                flows: normalizePageFlowList(page.flows).map((flow) => removeVariableReferencesFromFlow(flow, 'page', variableId)).filter(Boolean),
                elements: (page.elements ?? []).map((element) => ({
                  ...element,
                  bindings: normalizeElementBindings(
                    Object.fromEntries(VARIABLE_BINDING_BREAKPOINTS.map((bpId) => [bpId, Object.fromEntries(
                      Object.entries(element.bindings?.[bpId] ?? {}).filter(([, binding]) => !(binding.scope === 'page' && binding.variableId === variableId))
                    )]))
                  ),
                  interactions: normalizeElementInteractions((element.interactions ?? []).filter((interaction) => !(interaction.type === 'set-variable' && interaction.variableScope === 'page' && interaction.variableId === variableId))),
                })),
              }
        )),
      }));
    },

    upsertGlobalVariable(variable) {
      const normalizedVariable = normalizeVariableDefinition(variable, 'global');
      const currentVariables = normalizeVariableList(get().globalVariables, 'global');
      const existingIndex = currentVariables.findIndex((entry) => entry.id === normalizedVariable.id);
      const nextVariables = existingIndex === -1
        ? [...currentVariables, normalizedVariable]
        : currentVariables.map((entry, index) => index === existingIndex ? normalizedVariable : entry);
      get().saveGlobalVariables(nextVariables);
    },

    removeGlobalVariable(variableId) {
      const nextVariables = normalizeVariableList(get().globalVariables, 'global').filter((variable) => variable.id !== variableId);
      set((state) => ({
        pages: state.pages.map((page) => ({
          ...page,
          flows: normalizePageFlowList(page.flows).map((flow) => removeVariableReferencesFromFlow(flow, 'global', variableId)).filter(Boolean),
          elements: (page.elements ?? []).map((element) => ({
            ...element,
            bindings: normalizeElementBindings(
              Object.fromEntries(VARIABLE_BINDING_BREAKPOINTS.map((bpId) => [bpId, Object.fromEntries(
                Object.entries(element.bindings?.[bpId] ?? {}).filter(([, binding]) => !(binding.scope === 'global' && binding.variableId === variableId))
              )]))
            ),
            interactions: normalizeElementInteractions((element.interactions ?? []).filter((interaction) => !(interaction.type === 'set-variable' && interaction.variableScope === 'global' && interaction.variableId === variableId))),
          })),
        })),
      }));
      get().saveGlobalVariables(nextVariables);
    },

    setElementPropertyBinding(elementId, bpId, propertyKey, binding) {
      withPage((els) => els.map((el) => {
        if (el.id !== elementId) return el;
        const nextBindings = normalizeElementBindings(el.bindings);
        const normalizedBinding = normalizeBindingDefinition(binding);
        if (normalizedBinding) nextBindings[bpId] = { ...(nextBindings[bpId] ?? {}), [propertyKey]: normalizedBinding };
        else {
          const scopedBindings = { ...(nextBindings[bpId] ?? {}) };
          delete scopedBindings[propertyKey];
          nextBindings[bpId] = scopedBindings;
        }
        return { ...el, bindings: nextBindings };
      }));
    },

    getElementPropertyBinding(elementId, bpId, propertyKey) {
      const element = findEl(getEls(), elementId);
      if (!element) return null;
      return resolveElementBinding(element.bindings, bpId, propertyKey);
    },

    setElementInteractions(elementId, interactions) {
      withPage((els) => els.map((el) => (
        el.id === elementId
          ? { ...el, interactions: normalizeElementInteractions(interactions) }
          : el
      )));
    },

    upsertPageFlow(flow) {
      const normalizedFlow = normalizePageFlow(flow);
      if (!normalizedFlow) return;
      get().updateCurrentPage((page) => {
        const flows = normalizePageFlowList(page?.flows);
        const existingIndex = flows.findIndex((entry) => entry.id === normalizedFlow.id);
        return {
          ...page,
          flows: existingIndex === -1
            ? [...flows, normalizedFlow]
            : flows.map((entry, index) => (index === existingIndex ? normalizedFlow : entry)),
        };
      });
    },

    removePageFlow(flowId) {
      if (!flowId) return;
      get().updateCurrentPage((page) => ({
        ...page,
        flows: normalizePageFlowList(page?.flows).filter((flow) => flow.id !== flowId),
      }));
    },

    ensureElementFlow(elementId, options = {}) {
      if (!elementId) return null;
      const page = getActivePage();
      const element = (page?.elements ?? []).find((entry) => entry.id === elementId) || null;
      const requestedTriggerType = typeof options.triggerType === 'string' && FLOW_TRIGGER_TYPES.has(options.triggerType)
        ? options.triggerType
        : (isFormContainerType(element?.type) ? 'form-submit' : 'element-click');
      const existing = normalizePageFlowList(page?.flows).find((flow) => (
        requestedTriggerType === 'form-submit'
          ? flow.trigger?.type === 'form-submit' && flow.trigger?.formId === elementId
          : flow.trigger?.type === 'element-click' && flow.trigger?.elementId === elementId
      )) || null;
      if (existing) return existing.id;
      if (element?.loopTemplateRootFor && loopTemplateRootHasContent(element) && requestedTriggerType === 'element-click') {
        const autoFlow = buildAutoLoopNavigateFlow(element);
        if (!autoFlow) return null;
        get().updateCurrentPage((currentPage) => syncLoopTemplateNavigateFlows({
          ...currentPage,
          flows: [...normalizePageFlowList(currentPage?.flows), autoFlow],
        }));
        return autoFlow.id;
      }
      const triggerNodeId = makeId('flow-node');
      const flowName = typeof options.name === 'string' && options.name.trim()
        ? options.name.trim()
        : `${element?.name || 'Element'} ${requestedTriggerType === 'form-submit' ? 'submission' : 'interaction'}`;
      const flow = normalizePageFlow({
        id: makeId('flow'),
        name: flowName,
        trigger: requestedTriggerType === 'form-submit'
          ? { type: 'form-submit', formId: elementId }
          : { type: 'element-click', elementId, event: 'click' },
        nodes: [{
          id: triggerNodeId,
          type: 'trigger',
          label: 'Trigger',
          position: { x: 0, y: 0 },
          config: requestedTriggerType === 'form-submit'
            ? { triggerType: 'form-submit', formId: elementId }
            : { triggerType: 'element-click', elementId, event: 'click' },
        }],
        edges: [],
      });
      if (!flow) return null;
      get().updateCurrentPage((currentPage) => syncLoopTemplateNavigateFlows({
        ...currentPage,
        flows: [...normalizePageFlowList(currentPage?.flows), flow],
      }));
      return flow.id;
    },

    ensureFormSubmissionFlow(formId, options = {}) {
      if (!formId) return null;
      const page = getActivePage();
      const { flow, flows, didChange } = canonicalizeFormSubmissionFlowList(page?.flows, page?.elements, formId, {
        name: typeof options.name === 'string' ? options.name : '',
        preferredFlowId: typeof options.flowId === 'string' ? options.flowId : '',
      });
      if (!flow) return null;
      if (!didChange) return flow.id;
      get().updateCurrentPage((currentPage) => ({
        ...currentPage,
        flows,
      }));
      return flow.id;
    },

    migrateLegacyElementInteractionsToFlow(elementId) {
      if (!elementId) return null;
      const page = getActivePage();
      const element = (page?.elements ?? []).find((entry) => entry.id === elementId) ?? null;
      const legacyFlow = buildLegacyFlowFromElement(element);
      if (!legacyFlow) return null;
      get().updateCurrentPage((currentPage) => ({
        ...currentPage,
        flows: [...normalizePageFlowList(currentPage?.flows), legacyFlow],
        elements: (currentPage?.elements ?? []).map((entry) => (
          entry.id === elementId
            ? { ...entry, interactions: [] }
            : entry
        )),
      }));
      return legacyFlow.id;
    },

    // ── Components (site-wide) ─────────────────────────────
    components: [],
    setComponents: (components) => set({ components }),



    async loadComponents() {
      try {
        if (window.fbData?.restUrl) {
          const data = await requestWordPressEndpoint('components', 'framebuilder_get_components');
          if (data.success && Array.isArray(data.components)) {
            set({ components: data.components.map(normalizeStoredComponent) });
          }
        } else {
          const stored = localStorage.getItem('fb_component_library');
          if (stored) set({ components: JSON.parse(stored).map(normalizeStoredComponent) });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadComponents failed', e);
      }
    },

    async saveComponents(components, options = {}) {
      const { throwOnError = false } = options;
      const normalizedComponents = components.map(normalizeStoredComponent);
      const currentComponents = get().components ?? [];
      if (JSON.stringify(currentComponents) !== JSON.stringify(normalizedComponents)) {
        set({ components: normalizedComponents });
      }
      try {
        if (window.fbData?.restUrl) {
          await requestWordPressEndpoint('components', 'framebuilder_save_components', {
            method: 'POST',
            body: { components: normalizedComponents },
          });
        } else {
          localStorage.setItem('fb_component_library', JSON.stringify(normalizedComponents));
        }
        return normalizedComponents;
      } catch (e) {
        console.error('[FrameBuilder] saveComponents failed', e);
        if (throwOnError) throw e;
      }
      return normalizedComponents;
    },

    createComponentFromElement(elementId, name) {
      const elements = get().pages.find(p => p.id === get().currentPageId)?.elements ?? [];
      const rootEl = findEl(elements, elementId);
      if (!rootEl) return { error: 'Selected layer no longer exists.' };
      if (rootEl.componentRoot) return { error: 'This layer is already a component root.' };
      if (rootEl.componentInstance) return { error: 'Detach or edit the component source before creating a new component from an instance root.' };
      if (get().activeSurface === 'page') {
        let ancestorId = rootEl.parentId ?? null;
        while (ancestorId) {
          const ancestor = findEl(elements, ancestorId);
          if (!ancestor) break;
          if (ancestor.componentInstance) {
            return { error: 'Cannot create a component from a layer inside another component instance.' };
          }
          ancestorId = ancestor.parentId ?? null;
        }
      }
      const activeBpId = get().selection?.bpId ?? 'desktop';
      const resolvedRoot = resolveElement(rootEl, activeBpId);

      const subtree = collectSubtree(elements, elementId);
      const componentId = makeId('cmp');
      const primaryVariant = normalizeComponentVariant({
        name: 'Primary',
        snapshot: normalizeComponentSnapshot(subtree, elementId),
      }, 'Primary', { primary: true });
      const now = Date.now();
      const component = {
        id: componentId,
        name: name?.trim() || rootEl.name || 'Component',
        createdAt: now,
        updatedAt: now,
        defaultVariantId: primaryVariant.id,
        controls: [],
        variants: [primaryVariant],
        snapshot: primaryVariant.snapshot,
      };

      const nextComponents = upsertComponent(get().components, component);
      get().saveComponents(nextComponents);

      const instantiated = instantiateComponentSnapshot(primaryVariant.snapshot, {
        targetRootId: elementId,
        targetParentId: rootEl.parentId ?? null,
        rootPosition: { x: resolvedRoot.x ?? rootEl.base?.x ?? 0, y: resolvedRoot.y ?? rootEl.base?.y ?? 0 },
        bpId: activeBpId,
        componentInstance: { componentId, variantId: primaryVariant.id, role: 'main' },
      });
      const wrapperRoot = getSnapshotRoot(instantiated);
      const patched = instantiated.map((el) => (
        el.id === wrapperRoot?.id ? preserveComponentRootPlacement(el, rootEl) : el
      ));
      withPage(els => replaceSubtree(els, elementId, patched));
      set({ selection: buildSelection([elementId], get().selection?.bpId ?? 'desktop', elementId), artboardSel: null });

      return { componentId };
    },

    insertComponentInstance(componentId, { x = 80, y = 80, bpId = 'desktop', parentId = null } = {}) {
      const component = get().components.find(item => item.id === componentId);
      const resolvedParentId = resolveLoopInsertionParentId(getEls(), parentId);
      const { instantiated, root } = buildComponentInstanceSubtree(component, {
        targetParentId: resolvedParentId,
        rootPosition: { x, y },
        bpId,
        role: 'instance',
        getState: get,
      });
      if (!root) return null;

      withPage((els) => {
        let next = [...els, ...instantiated];
        if (resolvedParentId) {
          next = next.map(el => (
            el.id === resolvedParentId
              ? { ...el, children: [...(el.children ?? []), root.id] }
              : el
          ));
        }
        return ensureLoopTemplateStructure(next, bpId);
      });
      set({ selection: buildSelection([root.id], bpId, root.id) });
      return root.id;
    },

    applyComponentToInstances(componentId) {
      const component = get().components.find(item => item.id === componentId);
      if (!component?.variants?.length) return;

      withPage((els) => {
        let nextEls = els;
        const roots = nextEls.filter(el => el.componentInstance?.componentId === componentId);
        roots.forEach((rootEl) => {
          const { instantiated, root: rootNext } = buildComponentInstanceSubtree(component, {
            rootEl,
            targetRootId: rootEl.id,
            targetParentId: rootEl.parentId ?? null,
            variantId: rootEl.componentInstance?.variantId ?? component.defaultVariantId,
            props: rootEl.componentInstance?.props ?? {},
            role: rootEl.componentInstance?.role ?? 'instance',
            getState: get,
          });
          if (!rootNext) return;
          const patched = instantiated.map(el => (
            el.id === rootNext.id ? preserveComponentRootPlacement(el, rootEl) : el
          ));
          nextEls = replaceSubtree(nextEls, rootEl.id, patched);
        });
        return nextEls;
      });
    },

    changeComponentInstanceVariant(elementId, variantId) {
      const rootEl = findEl(getEls(), elementId);
      const componentId = rootEl?.componentInstance?.componentId;
      if (!rootEl || !componentId) return;

      const component = get().components.find((item) => item.id === componentId);

      withPage((els) => {
        const { instantiated, root: rootNext } = buildComponentInstanceSubtree(component, {
          rootEl,
          targetRootId: rootEl.id,
          targetParentId: rootEl.parentId ?? null,
          variantId,
          props: rootEl.componentInstance?.props ?? {},
          role: rootEl.componentInstance?.role ?? 'instance',
          getState: get,
        });
        if (!rootNext) return els;
        const patched = instantiated.map((el) => (
          el.id === rootNext.id ? preserveComponentRootPlacement(el, rootEl) : el
        ));
        return replaceSubtree(els, rootEl.id, patched);
      });

      set((state) => {
        const current = normalizeSelection(state.selection);
        if (!current?.elementIds.includes(elementId)) return state;
        return {
          selection: buildSelection(current.elementIds, current.bpId, elementId),
        };
      });
    },

    updateComponentInstanceProp(elementId, controlId, value) {
      const rootEl = findEl(getEls(), elementId);
      const componentId = rootEl?.componentInstance?.componentId;
      if (!rootEl || !componentId || typeof controlId !== 'string' || !controlId) return;

      const component = get().components.find((item) => item.id === componentId);
      const control = component?.controls?.find((entry) => entry.id === controlId) ?? null;
      if (!component || !control) return;

      const currentProps = normalizeComponentInstanceProps(component, rootEl.componentInstance?.props ?? {});
      const nextValue = normalizeComponentControlValue(control.type, value, control.options ?? []);
      const nextProps = {
        ...currentProps,
        [controlId]: nextValue,
      };

      withPage((els) => {
        const { instantiated, root: rootNext } = buildComponentInstanceSubtree(component, {
          rootEl,
          targetRootId: rootEl.id,
          targetParentId: rootEl.parentId ?? null,
          variantId: rootEl.componentInstance?.variantId ?? component.defaultVariantId,
          props: nextProps,
          propBindings: rootEl.componentInstance?.bindings ?? {},
          role: rootEl.componentInstance?.role ?? 'instance',
          getState: get,
        });
        if (!rootNext) return els;
        const patched = instantiated.map((el) => (
          el.id === rootNext.id ? preserveComponentRootPlacement(el, rootEl) : el
        ));
        return replaceSubtree(els, rootEl.id, patched);
      });
    },

    setComponentInstancePropBinding(elementId, controlId, binding) {
      const rootEl = findEl(getEls(), elementId);
      const componentId = rootEl?.componentInstance?.componentId;
      if (!rootEl || !componentId || typeof controlId !== 'string' || !controlId) return;

      const component = get().components.find((item) => item.id === componentId);
      const control = component?.controls?.find((entry) => entry.id === controlId) ?? null;
      if (!component || !control) return;

      const nextBindings = normalizeComponentInstancePropBindings(rootEl.componentInstance?.bindings ?? {});
      const normalizedBinding = normalizeBindingDefinition(binding);
      if (normalizedBinding) nextBindings[controlId] = normalizedBinding;
      else delete nextBindings[controlId];

      withPage((els) => {
        const { instantiated, root: rootNext } = buildComponentInstanceSubtree(component, {
          rootEl,
          targetRootId: rootEl.id,
          targetParentId: rootEl.parentId ?? null,
          variantId: rootEl.componentInstance?.variantId ?? component.defaultVariantId,
          props: rootEl.componentInstance?.props ?? {},
          propBindings: nextBindings,
          role: rootEl.componentInstance?.role ?? 'instance',
          getState: get,
        });
        if (!rootNext) return els;
        const patched = instantiated.map((el) => (
          el.id === rootNext.id ? preserveComponentRootPlacement(el, rootEl) : el
        ));
        return replaceSubtree(els, rootEl.id, patched);
      });
    },

    setComponentEditorActiveVariant(variantId) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        return {
          componentEditor: {
            ...state.componentEditor,
            activeVariantId: variantId,
          },
        };
      });
    },

    deleteComponent(componentId) {
      const nextComponents = get().components.filter(component => component.id !== componentId);
      get().saveComponents(nextComponents);
      withPage((els) => els.map((el) => {
        if (el.componentInstance?.componentId !== componentId) return el;
        const next = { ...el };
        delete next.componentInstance;
        return next;
      }));

      const state = get();
      if (state.componentEditor?.isOpen && state.componentEditor.componentId === componentId) {
        set({
          activeSurface: 'page',
          selection: normalizeSelection(state.componentEditor.uiRestore?.selection),
          artboardSel: state.componentEditor.uiRestore?.artboardSel ?? null,
          hoveredId: state.componentEditor.uiRestore?.hoveredId ?? null,
          drilledContainerId: state.componentEditor.uiRestore?.drilledContainerId ?? null,
          pendingDraw: state.componentEditor.uiRestore?.pendingDraw ?? null,
          leftTab: state.componentEditor.uiRestore?.leftTab ?? 'layers',
          breakpointDefs: state.componentEditor.uiRestore?.breakpointDefs ?? BREAKPOINTS,
          componentEditor: makeEmptyComponentEditor(),
          componentHistory: [],
          componentHistoryIndex: -1,
        });
      }
    },

    openComponentEditor(componentId) {
      const component = get().components.find(item => item.id === componentId);
      if (!component) return;

      const normalizedComponent = normalizeStoredComponent(component);
      const editorCanvas = buildComponentEditorElements(normalizedComponent);
      const componentBreakpoints = makeComponentEditorBreakpoints(editorCanvas.elements);
      const initialVariantId = normalizedComponent.variants?.[0]?.id ?? null;
      const initialRoot = initialVariantId ? getEditorVariantRoot(editorCanvas.elements, initialVariantId) : null;

      const freshState = get();
      const uiRestore = {
        selection: freshState.selection,
        artboardSel: freshState.artboardSel,
        hoveredId: freshState.hoveredId,
        activeCommentId: freshState.activeCommentId,
        activeCanvasTool: freshState.activeCanvasTool,
        drilledContainerId: freshState.drilledContainerId,
        pendingDraw: freshState.pendingDraw,
        leftTab: freshState.leftTab,
        breakpointDefs: deepClone(freshState.breakpointDefs),
      };

      const nextComponentEditor = {
        isOpen: true,
        componentId,
        activeVariantId: initialVariantId,
        controls: deepClone(normalizedComponent.controls ?? []),
        variants: deepClone(normalizedComponent.variants ?? []),
        page: {
          ...makeComponentEditorPage(),
          title: normalizedComponent.name,
          elements: editorCanvas.elements,
        },
        breakpointDefs: deepClone(componentBreakpoints),
        uiRestore,
      };

      const nextSelection = initialRoot ? buildSelection([initialRoot.id], 'desktop', initialRoot.id) : null;
      const initialHistoryEntry = snapshotComponentEditorState({
        breakpointDefs: deepClone(componentBreakpoints),
        selection: nextSelection,
        artboardSel: null,
        hoveredId: null,
        layerHoveredId: null,
        drilledContainerId: null,
        pendingDraw: null,
        leftTab: 'layers',
        componentEditor: nextComponentEditor,
      });

      set({
        activeSurface: 'component',
        breakpointDefs: deepClone(componentBreakpoints),
        leftTab: 'layers',
        selection: nextSelection,
        artboardSel: null,
        hoveredId: null,
        layerHoveredId: null,
        activeCommentId: null,
        activeCanvasTool: freshState.activeCanvasTool === 'comment' ? 'select' : freshState.activeCanvasTool,
        drilledContainerId: null,
        pendingDraw: null,
        componentEditor: nextComponentEditor,
        componentHistory: [initialHistoryEntry],
        componentHistoryIndex: 0,
      });
    },

    selectComponentEditorVariant(variantId) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        const root = getEditorVariantRoot(state.componentEditor.page?.elements ?? [], variantId);
        return {
          selection: root ? buildSelection([root.id], 'desktop', root.id) : normalizeSelection(state.selection),
          componentEditor: {
            ...state.componentEditor,
            activeVariantId: variantId,
          },
        };
      });
    },

    updateComponentEditorVariantInteraction(variantId, interaction) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        return {
          componentEditor: {
            ...state.componentEditor,
            variants: (state.componentEditor.variants ?? []).map((variant) => {
              if (variant.id !== variantId) return variant;
              if (!isDefaultComponentVariant(variant)) return { ...variant, interaction: null };
              if (!interaction?.targetVariantId) return { ...variant, interaction: null };
              const nextInteraction = normalizeComponentInteraction({
                ...variant.interaction,
                ...interaction,
              });
              return {
                ...variant,
                interaction: nextInteraction,
              };
            }),
          },
        };
      });
    },

    updateComponentEditorVariantChildTransition(variantId, transition) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        return {
          componentEditor: {
            ...state.componentEditor,
            variants: (state.componentEditor.variants ?? []).map((variant) => {
              if (variant.id !== variantId) return variant;
              if (!isDefaultComponentVariant(variant)) return { ...variant, childTransition: null };
              return {
                ...variant,
                childTransition: normalizeComponentTransition(transition),
              };
            }),
          },
        };
      });
    },

    addComponentEditorControl(initialControl = {}) {
      let createdId = null;
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        const nextControl = normalizeComponentControl({
          label: 'New Control',
          type: 'text',
          defaultValue: '',
          bindings: [],
          ...initialControl,
        }, (state.componentEditor.controls ?? []).length);
        createdId = nextControl.id;
        return {
          componentEditor: {
            ...state.componentEditor,
            controls: [...(state.componentEditor.controls ?? []), nextControl],
          },
        };
      });
      return createdId;
    },

    updateComponentEditorControl(controlId, updates) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        const controls = state.componentEditor.controls ?? [];
        const index = controls.findIndex((control) => control.id === controlId);
        if (index === -1) return state;
        const nextControls = controls.map((control, controlIndex) => (
          control.id === controlId
            ? normalizeComponentControl({ ...control, ...updates }, controlIndex)
            : normalizeComponentControl(control, controlIndex)
        ));
        return {
          componentEditor: {
            ...state.componentEditor,
            controls: nextControls,
          },
        };
      });
    },

    bindComponentEditorControlToProperty(controlId, elementId, property) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen || !controlId || !elementId || !property) return state;
        const controls = state.componentEditor.controls ?? [];
        const index = controls.findIndex((control) => control.id === controlId);
        if (index === -1) return state;
        const nextControls = controls.map((control, controlIndex) => {
          const filteredBindings = (control.bindings ?? []).filter((binding) => !(binding.elementId === elementId && binding.property === property));
          const nextControl = control.id === controlId
            ? { ...control, bindings: [...filteredBindings, { elementId, property }] }
            : { ...control, bindings: filteredBindings };
          return normalizeComponentControl(nextControl, controlIndex);
        });
        return {
          componentEditor: {
            ...state.componentEditor,
            controls: nextControls,
          },
        };
      });
    },

    clearComponentEditorControlBinding(elementId, property) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen || !elementId || !property) return state;
        return {
          componentEditor: {
            ...state.componentEditor,
            controls: (state.componentEditor.controls ?? []).map((control, controlIndex) => normalizeComponentControl({
              ...control,
              bindings: (control.bindings ?? []).filter((binding) => !(binding.elementId === elementId && binding.property === property)),
            }, controlIndex)),
          },
        };
      });
    },

    updateComponentEditorElementInteraction(elementId, interaction) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen || !elementId) return state;
        return {
          componentEditor: {
            ...state.componentEditor,
            page: {
              ...state.componentEditor.page,
              elements: (state.componentEditor.page?.elements ?? []).map((element) => (
                element.id === elementId
                  ? {
                      ...element,
                      base: {
                        ...element.base,
                        componentInteraction: normalizeComponentInteraction(interaction),
                      },
                    }
                  : element
              )),
            },
          },
        };
      });
    },

    removeComponentEditorControl(controlId) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        return {
          componentEditor: {
            ...state.componentEditor,
            controls: (state.componentEditor.controls ?? []).filter((control) => control.id !== controlId),
          },
        };
      });
    },

    addComponentVariant() {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        const syncedVariants = syncComponentEditorVariants(state.componentEditor);
        const componentLike = {
          variants: syncedVariants,
          defaultVariantId: syncedVariants.find(isDefaultComponentVariant)?.id ?? null,
        };
        const sourceVariantId = state.componentEditor.activeVariantId ?? componentLike.defaultVariantId;
        if (!sourceVariantId) return state;
        const primarySnapshot = composeVariantSnapshot(componentLike, componentLike.defaultVariantId);
        const sourceSnapshot = composeVariantSnapshot(componentLike, sourceVariantId);
        const newVariant = normalizeComponentVariant({
          name: `Variant ${getDefaultComponentVariants(componentLike).length + 1}`,
          mode: 'default',
          snapshot: extractVariantOverrides(primarySnapshot, sourceSnapshot),
        }, `Variant ${getDefaultComponentVariants(componentLike).length + 1}`);
        const nextVariants = insertVariantAfterFamily(syncedVariants, sourceVariantId, newVariant);
        const editorCanvas = buildComponentEditorElements({ variants: nextVariants });
        const nextBreakpoints = makeComponentEditorBreakpoints(editorCanvas.elements);
        const newRoot = getEditorVariantRoot(editorCanvas.elements, newVariant.id);
        return {
          breakpointDefs: deepClone(nextBreakpoints),
          selection: newRoot ? buildSelection([newRoot.id], 'desktop', newRoot.id) : normalizeSelection(state.selection),
          componentEditor: {
            ...state.componentEditor,
            activeVariantId: newVariant.id,
            variants: nextVariants,
            page: {
              ...state.componentEditor.page,
              elements: editorCanvas.elements,
            },
            breakpointDefs: deepClone(nextBreakpoints),
          },
        };
      });
    },

    ensureComponentEditorVariantState(stateMode, sourceVariantId = null) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return state;
        if (!COMPONENT_VARIANT_STATE_ORDER.includes(stateMode)) return state;

        const syncedVariants = syncComponentEditorVariants(state.componentEditor);
        const baseVariantId = getBaseComponentVariantId(syncedVariants, sourceVariantId ?? state.componentEditor.activeVariantId);
        if (!baseVariantId) return state;

        const existingState = syncedVariants.find((variant) => variant.mode === stateMode && variant.parentVariantId === baseVariantId) ?? null;
        const componentLike = {
          variants: syncedVariants,
          defaultVariantId: syncedVariants.find(isDefaultComponentVariant)?.id ?? null,
        };

        if (existingState) {
          const existingRoot = getEditorVariantRoot(state.componentEditor.page?.elements ?? [], existingState.id);
          return {
            selection: existingRoot ? buildSelection([existingRoot.id], 'desktop', existingRoot.id) : normalizeSelection(state.selection),
            componentEditor: {
              ...state.componentEditor,
              activeVariantId: existingState.id,
              variants: syncedVariants,
            },
          };
        }

        const nextStateVariant = normalizeComponentVariant({
          mode: stateMode,
          parentVariantId: baseVariantId,
          snapshot: [],
        }, getComponentVariantStateLabel(stateMode));
        const nextVariants = insertStateVariant(syncedVariants, baseVariantId, nextStateVariant);
        const editorCanvas = buildComponentEditorElements({ variants: nextVariants, defaultVariantId: componentLike.defaultVariantId });
        const nextBreakpoints = makeComponentEditorBreakpoints(editorCanvas.elements);
        const nextRoot = getEditorVariantRoot(editorCanvas.elements, nextStateVariant.id);

        return {
          breakpointDefs: deepClone(nextBreakpoints),
          selection: nextRoot ? buildSelection([nextRoot.id], 'desktop', nextRoot.id) : normalizeSelection(state.selection),
          componentEditor: {
            ...state.componentEditor,
            activeVariantId: nextStateVariant.id,
            variants: nextVariants,
            page: {
              ...state.componentEditor.page,
              elements: editorCanvas.elements,
            },
            breakpointDefs: deepClone(nextBreakpoints),
          },
        };
      });
    },

    closeComponentEditor() {
      const state = get();
      if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return;
      const current = state.componentEditor;
      const nextComponents = state.components.map(component => (
          component.id === current.componentId
            ? normalizeStoredComponent({
                ...component,
                updatedAt: Date.now(),
                defaultVariantId: component.defaultVariantId ?? syncComponentEditorVariants(current)[0]?.id ?? null,
                controls: current.controls ?? component.controls ?? [],
                variants: syncComponentEditorVariants(current),
                snapshot: syncComponentEditorVariants(current)[0]?.snapshot ?? [],
              })
            : component
        ));
      set({
        activeSurface: 'page',
        selection: normalizeSelection(current.uiRestore?.selection),
        artboardSel: current.uiRestore?.artboardSel ?? null,
        hoveredId: current.uiRestore?.hoveredId ?? null,
        layerHoveredId: null,
        activeCommentId: current.uiRestore?.activeCommentId ?? null,
        activeCanvasTool: current.uiRestore?.activeCanvasTool ?? 'select',
        drilledContainerId: current.uiRestore?.drilledContainerId ?? null,
        pendingDraw: current.uiRestore?.pendingDraw ?? null,
        leftTab: current.uiRestore?.leftTab ?? 'layers',
        breakpointDefs: current.uiRestore?.breakpointDefs ?? BREAKPOINTS,
        componentEditor: makeEmptyComponentEditor(),
        componentHistory: [],
        componentHistoryIndex: -1,
      });
      if (!isStorage) {
        get().saveComponents(nextComponents);
        get().applyComponentToInstances(current.componentId);
      }
    },

    updateEditingComponentMeta(updates = {}) {
      set((state) => {
        if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen || !state.componentEditor.componentId) return state;
        if (!Object.prototype.hasOwnProperty.call(updates, 'name')) return state;
        const resolvedName = `${updates.name ?? ''}`.trim() || 'Untitled Component';
        return {
          components: state.components.map((component) => (
            component.id === state.componentEditor.componentId
              ? { ...component, name: resolvedName, updatedAt: Date.now() }
              : component
          )),
          componentEditor: {
            ...state.componentEditor,
            page: {
              ...state.componentEditor.page,
              title: resolvedName,
            },
          },
        };
      });
    },

    repairComponentEditorState() {
      const state = get();
      if (state.activeSurface !== 'component') {
        if (state.componentEditor?.isOpen) {
          set({ componentEditor: makeEmptyComponentEditor(), componentHistory: [], componentHistoryIndex: -1 });
        }
        return false;
      }

      const editor = state.componentEditor;
      if (!editor?.isOpen || !editor.componentId) {
        set(buildComponentEditorResetState(editor, state.breakpointDefs));
        return true;
      }

      const component = state.components.find((entry) => entry.id === editor.componentId) ?? null;
      if (!component) {
        set(buildComponentEditorResetState(editor, state.breakpointDefs));
        return true;
      }

      const syncedVariants = syncComponentEditorVariants(editor);
      const activeVariantExists = syncedVariants.some((variant) => variant.id === editor.activeVariantId);
      const nextActiveVariantId = activeVariantExists
        ? editor.activeVariantId
        : (getPrimaryComponentVariant({ variants: syncedVariants })?.id ?? null);
      const hasEditorRoots = (editor.page?.elements ?? []).some((el) => !el.parentId && el.componentRoot);

      if (!hasEditorRoots) {
        const normalizedComponent = normalizeStoredComponent({
          ...component,
          variants: syncedVariants,
          defaultVariantId: component.defaultVariantId ?? syncedVariants[0]?.id ?? null,
        });
        const editorCanvas = buildComponentEditorElements(normalizedComponent);
        const componentBreakpoints = makeComponentEditorBreakpoints(editorCanvas.elements);
        const nextRoot = nextActiveVariantId ? getEditorVariantRoot(editorCanvas.elements, nextActiveVariantId) : null;
        set({
          breakpointDefs: deepClone(componentBreakpoints),
          selection: nextRoot ? buildSelection([nextRoot.id], 'desktop', nextRoot.id) : normalizeSelection(state.selection),
          componentEditor: {
            ...editor,
            isOpen: true,
            activeVariantId: nextActiveVariantId,
            controls: deepClone(normalizedComponent.controls ?? []),
            variants: deepClone(normalizedComponent.variants ?? []),
            page: {
              ...editor.page,
              title: normalizedComponent.name,
              elements: editorCanvas.elements,
            },
            breakpointDefs: deepClone(componentBreakpoints),
          },
        });
        return true;
      }

      if (!activeVariantExists) {
        set({
          componentEditor: {
            ...editor,
            activeVariantId: nextActiveVariantId,
            variants: syncedVariants,
          },
        });
        return true;
      }

      return false;
    },

    async loadColorStyles() {
      try {
        if (window.fbData?.restUrl) {
          const data = await requestWordPressEndpoint('color-styles', 'framebuilder_get_color_styles');
          if (data.success && Array.isArray(data.styles)) {
            set({ colorStyles: data.styles });
          }
        } else {
          const stored = localStorage.getItem('fb_color_styles');
          if (stored) set({ colorStyles: JSON.parse(stored) });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadColorStyles failed', e);
      }
    },

    async saveColorStyles(styles) {
      set({ colorStyles: styles });
      try {
        if (window.fbData?.restUrl) {
          await requestWordPressEndpoint('color-styles', 'framebuilder_save_color_styles', {
            method: 'POST',
            body: { styles },
          });
        } else {
          localStorage.setItem('fb_color_styles', JSON.stringify(styles));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveColorStyles failed', e);
      }
    },

    async loadTextStyles() {
      try {
        if (window.fbData?.restUrl) {
          const data = await requestWordPressEndpoint('text-styles', 'framebuilder_get_text_styles');
          if (data.success && Array.isArray(data.styles)) {
            set({ textStyles: data.styles });
          }
        } else {
          const stored = localStorage.getItem('fb_text_styles');
          if (stored) set({ textStyles: JSON.parse(stored) });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadTextStyles failed', e);
      }
    },

    async saveTextStyles(styles) {
      const nextStyles = Array.isArray(styles) ? styles : [];
      set({ textStyles: nextStyles });
      try {
        if (window.fbData?.restUrl) {
          await requestWordPressEndpoint('text-styles', 'framebuilder_save_text_styles', {
            method: 'POST',
            body: { styles: nextStyles },
          });
        } else {
          localStorage.setItem('fb_text_styles', JSON.stringify(nextStyles));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveTextStyles failed', e);
      }
    },

    async loadElementStyles() {
      try {
        if (window.fbData?.restUrl) {
          const data = await requestWordPressEndpoint('element-styles', 'framebuilder_get_element_styles');
          if (data.success && Array.isArray(data.styles)) {
            set({ elementStyles: data.styles });
          }
        } else {
          const stored = localStorage.getItem('fb_element_styles');
          if (stored) set({ elementStyles: JSON.parse(stored) });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadElementStyles failed', e);
      }
    },

    async saveElementStyles(styles) {
      const nextStyles = Array.isArray(styles) ? styles : [];
      set({ elementStyles: nextStyles });
      try {
        if (window.fbData?.restUrl) {
          await requestWordPressEndpoint('element-styles', 'framebuilder_save_element_styles', {
            method: 'POST',
            body: { styles: nextStyles },
          });
        } else {
          localStorage.setItem('fb_element_styles', JSON.stringify(nextStyles));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveElementStyles failed', e);
      }
    },

    // ── UI state ───────────────────────────────────────────
    leftTab: 'layers',
    setLeftTab: (tab) => set({ leftTab: tab }),
    activeVectorPoint: null,
    setActiveVectorPoint: (payload) => set({
      activeVectorPoint: payload && payload.elementId && Number.isInteger(payload.pointIndex)
        ? {
            elementId: payload.elementId,
            bpId: payload.bpId ?? 'desktop',
            pointIndex: payload.pointIndex,
          }
        : null,
    }),
    clearActiveVectorPoint: () => set({ activeVectorPoint: null }),
    selection: null,   // { elementId, elementIds, bpId }
    setSelection: (sel) => set({ selection: normalizeSelection(sel), activeCommentId: null, activeVectorPoint: null }),
    clearSelection: () => set({ selection: null, activeVectorPoint: null }),
    selectOnly(sel) {
      set({ selection: normalizeSelection(sel), activeCommentId: null, activeVectorPoint: null });
    },
    addToSelection(sel) {
      set((state) => {
        const nextSelection = normalizeSelection(sel);
        if (!nextSelection) return state;
        const current = normalizeSelection(state.selection);
        if (!current || current.bpId !== nextSelection.bpId) {
          return { selection: nextSelection, activeCommentId: null, activeVectorPoint: null };
        }
        if (current.elementIds.includes(nextSelection.elementId)) {
          return { selection: buildSelection(current.elementIds, current.bpId, nextSelection.elementId), activeCommentId: null, activeVectorPoint: null };
        }
        return {
          selection: buildSelection(
            [...current.elementIds, nextSelection.elementId],
            current.bpId,
            nextSelection.elementId,
          ),
          activeCommentId: null,
          activeVectorPoint: null,
        };
      });
    },
    toggleSelection(sel) {
      set((state) => {
        const nextSelection = normalizeSelection(sel);
        if (!nextSelection) return { selection: null, activeVectorPoint: null };
        const current = normalizeSelection(state.selection);
        if (!current || current.bpId !== nextSelection.bpId) {
          return { selection: nextSelection, activeCommentId: null, activeVectorPoint: null };
        }
        if (!current.elementIds.includes(nextSelection.elementId)) {
          return {
            selection: buildSelection(
              [...current.elementIds, nextSelection.elementId],
              current.bpId,
              nextSelection.elementId,
            ),
            activeCommentId: null,
            activeVectorPoint: null,
          };
        }
        return {
          selection: removeSelectionIds(current, [nextSelection.elementId]),
          activeCommentId: null,
          activeVectorPoint: null,
        };
      });
    },
    setPrimarySelection(elementId) {
      set((state) => {
        const current = normalizeSelection(state.selection);
        if (!current?.elementIds.includes(elementId)) return state;
        return {
          selection: buildSelection(current.elementIds, current.bpId, elementId),
        };
      });
    },
    hoveredId: null,   // elementId hovered on canvas
    setHoveredId: (id) => set({ hoveredId: id }),
    layerHoveredId: null,
    setLayerHoveredId: (id) => set({ layerHoveredId: id }),
    loopActiveChildIndex: {},
    setLoopActiveChildIndex: (loopId, index) => set((state) => ({ loopActiveChildIndex: { ...state.loopActiveChildIndex, [loopId]: index } })),
    drilledContainerId: null, // element whose direct children are single-click selectable (null = artboard root)
    setDrilledContainerId: (id) => set({ drilledContainerId: id }),
    artboardSel: null, // bpId of the currently selected artboard
    setArtboardSel: (bpId) => set({ artboardSel: bpId }),
    pendingDraw: null, // 'frame' | 'image' | null — click-to-draw mode
    setPendingDraw: (type) => set({ pendingDraw: type, activeCanvasTool: type ? `draw-${type}` : 'select', activeCommentId: type ? null : get().activeCommentId }),
    activeCanvasTool: 'select',
    setActiveCanvasTool: (tool) => set({
      activeCanvasTool: tool || 'select',
      pendingDraw: typeof tool === 'string' && tool.startsWith('draw-') ? tool.slice(5) : null,
      activeCommentId: tool === 'comment' ? get().activeCommentId : null,
    }),
    activeCommentId: null,
    setActiveComment: (commentId) => set({ activeCommentId: commentId ?? null, selection: null, artboardSel: null }),
    clearActiveComment: () => set({ activeCommentId: null }),
    interacting: false,
    setInteracting: (v) => set({ interacting: v }),
    saveStatus: null,
    setSaveStatus: (s) => set({ saveStatus: s }),
    documentLock: getDefaultDocumentLock(),
    setDocumentLock(lock) {
      set({
        documentLock: lock && typeof lock === 'object'
          ? { ...getDefaultDocumentLock(), ...lock }
          : getDefaultDocumentLock(),
      });
    },
    async syncDocumentLock({ claim = false } = {}) {
      const postId = parseInt(window.fbData?.postId, 10);
      if (!window.fbData || !(postId > 0)) {
        const next = getDefaultDocumentLock();
        set({ documentLock: next });
        return next;
      }

      try {
        const data = claim
          ? await postWordPressAction('document-lock/acquire', 'framebuilder_acquire_document_lock', {
              post_id: postId,
            })
          : await requestWordPressEndpoint(`document-lock/${postId}`, 'framebuilder_get_document_lock', {
              body: { post_id: postId },
            });
        const next = normalizeDocumentLockPayload(data);
        set({ documentLock: next });
        return next;
      } catch (error) {
        console.warn('[FrameBuilder] document lock sync failed', error);
        const next = {
          ...get().documentLock,
          error: error?.message || 'Unable to check document lock.',
          lastUpdatedAt: Date.now(),
        };
        set({ documentLock: next });
        return next;
      }
    },
    async acquireDocumentLock() {
      return get().syncDocumentLock({ claim: true });
    },
    async refreshDocumentLock() {
      return get().syncDocumentLock({ claim: get().documentLock.isOwner });
    },
    async releaseDocumentLock(options = {}) {
      const postId = parseInt(window.fbData?.postId, 10);
      const { useBeacon = false } = options;
      if (!window.fbData || !(postId > 0)) {
        set({ documentLock: getDefaultDocumentLock() });
        return getDefaultDocumentLock();
      }

      if (useBeacon) {
        releaseDocumentLockWithBeacon(postId);
        set({ documentLock: getDefaultDocumentLock() });
        return getDefaultDocumentLock();
      }

      try {
        const data = await postWordPressAction('document-lock/release', 'framebuilder_release_document_lock', {
          post_id: postId,
        });
        const next = normalizeDocumentLockPayload(data);
        set({ documentLock: next });
        return next;
      } catch (error) {
        console.warn('[FrameBuilder] document lock release failed', error);
        const next = {
          ...get().documentLock,
          error: error?.message || 'Unable to release document lock.',
          lastUpdatedAt: Date.now(),
        };
        set({ documentLock: next });
        return next;
      }
    },
    animationEditor: null,
    openAnimationEditor: (payload) => set({
      animationEditor: payload && payload.elementId && payload.animationId
        ? {
            elementId: payload.elementId,
            bpId: payload.bpId ?? 'desktop',
            animationId: payload.animationId,
            mode: ['enter-start', 'scroll-start', 'scroll-effect', 'scroll-variant-marker'].includes(payload.mode)
              ? payload.mode
              : 'scroll-range',
          }
        : null,
    }),
    closeAnimationEditor: () => set({ animationEditor: null }),
    loopAnimationPreview: null,
    openLoopAnimationPreview: (payload) => set({
      loopAnimationPreview: payload && payload.elementId && payload.animationId
        ? {
            elementId: payload.elementId,
            bpId: payload.bpId ?? 'desktop',
            animationId: payload.animationId,
          }
        : null,
    }),
    closeLoopAnimationPreview: () => set({ loopAnimationPreview: null }),
    hoverAnimationPreview: null,
    openHoverAnimationPreview: (payload) => set({
      hoverAnimationPreview: payload && payload.elementId && payload.animationId
        ? {
            elementId: payload.elementId,
            bpId: payload.bpId ?? 'desktop',
            animationId: payload.animationId,
          }
        : null,
    }),
    closeHoverAnimationPreview: () => set({ hoverAnimationPreview: null }),
    scrollSequenceRangeEditor: null,
    openScrollSequenceRangeEditor: (payload) => set({
      scrollSequenceRangeEditor: payload && payload.elementId
        ? {
            elementId: payload.elementId,
            bpId: payload.bpId ?? 'desktop',
          }
        : null,
    }),
    closeScrollSequenceRangeEditor: () => set({ scrollSequenceRangeEditor: null }),
    iconLibraryModal: null,
    openIconLibraryModal: (payload) => set((state) => {
      const fallbackSelection = normalizeSelection(state.selection);
      const fallbackTargetId = payload?.targetId ?? fallbackSelection?.elementId ?? null;
      if (!fallbackTargetId) return { iconLibraryModal: null };
      return {
        iconLibraryModal: {
          targetId: fallbackTargetId,
          bpId: payload?.bpId ?? fallbackSelection?.bpId ?? 'desktop',
        },
      };
    }),
    closeIconLibraryModal: () => set({ iconLibraryModal: null }),
    applyIconLibrarySelection(icon) {
      if (!icon?.value || !icon?.markup) return;

      set((state) => {
        const modalState = state.iconLibraryModal;
        if (!modalState?.targetId) return {};

        const targetBpId = modalState.bpId ?? 'desktop';
        const isComponentSurface = state.activeSurface === 'component' && state.componentEditor?.isOpen;
        const currentElements = isComponentSurface
          ? (state.componentEditor?.page?.elements ?? [])
          : (state.pages.find((page) => page.id === state.currentPageId)?.elements ?? []);
        const currentTarget = findEl(currentElements, modalState.targetId);
        if (!currentTarget || currentTarget.type !== 'icon') {
          return { iconLibraryModal: null };
        }

        const currentMarkup = targetBpId === 'desktop'
          ? (currentTarget.base?.svgMarkup ?? '')
          : (currentTarget.overrides?.[targetBpId]?.svgMarkup ?? currentTarget.base?.svgMarkup ?? '');
        const currentStrokeWidth = getSvgStrokeWidth(currentMarkup) ?? null;
        const pickedIconHasStroke = hasSvgVisibleStroke(icon.markup);
        const nextMarkup = !pickedIconHasStroke
          ? removeSvgStroke(icon.markup)
          : (currentStrokeWidth ? setSvgStrokeWidth(icon.markup, currentStrokeWidth) : icon.markup);
        const safeUpdates = sanitizeLayoutUpdates({
          iconSource: 'preset',
          iconName: icon.value,
          svgMarkup: nextMarkup,
        });
        const nextElements = applyElementLayoutUpdate(currentElements, currentTarget.id, targetBpId, safeUpdates);

        if (isComponentSurface) {
          const nextComponentEditor = {
            ...state.componentEditor,
            page: {
              ...state.componentEditor.page,
              elements: nextElements,
            },
          };
          const snap = snapshotComponentEditorState({
            ...state,
            componentEditor: nextComponentEditor,
            iconLibraryModal: null,
          });
          const trimmed = state.componentHistory.slice(0, state.componentHistoryIndex + 1);
          const nextHistory = [...trimmed, snap].slice(-MAX_HISTORY);
          return {
            componentEditor: nextComponentEditor,
            iconLibraryModal: null,
            componentHistory: nextHistory,
            componentHistoryIndex: nextHistory.length - 1,
          };
        }

        const nextPages = state.pages.map((page) => (
          page.id === state.currentPageId ? { ...page, elements: nextElements } : page
        ));
        const snap = snapshotPages(nextPages);
        const trimmed = state.history.slice(0, state.historyIndex + 1);
        const nextHistory = [...trimmed, snap].slice(-MAX_HISTORY);
        return {
          pages: nextPages,
          iconLibraryModal: null,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      });
    },

    // ── Getters ────────────────────────────────────────────
    getCurrentPage() {
      return getActivePage();
    },
    getPageComments() {
      return getActivePage()?.comments ?? [];
    },
    getActiveComment() {
      const activeCommentId = get().activeCommentId;
      if (!activeCommentId) return null;
      return (getActivePage()?.comments ?? []).find((comment) => comment.id === activeCommentId) ?? null;
    },
    getAllElements() { return getEls(); },
    getElementsById() { return getElsById(); },
    getElementById(id) { return getElsById()[id] ?? null; },
    getRootElements() { return getRootElements(getEls()); },
    getChildElements(parentId) { return getChildEls(getEls(), parentId); },
    getSelectedElement() {
      const { selection } = get();
      if (!selection) return null;
      return findEl(getEls(), normalizeSelection(selection)?.elementId) ?? null;
    },
    getSelectedElements() {
      const selectionIds = getSelectionElementIds(get().selection);
      if (!selectionIds.length) return [];
      const elements = getEls();
      return selectionIds.map((id) => findEl(elements, id)).filter(Boolean);
    },

    // ── Element mutations ──────────────────────────────────

    /** Add element. If bpId is non-desktop, element is hidden by default everywhere
     *  except the originating breakpoint. */
    addElement(element, parentId = null, bpId = 'desktop') {
      const currentElements = getEls();
      const resolvedParentId = resolveLoopInsertionParentId(currentElements, parentId);
      let el = { ...element, parentId: resolvedParentId ?? null };
      const currentPage = get().getCurrentPage?.() ?? null;
      const pageLayout = !resolvedParentId ? resolvePageLayout(currentPage?.layout, bpId) : null;
      const shouldFlowAtRoot = !resolvedParentId
        && pageLayout !== null
        && (el.base?.positionType == null || el.base.positionType === 'absolute')
        && !el.base?.absoluteInLayout;

      if (shouldFlowAtRoot) {
        el = {
          ...el,
          base: {
            ...el.base,
            positionType: 'relative',
            absoluteInLayout: false,
          },
        };
      }

      if (bpId && bpId !== 'desktop') {
        // Hide on all breakpoints via base, then show only on originating bp
        el = {
          ...el,
          base: { ...el.base, hidden: true },
          overrides: {
            ...el.overrides,
            [bpId]: {
              ...(el.overrides?.[bpId] ?? {}),
              hidden: false,
              ...(shouldFlowAtRoot ? { positionType: 'relative', absoluteInLayout: false } : {}),
            },
          },
        };
      }
      withPage(els => {
        let next = [...els, el];
        if (resolvedParentId) {
          next = next.map(e =>
            e.id === resolvedParentId ? { ...e, children: [...(e.children ?? []), el.id] } : e
          );
        }
        if (isLoopElementType(el.type)) {
          const templateElement = createLoopTemplateElement(el, bpId);
          next = [
            ...next.map((candidate) => (
              candidate.id === el.id
                ? {
                    ...candidate,
                    children: [templateElement.id],
                    base: {
                      ...candidate.base,
                      loop: {
                        ...normalizeLoopConfig(candidate.base?.loop),
                        templateRootId: templateElement.id,
                      },
                    },
                  }
                : candidate
            )),
            templateElement,
          ];
        }
        return ensureLoopTemplateStructure(next, bpId);
      });
      set({ selection: buildSelection([el.id], bpId ?? 'desktop', el.id), activeCommentId: null, activeCanvasTool: get().activeCanvasTool === 'comment' ? 'select' : get().activeCanvasTool });
    },

    updateCurrentPage(updater) {
      set((state) => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) return state;
        return {
          pages: state.pages.map((page) => (
            page.id === state.currentPageId ? normalizePageData(updater(page)) : page
          )),
        };
      });
    },

    addCommentThread({ bpId = 'desktop', x = 0, y = 0, text = '', author = null, avatarUrl = null }) {
      const body = typeof text === 'string' ? text.trim() : '';
      const currentAuthor = getCurrentCommentAuthor();
      const safeAuthor = typeof author === 'string' && author.trim() ? author.trim() : currentAuthor.author;
      const safeAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl : currentAuthor.avatarUrl;
      const comment = normalizeCommentThread({
        id: makeId('comment'),
        bpId,
        x,
        y,
        author: safeAuthor,
        avatarUrl: safeAvatarUrl,
        resolved: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: body ? [{ id: makeId('comment-msg'), author: safeAuthor, avatarUrl: safeAvatarUrl, text: body, createdAt: Date.now() }] : [],
      });
      get().updateCurrentPage((page) => ({
        ...page,
        comments: [...(page.comments ?? []), comment],
      }));
      set({ activeCommentId: comment.id, selection: null, artboardSel: null });
      return comment.id;
    },

    updateCommentThread(commentId, updater) {
      if (!commentId || typeof updater !== 'function') return;
      get().updateCurrentPage((page) => ({
        ...page,
        comments: (page.comments ?? []).map((comment) => (
          comment.id === commentId ? normalizeCommentThread(updater(comment)) : comment
        )),
      }));
    },

    addCommentReply(commentId, text, author = null, avatarUrl = null) {
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body) return;
      const currentAuthor = getCurrentCommentAuthor();
      const safeAuthor = typeof author === 'string' && author.trim() ? author.trim() : currentAuthor.author;
      const safeAvatarUrl = typeof avatarUrl === 'string' ? avatarUrl : currentAuthor.avatarUrl;
      get().updateCommentThread(commentId, (comment) => ({
        ...comment,
        updatedAt: Date.now(),
        messages: [
          ...(comment.messages ?? []),
          normalizeCommentMessage({ id: makeId('comment-msg'), author: safeAuthor, avatarUrl: safeAvatarUrl, text: body, createdAt: Date.now() }),
        ],
      }));
      set({ activeCommentId: commentId });
    },

    setCommentResolved(commentId, resolved) {
      get().updateCommentThread(commentId, (comment) => ({
        ...comment,
        resolved: resolved === true,
        updatedAt: Date.now(),
      }));
      set({ activeCommentId: commentId });
    },

    deleteCommentThread(commentId) {
      if (!commentId) return;
      get().updateCurrentPage((page) => ({
        ...page,
        comments: (page.comments ?? []).filter((comment) => comment.id !== commentId),
      }));
      if (get().activeCommentId === commentId) {
        set({ activeCommentId: null });
      }
    },

    /** Update base (desktop) non-style props: name, locked, etc. */
    updateElementBase(elementId, updates) {
      withPage(els =>
        els.map((el) => {
          if (el.id !== elementId) return el;
          return syncElementLockedFlag({
            ...el,
            ...(typeof updates?.name === 'string' ? { name: updates.name } : {}),
            base: { ...el.base, ...updates },
          });
        })
      );
    },

    updateElementsBase(elementIds, updates) {
      const targetIds = new Set((elementIds ?? []).filter(Boolean));
      if (!targetIds.size) return;
      withPage((els) => els.map((el) => (
        targetIds.has(el.id)
          ? syncElementLockedFlag({ ...el, base: { ...el.base, ...updates } })
          : el
      )));
    },

    /** Update style props for a breakpoint.
     *  Desktop → base.styles. Tablet/Mobile → overrides[bpId].styles */
    updateElementStyles(elementId, bpId, styleUpdates) {
      const animationEditor = get().animationEditor;
      if ((animationEditor?.mode === 'scroll-effect' || animationEditor?.mode === 'scroll-start' || animationEditor?.mode === 'enter-start') && animationEditor.elementId === elementId && animationEditor.bpId === bpId) {
        const targetElement = get().getAllElements().find((entry) => entry.id === elementId) ?? null;
        const currentPage = get().pages.find((page) => page.id === get().currentPageId) ?? null;
        const pageVariables = Array.isArray(currentPage?.variables) ? currentPage.variables : [];
        const resolvedBase = targetElement ? resolveElementWithVariables(targetElement, bpId, pageVariables, get().globalVariables) : null;
        get().updateElementAnimation(elementId, bpId, animationEditor.animationId, (entry) => {
          const isStartPatchMode = animationEditor.mode === 'enter-start' || animationEditor.mode === 'scroll-start';
          const currentPatch = isStartPatchMode ? entry?.startState : entry?.endState;
          const nextStyles = { ...(currentPatch?.styles ?? {}) };
          Object.entries(styleUpdates ?? {}).forEach(([key, value]) => {
            const baseValue = resolvedBase?.styles?.[key];
            if (valuesMatchForAnimationOverride(value, baseValue)) delete nextStyles[key];
            else nextStyles[key] = value;
          });
          return normalizeElementAnimation({
            ...entry,
            [isStartPatchMode ? 'startState' : 'endState']: {
              ...(isStartPatchMode ? entry?.startState : entry?.endState),
              styles: nextStyles,
            },
          });
        });
        return;
      }
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        const textFieldUpdates = getTextStyleDrivenFieldUpdates(el, bpId, styleUpdates);
        if (bpId === 'desktop') {
          return pruneElementBreakpointOverrides({
            ...el,
            base: {
              ...el.base,
              ...textFieldUpdates,
              styles: { ...el.base.styles, ...styleUpdates },
            },
          });
        }
        const ov = el.overrides?.[bpId] ?? {};
        return pruneElementBreakpointOverrides({
          ...el,
          overrides: {
            ...el.overrides,
            [bpId]: { ...ov, ...textFieldUpdates, styles: { ...(ov.styles ?? {}), ...styleUpdates } },
          },
        });
      }));
    },

    updateElementsStyles(elementIds, bpId, styleUpdates) {
      const targetIds = new Set((elementIds ?? []).filter(Boolean));
      if (!targetIds.size) return;
      const vectorStyleKeys = ['strokeWidth', 'strokeColor', 'lineCap', 'backgroundColor'];
      const needsVectorSync = vectorStyleKeys.some((k) => Object.prototype.hasOwnProperty.call(styleUpdates, k));
      withPage((els) => els.map((el) => {
        if (!targetIds.has(el.id)) return el;
        const textFieldUpdates = getTextStyleDrivenFieldUpdates(el, bpId, styleUpdates);
        let next;
        if (bpId === 'desktop') {
          next = pruneElementBreakpointOverrides({
            ...el,
            base: {
              ...el.base,
              ...textFieldUpdates,
              styles: { ...el.base.styles, ...styleUpdates },
            },
          });
        } else {
          const ov = el.overrides?.[bpId] ?? {};
          next = pruneElementBreakpointOverrides({
            ...el,
            overrides: {
              ...el.overrides,
              [bpId]: { ...ov, ...textFieldUpdates, styles: { ...(ov.styles ?? {}), ...styleUpdates } },
            },
          });
        }
        // Rebuild svgMarkup for vector shapes when stroke styles change.
        if (needsVectorSync) {
          const shapeKind = getShapePresetKind(next);
          if (shapeKind && ['line', 'path', 'pen'].includes(shapeKind)) {
            const resolved = bpId === 'desktop' ? next.base : { ...next.base, ...(next.overrides?.[bpId] ?? {}), styles: { ...(next.base.styles ?? {}), ...(next.overrides?.[bpId]?.styles ?? {}) } };
            const mergedStyles = resolved.styles ?? {};
            let freshMarkup;
            if (shapeKind === 'line') {
              const sw = Math.max(0.5, mergedStyles.strokeWidth || 2);
              const sc = mergedStyles.strokeColor ?? '#111827';
              const lc = mergedStyles.lineCap ?? 'round';
              freshMarkup = buildLineSvgMarkup({ stroke: sc, strokeWidth: sw, lineCap: lc });
            } else {
              const vectorData = getVectorShapeData(resolved) || getVectorShapeData(next);
              if (vectorData) {
                const sw = Math.max(0.5, mergedStyles.strokeWidth || 1.5);
                const sc = mergedStyles.strokeColor ?? '#2563eb';
                const lc = mergedStyles.lineCap ?? 'round';
                const w = resolved.width ?? next.base.width ?? 100;
                const h = resolved.height ?? next.base.height ?? 100;
                const fillValue = vectorData.closed
                  && typeof mergedStyles.backgroundColor === 'string'
                  && !mergedStyles.backgroundColor.includes('gradient(')
                  && mergedStyles.backgroundColor !== 'transparent'
                  ? mergedStyles.backgroundColor : 'none';
                freshMarkup = buildVectorShapeSvgMarkup(vectorData, { width: w, height: h, fill: fillValue, stroke: sc, strokeWidth: sw, lineCap: lc });
              }
            }
            if (freshMarkup) {
              if (bpId === 'desktop') {
                next = { ...next, base: { ...next.base, svgMarkup: freshMarkup } };
              } else {
                next = { ...next, overrides: { ...next.overrides, [bpId]: { ...(next.overrides?.[bpId] ?? {}), svgMarkup: freshMarkup } } };
              }
            }
          }
        }
        return next;
      }));
    },

    /** Update layout props (x,y,w,h,rotation,hidden,locked) for a breakpoint.
     *  Desktop → base. Tablet/Mobile → overrides[bpId]. */
    updateElementLayout(elementId, bpId, updates) {
      const safeUpdates = sanitizeLayoutUpdates(updates);
      if (!safeUpdates || !Object.keys(safeUpdates).length) return;
      const animationEditor = get().animationEditor;
      if ((animationEditor?.mode === 'scroll-effect' || animationEditor?.mode === 'scroll-start' || animationEditor?.mode === 'enter-start') && animationEditor.elementId === elementId && animationEditor.bpId === bpId) {
        const targetElement = get().getAllElements().find((entry) => entry.id === elementId) ?? null;
        const currentPage = get().pages.find((page) => page.id === get().currentPageId) ?? null;
        const pageVariables = Array.isArray(currentPage?.variables) ? currentPage.variables : [];
        const resolvedBase = targetElement ? resolveElementWithVariables(targetElement, bpId, pageVariables, get().globalVariables) : null;
        const pageLayout = resolvePageLayout(currentPage?.layout, bpId);
        get().updateElementAnimation(elementId, bpId, animationEditor.animationId, (entry) => {
          const isStartPatchMode = animationEditor.mode === 'enter-start' || animationEditor.mode === 'scroll-start';
          const currentPatch = isStartPatchMode ? entry?.startState : entry?.endState;
          const nextLayout = { ...(currentPatch?.layout ?? {}) };
          Object.entries(safeUpdates ?? {}).forEach(([key, value]) => {
            const baseValue = resolvedBase?.[key];
            if (valuesMatchForAnimationOverride(value, baseValue)) delete nextLayout[key];
            else nextLayout[key] = value;
          });
          const isFlowPositioned = !!resolvedBase && (
            ['relative', 'sticky'].includes(resolvedBase.positionType ?? 'absolute')
            || (!targetElement?.parentId && pageLayout !== null && !resolvedBase.absoluteInLayout && resolvedBase.positionType !== 'fixed')
          );
          const hasAnimatedSizeOverride = Object.prototype.hasOwnProperty.call(nextLayout, 'width') || Object.prototype.hasOwnProperty.call(nextLayout, 'height');
          if (isFlowPositioned && hasAnimatedSizeOverride) {
            const baseX = typeof resolvedBase?.x === 'number' ? resolvedBase.x : (parseFloat(resolvedBase?.x) || 0);
            const baseY = typeof resolvedBase?.y === 'number' ? resolvedBase.y : (parseFloat(resolvedBase?.y) || 0);
            const baseWidth = typeof resolvedBase?.width === 'number' ? resolvedBase.width : (parseFloat(resolvedBase?.width) || 0);
            const baseHeight = typeof resolvedBase?.height === 'number' ? resolvedBase.height : (parseFloat(resolvedBase?.height) || 0);
            const nextWidth = Object.prototype.hasOwnProperty.call(nextLayout, 'width') ? (parseFloat(nextLayout.width) || 0) : baseWidth;
            const nextHeight = Object.prototype.hasOwnProperty.call(nextLayout, 'height') ? (parseFloat(nextLayout.height) || 0) : baseHeight;

            const centeredX = baseX + ((baseWidth - nextWidth) / 2);
            const centeredY = baseY + ((baseHeight - nextHeight) / 2);

            if (valuesMatchForAnimationOverride(centeredX, resolvedBase?.x)) delete nextLayout.x;
            else nextLayout.x = centeredX;

            if (valuesMatchForAnimationOverride(centeredY, resolvedBase?.y)) delete nextLayout.y;
            else nextLayout.y = centeredY;
          }
          return normalizeElementAnimation({
            ...entry,
            [isStartPatchMode ? 'startState' : 'endState']: {
              ...(isStartPatchMode ? entry?.startState : entry?.endState),
              layout: nextLayout,
            },
          });
        });
        return;
      }
      withPage(els => applyElementLayoutUpdate(els, elementId, bpId, safeUpdates));
      if (safeUpdates?.hidden === true) {
        const currentDrilled = get().drilledContainerId;
        const nextUiState = {};
        if (currentDrilled === elementId) {
          nextUiState.drilledContainerId = null;
        }
        if (Object.keys(nextUiState).length) {
          set(nextUiState);
        }
      }
    },

    updateElementsLayout(elementIds, bpId, updates) {
      const targetIds = new Set((elementIds ?? []).filter(Boolean));
      const safeUpdates = sanitizeLayoutUpdates(updates);
      if (!targetIds.size || !safeUpdates || !Object.keys(safeUpdates).length) return;
      withPage((els) => els.map((el) => {
        if (!targetIds.has(el.id)) return el;
        if (bpId === 'desktop') return syncElementLockedFlag(pruneElementBreakpointOverrides({ ...el, base: { ...el.base, ...safeUpdates } }));
        const ov = el.overrides?.[bpId] ?? {};
        return syncElementLockedFlag(pruneElementBreakpointOverrides({ ...el, overrides: { ...el.overrides, [bpId]: { ...ov, ...safeUpdates } } }));
      }));

      if (safeUpdates?.hidden === true) {
        const currentDrilled = get().drilledContainerId;
        if (currentDrilled && targetIds.has(currentDrilled)) {
          set({ drilledContainerId: null });
        }
      }
    },

    /** Remove a per-breakpoint override key, reverting to desktop value */
    removeOverride(elementId, bpId, key) {
      if (bpId === 'desktop') return;
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        const ov = { ...(el.overrides?.[bpId] ?? {}) };
        delete ov[key];
        return { ...el, overrides: { ...el.overrides, [bpId]: ov } };
      }));
    },

    /** Remove a per-breakpoint style key, reverting to desktop value */
    removeStyleOverride(elementId, bpId, styleKey) {
      if (bpId === 'desktop') return;
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        const ov     = { ...(el.overrides?.[bpId] ?? {}) };
        const styles = { ...(ov.styles ?? {}) };
        delete styles[styleKey];
        return { ...el, overrides: { ...el.overrides, [bpId]: { ...ov, styles } } };
      }));
    },

    addElementAnimation(elementId, bpId, type = 'enter') {
      let createdId = null;
      withPage((els) => els.map((el) => {
        if (el.id !== elementId) return el;
        const nextEntry = normalizeElementAnimation({ type });
        createdId = nextEntry.id;
        return updateElementAnimationCollection(el, bpId, (current) => [...current, nextEntry]);
      }));
      return createdId;
    },

    updateElementAnimation(elementId, bpId, animationId, updater) {
      withPage((els) => els.map((el) => {
        if (el.id !== elementId) return el;
        return updateElementAnimationCollection(el, bpId, (current) => current.map((entry) => {
          if (entry.id !== animationId) return entry;
          const nextEntry = typeof updater === 'function'
            ? updater(entry)
            : { ...entry, ...(updater ?? {}) };
          return normalizeElementAnimation(nextEntry);
        }));
      }));
    },

    removeElementAnimation(elementId, bpId, animationId) {
      const currentEditor = get().animationEditor;
      withPage((els) => els.map((el) => {
        if (el.id !== elementId) return el;
        return updateElementAnimationCollection(el, bpId, (current) => current.filter((entry) => entry.id !== animationId));
      }));
      if (currentEditor?.elementId === elementId && currentEditor?.bpId === bpId && currentEditor?.animationId === animationId) {
        set({ animationEditor: null });
      }
    },

    /** Delete element and all its descendants */
    deleteElement(elementId) {
      get().deleteElements([elementId]);
    },

    deleteElements(elementIds) {
      const els = getEls();
      const currentAnimationEditor = get().animationEditor;
      const currentScrollSequenceRangeEditor = get().scrollSequenceRangeEditor;
      const toDelete = new Set();
      const collect = (id) => {
        toDelete.add(id);
        const el = findEl(els, id);
        (el?.children ?? []).forEach(collect);
      };
      (elementIds ?? []).forEach(collect);
      if (!toDelete.size) return;
      withPage(currEls => ensureLoopTemplateStructure(
        currEls
          .filter(e => !toDelete.has(e.id))
          .map(e => ({ ...e, children: (e.children ?? []).filter(c => !toDelete.has(c)) }))
      ));
      set(state => ({
        selection: removeSelectionIds(state.selection, toDelete),
        animationEditor: toDelete.has(currentAnimationEditor?.elementId) ? null : state.animationEditor,
        scrollSequenceRangeEditor: toDelete.has(currentScrollSequenceRangeEditor?.elementId) ? null : state.scrollSequenceRangeEditor,
      }));
    },

    /** Update artboard position/size/name in breakpointDefs */
    updateBreakpointDef(bpId, updates) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            breakpointDefs: {
              ...state.componentEditor.breakpointDefs,
              [bpId]: { ...state.componentEditor.breakpointDefs[bpId], ...updates },
            },
            componentEditor: {
              ...state.componentEditor,
              breakpointDefs: {
                ...state.componentEditor.breakpointDefs,
                [bpId]: { ...state.componentEditor.breakpointDefs[bpId], ...updates },
              },
            },
          };
        }
        return {
          breakpointDefs: {
            ...state.breakpointDefs,
            [bpId]: { ...state.breakpointDefs[bpId], ...updates },
          },
        };
      });
    },

    /** Update page background color for a specific breakpoint */
    setPageBackground(bpId, color) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                background: { ...state.componentEditor.page.background, [bpId]: color },
              },
            },
          };
        }
        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? { ...p, background: { ...p.background, [bpId]: color } }
              : p
          ),
        };
      });
    },

    /** Update page smooth-scroll behavior for a specific breakpoint (null = inherit from parent) */
    setPageSmoothScroll(bpId, value) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                smoothScroll: { ...(state.componentEditor.page.smoothScroll ?? {}), [bpId]: value },
              },
            },
          };
        }
        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? { ...p, smoothScroll: { ...(p.smoothScroll ?? {}), [bpId]: value } }
              : p
          ),
        };
      });
    },

    /** Update page padding for a specific breakpoint (null = inherit from parent) */
    setPagePadding(bpId, padObj) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                padding: { ...(state.componentEditor.page.padding ?? {}), [bpId]: padObj },
              },
            },
          };
        }
        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? { ...p, padding: { ...(p.padding ?? {}), [bpId]: padObj } }
              : p
          ),
        };
      });
    },

    /** Update page layout for a specific breakpoint (null = inherit / disabled) */
    setPageLayout(bpId, layoutObj) {
      set(state => {
        const normalizeElements = (elements) => (
          layoutObj == null ? elements : elements.map(el => {
            const resolved = resolveElement(el, bpId);
            const shouldNormalizeToFlow = !el.parentId
              && !resolved.absoluteInLayout
              && resolved.positionType !== 'fixed'
              && resolved.positionType !== 'relative'
              && resolved.positionType !== 'sticky';
            if (!shouldNormalizeToFlow) return el;
            if (bpId === 'desktop') {
              return { ...el, base: { ...el.base, positionType: 'relative' } };
            }
            const ov = el.overrides?.[bpId] ?? {};
            return {
              ...el,
              overrides: {
                ...el.overrides,
                [bpId]: { ...ov, positionType: 'relative' },
              },
            };
          })
        );

        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                layout: { ...(state.componentEditor.page.layout ?? {}), [bpId]: layoutObj },
                elements: normalizeElements(state.componentEditor.page.elements ?? []),
              },
            },
          };
        }

        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? {
                  ...p,
                  layout: { ...(p.layout ?? {}), [bpId]: layoutObj },
                  elements: normalizeElements(p.elements),
                }
              : p
          ),
        };
      });
    },

    toggleElementVisibility(elementId, bpId) {
      const el = findEl(getEls(), elementId);
      if (!el) return;
      const resolved = resolveElement(el, bpId);
      get().updateElementLayout(elementId, bpId, { hidden: !resolved.hidden });
    },

    /** Reorder element among its siblings (same parent or root).
     *  newIndex is 0-based among siblings excluding the element itself. */
    reorderElementInParent(elementId, newIndex) {
      withPage(els => {
        const el = findEl(els, elementId);
        if (!el) return els;
        const parentId = el.parentId;
        if (parentId) {
          return els.map(e => {
            if (e.id !== parentId) return e;
            const children = [...(e.children ?? [])];
            const cur = children.indexOf(elementId);
            if (cur === -1) return e;
            children.splice(cur, 1);
            children.splice(Math.min(Math.max(0, newIndex), children.length), 0, elementId);
            return { ...e, children };
          });
        } else {
          const without = els.filter(e => e.id !== elementId);
          let rootCount = 0;
          let insertAt = without.length;
          for (let i = 0; i < without.length; i++) {
            if (!without[i].parentId) {
              if (rootCount === newIndex) { insertAt = i; break; }
              rootCount++;
            }
          }
          const result = [...without];
          result.splice(insertAt, 0, el);
          return result;
        }
      });
    },

    /** Bulk-add a flat array of pre-cloned elements (for paste). */
    addElements(elements, bpId = 'desktop') {
      const currentPage = get().getCurrentPage?.() ?? null;
      withPage((els) => ensureLoopTemplateStructure([
        ...els,
        ...(Array.isArray(elements)
          ? elements.map((element) => normalizeElementDynamicFields(normalizeRootFlowInsertion(element, bpId, currentPage)))
          : []),
      ], bpId));
    },

    /** Move element under a new parent (or null = root). Prevents circular nesting. */
    reparentElement(elementId, newParentId) {
      if (elementId === newParentId) return;
      withPage(els => {
        // Guard: collect descendants to prevent circular
        const descendants = new Set();
        const collect = (id) => {
          descendants.add(id);
          const e = findEl(els, id);
          (e?.children ?? []).forEach(collect);
        };
        collect(elementId);
        if (newParentId && descendants.has(newParentId)) return els;

        const resolvedParentId = resolveLoopInsertionParentId(els, newParentId);
        const el = findEl(els, elementId);
        if (!el) return els;
        const oldParentId = el.parentId;
        const shouldClearLoopTemplateRootFor = !!el.loopTemplateRootFor && resolvedParentId !== el.loopTemplateRootFor;

        return ensureLoopTemplateStructure(els.map(e => {
          if (e.id === elementId) {
            return {
              ...e,
              parentId: resolvedParentId ?? null,
              ...(shouldClearLoopTemplateRootFor ? { loopTemplateRootFor: null } : {}),
            };
          }
          if (e.id === oldParentId) {
            return { ...e, children: (e.children ?? []).filter(c => c !== elementId) };
          }
          if (resolvedParentId && e.id === resolvedParentId) {
            return { ...e, children: [...(e.children ?? []), elementId] };
          }
          return e;
        }));
      });
    },

    /** Eject element to root. Assigns a canvas position if the element had none (e.g. was relative/nested).
     *  toOffCanvas=true places it beyond the artboard right edge. */
    ejectElement(elementId, { toOffCanvas = false, artboardWidth = 1440 } = {}) {
      const el = findEl(getEls(), elementId);
      if (!el) return;
      const wasNested = !!el.parentId;
      const hasX = el.base.x != null;
      const hasY = el.base.y != null;
      get().reparentElement(elementId, null);
      if (wasNested && (!hasX || !hasY)) {
        get().updateElementLayout(elementId, 'desktop', {
          x: toOffCanvas ? artboardWidth + 80 : 40,
          y: 40,
          width: el.base.width ?? 200,
          height: el.base.height ?? 80,
        });
      } else if (toOffCanvas && hasX) {
        get().updateElementLayout(elementId, 'desktop', { x: artboardWidth + 80 });
      }
    },

    // ── History ────────────────────────────────────────────
    history: [],
    historyIndex: -1,
    componentHistory: [],
    componentHistoryIndex: -1,

    pushHistory() {
      const current = get();
      if (current.activeSurface === 'component' && current.componentEditor?.isOpen) {
        const snap = snapshotComponentEditorState(current);
        set((state) => {
          const trimmed = state.componentHistory.slice(0, state.componentHistoryIndex + 1);
          const next = [...trimmed, snap].slice(-MAX_HISTORY);
          return { componentHistory: next, componentHistoryIndex: next.length - 1 };
        });
        return;
      }

      const snap = snapshotPages(current.pages);
      set(state => {
        const trimmed = state.history.slice(0, state.historyIndex + 1);
        const next = [...trimmed, snap].slice(-MAX_HISTORY);
        return { history: next, historyIndex: next.length - 1 };
      });
    },

    undo() {
      const current = get();
      if (current.documentLock.isLockedByOther) return;
      if (current.activeSurface === 'component' && current.componentEditor?.isOpen) {
        const { componentHistory, componentHistoryIndex } = current;
        if (componentHistoryIndex <= 0) return;
        set({
          ...restoreComponentEditorSnapshot(componentHistory[componentHistoryIndex - 1]),
          componentHistoryIndex: componentHistoryIndex - 1,
        });
        return;
      }

      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      set({ pages: JSON.parse(history[historyIndex - 1]), historyIndex: historyIndex - 1 });
    },

    redo() {
      const current = get();
      if (current.documentLock.isLockedByOther) return;
      if (current.activeSurface === 'component' && current.componentEditor?.isOpen) {
        const { componentHistory, componentHistoryIndex } = current;
        if (componentHistoryIndex >= componentHistory.length - 1) return;
        set({
          ...restoreComponentEditorSnapshot(componentHistory[componentHistoryIndex + 1]),
          componentHistoryIndex: componentHistoryIndex + 1,
        });
        return;
      }

      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      set({ pages: JSON.parse(history[historyIndex + 1]), historyIndex: historyIndex + 1 });
    },

    // ── Persist / Load / Publish ───────────────────────────

    async saveLayout(options = {}) {
      const { setStatus = true } = options || {};
      let state = get();
      if (state.documentLock.isLockedByOther) {
        if (setStatus) {
          get().setSaveStatus('error');
          setTimeout(() => get().setSaveStatus(null), 2500);
        }
        return { success: false, locked: true };
      }
      if (setStatus) get().setSaveStatus('saving');
      await awaitPendingAssetUploads();
      state = get();
      // wp_localize_script converts everything to strings, so postId is "0" not 0
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        const components = deepStripDataUris(buildComponentLibraryForPersistence(state).map(normalizeStoredComponent));
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          await get().saveComponents(components, { throwOnError: true });
        }
        if (window.fbData && postId > 0) {
          const payload = {
            ...buildPersistableLayoutPayload(state),
            _componentLibrary: components,
          };
          const compressed = await compressJsonPayload(payload);
          const compressedBytes = gzipJsonPayload(payload);
          const data = isLikelySafariBrowser() && compressedBytes
            ? await postMultipartAjaxAction('framebuilder_save_layout', {
                _wpnonce: window.fbData?.nonce || '',
                post_id: postId,
              }, {
                layout_gz_file: {
                  blob: new Blob([compressedBytes], { type: 'application/gzip' }),
                  filename: `framebuilder-layout-${postId}.json.gz`,
                },
              })
            : await postWordPressAction('save-layout', 'framebuilder_save_layout',
                compressed
                  ? { post_id: postId, layout_gz: compressed }
                  : { post_id: postId, layout: payload },
              );
          if (setStatus) get().setSaveStatus(data.success ? 'ok' : 'error');
          if (!data.success) {
            if (setStatus) setTimeout(() => get().setSaveStatus(null), 2500);
            return { success: false };
          }
        } else {
          const payload = {
            ...buildPersistableLayoutPayload(state),
            _componentLibrary: components,
          };
          try { localStorage.setItem('fb_layout_' + state.currentPageId, JSON.stringify(payload)); } catch {}
          try { localStorage.setItem('fb_component_library', JSON.stringify(components)); } catch {}
          if (setStatus) get().setSaveStatus('ok');
        }
      } catch (err) {
        console.error('[FrameBuilder] save failed', err);
        if (setStatus) get().setSaveStatus('error');
        if (setStatus) setTimeout(() => get().setSaveStatus(null), 2500);
        return { success: false, error: err };
      }
      if (setStatus) setTimeout(() => get().setSaveStatus(null), 2500);
      return { success: true };
    },

    async loadLayout() {
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const data = await requestWordPressEndpoint(`get-layout/${postId}`, 'framebuilder_get_layout', {
            body: { post_id: postId },
          });
          if (data.success && data.layout) {
            const { _breakpointDefs, _componentLibrary, ...cleanLayout } = data.layout;
            set(state => ({
              pages: state.pages.map(p =>
                p.id === state.currentPageId
                  ? normalizePageData({ ...cleanLayout, id: state.currentPageId })
                  : p
              ),
              ...(Array.isArray(_componentLibrary) ? { components: _componentLibrary.map(normalizeStoredComponent) } : {}),
              ...(_breakpointDefs ? { breakpointDefs: normalizePageBreakpointDefs(_breakpointDefs) } : {}),
            }));
            return { hasStoredComponentLibrary: Array.isArray(_componentLibrary) };
          }
        } else {
          const stored = localStorage.getItem('fb_layout_page-1');
          if (stored) {
            const { _breakpointDefs, _componentLibrary, ...cleanLayout } = JSON.parse(stored);
            set(state => ({
              pages: state.pages.map(p =>
                p.id === state.currentPageId ? normalizePageData({ ...cleanLayout, id: state.currentPageId }) : p
              ),
              ...(Array.isArray(_componentLibrary) ? { components: _componentLibrary.map(normalizeStoredComponent) } : {}),
              ...(_breakpointDefs ? { breakpointDefs: normalizePageBreakpointDefs(_breakpointDefs) } : {}),
            }));
            return { hasStoredComponentLibrary: Array.isArray(_componentLibrary) };
          }
        }
      } catch (err) {
        console.warn('[FrameBuilder] loadLayout failed', err);
      }
      return { hasStoredComponentLibrary: false };
    },

    async publishLayout() {
      let state = get();
      if (state.documentLock.isLockedByOther) {
        get().setSaveStatus('error');
        setTimeout(() => get().setSaveStatus(null), 3000);
        return { success: false, locked: true };
      }
      get().setSaveStatus('saving');
      const saveResult = await get().saveLayout({ setStatus: false });
      if (!saveResult?.success) {
        get().setSaveStatus('error');
        setTimeout(() => get().setSaveStatus(null), 3000);
        return saveResult;
      }
      state = get();
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const data = await postWordPressAction('publish', 'framebuilder_publish_layout', {
            post_id: postId,
          });
          get().setSaveStatus(data.success ? 'ok' : 'error');
          if (data.success && data.permalink) window.open(data.permalink, '_blank');
        } else {
          const components = buildComponentLibraryForPersistence(state).map(normalizeStoredComponent);
          localStorage.setItem('fb_component_library', JSON.stringify(components));
          get().setSaveStatus('ok');
        }
      } catch (err) {
        console.error('[FrameBuilder] publish failed', err);
        get().setSaveStatus('error');
      }
      setTimeout(() => get().setSaveStatus(null), 3000);
    },
  };
});
