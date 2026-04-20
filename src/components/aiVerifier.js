/**
 * AI post-build verifier + auto-fixer.
 *
 * After the executor runs a batch, we walk the created/updated elements
 * and fix common LLM mistakes DETERMINISTICALLY (no extra LLM call):
 *   - text elements missing fontFamily
 *   - root sections missing widthMode/positionType/width
 *   - flex containers missing flexDirection
 *   - children inside flex parents stuck on positionType:'absolute'
 *   - invalid parent references (orphaned)
 *
 * Returns an array of human-readable fix descriptions so the UI
 * can display "Auto-fixed: 3 issues" to the user.
 */

const DEFAULT_FONT = 'Inter';

// Typography scale — snap fontSize to the nearest allowed value.
const FONT_SCALE = [12, 14, 15, 16, 18, 20, 24, 32, 40, 44, 48, 56, 64, 72, 88];
// Spacing scale (8-px grid with a couple extras). Snap padding/gap.
const SPACING_SCALE = [0, 2, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 120];
// Font weights that actually render across common webfonts.
const WEIGHT_SCALE = [300, 400, 500, 600, 700, 800, 900];

function snap(scale, value) {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return null;
  let best = scale[0], bestDiff = Math.abs(scale[0] - value);
  for (let i = 1; i < scale.length; i++) {
    const d = Math.abs(scale[i] - value);
    if (d < bestDiff) { best = scale[i]; bestDiff = d; }
  }
  return best;
}

const SPACING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap'];

export function verifyAndFix(createdOrTouchedIds, store) {
  const page = store.getCurrentPage?.();
  if (!page) return [];
  const all = page.elements || [];
  const byId = Object.fromEntries(all.map((e) => [e.id, e]));
  const ids = Array.from(new Set(createdOrTouchedIds.filter(Boolean)));
  const fixes = [];

  for (const id of ids) {
    const el = byId[id];
    if (!el) continue;

    const baseFixes = {};
    const styleFixes = {};

    // 1. Text element missing fontFamily
    if (el.type === 'text') {
      const ff = el.base?.styles?.fontFamily;
      if (!ff || ff === '' || ff === 'inherit') {
        styleFixes.fontFamily = DEFAULT_FONT;
        fixes.push(`${el.name || el.id}: set fontFamily to ${DEFAULT_FONT}`);
      }
    }

    // 2. Root section without proper sizing
    if (!el.parentId && (el.type === 'frame' || el.type === 'form')) {
      if (el.base?.widthMode !== 'fixed') {
        baseFixes.widthMode = 'fixed';
        fixes.push(`${el.name || el.id}: forced widthMode:fixed (root section)`);
      }
      if (el.base?.width == null || el.base.width < 1200) {
        baseFixes.width = 1440;
        fixes.push(`${el.name || el.id}: forced width:1440 (root section)`);
      }
      if (el.base?.positionType !== 'relative') {
        baseFixes.positionType = 'relative';
      }
    }

    // 3. Flex container with 2+ children but no flexDirection
    const childCount = Array.isArray(el.children) ? el.children.length : 0;
    const display = el.base?.styles?.display;
    if (childCount >= 2 && display === 'flex') {
      if (!el.base?.styles?.flexDirection) {
        styleFixes.flexDirection = 'column';
        fixes.push(`${el.name || el.id}: set flexDirection:column (flex container)`);
      }
    }

    // 4. Child inside flex parent stuck on absolute
    if (el.parentId) {
      const parent = byId[el.parentId];
      const pd = parent?.base?.styles?.display;
      if ((pd === 'flex' || pd === 'grid') && el.base?.positionType === 'absolute') {
        baseFixes.positionType = 'relative';
        baseFixes.absoluteInLayout = false;
        baseFixes.x = 0;
        baseFixes.y = 0;
        fixes.push(`${el.name || el.id}: forced relative position (child of flex)`);
      }
    }

    // 5. Orphaned parentId (parent was deleted or never existed)
    if (el.parentId && !byId[el.parentId]) {
      baseFixes.parentId = null; // promote to root
      fixes.push(`${el.name || el.id}: orphaned parentId cleared`);
    }

    // 6. Image/video without intrinsic dimensions
    if ((el.type === 'image' || el.type === 'video') && (!el.base?.width || !el.base?.height)) {
      if (!el.base?.width) baseFixes.width = el.type === 'video' ? 640 : 800;
      if (!el.base?.height) baseFixes.height = el.type === 'video' ? 360 : 500;
      fixes.push(`${el.name || el.id}: added default ${el.type} dimensions`);
    }

    // 7. Scale snapping — fontSize, padding*, gap, fontWeight
    const styles = el.base?.styles || {};
    if (el.type === 'text' && typeof styles.fontSize === 'number') {
      const snapped = snap(FONT_SCALE, styles.fontSize);
      if (snapped != null && snapped !== styles.fontSize) {
        styleFixes.fontSize = snapped;
        fixes.push(`${el.name || el.id}: snapped fontSize ${styles.fontSize}→${snapped}`);
      }
    }
    if (typeof styles.fontWeight === 'number') {
      const snappedW = snap(WEIGHT_SCALE, styles.fontWeight);
      if (snappedW != null && snappedW !== styles.fontWeight) {
        styleFixes.fontWeight = snappedW;
        fixes.push(`${el.name || el.id}: snapped fontWeight ${styles.fontWeight}→${snappedW}`);
      }
    }
    for (const k of SPACING_KEYS) {
      const v = styles[k];
      if (typeof v === 'number') {
        const s = snap(SPACING_SCALE, v);
        if (s != null && s !== v) {
          styleFixes[k] = s;
          fixes.push(`${el.name || el.id}: snapped ${k} ${v}→${s}`);
        }
      }
    }

    // Apply fixes
    if (Object.keys(baseFixes).length) {
      try { store.updateElementBase(id, baseFixes); } catch { /* ignore */ }
    }
    if (Object.keys(styleFixes).length) {
      try { store.updateElementStyles(id, 'desktop', styleFixes); } catch { /* ignore */ }
    }
  }

  return fixes;
}
