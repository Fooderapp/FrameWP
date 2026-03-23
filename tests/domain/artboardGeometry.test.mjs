import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTBOARD_HEADER_HEIGHT,
  resolveArtboardGroupStyle,
  resolveArtboardHeaderStyle,
  resolveArtboardResizeHandleStyle,
  resolveArtboardSurfaceStyle,
} from '../../src/utils/artboardGeometry.js';

test('resolveArtboardGroupStyle offsets non-component surfaces by the header height', () => {
  const bp = { x: 120, y: 240, width: 800, height: 600 };

  assert.deepEqual(resolveArtboardGroupStyle(bp, 2, false), {
    left: 120,
    top: 222,
  });
  assert.deepEqual(resolveArtboardGroupStyle(bp, 2, true), {
    left: 120,
    top: 240,
  });
  assert.equal(ARTBOARD_HEADER_HEIGHT, 36);
});

test('resolveArtboardSurfaceStyle keeps artboard sizing and component transparency', () => {
  const bp = { width: 1024, height: 768 };

  assert.deepEqual(resolveArtboardSurfaceStyle(bp, '#ffffff', false), {
    width: 1024,
    height: 768,
    background: '#ffffff',
  });
  assert.deepEqual(resolveArtboardSurfaceStyle(bp, '#ffffff', true), {
    width: 1024,
    height: 768,
    background: 'transparent',
  });
});

test('header and resize handle styles stay tied to artboard width', () => {
  const bp = { width: 640 };

  assert.deepEqual(resolveArtboardHeaderStyle(bp), { width: 640 });
  assert.deepEqual(resolveArtboardResizeHandleStyle(bp), { width: 640 });
});