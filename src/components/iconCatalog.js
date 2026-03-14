const iconPackCache = new Map();
const iconPreviewCache = new Map();

function getPreviewBucket(packId) {
  if (!iconPreviewCache.has(packId)) iconPreviewCache.set(packId, new Map());
  return iconPreviewCache.get(packId);
}

export const ICON_PACK_MANIFEST = [
  {
    id: 'material',
    label: 'Material',
    license: 'Apache 2.0',
    description: 'Google\'s broad system icon set with dense coverage for products, UI, and actions.',
    accent: 'linear-gradient(135deg, rgba(86,153,255,0.38), rgba(30,96,255,0.08))',
  },
  {
    id: 'iconoir',
    label: 'Iconoir',
    license: 'MIT',
    description: 'A crisp editorial set with elegant strokes and a large surface for interface and brand work.',
    accent: 'linear-gradient(135deg, rgba(255,162,89,0.34), rgba(255,103,68,0.08))',
  },
  {
    id: 'lucide',
    label: 'Lucide',
    license: 'ISC',
    description: 'A flexible general-purpose outline set that stays readable at many sizes.',
    accent: 'linear-gradient(135deg, rgba(74,214,161,0.34), rgba(34,139,104,0.08))',
  },
];

function resolvePackImporter(packId) {
  switch (packId) {
    case 'material':
      return () => import('./iconPacks/materialPack');
    case 'iconoir':
      return () => import('./iconPacks/iconoirPack');
    case 'lucide':
      return () => import('./iconPacks/lucidePack');
    default:
      return null;
  }
}

export async function loadIconPack(packId) {
  if (!packId) return null;
  if (iconPackCache.has(packId)) return iconPackCache.get(packId);

  const importer = resolvePackImporter(packId);
  if (!importer) throw new Error('Unknown icon pack requested.');

  const module = await importer();
  const pack = module.default || module.pack || null;
  if (!pack) throw new Error('Icon pack failed to load.');

  iconPackCache.set(packId, pack);
  return pack;
}

export function getCachedIconPreviewMarkup(packId, iconValue) {
  if (!packId || !iconValue) return '';
  return getPreviewBucket(packId).get(iconValue) || '';
}

export function setCachedIconPreviewMarkup(packId, iconValue, markup) {
  if (!packId || !iconValue || !markup) return markup || '';
  getPreviewBucket(packId).set(iconValue, markup);
  return markup;
}

export async function warmIconPackPreviewCache(packId, limit = 64) {
  const pack = await loadIconPack(packId);
  if (!pack) return null;

  const previewBucket = getPreviewBucket(pack.id);
  pack.icons.slice(0, limit).forEach((icon) => {
    if (previewBucket.has(icon.value)) return;
    const markup = pack.getIconMarkup(icon.Component) || '';
    if (markup) previewBucket.set(icon.value, markup);
  });

  return pack;
}

export function getManifestPack(packId) {
  return ICON_PACK_MANIFEST.find((pack) => pack.id === packId) ?? ICON_PACK_MANIFEST[0] ?? null;
}

export function filterPackIcons(pack, searchTerm = '', limit = 320) {
  const normalized = `${searchTerm || ''}`.trim().toLowerCase();
  const icons = pack?.icons ?? [];
  if (!normalized) return icons.slice(0, limit);
  return icons
    .filter((icon) => icon.label.toLowerCase().includes(normalized) || icon.name.toLowerCase().includes(normalized))
    .slice(0, limit);
}