import * as IconoirIcons from 'iconoir-react';
import { getLibraryIconMarkup, moduleToIconList } from './shared';

const ICONOIR_EXCLUDES = new Set(['Iconoir', 'IconoirProvider', 'iconoir']);

const icons = moduleToIconList(IconoirIcons, {
  packId: 'iconoir',
  excludes: ICONOIR_EXCLUDES,
  filter: (name) => /^[A-Z]/.test(name),
});

const pack = {
  id: 'iconoir',
  label: 'Iconoir',
  license: 'MIT',
  description: 'A crisp editorial set with elegant strokes and a large surface for interface and brand work.',
  icons,
  getIconMarkup: (Component) => getLibraryIconMarkup(Component, 'iconoir'),
};

export default pack;