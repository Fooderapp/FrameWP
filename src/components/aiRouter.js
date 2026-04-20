/**
 * Client-side intent router.
 * Maps user prompts to deterministic command batches when possible,
 * avoiding an LLM round-trip entirely.
 *
 * Returns:
 *   { kind: 'template', commands, message } — zero-LLM template
 *   { kind: 'edit',     commands, message } — deterministic selection edit
 *   { kind: 'llm' }                          — defer to LLM
 */

import { TEMPLATES } from './aiTemplates';

/* ── Named colors & parsing ───────────────────────────────── */

const NAMED_COLORS = {
  red: '#ef4444', crimson: '#dc2626', rose: '#f43f5e',
  orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  green: '#22c55e', emerald: '#10b981', lime: '#84cc16', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  gray: '#64748b', grey: '#64748b', slate: '#475569', zinc: '#52525b',
  black: '#000000', white: '#ffffff',
  transparent: 'transparent',
};

function parseColor(text) {
  const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) return hex[0];
  const rgba = text.match(/rgba?\([^)]+\)/i);
  if (rgba) return rgba[0];
  for (const name of Object.keys(NAMED_COLORS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) return NAMED_COLORS[name];
  }
  return null;
}

function parsePx(text, after) {
  // e.g. "padding 24", "radius 16px", "size 18"
  const re = new RegExp(`${after}[^0-9-]{0,12}(-?\\d+)\\s*(px)?`, 'i');
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : null;
}

/* ── Template keyword matching ────────────────────────────── */

const TEMPLATE_PATTERNS = [
  { re: /\b(hero)\s*(section|banner)?\b/i,                   key: 'hero' },
  { re: /\b(nav|navbar|navigation|header|menu bar)\b/i,      key: 'navbar' },
  { re: /\b(features?|feature grid|3[\s-]?column|cards? grid)\b/i, key: 'features' },
  { re: /\b(cta|call[\s-]?to[\s-]?action|signup section)\b/i, key: 'cta' },
  { re: /\b(footer)\b/i,                                      key: 'footer' },
  { re: /\b(contact\s*form|get\s*in\s*touch|inquiry\s*form|feedback\s*form)\b/i, key: 'contactForm' },
  { re: /\b(video\s*section|demo\s*video|video\s*hero|show\s*video)\b/i,         key: 'videoSection' },
  { re: /\b(testimonials?|reviews?|quotes?|social\s*proof)\b/i,                   key: 'testimonials' },
  { re: /\b(pricing|pricing\s*(table|section|plans?|cards?|grid))\b/i,            key: 'pricing' },
  { re: /\b(faq|faqs|frequently\s*asked|questions?\s*(section|page)?)\b/i,        key: 'faq' },
];

function pickTheme(text) {
  if (/\b(dark|night|black)\b/i.test(text)) return 'dark';
  if (/\b(light|white|bright|minimal)\b/i.test(text)) return 'light';
  return 'dark';
}

/* ── Descendant targeting ─────────────────────────────────── */

/**
 * Target specs: map user phrases to element-predicate functions.
 * Each predicate receives the element and returns true if it matches.
 */
const TARGET_SPECS = [
  {
    re: /\b(all |every |the )?(headings?|titles?|headline|h1|h2|h3)\b/i,
    label: 'headings',
    test: (el) =>
      el.type === 'text' &&
      (
        (typeof el.base?.styles?.fontSize === 'number' && el.base.styles.fontSize >= 24) ||
        /\b(heading|title|headline|h1|h2|h3)\b/i.test(el.name || '')
      ),
  },
  {
    re: /\b(all |every |the )?(subheadings?|subtitles?|h4|h5)\b/i,
    label: 'subheadings',
    test: (el) =>
      el.type === 'text' &&
      (
        /\b(sub(heading|title)|h4|h5)\b/i.test(el.name || '') ||
        (typeof el.base?.styles?.fontSize === 'number' &&
          el.base.styles.fontSize >= 18 && el.base.styles.fontSize < 24)
      ),
  },
  {
    re: /\b(all |every |the )?(body|paragraphs?|copy|descriptions?)\b/i,
    label: 'body text',
    test: (el) =>
      el.type === 'text' &&
      (
        /\b(body|paragraph|copy|description|text)\b/i.test(el.name || '') ||
        (typeof el.base?.styles?.fontSize === 'number' && el.base.styles.fontSize < 20)
      ),
  },
  {
    re: /\b(all |every |the )?(texts?|labels?|captions?)\b/i,
    label: 'text',
    test: (el) => el.type === 'text',
  },
  {
    re: /\b(all |every |the )?(buttons?|ctas?)\b/i,
    label: 'buttons',
    test: (el) => /\b(button|cta|btn)\b/i.test(el.name || ''),
  },
  {
    re: /\b(all |every |the )?(cards?|tiles?)\b/i,
    label: 'cards',
    test: (el) => /\b(card|tile|feature|item)\b/i.test(el.name || ''),
  },
  {
    re: /\b(all |every |the )?(links?)\b/i,
    label: 'links',
    test: (el) => /\blink\b/i.test(el.name || ''),
  },
  {
    re: /\b(all |every |the )?(images?|photos?|pics?)\b/i,
    label: 'images',
    test: (el) => el.type === 'image',
  },
  {
    re: /\b(all |every |the )?(icons?)\b/i,
    label: 'icons',
    test: (el) =>
      (el.type === 'image' && /\bicon\b/i.test(el.name || '')) ||
      (el.type === 'frame' && /\bicon\b/i.test(el.name || '')),
  },
];

/**
 * Walk descendants of a set of root elements using a byId map.
 * Includes the roots themselves in the traversal.
 */
function collectDescendants(rootElements, byId) {
  const out = [];
  const seen = new Set();
  const stack = [...rootElements];
  while (stack.length) {
    const el = stack.pop();
    if (!el || seen.has(el.id)) continue;
    seen.add(el.id);
    out.push(el);
    const childIds = Array.isArray(el.children) ? el.children : [];
    for (const cid of childIds) {
      const c = byId[cid];
      if (c) stack.push(c);
    }
  }
  return out;
}

/**
 * Given prompt text + selected elements + full elements list,
 * return the subset of descendants the user means to target.
 *   - If a target phrase like "all titles" / "buttons" is detected,
 *     walk the selection subtree and return matches.
 *   - Otherwise return the selection itself (original behaviour).
 */
function resolveEditTargets(text, selectedElements, allElements) {
  if (!selectedElements?.length) return { targets: selectedElements, scope: 'self' };

  const byId = {};
  if (Array.isArray(allElements)) {
    for (const e of allElements) byId[e.id] = e;
  }
  // Re-resolve selection roots from the full map so we can walk .children
  const roots = selectedElements.map((s) => byId[s.id]).filter(Boolean);
  // If we have no byId map, we can't walk descendants — stick with selection.
  if (!Object.keys(byId).length || !roots.length) {
    return { targets: selectedElements, scope: 'self' };
  }

  for (const spec of TARGET_SPECS) {
    if (!spec.re.test(text)) continue;
    const pool = collectDescendants(roots, byId);
    const matches = pool.filter((el) => spec.test(el));
    if (matches.length) {
      return { targets: matches, scope: spec.label };
    }
    // Target phrase present but no matches found → don't silently fall through.
    return { targets: [], scope: spec.label, empty: true };
  }

  return { targets: selectedElements, scope: 'self' };
}

/* ── Intent detection ─────────────────────────────────────── */

function looksLikeTemplateRequest(text) {
  // must start with or contain a "create/add/build/make" verb + template word
  if (!/\b(create|add|build|make|generate|insert|drop in|give me|i want|need)\b/i.test(text)) return null;
  for (const { re, key } of TEMPLATE_PATTERNS) {
    if (re.test(text)) return key;
  }
  return null;
}

/**
 * Detect a deterministic "edit selection" prompt.
 * Returns updateElement commands, or null to fall back to LLM.
 */
function detectSelectionEdit(text, selectedElements, allElements) {
  if (!selectedElements?.length) return null;
  const t = text.toLowerCase();

  // Skip anything that looks creative/complex
  if (/\b(create|add|new|build|generate|insert|remove|delete|duplicate|move|rearrange)\b/.test(t)) return null;

  // Resolve actual targets (selection itself OR descendants matching a phrase like "all titles")
  const resolved = resolveEditTargets(text, selectedElements, allElements);
  if (resolved.empty) {
    return {
      commands: [],
      message: `Couldn't find any ${resolved.scope} inside the selection.`,
    };
  }
  const targets = resolved.targets;
  if (!targets.length) return null;

  const baseUpdates = {};
  const styleUpdates = {};
  let hits = 0;

  // Background color
  if (/\b(background|bg|fill)\b/.test(t)) {
    const c = parseColor(text);
    if (c) { styleUpdates.backgroundColor = c; hits++; }
  }
  // Text color
  if (/\b(text color|font color|color of text|make.*(text|font).*(color|colour))\b/.test(t) ||
      (/\b(color|colour)\b/.test(t) && !/\bbackground|\bbg\b|\bborder|\bshadow/.test(t))) {
    const c = parseColor(text);
    if (c && !styleUpdates.backgroundColor) { styleUpdates.color = c; hits++; }
  }
  // Border radius
  if (/\b(radius|rounded|round(ed)? corners?)\b/.test(t)) {
    const n = parsePx(text, '(radius|rounded|corners?)');
    if (n != null) { styleUpdates.borderRadius = n; hits++; }
    else if (/\b(rounded|round)\b/.test(t)) { styleUpdates.borderRadius = 12; hits++; }
    else if (/\bpill\b/.test(t)) { styleUpdates.borderRadius = 100; hits++; }
  }
  // Font size
  if (/\b(font size|text size|size)\b/.test(t)) {
    const n = parsePx(text, '(size)');
    if (n != null) { styleUpdates.fontSize = n; hits++; }
  }
  // Font weight
  const weightMap = { thin: 200, light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
  for (const [w, v] of Object.entries(weightMap)) {
    if (new RegExp(`\\bmake (it |the text )?${w}\\b|\\b${w}\\s*(weight|font)?\\b`, 'i').test(text)) {
      styleUpdates.fontWeight = v; hits++;
      break;
    }
  }
  // Padding
  if (/\bpadding\b/.test(t)) {
    const n = parsePx(text, 'padding');
    if (n != null) {
      styleUpdates.paddingTop = n; styleUpdates.paddingRight = n;
      styleUpdates.paddingBottom = n; styleUpdates.paddingLeft = n; hits++;
    }
  }
  // Gap
  if (/\bgap\b/.test(t)) {
    const n = parsePx(text, 'gap');
    if (n != null) { styleUpdates.gap = n; hits++; }
  }
  // Opacity
  if (/\bopacity\b/.test(t)) {
    const m = text.match(/opacity\s*(?:to|of|:)?\s*(\d+(?:\.\d+)?)\s*%?/i);
    if (m) { styleUpdates.opacity = parseFloat(m[1]) > 1 ? parseFloat(m[1]) / 100 : parseFloat(m[1]); hits++; }
  }
  // Hide / show
  if (/\b(hide|invisible)\b/.test(t)) { baseUpdates.hidden = true; hits++; }
  if (/\b(show|visible|unhide)\b/.test(t)) { baseUpdates.hidden = false; hits++; }
  // Rename
  const renameMatch = text.match(/\brename (?:it |this )?to ["']?([^"']+)["']?\s*$/i);
  if (renameMatch) { baseUpdates.name = renameMatch[1].trim(); hits++; }
  // Replace text (for text elements)
  const setTextMatch = text.match(/\b(?:change text to|set text to|text:|say)\s*["']([^"']+)["']/i);
  if (setTextMatch) { baseUpdates.text = setTextMatch[1]; hits++; }

  if (hits === 0) return null;

  const commands = targets.map((el) => ({
    action: 'updateElement',
    elementId: el.id,
    ...(Object.keys(baseUpdates).length ? { baseUpdates: { ...baseUpdates } } : {}),
    ...(Object.keys(styleUpdates).length ? { styleUpdates: { ...styleUpdates } } : {}),
  }));

  const parts = [];
  if (styleUpdates.backgroundColor) parts.push(`background ${styleUpdates.backgroundColor}`);
  if (styleUpdates.color)            parts.push(`text ${styleUpdates.color}`);
  if (styleUpdates.borderRadius != null) parts.push(`radius ${styleUpdates.borderRadius}px`);
  if (styleUpdates.fontSize)         parts.push(`size ${styleUpdates.fontSize}px`);
  if (styleUpdates.fontWeight)       parts.push(`weight ${styleUpdates.fontWeight}`);
  if (styleUpdates.opacity != null)  parts.push(`opacity ${styleUpdates.opacity}`);
  const scopeLabel = resolved.scope === 'self'
    ? `${targets.length} element${targets.length > 1 ? 's' : ''}`
    : `${targets.length} ${resolved.scope}`;
  const message = `Applied${parts.length ? ` — ${parts.join(', ')}` : ''} to ${scopeLabel}.`;

  return { commands, message };
}

/* ── Main entry ───────────────────────────────────────────── */

export function routeIntent(text, { selectedElements = [], allElements = [] } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { kind: 'llm' };

  // 1. Selection edit (highest priority when selection is present)
  const edit = detectSelectionEdit(trimmed, selectedElements, allElements);
  if (edit) return { kind: 'edit', ...edit };

  // 2. Template keyword — only when there is no selection (if selected, user likely wants to edit)
  if (!selectedElements.length) {
    const tplKey = looksLikeTemplateRequest(trimmed);
    if (tplKey && TEMPLATES[tplKey]) {
      const theme = pickTheme(trimmed);
      const commands = TEMPLATES[tplKey].build({ theme });
      return {
        kind: 'template',
        commands,
        message: `Added a ${TEMPLATES[tplKey].label.toLowerCase()}.`,
      };
    }
  }

  return { kind: 'llm' };
}
