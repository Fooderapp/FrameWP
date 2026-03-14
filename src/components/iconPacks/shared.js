import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sanitizeSvgMarkup } from '../iconLibrary';

export function prettifyIconName(name, prefixes = []) {
  const stripped = prefixes.reduce((acc, prefix) => acc.replace(new RegExp(`^${prefix}`), ''), name);
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

export function moduleToIconList(moduleMap, { packId, prefixes = [], excludes = new Set(), filter }) {
  return Object.entries(moduleMap)
    .filter(([name, Component]) => {
      const isRenderableComponent = typeof Component === 'function'
        || (typeof Component === 'object' && Component !== null && ('$$typeof' in Component || 'render' in Component));
      return isRenderableComponent && !excludes.has(name) && filter(name);
    })
    .map(([name, Component]) => ({
      value: `${packId}:${name}`,
      name,
      label: prettifyIconName(name, prefixes),
      Component,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getPackRenderProps(packId, size = 24) {
  if (packId === 'material') return { size, color: 'currentColor' };
  if (packId === 'iconoir') return { width: size, height: size, color: 'currentColor', strokeWidth: 1.8 };
  return { size, color: 'currentColor', strokeWidth: 2 };
}

export function getLibraryIconMarkup(Component, packId) {
  const isRenderableComponent = typeof Component === 'function'
    || (typeof Component === 'object' && Component !== null && ('$$typeof' in Component || 'render' in Component));
  if (!isRenderableComponent) return '';
  return sanitizeSvgMarkup(renderToStaticMarkup(createElement(Component, getPackRenderProps(packId, 24))));
}