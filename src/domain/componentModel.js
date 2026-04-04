import { makeId } from '../utils/id.js';
import { clampFinite, normalizeComponentTransition } from './componentTransition.js';

const COMPONENT_VARIANT_MODES = new Set(['default', 'hover', 'pressed']);
export const COMPONENT_VARIANT_STATE_ORDER = ['hover', 'pressed'];
const COMPONENT_VARIANT_STATE_LABELS = {
  default: 'Default',
  hover: 'Hover',
  pressed: 'Pressed',
};
const COMPONENT_CONTROL_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'color', 'image', 'url']);
const COMPONENT_CONTROL_BINDABLE_PROPERTIES = new Set([
  'text',
  'src',
  'hidden',
  'linkUrl',
  'variant',
  'styles.backgroundColor',
  'styles.backgroundImage',
  'styles.color',
  'styles.fontFamily',
  'styles.borderRadius',
  'styles.borderWidth',
  'styles.opacity',
  'styles.zIndex',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function slugifyComponentControlName(value, fallback = 'variable') {
  const normalized = `${value ?? ''}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function ensureUniqueComponentControlName(name, usedNames) {
  const baseName = slugifyComponentControlName(name);
  let nextName = baseName;
  let suffix = 2;
  while (usedNames.has(nextName)) {
    nextName = `${baseName}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(nextName);
  return nextName;
}

export function normalizeComponentControlOption(option, index = 0) {
  if (typeof option === 'string') {
    const value = option.trim();
    return { label: value || `Option ${index + 1}`, value: value || `option-${index + 1}` };
  }

  const rawValue = option?.value;
  const value = typeof rawValue === 'string'
    ? rawValue.trim()
    : `${rawValue ?? ''}`.trim();
  const rawLabel = typeof option?.label === 'string' ? option.label.trim() : '';

  return {
    label: rawLabel || value || `Option ${index + 1}`,
    value: value || `option-${index + 1}`,
  };
}

export function normalizeComponentControlValue(type, value, options = []) {
  if (type === 'boolean') return value === true;
  if (type === 'number') return clampFinite(value, 0);
  if (type === 'color') {
    const next = typeof value === 'string' ? value.trim() : '';
    return next || '#000000';
  }

  const next = typeof value === 'string'
    ? value
    : (value == null ? '' : `${value}`);

  if (type === 'select') {
    const match = options.find((option) => option.value === next);
    return match?.value ?? options[0]?.value ?? '';
  }

  return next;
}

export function normalizeComponentControlBinding(binding) {
  const elementId = typeof binding?.elementId === 'string' && binding.elementId.trim()
    ? binding.elementId.trim()
    : null;
  const property = typeof binding?.property === 'string' && COMPONENT_CONTROL_BINDABLE_PROPERTIES.has(binding.property)
    ? binding.property
    : null;
  if (!elementId || !property) return null;
  return { elementId, property };
}

export function normalizeComponentControl(control, index = 0) {
  const type = COMPONENT_CONTROL_TYPES.has(control?.type) ? control.type : 'text';
  const options = type === 'select'
    ? (Array.isArray(control?.options) ? control.options : []).map((option, optionIndex) => normalizeComponentControlOption(option, optionIndex))
    : [];
  const dedupedOptions = options.filter((option, optionIndex, allOptions) => allOptions.findIndex((candidate) => candidate.value === option.value) === optionIndex);
  const bindings = (Array.isArray(control?.bindings) ? control.bindings : [])
    .map(normalizeComponentControlBinding)
    .filter(Boolean);

  return {
    id: typeof control?.id === 'string' && control.id.trim() ? control.id.trim() : makeId('cmp-ctrl'),
    name: slugifyComponentControlName(control?.name || control?.label || `variable_${index + 1}`, `variable_${index + 1}`),
    type,
    label: typeof control?.label === 'string' && control.label.trim() ? control.label.trim() : `Control ${index + 1}`,
    defaultValue: normalizeComponentControlValue(type, control?.defaultValue, dedupedOptions),
    options: dedupedOptions,
    bindings,
  };
}

export function normalizeComponentControls(controls) {
  const seen = new Set();
  const usedNames = new Set();
  return (Array.isArray(controls) ? controls : [])
    .map((control, index) => {
      const normalized = normalizeComponentControl(control, index);
      return {
        ...normalized,
        name: ensureUniqueComponentControlName(normalized.name, usedNames),
      };
    })
    .filter((control) => {
      if (seen.has(control.id)) return false;
      seen.add(control.id);
      return true;
    });
}

export function normalizeComponentInstanceProps(component, props) {
  const normalizedProps = isPlainObject(props) ? props : {};
  const nextProps = {};
  (component?.controls ?? []).forEach((control) => {
    if (!Object.prototype.hasOwnProperty.call(normalizedProps, control.id)) return;
    nextProps[control.id] = normalizeComponentControlValue(control.type, normalizedProps[control.id], control.options ?? []);
  });
  return nextProps;
}

export function getComponentControlValue(control, props = {}) {
  if (Object.prototype.hasOwnProperty.call(props, control.id)) {
    return normalizeComponentControlValue(control.type, props[control.id], control.options ?? []);
  }
  return normalizeComponentControlValue(control.type, control.defaultValue, control.options ?? []);
}

export function getComponentVariantStateLabel(mode) {
  return COMPONENT_VARIANT_STATE_LABELS[mode] ?? 'State';
}

export function isDefaultComponentVariant(variant) {
  return (variant?.mode ?? 'default') === 'default';
}

export function getDefaultComponentVariants(component) {
  return (component?.variants ?? []).filter(isDefaultComponentVariant);
}

export function getPrimaryComponentVariant(component) {
  return getDefaultComponentVariants(component)[0] ?? component?.variants?.[0] ?? null;
}

export function getBaseComponentVariantId(variants, variantId = null) {
  const selected = (variants ?? []).find((variant) => variant.id === variantId) ?? null;
  if (!selected) return getDefaultComponentVariants({ variants })[0]?.id ?? null;
  return isDefaultComponentVariant(selected) ? selected.id : (selected.parentVariantId ?? null);
}

export function insertVariantAfterFamily(variants, baseVariantId, nextVariant) {
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

export function insertStateVariant(variants, baseVariantId, stateVariant) {
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

export function normalizeComponentInteraction(interaction) {
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

export function resolveComponentVariantMode(mode, { primary = false } = {}) {
  if (primary) return 'default';
  return COMPONENT_VARIANT_MODES.has(mode) ? mode : 'default';
}