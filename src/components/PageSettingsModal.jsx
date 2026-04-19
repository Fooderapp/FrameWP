import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../store/editorStore';

/* ── Template type options ─────────────────────────────────────── */

function buildTemplateOptions() {
  const wooActive = !!(window.fbData?.woocommerce_active);
  const opts = [
    { value: 'regular', label: 'Regular page', hint: 'A static page — no post context or dynamic bindings.' },
    { value: 'post-single', label: 'Post detail (single)', hint: 'Template used to render individual posts of a given post type.' },
    { value: 'post-archive', label: 'Post archive', hint: 'Template used for archive / listing pages of a post type.' },
  ];
  if (wooActive) {
    opts.push({ value: 'woo-product', label: 'WooCommerce product', hint: 'Single product detail page. Product bindings become available.' });
    opts.push({ value: 'woo-category', label: 'WooCommerce category', hint: 'Product category archive page.' });
    opts.push({ value: 'woo-shop', label: 'WooCommerce shop', hint: 'Main shop / all products listing.' });
  }
  return opts;
}

function buildTargetOptions(templateType) {
  const sources = window.fbData?.templateTargets || {};
  if (templateType === 'post-single' || templateType === 'post-archive') {
    const list = Array.isArray(sources.postTypes) ? sources.postTypes : [
      { slug: 'post', label: 'Post' },
      { slug: 'page', label: 'Page' },
    ];
    return list.map((pt) => ({ value: pt.slug, label: pt.label || pt.slug }));
  }
  if (templateType === 'woo-category') {
    const cats = Array.isArray(sources.productCategories) ? sources.productCategories : [];
    if (!cats.length) return [{ value: '', label: 'All categories' }];
    return [{ value: '', label: 'All categories' }, ...cats.map((c) => ({ value: c.slug, label: c.name || c.slug }))];
  }
  return [];
}

/* ── Modal ────────────────────────────────────────────────────── */

export default function PageSettingsModal() {
  const open = useEditorStore((s) => s.pageSettingsModalOpen);
  const setOpen = useEditorStore((s) => s.setPageSettingsModalOpen);
  const currentPage = useEditorStore((s) => s.getCurrentPage());
  const updatePageSettings = useEditorStore((s) => s.updatePageSettings);

  const [title, setTitle] = useState('');
  const [templateType, setTemplateType] = useState('regular');
  const [templateTarget, setTemplateTarget] = useState('');

  useEffect(() => {
    if (open && currentPage) {
      setTitle(currentPage.title || '');
      setTemplateType(currentPage.templateType || 'regular');
      setTemplateTarget(currentPage.templateTarget || '');
    }
  }, [open, currentPage]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const templateOptions = buildTemplateOptions();
  const targetOptions = buildTargetOptions(templateType);
  const needsTarget = templateType === 'post-single' || templateType === 'post-archive' || templateType === 'woo-category';
  const activeOption = templateOptions.find((o) => o.value === templateType);

  const commit = () => {
    updatePageSettings({
      title: title.trim() || 'Untitled Page',
      templateType,
      templateTarget: needsTarget ? templateTarget : '',
    });
    setOpen(false);
  };

  const modal = (
    <div className="fb-overlay-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="fb-overlay-modal__card fb-page-settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fb-overlay-modal__head">
          Page settings
        </div>

        <div className="fb-overlay-modal__body">
          <div className="fb-prop-row">
            <label className="fb-prop-label">Name</label>
            <input
              className="fb-prop-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled Page"
              autoFocus
            />
          </div>

          <div className="fb-prop-row">
            <label className="fb-prop-label">Template</label>
            <select
              className="fb-prop-input"
              value={templateType}
              onChange={(e) => { setTemplateType(e.target.value); setTemplateTarget(''); }}
            >
              {templateOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {activeOption?.hint ? (
            <div className="fb-page-settings-modal__hint">{activeOption.hint}</div>
          ) : null}

          {needsTarget ? (
            <div className="fb-prop-row">
              <label className="fb-prop-label">
                {templateType === 'woo-category' ? 'Category' : 'Post type'}
              </label>
              {targetOptions.length ? (
                <select
                  className="fb-prop-input"
                  value={templateTarget}
                  onChange={(e) => setTemplateTarget(e.target.value)}
                >
                  {targetOptions.map((o) => (
                    <option key={o.value || '_all'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="fb-prop-input"
                  value={templateTarget}
                  onChange={(e) => setTemplateTarget(e.target.value)}
                  placeholder="e.g. post"
                />
              )}
            </div>
          ) : null}

          {templateType !== 'regular' ? (
            <div className="fb-page-settings-modal__bindings-note">
              Field bindings (post title, featured image, WooCommerce price, etc.) will become available
              on text and image elements inside this page.
            </div>
          ) : null}
        </div>

        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="fb-primary-btn" onClick={commit}>Save</button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
