import { create } from 'zustand';

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (obj && key in obj) acc[key] = obj[key];
    return acc;
  }, {});
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

async function postWordPressAction(restPath, ajaxAction, body) {
  const nonce = window.fbData?.nonce;
  const restUrl = `${window.fbData?.restUrl || ''}${restPath}?_wpnonce=${encodeURIComponent(nonce || '')}`;

  try {
    return await requestJson(restUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce || '' },
      body: JSON.stringify(body),
    });
  } catch (restError) {
    const formData = new FormData();
    formData.append('action', ajaxAction);
    formData.append('_wpnonce', nonce || '');
    formData.append('post_id', `${body.post_id || 0}`);
    formData.append('layout', JSON.stringify(body.layout ?? {}));

    return requestJson(getAjaxUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    });
  }
}

const LAYOUT_NUMERIC_KEYS = new Set([
  'x', 'y', 'width', 'height', 'rotation',
  'minW', 'maxW', 'minH', 'maxH',
  'widthPct', 'heightPct', 'widthFr', 'heightFr',
]);

const VARIABLE_TYPES = new Set(['string', 'boolean', 'color', 'number', 'image', 'post', 'product']);
const VARIABLE_SCOPES = new Set(['page', 'global']);
const VARIABLE_BINDING_BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
const VARIABLE_PROPERTY_COMPATIBILITY = {
  text: ['string', 'number'],
  hidden: ['boolean'],
  'styles.backgroundColor': ['color'],
  'styles.backgroundImage': ['image'],
  'styles.color': ['color'],
  'styles.zIndex': ['number'],
  'styles.fontFamily': ['string'],
  src: ['image'],
};

function sanitizeLayoutUpdates(updates) {
  if (!updates || typeof updates !== 'object') return updates;

  return Object.fromEntries(
    Object.entries(updates).flatMap(([key, value]) => {
      if (!LAYOUT_NUMERIC_KEYS.has(key) || value == null) return [[key, value]];
      const numericValue = typeof value === 'number' ? value : parseFloat(value);
      return Number.isFinite(numericValue) ? [[key, numericValue]] : [];
    })
  );
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
      return !!value;
    case 'color':
      return typeof value === 'string' && value ? value : '#000000';
    case 'image':
      return typeof value === 'string' ? value : `${value ?? ''}`;
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
  const normalizedScope = VARIABLE_SCOPES.has(variable?.scope) ? variable.scope : scope;
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
  const scope = VARIABLE_SCOPES.has(binding.scope) ? binding.scope : 'page';
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
    const pageUrl = typeof interaction.pageUrl === 'string' ? interaction.pageUrl : '';
    if (!pageUrl) return null;
    return {
      id: typeof interaction.id === 'string' && interaction.id ? interaction.id : makeId('int'),
      type,
      pageId: typeof interaction.pageId === 'number' ? interaction.pageId : parseInt(interaction.pageId, 10) || 0,
      pageTitle: typeof interaction.pageTitle === 'string' ? interaction.pageTitle : '',
      pageUrl,
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

function normalizeElementDynamicFields(element) {
  return {
    ...element,
    bindings: normalizeElementBindings(element?.bindings),
    interactions: normalizeElementInteractions(element?.interactions),
  };
}

function getVariableMap(pageVariables = [], globalVariables = []) {
  const pageMap = new Map(normalizeVariableList(pageVariables, 'page').map((variable) => [variable.id, variable]));
  const globalMap = new Map(normalizeVariableList(globalVariables, 'global').map((variable) => [variable.id, variable]));
  return { page: pageMap, global: globalMap };
}

function applyVariableBindingValue(resolved, propertyKey, variable) {
  if (!resolved || !propertyKey || !variable) return resolved;
  const next = { ...resolved, styles: { ...(resolved.styles ?? {}) } };
  const value = variable.value;
  switch (propertyKey) {
    case 'text':
      next.text = value == null ? '' : `${value}`;
      break;
    case 'hidden':
      next.hidden = !value;
      break;
    case 'styles.backgroundImage':
      next.styles.backgroundImage = typeof value === 'string' ? value : `${value ?? ''}`;
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
      next.src = typeof value === 'string' ? value : `${value ?? ''}`;
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
  mobile:  { id: 'mobile',  name: 'Mobile',  icon: '📱', width: 375,  height: 812,  x: 2440, y: 120, viewportFoldH: null },
};

const COMPONENT_EDITOR_BREAKPOINTS = {
  desktop: { id: 'desktop', name: 'Component', icon: '⬢', width: 820, height: 560, x: 120, y: 120, viewportFoldH: null },
};

const COMPONENT_EDITOR_VARIANT_GAP = 140;
const COMPONENT_EDITOR_VARIANT_TOP = 100;
const COMPONENT_EDITOR_VARIANT_SIDE_PAD = 120;

const COMPONENT_ROOT_LAYOUT_KEYS = [
  'width', 'height', 'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
  'minW', 'maxW', 'minH', 'maxH', 'hidden', 'constraints',
];

function makeComponentPrimaryRoot(config = {}) {
  return {
    id: config.id ?? makeId('cmp-root'),
    type: 'frame',
    name: 'Primary',
    parentId: null,
    children: [],
    componentRoot: true,
    base: {
      x: config.x ?? 0,
      y: config.y ?? 0,
      width: config.width ?? 240,
      height: config.height ?? 160,
      rotation: 0,
      locked: config.locked ?? false,
      hidden: false,
      widthMode: config.widthMode ?? 'fixed',
      heightMode: config.heightMode ?? 'fixed',
      widthPct: config.widthPct ?? null,
      heightPct: config.heightPct ?? null,
      widthFr: config.widthFr ?? 1,
      heightFr: config.heightFr ?? 1,
      minW: config.minW ?? null,
      maxW: config.maxW ?? null,
      minH: config.minH ?? null,
      maxH: config.maxH ?? null,
      constraints: deepClone(config.constraints ?? { top: true, left: true, right: false, bottom: false }),
      styles: {
        backgroundColor: 'transparent',
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        borderStyle: 'solid',
        opacity: 1,
        overflow: 'visible',
        display: null,
        flexDirection: 'row',
        flexWrap: 'nowrap',
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        boxShadow: '',
        zIndex: config.zIndex ?? 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

function ensureComponentPrimaryRoot(snapshot = []) {
  const normalized = deepClone(snapshot ?? []);
  const root = getSnapshotRoot(normalized);
  if (!root) return [];

  normalized.forEach((el) => {
    delete el.componentInstance;
  });

  if (root.componentRoot) {
    root.name = 'Primary';
    root.parentId = null;
    root.base = {
      ...root.base,
      widthMode: 'fixed',
      heightMode: 'fixed',
    };
    return normalized;
  }

  const rootBase = root.base ?? {};
  const wrapper = makeComponentPrimaryRoot({
    ...pick(rootBase, COMPONENT_ROOT_LAYOUT_KEYS),
    zIndex: rootBase.styles?.zIndex ?? 1,
  });

  ['tablet', 'mobile'].forEach((bpId) => {
    const sourceOverride = root.overrides?.[bpId] ?? {};
    const nextOverride = pick(sourceOverride, COMPONENT_ROOT_LAYOUT_KEYS);
    const zIndex = sourceOverride.styles?.zIndex;
    if (zIndex != null) nextOverride.styles = { zIndex };
    if (Object.keys(nextOverride).length) wrapper.overrides[bpId] = nextOverride;
  });

  wrapper.children = [root.id];
  root.parentId = wrapper.id;
  root.base = { ...root.base, x: 0, y: 0 };
  ['tablet', 'mobile'].forEach((bpId) => {
    const override = root.overrides?.[bpId];
    if (!override) return;
    root.overrides[bpId] = {
      ...override,
      ...(override.x != null ? { x: 0 } : {}),
      ...(override.y != null ? { y: 0 } : {}),
    };
  });

  return [wrapper, ...normalized];
}

const COMPONENT_TRANSITION_TYPES = new Set(['instant', 'ease', 'realistic']);
const COMPONENT_EASE_PRESETS = new Set(['easeInOut', 'easeOut', 'easeIn', 'linear', 'custom']);
const COMPONENT_VARIANT_MODES = new Set(['default', 'hover', 'pressed']);
const COMPONENT_VARIANT_STATE_ORDER = ['hover', 'pressed'];
const COMPONENT_VARIANT_STATE_LABELS = {
  default: 'Default',
  hover: 'Hover',
  pressed: 'Pressed',
};

function getComponentVariantStateLabel(mode) {
  return COMPONENT_VARIANT_STATE_LABELS[mode] ?? 'State';
}

function isDefaultComponentVariant(variant) {
  return (variant?.mode ?? 'default') === 'default';
}

function getDefaultComponentVariants(component) {
  return (component?.variants ?? []).filter(isDefaultComponentVariant);
}

function getPrimaryComponentVariant(component) {
  return getDefaultComponentVariants(component)[0] ?? component?.variants?.[0] ?? null;
}

function getBaseComponentVariantId(variants, variantId = null) {
  const selected = (variants ?? []).find((variant) => variant.id === variantId) ?? null;
  if (!selected) return getDefaultComponentVariants({ variants })[0]?.id ?? null;
  return isDefaultComponentVariant(selected) ? selected.id : (selected.parentVariantId ?? null);
}

function insertVariantAfterFamily(variants, baseVariantId, nextVariant) {
  const existing = variants ?? [];
  const baseId = getBaseComponentVariantId(existing, baseVariantId) ?? baseVariantId;
  const familyIndexes = existing.reduce((acc, variant, index) => {
    if (variant.id === baseId || variant.parentVariantId === baseId) acc.push(index);
    return acc;
  }, []);
  const insertIndex = familyIndexes.length ? (familyIndexes[familyIndexes.length - 1] + 1) : existing.length;
  return [
    ...existing.slice(0, insertIndex),
    nextVariant,
    ...existing.slice(insertIndex),
  ];
}

function insertStateVariant(variants, baseVariantId, stateVariant) {
  const existing = variants ?? [];
  const family = existing.filter((variant) => variant.id === baseVariantId || variant.parentVariantId === baseVariantId);
  const stateOrderIndex = COMPONENT_VARIANT_STATE_ORDER.indexOf(stateVariant.mode);
  const sameFamilyInsertIndex = family.findIndex((variant) => {
    if (isDefaultComponentVariant(variant)) return false;
    return COMPONENT_VARIANT_STATE_ORDER.indexOf(variant.mode) > stateOrderIndex;
  });
  if (sameFamilyInsertIndex === -1) return insertVariantAfterFamily(existing, baseVariantId, stateVariant);
  const familyVariant = family[sameFamilyInsertIndex];
  const insertIndex = existing.findIndex((variant) => variant.id === familyVariant.id);
  return [
    ...existing.slice(0, insertIndex),
    stateVariant,
    ...existing.slice(insertIndex),
  ];
}

function clampFinite(value, fallback, min = -Infinity, max = Infinity) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function normalizeViewportValue(viewport, fallback = { x: 80, y: 80, scale: 0.55 }) {
  return {
    x: clampFinite(viewport?.x, fallback?.x ?? 80, -100000, 100000),
    y: clampFinite(viewport?.y, fallback?.y ?? 80, -100000, 100000),
    scale: clampFinite(viewport?.scale, fallback?.scale ?? 0.55, 0.08, 8),
  };
}

function normalizeComponentBezier(bezier) {
  return {
    x1: clampFinite(bezier?.x1, 0.44, 0, 1),
    y1: clampFinite(bezier?.y1, 0, 0, 1),
    x2: clampFinite(bezier?.x2, 0.56, 0, 1),
    y2: clampFinite(bezier?.y2, 1, 0, 1),
  };
}

function normalizeComponentTransition(transition) {
  const type = COMPONENT_TRANSITION_TYPES.has(transition?.type) ? transition.type : 'instant';
  const easePreset = COMPONENT_EASE_PRESETS.has(transition?.easePreset) ? transition.easePreset : 'easeInOut';
  const springMode = transition?.springMode === 'physics' ? 'physics' : 'time';
  return {
    type,
    duration: clampFinite(transition?.duration, 0.3, 0, 20),
    easePreset,
    springMode,
    bounce: clampFinite(transition?.bounce, 0.2, 0, 1),
    stiffness: clampFinite(transition?.stiffness, 500, 1, 2000),
    damping: clampFinite(transition?.damping, 24, 1, 300),
    mass: clampFinite(transition?.mass, 1, 0.1, 20),
    bezier: normalizeComponentBezier(transition?.bezier),
  };
}

function normalizeComponentInteraction(interaction) {
  const targetVariantId = typeof interaction?.targetVariantId === 'string' && interaction.targetVariantId
    ? interaction.targetVariantId
    : null;
  if (!targetVariantId) return null;
  return {
    targetVariantId,
    trigger: typeof interaction?.trigger === 'string' ? interaction.trigger : 'click',
    delay: clampFinite(interaction?.delay, 0, 0, 60),
    transition: normalizeComponentTransition(interaction?.transition),
  };
}

function normalizeComponentVariant(variant, fallbackName = 'Variant', { primary = false } = {}) {
  const mode = primary
    ? 'default'
    : (COMPONENT_VARIANT_MODES.has(variant?.mode) ? variant.mode : 'default');
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

  return {
    ...component,
    defaultVariantId,
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

function applyVariantOverrides(primarySnapshot, overrideSnapshot = []) {
  const normalizedPrimary = ensureComponentPrimaryRoot(primarySnapshot ?? []);
  const baseMap = new Map(normalizedPrimary.map((el) => [el.id, deepClone(el)]));
  const deleteIds = new Set();

  const collectDeleteIds = (elementId) => {
    if (deleteIds.has(elementId)) return;
    deleteIds.add(elementId);
    const el = baseMap.get(elementId);
    (el?.children ?? []).forEach(collectDeleteIds);
  };

  overrideSnapshot.forEach((entry) => {
    if (entry?.__deleted) collectDeleteIds(entry.id);
  });

  let next = normalizedPrimary
    .filter((el) => !deleteIds.has(el.id))
    .map((el) => ({ ...deepClone(el), children: (el.children ?? []).filter((childId) => !deleteIds.has(childId)) }));

  const nextMap = new Map(next.map((el) => [el.id, el]));
  overrideSnapshot.forEach((entry) => {
    if (!entry || entry.__deleted) return;
    if (nextMap.has(entry.id)) {
      const merged = deepMerge(nextMap.get(entry.id), entry);
      delete merged.__added;
      nextMap.set(entry.id, merged);
    } else {
      const added = deepClone(entry);
      delete added.__added;
      nextMap.set(added.id, added);
    }
  });

  next = Array.from(nextMap.values());
  return ensureComponentPrimaryRoot(next);
}

function composeVariantSnapshot(component, variantId = null) {
  const primaryVariant = getPrimaryComponentVariant(component);
  if (!primaryVariant) return [];
  const primarySnapshot = ensureComponentPrimaryRoot(primaryVariant.snapshot ?? []);
  const variant = getComponentVariant(component, variantId ?? primaryVariant.id);
  if (!variant || variant.id === primaryVariant.id) return primarySnapshot;
  if (isDefaultComponentVariant(variant)) {
    return applyVariantOverrides(primarySnapshot, variant.snapshot ?? []);
  }
  const visited = new Set([variant.id]);
  let parentVariantId = variant.parentVariantId;
  while (parentVariantId && visited.has(parentVariantId)) parentVariantId = null;
  const parentSnapshot = parentVariantId
    ? composeVariantSnapshot(component, parentVariantId)
    : primarySnapshot;
  return applyVariantOverrides(parentSnapshot, variant.snapshot ?? []);
}

function stripComponentEditorMeta(element) {
  const next = deepClone(element);
  delete next.componentEditorVariantId;
  delete next.componentSourceId;
  delete next.componentVariantName;
  delete next.componentVariantOrder;
  delete next.componentVariantPrimary;
  delete next.componentVariantMode;
  delete next.componentVariantParentId;
  return next;
}

function instantiateEditorVariantSnapshot(snapshot, variant, order, rootX, rootY) {
  const root = getSnapshotRoot(snapshot);
  if (!root) return [];

  const idMap = {};
  snapshot.forEach((el) => {
    idMap[el.id] = makeId(el.type === 'text' ? 'txt' : el.type === 'image' ? 'img' : 'fr');
  });

  return deepClone(snapshot).map((el) => {
    const isRoot = el.id === root.id;
    return {
      ...el,
      id: idMap[el.id],
      parentId: isRoot ? null : (idMap[el.parentId] ?? null),
      children: (el.children ?? []).map((childId) => idMap[childId]).filter(Boolean),
      componentEditorVariantId: variant.id,
      componentSourceId: el.id,
      componentVariantName: variant.name,
      componentVariantOrder: order,
      componentVariantPrimary: order === 0,
      componentVariantMode: variant.mode ?? 'default',
      componentVariantParentId: variant.parentVariantId ?? null,
      base: isRoot
        ? { ...el.base, x: rootX, y: rootY }
        : el.base,
    };
  });
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

function getEditorVariantRoot(elements, variantId) {
  return (elements ?? []).find((el) => !el.parentId && el.componentRoot && el.componentEditorVariantId === variantId) ?? null;
}

function extractEditorVariantSnapshot(elements, variantId) {
  const root = getEditorVariantRoot(elements, variantId);
  if (!root) return [];

  const byRuntimeId = new Map((elements ?? []).map((el) => [el.id, el]));
  const subtree = [];
  const visit = (runtimeId) => {
    const el = byRuntimeId.get(runtimeId);
    if (!el) return;
    subtree.push(el);
    (el.children ?? []).forEach(visit);
  };
  visit(root.id);

  const runtimeToSource = new Map(subtree.map((el) => [el.id, el.componentSourceId ?? el.id]));
  const normalized = subtree.map((el) => {
    const next = stripComponentEditorMeta(el);
    next.id = el.componentSourceId ?? el.id;
    next.parentId = el.parentId ? (runtimeToSource.get(el.parentId) ?? null) : null;
    next.children = (el.children ?? []).map((childId) => runtimeToSource.get(childId)).filter(Boolean);
    delete next.componentInstance;
    if (next.componentRoot) {
      next.name = 'Primary';
      next.base = { ...next.base, x: 0, y: 0 };
    }
    return next;
  });

  return ensureComponentPrimaryRoot(normalized);
}

function extractVariantOverrides(primarySnapshot, variantSnapshot) {
  const normalizedPrimary = ensureComponentPrimaryRoot(primarySnapshot ?? []);
  const normalizedVariant = ensureComponentPrimaryRoot(variantSnapshot ?? []);
  const primaryMap = new Map(normalizedPrimary.map((el) => [el.id, el]));
  const variantMap = new Map(normalizedVariant.map((el) => [el.id, el]));
  const overrides = [];

  normalizedPrimary.forEach((primaryEl) => {
    if (!variantMap.has(primaryEl.id)) overrides.push({ id: primaryEl.id, __deleted: true });
  });

  normalizedVariant.forEach((variantEl) => {
    const primaryEl = primaryMap.get(variantEl.id);
    if (!primaryEl) {
      overrides.push({ ...deepClone(variantEl), __added: true });
      return;
    }

    const delta = { id: variantEl.id };
    ['type', 'name', 'parentId', 'children', 'base', 'overrides'].forEach((key) => {
      const keyDiff = diffValue(primaryEl[key], variantEl[key]);
      if (keyDiff !== undefined) delta[key] = keyDiff;
    });

    if (Object.keys(delta).length > 1) overrides.push(delta);
  });

  return overrides;
}

function syncComponentEditorVariants(componentEditor) {
  const currentVariants = componentEditor?.variants ?? [];
  if (!currentVariants.length) return [];
  const pageElements = componentEditor.page?.elements ?? [];
  const presentVariants = currentVariants.filter((variant) => !!getEditorVariantRoot(pageElements, variant.id));
  if (!presentVariants.length) return currentVariants;

  const primaryVariant = getPrimaryComponentVariant({ variants: presentVariants });
  const primarySnapshot = extractEditorVariantSnapshot(pageElements, primaryVariant?.id);
  if (!primarySnapshot.length) return currentVariants;

  const fullSnapshotsById = new Map();
  fullSnapshotsById.set(primaryVariant.id, primarySnapshot);

  return presentVariants.map((variant) => {
    if (variant.id === primaryVariant.id) {
      return { ...variant, name: 'Primary', mode: 'default', parentVariantId: null, snapshot: primarySnapshot, interaction: normalizeComponentInteraction(variant.interaction) };
    }
    const fullVariantSnapshot = extractEditorVariantSnapshot(pageElements, variant.id);
    fullSnapshotsById.set(variant.id, fullVariantSnapshot);
    const parentSnapshot = isDefaultComponentVariant(variant)
      ? primarySnapshot
      : (fullSnapshotsById.get(variant.parentVariantId) ?? extractEditorVariantSnapshot(pageElements, variant.parentVariantId) ?? primarySnapshot);
    return {
      ...variant,
      name: isDefaultComponentVariant(variant) ? variant.name : getComponentVariantStateLabel(variant.mode),
      interaction: isDefaultComponentVariant(variant) ? normalizeComponentInteraction(variant.interaction) : null,
      snapshot: extractVariantOverrides(parentSnapshot, fullVariantSnapshot),
    };
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
  // tablet/mobile start as null = inherit from parent breakpoint
  background: { desktop: '#ffffff', tablet: null, mobile: null },
  // padding: null per bp = inherit from parent breakpoint
  padding: { desktop: { top: 0, right: 0, bottom: 0, left: 0 }, tablet: null, mobile: null },
  // layout: null per bp = inherit; object = { flexDirection, alignItems, justifyContent, flexWrap, gap }
  layout: { desktop: null, tablet: null, mobile: null },
  variables: [],
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
    variants: [],
    page: makeComponentEditorPage(),
    breakpointDefs: deepClone(COMPONENT_EDITOR_BREAKPOINTS),
    uiRestore: null,
  };
}


function buildPersistableLayoutPayload(state) {
  const page = state.pages.find((item) => item.id === state.currentPageId);
  const componentEditorOpen = state.activeSurface === 'component' && state.componentEditor?.isOpen;

  const components = componentEditorOpen
    ? state.components.map((component) => {
        if (component.id !== state.componentEditor.componentId) return component;
        const syncedVariants = syncComponentEditorVariants(state.componentEditor);
        return normalizeStoredComponent({
          ...component,
          updatedAt: Date.now(),
          defaultVariantId: component.defaultVariantId ?? syncedVariants[0]?.id ?? null,
          variants: syncedVariants,
          snapshot: syncedVariants[0]?.snapshot ?? [],
        });
      })
    : state.components;

  return {
    ...page,
    variables: normalizeVariableList(page?.variables, 'page'),
    _breakpointDefs: state.breakpointDefs,
    _componentLibrary: components,
  };
}

function normalizePageData(page) {
  const fallback = makeDefaultPage();
  return {
    ...fallback,
    ...(page ?? {}),
    background: { ...fallback.background, ...(page?.background ?? {}) },
    padding: { ...fallback.padding, ...(page?.padding ?? {}) },
    layout: { ...fallback.layout, ...(page?.layout ?? {}) },
    variables: normalizeVariableList(page?.variables, 'page'),
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
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      styles: {
        backgroundColor: 'rgba(180,180,200,0.18)',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, overflow: 'visible', display: 'flex', flexDirection: 'row',
        flexWrap: 'nowrap', gap: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0,
        paddingLeft: 0, alignItems: 'flex-start', justifyContent: 'flex-start', boxShadow: '', zIndex: 1,
      },
    },
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
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      src: '',
      styles: {
        backgroundColor: 'transparent',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, objectFit: 'cover', boxShadow: '', zIndex: 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createText(x = 80, y = 80, name) {
  return {
    id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    name: name || 'Text',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 60, rotation: 0, locked: false, hidden: false,
      widthMode: 'hug', heightMode: 'hug',
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      text: 'Text',
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
        zIndex: 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

// Merge base + breakpoint overrides into rendered props.
// Cascade: desktop (base)  →  tablet  →  mobile
export function resolveElement(el, bpId) {
  if (bpId === 'desktop') return { ...el.base, styles: { ...el.base.styles } };
  const tabOv = el.overrides?.tablet ?? {};
  if (bpId === 'tablet') {
    return { ...el.base, ...tabOv, styles: { ...el.base.styles, ...(tabOv.styles ?? {}) } };
  }
  // mobile: base  →  tablet override  →  mobile override
  const mobOv = el.overrides?.mobile ?? {};
  return {
    ...el.base, ...tabOv, ...mobOv,
    styles: { ...el.base.styles, ...(tabOv.styles ?? {}), ...(mobOv.styles ?? {}) },
  };
}

export function resolveElementWithVariables(el, bpId, pageVariables = [], globalVariables = []) {
  const resolved = resolveElement(el, bpId);
  const bindings = normalizeElementBindings(el?.bindings);
  const variableMaps = getVariableMap(pageVariables, globalVariables);
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

function getSnapshotRoot(snapshot) {
  const idSet = new Set(snapshot.map(el => el.id));
  return snapshot.find(el => !idSet.has(el.parentId)) ?? snapshot[0] ?? null;
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
    idMap[el.id] = el.id === root.id && targetRootId ? targetRootId : makeId(el.type === 'text' ? 'txt' : el.type === 'image' ? 'img' : 'fr');
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
    'x', 'y', 'width', 'height', 'rotation',
    'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
    'minW', 'maxW', 'minH', 'maxH',
    'hidden', 'locked', 'positionType', 'absoluteInLayout', 'constraints',
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
      'x', 'y', 'width', 'height', 'rotation',
      'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
      'minW', 'maxW', 'minH', 'maxH',
      'hidden', 'positionType', 'absoluteInLayout', 'constraints',
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

function snapshot(pages) { return JSON.stringify(pages); }
const MAX_HISTORY = 60;

// ── Store ────────────────────────────────────────────────────

export const useEditorStore = create((set, get) => {
  // Helper: update elements array of current page
  const withPage = (updater) =>
    set(state => {
      if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
        return {
          componentEditor: {
            ...state.componentEditor,
            page: {
              ...state.componentEditor.page,
              elements: updater(state.componentEditor.page?.elements ?? []),
            },
          },
        };
      }
      return {
        pages: state.pages.map(p =>
          p.id === state.currentPageId ? { ...p, elements: updater(p.elements) } : p
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

    // ── Variables (page + site-wide) ──────────────────────
    globalVariables: [],
    setGlobalVariables: (variables) => set({ globalVariables: normalizeVariableList(variables, 'global') }),
    variableSources: { pages: [], posts: [], products: [] },
    setVariableSources: (sources) => set({
      variableSources: {
        pages: Array.isArray(sources?.pages) ? sources.pages : [],
        posts: Array.isArray(sources?.posts) ? sources.posts : [],
        products: Array.isArray(sources?.products) ? sources.products : [],
      },
    }),
    variablesModalOpen: false,
    setVariablesModalOpen: (open) => set({ variablesModalOpen: !!open }),

    getCurrentPageVariables() {
      return normalizeVariableList(getActivePage()?.variables, 'page');
    },

    getAllVariables() {
      return [
        ...normalizeVariableList(get().getCurrentPageVariables(), 'page'),
        ...normalizeVariableList(get().globalVariables, 'global'),
      ];
    },

    getCompatibleVariables(propertyKey) {
      const allowedTypes = VARIABLE_PROPERTY_COMPATIBILITY[propertyKey] ?? [];
      return get().getAllVariables().filter((variable) => allowedTypes.includes(variable.type));
    },

    async loadGlobalVariables() {
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'variables?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
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
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'variables?_wpnonce=' + encodeURIComponent(nonce);
          await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ variables: normalizedVariables }),
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
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'variable-sources?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
          if (data.success) {
            set({
              variableSources: {
                pages: Array.isArray(data.pages) ? data.pages : [],
                posts: Array.isArray(data.posts) ? data.posts : [],
                products: Array.isArray(data.products) ? data.products : [],
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

    // ── Components (site-wide) ─────────────────────────────
    components: [],
    setComponents: (components) => set({ components }),

    async loadComponents() {
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'components?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
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

    async saveComponents(components) {
      const normalizedComponents = components.map(normalizeStoredComponent);
      set({ components: normalizedComponents });
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'components?_wpnonce=' + encodeURIComponent(nonce);
          await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ components: normalizedComponents }),
          });
        } else {
          localStorage.setItem('fb_component_library', JSON.stringify(normalizedComponents));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveComponents failed', e);
      }
    },

    createComponentFromElement(elementId, name) {
      const elements = get().pages.find(p => p.id === get().currentPageId)?.elements ?? [];
      const rootEl = findEl(elements, elementId);
      if (!rootEl) return null;
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
      const variant = getComponentVariant(component, component?.defaultVariantId);
      const composedSnapshot = composeVariantSnapshot(component, variant?.id ?? component?.defaultVariantId);
      if (!variant || !composedSnapshot.length) return null;

      const instantiated = instantiateComponentSnapshot(composedSnapshot, {
        targetParentId: parentId,
        rootPosition: { x, y },
        bpId,
        componentInstance: { componentId, variantId: variant.id, role: 'instance' },
      });
      const root = getSnapshotRoot(instantiated);
      if (!root) return null;

      withPage((els) => {
        let next = [...els, ...instantiated];
        if (parentId) {
          next = next.map(el => (
            el.id === parentId
              ? { ...el, children: [...(el.children ?? []), root.id] }
              : el
          ));
        }
        return next;
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
          const variant = getComponentVariant(component, rootEl.componentInstance?.variantId ?? component.defaultVariantId);
          const composedSnapshot = composeVariantSnapshot(component, variant?.id ?? component.defaultVariantId);
          if (!variant || !composedSnapshot.length) return;
          const instantiated = instantiateComponentSnapshot(composedSnapshot, {
            targetRootId: rootEl.id,
            targetParentId: rootEl.parentId ?? null,
            componentInstance: { ...(rootEl.componentInstance ?? {}), componentId, variantId: variant.id },
          });
          const rootNext = getSnapshotRoot(instantiated);
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
      const variant = getComponentVariant(component, variantId);
      const composedSnapshot = composeVariantSnapshot(component, variant?.id ?? component?.defaultVariantId);
      if (!variant || !composedSnapshot.length) return;

      withPage((els) => {
        const instantiated = instantiateComponentSnapshot(composedSnapshot, {
          targetRootId: rootEl.id,
          targetParentId: rootEl.parentId ?? null,
          componentInstance: { ...(rootEl.componentInstance ?? {}), componentId, variantId: variant.id },
        });
        const rootNext = getSnapshotRoot(instantiated);
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

      const state = get();
      const uiRestore = {
        selection: state.selection,
        artboardSel: state.artboardSel,
        hoveredId: state.hoveredId,
        drilledContainerId: state.drilledContainerId,
        pendingDraw: state.pendingDraw,
        leftTab: state.leftTab,
        breakpointDefs: deepClone(state.breakpointDefs),
      };

      set({
        activeSurface: 'component',
        breakpointDefs: deepClone(componentBreakpoints),
        leftTab: 'layers',
        selection: initialRoot ? buildSelection([initialRoot.id], 'desktop', initialRoot.id) : null,
        artboardSel: null,
        hoveredId: null,
        drilledContainerId: null,
        pendingDraw: null,
        componentEditor: {
          isOpen: true,
          componentId,
          activeVariantId: initialVariantId,
          variants: deepClone(normalizedComponent.variants ?? []),
          page: {
            ...makeComponentEditorPage(),
            title: normalizedComponent.name,
            elements: editorCanvas.elements,
          },
          breakpointDefs: deepClone(componentBreakpoints),
          uiRestore,
        },
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
      const syncedVariants = syncComponentEditorVariants(current);
      const nextComponents = state.components.map(component => (
        component.id === current.componentId
          ? normalizeStoredComponent({
              ...component,
              updatedAt: Date.now(),
              defaultVariantId: component.defaultVariantId ?? syncedVariants[0]?.id ?? null,
              variants: syncedVariants,
              snapshot: syncedVariants[0]?.snapshot ?? [],
            })
          : component
      ));
      set({
        activeSurface: 'page',
        selection: normalizeSelection(current.uiRestore?.selection),
        artboardSel: current.uiRestore?.artboardSel ?? null,
        hoveredId: current.uiRestore?.hoveredId ?? null,
        drilledContainerId: current.uiRestore?.drilledContainerId ?? null,
        pendingDraw: current.uiRestore?.pendingDraw ?? null,
        leftTab: current.uiRestore?.leftTab ?? 'layers',
        breakpointDefs: current.uiRestore?.breakpointDefs ?? BREAKPOINTS,
        componentEditor: makeEmptyComponentEditor(),
      });
      get().saveComponents(nextComponents);
      get().applyComponentToInstances(current.componentId);
    },

    async loadColorStyles() {
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'color-styles?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
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
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'color-styles?_wpnonce=' + encodeURIComponent(nonce);
          await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ styles }),
          });
        } else {
          localStorage.setItem('fb_color_styles', JSON.stringify(styles));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveColorStyles failed', e);
      }
    },

    // ── UI state ───────────────────────────────────────────
    leftTab: 'layers',
    setLeftTab: (tab) => set({ leftTab: tab }),
    selection: null,   // { elementId, elementIds, bpId }
    setSelection: (sel) => set({ selection: normalizeSelection(sel) }),
    clearSelection: () => set({ selection: null }),
    selectOnly(sel) {
      set({ selection: normalizeSelection(sel) });
    },
    addToSelection(sel) {
      set((state) => {
        const nextSelection = normalizeSelection(sel);
        if (!nextSelection) return state;
        const current = normalizeSelection(state.selection);
        if (!current || current.bpId !== nextSelection.bpId) {
          return { selection: nextSelection };
        }
        if (current.elementIds.includes(nextSelection.elementId)) {
          return { selection: buildSelection(current.elementIds, current.bpId, nextSelection.elementId) };
        }
        return {
          selection: buildSelection(
            [...current.elementIds, nextSelection.elementId],
            current.bpId,
            nextSelection.elementId,
          ),
        };
      });
    },
    toggleSelection(sel) {
      set((state) => {
        const nextSelection = normalizeSelection(sel);
        if (!nextSelection) return { selection: null };
        const current = normalizeSelection(state.selection);
        if (!current || current.bpId !== nextSelection.bpId) {
          return { selection: nextSelection };
        }
        if (!current.elementIds.includes(nextSelection.elementId)) {
          return {
            selection: buildSelection(
              [...current.elementIds, nextSelection.elementId],
              current.bpId,
              nextSelection.elementId,
            ),
          };
        }
        return {
          selection: removeSelectionIds(current, [nextSelection.elementId]),
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
    hoveredId: null,   // elementId hovered in layers panel
    setHoveredId: (id) => set({ hoveredId: id }),
    drilledContainerId: null, // element whose direct children are single-click selectable (null = artboard root)
    setDrilledContainerId: (id) => set({ drilledContainerId: id }),
    artboardSel: null, // bpId of the currently selected artboard
    setArtboardSel: (bpId) => set({ artboardSel: bpId }),
    pendingDraw: null, // 'frame' | 'image' | null — click-to-draw mode
    setPendingDraw: (type) => set({ pendingDraw: type }),
    interacting: false,
    setInteracting: (v) => set({ interacting: v }),
    saveStatus: null,
    setSaveStatus: (s) => set({ saveStatus: s }),

    // ── Getters ────────────────────────────────────────────
    getCurrentPage() {
      return getActivePage();
    },
    getAllElements() { return getEls(); },
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
      let el = { ...element, parentId: parentId ?? null };
      if (bpId && bpId !== 'desktop') {
        // Hide on all breakpoints via base, then show only on originating bp
        el = {
          ...el,
          base: { ...el.base, hidden: true },
          overrides: {
            ...el.overrides,
            [bpId]: { ...(el.overrides?.[bpId] ?? {}), hidden: false },
          },
        };
      }
      withPage(els => {
        const next = [...els, el];
        if (parentId) {
          return next.map(e =>
            e.id === parentId ? { ...e, children: [...(e.children ?? []), el.id] } : e
          );
        }
        return next;
      });
      set({ selection: buildSelection([el.id], bpId ?? 'desktop', el.id) });
    },

    /** Update base (desktop) non-style props: name, locked, etc. */
    updateElementBase(elementId, updates) {
      withPage(els =>
        els.map(el => el.id === elementId ? { ...el, base: { ...el.base, ...updates } } : el)
      );
    },

    updateElementsBase(elementIds, updates) {
      const targetIds = new Set((elementIds ?? []).filter(Boolean));
      if (!targetIds.size) return;
      withPage((els) => els.map((el) => (
        targetIds.has(el.id)
          ? { ...el, base: { ...el.base, ...updates } }
          : el
      )));
    },

    /** Update style props for a breakpoint.
     *  Desktop → base.styles. Tablet/Mobile → overrides[bpId].styles */
    updateElementStyles(elementId, bpId, styleUpdates) {
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        if (bpId === 'desktop') {
          return { ...el, base: { ...el.base, styles: { ...el.base.styles, ...styleUpdates } } };
        }
        const ov = el.overrides?.[bpId] ?? {};
        return {
          ...el,
          overrides: {
            ...el.overrides,
            [bpId]: { ...ov, styles: { ...(ov.styles ?? {}), ...styleUpdates } },
          },
        };
      }));
    },

    updateElementsStyles(elementIds, bpId, styleUpdates) {
      const targetIds = new Set((elementIds ?? []).filter(Boolean));
      if (!targetIds.size) return;
      withPage((els) => els.map((el) => {
        if (!targetIds.has(el.id)) return el;
        if (bpId === 'desktop') {
          return { ...el, base: { ...el.base, styles: { ...el.base.styles, ...styleUpdates } } };
        }
        const ov = el.overrides?.[bpId] ?? {};
        return {
          ...el,
          overrides: {
            ...el.overrides,
            [bpId]: { ...ov, styles: { ...(ov.styles ?? {}), ...styleUpdates } },
          },
        };
      }));
    },

    /** Update layout props (x,y,w,h,rotation,hidden,locked) for a breakpoint.
     *  Desktop → base. Tablet/Mobile → overrides[bpId]. */
    updateElementLayout(elementId, bpId, updates) {
      const safeUpdates = sanitizeLayoutUpdates(updates);
      if (!safeUpdates || !Object.keys(safeUpdates).length) return;
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        if (bpId === 'desktop') return { ...el, base: { ...el.base, ...safeUpdates } };
        const ov = el.overrides?.[bpId] ?? {};
        return { ...el, overrides: { ...el.overrides, [bpId]: { ...ov, ...safeUpdates } } };
      }));
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
        if (bpId === 'desktop') return { ...el, base: { ...el.base, ...safeUpdates } };
        const ov = el.overrides?.[bpId] ?? {};
        return { ...el, overrides: { ...el.overrides, [bpId]: { ...ov, ...safeUpdates } } };
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

    /** Delete element and all its descendants */
    deleteElement(elementId) {
      get().deleteElements([elementId]);
    },

    deleteElements(elementIds) {
      const els = getEls();
      const toDelete = new Set();
      const collect = (id) => {
        toDelete.add(id);
        const el = findEl(els, id);
        (el?.children ?? []).forEach(collect);
      };
      (elementIds ?? []).forEach(collect);
      if (!toDelete.size) return;
      withPage(currEls => currEls
        .filter(e => !toDelete.has(e.id))
        .map(e => ({ ...e, children: (e.children ?? []).filter(c => !toDelete.has(c)) }))
      );
      set(state => ({
        selection: removeSelectionIds(state.selection, toDelete),
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
              && resolved.positionType !== 'relative';
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
    addElements(elements) {
      withPage(els => [...els, ...elements]);
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

        const el = findEl(els, elementId);
        if (!el) return els;
        const oldParentId = el.parentId;

        return els.map(e => {
          if (e.id === elementId) return { ...e, parentId: newParentId ?? null };
          if (e.id === oldParentId) {
            return { ...e, children: (e.children ?? []).filter(c => c !== elementId) };
          }
          if (newParentId && e.id === newParentId) {
            return { ...e, children: [...(e.children ?? []), elementId] };
          }
          return e;
        });
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

    pushHistory() {
      const snap = snapshot(get().pages);
      set(state => {
        const trimmed = state.history.slice(0, state.historyIndex + 1);
        const next = [...trimmed, snap].slice(-MAX_HISTORY);
        return { history: next, historyIndex: next.length - 1 };
      });
    },

    undo() {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      set({ pages: JSON.parse(history[historyIndex - 1]), historyIndex: historyIndex - 1 });
    },

    redo() {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      set({ pages: JSON.parse(history[historyIndex + 1]), historyIndex: historyIndex + 1 });
    },

    // ── Persist / Load / Publish ───────────────────────────

    async saveLayout() {
      const state = get();
      get().setSaveStatus('saving');
      // wp_localize_script converts everything to strings, so postId is "0" not 0
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const payload = buildPersistableLayoutPayload(state);
          const data = await postWordPressAction('save-layout', 'framebuilder_save_layout', {
            post_id: postId,
            layout: payload,
          });
          get().setSaveStatus(data.success ? 'ok' : 'error');
        } else {
          const payload = buildPersistableLayoutPayload(state);
          localStorage.setItem('fb_layout_' + state.currentPageId, JSON.stringify(payload));
          get().setSaveStatus('ok');
        }
      } catch (err) {
        console.error('[FrameBuilder] save failed', err);
        get().setSaveStatus('error');
      }
      setTimeout(() => get().setSaveStatus(null), 2500);
    },

    async loadLayout() {
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'get-layout/' + postId + '?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
          if (data.success && data.layout) {
            const { _breakpointDefs, ...cleanLayout } = data.layout;
            set(state => ({
              pages: state.pages.map(p =>
                p.id === state.currentPageId
                  ? normalizePageData({ ...cleanLayout, id: state.currentPageId })
                  : p
              ),
              ...(_breakpointDefs ? { breakpointDefs: _breakpointDefs } : {}),
            }));
          }
        } else {
          const stored = localStorage.getItem('fb_layout_page-1');
          if (stored) {
            const { _breakpointDefs, ...cleanLayout } = JSON.parse(stored);
            set(state => ({
              pages: state.pages.map(p =>
                p.id === state.currentPageId ? normalizePageData({ ...cleanLayout, id: state.currentPageId }) : p
              ),
              ...(_breakpointDefs ? { breakpointDefs: _breakpointDefs } : {}),
            }));
          }
        }
      } catch (err) {
        console.warn('[FrameBuilder] loadLayout failed', err);
      }
    },

    async publishLayout() {
      const state = get();
      get().setSaveStatus('saving');
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const publishPayload = buildPersistableLayoutPayload(state);
          const data = await postWordPressAction('publish', 'framebuilder_publish_layout', {
            post_id: postId,
            layout: publishPayload,
          });
          get().setSaveStatus(data.success ? 'ok' : 'error');
          if (data.success && data.permalink) window.open(data.permalink, '_blank');
        } else {
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
