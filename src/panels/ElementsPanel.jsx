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
  },
  {
    type: 'image',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M2.5 2h11A1.5 1.5 0 0 1 15 3.5v9A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2Zm.3 10h10.4L10 8.5 8 10.6 5.6 8.2 2.8 12ZM5.5 5a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 5.5 5Z"/>
      </svg>
    ),
    label: 'Image',
  },
  {
    type: 'video',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M3 2h9.5A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5v-9A1.5 1.5 0 0 1 3 2Zm3 2.7v6.6L11.2 8 6 4.7Z"/>
      </svg>
    ),
    label: 'Video',
  },
  {
    type: 'scroll-sequence',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M3 2h10a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 13 13H3A1.5 1.5 0 0 1 1.5 11.5v-8A1.5 1.5 0 0 1 3 2Zm2 3h4v1H5V5Zm0 2.5h5.5v1H5v-1Zm0 2.5h3v1H5v-1Zm7-4.5-.9.9-.9-.9-.7.7L11.25 8l1.65-1.8-.7-.7Zm0 5 .9-.9.7.7L11.25 12l-1.65-1.8.7-.7.9.9.8-.9.7.7-.8.9Z"/>
      </svg>
    ),
    label: 'Scroll Sequence',
  },
  {
    type: 'text',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M3 3h10v2H9v7h2.5v1.5h-7V12H7V5H3V3Z" />
      </svg>
    ),
    label: 'Text',
  },
  {
    type: 'icon',
    icon: (
      <div style={{ width: 22, height: 22, display: 'grid', placeItems: 'center' }} dangerouslySetInnerHTML={{ __html: getIconPresetMarkup('star') }} />
    ),
    label: 'Icon / SVG',
  },
];

export function ElementPickerGrid({ onItemChosen = null, onItemDragStart = null, onItemDragEnd = null, compact = false }) {
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
    <div className={`fb-elements-grid${compact ? ' fb-elements-grid--compact' : ''}`}>
      {ELEMENT_TYPES.map(({ type, icon, label }) => (
        <div
          key={type}
          className={`fb-element-card${pendingDraw === type ? ' fb-element-card--active' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, type)}
          onDragEnd={() => onItemDragEnd?.(type)}
          onClick={() => handleClick(type)}
          title={pendingDraw === type ? `Click on canvas to draw ${label} — Esc to cancel` : `Click to draw ${label}, or drag to place`}
        >
          <div className="fb-element-card__icon">{icon}</div>
          <div className="fb-element-card__label">{label}</div>
        </div>
      ))}
    </div>
  );
}

export default function ElementsPanel() {
  return (
    <div>
      <div className="fb-section-label">Layout</div>
      <ElementPickerGrid />

      <div className="fb-section-label" style={{ marginTop: 8 }}>How to use</div>
      <div style={{ padding: '4px 12px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        • <strong style={{ color: 'var(--text-secondary)' }}>Click</strong> to enter draw mode, then draw on canvas<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Drag</strong> onto any artboard to place at default size<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Esc</strong> to cancel draw mode<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Ctrl+scroll</strong> to zoom<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Space+drag</strong> to pan<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Del</strong> to remove selected
      </div>
    </div>
  );
}
