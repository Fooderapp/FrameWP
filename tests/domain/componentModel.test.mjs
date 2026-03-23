import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPONENT_VARIANT_STATE_ORDER,
  getBaseComponentVariantId,
  getComponentControlValue,
  getComponentVariantStateLabel,
  insertStateVariant,
  normalizeComponentControl,
  normalizeComponentControls,
  normalizeComponentInstanceProps,
  normalizeComponentInteraction,
  resolveComponentVariantMode,
} from '../../src/domain/componentModel.js';

test('normalizeComponentControl dedupes select options and normalizes defaults', () => {
  const control = normalizeComponentControl({
    type: 'select',
    options: ['One', { label: 'One Duplicate', value: 'One' }, { label: 'Two', value: 'Two' }],
    defaultValue: 'Missing',
  }, 0);

  assert.equal(control.type, 'select');
  assert.deepEqual(control.options, [
    { label: 'One', value: 'One' },
    { label: 'Two', value: 'Two' },
  ]);
  assert.equal(control.defaultValue, 'One');
});

test('normalizeComponentControls removes duplicate ids', () => {
  const controls = normalizeComponentControls([
    { id: 'title', label: 'Title' },
    { id: 'title', label: 'Duplicate Title' },
  ]);

  assert.equal(controls.length, 1);
  assert.equal(controls[0].id, 'title');
});

test('normalizeComponentInstanceProps and getComponentControlValue honor control types', () => {
  const component = {
    controls: [
      { id: 'enabled', type: 'boolean', defaultValue: false },
      { id: 'count', type: 'number', defaultValue: 2 },
    ],
  };

  const props = normalizeComponentInstanceProps(component, { enabled: true, count: '5' });

  assert.deepEqual(props, { enabled: true, count: 5 });
  assert.equal(getComponentControlValue(component.controls[1], {}), 2);
});

test('variant family helpers preserve state ordering and base variant resolution', () => {
  const variants = [
    { id: 'base', mode: 'default', parentVariantId: null },
    { id: 'pressed', mode: 'pressed', parentVariantId: 'base' },
  ];
  const inserted = insertStateVariant(variants, 'base', { id: 'hover', mode: 'hover', parentVariantId: 'base' });

  assert.deepEqual(COMPONENT_VARIANT_STATE_ORDER, ['hover', 'pressed']);
  assert.deepEqual(inserted.map((variant) => variant.id), ['base', 'hover', 'pressed']);
  assert.equal(getBaseComponentVariantId(inserted, 'pressed'), 'base');
});

test('component interaction and mode helpers normalize defaults', () => {
  const interaction = normalizeComponentInteraction({
    targetVariantId: 'variant-2',
    delay: '1.5',
    trigger: 'hover',
    transition: { type: 'ease', duration: '0.8' },
  });

  assert.equal(getComponentVariantStateLabel('hover'), 'Hover');
  assert.equal(resolveComponentVariantMode('pressed'), 'pressed');
  assert.equal(resolveComponentVariantMode('invalid'), 'default');
  assert.equal(resolveComponentVariantMode('hover', { primary: true }), 'default');
  assert.equal(interaction.targetVariantId, 'variant-2');
  assert.equal(interaction.delay, 1.5);
  assert.equal(interaction.transition.duration, 0.8);
});