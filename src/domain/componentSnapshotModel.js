import { makeId } from '../utils/id.js';
import { getComponentVariantStateLabel, getPrimaryComponentVariant, isDefaultComponentVariant, normalizeComponentInteraction } from './componentModel.js';
import { normalizeComponentTransition } from './componentTransition.js';

const COMPONENT_ROOT_LAYOUT_KEYS = [
  'width', 'height', 'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
  'minW', 'maxW', 'minH', 'maxH', 'hidden', 'constraints', 'lockAspectRatio', 'rotation', 'rotationX', 'rotationY',
];

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (obj && key in obj) acc[key] = obj[key];
    return acc;
  }, {});
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

function getComponentVariant(component, variantId = null) {
  if (!component?.variants?.length) return null;
  return component.variants.find((variant) => variant.id === variantId)
    ?? component.variants.find((variant) => variant.id === component.defaultVariantId)
    ?? component.variants[0]
    ?? null;
}

function getElementIdPrefix(type) {
  if (type === 'text') return 'txt';
  if (type === 'image') return 'img';
  if (type === 'icon') return 'ico';
  if (type === 'video') return 'vid';
  if (type === 'scroll-sequence') return 'seq';
  if (type === 'embed') return 'emb';
  return 'fr';
}

export function getSnapshotRoot(snapshot = []) {
  const idSet = new Set(snapshot.map((element) => element.id));
  return snapshot.find((element) => !idSet.has(element.parentId)) ?? snapshot[0] ?? null;
}

export function makeComponentPrimaryRoot(config = {}) {
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
      rotation: config.rotation ?? 0,
      rotationX: config.rotationX ?? 0,
      rotationY: config.rotationY ?? 0,
      locked: config.locked ?? false,
      hidden: false,
      widthMode: config.widthMode ?? 'fixed',
      heightMode: config.heightMode ?? 'fixed',
      widthPct: config.widthPct ?? null,
      heightPct: config.heightPct ?? null,
      widthFr: config.widthFr ?? 1,
      heightFr: config.heightFr ?? 1,
      lockAspectRatio: config.lockAspectRatio ?? false,
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
        mixBlendMode: 'normal',
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

export function ensureComponentPrimaryRoot(snapshot = []) {
  const normalized = deepClone(snapshot ?? []);
  const root = getSnapshotRoot(normalized);
  if (!root) return [];

  normalized.forEach((element) => {
    delete element.componentInstance;
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
  root.base = {
    ...root.base,
    x: 0,
    y: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    positionType: 'relative',
    absoluteInLayout: false,
  };
  ['tablet', 'mobile'].forEach((bpId) => {
    const override = root.overrides?.[bpId];
    if (!override) return;
    root.overrides[bpId] = {
      ...override,
      ...(override.x != null ? { x: 0 } : {}),
      ...(override.y != null ? { y: 0 } : {}),
      ...(override.rotation != null ? { rotation: 0 } : {}),
      ...(override.rotationX != null ? { rotationX: 0 } : {}),
      ...(override.rotationY != null ? { rotationY: 0 } : {}),
      ...(override.positionType != null ? { positionType: 'relative' } : {}),
      ...(override.absoluteInLayout != null ? { absoluteInLayout: false } : {}),
    };
  });

  return [wrapper, ...normalized];
}

export function applyVariantOverrides(primarySnapshot, overrideSnapshot = []) {
  const normalizedPrimary = ensureComponentPrimaryRoot(primarySnapshot ?? []);
  const baseMap = new Map(normalizedPrimary.map((element) => [element.id, deepClone(element)]));
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

  let next = normalizedPrimary
    .filter((element) => !deleteIds.has(element.id))
    .map((element) => ({ ...deepClone(element), children: (element.children ?? []).filter((childId) => !deleteIds.has(childId)) }));

  const nextMap = new Map(next.map((element) => [element.id, element]));
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

export function composeVariantSnapshot(component, variantId = null) {
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

export function instantiateEditorVariantSnapshot(snapshot, variant, order, rootX, rootY) {
  const root = getSnapshotRoot(snapshot);
  if (!root) return [];

  const idMap = {};
  snapshot.forEach((element) => {
    idMap[element.id] = makeId(getElementIdPrefix(element.type));
  });

  return deepClone(snapshot).map((element) => {
    const isRoot = element.id === root.id;
    return {
      ...element,
      id: idMap[element.id],
      parentId: isRoot ? null : (idMap[element.parentId] ?? null),
      children: (element.children ?? []).map((childId) => idMap[childId]).filter(Boolean),
      componentEditorVariantId: variant.id,
      componentSourceId: element.id,
      componentVariantName: variant.name,
      componentVariantOrder: order,
      componentVariantPrimary: order === 0,
      componentVariantMode: variant.mode ?? 'default',
      componentVariantParentId: variant.parentVariantId ?? null,
      base: isRoot
        ? { ...element.base, x: rootX, y: rootY }
        : element.base,
    };
  });
}

export function getEditorVariantRoot(elements, variantId) {
  return (elements ?? []).find((element) => !element.parentId && element.componentRoot && element.componentEditorVariantId === variantId) ?? null;
}

function extractEditorVariantSnapshot(elements, variantId) {
  const root = getEditorVariantRoot(elements, variantId);
  if (!root) return [];

  const byRuntimeId = new Map((elements ?? []).map((element) => [element.id, element]));
  const subtree = [];
  const visit = (runtimeId) => {
    const element = byRuntimeId.get(runtimeId);
    if (!element) return;
    subtree.push(element);
    (element.children ?? []).forEach(visit);
  };
  visit(root.id);

  const runtimeToSource = new Map(subtree.map((element) => [element.id, element.componentSourceId ?? element.id]));
  const normalized = subtree.map((element) => {
    const next = stripComponentEditorMeta(element);
    next.id = element.componentSourceId ?? element.id;
    next.parentId = element.parentId ? (runtimeToSource.get(element.parentId) ?? null) : null;
    next.children = (element.children ?? []).map((childId) => runtimeToSource.get(childId)).filter(Boolean);
    delete next.componentInstance;
    if (next.componentRoot) {
      next.name = 'Primary';
      next.base = { ...next.base, x: 0, y: 0 };
    }
    return next;
  });

  return ensureComponentPrimaryRoot(normalized);
}

export function extractVariantOverrides(primarySnapshot, variantSnapshot) {
  const normalizedPrimary = ensureComponentPrimaryRoot(primarySnapshot ?? []);
  const normalizedVariant = ensureComponentPrimaryRoot(variantSnapshot ?? []);
  const primaryMap = new Map(normalizedPrimary.map((element) => [element.id, element]));
  const variantMap = new Map(normalizedVariant.map((element) => [element.id, element]));
  const overrides = [];

  normalizedPrimary.forEach((primaryElement) => {
    if (!variantMap.has(primaryElement.id)) overrides.push({ id: primaryElement.id, __deleted: true });
  });

  normalizedVariant.forEach((variantElement) => {
    const primaryElement = primaryMap.get(variantElement.id);
    if (!primaryElement) {
      overrides.push({ ...deepClone(variantElement), __added: true });
      return;
    }

    const delta = { id: variantElement.id };
    ['type', 'name', 'parentId', 'children', 'base', 'overrides'].forEach((key) => {
      const keyDiff = diffValue(primaryElement[key], variantElement[key]);
      if (keyDiff !== undefined) delta[key] = keyDiff;
    });

    if (Object.keys(delta).length > 1) overrides.push(delta);
  });

  return overrides;
}

export function getLiveComponentEditorVariants(componentEditor) {
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
      return {
        ...variant,
        name: 'Primary',
        mode: 'default',
        parentVariantId: null,
        snapshot: primarySnapshot,
        interaction: normalizeComponentInteraction(variant.interaction),
        childTransition: normalizeComponentTransition(variant.childTransition),
      };
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
      childTransition: isDefaultComponentVariant(variant) ? normalizeComponentTransition(variant.childTransition) : null,
      snapshot: extractVariantOverrides(parentSnapshot, fullVariantSnapshot),
    };
  });
}