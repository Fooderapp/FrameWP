import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { getIconPresetMarkup } from '../components/iconLibrary';

export const ELEMENT_TYPES = [
  {
    type: 'frame',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <rect x="2" y="2" width="12" height="12" rx="1.5"/>
      </svg>
    ),
    label: 'Frame',
    hint: 'Container for layout and nesting',
    meta: 'Layout',
  },
  {
    type: 'image',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v9A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2Zm.3 10h10.4L10 8.5 8 10.6 5.6 8.2 2.8 12ZM5.5 5a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 5.5 5Z"/>
      </svg>
    ),
    label: 'Image',
    hint: 'Single image block with fills and fit',
    meta: 'Media',
  },
  {
    type: 'video',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M3 2h9.5A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5v-9A1.5 1.5 0 0 1 3 2Zm3 2.7v6.6L11.2 8 6 4.7Z"/>
      </svg>
    ),
    label: 'Video',
    hint: 'Embed clips with poster and playback',
    meta: 'Media',
  },
  {
    type: 'embed',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 4 2.5 8l3 4" />
        <path d="M10.5 4 13.5 8l-3 4" />
        <path d="M8.9 2.5 7 13.5" />
      </svg>
    ),
    label: 'Embed',
    hint: 'HTML snippets, WordPress shortcodes, and code handoff blocks',
    meta: 'Custom',
  },
  {
    type: 'scroll-sequence',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M3 2h10a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 13 13H3A1.5 1.5 0 0 1 1.5 11.5v-8A1.5 1.5 0 0 1 3 2Zm2 3h4v1H5V5Zm0 2.5h5.5v1H5v-1Zm0 2.5h3v1H5v-1Zm7-4.5-.9.9-.9-.9-.7.7L11.25 8l1.65-1.8-.7-.7Zm0 5 .9-.9.7.7L11.25 12l-1.65-1.8.7-.7.9.9.8-.9.7.7-.8.9Z"/>
      </svg>
    ),
    label: 'Scroll Sequence',
    hint: 'Frame-by-frame sequence on scroll',
    meta: 'Interactive',
  },
  {
    type: 'text',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M3 3h10v2H9v7h2.5v1.5h-7V12H7V5H3V3Z" />
      </svg>
    ),
    label: 'Text',
    hint: 'Rich text, typography, and inline styles',
    meta: 'Content',
  },
  {
    type: 'icon',
    icon: (
      <div style={{ width: 22, height: 22, display: 'grid', placeItems: 'center' }} dangerouslySetInnerHTML={{ __html: getIconPresetMarkup('star') }} />
    ),
    label: 'Icon / SVG',
    hint: 'Scalable icons and custom SVG marks',
    meta: 'Vector',
  },
];

export function ElementPickerGrid({ onItemChosen = null, onItemDragStart = null, onItemDragEnd = null, compact = false, toolbarPalette = false }) {
  const pendingDraw = useEditorStore(s => s.pendingDraw);
  const setPendingDraw = useEditorStore(s => s.setPendingDraw);

  const handleDragStart = (e, type) => {
    setPendingDraw(null);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('fb-element-type', type);
    onItemDragStart?.(e, type);
  };

  const handleClick = (type) => {
    const nextValue = pendingDraw === type ? null : type;
    setPendingDraw(nextValue);
    onItemChosen?.(nextValue, type);
  };

  return (
    <div className={`fb-elements-grid${compact ? ' fb-elements-grid--compact' : ''}${toolbarPalette ? ' fb-elements-grid--toolbar' : ''}`}>
      {ELEMENT_TYPES.map(({ type, icon, label, hint, meta }) => (
        <div
          key={type}
          className={`fb-element-card${pendingDraw === type ? ' fb-element-card--active' : ''}${toolbarPalette ? ' fb-element-card--toolbar' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, type)}
          onDragEnd={() => onItemDragEnd?.(type)}
          onClick={() => handleClick(type)}
          title={pendingDraw === type ? `Click on canvas to draw ${label} — Esc to cancel` : `Click to draw ${label}, or drag to place`}
        >
          <div className="fb-element-card__icon-wrap">
            <div className="fb-element-card__icon">{icon}</div>
            {toolbarPalette ? <span className="fb-element-card__meta">{meta}</span> : null}
          </div>
          <div className="fb-element-card__body">
            <div className="fb-element-card__label">{label}</div>
            {toolbarPalette ? <div className="fb-element-card__hint">{hint}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ElementsPanel() {
  return (
    <div>
      <div className="fb-section-label">Elements</div>
      <ElementPickerGrid />
    </div>
  );
}
