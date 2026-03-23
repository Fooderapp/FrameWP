import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyVariantOverrides,
  composeVariantSnapshot,
  ensureComponentPrimaryRoot,
  getLiveComponentEditorVariants,
  getSnapshotRoot,
} from '../../src/domain/componentSnapshotModel.js';

function makeRoot(id = 'root') {
  return {
    id,
    type: 'frame',
    name: 'Primary',
    parentId: null,
    children: ['child'],
    componentRoot: true,
    base: {
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      widthMode: 'fixed',
      heightMode: 'fixed',
      rotation: 0,
      hidden: false,
      lockAspectRatio: false,
      minW: null,
      maxW: null,
      minH: null,
      maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      styles: { zIndex: 1 },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

function makeChild(id = 'child') {
  return {
    id,
    type: 'text',
    name: 'Text',
    parentId: 'root',
    children: [],
    base: {
      x: 12,
      y: 16,
      width: 120,
      height: 40,
      rotation: 0,
      hidden: false,
      styles: { color: '#111111' },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

test('ensureComponentPrimaryRoot wraps snapshots that do not have a component root', () => {
  const normalized = ensureComponentPrimaryRoot([{ ...makeChild('standalone'), parentId: null }]);
  const root = getSnapshotRoot(normalized);

  assert.equal(normalized.length, 2);
  assert.equal(root.componentRoot, true);
  assert.equal(root.children[0], 'standalone');
});

test('applyVariantOverrides merges changes and respects deletions', () => {
  const primarySnapshot = [makeRoot(), makeChild()];
  const next = applyVariantOverrides(primarySnapshot, [
    { id: 'child', base: { styles: { color: '#ff0000' } } },
  ]);

  assert.equal(next.find((entry) => entry.id === 'child').base.styles.color, '#ff0000');

  const deleted = applyVariantOverrides(primarySnapshot, [{ id: 'child', __deleted: true }]);
  assert.equal(deleted.some((entry) => entry.id === 'child'), false);
});

test('composeVariantSnapshot resolves default variant overrides against the primary snapshot', () => {
  const component = {
    defaultVariantId: 'primary',
    variants: [
      { id: 'primary', mode: 'default', snapshot: [makeRoot(), makeChild()] },
      { id: 'secondary', mode: 'default', snapshot: [{ id: 'child', base: { styles: { color: '#00ff00' } } }] },
    ],
  };

  const composed = composeVariantSnapshot(component, 'secondary');
  assert.equal(composed.find((entry) => entry.id === 'child').base.styles.color, '#00ff00');
});

test('getLiveComponentEditorVariants rebuilds editor variants from runtime elements', () => {
  const componentEditor = {
    variants: [
      { id: 'primary', name: 'Primary', mode: 'default', parentVariantId: null, interaction: null },
      { id: 'hover', name: 'Hover', mode: 'hover', parentVariantId: 'primary', interaction: null },
    ],
    page: {
      elements: [
        {
          ...makeRoot('runtime-root-primary'),
          children: ['runtime-child-primary'],
          componentEditorVariantId: 'primary',
          componentSourceId: 'root',
          componentVariantName: 'Primary',
          componentVariantOrder: 0,
          componentVariantPrimary: true,
          componentVariantMode: 'default',
          componentVariantParentId: null,
        },
        {
          ...makeChild('runtime-child-primary'),
          parentId: 'runtime-root-primary',
          componentEditorVariantId: 'primary',
          componentSourceId: 'child',
          componentVariantName: 'Primary',
          componentVariantOrder: 0,
          componentVariantPrimary: true,
          componentVariantMode: 'default',
          componentVariantParentId: null,
        },
        {
          ...makeRoot('runtime-root-hover'),
          children: ['runtime-child-hover'],
          componentEditorVariantId: 'hover',
          componentSourceId: 'root',
          componentVariantName: 'Hover',
          componentVariantOrder: 0,
          componentVariantPrimary: false,
          componentVariantMode: 'hover',
          componentVariantParentId: 'primary',
        },
        {
          ...makeChild('runtime-child-hover'),
          parentId: 'runtime-root-hover',
          base: { ...makeChild('runtime-child-hover').base, styles: { color: '#ffaa00' } },
          componentEditorVariantId: 'hover',
          componentSourceId: 'child',
          componentVariantName: 'Hover',
          componentVariantOrder: 0,
          componentVariantPrimary: false,
          componentVariantMode: 'hover',
          componentVariantParentId: 'primary',
        },
      ],
    },
  };

  const variants = getLiveComponentEditorVariants(componentEditor);
  assert.equal(variants.length, 2);
  assert.equal(variants[0].name, 'Primary');
  assert.equal(variants[1].name, 'Hover');
  assert.equal(variants[1].snapshot[0].id, 'child');
  assert.equal(variants[1].snapshot[0].base.styles.color, '#ffaa00');
});