function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED_TAGS = new Set(['br', 'strong', 'b', 'em', 'i', 'u', 'span']);
const ALLOWED_STYLE_KEYS = new Set(['font-weight', 'font-style', 'text-decoration', 'font-size', 'color', 'font-family']);
const BLOCK_TO_BREAK_TAGS = new Set(['div', 'p']);

function sanitizeStyleValue(styleKey, styleValue) {
  const normalizedValue = `${styleValue ?? ''}`.trim();
  if (!normalizedValue) return '';

  if (styleKey === 'font-weight') {
    if (/^(normal|bold|bolder|lighter|[1-9]00)$/i.test(normalizedValue)) return normalizedValue;
    return '';
  }

  if (styleKey === 'font-style') {
    if (/^(normal|italic|oblique)$/i.test(normalizedValue)) return normalizedValue;
    return '';
  }

  if (styleKey === 'text-decoration') {
    const decorations = normalizedValue
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => ['underline', 'line-through', 'none'].includes(token));
    return decorations.length ? decorations.join(' ') : '';
  }

  if (styleKey === 'font-size') {
    const parsed = parseFloat(normalizedValue);
    if (!Number.isFinite(parsed)) return '';
    const unit = normalizedValue.replace(`${parsed}`, '').trim().toLowerCase();
    if (unit && unit !== 'px') return '';
    const clamped = Math.max(8, Math.min(144, parsed));
    return `${Math.round(clamped * 10) / 10}px`;
  }

  if (styleKey === 'color') {
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(normalizedValue)) return normalizedValue;
    if (/^rgba?\(([^)]+)\)$/i.test(normalizedValue)) return normalizedValue;
    if (/^hsla?\(([^)]+)\)$/i.test(normalizedValue)) return normalizedValue;
    if (/^[a-z]+$/i.test(normalizedValue)) return normalizedValue;
  }

  if (styleKey === 'font-family') {
    const families = normalizedValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/^['\"]+|['\"]+$/g, ''))
      .filter((entry) => /^[a-z0-9\s-]+$/i.test(entry));
    if (!families.length) return '';
    return families
      .map((entry) => (/^[a-z-]+$/i.test(entry) ? entry : `'${entry}'`))
      .join(', ');
  }

  return '';
}

function sanitizeStyleAttribute(styleValue) {
  return `${styleValue || ''}`
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawKey, rawValue] = entry.split(':');
      const styleKey = `${rawKey || ''}`.trim().toLowerCase();
      if (!ALLOWED_STYLE_KEYS.has(styleKey) || rawValue == null) return null;
      const nextValue = sanitizeStyleValue(styleKey, rawValue);
      return nextValue ? `${styleKey}:${nextValue}` : null;
    })
    .filter(Boolean)
    .join('; ');
}

function withSanitizedRichTextDocument(html, callback, fallbackValue) {
  const sanitizedHtml = sanitizeRichTextHtml(html);
  if (!sanitizedHtml) return fallbackValue;
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return fallbackValue;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${sanitizedHtml}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return fallbackValue;
    return callback(root, doc, sanitizedHtml);
  } catch {
    return fallbackValue;
  }
}

function sanitizeRichTextNode(node, documentRef) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      return;
    }

    const tagName = child.nodeName.toLowerCase();
    if (BLOCK_TO_BREAK_TAGS.has(tagName)) {
      sanitizeRichTextNode(child, documentRef);
      const fragment = documentRef.createDocumentFragment();
      while (child.firstChild) fragment.appendChild(child.firstChild);
      if (fragment.lastChild?.nodeName?.toLowerCase() !== 'br') fragment.appendChild(documentRef.createElement('br'));
      child.replaceWith(fragment);
      return;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      sanitizeRichTextNode(child, documentRef);
      const fragment = documentRef.createDocumentFragment();
      while (child.firstChild) fragment.appendChild(child.firstChild);
      child.replaceWith(fragment);
      return;
    }

    Array.from(child.attributes).forEach((attribute) => {
      const attrName = attribute.name.toLowerCase();
      if (attrName !== 'style') {
        child.removeAttribute(attribute.name);
        return;
      }
      const sanitizedStyle = sanitizeStyleAttribute(attribute.value);
      if (sanitizedStyle) child.setAttribute('style', sanitizedStyle);
      else child.removeAttribute('style');
    });

    sanitizeRichTextNode(child, documentRef);
  });
}

export function plainTextToRichTextHtml(text) {
  return escapeHtml(`${text ?? ''}`).replace(/\n/g, '<br>');
}

export function richTextHtmlToPlainText(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/div>|<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const chunks = [];
  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tagName = node.nodeName.toLowerCase();
    if (tagName === 'br') {
      chunks.push('\n');
      return;
    }
    Array.from(node.childNodes).forEach(visit);
    if (BLOCK_TO_BREAK_TAGS.has(tagName)) chunks.push('\n');
  };

  Array.from(root.childNodes).forEach(visit);
  return chunks.join('').replace(/\u00a0/g, ' ');
}

export function sanitizeRichTextHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html.trim();

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';
    sanitizeRichTextNode(root, doc);
    const nextHtml = root.innerHTML.replace(/(?:<br>\s*)+$/i, '').trim();
    if (!nextHtml) return '';
    return nextHtml.replace(/<strong><\/strong>|<em><\/em>|<u><\/u>|<span[^>]*><\/span>/gi, '').trim();
  } catch {
    return '';
  }
}

export function getResolvedRichTextHtml(resolved, fallbackText = 'Text') {
  const sanitized = sanitizeRichTextHtml(resolved?.richTextHtml ?? '');
  if (sanitized) return sanitized;
  return plainTextToRichTextHtml(typeof resolved?.text === 'string' ? resolved.text : fallbackText);
}

export function getRichTextInlineStyleValues(html, styleKey) {
  const normalizedStyleKey = `${styleKey ?? ''}`.trim().toLowerCase();
  if (!ALLOWED_STYLE_KEYS.has(normalizedStyleKey)) return [];

  return withSanitizedRichTextDocument(html, (root) => {
    const values = new Set();
    root.querySelectorAll('*').forEach((node) => {
      const rawValue = node.style?.getPropertyValue(normalizedStyleKey) ?? '';
      const sanitizedValue = sanitizeStyleValue(normalizedStyleKey, rawValue);
      if (sanitizedValue) values.add(sanitizedValue);
    });
    return Array.from(values);
  }, []);
}

export function clearRichTextInlineStyle(html, styleKey) {
  const normalizedStyleKey = `${styleKey ?? ''}`.trim().toLowerCase();
  if (!ALLOWED_STYLE_KEYS.has(normalizedStyleKey)) return sanitizeRichTextHtml(html);

  return withSanitizedRichTextDocument(html, (root) => {
    root.querySelectorAll('*').forEach((node) => {
      if (!node.style) return;
      node.style.removeProperty(normalizedStyleKey);
      if (!node.getAttribute('style')?.trim()) node.removeAttribute('style');
    });
    return sanitizeRichTextHtml(root.innerHTML);
  }, sanitizeRichTextHtml(html));
}