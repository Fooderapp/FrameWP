import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import AtomLogo from '../components/AtomLogo';
import { IconButton, UIIcons } from '../components/UIIcons';

const TEMPLATE_LABELS = {
  'regular':      'Regular',
  'post-single':  'Post detail',
  'post-archive': 'Post list',
  'woo-product':  'Product detail',
  'woo-category': 'Product category',
  'woo-shop':     'Shop',
};

function templateBadgeLabel(t) {
  return TEMPLATE_LABELS[t] || (t ? t.replace(/-/g, ' ') : '');
}

function PagesDropdown({ currentPage, isReadOnly }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const setPageSettingsModalOpen = useEditorStore(s => s.setPageSettingsModalOpen);

  const layouts = useMemo(() => {
    const list = Array.isArray(window.fbData?.layouts) ? window.fbData.layouts : [];
    return list;
  }, []);

  const currentPostId = parseInt(window.fbData?.postId, 10) || 0;
  const currentTitle = currentPage?.title || 'Untitled Page';
  const currentTemplateType = currentPage?.templateType || 'regular';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleNavigate = (editUrl, pid) => {
    if (pid === currentPostId) { setOpen(false); return; }
    window.location.href = editUrl;
  };

  return (
    <div className="fb-topbar__pages" ref={wrapRef}>
      <button
        type="button"
        className="fb-topbar__page-btn"
        onClick={() => setOpen((v) => !v)}
        title="Switch page"
      >
        <span className="fb-topbar__page-name">{currentTitle}</span>
        {currentTemplateType && currentTemplateType !== 'regular' ? (
          <span className="fb-topbar__page-badge">{templateBadgeLabel(currentTemplateType)}</span>
        ) : null}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.55 }}>
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="fb-topbar__pages-menu" role="menu">
          <div className="fb-topbar__pages-header">Pages</div>
          <div className="fb-topbar__pages-list">
            {layouts.length === 0 ? (
              <div className="fb-topbar__pages-empty">No other layouts yet.</div>
            ) : (
              layouts.map((p) => {
                const isCurrent = p.id === currentPostId;
                const t = isCurrent ? currentTemplateType : (p.templateType || 'regular');
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={`fb-topbar__pages-item${isCurrent ? ' is-current' : ''}`}
                    onClick={() => handleNavigate(p.editUrl, p.id)}
                    title={`${p.title} (${p.postType})`}
                  >
                    <span className="fb-topbar__pages-item-title">{isCurrent ? currentTitle : p.title}</span>
                    {t && t !== 'regular' ? (
                      <span className="fb-topbar__pages-item-badge">{templateBadgeLabel(t)}</span>
                    ) : null}
                    {isCurrent ? <span className="fb-topbar__pages-item-dot" aria-hidden>●</span> : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="fb-topbar__pages-footer">
            <button
              type="button"
              className="fb-topbar__pages-settings"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                setPageSettingsModalOpen(true);
              }}
            >
              Page settings…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  const currentPage = useEditorStore(s => s.getCurrentPage());
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
        <div className="fb-topbar__project">
          <span className="fb-topbar__brandmark">
            <AtomLogo />
          </span>
        </div>
        <button type="button" className="fb-secondary-btn fb-topbar__back" onClick={handleBackToWordPress}>
          {UIIcons.arrowLeft}
          <span>WordPress</span>
        </button>
        <PagesDropdown
          currentPage={currentPage}
          isReadOnly={isReadOnly}
        />
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
