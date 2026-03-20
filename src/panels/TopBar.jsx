import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { IconButton, UIIcons } from '../components/UIIcons';

export default function TopBar() {
  const viewport       = useEditorStore(s => s.viewport);
  const setViewport    = useEditorStore(s => s.setViewport);
  const publishLayout  = useEditorStore(s => s.publishLayout);
  const saveStatus     = useEditorStore(s => s.saveStatus);
  const undo           = useEditorStore(s => s.undo);
  const redo           = useEditorStore(s => s.redo);
  const bpDefs         = useEditorStore(s => s.breakpointDefs);
  const documentLock   = useEditorStore(s => s.documentLock);
  const setVariablesModalOpen = useEditorStore(s => s.setVariablesModalOpen);
  const pct = Math.round(viewport.scale * 100);
  const postId = parseInt(window.fbData?.postId, 10) || 0;
  const backToWordPressUrl = postId > 0
    ? `${window.fbData?.adminUrl || '/wp-admin/'}post.php?post=${postId}&action=edit`
    : (window.fbData?.adminUrl || '/wp-admin/');

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
    : saveStatus === 'error'    ? 'Save failed'
    : null;
  const statusClass = saveStatus === 'ok' ? 'fb-save-status--ok'
    : saveStatus === 'error' ? 'fb-save-status--err'
    : '';
  const lockHolderName = documentLock.holder?.displayName?.trim() || 'Another editor';
  const lockAvatar = documentLock.holder?.avatarUrl || window.fbData?.currentUser?.avatarUrl || '';
  const isReadOnly = documentLock.isLockedByOther;
  const lockLabel = isReadOnly
    ? `${lockHolderName} is editing`
    : documentLock.isOwner
      ? 'You are editing'
      : documentLock.status === 'idle'
        ? 'Checking lock'
        : 'Ready to edit';

  const handleBackToWordPress = () => {
    window.location.href = backToWordPressUrl;
  };

  return (
    <header className="fb-topbar">
      <div className="fb-topbar__left">
        <button type="button" className="fb-secondary-btn fb-topbar__back" onClick={handleBackToWordPress}>
          {UIIcons.arrowLeft}
          <span>WordPress</span>
        </button>
        <div className="fb-topbar__project">
          <span className="fb-topbar__brand">Atom</span>
        </div>
      </div>

      <div className="fb-topbar__center">
        <div className="fb-topbar__group">
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
        <div className="fb-topbar__group">
          <IconButton icon={UIIcons.undo} title="Undo (⌘Z)" onClick={undo} disabled={isReadOnly} />
          <IconButton icon={UIIcons.redo} title="Redo (⌘⇧Z)" onClick={redo} disabled={isReadOnly} />
        </div>
      </div>

      <div className="fb-topbar__right">
        <div className="fb-topbar__status">
          <div className={`fb-topbar__lock-pill${isReadOnly ? ' fb-topbar__lock-pill--locked' : documentLock.isOwner ? ' fb-topbar__lock-pill--owned' : ''}`}>
            {lockAvatar ? <img src={lockAvatar} alt="" className="fb-topbar__lock-avatar" /> : null}
            <span>{lockLabel}</span>
          </div>
          {statusLabel ? <span className={`fb-save-status ${statusClass}`}>{statusLabel}</span> : null}
        </div>
        <div className="fb-topbar__actions">
          <IconButton icon={UIIcons.variables} title="Variables" className="fb-topbar__action-btn fb-topbar__variables" onClick={() => setVariablesModalOpen(true)} disabled={isReadOnly}>
            <span className="fb-topbar__publish-label">Variables</span>
          </IconButton>
          <IconButton icon={UIIcons.publish} title="Publish layout" className="fb-topbar__action-btn fb-topbar__action-btn--primary fb-topbar__publish" onClick={publishLayout} disabled={isReadOnly || saveStatus === 'saving'}>
            <span className="fb-topbar__publish-label">Publish</span>
          </IconButton>
        </div>
      </div>
    </header>
  );
}
