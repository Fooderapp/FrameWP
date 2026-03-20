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

export function getGoogleFontsCatalog() {
  return Promise.resolve(cachedFamilies);
}

export function getCachedGoogleFontsCatalog() {
  return cachedFamilies;
}

export function ensureGoogleFontLoaded(family, options = {}) {
  const trimmedFamily = String(family || '').trim();
  if (!trimmedFamily) return;
  const weight = Math.max(100, Math.min(900, Math.round(Number(options.weight) || 400)));
  const style = options.style === 'italic' ? 'italic' : 'normal';
  const requestKey = `${trimmedFamily}::${style}::${weight}`;
  if (loadedRequests.has(requestKey)) return;
  loadedRequests.add(requestKey);

  const familyRequest = buildFamilyRequest(trimmedFamily, { weight, style });
  const href = `https://fonts.googleapis.com/css2?family=${familyRequest}&display=swap`;
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
