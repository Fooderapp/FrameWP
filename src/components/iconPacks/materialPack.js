import * as MdIcons from 'react-icons/md';
import { getLibraryIconMarkup, moduleToIconList } from './shared';

const icons = moduleToIconList(MdIcons, {
  packId: 'material',
  prefixes: ['Md'],
  filter: (name) => /^Md[A-Z]/.test(name) && name !== 'Md10K',
});

const pack = {
  id: 'material',
  label: 'Material',
  license: 'Apache 2.0',
  description: 'Google\'s broad system icon set with dense coverage for products, UI, and actions.',
  icons,
  getIconMarkup: (Component) => getLibraryIconMarkup(Component, 'material'),
};

export default pack;