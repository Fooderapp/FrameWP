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
const loadedFamilies = new Set();
const loadedRequests = new Set();
const GOOGLE_FONTS_CATALOG_URL = 'https://cdn.jsdelivr.net/npm/google-fonts-complete@latest/google-fonts.json';

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
  if (cachedFamilies.length > DEFAULT_FAMILIES.length) return Promise.resolve(cachedFamilies);
  if (!catalogPromise) {
    catalogPromise = fetch(GOOGLE_FONTS_CATALOG_URL, { credentials: 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error('Could not fetch Google Fonts catalog');
        return response.json();
      })
      .then((catalog) => {
        const families = Object.keys(catalog ?? {}).filter(Boolean).sort((left, right) => left.localeCompare(right));
        if (families.length) cachedFamilies = families;
        return cachedFamilies;
      })
      .catch(() => cachedFamilies)
      .finally(() => {
        catalogPromise = null;
      });
  }
  return catalogPromise;
}

export function getCachedGoogleFontsCatalog() {
  return cachedFamilies;
}

export function ensureGoogleFontLoaded(family, options = {}) {
  const trimmedFamily = String(family || '').trim();
  if (!trimmedFamily) return;

  if (!loadedFamilies.has(trimmedFamily)) {
    loadedFamilies.add(trimmedFamily);
    const baseLink = document.createElement('link');
    baseLink.rel = 'stylesheet';
    baseLink.href = `https://fonts.googleapis.com/css2?family=${familyToQuery(trimmedFamily)}&display=swap`;
    baseLink.dataset.fbFontFamily = trimmedFamily;
    document.head.appendChild(baseLink);
  }

  const weight = Math.max(100, Math.min(900, Math.round(Number(options.weight) || 400)));
  const style = options.style === 'italic' ? 'italic' : 'normal';
  if (weight === 400 && style === 'normal') return;
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
