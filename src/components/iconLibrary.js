const ICON_SVG_ATTRIBUTES = [
  'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx', 'ry', 'points',
  'transform', 'opacity', 'fill-opacity', 'stroke-opacity', 'xmlns', 'xmlns:xlink', 'href', 'xlink:href',
  'gradientunits', 'gradienttransform', 'offset', 'stop-color', 'stop-opacity', 'clip-path', 'clip-rule',
  'mask', 'maskunits', 'maskcontentunits', 'preserveaspectratio', 'role', 'aria-hidden', 'focusable', 'overflow', 'id', 'fx', 'fy', 'paint-order'
];

const ALLOWED_SVG_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'symbol', 'use', 'title', 'desc'
]);

const COLOR_SHAPE_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);

const FALLBACK_ICON_MARKUPS = {
  star: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.8l2.88 5.84 6.45.94-4.67 4.55 1.1 6.43L12 17.52 6.24 20.56l1.1-6.43-4.67-4.55 6.45-.94L12 2.8z" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 20.25L10.585 18.96C5.56 14.404 2.25 11.398 2.25 7.688C2.25 4.682 4.607 2.25 7.594 2.25C9.282 2.25 10.902 3.031 12 4.264C13.098 3.031 14.718 2.25 16.406 2.25C19.393 2.25 21.75 4.682 21.75 7.688C21.75 11.398 18.44 14.404 13.415 18.96L12 20.25Z" fill="currentColor"/></svg>',
  square: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg>',
};

export function getDefaultPackedIcon() {
  return {
    value: 'default:star',
    label: 'Star',
    markup: sanitizeSvgMarkup(FALLBACK_ICON_MARKUPS.star),
  };
}

export function getIconPackId(iconName) {
  if (typeof iconName !== 'string' || !iconName.includes(':')) return null;
  const [packId] = iconName.split(':');
  return packId || null;
}

export function isMaterialIconValue(iconName) {
  return getIconPackId(iconName) === 'material';
}

export function getIconPresetMarkup(name) {
  const normalized = typeof name === 'string' ? name.split(':').pop()?.toLowerCase() || '' : '';
  return sanitizeSvgMarkup(FALLBACK_ICON_MARKUPS[normalized] || FALLBACK_ICON_MARKUPS.star);
}

export function extractSvgMarkup(input) {
  if (typeof input !== 'string') return '';
  const match = input.match(/<svg[\s\S]*?<\/svg>/i);
  return match ? match[0] : '';
}

export function getSvgStrokeWidth(markup) {
  if (typeof markup !== 'string' || !markup.trim()) return null;
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

    const nodes = [root, ...Array.from(root.querySelectorAll('[stroke-width]'))];
    for (const node of nodes) {
      const value = node.getAttribute('stroke-width');
      const parsed = value == null ? NaN : parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export function hasSvgVisibleStroke(markup) {
  if (typeof markup !== 'string' || !markup.trim()) return false;
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return false;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return false;

    const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
    return nodes.some((node) => {
      const stroke = `${node.getAttribute('stroke') ?? ''}`.trim().toLowerCase();
      if (!stroke || stroke === 'none') return false;
      const rawStrokeWidth = node.getAttribute('stroke-width') ?? root.getAttribute('stroke-width') ?? '';
      const parsedStrokeWidth = rawStrokeWidth === '' ? 1 : parseFloat(rawStrokeWidth);
      return !Number.isNaN(parsedStrokeWidth) && parsedStrokeWidth > 0;
    });
  } catch (error) {
    return false;
  }
}

export function setSvgStrokeWidth(markup, strokeWidth) {
  if (typeof markup !== 'string' || !markup.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return markup.trim();

  const parsedWidth = typeof strokeWidth === 'number' ? strokeWidth : parseFloat(strokeWidth);
  if (!Number.isFinite(parsedWidth) || parsedWidth <= 0) return sanitizeSvgMarkup(markup);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return sanitizeSvgMarkup(markup);

    root.setAttribute('stroke-width', `${parsedWidth}`);
    Array.from(root.querySelectorAll('*')).forEach((node) => {
      const stroke = node.getAttribute('stroke');
      const hasStrokeWidth = node.hasAttribute('stroke-width');
      if (hasStrokeWidth || (stroke && `${stroke}`.toLowerCase() !== 'none')) {
        node.setAttribute('stroke-width', `${parsedWidth}`);
      }
    });

    return sanitizeSvgMarkup(root.outerHTML, { forceCurrentColor: false });
  } catch (error) {
    return sanitizeSvgMarkup(markup);
  }
}

export function applySvgStroke(markup, { strokeWidth = 0, strokeColor = 'currentColor' } = {}) {
  if (typeof markup !== 'string' || !markup.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return sanitizeSvgMarkup(markup, { forceCurrentColor: false });
  }

  const parsedWidth = typeof strokeWidth === 'number' ? strokeWidth : parseFloat(strokeWidth);
  const normalizedColor = typeof strokeColor === 'string' && strokeColor.trim() ? strokeColor.trim() : 'currentColor';
  if (!Number.isFinite(parsedWidth) || parsedWidth <= 0) {
    return sanitizeSvgMarkup(markup, { forceCurrentColor: false });
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return sanitizeSvgMarkup(markup, { forceCurrentColor: false });

    root.setAttribute('stroke', normalizedColor);
    root.setAttribute('stroke-width', `${parsedWidth}`);
    root.setAttribute('paint-order', 'stroke fill');

    Array.from(root.querySelectorAll('*')).forEach((node) => {
      if (!COLOR_SHAPE_TAGS.has(node.nodeName.toLowerCase())) return;
      node.setAttribute('stroke', normalizedColor);
      node.setAttribute('stroke-width', `${parsedWidth}`);
      node.setAttribute('paint-order', 'stroke fill');
    });

    return sanitizeSvgMarkup(root.outerHTML, { forceCurrentColor: false });
  } catch (error) {
    return sanitizeSvgMarkup(markup, { forceCurrentColor: false });
  }
}

export function removeSvgStroke(markup) {
  if (typeof markup !== 'string' || !markup.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return sanitizeSvgMarkup(markup, { forceCurrentColor: false });

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return sanitizeSvgMarkup(markup, { forceCurrentColor: false });

    root.setAttribute('stroke-width', '0');
    root.setAttribute('stroke', 'none');
    Array.from(root.querySelectorAll('*')).forEach((node) => {
      node.setAttribute('stroke-width', '0');
      if (node.hasAttribute('stroke') || node.nodeName.toLowerCase() !== 'g') {
        node.setAttribute('stroke', 'none');
      }
    });

    return sanitizeSvgMarkup(root.outerHTML, { forceCurrentColor: false });
  } catch (error) {
    return sanitizeSvgMarkup(markup, { forceCurrentColor: false });
  }
}

function parseStyleAttribute(styleValue) {
  return `${styleValue || ''}`
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, declaration) => {
      const [rawKey, rawValue] = declaration.split(':');
      if (!rawKey || rawValue == null) return acc;
      acc[rawKey.trim().toLowerCase()] = rawValue.trim();
      return acc;
    }, {});
}

function shouldPromoteToCurrentColor(value) {
  if (!value) return false;
  const normalized = `${value}`.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'none' || normalized === 'currentcolor') return false;
  if (normalized.startsWith('url(')) return false;
  return true;
}

function sanitizeNodeAttributes(node, { forceCurrentColor = true } = {}) {
  Array.from(node.attributes).forEach((attr) => {
    const attrName = attr.name.toLowerCase();
    const attrValue = attr.value ?? '';

    if (attrName === 'style') {
      const styleMap = parseStyleAttribute(attrValue);
      Object.entries(styleMap).forEach(([styleKey, styleValue]) => {
        if (ICON_SVG_ATTRIBUTES.includes(styleKey)) node.setAttribute(styleKey, styleValue);
      });
      node.removeAttribute(attr.name);
      return;
    }

    if (attrName.startsWith('on')) {
      node.removeAttribute(attr.name);
      return;
    }

    if (!ICON_SVG_ATTRIBUTES.includes(attrName)) {
      node.removeAttribute(attr.name);
      return;
    }

    if ((attrName === 'href' || attrName === 'xlink:href') && /^\s*javascript:/i.test(attrValue)) {
      node.removeAttribute(attr.name);
    }
  });

  if (forceCurrentColor && COLOR_SHAPE_TAGS.has(node.nodeName.toLowerCase())) {
    const fill = node.getAttribute('fill');
    const stroke = node.getAttribute('stroke');
    if (shouldPromoteToCurrentColor(fill)) node.setAttribute('fill', 'currentColor');
    if (shouldPromoteToCurrentColor(stroke)) node.setAttribute('stroke', 'currentColor');
  }
}

export function sanitizeSvgMarkup(markup, options = {}) {
  if (typeof markup !== 'string' || !markup.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return markup.trim();

  const { forceCurrentColor = true } = options;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return '';

    const sanitizeNode = (node) => {
      Array.from(node.children).forEach((child) => {
        const tagName = child.nodeName.toLowerCase();
        if (!ALLOWED_SVG_TAGS.has(tagName)) {
          child.remove();
          return;
        }
        sanitizeNodeAttributes(child, { forceCurrentColor });
        sanitizeNode(child);
      });
    };

    sanitizeNodeAttributes(root, { forceCurrentColor: false });
    sanitizeNode(root);

    if (!root.getAttribute('viewBox')) {
      const width = parseFloat(root.getAttribute('width') || '24');
      const height = parseFloat(root.getAttribute('height') || '24');
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        root.setAttribute('viewBox', `0 0 ${width} ${height}`);
      } else {
        root.setAttribute('viewBox', '0 0 24 24');
      }
    }

    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('width', '100%');
    root.setAttribute('height', '100%');
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    root.setAttribute('overflow', 'visible');
    return root.outerHTML;
  } catch (error) {
    return '';
  }
}
