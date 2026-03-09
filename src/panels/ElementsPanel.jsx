import React from 'react';
import { useEditorStore, createFrame } from '../store/editorStore';

const ELEMENT_TYPES = [
  {
    type: 'frame',
    icon: (
      <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="1.5"/>
      </svg>
    ),
    label: 'Frame',
  },
];

export default function ElementsPanel() {
  const bpDefs    = useEditorStore(s => s.breakpointDefs);
  const addElement = useEditorStore(s => s.addElement);
  const pushHistory = useEditorStore(s => s.pushHistory);

  // Quick-add to first breakpoint (desktop) at centre
  const handleAdd = (type) => {
    const bp = bpDefs.desktop;
    let el;
    if (type === 'frame') {
      el = createFrame(bp.width / 2 - 120, bp.height / 2 - 80);
    }
    if (el) {
      addElement(el, null);
      pushHistory();
    }
  };

  const handleDragStart = (e, type) => {
    e.dataTransfer.setData('fb-element-type', type);
  };

  return (
    <div>
      <div className="fb-section-label">Layout</div>
      <div className="fb-elements-grid">
        {ELEMENT_TYPES.map(({ type, icon, label }) => (
          <div
            key={type}
            className="fb-element-card"
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => handleAdd(type)}
            title={`Add ${label}`}
          >
            <div className="fb-element-card__icon">{icon}</div>
            <div className="fb-element-card__label">{label}</div>
          </div>
        ))}
      </div>

      <div className="fb-section-label" style={{ marginTop: 8 }}>How to use</div>
      <div style={{ padding: '4px 12px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        • <strong style={{ color: 'var(--text-secondary)' }}>Click</strong> to add to Desktop artboard<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Drag</strong> onto any artboard<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Ctrl+scroll</strong> to zoom<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Scroll</strong> or <strong style={{ color: 'var(--text-secondary)' }}>Space+drag</strong> to pan<br />
        • <strong style={{ color: 'var(--text-secondary)' }}>Del</strong> to remove selected
      </div>
    </div>
  );
}
