import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { IconButton, UIIcons } from '../components/UIIcons';

export default function TopBar() {
  const viewport       = useEditorStore(s => s.viewport);
  const setViewport    = useEditorStore(s => s.setViewport);
  const saveLayout     = useEditorStore(s => s.saveLayout);
  const publishLayout  = useEditorStore(s => s.publishLayout);
  const saveStatus     = useEditorStore(s => s.saveStatus);
  const undo           = useEditorStore(s => s.undo);
  const redo           = useEditorStore(s => s.redo);
  const bpDefs         = useEditorStore(s => s.breakpointDefs);

  const pct = Math.round(viewport.scale * 100);

  const zoomTo = (targetScale) => {
    setViewport((vp) => ({
      ...vp,
      scale: Math.max(0.08, Math.min(8, targetScale)),
    }));
  };

  const zoomIn  = () => zoomTo(viewport.scale * 1.2);
  const zoomOut = () => zoomTo(viewport.scale / 1.2);
  const zoomFit = () => {
    const canvas = document.querySelector('.fb-canvas-container');
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    const bps = Object.values(bpDefs);
    const totalW = bps.reduce((sum, b, i) => sum + b.width + (i < bps.length - 1 ? 100 : 0), 0) + 200;
    const totalH = Math.max(...bps.map(b => b.height)) + 290;
    const scale  = Math.min((width - 60) / totalW, (height - 60) / totalH, 1);
    const worldW = totalW * scale;
    const worldH = totalH * scale;
    setViewport({ x: (width - worldW) / 2, y: (height - worldH) / 2 + 20, scale });
  };

  const statusLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'ok'       ? '✓ Saved'
    : saveStatus === 'error'    ? '✗ Error'
    : null;
  const statusClass = saveStatus === 'ok' ? 'fb-save-status--ok'
    : saveStatus === 'error' ? 'fb-save-status--err'
    : '';

  return (
    <header className="fb-topbar">
      {/* Branding */}
      <span className="fb-topbar__brand">⬡ FrameBuilder</span>

      <div className="fb-topbar__sep" />

      {/* Undo / Redo */}
      <IconButton icon={UIIcons.undo} title="Undo (⌘Z)" onClick={undo} />
      <IconButton icon={UIIcons.redo} title="Redo (⌘⇧Z)" onClick={redo} />

      <div className="fb-topbar__sep" />

      {/* Zoom controls (center) */}
      <div className="fb-topbar__center">
        <IconButton icon={UIIcons.zoomOut} onClick={zoomOut} title="Zoom out" />
        <div
          className="fb-zoom-display"
          title="Click to reset zoom"
          onClick={zoomFit}
          style={{ cursor: 'pointer' }}
        >
          {pct}%
        </div>
        <IconButton icon={UIIcons.zoomIn} onClick={zoomIn} title="Zoom in" />
        <IconButton icon={UIIcons.fit} onClick={zoomFit} title="Fit all artboards" className="fb-btn--sm" />
      </div>

      {/* Status + actions (right) */}
      <div className="fb-topbar__right">
        {statusLabel && (
          <span className={`fb-save-status ${statusClass}`}>{statusLabel}</span>
        )}
        <IconButton icon={UIIcons.save} title="Save layout" onClick={saveLayout} disabled={saveStatus === 'saving'} />
        <IconButton icon={UIIcons.publish} title="Publish layout" className="fb-btn--accent" onClick={publishLayout} disabled={saveStatus === 'saving'} />
      </div>
    </header>
  );
}
