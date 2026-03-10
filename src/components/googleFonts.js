const GOOGLE_FONTS_METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const DEFAULT_PREVIEW_TEXT = 'Hamburgefontsiv 123';
const DEFAULT_FAMILIES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Source Sans 3',
  'Merriweather',
  'Playfair Display',
  'Work Sans',
  'Raleway',
  'Oswald',
  'Rubik',
  'DM Sans',
  'Manrope',
  'Figtree',
  'Bebas Neue',
  'Space Grotesk',
  'Plus Jakarta Sans',
  'Cabin',
  'Noto Sans',
  'Noto Serif',
  'Archivo',
  'Barlow',
  'Inconsolata',
  'IBM Plex Sans',
  'Crimson Pro',
  'Cormorant Garamond',
  'Libre Baskerville',
];

let cachedFamilies = DEFAULT_FAMILIES;
let catalogPromise = null;
const loadedRequests = new Set();

function familyToQuery(family) {
  return encodeURIComponent(String(family || '').trim()).replace(/%20/g, '+');
}

function buildFamilyRequest(family, options = {}) {
  const queryFamily = familyToQuery(family);
  const weight = Math.max(100, Math.min(900, Math.round(Number(options.weight) || 400)));
  const isItalic = options.style === 'italic';
  if (isItalic) return `${queryFamily}:ital,wght@1,${weight}`;
  return `${queryFamily}:wght@${weight}`;
}

function normalizeMetadataPayload(rawText) {
  const sanitized = rawText.replace(/^\)\]\}'\s*/, '');
  return JSON.parse(sanitized);
}

function extractFamilies(payload) {
  if (Array.isArray(payload?.familyMetadataList)) {
    return payload.familyMetadataList
      .map((item) => item?.family)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }
  if (payload?.familyMetadataList && typeof payload.familyMetadataList === 'object') {
    return Object.keys(payload.familyMetadataList).sort((a, b) => a.localeCompare(b));
  }
  if (Array.isArray(payload?.families)) {
    return payload.families.filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  return DEFAULT_FAMILIES;
}

export function getGoogleFontsCatalog() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = fetch(GOOGLE_FONTS_METADATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error('Failed to load Google Fonts metadata');
      return response.text();
    })
    .then((rawText) => {
      cachedFamilies = extractFamilies(normalizeMetadataPayload(rawText));
      return cachedFamilies;
    })
    .catch(() => cachedFamilies);
  return catalogPromise;
}

export function getCachedGoogleFontsCatalog() {
  return cachedFamilies;
}

export function ensureGoogleFontLoaded(family, options = {}) {
  const trimmedFamily = String(family || '').trim();
  if (!trimmedFamily) return;
  const text = encodeURIComponent(options.text || DEFAULT_PREVIEW_TEXT);
  const weight = Math.max(100, Math.min(900, Math.round(Number(options.weight) || 400)));
  const style = options.style === 'italic' ? 'italic' : 'normal';
  const requestKey = `${trimmedFamily}::${style}::${weight}::${text}`;
  if (loadedRequests.has(requestKey)) return;
  loadedRequests.add(requestKey);

  const familyRequest = buildFamilyRequest(trimmedFamily, { weight, style });
  const href = `https://fonts.googleapis.com/css2?family=${familyRequest}&display=swap&text=${text}`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.fbFont = requestKey;
  document.head.appendChild(link);
}

export function familyToFontStack(family) {
  const trimmedFamily = String(family || '').trim();
  if (!trimmedFamily) return 'Inter, sans-serif';
  return `'${trimmedFamily}', sans-serif`;
}
