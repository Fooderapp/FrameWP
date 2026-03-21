const ALLOWED_EMBED_MODES = new Set(['html', 'shortcode', 'php', 'react']);

const EMBED_ALLOWED_TAGS = new Set([
  'a', 'article', 'aside', 'audio', 'b', 'blockquote', 'br', 'button', 'canvas', 'caption', 'code', 'col', 'colgroup',
  'dd', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'iframe', 'img', 'input', 'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'picture', 'pre',
  'section', 'select', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'textarea',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'video'
]);

const EMBED_GLOBAL_ATTRIBUTES = new Set([
  'class', 'id', 'title', 'style', 'role', 'dir', 'lang', 'width', 'height'
]);

const EMBED_TAG_ATTRIBUTES = {
  a: new Set(['href', 'target', 'rel']),
  audio: new Set(['src', 'controls', 'autoplay', 'loop', 'muted', 'preload']),
  button: new Set(['type', 'name', 'value']),
  form: new Set(['action', 'method', 'target']),
  iframe: new Set(['src', 'srcdoc', 'loading', 'allow', 'allowfullscreen', 'referrerpolicy', 'sandbox', 'frameborder', 'name']),
  img: new Set(['src', 'alt', 'loading', 'decoding', 'srcset', 'sizes']),
  input: new Set(['type', 'name', 'value', 'placeholder', 'checked', 'disabled', 'readonly', 'min', 'max', 'step']),
  option: new Set(['value', 'selected']),
  select: new Set(['name', 'multiple', 'disabled']),
  source: new Set(['src', 'srcset', 'type', 'media']),
  td: new Set(['colspan', 'rowspan']),
  textarea: new Set(['name', 'placeholder', 'rows', 'cols', 'readonly', 'disabled']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  video: new Set(['src', 'controls', 'autoplay', 'loop', 'muted', 'playsinline', 'poster', 'preload'])
};

function isSafeEmbedUrl(value) {
  const rawValue = `${value ?? ''}`.trim();
  if (!rawValue) return false;
  if (rawValue.startsWith('#') || rawValue.startsWith('/') || rawValue.startsWith('./') || rawValue.startsWith('../')) return true;
  if (/^data:image\//i.test(rawValue)) return true;
  if (/^(https?:|mailto:|tel:|about:blank)/i.test(rawValue)) return true;
  return false;
}

function sanitizeEmbedStyle(value) {
  const styleValue = `${value ?? ''}`.trim();
  if (!styleValue) return '';
  if (/expression\s*\(|javascript\s*:|behavior\s*:/i.test(styleValue)) return '';
  return styleValue;
}

function sanitizeEmbedNode(node, document) {
  if (!node) return;
  const children = Array.from(node.childNodes ?? []);
  children.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) return;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.parentNode?.removeChild(child);
      return;
    }

    const tagName = child.tagName.toLowerCase();
    if (!EMBED_ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      while (child.firstChild) fragment.appendChild(child.firstChild);
      child.replaceWith(fragment);
      sanitizeEmbedNode(node, document);
      return;
    }

    Array.from(child.attributes).forEach((attribute) => {
      const attributeName = attribute.name.toLowerCase();
      const attributeValue = attribute.value;
      const tagAttributes = EMBED_TAG_ATTRIBUTES[tagName] ?? new Set();
      const isGlobal = EMBED_GLOBAL_ATTRIBUTES.has(attributeName) || attributeName.startsWith('data-') || attributeName.startsWith('aria-');
      if (!isGlobal && !tagAttributes.has(attributeName)) {
        child.removeAttribute(attribute.name);
        return;
      }
      if (attributeName.startsWith('on')) {
        child.removeAttribute(attribute.name);
        return;
      }
      if (attributeName === 'style') {
        const safeStyle = sanitizeEmbedStyle(attributeValue);
        if (safeStyle) child.setAttribute('style', safeStyle);
        else child.removeAttribute(attribute.name);
        return;
      }
      if (['href', 'src', 'srcdoc', 'action'].includes(attributeName) && !isSafeEmbedUrl(attributeValue)) {
        child.removeAttribute(attribute.name);
        return;
      }
      if (attributeName === 'target') {
        const safeTarget = ['_blank', '_self', '_parent', '_top'].includes(attributeValue) ? attributeValue : '_blank';
        child.setAttribute('target', safeTarget);
        if (tagName === 'a') {
          const rel = child.getAttribute('rel') || '';
          const relParts = new Set(rel.split(/\s+/).filter(Boolean));
          relParts.add('noopener');
          relParts.add('noreferrer');
          child.setAttribute('rel', Array.from(relParts).join(' '));
        }
      }
    });

    sanitizeEmbedNode(child, document);
  });
}

export const EMBED_MODE_OPTIONS = [
  { value: 'html', label: 'HTML' },
  { value: 'shortcode', label: 'Shortcode' },
  { value: 'php', label: 'PHP' },
  { value: 'react', label: 'React' },
];

export function normalizeEmbedMode(value) {
  return ALLOWED_EMBED_MODES.has(value) ? value : 'html';
}

export function getEmbedCode(value) {
  return typeof value === 'string' ? value : '';
}

export function sanitizeEmbedHtml(markup) {
  const source = getEmbedCode(markup).trim();
  if (!source || typeof DOMParser === 'undefined') return source;
  const document = new DOMParser().parseFromString(source, 'text/html');
  sanitizeEmbedNode(document.body, document);
  const styleNodes = Array.from(document.querySelectorAll('style'));
  const safeStyles = styleNodes
    .map((node) => node.textContent || '')
    .filter(Boolean)
    .join('\n');
  styleNodes.forEach((node) => node.parentNode?.removeChild(node));
  const bodyHtml = document.body?.innerHTML?.trim() || '';
  if (!safeStyles) return bodyHtml;
  return `<style>${safeStyles}</style>${bodyHtml}`;
}

export function buildEmbedSrcDoc(markup) {
  const safeMarkup = sanitizeEmbedHtml(markup).trim();
  if (!safeMarkup) return '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0;min-height:100%;}*,*::before,*::after{box-sizing:border-box;}body{font-family:Arial,sans-serif;}</style></head><body>${safeMarkup}</body></html>`;
}

export function getEmbedPreview(resolved = {}) {
  const mode = normalizeEmbedMode(resolved?.embedMode);
  const code = getEmbedCode(resolved?.embedCode);
  const srcDoc = mode === 'html' ? buildEmbedSrcDoc(code) : '';
  return {
    mode,
    code,
    srcDoc,
    hasPreview: Boolean(srcDoc),
  };
}