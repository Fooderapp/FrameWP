import * as LucideIcons from 'lucide-react';
import { getLibraryIconMarkup, moduleToIconList } from './shared';

const LUCIDE_EXCLUDES = new Set(['Icon', 'createLucideIcon', 'icons', 'LucideProps', 'toKebabCase']);

const icons = moduleToIconList(LucideIcons, {
  packId: 'lucide',
  excludes: LUCIDE_EXCLUDES,
  filter: (name) => /^[A-Z]/.test(name),
});

const pack = {
  id: 'lucide',
  label: 'Lucide',
  license: 'ISC',
  description: 'A flexible general-purpose outline set that stays readable at many sizes.',
  icons,
  getIconMarkup: (Component) => getLibraryIconMarkup(Component, 'lucide'),
};

export default pack;