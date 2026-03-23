import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFloatingInspectorPosition } from '../../src/utils/rect.js';
import { normalizeConstraints, sanitizeLayoutUpdates } from '../../src/domain/layoutModel.js';
import { normalizeElementAnimation, applyAnimationPreviewPatch } from '../../src/domain/animationModel.js';

test('resolveFloatingInspectorPosition prefers floating outside the panel when there is room on the left', () => {
  const position = resolveFloatingInspectorPosition({
    anchorRect: { top: 220, right: 1180, bottom: 260, left: 1140, width: 40, height: 40 },
    containerRect: { top: 120, left: 420, width: 360, height: 900 },
  });

  assert.equal(position.position, 'absolute');
  assert.equal(position.left, -354);
  assert.equal(position.top, 90);
});

test('resolveFloatingInspectorPosition falls back inside the panel when outside-left space is unavailable', () => {
  const position = resolveFloatingInspectorPosition({
    anchorRect: { top: 180, right: 500, bottom: 220, left: 460, width: 40, height: 40 },
    containerRect: { top: 120, left: 80, width: 360, height: 400 },
  });

  assert.equal(position.left, 12);
  assert.equal(position.top, 50);
});

test('normalizeConstraints preserves stretch pins and sanitizeLayoutUpdates normalizes numeric values', () => {
  const constraints = normalizeConstraints({ left: true, right: true, top: true, bottom: false });
  const updates = sanitizeLayoutUpdates({ width: '240.5', height: 'invalid', constraints: { left: true, right: true } });

  assert.deepEqual(constraints, {
    horizontal: 'stretch',
    vertical: 'top',
    left: true,
    right: true,
    top: true,
    bottom: false,
  });
  assert.deepEqual(updates, {
    width: 240.5,
    constraints: {
      horizontal: 'stretch',
      vertical: 'top',
      left: true,
      right: true,
      top: true,
      bottom: false,
    },
  });
});

test('normalizeElementAnimation applies scroll defaults and marker offset bounds', () => {
  const animation = normalizeElementAnimation({
    type: 'scroll',
    startOffsetPx: 50000,
    endOffsetPx: -50000,
    effect: { offsetY: 120 },
  });

  assert.equal(animation.type, 'scroll');
  assert.equal(animation.start, 0.2);
  assert.equal(animation.end, 0.68);
  assert.equal(animation.startOffsetPx, 20000);
  assert.equal(animation.endOffsetPx, -20000);
  assert.equal(animation.effect.offsetY, 120);
});

test('applyAnimationPreviewPatch recenters animated size overrides for flow-positioned elements', () => {
  const resolved = {
    x: 100,
    y: 200,
    width: 300,
    height: 180,
    positionType: 'relative',
    styles: { opacity: 1 },
  };
  const patch = {
    layout: { width: 240, height: 120 },
    styles: { opacity: 0.4 },
  };

  const next = applyAnimationPreviewPatch(resolved, patch);

  assert.equal(next.x, 130);
  assert.equal(next.y, 230);
  assert.equal(next.width, 240);
  assert.equal(next.height, 120);
  assert.equal(next.styles.opacity, 0.4);
});