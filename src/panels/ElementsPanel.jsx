import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { getIconPresetMarkup } from '../components/iconLibrary';

export const ELEMENT_TYPES = [
  {
    type: 'frame',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="1.5"/>
      </svg>
    ),
    label: 'Frame',
  },
  {
    type: 'image',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="2" width="14" height="12" rx="1.5"/>
        <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
        <path d="M1 12l4-3.5 3 2.5 2.5-2 4.5 4"/>
      </svg>
    ),
    label: 'Image',
  },
  {
    type: 'video',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2" width="13" height="12" rx="1.5"/>
        <path d="M6 5.5v5l4-2.5-4-2.5z" fill="currentColor" stroke="none"/>
      </svg>
    ),
    label: 'Video',
  },
  {
    type: 'scroll-sequence',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2" width="13" height="11" rx="1.8"/>
        <path d="M4 5.5h5" />
        <path d="M4 8h8" />
        <path d="M4 10.5h4" />
        <path d="M11.5 4.75v5.5" />
        <path d="M10 6.25l1.5-1.5 1.5 1.5" />
        <path d="M10 8.75l1.5 1.5 1.5-1.5" />
      </svg>
    ),
    label: 'Scroll Sequence',
  },
  {
    type: 'text',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3h10" />
        <path d="M8 3v10" />
        <path d="M5.5 13h5" />
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

export function ElementPickerGrid({ onItemChosen = null, onItemDragStart = null, compact = false }) {
  const pendingDraw = useEditorStore(s => s.pendingDraw);
  const setPendingDraw = useEditorStore(s => s.setPendingDraw);

  const handleDragStart = (e, type) => {
    setPendingDraw(null);
    e.dataTransfer.setData('fb-element-type', type);
    onItemDragStart?.(type);
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
