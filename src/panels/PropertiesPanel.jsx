import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ASSET_STORAGE_COMPONENT_ID, useEditorStore, resolveElement, resolveElementWithVariables, resolveBackground, resolvePagePadding, resolvePageLayout, resolvePageSmoothScroll, getSelectionElementIds, resolveElementAnimations, buildPolygonSvgMarkup, getShapePresetKind, getVectorShapeData, setVectorAnchorMode, removeVectorAnchor, reframeVectorShapeData, buildVectorShapeSvgMarkup, getLoopItemPreviewVariables, getLoopTemplateRootForElement } from '../store/editorStore';
import FillPicker from '../components/FillPicker';
import GoogleFontPicker from '../components/GoogleFontPicker';
import CustomSelect from '../components/CustomSelect';
import { EMBED_MODE_OPTIONS } from '../components/embedUtils';
import { IconButton, UIIcons } from '../components/UIIcons';
import { sanitizeSvgMarkup } from '../components/iconLibrary';
import { getRichTextInlineStyleValues, plainTextToRichTextHtml } from '../components/richText';
import VariantTransitionModal from '../components/VariantTransitionModal';
import ElementAnimationModal from '../components/ElementAnimationModal';
import { toViewportRect } from '../utils/rect';
import { hasElement3DRotation } from '../utils/elementTransform';
import { isFormContainerType, isFormFieldType, isFormSubmitButtonType, normalizeFormConfig } from '../domain/formModel';
import { isLoopElementType, normalizeLoopConfig } from '../domain/loopModel';
import { FORM_STYLE_DEFAULTS } from '../domain/formStyleModel';

// ── Helpers ──────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fb-prop-section">
      <div className="fb-prop-section__head" onClick={() => setOpen(o => !o)}>
        <span className="fb-prop-section__title">{title}</span>
        {action && <span className="fb-prop-section__action" onClick={e => e.stopPropagation()}>{action}</span>}
        <span className="fb-prop-section__toggle">{open ? '−' : '+'}</span>
      </div>
      {open && <div className="fb-prop-section__body">{children}</div>}
    </div>
  );
}

function getShadowStyleKey(prefix, key) {
  if (!prefix) return key;
  if (key === 'boxShadow') return `${prefix}BoxShadow`;
  return `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

function HeaderActionButton({ icon, title, label, className = '', children, ...props }) {
  return (
    <IconButton icon={icon} title={title} className={`fb-panel-header-action${className ? ` ${className}` : ''}`} {...props}>
      <span className="fb-panel-header-action__label">{label}</span>
      {children}
    </IconButton>
  );
}

function getDefaultInteractionValue(variableType) {
  if (variableType === 'boolean') return false;
  if (variableType === 'color') return '#000000';
  if (variableType === 'number') return 0;
  return '';
}

const ASSET_TEXT_STYLE_KEYS = [
  'color', 'fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'fontSizeUnit',
  'lineHeight', 'lineHeightUnit', 'letterSpacing', 'letterSpacingUnit', 'textAlign',
  'textTransform', 'textDecoration',
];

function pickAssetStyleProps(source = {}, keys = []) {
  return keys.reduce((acc, key) => {
    if (source?.[key] != null && source[key] !== '') acc[key] = source[key];
    return acc;
  }, {});
}

function buildPanelTextStyleAsset(element, resolved) {
  return {
    id: `txt-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${element?.name || element?.type || 'Text'} Text`,
    type: 'text',
    source: 'builder',
    sourceId: element?.id || '',
    styleProps: pickAssetStyleProps(resolved?.styles ?? {}, ASSET_TEXT_STYLE_KEYS),
  };
}

function buildPanelElementStyleAsset(element, resolved) {
  return {
    id: `el-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${element?.name || element?.type || 'Element'} Style`,
    type: element?.type || 'element',
    source: 'builder',
    sourceId: element?.id || '',
    styleProps: { ...(resolved?.styles ?? {}) },
  };
}

function isSameAssetStyle(existing, candidate) {
  return `${existing?.name || ''}`.trim().toLowerCase() === `${candidate?.name || ''}`.trim().toLowerCase()
    && JSON.stringify(existing?.styleProps ?? existing?.value ?? null) === JSON.stringify(candidate?.styleProps ?? candidate?.value ?? null);
}

function getTextColorMeta(resolved, fallback = '#000000') {
  const baseColor = resolved?.styles?.color ?? fallback;
  const inlineColors = getRichTextInlineStyleValues(resolved?.richTextHtml ?? '', 'color');
  const distinctColors = Array.from(new Set([baseColor, ...inlineColors].filter(Boolean)));
  return {
    baseColor,
    mixed: distinctColors.length > 1,
  };
}

function getMediaUrl(value) {
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
  return typeof value === 'string' ? value.trim() : '';
}

function getShapeTypeLabel(shapeKind) {
  switch (shapeKind) {
    case 'circle': return 'Circle';
    case 'line': return 'Line';
    case 'polygon': return 'Polygon';
    case 'path': return 'Path';
    case 'pen': return 'Pen';
    default: return 'Shape';
  }
}

function normalizeFiniteNumber(value, fallback = 0) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function formatNumericInputValue(value, fallback = 0) {
  return String(Math.round(normalizeFiniteNumber(value, fallback) * 10) / 10);
}

function NumberInput({ value, onChange, label, unit = 'px', min, max, step = 1 }) {
  const ext = normalizeFiniteNumber(value, 0);

  const [draft, setDraft] = React.useState(formatNumericInputValue(ext));
  const [focused, setFocused] = React.useState(false);

  // Sync external value changes while not focused (e.g., canvas drag)
  React.useEffect(() => {
    if (!focused) setDraft(formatNumericInputValue(ext));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  return (
    <div className="fb-prop-mini">
      <input
        className="fb-prop-input"
        type="number"
        value={focused ? draft : formatNumericInputValue(ext)}
        min={min}
        max={max}
        step={step}
        onFocus={e => { setFocused(true); setDraft(formatNumericInputValue(ext)); e.target.select(); }}
        onBlur={() => {
          setFocused(false);
          const num = parseFloat(draft);
          if (!isNaN(num)) onChange(num);
          else setDraft(formatNumericInputValue(ext));
        }}
        onChange={e => {
          const raw = e.target.value;
          setDraft(raw);
          const num = parseFloat(raw);
          if (!isNaN(num) && raw !== '' && raw !== '-') onChange(num);
        }}
        style={{ textAlign: 'center' }}
      />
      {label && <label>{label}</label>}
    </div>
  );
}

function MixedNumberInput({ value, onCommit, placeholder = 'Mixed', min, max, step = 1 }) {
  const [draft, setDraft] = React.useState(value == null ? '' : formatNumericInputValue(value));
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) setDraft(value == null ? '' : formatNumericInputValue(value));
  }, [focused, value]);

  return (
    <input
      className="fb-prop-input"
      type="number"
      value={draft}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onBlur={() => {
        setFocused(false);
        if (draft === '' || draft === '-') {
          setDraft(value == null ? '' : formatNumericInputValue(value));
          return;
        }
        const numericValue = parseFloat(draft);
        if (!Number.isFinite(numericValue)) {
          setDraft(value == null ? '' : formatNumericInputValue(value));
          return;
        }
        onCommit(numericValue);
      }}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

function MixedLabeledNumberInput({ label, value, onCommit, placeholder = 'Mixed', min, max, step = 1 }) {
  return (
    <div className="fb-prop-mini">
      <MixedNumberInput
        value={value}
        onCommit={onCommit}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
      />
      {label ? <label>{label}</label> : null}
    </div>
  );
}

/** Like NumberInput but shows blank when value is null/0/undefined */
function NullableNumberInput({ value, onChange, label, placeholder = '', min, step = 1 }) {
  const numericValue = value == null ? null : normalizeFiniteNumber(value, null);
  const hasValue = numericValue != null && numericValue !== 0;
  const [draft, setDraft] = React.useState(hasValue ? formatNumericInputValue(numericValue) : '');
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(hasValue ? formatNumericInputValue(numericValue) : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, hasValue, numericValue, value]);

  return (
    <div className="fb-prop-mini">
      <input
        className="fb-prop-input"
        type="number"
        value={focused ? draft : (hasValue ? formatNumericInputValue(numericValue) : '')}
        placeholder={placeholder}
        min={min}
        step={step}
        onFocus={e => { setFocused(true); setDraft(hasValue ? formatNumericInputValue(numericValue) : ''); e.target.select(); }}
        onBlur={() => {
          setFocused(false);
          if (draft === '' || draft === null) { onChange(null); return; }
          const num = parseFloat(draft);
          if (!isNaN(num) && num > 0) onChange(num);
          else { onChange(null); setDraft(''); }
        }}
        onChange={e => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw === '') { onChange(null); return; }
          const num = parseFloat(raw);
          if (!isNaN(num) && num > 0) onChange(num);
        }}
        style={{ textAlign: 'center' }}
      />
      {label && <label>{label}</label>}
    </div>
  );
}

function ColorInput({ value, onChange, mixed = false, mixedLabel = 'Mixed' }) {
  const [draft, setDraft] = React.useState(mixed ? mixedLabel : (value ?? ''));
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (focused) return;
    setDraft(mixed ? mixedLabel : (value ?? ''));
  }, [focused, mixed, mixedLabel, value]);

  return (
    <div className="fb-color-row">
      <FillPicker
        value={value ?? '#cccccc'}
        onChange={(nextValue) => {
          setDraft(nextValue);
          onChange(nextValue);
        }}
        solidOnly
        mixed={mixed}
        title={mixed ? mixedLabel : 'Edit color'}
      />
      <input
        className="fb-prop-input fb-color-hex"
        type="text"
        value={draft}
        onFocus={() => {
          setFocused(true);
          if (mixed) setDraft('');
        }}
        onBlur={() => {
          setFocused(false);
          if (!draft.trim()) setDraft(mixed ? mixedLabel : (value ?? ''));
        }}
        onChange={e => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
        spellCheck={false}
      />
    </div>
  );
}

function IconGroup({ options, value, onChange }) {
  return (
    <div className="fb-icon-group">
      {options.map(o => (
        <div
          key={o.value}
          className={`fb-icon-btn${value === o.value ? ' fb-icon-btn--active' : ''}`}
          title={o.label || o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
        </div>
      ))}
    </div>
  );
}

// ── Figma-style layout grid (direction + wrap + align + justify compact) ───────
const LAYOUT_ICONS = {
  row:    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="4" width="3" height="6" rx="0.5"/><rect x="5.5" y="4" width="3" height="6" rx="0.5"/><rect x="10" y="4" width="3" height="6" rx="0.5"/></svg>,
  column: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="1" width="6" height="3" rx="0.5"/><rect x="4" y="5.5" width="6" height="3" rx="0.5"/><rect x="4" y="10" width="6" height="3" rx="0.5"/></svg>,
  nowrap: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="4" width="3" height="6" rx="0.5"/><rect x="5.5" y="4" width="3" height="6" rx="0.5"/><rect x="10" y="4" width="3" height="6" rx="0.5"/></svg>,
  wrap:   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="1.5" width="3" height="4.5" rx="0.5"/><rect x="5.5" y="1.5" width="3" height="4.5" rx="0.5"/><rect x="10" y="1.5" width="3" height="4.5" rx="0.5"/><rect x="1" y="8" width="3" height="4.5" rx="0.5"/><rect x="5.5" y="8" width="3" height="4.5" rx="0.5"/></svg>,
  'align-start':   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1h12"/><rect x="2" y="3" width="3" height="8" rx="0.5"/><rect x="6.5" y="3" width="4" height="5" rx="0.5"/></svg>,
  'align-center':  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 7h12"/><rect x="2" y="2" width="3" height="10" rx="0.5"/><rect x="6.5" y="3.5" width="4" height="7" rx="0.5"/></svg>,
  'align-end':     <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 13h12"/><rect x="2" y="3" width="3" height="8" rx="0.5"/><rect x="6.5" y="6" width="4" height="5" rx="0.5"/></svg>,
  'align-stretch': <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1h12M1 13h12"/><rect x="2" y="2.5" width="3" height="9" rx="0.5"/><rect x="6.5" y="2.5" width="4" height="9" rx="0.5"/></svg>,
  'just-start':   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1v12"/><rect x="3" y="4" width="3" height="6" rx="0.5"/><rect x="7.5" y="4" width="3" height="6" rx="0.5"/></svg>,
  'just-center':  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 1v12"/><rect x="2.5" y="4" width="3" height="6" rx="0.5"/><rect x="8.5" y="4" width="3" height="6" rx="0.5"/></svg>,
  'just-end':     <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M13 1v12"/><rect x="3.5" y="4" width="3" height="6" rx="0.5"/><rect x="8" y="4" width="3" height="6" rx="0.5"/></svg>,
  'just-between': <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1v12M13 1v12"/><rect x="2.5" y="4" width="3" height="6" rx="0.5"/><rect x="8.5" y="4" width="3" height="6" rx="0.5"/></svg>,
  'just-around':  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1.5" y="4" width="3" height="6" rx="0.5"/><rect x="9.5" y="4" width="3" height="6" rx="0.5"/></svg>,
};

function LayoutGrid({ layout, onChange }) {
  const { flexDirection, alignItems, justifyContent, flexWrap } = layout;
  return (
    <div className="fb-layout-grid">
      <div className="fb-prop-row">
        <span className="fb-prop-label">Direction</span>
        <IconGroup
          value={flexDirection}
          onChange={v => onChange('flexDirection', v)}
          options={[
            { value: 'row',    icon: LAYOUT_ICONS.row,    label: 'Row' },
            { value: 'column', icon: LAYOUT_ICONS.column, label: 'Column' },
          ]}
        />
      </div>
      <div className="fb-prop-row">
        <span className="fb-prop-label">Wrap</span>
        <IconGroup
          value={flexWrap}
          onChange={v => onChange('flexWrap', v)}
          options={[
            { value: 'nowrap', icon: LAYOUT_ICONS.nowrap, label: 'No wrap' },
            { value: 'wrap',   icon: LAYOUT_ICONS.wrap,   label: 'Wrap' },
          ]}
        />
      </div>
      <div className="fb-prop-row">
        <span className="fb-prop-label">Align</span>
        <IconGroup
          value={alignItems}
          onChange={v => onChange('alignItems', v)}
          options={[
            { value: 'flex-start', icon: LAYOUT_ICONS['align-start'],   label: 'Start' },
            { value: 'center',     icon: LAYOUT_ICONS['align-center'],  label: 'Center' },
            { value: 'flex-end',   icon: LAYOUT_ICONS['align-end'],     label: 'End' },
            { value: 'stretch',    icon: LAYOUT_ICONS['align-stretch'], label: 'Stretch' },
          ]}
        />
      </div>
      <div className="fb-prop-row">
        <span className="fb-prop-label">Justify</span>
        <IconGroup
          value={justifyContent}
          onChange={v => onChange('justifyContent', v)}
          options={[
            { value: 'flex-start',    icon: LAYOUT_ICONS['just-start'],   label: 'Start' },
            { value: 'center',        icon: LAYOUT_ICONS['just-center'],  label: 'Center' },
            { value: 'flex-end',      icon: LAYOUT_ICONS['just-end'],     label: 'End' },
            { value: 'space-between', icon: LAYOUT_ICONS['just-between'], label: 'Between' },
            { value: 'space-around',  icon: LAYOUT_ICONS['just-around'],  label: 'Around' },
          ]}
        />
      </div>
    </div>
  );
}

// ── Align strip for absolute/fixed positioned elements ─────────────────────────
const ALIGN_SVG = {
  left:    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 1v12"/><rect x="3" y="3" width="4" height="8" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="3" y="3" width="4" height="8" rx="0.5"/></svg>,
  hcenter: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M7 1v12"/><rect x="3" y="3" width="8" height="8" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="3" y="3" width="8" height="8" rx="0.5"/></svg>,
  right:   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M13 1v12"/><rect x="7" y="3" width="4" height="8" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="7" y="3" width="4" height="8" rx="0.5"/></svg>,
  top:     <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 1h12"/><rect x="3" y="3" width="8" height="4" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="3" y="3" width="8" height="4" rx="0.5"/></svg>,
  vcenter: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 7h12"/><rect x="3" y="3" width="8" height="8" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="3" y="3" width="8" height="8" rx="0.5"/></svg>,
  bottom:  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 13h12"/><rect x="3" y="7" width="8" height="4" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="3" y="7" width="8" height="4" rx="0.5"/></svg>,
  hleft:   <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 7h12" strokeDasharray="2 1.5"/><rect x="1" y="4.5" width="5" height="5" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="1" y="4.5" width="5" height="5" rx="0.5"/></svg>,
  hright:  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 7h12" strokeDasharray="2 1.5"/><rect x="8" y="4.5" width="5" height="5" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="8" y="4.5" width="5" height="5" rx="0.5"/></svg>,
  vtop:    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M7 1v12" strokeDasharray="2 1.5"/><rect x="4.5" y="1" width="5" height="5" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="4.5" y="1" width="5" height="5" rx="0.5"/></svg>,
  vbottom: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M7 1v12" strokeDasharray="2 1.5"/><rect x="4.5" y="8" width="5" height="5" rx="0.5" fill="currentColor" fillOpacity="0.15"/><rect x="4.5" y="8" width="5" height="5" rx="0.5"/></svg>,
};

const TEXT_ALIGN_OPTIONS = [
  { value: 'left', label: 'Left', icon: UIIcons.alignLeft },
  { value: 'center', label: 'Center', icon: UIIcons.alignCenter },
  { value: 'right', label: 'Right', icon: UIIcons.alignRight },
  { value: 'justify', label: 'Justify', icon: UIIcons.alignJustify },
];

const FONT_WEIGHT_OPTIONS = [200, 300, 400, 500, 600, 700, 800, 900];
const TEXT_GROW_OPTIONS = [
  { value: 'auto-width', label: 'Auto width', icon: UIIcons.autoWidth },
  { value: 'auto-height', label: 'Auto height', icon: UIIcons.autoHeight },
  { value: 'fixed', label: 'Fixed size', icon: UIIcons.fixedSize },
];

function getAlignTargets(action, width, height, containerW, containerH) {
  switch (action) {
    case 'left': return { x: 0 };
    case 'hcenter': return { x: Math.round((containerW - width) / 2) };
    case 'right': return { x: containerW - width };
    case 'top': return { y: 0 };
    case 'vcenter': return { y: Math.round((containerH - height) / 2) };
    case 'bottom': return { y: containerH - height };
    default: return null;
  }
}

function AlignStrip({ resolved, containerW, containerH, upd, commit, disabled, onAlign = null }) {
  const w = resolved.width ?? 100;
  const h = resolved.height ?? 100;
  const go = (action) => {
    if (disabled) return;
    if (typeof onAlign === 'function') {
      onAlign(action);
      return;
    }
    const targets = getAlignTargets(action, w, h, containerW, containerH);
    if (!targets) return;
    Object.entries(targets).forEach(([axis, value]) => upd(axis, value));
    commit();
  };
  return (
    <div className={`fb-align-strip${disabled ? ' fb-align-strip--disabled' : ''}`}>
      <div className="fb-align-strip__btn" title="Align left"         onClick={() => go('left')}>{ALIGN_SVG.left}</div>
      <div className="fb-align-strip__btn" title="Center horizontal"  onClick={() => go('hcenter')}>{ALIGN_SVG.hcenter}</div>
      <div className="fb-align-strip__btn" title="Align right"        onClick={() => go('right')}>{ALIGN_SVG.right}</div>
      <div className="fb-align-strip__sep" />
      <div className="fb-align-strip__btn" title="Align top"          onClick={() => go('top')}>{ALIGN_SVG.top}</div>
      <div className="fb-align-strip__btn" title="Center vertical"    onClick={() => go('vcenter')}>{ALIGN_SVG.vcenter}</div>
      <div className="fb-align-strip__btn" title="Align bottom"       onClick={() => go('bottom')}>{ALIGN_SVG.bottom}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <div className="fb-toggle" onClick={() => onChange(!value)}>
      <div className={`fb-toggle__track${value ? ' fb-toggle__track--on' : ''}`}>
        <div className="fb-toggle__thumb" />
      </div>
      {label && <span className="fb-toggle__label">{label}</span>}
    </div>
  );
}

function ChoiceGroup({ value, onChange, options }) {
  return (
    <div className="fb-choice-group">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={`fb-choice-group__btn${value === option.value ? ' fb-choice-group__btn--active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const FORM_STATE_OPTIONS = [
  { value: 'idle', label: 'Idle' },
  { value: 'submitting', label: 'Submitting' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
];

const FORM_SELECT_ICON_OPTIONS = [
  { value: 'caret', label: 'Caret', icon: '▼' },
  { value: 'chevron', label: 'Chevron', icon: '⌄' },
  { value: 'none', label: 'None', icon: '∅' },
];

const FORM_FIELD_PREVIEW_STATE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'hover', label: 'Hover' },
  { value: 'focus', label: 'Focus' },
  { value: 'checked', label: 'Checked' },
];

const FORM_STATE_EASING_OPTIONS = [
  { value: 'ease', label: 'Ease' },
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in-out', label: 'Ease In Out' },
];

const FORM_BUTTON_PREVIEW_STATE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'hover', label: 'Hover' },
  { value: 'pressed', label: 'Pressed' },
  { value: 'submitting', label: 'Processing' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
];

const FORM_BUTTON_STATE_GROUPS = [
  { key: 'hover', label: 'Hover' },
  { key: 'pressed', label: 'Pressed' },
  { key: 'processing', label: 'Processing' },
  { key: 'success', label: 'Success' },
  { key: 'error', label: 'Error' },
];

function getFormOptionKindIcon(fieldType) {
  if (fieldType === 'radio-group') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" />
        <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.8" />
      <path d="m9.25 6.75 2 2 2-2" />
    </svg>
  );
}

function EdgeInsetsControl({ values, onChange, syncKey, min = 0, step = 1 }) {
  const top = normalizeFiniteNumber(values?.top, 0);
  const right = normalizeFiniteNumber(values?.right, 0);
  const bottom = normalizeFiniteNumber(values?.bottom, 0);
  const left = normalizeFiniteNumber(values?.left, 0);
  const isUniform = top === right && top === bottom && top === left;
  const [linked, setLinked] = React.useState(isUniform);

  React.useEffect(() => {
    setLinked(isUniform);
  }, [syncKey]);

  const applyUniformValue = (nextValue) => {
    onChange('top', nextValue);
    onChange('right', nextValue);
    onChange('bottom', nextValue);
    onChange('left', nextValue);
  };

  return (
    <div className="fb-spacing-control">
      <div className="fb-spacing-control__mode">
        <IconButton
          icon={UIIcons.radiusLinked}
          title="Uniform padding"
          active={linked}
          onClick={() => {
            setLinked(true);
            applyUniformValue(top);
          }}
        />
        <IconButton
          icon={UIIcons.radiusIndependent}
          title="Independent padding"
          active={!linked}
          onClick={() => setLinked(false)}
        />
      </div>

      {linked ? (
        <div className="fb-spacing-control__single">
          <NumberInput value={top} min={min} step={step} label="All" onChange={applyUniformValue} />
        </div>
      ) : (
        <div className="fb-quad fb-spacing-control__grid">
          <NumberInput value={top} min={min} step={step} label="Top" onChange={(nextValue) => onChange('top', nextValue)} />
          <NumberInput value={right} min={min} step={step} label="Right" onChange={(nextValue) => onChange('right', nextValue)} />
          <NumberInput value={bottom} min={min} step={step} label="Bottom" onChange={(nextValue) => onChange('bottom', nextValue)} />
          <NumberInput value={left} min={min} step={step} label="Left" onChange={(nextValue) => onChange('left', nextValue)} />
        </div>
      )}
    </div>
  );
}

function ensureFormOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((option, index) => ({
    id: typeof option?.id === 'string' && option.id ? option.id : `form-option-${index + 1}`,
    label: typeof option?.label === 'string' && option.label ? option.label : `Option ${index + 1}`,
    value: typeof option?.value === 'string' && option.value ? option.value : `option-${index + 1}`,
    enabled: option?.enabled !== false,
  }));
}

function getFormStatePopupSummary(styles, stateKey) {
  if (stateKey === 'checked') {
    const hasChecked = !!(styles?.checkedBackgroundColor || styles?.checkedBorderColor || styles?.checkedBoxShadow);
    return hasChecked ? 'Effect' : 'Add...';
  }
  const hasFocus = !!(styles?.focusBackgroundColor || styles?.focusBorderColor || styles?.focusBoxShadow || styles?.focusRingWidth);
  return hasFocus ? 'Effect' : 'Add...';
}

function AnchoredPanelPopup({ anchorElement, onClose, className = '', width = 340, children }) {
  const popupRef = useRef(null);
  const [position, setPosition] = useState({ top: 32, left: 32, ready: false });

  useLayoutEffect(() => {
    if (!anchorElement) return undefined;

    const updatePosition = () => {
      const anchorRect = anchorElement.getBoundingClientRect();
      const panelRect = anchorElement.closest('.fb-right')?.getBoundingClientRect();
      const popupWidth = Math.min(popupRef.current?.offsetWidth ?? width, window.innerWidth - 24);
      const popupHeight = Math.min(popupRef.current?.offsetHeight ?? 560, window.innerHeight - 24);
      const panelLeft = panelRect?.left ?? anchorRect.left;
      const panelRight = panelRect?.right ?? anchorRect.right;
      const fitsLeft = panelLeft - popupWidth - 12 >= 12;
      let left = fitsLeft ? panelLeft - popupWidth - 12 : panelRight + 12;
      if (left + popupWidth > window.innerWidth - 12) left = window.innerWidth - popupWidth - 12;
      const top = Math.max(12, Math.min(window.innerHeight - popupHeight - 12, anchorRect.top - 6));
      setPosition({ top, left: Math.max(12, left), ready: true });
    };

    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorElement, width]);

  useEffect(() => {
    if (!anchorElement) return undefined;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (popupRef.current?.contains(target)) return;
      if (anchorElement?.contains?.(target)) return;
      if (target instanceof Element && target.closest('.fb-fill-popover')) return;
      onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorElement, onClose]);

  if (!anchorElement || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={popupRef}
      className={`fb-shadow-popup fb-form-mini-popup${className ? ` ${className}` : ''}`}
      data-inline-editor-ui="true"
      style={{ top: position.top, left: position.left, width, visibility: position.ready ? 'visible' : 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="fb-shadow-popup__card fb-form-mini-popup__card">
        {children}
      </div>
    </div>,
    document.body,
  );
}

function FormStatePopupButton({ title, stateKey, styles, onPatch, onCommit, onPreview }) {
  const triggerRef = useRef(null);
  const shadowTriggerRef = useRef(null);
  const shadowDirtyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [shadowOpen, setShadowOpen] = useState(false);
  const prefix = stateKey === 'checked' ? 'checked' : 'focus';
  const backgroundKey = `${prefix}BackgroundColor`;
  const borderKey = `${prefix}BorderColor`;

  const handleOpen = () => {
    onPreview?.(stateKey);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`fb-shadow-style-cta${getFormStatePopupSummary(styles, stateKey) !== 'Add...' ? ' is-active' : ''}`}
        onClick={handleOpen}
      >
        <span className={`fb-shadow-style-cta__indicator${getFormStatePopupSummary(styles, stateKey) !== 'Add...' ? ' is-active' : ''}`} />
        <span>{getFormStatePopupSummary(styles, stateKey)}</span>
      </button>

      {open ? (
        <AnchoredPanelPopup anchorElement={triggerRef.current} onClose={() => { setOpen(false); onCommit?.(); }} width={320}>
          <div className="fb-shadow-popup__head fb-form-mini-popup__head">
            <div className="fb-shadow-popup__title">{title}</div>
            <IconButton icon={UIIcons.close} title={`Close ${title.toLowerCase()} popup`} onClick={() => { setOpen(false); onCommit?.(); }} />
          </div>
          <div className="fb-shadow-popup__body fb-form-mini-popup__body">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Fill</span>
              <ColorInput value={styles?.[backgroundKey] ?? styles?.backgroundColor ?? FORM_STYLE_DEFAULTS[backgroundKey] ?? FORM_STYLE_DEFAULTS.backgroundColor} onChange={(value) => onPatch({ [backgroundKey]: value })} />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Border</span>
              <ColorInput value={styles?.[borderKey] ?? styles?.borderColor ?? FORM_STYLE_DEFAULTS[borderKey] ?? FORM_STYLE_DEFAULTS.borderColor} onChange={(value) => onPatch({ [borderKey]: value })} />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Shadows</span>
              <button
                type="button"
                ref={shadowTriggerRef}
                className={`fb-shadow-style-cta${styles?.[`${prefix}BoxShadow`] ? ' is-active' : ''}`}
                onClick={() => setShadowOpen(true)}
              >
                <span className={`fb-shadow-style-cta__indicator${styles?.[`${prefix}BoxShadow`] ? ' is-active' : ''}`} />
                <span>{getShadowSummary(styles, prefix)}</span>
              </button>
            </div>
            {stateKey === 'focus' ? (
              <div className="fb-prop-row">
                <span className="fb-prop-label">Ring</span>
                <div className="fb-style-inline-group fb-style-inline-group--stacked">
                  <NumberInput value={styles?.focusRingWidth ?? FORM_STYLE_DEFAULTS.focusRingWidth} min={0} onChange={(value) => onPatch({ focusRingWidth: value })} />
                  <ColorInput value={styles?.focusRingColor ?? FORM_STYLE_DEFAULTS.focusRingColor} onChange={(value) => onPatch({ focusRingColor: value })} />
                </div>
              </div>
            ) : null}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Transition</span>
              <div className="fb-form-mini-popup__transition">
                <NumberInput value={styles?.stateTransitionDuration ?? FORM_STYLE_DEFAULTS.stateTransitionDuration} min={0} step={0.01} label="Sec" onChange={(value) => onPatch({ stateTransitionDuration: value })} />
                <select className="fb-prop-input" value={styles?.stateTransitionEasing ?? FORM_STYLE_DEFAULTS.stateTransitionEasing} onChange={(event) => onPatch({ stateTransitionEasing: event.target.value })}>
                  {FORM_STATE_EASING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </AnchoredPanelPopup>
      ) : null}

      {shadowOpen ? (
        <ShadowSetupModal
          anchorRef={shadowTriggerRef}
          initialValue={getShadowDraftFromStyles(styles, prefix)}
          onClose={() => {
            setShadowOpen(false);
            if (shadowDirtyRef.current) {
              shadowDirtyRef.current = false;
              onCommit?.();
            }
          }}
          onChange={(draft) => {
            shadowDirtyRef.current = true;
            onPatch(buildShadowStylePayload(draft, prefix));
          }}
          onRemove={() => {
            shadowDirtyRef.current = false;
            onPatch(buildShadowStylePayload({ ...getShadowDraftFromStyles(styles, prefix), enabled: false }, prefix));
            setShadowOpen(false);
            onCommit?.();
          }}
        />
      ) : null}
    </>
  );
}

function FormOptionsEditor({ value, onChange, onCommit, fieldType = 'dropdown', defaultValue = '', onDefaultChange = null }) {
  const options = ensureFormOptions(value);
  const [openOptionId, setOpenOptionId] = useState(null);
  const triggerMapRef = useRef(new Map());

  const setTriggerRef = (optionId) => (node) => {
    if (node) triggerMapRef.current.set(optionId, node);
    else triggerMapRef.current.delete(optionId);
  };

  const updateOption = (index, key, nextValue) => {
    const nextOptions = options.map((option, optionIndex) => (
      optionIndex === index
        ? { ...option, [key]: nextValue }
        : option
    ));
    onChange(nextOptions);
  };

  const moveOption = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= options.length) return;
    const nextOptions = [...options];
    const [item] = nextOptions.splice(index, 1);
    nextOptions.splice(nextIndex, 0, item);
    onChange(nextOptions);
    onCommit?.();
  };

  const removeOption = (index) => {
    onChange(options.filter((_, optionIndex) => optionIndex !== index));
    onCommit?.();
  };

  const addOption = () => {
    onChange([
      ...options,
      {
        id: `form-option-${Date.now()}-${options.length + 1}`,
        label: `Option ${options.length + 1}`,
        value: `option-${options.length + 1}`,
        enabled: true,
      },
    ]);
    onCommit?.();
  };

  const activeOption = options.find((option) => option.id === openOptionId) ?? null;
  const activeIndex = activeOption ? options.findIndex((option) => option.id === activeOption.id) : -1;
  const activeAnchor = activeOption ? triggerMapRef.current.get(activeOption.id) ?? null : null;

  return (
    <div className="fb-form-options-editor">
      <div className="fb-form-options-editor__toolbar">
        <div className="fb-artboard-bp-note">
          {fieldType === 'radio-group'
            ? 'Radio options render in order and share one selection state.'
            : 'Dropdown options render in order and use the value for submitted data.'}
        </div>
        <button type="button" className="fb-secondary-btn fb-btn--sm" onClick={addOption}>Add Option</button>
      </div>
      {options.length ? options.map((option, index) => (
        <div key={option.id} className="fb-form-option-card">
          <button type="button" ref={setTriggerRef(option.id)} className="fb-form-option-card__main" onClick={() => setOpenOptionId(option.id)}>
            <div className="fb-form-option-card__icon">{getFormOptionKindIcon(fieldType)}</div>
            <div className="fb-form-option-card__fields">
              <span className="fb-form-option-card__title">{option.label}</span>
              <span className="fb-form-option-card__meta">{option.value}</span>
            </div>
          </button>
          <div className="fb-form-option-card__actions">
            <button type="button" className="fb-icon-btn fb-btn--sm" title="Move up" onClick={() => moveOption(index, -1)} disabled={index === 0}><span aria-hidden="true">↑</span></button>
            <button type="button" className="fb-icon-btn fb-btn--sm" title="Move down" onClick={() => moveOption(index, 1)} disabled={index === options.length - 1}><span aria-hidden="true">↓</span></button>
            <button type="button" className="fb-icon-btn fb-btn--sm" title="Remove option" onClick={() => removeOption(index)}><span aria-hidden="true">{UIIcons.trash}</span></button>
          </div>
        </div>
      )) : <div className="fb-artboard-bp-note">No options yet. Add the first option to define the order shown in the field.</div>}

      {activeOption ? (
        <AnchoredPanelPopup anchorElement={activeAnchor} onClose={() => { setOpenOptionId(null); onCommit?.(); }} width={320}>
          <div className="fb-shadow-popup__head fb-form-mini-popup__head">
            <div className="fb-shadow-popup__title">Option</div>
            <IconButton icon={UIIcons.close} title="Close option popup" onClick={() => { setOpenOptionId(null); onCommit?.(); }} />
          </div>
          <div className="fb-shadow-popup__body fb-form-mini-popup__body">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Value</span>
              <input
                className="fb-prop-input"
                type="text"
                value={activeOption.value}
                onChange={(event) => updateOption(activeIndex, 'value', event.target.value)}
                onBlur={onCommit}
                placeholder="option-value"
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Title</span>
              <input
                className="fb-prop-input"
                type="text"
                value={activeOption.label}
                onChange={(event) => updateOption(activeIndex, 'label', event.target.value)}
                onBlur={onCommit}
                placeholder="Option title"
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Enabled</span>
              <ChoiceGroup
                value={activeOption.enabled === false ? 'no' : 'yes'}
                onChange={(nextValue) => {
                  updateOption(activeIndex, 'enabled', nextValue === 'yes');
                  onCommit?.();
                }}
                options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Default</span>
              <ChoiceGroup
                value={defaultValue === activeOption.value ? 'yes' : 'no'}
                onChange={(nextValue) => {
                  onDefaultChange?.(nextValue === 'yes' ? activeOption.value : '');
                  onCommit?.();
                }}
                options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
              />
            </div>
          </div>
        </AnchoredPanelPopup>
      ) : null}
    </div>
  );
}

function getTransformMode(rotationX, rotationY) {
  return Math.abs(normalizeFiniteNumber(rotationX, 0)) > 0.01 || Math.abs(normalizeFiniteNumber(rotationY, 0)) > 0.01 ? '3d' : '2d';
}

function VariableBindingButton({ variables, binding, onSelect, onRemove, title = 'Bind variable', extraActions = [] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="fb-binding-btn-wrap" ref={rootRef}>
      <button
        type="button"
        className={`fb-binding-btn${binding ? ' is-active' : ''}`}
        title={title}
        onClick={() => setOpen((current) => !current)}
      >
        {UIIcons.plusCircle}
      </button>
      {open ? (
        <div className="fb-binding-popover">
          <div className="fb-binding-popover__title">Variable Binding</div>
          {binding ? (
            <button type="button" className="fb-binding-popover__item is-danger" onClick={() => { onRemove(); setOpen(false); }}>
              Remove binding
            </button>
          ) : null}
          {extraActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="fb-binding-popover__item"
              onClick={() => {
                action.onClick?.();
                setOpen(false);
              }}
            >
              <span>{action.label}</span>
              {action.meta ? <span className="fb-binding-popover__meta">{action.meta}</span> : null}
            </button>
          ))}
          {variables.length ? variables.map((variable) => (
            <button
              key={`${variable.scope}:${variable.id}`}
              type="button"
              className={`fb-binding-popover__item${binding?.variableId === variable.id && binding?.scope === variable.scope ? ' is-selected' : ''}`}
              onClick={() => {
                onSelect({ scope: variable.scope, variableId: variable.id });
                setOpen(false);
              }}
            >
              <span>{variable.name}</span>
              <span className="fb-binding-popover__meta">{variable.scope} · {variable.type}</span>
            </button>
          )) : (
            <div className="fb-binding-popover__empty">No compatible variables</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function VariableBindingLabel({ label, children }) {
  return (
    <span className="fb-prop-label fb-prop-label--with-action">
      {children}
      <span>{label}</span>
    </span>
  );
}

function BoundVariableCta({ variable, fallbackLabel = 'Bound variable' }) {
  return (
    <div className="fb-bound-variable-cta">
      <span className="fb-bound-variable-cta__name">{variable?.name || fallbackLabel}</span>
      {variable ? <span className="fb-bound-variable-cta__meta">{variable.scope} · {variable.type}</span> : null}
    </div>
  );
}

function InteractionSection({ flow, legacyInteractions, onOpenFlow, onMigrateLegacy }) {
  const interactionCount = legacyInteractions.length;
  const hasInteractionSetup = !!flow || interactionCount > 0;
  const title = (
    <span className="fb-section-title-with-badge">
      <span>Interactions</span>
      {flow ? <span className="fb-section-badge is-active">Flow</span> : interactionCount ? <span className="fb-section-badge">Legacy</span> : null}
    </span>
  );

  return (
    <Section
      title={title}
      defaultOpen={!!flow || interactionCount > 0}
      action={(
        <HeaderActionButton
          icon={UIIcons.flow}
          title={flow ? 'Edit interaction flow' : 'Add interaction flow'}
          label={flow ? 'Edit Flow' : 'Add Flow'}
          className={hasInteractionSetup ? 'fb-panel-header-action--active' : ''}
          onClick={onOpenFlow}
        />
      )}
    >
      {flow ? (
        <div className="fb-interaction-card is-active">
          <div className="fb-interaction-card__head">
            <div>
              <strong>{flow.name || 'Interaction Flow'}</strong>
              <div className="fb-interaction-card__hint">{Math.max(0, (flow.nodes ?? []).length - 1)} step(s) in a guided action flow.</div>
            </div>
            <span className="fb-interaction-card__status is-active">Flow</span>
          </div>
          <div className="fb-interaction-flow-summary">
            {flow.trigger?.type === 'element-click'
              ? 'Starts on click'
              : flow.trigger?.type === 'form-submit'
                ? 'Starts after form submission'
                : flow.trigger?.type === 'page-load'
                  ? 'Starts on page load'
                  : 'Custom trigger'}
          </div>
        </div>
      ) : interactionCount ? (
        <div className="fb-interaction-card">
          <div className="fb-interaction-card__head">
            <div>
              <strong>Legacy interactions detected</strong>
              <div className="fb-interaction-card__hint">This element still uses the old flat interaction list.</div>
            </div>
            <span className="fb-interaction-card__status">Legacy</span>
          </div>
          <div className="fb-artboard-bp-note" style={{ marginBottom: 10 }}>
            Convert them into a guided flow to continue editing in the new builder.
          </div>
          <button type="button" className="fb-secondary-btn" onClick={onMigrateLegacy}>Convert to Flow</button>
        </div>
      ) : (
        <div className="fb-artboard-bp-note">Create a guided interaction flow for this element.</div>
      )}
    </Section>
  );
}

function MediaPickerModal({ mediaType = 'image', onSelect, onClose }) {
  const adminUrl = window.fbData?.adminUrl ?? '';
  const siteUrl = window.fbData?.siteUrl ?? window.location.origin;
  let src = '';
  try {
    src = new URL(`admin.php?page=fb-media-picker&type=${mediaType === 'video' ? 'video' : 'image'}`, adminUrl || `${siteUrl.replace(/\/$/, '')}/wp-admin/`).toString();
  } catch (error) {
    src = `${siteUrl.replace(/\/$/, '')}/wp-admin/admin.php?page=fb-media-picker&type=${mediaType === 'video' ? 'video' : 'image'}`;
  }

  useEffect(() => {
    const handler = (e) => {
      if (e.data?.fbMediaUrl) {
        onSelect(e.data.fbMediaUrl);
        onClose();
      } else if (e.data?.fbMediaClosed) {
        onClose();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onSelect, onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 920, height: 680, borderRadius: 8, overflow: 'hidden', boxShadow: '0 32px 100px rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', border: '1px solid #3c434a' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', background: '#1d2327', borderBottom: '1px solid #3c434a', flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#f0f0f1', letterSpacing: '0.02em' }}>{mediaType === 'video' ? 'Video Library' : 'Media Library'}</span>
          <IconButton icon={UIIcons.close} title="Close media picker" onMouseDown={onClose} className="fb-media-modal__close" />
        </div>
        <iframe
          src={src}
          style={{ flex: 1, border: 'none', display: 'block', background: '#f0f0f1' }}
          title="Media Library"
          allow="same-origin"
        />
      </div>
    </div>
  );
}

function MediaPickerButton({ value, onChange, mediaType = 'image' }) {
  const [open, setOpen] = useState(false);
  const previewUrl = getMediaUrl(value);
  const isVideo = mediaType === 'video';
  return (
    <>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {previewUrl ? (
          <div style={{ width: 36, height: 36, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
            {isVideo ? (
              <video src={previewUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#111' }} />
            ) : (
              <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>
        ) : null}
        <IconButton
          icon={previewUrl ? UIIcons.swap : UIIcons.image}
          title={previewUrl ? `Change ${isVideo ? 'video' : 'image'}` : `Select ${isVideo ? 'video' : 'image'}`}
          style={{ flex: 1 }}
          onClick={() => setOpen(true)}
        />
        {previewUrl ? (
          <IconButton icon={UIIcons.trash} title={`Remove ${isVideo ? 'video' : 'image'}`} onClick={() => onChange('')} />
        ) : null}
      </div>
      {open && <MediaPickerModal mediaType={mediaType} onSelect={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function normalizeScrollSequenceFrameItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (entry && typeof entry === 'object' && typeof entry.url === 'string') return entry.url.trim();
      return typeof entry === 'string' ? entry.trim() : '';
    });
}

function ScrollSequenceFrameListEditor({ value, sourceMode = 'library', onChange }) {
  const items = normalizeScrollSequenceFrameItems(value);

  const updateItem = (index, nextValue) => {
    const nextItems = [...items];
    const normalizedValue = getMediaUrl(nextValue);
    nextItems[index] = normalizedValue;
    onChange(nextItems.filter(Boolean));
  };

  const removeItem = (index) => {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const addItem = () => {
    onChange([...items, '']);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.length ? items.map((item, index) => (
        <div key={`${sourceMode}-${index}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            {sourceMode === 'library' ? (
              <MediaPickerButton value={item} onChange={(nextValue) => updateItem(index, nextValue)} mediaType="image" />
            ) : (
              <input
                className="fb-prop-input"
                type="url"
                value={item}
                placeholder={`Frame ${index + 1} URL`}
                onChange={(event) => updateItem(index, event.target.value)}
              />
            )}
          </div>
          <IconButton icon={UIIcons.trash} title="Remove frame" onClick={() => removeItem(index)} />
        </div>
      )) : (
        <div className="fb-artboard-bp-note">Add frames in the exact order they should play.</div>
      )}
      <button type="button" className="fb-secondary-btn" onClick={addItem}>Add Frame</button>
    </div>
  );
}

// ── Position panel components ─────────────────────────────────

/** Small number input with right-side label, used in position widget */
function PosInput({ value, label, onChange }) {
  return (
    <div className="fb-pos-input">
      <input
        className="fb-pos-input__val"
        type="number"
        value={Math.round(value * 10) / 10}
        step={1}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
      <span className="fb-pos-input__label">{label}</span>
    </div>
  );
}

function MixedPosInput({ value, label, onCommit, placeholder = 'Mixed' }) {
  const [draft, setDraft] = React.useState(value == null ? '' : formatNumericInputValue(value));
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) setDraft(value == null ? '' : formatNumericInputValue(value));
  }, [focused, value]);

  return (
    <div className="fb-pos-input">
      <input
        className="fb-pos-input__val"
        type="number"
        value={draft}
        step={1}
        placeholder={placeholder}
        onFocus={(event) => {
          setFocused(true);
          event.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          if (draft === '' || draft === '-') {
            setDraft(value == null ? '' : formatNumericInputValue(value));
            return;
          }
          const numericValue = parseFloat(draft);
          if (!Number.isFinite(numericValue)) {
            setDraft(value == null ? '' : formatNumericInputValue(value));
            return;
          }
          onCommit(numericValue);
        }}
        onChange={(event) => setDraft(event.target.value)}
      />
      <span className="fb-pos-input__label">{label}</span>
    </div>
  );
}

/** Visual constraint selector — placed in center of TLRB cross; lines = toggleable pins */
function ConstraintWidget({ constraints, onChange }) {
  const horizontal = getConstraintMode(constraints, 'horizontal');
  const vertical = getConstraintMode(constraints, 'vertical');
  const c = {
    left: horizontal === 'left' || horizontal === 'stretch',
    right: horizontal === 'right' || horizontal === 'stretch',
    top: vertical === 'top' || vertical === 'stretch',
    bottom: vertical === 'bottom' || vertical === 'stretch',
  };
  const applyEdges = (nextEdges) => {
    if (!nextEdges.top && !nextEdges.bottom && !nextEdges.left && !nextEdges.right) return;
    const nextHorizontal = nextEdges.left && nextEdges.right ? 'stretch' : (nextEdges.left ? 'left' : (nextEdges.right ? 'right' : 'center'));
    const nextVertical = nextEdges.top && nextEdges.bottom ? 'stretch' : (nextEdges.top ? 'top' : (nextEdges.bottom ? 'bottom' : 'center'));
    onChange({
      horizontal: nextHorizontal,
      vertical: nextVertical,
      left: nextEdges.left,
      right: nextEdges.right,
      top: nextEdges.top,
      bottom: nextEdges.bottom,
    });
  };
  const toggleLine = (key) => applyEdges({ ...c, [key]: !c[key] });
  return (
    <div className="fb-cw">
      <button type="button" className={`fb-cw-btn fb-cw-btn--top${c.top ? ' active' : ''}`} title="Top" onClick={() => toggleLine('top')} />
      <button type="button" className={`fb-cw-btn fb-cw-btn--right${c.right ? ' active' : ''}`} title="Right" onClick={() => toggleLine('right')} />
      <button type="button" className={`fb-cw-btn fb-cw-btn--bottom${c.bottom ? ' active' : ''}`} title="Bottom" onClick={() => toggleLine('bottom')} />
      <button type="button" className={`fb-cw-btn fb-cw-btn--left${c.left ? ' active' : ''}`} title="Left" onClick={() => toggleLine('left')} />
      <div className="fb-cw-inner" />
    </div>
  );
}

function getConstraintMode(constraints, axis = 'horizontal') {
  const raw = constraints && typeof constraints === 'object' ? constraints : {};
  if (axis === 'horizontal') {
    if (typeof raw.horizontal === 'string') return raw.horizontal;
    if (raw.left && raw.right) return 'stretch';
    if (raw.right && !raw.left) return 'right';
    return 'left';
  }
  if (typeof raw.vertical === 'string') return raw.vertical;
  if (raw.top && raw.bottom) return 'stretch';
  if (raw.bottom && !raw.top) return 'bottom';
  return 'top';
}

/** Expandable min/max width/height section */
function MinMaxRow({ resolved, upd, commit }) {
  const [open, setOpen] = useState(false);
  const hasAny = (resolved.minW != null && resolved.minW !== 0) || (resolved.maxW != null && resolved.maxW !== 0)
               || (resolved.minH != null && resolved.minH !== 0) || (resolved.maxH != null && resolved.maxH !== 0);
  return (
    <div className="fb-minmax">
      <div className="fb-minmax__trigger" onClick={() => setOpen(o => !o)}>
        <span className="fb-minmax__icon">↔</span>
        <span className="fb-minmax__label">Min Max</span>
        {hasAny && <span className="fb-minmax__badge" />}
        <span style={{ marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="fb-minmax__body">
          <div className="fb-quad" style={{ marginTop: 4 }}>
            <NullableNumberInput value={resolved.minW} placeholder="—" label="Min W" onChange={v => { upd('minW', v); commit(); }} />
            <NullableNumberInput value={resolved.maxW} placeholder="—" label="Max W" onChange={v => { upd('maxW', v); commit(); }} />
          </div>
          <div className="fb-quad" style={{ marginTop: 4 }}>
            <NullableNumberInput value={resolved.minH} placeholder="—" label="Min H" onChange={v => { upd('minH', v); commit(); }} />
            <NullableNumberInput value={resolved.maxH} placeholder="—" label="Max H" onChange={v => { upd('maxH', v); commit(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function getResolvedSelectionPositionMode(selected, resolved, pageLayout) {
  const positionType = resolved.positionType ?? 'absolute';
  const isFixed = positionType === 'fixed';
  if (!selected?.parentId && pageLayout !== null && !resolved.absoluteInLayout && !isFixed) {
    return positionType === 'sticky' ? 'sticky' : 'relative';
  }
  return positionType;
}

// ── rgba ↔ hex helpers ────────────────────────────────────────

function rgbaToHex(color) {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(color) {
  const normalized = `${color ?? ''}`.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function clampShadowValue(value, fallback, min = -Infinity, max = Infinity) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function roundShadowValue(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function splitShadowLayers(value) {
  const layers = [];
  let depth = 0;
  let current = '';
  for (const char of `${value ?? ''}`) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      if (current.trim()) layers.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

function getShadowColorOpacity(color) {
  if (!color) return 1;
  if (color.startsWith('rgba(')) {
    const match = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/i);
    return match ? clampShadowValue(match[1], 1, 0, 1) : 1;
  }
  if (color.startsWith('#') && color.length === 9) {
    return clampShadowValue(parseInt(color.slice(7, 9), 16) / 255, 1, 0, 1);
  }
  return 1;
}

function parseSingleShadow(shadowValue) {
  const raw = `${shadowValue ?? ''}`.trim();
  if (!raw) {
    return {
      position: 'outside',
      color: '#000000',
      opacity: 0.25,
      x: 0,
      y: 4,
      blur: 16,
      spread: 0,
    };
  }

  const position = /\binset\b/i.test(raw) ? 'inside' : 'outside';
  const colorMatch = raw.match(/(rgba?\([^\)]+\)|#[0-9a-fA-F]{6,8}|[a-zA-Z]+)$/);
  const colorToken = colorMatch ? colorMatch[1] : 'rgba(0,0,0,0.25)';
  const numericSource = raw
    .replace(/\binset\b/i, '')
    .replace(colorToken, '')
    .trim();
  const numbers = numericSource.split(/\s+/).map((part) => clampShadowValue(part.replace('px', ''), 0));

  return {
    position,
    color: rgbaToHex(colorToken),
    opacity: getShadowColorOpacity(colorToken),
    x: numbers[0] ?? 0,
    y: numbers[1] ?? 4,
    blur: Math.max(0, numbers[2] ?? 16),
    spread: numbers[3] ?? 0,
  };
}

function buildShadowColor(color, opacity) {
  const rgb = hexToRgb(rgbaToHex(color ?? '#000000'));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${roundShadowValue(clampShadowValue(opacity, 1, 0, 1), 3)})`;
}

function getShadowDraftFromStyles(styles, prefix = '') {
  const boxShadow = typeof styles?.[getShadowStyleKey(prefix, 'boxShadow')] === 'string' ? styles[getShadowStyleKey(prefix, 'boxShadow')].trim() : '';
  const parsed = parseSingleShadow(splitShadowLayers(boxShadow)[0] || '');
  const type = styles?.[getShadowStyleKey(prefix, 'shadowType')] === 'realistic' ? 'realistic' : 'drop';

  return {
    enabled: !!boxShadow,
    type,
    position: styles?.[getShadowStyleKey(prefix, 'shadowPosition')] === 'inside' ? 'inside' : parsed.position,
    color: typeof styles?.[getShadowStyleKey(prefix, 'shadowColor')] === 'string' && styles[getShadowStyleKey(prefix, 'shadowColor')] ? rgbaToHex(styles[getShadowStyleKey(prefix, 'shadowColor')]) : parsed.color,
    opacity: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowOpacity')], parsed.opacity, 0, 1),
    x: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowX')], parsed.x, -9999, 9999),
    y: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowY')], parsed.y, -9999, 9999),
    blur: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowBlur')], parsed.blur, 0, 9999),
    spread: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowSpread')], parsed.spread, -9999, 9999),
    diffusion: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowDiffusion')], 0.25, 0, 1),
    focus: clampShadowValue(styles?.[getShadowStyleKey(prefix, 'shadowFocus')], 0.5, 0, 1),
  };
}

function buildShadowCss(draft) {
  if (!draft?.enabled) return '';

  const inset = draft.position === 'inside' ? 'inset ' : '';
  const x = roundShadowValue(draft.x, 2);
  const y = roundShadowValue(draft.y, 2);

  if (draft.type === 'realistic') {
    const diffusion = clampShadowValue(draft.diffusion, 0.25, 0, 1);
    const focus = clampShadowValue(draft.focus, 0.5, 0, 1);
    const ambientBlur = Math.round(10 + diffusion * 54);
    const ambientSpread = Math.round(-6 + focus * 14);
    const coreBlur = Math.round(Math.max(0, ambientBlur * (0.16 + (1 - focus) * 0.22)));
    const coreSpread = Math.round(-3 + focus * 10);
    const ambientColor = buildShadowColor(draft.color, draft.opacity * (0.32 + diffusion * 0.28));
    const coreColor = buildShadowColor(draft.color, draft.opacity * (0.22 + focus * 0.58));

    return `${inset}${x}px ${y}px ${coreBlur}px ${coreSpread}px ${coreColor}, ${inset}${x}px ${y}px ${ambientBlur}px ${ambientSpread}px ${ambientColor}`;
  }

  return `${inset}${x}px ${y}px ${Math.max(0, roundShadowValue(draft.blur, 2))}px ${roundShadowValue(draft.spread, 2)}px ${buildShadowColor(draft.color, draft.opacity)}`;
}

function buildShadowStylePayload(draft, prefix = '') {
  if (!draft?.enabled) {
    return {
      [getShadowStyleKey(prefix, 'boxShadow')]: '',
      [getShadowStyleKey(prefix, 'shadowType')]: null,
      [getShadowStyleKey(prefix, 'shadowPosition')]: null,
      [getShadowStyleKey(prefix, 'shadowColor')]: null,
      [getShadowStyleKey(prefix, 'shadowOpacity')]: null,
      [getShadowStyleKey(prefix, 'shadowX')]: null,
      [getShadowStyleKey(prefix, 'shadowY')]: null,
      [getShadowStyleKey(prefix, 'shadowBlur')]: null,
      [getShadowStyleKey(prefix, 'shadowSpread')]: null,
      [getShadowStyleKey(prefix, 'shadowDiffusion')]: null,
      [getShadowStyleKey(prefix, 'shadowFocus')]: null,
    };
  }

  return {
    [getShadowStyleKey(prefix, 'boxShadow')]: buildShadowCss(draft),
    [getShadowStyleKey(prefix, 'shadowType')]: draft.type,
    [getShadowStyleKey(prefix, 'shadowPosition')]: draft.position,
    [getShadowStyleKey(prefix, 'shadowColor')]: rgbaToHex(draft.color),
    [getShadowStyleKey(prefix, 'shadowOpacity')]: clampShadowValue(draft.opacity, 0.25, 0, 1),
    [getShadowStyleKey(prefix, 'shadowX')]: clampShadowValue(draft.x, 0, -9999, 9999),
    [getShadowStyleKey(prefix, 'shadowY')]: clampShadowValue(draft.y, 0, -9999, 9999),
    [getShadowStyleKey(prefix, 'shadowBlur')]: clampShadowValue(draft.blur, 16, 0, 9999),
    [getShadowStyleKey(prefix, 'shadowSpread')]: clampShadowValue(draft.spread, 0, -9999, 9999),
    [getShadowStyleKey(prefix, 'shadowDiffusion')]: clampShadowValue(draft.diffusion, 0.25, 0, 1),
    [getShadowStyleKey(prefix, 'shadowFocus')]: clampShadowValue(draft.focus, 0.5, 0, 1),
  };
}

function getShadowSummary(styles, prefix = '') {
  const draft = getShadowDraftFromStyles(styles, prefix);
  if (!draft.enabled) return 'No shadow';
  return `${draft.type === 'realistic' ? 'Realistic' : 'Drop'} · ${draft.position === 'inside' ? 'Inside' : 'Outside'}`;
}

function getTransitionTypeLabel(type) {
  if (type === 'realistic') return 'Realistic';
  if (type === 'ease') return 'Ease';
  return 'Instant';
}

const TRANSITION_CLIPBOARD_KEY = 'fb:transition-clipboard';
const ANIMATION_CLIPBOARD_KEY = 'fb:animation-clipboard';

function readStoredTransitionClipboard() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(TRANSITION_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.transition) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeStoredTransitionClipboard(payload) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(TRANSITION_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch (error) {
    return;
  }
}

function readStoredAnimationClipboard() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ANIMATION_CLIPBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.animation || typeof parsed.animation !== 'object') return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeStoredAnimationClipboard(payload) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(ANIMATION_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch (error) {
    return;
  }
}

function getTransitionSummary(interaction) {
  if (!interaction?.targetVariantId) return 'No transition';
  const transition = interaction.transition ?? { type: 'instant' };
  if (transition.type === 'instant') return 'Instant';
  if (transition.type === 'ease') return `${getTransitionTypeLabel(transition.type)} · ${Math.round((transition.duration ?? 0.3) * 10) / 10}s`;
  return transition.springMode === 'physics'
    ? `Realistic · Physics · ${Math.round((transition.physicsDuration ?? transition.duration ?? 0.3) * 10) / 10}s`
    : `Realistic · ${Math.round((transition.duration ?? 0.3) * 10) / 10}s`;
}

function getElementAnimationTypeLabel(type) {
  if (type === 'scroll') return 'Scroll';
  if (type === 'loop') return 'Loop';
  if (type === 'hover') return 'Hover';
  if (type === 'scroll-variant') return 'Scroll variant';
  return 'Appear';
}

function summarizeLoopEffect(effect) {
  if (!effect) return '';
  const parts = [];
  if ((effect.offsetY ?? 0) !== 0) parts.push(`Y ${Math.round(effect.offsetY)}px`);
  if ((effect.offsetX ?? 0) !== 0) parts.push(`X ${Math.round(effect.offsetX)}px`);
  if ((effect.opacity ?? 1) !== 1) parts.push(`Opacity ${Math.round((effect.opacity ?? 1) * 100)}%`);
  if ((effect.scale ?? 1) !== 1) parts.push(`Scale ${Math.round((effect.scale ?? 1) * 100)}%`);
  if ((effect.rotateMode === '3d'
    ? (effect.rotateX ?? 0) || (effect.rotateY ?? 0) || (effect.rotate ?? 0)
    : (effect.rotate ?? 0)) !== 0) parts.push('Rotate');
  return parts.join(' · ');
}

function getElementAnimationSummary(animation, variantOptions = []) {
  if (!animation) return '';
  if (animation.type === 'enter') {
    return animation.preset === 'custom' ? 'Custom enter effect' : `${animation.preset || 'fadeUp'}`;
  }
  if (animation.type === 'scroll') {
    return `Start ${Math.round((animation.start ?? 0) * 100)}% · End ${Math.round((animation.end ?? 0) * 100)}%`;
  }
  if (animation.type === 'loop') {
    const modeLabel = animation.loopType === 'mirror' ? 'Mirror' : 'Loop';
    const effectSummary = summarizeLoopEffect(animation.effect);
    const parts = [modeLabel];
    if (animation.delay > 0) parts.push(`${Math.round((animation.delay ?? 0) * 10) / 10}s delay`);
    if (effectSummary) parts.push(effectSummary);
    return parts.join(' · ');
  }
  if (animation.type === 'hover') {
    const effectSummary = summarizeLoopEffect(animation.effect);
    return effectSummary ? `Hover state · ${effectSummary}` : 'Hover state';
  }
  const targets = Array.isArray(animation.targets) ? animation.targets : [];
  if (!targets.length) return 'Add variant triggers';
  const firstTarget = variantOptions.find((option) => option.value === targets[0]?.targetVariantId) ?? null;
  if (targets.length === 1) {
    return firstTarget ? `${firstTarget.label} · ${Math.round((targets[0]?.marker ?? 0) * 100)}%` : 'Select target variant';
  }
  return `${targets.length} markers${firstTarget ? ` · starts ${firstTarget.label}` : ''}`;
}

function isDefaultVariant(variant) {
  return (variant?.mode ?? 'default') === 'default';
}

function getVariantLabel(variants, variant) {
  if (!variant) return 'Primary';
  if (isDefaultVariant(variant)) return variant.name || 'Primary';
  const parent = (variants ?? []).find((entry) => entry.id === variant.parentVariantId) ?? null;
  const stateName = variant.mode === 'hover' ? 'Hover' : 'Pressed';
  return `${parent?.name || 'Variant'} · ${stateName}`;
}

const COMPONENT_CONTROL_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
  { value: 'color', label: 'Color' },
  { value: 'image', label: 'Image URL' },
  { value: 'url', label: 'URL' },
];

function getComponentControlDefaultValue(type, options = []) {
  if (type === 'boolean') return false;
  if (type === 'number') return 0;
  if (type === 'color') return '#000000';
  if (type === 'select') return options[0]?.value ?? '';
  return '';
}

function getComponentControlTypeForProperty(property) {
  if (property === 'hidden') return 'boolean';
  if (property === 'src' || property === 'linkUrl' || property === 'styles.backgroundImage') return 'url';
  if (property === 'styles.fontFamily') return 'text';
  if (property === 'styles.backgroundColor' || property === 'styles.color') return 'color';
  if (property === 'styles.borderRadius' || property === 'styles.borderWidth' || property === 'styles.opacity' || property === 'styles.zIndex') return 'number';
  return 'text';
}

function getComponentControlPropertyOptions(element) {
  if (!element) return [];
  const options = [];
  const hasText = typeof element.base?.text === 'string' || typeof element.base?.richTextHtml === 'string';
  const hasSource = Object.prototype.hasOwnProperty.call(element.base ?? {}, 'src');

  if (hasText) options.push({ value: 'text', label: 'Text content' });
  if (hasSource) options.push({ value: 'src', label: 'Source URL' });
  options.push({ value: 'hidden', label: 'Hidden' });
  options.push({ value: 'styles.backgroundColor', label: 'Background color' });
  options.push({ value: 'styles.color', label: 'Text/Icon color' });
  options.push({ value: 'styles.borderRadius', label: 'Border radius' });
  options.push({ value: 'styles.borderWidth', label: 'Border width' });
  options.push({ value: 'styles.opacity', label: 'Opacity' });

  return options.filter((option, index, allOptions) => allOptions.findIndex((candidate) => candidate.value === option.value) === index);
}

function formatComponentControlOptionsText(options = []) {
  return (options ?? []).map((option) => {
    if (!option) return '';
    if (option.label && option.label !== option.value) return `${option.label}|${option.value}`;
    return option.value ?? '';
  }).join('\n');
}

function parseComponentControlOptionsText(text) {
  return `${text ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawLabel, rawValue] = line.includes('|') ? line.split('|') : [line, line];
      const label = `${rawLabel ?? ''}`.trim();
      const value = `${rawValue ?? rawLabel ?? ''}`.trim();
      return { label: label || value, value: value || label };
    })
    .filter((option) => option.value);
}

function getComponentControlEffectiveValue(control, props = {}) {
  return Object.prototype.hasOwnProperty.call(props, control.id)
    ? props[control.id]
    : control.defaultValue;
}

function getComponentVariableDisplayLabel(control) {
  const preferredName = typeof control?.name === 'string' ? control.name.trim() : '';
  const fallbackLabel = typeof control?.label === 'string' ? control.label.trim() : '';
  return preferredName || fallbackLabel || 'variable';
}

// ── Reset override button ───────────────────────────────────────
function ResetBtn({ show, onReset }) {
  if (!show) return null;
  return (
    <button
      className="fb-reset-btn"
      title="Reset override"
      onClick={e => { e.stopPropagation(); e.preventDefault(); onReset(); }}
    >
      <span className="fb-reset-btn__icon">{UIIcons.inherit}</span>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────

export default function PropertiesPanel() {
  const [transitionModalState, setTransitionModalState] = useState(null);
  const [transitionContextMenu, setTransitionContextMenu] = useState(null);
  const [hasStoredTransitionClipboard, setHasStoredTransitionClipboard] = useState(() => !!readStoredTransitionClipboard());
  const [animationCardContextMenu, setAnimationCardContextMenu] = useState(null);
  const [hasStoredAnimationClipboard, setHasStoredAnimationClipboard] = useState(() => !!readStoredAnimationClipboard());
  const [elementAnimationModalState, setElementAnimationModalState] = useState(null);
  const [animationAddMenuOpen, setAnimationAddMenuOpen] = useState(false);
  const [shadowModalOpen, setShadowModalOpen] = useState(false);
  const animationPasteTargetRef = useRef(null);
  const selectedPanelRef = useRef(null);
  const fontPreviewSnapshotRef = useRef(null);
  const shadowTriggerRef = useRef(null);
  const shadowDraftDirtyRef = useRef(false);
  const animationDraftDirtyRef = useRef(false);
  const selection           = useEditorStore(s => s.selection);
  const activeSurface       = useEditorStore(s => s.activeSurface);
  const componentEditor     = useEditorStore(s => s.componentEditor);
  const element             = useEditorStore(s => s.getSelectedElement());
  const globalVariables     = useEditorStore(s => s.globalVariables);
  const components          = useEditorStore(s => s.components);
  const changeComponentInstanceVariant = useEditorStore(s => s.changeComponentInstanceVariant);
  const updateComponentInstanceProp = useEditorStore(s => s.updateComponentInstanceProp);
  const setComponentInstancePropBinding = useEditorStore(s => s.setComponentInstancePropBinding);
  const updateComponentEditorVariantInteraction = useEditorStore(s => s.updateComponentEditorVariantInteraction);
  const updateComponentEditorElementInteraction = useEditorStore(s => s.updateComponentEditorElementInteraction);
  const updateComponentEditorVariantChildTransition = useEditorStore(s => s.updateComponentEditorVariantChildTransition);
  const bindComponentEditorControlToProperty = useEditorStore(s => s.bindComponentEditorControlToProperty);
  const clearComponentEditorControlBinding = useEditorStore(s => s.clearComponentEditorControlBinding);
  const updateEditingComponentMeta = useEditorStore(s => s.updateEditingComponentMeta);
  const activeVectorPoint   = useEditorStore(s => s.activeVectorPoint);
  const setActiveVectorPoint = useEditorStore(s => s.setActiveVectorPoint);
  const clearActiveVectorPoint = useEditorStore(s => s.clearActiveVectorPoint);
  const updateElementLayout = useEditorStore(s => s.updateElementLayout);
  const updateElementsLayout = useEditorStore(s => s.updateElementsLayout);
  const updateElementBase = useEditorStore(s => s.updateElementBase);
  const updateStyles        = useEditorStore(s => s.updateElementStyles);
  const updateElementsStyles = useEditorStore(s => s.updateElementsStyles);
  const pushHistory         = useEditorStore(s => s.pushHistory);
  const deleteElement       = useEditorStore(s => s.deleteElement);
  const deleteElements      = useEditorStore(s => s.deleteElements);
  const variableSources     = useEditorStore(s => s.variableSources);
  const getCompatibleVariables = useEditorStore(s => s.getCompatibleVariables);
  const getElementPropertyBinding = useEditorStore(s => s.getElementPropertyBinding);
  const setElementPropertyBinding = useEditorStore(s => s.setElementPropertyBinding);
  const setElementInteractions = useEditorStore(s => s.setElementInteractions);
  const openFlowEditor = useEditorStore(s => s.openFlowEditor);
  const ensureElementFlow = useEditorStore(s => s.ensureElementFlow);
  const migrateLegacyElementInteractionsToFlow = useEditorStore(s => s.migrateLegacyElementInteractionsToFlow);
  const allEls              = useEditorStore(s => s.getAllElements());
  const viewportScale       = useEditorStore(s => s.viewport.scale);
  const openIconLibraryModal = useEditorStore(s => s.openIconLibraryModal);
  const openAssetStorage = useEditorStore(s => s.openAssetStorage);
  const colorStyles = useEditorStore(s => s.colorStyles);
  const saveColorStyles = useEditorStore(s => s.saveColorStyles);
  const textStyles = useEditorStore(s => s.textStyles);
  const saveTextStyles = useEditorStore(s => s.saveTextStyles);
  const elementStyles = useEditorStore(s => s.elementStyles);
  const saveElementStyles = useEditorStore(s => s.saveElementStyles);
  const addElementAnimation = useEditorStore(s => s.addElementAnimation);
  const updateElementAnimation = useEditorStore(s => s.updateElementAnimation);
  const removeElementAnimation = useEditorStore(s => s.removeElementAnimation);
  const openAnimationEditor = useEditorStore(s => s.openAnimationEditor);
  const closeAnimationEditor = useEditorStore(s => s.closeAnimationEditor);
  const loopAnimationPreview = useEditorStore(s => s.loopAnimationPreview);
  const hoverAnimationPreview = useEditorStore(s => s.hoverAnimationPreview);
  const openLoopAnimationPreview = useEditorStore(s => s.openLoopAnimationPreview);
  const closeLoopAnimationPreview = useEditorStore(s => s.closeLoopAnimationPreview);
  const openHoverAnimationPreview = useEditorStore(s => s.openHoverAnimationPreview);
  const closeHoverAnimationPreview = useEditorStore(s => s.closeHoverAnimationPreview);
  const openScrollSequenceRangeEditor = useEditorStore(s => s.openScrollSequenceRangeEditor);

  useEffect(() => {
    if (!transitionContextMenu && !animationCardContextMenu) return undefined;
    const handleDismiss = () => {
      setTransitionContextMenu(null);
      setAnimationCardContextMenu(null);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setTransitionContextMenu(null);
        setAnimationCardContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handleDismiss);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handleDismiss);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [animationCardContextMenu, transitionContextMenu]);
  const closeScrollSequenceRangeEditor = useEditorStore(s => s.closeScrollSequenceRangeEditor);

  const selectedLoopAnimationId = useMemo(() => {
    if (!elementAnimationModalState?.animationId || !element || !selection) return null;
    const currentBpId = selection.bpId || 'desktop';
    return resolveElementAnimations(element, currentBpId)
      .find((entry) => entry.id === elementAnimationModalState.animationId && entry.type === 'loop')?.id ?? null;
  }, [element, elementAnimationModalState?.animationId, selection]);

  const selectedHoverAnimationId = useMemo(() => {
    if (!elementAnimationModalState?.animationId || !element || !selection) return null;
    const currentBpId = selection.bpId || 'desktop';
    return resolveElementAnimations(element, currentBpId)
      .find((entry) => entry.id === elementAnimationModalState.animationId && entry.type === 'hover')?.id ?? null;
  }, [element, elementAnimationModalState?.animationId, selection]);

  const selectedAnimationStillExists = useMemo(() => {
    if (!elementAnimationModalState?.animationId || !element || !selection) return false;
    return resolveElementAnimations(element, selection.bpId || 'desktop')
      .some((entry) => entry.id === elementAnimationModalState.animationId);
  }, [element, elementAnimationModalState?.animationId, selection]);

  useEffect(() => {
    if (!elementAnimationModalState) return;
    if (selectedAnimationStillExists) return;
    setElementAnimationModalState(null);
    closeAnimationEditor();
    closeScrollSequenceRangeEditor();
  }, [
    closeAnimationEditor,
    closeScrollSequenceRangeEditor,
    elementAnimationModalState,
    selectedAnimationStillExists,
  ]);

  useEffect(() => {
    if (!selectedLoopAnimationId || !element || !selection) {
      closeLoopAnimationPreview();
      return undefined;
    }
    openLoopAnimationPreview({
      elementId: element.id,
      bpId: selection.bpId || 'desktop',
      animationId: selectedLoopAnimationId,
    });
    return () => {
      closeLoopAnimationPreview();
    };
  }, [closeLoopAnimationPreview, element, openLoopAnimationPreview, selectedLoopAnimationId, selection]);

  useEffect(() => {
    if (!selectedHoverAnimationId || !element || !selection) {
      closeHoverAnimationPreview();
      return undefined;
    }
    openHoverAnimationPreview({
      elementId: element.id,
      bpId: selection.bpId || 'desktop',
      animationId: selectedHoverAnimationId,
    });
    return () => {
      closeHoverAnimationPreview();
    };
  }, [closeHoverAnimationPreview, element, openHoverAnimationPreview, selectedHoverAnimationId, selection]);

  useEffect(() => {
    if (!animationAddMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (animationPasteTargetRef.current?.contains(event.target)) return;
      setAnimationAddMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [animationAddMenuOpen]);

  // Artboard selection
  const artboardSel         = useEditorStore(s => s.artboardSel);
  const bpDefs              = useEditorStore(s => s.breakpointDefs);
  const updateBreakpointDef    = useEditorStore(s => s.updateBreakpointDef);
  const setPageBackground       = useEditorStore(s => s.setPageBackground);
  const setPageSmoothScroll     = useEditorStore(s => s.setPageSmoothScroll);
  const setPagePadding          = useEditorStore(s => s.setPagePadding);
  const setPageLayout           = useEditorStore(s => s.setPageLayout);
  const page                    = useEditorStore(s => s.getCurrentPage());
  const pageVariables           = Array.isArray(page?.variables) ? page.variables : [];
  const pageFlows               = Array.isArray(page?.flows) ? page.flows : [];
  // Remembers the last active layout per artboard bp before it was turned off,
  // so toggling back on restores gap/direction/etc. instead of resetting to defaults.
  const savedLayoutRef          = useRef({});
  const removeOverrideFn        = useEditorStore(s => s.removeOverride);
  const removeStyleOverrideFn   = useEditorStore(s => s.removeStyleOverride);
  const currentSelectionBpId = selection?.bpId || 'desktop';
  const selectionIds = getSelectionElementIds(selection);
  const selectedComponentMeta = activeSurface === 'page' && element?.componentInstance?.componentId
    ? components.find((component) => component.id === element.componentInstance?.componentId)
    : null;
  const selectedElements = selectionIds.length
    ? selectionIds.map((id) => allEls.find((candidate) => candidate.id === id)).filter(Boolean)
    : [];
  const selectedComponentVariants = selectedComponentMeta?.variants ?? [];
  const hasSelectedComponentInstance = !!element?.componentInstance;
  const selectedElementId = element?.id ?? null;
  const selectedInstanceVariantId = element?.componentInstance?.variantId ?? null;
  const normalizedSelectedVariantId = selectedComponentVariants.some((variant) => variant.id === element?.componentInstance?.variantId)
    ? element?.componentInstance?.variantId
    : selectedComponentMeta?.defaultVariantId ?? selectedComponentVariants[0]?.id ?? '';
  const getLoopVariablesForElement = (targetElement) => getLoopItemPreviewVariables(targetElement, allEls, variableSources, pageVariables, globalVariables);
  const hasMultiSelection = selectionIds.length > 1;
  const multiSelectionHas3DRotation = useMemo(() => (
    hasMultiSelection
      ? selectedElements.some((selected) => {
          const resolvedSelected = resolveElementWithVariables(selected, currentSelectionBpId, pageVariables, globalVariables, getLoopVariablesForElement(selected));
          return getTransformMode(resolvedSelected.rotationX ?? 0, resolvedSelected.rotationY ?? 0) === '3d';
        })
      : false
  ), [currentSelectionBpId, globalVariables, hasMultiSelection, pageVariables, selectedElements, allEls, variableSources]);
  const singleSelectionHas3DRotation = useMemo(() => (
    !hasMultiSelection && element
      ? getTransformMode(
          resolveElementWithVariables(element, currentSelectionBpId, pageVariables, globalVariables, getLoopVariablesForElement(element)).rotationX ?? 0,
          resolveElementWithVariables(element, currentSelectionBpId, pageVariables, globalVariables, getLoopVariablesForElement(element)).rotationY ?? 0,
        ) === '3d'
      : false
  ), [currentSelectionBpId, element, globalVariables, hasMultiSelection, pageVariables, allEls, variableSources]);
  const [multiTransformMode, setMultiTransformMode] = useState(multiSelectionHas3DRotation ? '3d' : '2d');
  const [singleTransformMode, setSingleTransformMode] = useState(singleSelectionHas3DRotation ? '3d' : '2d');
  const loopItemVariables = element ? getLoopVariablesForElement(element) : [];
  const allVariables = [...pageVariables, ...globalVariables, ...loopItemVariables];
  const variableLookup = new Map(allVariables.map((variable) => [`${variable.scope}:${variable.id}`, variable]));
  const componentSourceLabelMap = useMemo(() => {
    const map = new Map();
    if (activeSurface !== 'component') return map;
    (componentEditor.page?.elements ?? []).forEach((entry) => {
      const sourceId = entry.componentSourceId ?? entry.id;
      if (!sourceId || map.has(sourceId)) return;
      map.set(sourceId, entry.name || entry.type || 'Element');
    });
    return map;
  }, [activeSurface, componentEditor.page?.elements]);

  useEffect(() => {
    if (!hasMultiSelection) return;
    setMultiTransformMode(multiSelectionHas3DRotation ? '3d' : '2d');
  }, [hasMultiSelection, multiSelectionHas3DRotation, selectionIds.join('|')]);

  useEffect(() => {
    if (hasMultiSelection) return;
    setSingleTransformMode(singleSelectionHas3DRotation ? '3d' : '2d');
  }, [hasMultiSelection, selectedElementId, singleSelectionHas3DRotation]);

  const captureFontPreviewSnapshot = (elementIds, currentBpId) => {
    if (fontPreviewSnapshotRef.current) return;
    const snapshots = (elementIds ?? [])
      .map((id) => {
        const target = allEls.find((candidate) => candidate.id === id);
        if (!target) return null;
        if (currentBpId === 'desktop') {
          return {
            id,
            hasExplicit: true,
            value: target.base?.styles?.fontFamily ?? 'Inter',
            bpId: currentBpId,
          };
        }
        const overrideStyles = target.overrides?.[currentBpId]?.styles ?? {};
        return {
          id,
          hasExplicit: Object.prototype.hasOwnProperty.call(overrideStyles, 'fontFamily'),
          value: overrideStyles.fontFamily ?? null,
          bpId: currentBpId,
        };
      })
      .filter(Boolean);
    if (!snapshots.length) return;
    fontPreviewSnapshotRef.current = snapshots;
  };

  const resetFontPreview = () => {
    const snapshot = fontPreviewSnapshotRef.current;
    if (!snapshot?.length) return;
    snapshot.forEach((entry) => {
      if (entry.bpId === 'desktop' || entry.hasExplicit) updateStyles(entry.id, entry.bpId, { fontFamily: entry.value || 'Inter' });
      else removeStyleOverrideFn(entry.id, entry.bpId, 'fontFamily');
    });
    fontPreviewSnapshotRef.current = null;
  };

  const previewFontFamily = (elementIds, currentBpId, family) => {
    if (!family) return;
    captureFontPreviewSnapshot(elementIds, currentBpId);
    updateElementsStyles(elementIds, currentBpId, { fontFamily: family });
  };

  const commitFontFamily = (elementIds, currentBpId, family) => {
    fontPreviewSnapshotRef.current = null;
    updateElementsStyles(elementIds, currentBpId, { fontFamily: family });
    pushHistory();
  };

  useEffect(() => () => resetFontPreview(), []);
  useEffect(() => () => {
    closeAnimationEditor();
    closeScrollSequenceRangeEditor();
  }, [closeAnimationEditor, closeScrollSequenceRangeEditor]);

  const resolveBoundVariable = (binding) => binding ? (variableLookup.get(`${binding.scope}:${binding.variableId}`) ?? null) : null;
  const getBindingForProperty = (propertyKey) => element ? getElementPropertyBinding(element.id, selection?.bpId || 'desktop', propertyKey) : null;
  const getCompatibleBindingVariables = (propertyKey) => {
    const compatible = getCompatibleVariables(propertyKey, loopItemVariables);
    if (propertyKey === 'styles.backgroundImage') {
      return compatible.filter((variable) => variable.scope !== 'loop-item');
    }
    return compatible;
  };
  const getCompatibleVariablesForComponentControl = (control) => {
    if (!control) return [];
    const hasVariantBinding = (control.bindings ?? []).some((binding) => binding.property === 'variant');
    const supportedTypes = hasVariantBinding
      ? ['string']
      : control.type === 'boolean'
        ? ['boolean']
        : control.type === 'color'
          ? ['color']
          : control.type === 'number'
            ? ['number']
            : control.type === 'image'
              ? ['image', 'string']
              : ['string', 'number'];
    return allVariables.filter((variable) => variable.scope !== 'loop-item' && supportedTypes.includes(variable.type));
  };
  const commitBinding = (propertyKey, binding, applyValue) => {
    if (!element || !selection) return;
    setElementPropertyBinding(element.id, selection.bpId || 'desktop', propertyKey, binding);
    const variable = resolveBoundVariable(binding);
    if (variable && typeof applyValue === 'function') applyValue(variable.value);
    pushHistory();
  };
  const isComponentBindingTypeCompatible = (control, propertyKey) => {
    const expectedType = getComponentControlTypeForProperty(propertyKey);
    if (!control) return false;
    if (expectedType === 'text') return control.type === 'text' || control.type === 'textarea';
    if (expectedType === 'url') return control.type === 'url' || control.type === 'image' || control.type === 'text';
    return control.type === expectedType;
  };
  const getBoundComponentControl = (propertyKey) => {
    if (activeSurface !== 'component' || !componentControlTargetId) return null;
    return (componentEditor.controls ?? []).find((control) => (
      (control.bindings ?? []).some((binding) => binding.elementId === componentControlTargetId && binding.property === propertyKey)
    )) ?? null;
  };
  const getCompatibleComponentControlVariables = (propertyKey) => {
    if (activeSurface !== 'component') return [];
    return (componentEditor.controls ?? [])
      .filter((control) => isComponentBindingTypeCompatible(control, propertyKey))
      .map((control) => ({
        scope: 'component',
        id: control.id,
        name: getComponentVariableDisplayLabel(control),
        type: control.type,
      }));
  };
  const commitComponentControlBinding = (propertyKey, controlId, applyValue) => {
    if (activeSurface !== 'component' || !componentControlTargetId || !controlId) return;
    bindComponentEditorControlToProperty(controlId, componentControlTargetId, propertyKey);
    const variable = (componentEditor.controls ?? []).find((control) => control.id === controlId) ?? null;
    if (variable && typeof applyValue === 'function') applyValue(getComponentControlEffectiveValue(variable));
    pushHistory();
  };
  const removeComponentControlBinding = (propertyKey) => {
    if (activeSurface !== 'component' || !componentControlTargetId) return;
    clearComponentEditorControlBinding(componentControlTargetId, propertyKey);
    pushHistory();
  };
  const renderInlineBindingButton = (propertyKey, applyValue, options = {}) => {
    if (activeSurface === 'page') {
      return (
        <VariableBindingButton
          variables={getCompatibleBindingVariables(propertyKey)}
          binding={getBindingForProperty(propertyKey)}
          onSelect={(binding) => commitBinding(propertyKey, binding, applyValue)}
          onRemove={() => commitBinding(propertyKey, null)}
          title={options.title || 'Bind variable'}
        />
      );
    }
    if (activeSurface === 'component' && !isAssetStorageSurface && componentControlTargetId) {
      const boundControl = getBoundComponentControl(propertyKey);
      return (
        <VariableBindingButton
          variables={getCompatibleComponentControlVariables(propertyKey)}
          binding={boundControl ? { scope: 'component', variableId: boundControl.id } : null}
          onSelect={(binding) => commitComponentControlBinding(propertyKey, binding.variableId, applyValue)}
          onRemove={() => removeComponentControlBinding(propertyKey)}
          title={options.title || 'Bind component variable'}
        />
      );
    }
    return null;
  };
  const getInlineBoundVariable = (propertyKey) => {
    if (activeSurface === 'page') return resolveBoundVariable(getBindingForProperty(propertyKey));
    const control = getBoundComponentControl(propertyKey);
    if (!control) return null;
    return {
      scope: 'component',
      type: control.type,
      name: getComponentVariableDisplayLabel(control),
    };
  };
  const getComponentInstancePropBinding = (controlId) => {
    if (activeSurface !== 'page' || !element?.componentInstance) return null;
    return element.componentInstance?.bindings?.[controlId] ?? null;
  };
  const getComponentInstanceBoundVariable = (controlId) => resolveBoundVariable(getComponentInstancePropBinding(controlId));
  const renderComponentInstanceBindingButton = (control) => {
    if (activeSurface !== 'page' || !element?.componentInstance || !control) return null;
    return (
      <VariableBindingButton
        variables={getCompatibleVariablesForComponentControl(control)}
        binding={getComponentInstancePropBinding(control.id)}
        onSelect={(binding) => {
          setComponentInstancePropBinding(element.id, control.id, binding);
          commit();
        }}
        onRemove={() => {
          setComponentInstancePropBinding(element.id, control.id, null);
          commit();
        }}
        title="Bind exposed variable"
      />
    );
  };

  const interactions = Array.isArray(element?.interactions) ? element.interactions : [];
  const interactionVariables = allVariables.filter((variable) => ['string', 'number', 'color', 'boolean'].includes(variable.type));
  const updateInteractions = (nextInteractions) => {
    if (!element) return;
    setElementInteractions(element.id, nextInteractions);
    pushHistory();
  };
  const updateInteraction = (interactionId, updates) => {
    updateInteractions(interactions.map((interaction) => (
      interaction.id === interactionId ? { ...interaction, ...updates } : interaction
    )));
  };
  const removeInteraction = (interactionId) => {
    updateInteractions(interactions.filter((interaction) => interaction.id !== interactionId));
  };
  const addInteraction = () => {
    const fallbackPage = variableSources.pages[0] ?? null;
    const fallbackVariable = interactionVariables[0] ?? null;
    const nextInteraction = fallbackPage
      ? { type: 'navigate', pageId: fallbackPage.id, pageTitle: fallbackPage.title, pageUrl: fallbackPage.url }
      : fallbackVariable
        ? { type: 'set-variable', variableId: fallbackVariable.id, variableScope: fallbackVariable.scope, variableType: fallbackVariable.type, operation: 'set', value: getDefaultInteractionValue(fallbackVariable.type) }
        : null;
    if (!nextInteraction) return;
    updateInteractions([...interactions, nextInteraction]);
  };
  const parentFormElement = element
    ? (() => {
      let ancestorId = element.parentId ?? null;
      while (ancestorId) {
        const ancestor = allEls.find((entry) => entry.id === ancestorId) ?? null;
        if (!ancestor) return null;
        if (isFormContainerType(ancestor.type)) return ancestor;
        ancestorId = ancestor.parentId ?? null;
      }
      return null;
    })()
    : null;
  const loopTemplateFlowTarget = element ? getLoopTemplateRootForElement(element, allEls) : null;
  const flowTargetElement = isFormContainerType(element?.type)
    ? element
    : (parentFormElement ?? loopTemplateFlowTarget ?? element);
  const selectedElementTriggerType = isFormContainerType(flowTargetElement?.type) ? 'form-submit' : 'element-click';
  const selectedElementFlow = flowTargetElement
    ? (pageFlows.find((flow) => (
      selectedElementTriggerType === 'form-submit'
        ? flow?.trigger?.type === 'form-submit' && flow?.trigger?.formId === flowTargetElement.id
        : flow?.trigger?.type === 'element-click' && flow?.trigger?.elementId === flowTargetElement.id
    )) ?? null)
    : null;
  const handleOpenInteractionFlow = () => {
    if (!flowTargetElement) return;
    const flowId = selectedElementFlow?.id || ensureElementFlow(flowTargetElement.id, {
      triggerType: selectedElementTriggerType,
      name: `${flowTargetElement.name || 'Element'} ${selectedElementTriggerType === 'form-submit' ? 'submission' : 'interaction'}`,
    });
    openFlowEditor({ elementId: flowTargetElement.id, flowId });
  };
  const handleMigrateLegacyInteractions = () => {
    if (!flowTargetElement) return;
    const flowId = migrateLegacyElementInteractionsToFlow(flowTargetElement.id) || selectedElementFlow?.id || ensureElementFlow(flowTargetElement.id, {
      triggerType: selectedElementTriggerType,
      name: `${flowTargetElement.name || 'Element'} ${selectedElementTriggerType === 'form-submit' ? 'submission' : 'interaction'}`,
    });
    openFlowEditor({ elementId: flowTargetElement.id, flowId });
  };

  useEffect(() => {
    if (activeSurface !== 'page' || !hasSelectedComponentInstance || !selectedElementId || !selectedComponentMeta || !normalizedSelectedVariantId) return;
    if (selectedInstanceVariantId === normalizedSelectedVariantId) return;
    changeComponentInstanceVariant(selectedElementId, normalizedSelectedVariantId);
  }, [activeSurface, changeComponentInstanceVariant, hasSelectedComponentInstance, normalizedSelectedVariantId, selectedComponentMeta, selectedElementId, selectedInstanceVariantId]);

  // Show artboard panel when artboard is selected and no element is selected
  if (activeSurface !== 'component' && !element && artboardSel && bpDefs[artboardSel]) {
    const bp = bpDefs[artboardSel];
    const rawBg       = page?.background?.[artboardSel] ?? null;   // null = inherit
    const effectiveBg = resolveBackground(page?.background, artboardSel);
    const isBgInherited = artboardSel !== 'desktop' && rawBg == null;

    const rawPad      = page?.padding?.[artboardSel] ?? null;   // null = inherit
    const effectivePad = resolvePagePadding(page?.padding, artboardSel);
    const isPadInherited = artboardSel !== 'desktop' && rawPad == null;
    const activePad   = rawPad ?? effectivePad;
    const rawSmoothScroll = page?.smoothScroll?.[artboardSel] ?? null;
    const effectiveSmoothScroll = resolvePageSmoothScroll(page?.smoothScroll, artboardSel);
    const isSmoothScrollInherited = artboardSel !== 'desktop' && rawSmoothScroll == null;

    const setBg = (v) => setPageBackground(artboardSel, v);
    const setPad = (side, v) => setPagePadding(artboardSel, { ...(rawPad ?? effectivePad), [side]: v });

    return (
      <aside className="fb-right">
        <div className="fb-right__header">Artboard</div>
        <div className="fb-panel-body">
          <Section title="Background">
            <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
              <span className="fb-prop-label">Fill</span>
              <FillPicker value={effectiveBg} onChange={v => setBg(v)} mixed={false} />
            </div>
            {artboardSel !== 'desktop' && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {isBgInherited
                  ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                  : <IconButton icon={UIIcons.inherit} title="Inherit background from parent" onClick={() => setPageBackground(artboardSel, null)} />}
              </div>
            )}
          </Section>
          <Section title="Padding">
            <div className="fb-quad" style={{ marginBottom: 6 }}>
              <NumberInput value={activePad.top} label="T" onChange={v => setPad('top', v)} />
              <NumberInput value={activePad.right} label="R" onChange={v => setPad('right', v)} />
              <NumberInput value={activePad.bottom} label="B" onChange={v => setPad('bottom', v)} />
              <NumberInput value={activePad.left} label="L" onChange={v => setPad('left', v)} />
            </div>
            {artboardSel !== 'desktop' && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {isPadInherited
                  ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                  : <IconButton icon={UIIcons.inherit} title="Inherit padding from parent" onClick={() => setPagePadding(artboardSel, null)} />}
              </div>
            )}
          </Section>
          <Section title="Smooth Scroll">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Behavior</span>
              <select className="fb-prop-input" value={effectiveSmoothScroll ?? 'smooth'} onChange={(event) => setPageSmoothScroll(artboardSel, event.target.value)}>
                <option value="smooth">Smooth</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            {artboardSel !== 'desktop' && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {isSmoothScrollInherited
                  ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                  : <IconButton icon={UIIcons.inherit} title="Inherit smooth scroll from parent" onClick={() => setPageSmoothScroll(artboardSel, null)} />}
              </div>
            )}
          </Section>
          {(() => {
            const rawLayout = page?.layout?.[artboardSel] ?? null;
            const effectiveLayout = resolvePageLayout(page?.layout, artboardSel);
            const isLayoutInherited = artboardSel !== 'desktop' && rawLayout == null;
            const layoutOn = effectiveLayout !== null;
            const DEFAULT_LAYOUT = { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', flexWrap: 'nowrap', gap: 0 };
            const activeLayout = effectiveLayout ?? savedLayoutRef.current[artboardSel] ?? DEFAULT_LAYOUT;
            const updLayout = (key, val) => {
              const cur = rawLayout ?? { ...activeLayout };
              setPageLayout(artboardSel, { ...cur, [key]: val });
            };
            return (
              <Section title="Layout">
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Auto layout</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <IconButton icon={UIIcons.layoutOff} active={!layoutOn} title="Auto layout off" onClick={() => {
                      if (layoutOn) savedLayoutRef.current[artboardSel] = { ...activeLayout };
                      setPageLayout(artboardSel, null);
                    }} />
                    <IconButton icon={UIIcons.layoutOn} active={layoutOn} title="Auto layout on" onClick={() => {
                      if (!layoutOn) setPageLayout(artboardSel, savedLayoutRef.current[artboardSel] ?? { ...DEFAULT_LAYOUT });
                    }} />
                  </div>
                </div>
                {layoutOn ? (
                  <>
                    <LayoutGrid layout={activeLayout} onChange={(key, val) => updLayout(key, val)} />
                    <div className="fb-prop-row" style={{ marginTop: 6 }}>
                      <span className="fb-prop-label">Gap</span>
                      <NumberInput value={activeLayout.gap ?? 0} min={0} onChange={v => updLayout('gap', v)} />
                    </div>
                  </>
                ) : null}
                {artboardSel !== 'desktop' ? (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isLayoutInherited
                      ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                      : <IconButton icon={UIIcons.inherit} title="Inherit layout from parent" onClick={() => setPageLayout(artboardSel, null)} />}
                  </div>
                ) : null}
              </Section>
            );
          })()}
        </div>
      </aside>
    );
  }

  if (!element || !selection) {
    return (
      <aside className="fb-right">
        <div className="fb-right__header">Properties</div>
        <div className="fb-empty-state">
          <div className="fb-empty-state__text">Select an element<br />to edit its properties</div>
        </div>
      </aside>
    );
  }

  const bpId = selection.bpId || 'desktop';
  const resolvedAnimations = resolveElementAnimations(element, bpId);
  const animationVariantOptions = selectedComponentVariants.map((variant) => ({ value: variant.id, label: variant.name }));
  const selectedElementAnimation = resolvedAnimations.find((entry) => entry.id === elementAnimationModalState?.animationId) ?? null;
  const contextMenuAnimation = resolvedAnimations.find((entry) => entry.id === animationCardContextMenu?.animationId) ?? null;

  if (hasMultiSelection && selectedElements.length) {
    const resolvedSelections = selectedElements.map((selected) => ({
      element: selected,
      resolved: resolveElementWithVariables(selected, bpId, pageVariables, globalVariables),
    }));
    const pageLayout = resolvePageLayout(page?.layout, bpId);
    const bp = bpDefs?.[bpId];
    const autoFoldH = bp
      ? (bp.id === 'desktop' ? Math.round(bp.width * 9 / 16) : Math.round(bp.width * 16 / 9))
      : 900;
    const alignmentParentId = selectedElements[0]?.parentId ?? null;
    const sharesAlignmentParent = selectedElements.every((selected) => (selected.parentId ?? null) === alignmentParentId);
    let alignContainerW = bp?.width ?? 1440;
    let alignContainerH = bp?.height ?? 900;
    if (alignmentParentId) {
      const parent = allEls.find((candidate) => candidate.id === alignmentParentId);
      if (parent) {
        const parentResolved = resolveElementWithVariables(parent, bpId, pageVariables, globalVariables);
        alignContainerW = parentResolved.width ?? alignContainerW;
        alignContainerH = parentResolved.height ?? alignContainerH;
      }
    }
    const alignmentEntries = resolvedSelections.map(({ element: selected, resolved }) => {
      const positionType = resolved.positionType ?? 'absolute';
      const isFixed = positionType === 'fixed';
      const isFlow = positionType === 'relative'
        || positionType === 'sticky'
        || (!selected.parentId && resolvePageLayout(page?.layout, bpId) !== null && !resolved.absoluteInLayout && !isFixed);
      return {
        id: selected.id,
        locked: !!selected.locked,
        isFixed,
        isFlow,
        x: resolved.x ?? 0,
        y: resolved.y ?? 0,
        width: resolved.width ?? 0,
        height: resolved.height ?? 0,
      };
    });
    const allFixedSelection = alignmentEntries.every((entry) => entry.isFixed);
    if (allFixedSelection) alignContainerH = bp?.viewportFoldH ?? autoFoldH;
    const canAlignSelection = alignmentEntries.length > 0
      && sharesAlignmentParent
      && alignmentEntries.every((entry) => !entry.locked && !entry.isFlow)
      && (allFixedSelection || alignmentEntries.every((entry) => !entry.isFixed));
    const selectionBounds = canAlignSelection ? alignmentEntries.reduce((acc, entry) => ({
      left: Math.min(acc.left, entry.x),
      top: Math.min(acc.top, entry.y),
      right: Math.max(acc.right, entry.x + entry.width),
      bottom: Math.max(acc.bottom, entry.y + entry.height),
    }), {
      left: alignmentEntries[0].x,
      top: alignmentEntries[0].y,
      right: alignmentEntries[0].x + alignmentEntries[0].width,
      bottom: alignmentEntries[0].y + alignmentEntries[0].height,
    }) : null;
    const selectionSize = selectionBounds ? {
      width: selectionBounds.right - selectionBounds.left,
      height: selectionBounds.bottom - selectionBounds.top,
    } : null;
    const getSharedValue = (getter) => {
      const first = getter(resolvedSelections[0]);
      return resolvedSelections.every((entry) => Object.is(getter(entry), first)) ? first : null;
    };
    const getFirstValue = (getter, fallback = null) => {
      const first = getter(resolvedSelections[0]);
      return first ?? fallback;
    };
    const opacityValue = getSharedValue(({ resolved }) => resolved.styles?.opacity ?? 1);
    const hiddenValue = getSharedValue(({ resolved }) => !!resolved.hidden);
    const zIndexValue = getSharedValue(({ resolved }) => resolved.styles?.zIndex ?? 1);
    const rotationValue = getSharedValue(({ resolved }) => resolved.rotation ?? 0);
    const rotationXValue = getSharedValue(({ resolved }) => resolved.rotationX ?? 0);
    const rotationYValue = getSharedValue(({ resolved }) => resolved.rotationY ?? 0);
    const lockedValue = getSharedValue(({ element, resolved }) => !!(resolved.locked ?? element.locked ?? element.base?.locked));
    const aspectRatioLockedValue = getSharedValue(({ resolved }) => resolved.lockAspectRatio === true);
    const positionTypeValue = getSharedValue(({ element: selected, resolved }) => getResolvedSelectionPositionMode(selected, resolved, pageLayout));
    const xValue = getSharedValue(({ resolved }) => Math.round((resolved.x ?? 0) * 10) / 10);
    const yValue = getSharedValue(({ resolved }) => Math.round((resolved.y ?? 0) * 10) / 10);
    const widthValue = getSharedValue(({ resolved }) => Math.round((resolved.width ?? 0) * 10) / 10);
    const heightValue = getSharedValue(({ resolved }) => Math.round((resolved.height ?? 0) * 10) / 10);
    const widthModeValue = getSharedValue(({ resolved }) => resolved.widthMode ?? 'fixed');
    const heightModeValue = getSharedValue(({ resolved }) => resolved.heightMode ?? 'fixed');
    const widthPctValue = getSharedValue(({ resolved }) => Math.round((resolved.widthPct ?? resolved.width ?? 100) * 10) / 10);
    const heightPctValue = getSharedValue(({ resolved }) => Math.round((resolved.heightPct ?? resolved.height ?? 100) * 10) / 10);
    const widthFrValue = getSharedValue(({ resolved }) => Math.round((resolved.widthFr ?? 1) * 10) / 10);
    const heightFrValue = getSharedValue(({ resolved }) => Math.round((resolved.heightFr ?? 1) * 10) / 10);
    const constraintsValueRaw = getSharedValue(({ resolved }) => JSON.stringify({ top: true, left: true, right: false, bottom: false, ...(resolved.constraints ?? {}) }));
    const constraintsValue = constraintsValueRaw ? JSON.parse(constraintsValueRaw) : { top: true, left: true, right: false, bottom: false };
    const rightValue = xValue == null || widthValue == null ? null : Math.round((alignContainerW - xValue - widthValue) * 10) / 10;
    const bottomValue = yValue == null || heightValue == null ? null : Math.round((alignContainerH - yValue - heightValue) * 10) / 10;
    const hasFlowSelection = resolvedSelections.some(({ element: selected, resolved }) => {
      const positionMode = getResolvedSelectionPositionMode(selected, resolved, pageLayout);
      return positionMode === 'relative' || positionMode === 'sticky';
    });
    const allFrames = selectedElements.every((selected) => (selected.type === 'frame' || isLoopElementType(selected.type) || isFormContainerType(selected.type)) && !selected.componentInstance && !selected.componentRoot);
    const allTexts = selectedElements.every((selected) => selected.type === 'text');
    const frameFillValue = allFrames ? getSharedValue(({ resolved }) => resolved.styles?.backgroundColor ?? 'rgba(180,180,200,0.18)') : null;
    const frameFillDisplayValue = allFrames
      ? (frameFillValue ?? getFirstValue(({ resolved }) => resolved.styles?.backgroundColor, 'rgba(180,180,200,0.18)'))
      : null;
    const textColorEntries = allTexts ? resolvedSelections.map(({ resolved }) => getTextColorMeta(resolved)) : [];
    const textColorValue = allTexts && textColorEntries.length && textColorEntries.every((entry) => !entry.mixed && entry.baseColor === textColorEntries[0].baseColor)
      ? textColorEntries[0].baseColor
      : null;
    const textColorDisplayValue = allTexts ? (textColorEntries[0]?.baseColor ?? '#000000') : null;
    const textColorMixed = allTexts ? textColorEntries.some((entry) => entry.mixed) || textColorValue == null : false;
    const textFontFamilyValue = allTexts ? getSharedValue(({ resolved }) => resolved.styles?.fontFamily ?? 'Inter') : null;
    const textFontFamilyDisplayValue = allTexts
      ? (textFontFamilyValue ?? getFirstValue(({ resolved }) => resolved.styles?.fontFamily, 'Inter'))
      : null;
    const textFontWeightValue = allTexts ? getSharedValue(({ resolved }) => String(resolved.styles?.fontWeight ?? 400)) : null;
    const textFontWeightDisplayValue = allTexts
      ? (textFontWeightValue ?? String(getFirstValue(({ resolved }) => resolved.styles?.fontWeight, 400)))
      : null;
    const textFontStyleValue = allTexts ? getSharedValue(({ resolved }) => resolved.styles?.fontStyle ?? 'normal') : null;
    const textDecorationValue = allTexts ? getSharedValue(({ resolved }) => resolved.styles?.textDecoration ?? 'none') : null;
    const textAlignValue = allTexts ? getSharedValue(({ resolved }) => resolved.styles?.textAlign ?? 'left') : null;
    const typeSummary = Array.from(new Set(selectedElements.map((selected) => (
      selected.componentInstance ? 'component' : selected.type
    )))).join(', ');
    const applyLayout = (updates, targetBpId = bpId) => {
      updateElementsLayout(selectionIds, targetBpId, updates);
      pushHistory();
    };
    const applyStyles = (updates) => {
      updateElementsStyles(selectionIds, bpId, updates);
      pushHistory();
    };
    const applyPositionType = (nextValue) => {
      resolvedSelections.forEach(({ element: selected, resolved }) => {
        const isAutoLayoutRoot = !selected.parentId && pageLayout !== null;
        if (isAutoLayoutRoot) {
          if (nextValue === 'relative' || nextValue === 'sticky') {
            updateElementLayout(selected.id, bpId, {
              absoluteInLayout: false,
              positionType: nextValue,
              ...(nextValue === 'sticky' ? { x: 0, y: Math.max(0, resolved.y ?? 0) } : {}),
            });
            return;
          }
          updateElementLayout(selected.id, bpId, { absoluteInLayout: true, positionType: nextValue });
          return;
        }
        updateElementLayout(selected.id, bpId, { positionType: nextValue });
      });
      pushHistory();
    };
    const applyMultiSize = (dimension, value) => {
      const safeValue = Math.max(1, normalizeFiniteNumber(value, 1));
      updateElementsLayout(selectionIds, bpId, {
        [dimension]: safeValue,
        [dimension === 'width' ? 'widthMode' : 'heightMode']: 'fixed',
      });
      pushHistory();
    };
    const applyMultiPosition = (axis, value) => {
      updateElementsLayout(selectionIds, bpId, { [axis]: normalizeFiniteNumber(value, 0) });
      pushHistory();
    };
    const applyMultiConstraints = (constraints) => {
      const nextHorizontal = getConstraintMode(constraints, 'horizontal');
      const nextVertical = getConstraintMode(constraints, 'vertical');
      updateElementsLayout(selectionIds, bpId, {
        constraints: {
          ...constraints,
          horizontal: nextHorizontal,
          vertical: nextVertical,
        },
      });
      pushHistory();
    };
    const applyMultiSizeMode = (dimension, mode) => {
      updateElementsLayout(selectionIds, bpId, { [dimension === 'width' ? 'widthMode' : 'heightMode']: mode });
      pushHistory();
    };
    const applyMultiSizeValueForMode = (dimension, mode, value) => {
      const safeValue = normalizeFiniteNumber(value, mode === 'fill' ? 1 : 100);
      if (mode === 'fill') {
        updateElementsLayout(selectionIds, bpId, { [dimension === 'width' ? 'widthFr' : 'heightFr']: Math.max(0.1, safeValue), [dimension === 'width' ? 'widthMode' : 'heightMode']: 'fill' });
      } else if (mode === 'relative') {
        updateElementsLayout(selectionIds, bpId, { [dimension === 'width' ? 'widthPct' : 'heightPct']: Math.max(0, safeValue), [dimension === 'width' ? 'widthMode' : 'heightMode']: 'relative' });
      } else {
        applyMultiSize(dimension, safeValue);
        return;
      }
      pushHistory();
    };
    const toggleMultiAspectLock = () => {
      updateElementsLayout(selectionIds, bpId, { lockAspectRatio: !(aspectRatioLockedValue === true) });
      pushHistory();
    };
    const alignSelection = (action) => {
      if (!canAlignSelection || !selectionBounds || !selectionSize) return;
      const targets = getAlignTargets(action, selectionSize.width, selectionSize.height, alignContainerW, alignContainerH);
      if (!targets) return;
      const deltaX = targets.x == null ? 0 : targets.x - selectionBounds.left;
      const deltaY = targets.y == null ? 0 : targets.y - selectionBounds.top;
      alignmentEntries.forEach((entry) => {
        const updates = {};
        if (targets.x != null) updates.x = Math.round(entry.x + deltaX);
        if (targets.y != null) updates.y = Math.round(entry.y + deltaY);
        updateElementLayout(entry.id, bpId, updates);
      });
      pushHistory();
    };

    return (
      <aside className="fb-right">
        <div className="fb-right__header">
          <span className="fb-right__header-title">{selectionIds.length} elements</span>
          <div className="fb-right__header-actions">
            <HeaderActionButton
              icon={UIIcons.trash}
              title="Delete selected elements"
              label="Delete"
              onClick={() => { deleteElements(selectionIds); pushHistory(); }}
            />
          </div>
        </div>

        <div className="fb-panel-body">
          <AlignStrip
            resolved={selectionSize ?? { width: 0, height: 0 }}
            containerW={alignContainerW}
            containerH={alignContainerH}
            upd={() => {}}
            commit={() => {}}
            disabled={!canAlignSelection}
            onAlign={alignSelection}
          />

          <Section title="Selection">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Types</span>
              <div className="fb-prop-value">{typeSummary || 'Mixed'}</div>
            </div>
            <div className="fb-artboard-bp-note">
              Only batch-safe controls are shown here. Mixed values stay untouched until you set a replacement.
            </div>
            {!canAlignSelection ? <div className="fb-artboard-bp-note">Align is available when all selected elements share the same parent and use absolute or fixed positioning.</div> : null}
          </Section>

          <Section title="Position">
            <div className="fb-prop-row" style={{ marginTop: 6 }}>
              <span className="fb-prop-label">Type</span>
              <select
                className="fb-prop-input"
                value={positionTypeValue ?? ''}
                onChange={(event) => applyPositionType(event.target.value)}
              >
                <option value="" disabled>Mixed</option>
                <option value="absolute">Absolute</option>
                <option value="fixed">Fixed</option>
                <option value="relative">Relative</option>
                <option value="sticky">Sticky</option>
              </select>
            </div>
            <div className="fb-pos-widget">
              <div className="fb-pos-widget__row">
                <MixedPosInput value={yValue} label="T" onCommit={(value) => applyMultiPosition('y', positionTypeValue === 'sticky' ? Math.max(0, value) : value)} />
              </div>
              <div className="fb-pos-widget__row">
                <MixedPosInput value={xValue} label="L" onCommit={(value) => applyMultiPosition('x', value)} />
                <ConstraintWidget constraints={constraintsValue} onChange={applyMultiConstraints} />
                <MixedPosInput value={rightValue} label="R" onCommit={(value) => {
                  if (widthValue == null) return;
                  applyMultiPosition('x', alignContainerW - value - widthValue);
                }} />
              </div>
              <div className="fb-pos-widget__row">
                <MixedPosInput value={bottomValue} label="B" onCommit={(value) => {
                  if (heightValue == null) return;
                  applyMultiPosition('y', alignContainerH - value - heightValue);
                }} />
              </div>
            </div>
            {hasFlowSelection ? (
              <div className="fb-artboard-bp-note">Relative or sticky items can still show mixed offsets here, but x and y are most useful after switching the selection to absolute or fixed positioning.</div>
            ) : null}
          </Section>

          <Section title="Size">
            <div className="fb-size-section">
              <div className="fb-size-section__rows">
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Width</span>
                  <div className="fb-size-row">
                    {(() => {
                      const mode = widthModeValue ?? 'fixed';
                      if (mode === 'hug') return <div className="fb-prop-mini" style={{ flex: 1 }} />;
                      if (mode === 'fill') return <MixedLabeledNumberInput value={widthFrValue} min={0.1} step={0.1} label="fr" onCommit={(value) => applyMultiSizeValueForMode('width', 'fill', value)} />;
                      if (mode === 'relative') return <MixedLabeledNumberInput value={widthPctValue} min={0} max={100} step={1} label="%" onCommit={(value) => applyMultiSizeValueForMode('width', 'relative', value)} />;
                      return <MixedLabeledNumberInput value={widthValue} min={1} step={1} label="px" onCommit={(value) => applyMultiSize('width', value)} />;
                    })()}
                    <select
                      className="fb-prop-input fb-size-mode"
                      value={widthModeValue ?? ''}
                      onChange={(event) => applyMultiSizeMode('width', event.target.value)}
                    >
                      <option value="" disabled>Mixed</option>
                      <option value="fixed">Fixed</option>
                      <option value="fill">Fill</option>
                      <option value="relative">Rel</option>
                      <option value="hug">Hug</option>
                    </select>
                  </div>
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Height</span>
                  <div className="fb-size-row">
                    {(() => {
                      const mode = heightModeValue ?? 'fixed';
                      if (mode === 'hug') return <div className="fb-prop-mini" style={{ flex: 1 }} />;
                      if (mode === 'fill') return <MixedLabeledNumberInput value={heightFrValue} min={0.1} step={0.1} label="fr" onCommit={(value) => applyMultiSizeValueForMode('height', 'fill', value)} />;
                      if (mode === 'relative') return <MixedLabeledNumberInput value={heightPctValue} min={0} max={100} step={1} label="%" onCommit={(value) => applyMultiSizeValueForMode('height', 'relative', value)} />;
                      return <MixedLabeledNumberInput value={heightValue} min={1} step={1} label="px" onCommit={(value) => applyMultiSize('height', value)} />;
                    })()}
                    <select
                      className="fb-prop-input fb-size-mode"
                      value={heightModeValue ?? ''}
                      onChange={(event) => applyMultiSizeMode('height', event.target.value)}
                    >
                      <option value="" disabled>Mixed</option>
                      <option value="fixed">Fixed</option>
                      <option value="fill">Fill</option>
                      <option value="relative">Rel</option>
                      <option value="hug">Hug</option>
                    </select>
                  </div>
                </div>
              </div>
              <IconButton
                icon={UIIcons.link}
                title="Lock aspect ratio"
                active={aspectRatioLockedValue === true}
                className="fb-btn--sm fb-size-lock-btn"
                onClick={toggleMultiAspectLock}
              />
            </div>
            <div className="fb-artboard-bp-note">Entering a size applies a fixed pixel width or height to every selected element. Different current values show as Mixed until you replace them.</div>
          </Section>

          <Section title="Transform">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Mode</span>
              <ChoiceGroup
                value={multiTransformMode}
                onChange={(value) => {
                  setMultiTransformMode(value);
                  if (value === '2d') applyLayout({ rotationX: 0, rotationY: 0 });
                }}
                options={[
                  { value: '2d', label: '2D' },
                  { value: '3d', label: '3D' },
                ]}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Rotate Z</span>
              <MixedNumberInput
                value={rotationValue}
                min={-360}
                max={360}
                step={1}
                onCommit={(value) => applyLayout({ rotation: value })}
              />
            </div>
            {multiTransformMode === '3d' ? (
              <>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Rotate X</span>
                  <MixedNumberInput
                    value={rotationXValue}
                    min={-360}
                    max={360}
                    step={1}
                    onCommit={(value) => applyLayout({ rotationX: value })}
                  />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Rotate Y</span>
                  <MixedNumberInput
                    value={rotationYValue}
                    min={-360}
                    max={360}
                    step={1}
                    onCommit={(value) => applyLayout({ rotationY: value })}
                  />
                </div>
              </>
            ) : null}
            <div className="fb-artboard-bp-note">2D keeps flat rotation on Z only. Switch to 3D to edit X and Y tilt without changing variant or animation support.</div>
          </Section>

          <Section title="Visibility">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Visible</span>
              <ChoiceGroup
                value={hiddenValue == null ? '' : (hiddenValue ? 'no' : 'yes')}
                onChange={(value) => applyLayout({ hidden: value === 'no' })}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Opacity</span>
              <MixedNumberInput
                value={opacityValue}
                min={0}
                max={1}
                step={0.01}
                onCommit={(value) => applyStyles({ opacity: Math.max(0, Math.min(1, value)) })}
              />
            </div>
          </Section>

          {allFrames ? (
            <Section title="Fill">
              <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Fill</span>
                <div style={{ width: '100%' }}>
                  <FillPicker
                    value={frameFillDisplayValue}
                    onChange={(value) => applyStyles({ backgroundColor: value })}
                  />
                </div>
              </div>
              {frameFillValue == null ? (
                <div className="fb-artboard-bp-note">Mixed frame fills. Picking a new fill will replace them for all selected frames.</div>
              ) : null}
            </Section>
          ) : null}

          {allTexts ? (
            <Section title="Text">
              <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Font</span>
                <div style={{ flex: 1 }}>
                  <GoogleFontPicker
                    value={textFontFamilyDisplayValue}
                    onChange={(value) => commitFontFamily(selectionIds, bpId, value)}
                    onPreviewChange={(value) => previewFontFamily(selectionIds, bpId, value)}
                    onPreviewReset={resetFontPreview}
                  />
                </div>
              </div>
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Weight</span>
                <select
                  className="fb-prop-input"
                  value={textFontWeightDisplayValue}
                  onChange={(event) => applyStyles({ fontWeight: Number(event.target.value) })}
                >
                  {FONT_WEIGHT_OPTIONS.map((weight) => (
                    <option key={weight} value={weight}>{weight}</option>
                  ))}
                </select>
              </div>
              <div className="fb-prop-row" style={{ marginTop: 6 }}>
                <span className="fb-prop-label">Style</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <IconButton icon={UIIcons.regular} title="Regular" active={(textFontStyleValue ?? 'normal') === 'normal'} onClick={() => applyStyles({ fontStyle: 'normal' })} />
                  <IconButton icon={UIIcons.italic} title="Italic" active={textFontStyleValue === 'italic'} onClick={() => applyStyles({ fontStyle: textFontStyleValue === 'italic' ? 'normal' : 'italic' })} />
                  <IconButton icon={UIIcons.underline} title="Underline" active={(textDecorationValue ?? 'none') === 'underline'} onClick={() => applyStyles({ textDecoration: (textDecorationValue ?? 'none') === 'underline' ? 'none' : 'underline' })} />
                </div>
              </div>
              <div className="fb-quad" style={{ marginTop: 6 }}>
                <ColorInput value={textColorDisplayValue} mixed={textColorMixed} onChange={(value) => applyStyles({ color: value })} />
                <div />
              </div>
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Align</span>
                <IconGroup
                  value={textAlignValue}
                  onChange={(value) => applyStyles({ textAlign: value })}
                  options={TEXT_ALIGN_OPTIONS}
                />
              </div>
              {textFontFamilyValue == null || textFontWeightValue == null || textFontStyleValue == null || textDecorationValue == null || textColorValue == null || textAlignValue == null ? (
                <div className="fb-artboard-bp-note">Some text values are mixed. Choosing a new value will overwrite that property for all selected text layers.</div>
              ) : null}
            </Section>
          ) : null}

          <Section title="Advanced">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Z Index</span>
              <MixedNumberInput
                value={zIndexValue}
                step={1}
                onCommit={(value) => applyStyles({ zIndex: Math.round(value) })}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Lock</span>
              <ChoiceGroup
                value={lockedValue == null ? '' : (lockedValue ? 'yes' : 'no')}
                onChange={(value) => {
                  updateElementsLayout(selectionIds, 'desktop', { locked: value === 'yes' });
                  pushHistory();
                }}
                options={[
                  { value: 'no', label: 'No' },
                  { value: 'yes', label: 'Yes' },
                ]}
              />
            </div>
          </Section>
        </div>
      </aside>
    );
  }

  const resolved = resolveElementWithVariables(element, bpId, pageVariables, globalVariables);
  const s = resolved.styles || {};
  const isFormField = isFormFieldType(element.type);
  const isFormSubmitButton = isFormSubmitButtonType(element.type);
  const isDropdownField = element.type === 'dropdown';
  const supportsPlaceholderStyling = isFormField && !['checkbox', 'radio-group'].includes(element.type);
  const textColorMeta = (element.type === 'text' || isFormField || isFormSubmitButton)
    ? getTextColorMeta(resolved)
    : { baseColor: s.color ?? '#000000', mixed: false };
  const textGrow = (resolved.widthMode === 'hug' && resolved.heightMode === 'hug')
    ? 'auto-width'
    : resolved.heightMode === 'hug'
      ? 'auto-height'
      : 'fixed';

  // Container dimensions for T/L/R/B position inputs and AlignStrip
  // AlignStrip must NOT involve page padding — use raw artboard/parent dimensions.
  const bp = bpDefs?.[bpId];
  let containerW = bp?.width  ?? 1440;
  let containerH = bp?.height ?? 900;
  if (element.parentId) {
    const parent = allEls.find(e => e.id === element.parentId);
    if (parent) {
      const pr = resolveElement(parent, bpId);
      containerW = pr.width  ?? containerW;
      containerH = pr.height ?? containerH;
      const boardDom = typeof document !== 'undefined'
        ? document.querySelector(`.fb-artboard[data-bp="${bpId}"]`)
        : null;
      const parentDom = boardDom?.querySelector(`[data-id="${parent.id}"]`) ?? null;
      if (parentDom && viewportScale > 0) {
        const rect = parentDom.getBoundingClientRect();
        if (rect.width > 0) containerW = rect.width / viewportScale;
        if (rect.height > 0) containerH = rect.height / viewportScale;
      }
    }
  }

  // For fixed-position elements, bottom is measured from viewport fold, not artboard height
  const isFixedEl = (resolved?.positionType ?? 'absolute') === 'fixed';
  const autoFoldH = bp
    ? (bp.id === 'desktop' ? Math.round(bp.width * 9 / 16) : Math.round(bp.width * 16 / 9))
    : containerH;
  const bpViewportFoldH = bp?.viewportFoldH ?? autoFoldH;
  const effectiveContainerH = isFixedEl ? bpViewportFoldH : containerH;

  const upd = (key, val) => {
    updateElementLayout(element.id, bpId, { [key]: val });
  };
  const updBase = (updates) => {
    updateElementBase(element.id, updates);
  };
  const updText = (val) => {
    updateElementLayout(element.id, bpId, {
      text: val,
      richTextHtml: plainTextToRichTextHtml(val || 'Text'),
    });
  };
  const updS = (key, val) => {
    updateStyles(element.id, bpId, { [key]: val });
  };
  const commit = () => pushHistory();
  const aspectRatioLocked = resolved.lockAspectRatio === true;
  const currentAspectRatio = (() => {
    const safeWidth = Math.max(1, normalizeFiniteNumber(resolved.width ?? element.base?.width ?? 1, 1));
    const safeHeight = Math.max(1, normalizeFiniteNumber(resolved.height ?? element.base?.height ?? 1, 1));
    return safeHeight > 0 ? (safeWidth / safeHeight) : 0;
  })();
  const applyFixedSizeChange = (dimension, rawValue) => {
    const nextValue = Math.max(1, normalizeFiniteNumber(rawValue, dimension === 'width' ? (resolved.width ?? 100) : (resolved.height ?? 100)));
    const updates = dimension === 'width'
      ? { width: nextValue, widthMode: 'fixed' }
      : { height: nextValue, heightMode: 'fixed' };
    if (aspectRatioLocked && currentAspectRatio > 0) {
      if (dimension === 'width') {
        updates.height = Math.max(1, Math.round((nextValue / currentAspectRatio) * 1000) / 1000);
        updates.heightMode = 'fixed';
      } else {
        updates.width = Math.max(1, Math.round((nextValue * currentAspectRatio) * 1000) / 1000);
        updates.widthMode = 'fixed';
      }
    }
    updateElementLayout(element.id, bpId, updates);
  };

  // Auto-layout context: element is a root element inside an artboard with layout on
  const artboardLayout = resolvePageLayout(page?.layout, bpId);
  const inAutoLayout   = !element.parentId && artboardLayout !== null;
  const isFlowInLayout = inAutoLayout && !resolved.absoluteInLayout;
  const isAssetStorageSurface = activeSurface === 'component' && componentEditor.componentId === ASSET_STORAGE_COMPONENT_ID;
  const isComponentRoot = activeSurface === 'component' && !isAssetStorageSurface && !element.parentId;
  const isComponentInstanceOnPage = activeSurface === 'page' && !!element.componentInstance;
  const isLoopElement = isLoopElementType(element.type);
  const supportsDirectLink = !isComponentInstanceOnPage && !isFormField && !isFormSubmitButton && !isFormContainerType(element.type);
  const formConfig = normalizeFormConfig(resolved?.formConfig);
  const loopConfig = normalizeLoopConfig(resolved?.loop);
  const formFieldOptions = ensureFormOptions(resolved?.fieldOptions);
  const componentMeta = isComponentInstanceOnPage ? selectedComponentMeta : null;
  const componentVariants = isComponentInstanceOnPage ? selectedComponentVariants : [];
  const componentVariantId = componentVariants.some((variant) => variant.id === element.componentInstance?.variantId)
    ? element.componentInstance?.variantId
    : componentMeta?.defaultVariantId ?? componentVariants[0]?.id ?? '';
  const selectedEditorVariant = activeSurface === 'component' && !isAssetStorageSurface && element.componentRoot
    ? (componentEditor.variants ?? []).find((variant) => variant.id === element.componentEditorVariantId)
    : null;
  const selectedEditorVariantLabel = getVariantLabel(componentEditor.variants ?? [], selectedEditorVariant);
  const selectedEditorVariantId = selectedEditorVariant?.id ?? null;
  const selectedVariantChildInteractions = selectedEditorVariantId
    ? (componentEditor.page?.elements ?? []).filter((entry) => (
        entry.componentEditorVariantId === selectedEditorVariantId
        && !entry.componentRoot
        && !!entry.base?.componentInteraction?.targetVariantId
      ))
    : [];
  const childInteractionCountForSelectedVariant = selectedVariantChildInteractions.length;
  const firstSelectedVariantChildInteraction = selectedVariantChildInteractions[0]?.base?.componentInteraction ?? null;
  const selectedRootTransitionSource = (() => {
    if (!element.componentRoot || !isDefaultVariant(selectedEditorVariant)) return null;
    if (selectedEditorVariant?.interaction?.targetVariantId) {
      return {
        kind: 'variant',
        variantId: selectedEditorVariant.id,
        sourceName: selectedEditorVariant.name || 'Primary',
        targetVariantId: selectedEditorVariant.interaction.targetVariantId,
        transition: selectedEditorVariant.interaction?.transition ?? null,
        delay: selectedEditorVariant.interaction?.delay ?? 0,
      };
    }
    // Fallback: check if root element itself has a componentInteraction (legacy connector data path)
    const rootElementInteraction = element.base?.componentInteraction;
    if (rootElementInteraction?.targetVariantId) {
      return {
        kind: 'variant',
        variantId: selectedEditorVariant.id,
        sourceName: selectedEditorVariant.name || 'Primary',
        targetVariantId: rootElementInteraction.targetVariantId,
        transition: rootElementInteraction.transition ?? null,
        delay: rootElementInteraction.delay ?? 0,
        _rootElementId: element.id,
      };
    }
    if (childInteractionCountForSelectedVariant > 0) {
      return {
        kind: 'variant-child',
        variantId: selectedEditorVariant.id,
        sourceName: selectedEditorVariant.name || 'Primary',
        targetVariantId: firstSelectedVariantChildInteraction?.targetVariantId ?? null,
        transition: selectedEditorVariant?.childTransition ?? null,
        delay: 0,
        childCount: childInteractionCountForSelectedVariant,
      };
    }
    return null;
  })();
  const transitionEditorSource = (() => {
    if (!transitionModalState) return null;
    const sourceVariant = transitionModalState.variantId
      ? (componentEditor.variants ?? []).find((variant) => variant.id === transitionModalState.variantId) ?? null
      : null;
    if (!sourceVariant) return null;
    if (transitionModalState.kind === 'variant-child') {
      return {
        kind: 'variant-child',
        sourceName: sourceVariant.name || 'Primary',
        transition: sourceVariant.childTransition ?? null,
        variant: sourceVariant,
        targetName: transitionModalState.targetName || 'Connected child variants',
      };
    }
    if (!sourceVariant?.interaction?.targetVariantId) {
      // Fallback: check root element's componentInteraction (legacy connector data path)
      const rootEl = selectedRootTransitionSource?._rootElementId
        ? (componentEditor.page?.elements ?? []).find((entry) => entry.id === selectedRootTransitionSource._rootElementId) ?? null
        : null;
      const rootElInteraction = rootEl?.base?.componentInteraction;
      if (!rootElInteraction?.targetVariantId) return null;
      return {
        kind: 'variant',
        sourceName: sourceVariant.name || 'Primary',
        interaction: rootElInteraction,
        variant: sourceVariant,
        _rootElementId: rootEl.id,
      };
    }
    return {
      kind: 'variant',
      sourceName: sourceVariant.name || 'Primary',
      interaction: sourceVariant.interaction,
      variant: sourceVariant,
    };
  })();
  const transitionEditorTarget = transitionEditorSource?.kind === 'variant-child'
    ? { name: transitionEditorSource.targetName || 'Connected child variants' }
    : (transitionEditorSource?.interaction?.targetVariantId
      ? (componentEditor.variants ?? []).find((variant) => variant.id === transitionEditorSource.interaction.targetVariantId) ?? null
      : null);
  const componentEditorControls = activeSurface === 'component' && !isAssetStorageSurface ? (componentEditor.controls ?? []) : [];
  const componentControlTargetId = activeSurface === 'component' && !isAssetStorageSurface
    ? (element?.componentSourceId ?? element?.id ?? null)
    : null;
  const allowVariableBindings = activeSurface === 'page' || (activeSurface === 'component' && !isAssetStorageSurface && !!componentControlTargetId);
  const componentControlPropertyOptions = activeSurface === 'component' && !isAssetStorageSurface
    ? getComponentControlPropertyOptions(element)
    : [];
  const editingComponentMeta = activeSurface === 'component' && !isAssetStorageSurface
    ? (components.find((entry) => entry.id === componentEditor.componentId) ?? null)
    : null;
  const selectedRootTransitionTarget = selectedRootTransitionSource?.targetVariantId
    ? (componentEditor.variants ?? []).find((variant) => variant.id === selectedRootTransitionSource.targetVariantId) ?? null
    : null;
  const openTransitionContextMenu = (event) => {
    if (!selectedRootTransitionSource) return;
    event.preventDefault();
    setHasStoredTransitionClipboard(!!readStoredTransitionClipboard());
    setTransitionContextMenu({
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 188)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 112)),
    });
  };
  const copySelectedTransition = async () => {
    if (!selectedRootTransitionSource) return;
    const payload = {
      transition: selectedRootTransitionSource.transition ?? { type: 'instant' },
      delay: selectedRootTransitionSource.delay ?? 0,
    };
    writeStoredTransitionClipboard(payload);
    setHasStoredTransitionClipboard(true);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
      } catch (error) {
        // Ignore clipboard permission failures and keep local storage copy.
      }
    }
    setTransitionContextMenu(null);
  };
  const pasteSelectedTransition = async () => {
    if (!selectedRootTransitionSource) return;
    let payload = readStoredTransitionClipboard();
    if (!payload && navigator.clipboard?.readText) {
      try {
        const raw = await navigator.clipboard.readText();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.transition) payload = parsed;
      } catch (error) {
        payload = null;
      }
    }
    if (!payload?.transition) {
      setTransitionContextMenu(null);
      return;
    }
    if (selectedRootTransitionSource.kind === 'variant-child') {
      updateComponentEditorVariantChildTransition(selectedRootTransitionSource.variantId, payload.transition);
    } else if (selectedRootTransitionSource._rootElementId) {
      updateComponentEditorElementInteraction(selectedRootTransitionSource._rootElementId, {
        targetVariantId: selectedRootTransitionSource.targetVariantId,
        trigger: selectedEditorVariant?.interaction?.trigger ?? element.base?.componentInteraction?.trigger ?? 'click',
        delay: typeof payload.delay === 'number' ? payload.delay : (element.base?.componentInteraction?.delay ?? 0),
        transition: payload.transition,
      });
    } else {
      updateComponentEditorVariantInteraction(selectedRootTransitionSource.variantId, {
        targetVariantId: selectedEditorVariant?.interaction?.targetVariantId,
        trigger: selectedEditorVariant?.interaction?.trigger ?? 'click',
        delay: typeof payload.delay === 'number' ? payload.delay : (selectedEditorVariant?.interaction?.delay ?? 0),
        transition: payload.transition,
      });
    }
    commit();
    setHasStoredTransitionClipboard(true);
    setTransitionContextMenu(null);
  };
  const openAnimationCardContextMenu = (event, animation) => {
    event.preventDefault();
    event.stopPropagation();
    setHasStoredAnimationClipboard(!!readStoredAnimationClipboard());
    setAnimationCardContextMenu({
      animationId: animation.id,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 188)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 112)),
    });
  };
  const openAnimationSectionContextMenu = (event) => {
    event.preventDefault();
    setHasStoredAnimationClipboard(!!readStoredAnimationClipboard());
    setAnimationCardContextMenu({
      animationId: null,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 188)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 112)),
    });
  };
  const openElementAnimationModal = (animationId, anchorSource = null) => {
    if (!animationId) return;
    setElementAnimationModalState({
      animationId,
      anchorRect: toViewportRect(anchorSource),
    });
  };
  const addAnimationFromMenu = (type) => {
    const nextId = addElementAnimation(element.id, bpId, type);
    if (!nextId) return;
    commit();
    setAnimationAddMenuOpen(false);
    openElementAnimationModal(nextId, animationPasteTargetRef.current);
  };
  const copyAnimationCard = async () => {
    if (!contextMenuAnimation) return;
    const payload = { animation: JSON.parse(JSON.stringify(contextMenuAnimation)) };
    writeStoredAnimationClipboard(payload);
    setHasStoredAnimationClipboard(true);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
      } catch (error) {
        // Ignore clipboard permission failures and keep local storage copy.
      }
    }
    setAnimationCardContextMenu(null);
  };
  const pasteAnimationCard = async () => {
    let payload = readStoredAnimationClipboard();
    if (!payload && navigator.clipboard?.readText) {
      try {
        const raw = await navigator.clipboard.readText();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.animation && typeof parsed.animation === 'object') payload = parsed;
      } catch (error) {
        payload = null;
      }
    }
    if (!payload?.animation) {
      setAnimationCardContextMenu(null);
      return;
    }
    const copiedAnimation = payload.animation;
    if (!contextMenuAnimation) {
      const nextId = addElementAnimation(element.id, bpId, copiedAnimation.type || 'enter');
      if (nextId) {
        updateElementAnimation(element.id, bpId, nextId, {
          ...copiedAnimation,
          id: nextId,
        });
        openElementAnimationModal(nextId, animationPasteTargetRef.current);
        commit();
      }
      setHasStoredAnimationClipboard(true);
      setAnimationCardContextMenu(null);
      setAnimationAddMenuOpen(false);
      return;
    }
    updateElementAnimation(element.id, bpId, contextMenuAnimation.id, {
      ...copiedAnimation,
      id: contextMenuAnimation.id,
      type: contextMenuAnimation.type,
      name: copiedAnimation.type === contextMenuAnimation.type
        ? (copiedAnimation.name ?? contextMenuAnimation.name)
        : contextMenuAnimation.name,
    });
    commit();
    setHasStoredAnimationClipboard(true);
    setAnimationCardContextMenu(null);
  };
  const shapeKind = getShapePresetKind(resolved) || getShapePresetKind(element);
  const vectorShapeData = ['path', 'pen'].includes(shapeKind ?? '') ? getVectorShapeData(resolved) || getVectorShapeData(element) : null;
  const selectedVectorPoint = activeVectorPoint?.elementId === element?.id && activeVectorPoint?.bpId === bpId && vectorShapeData
    ? vectorShapeData.points?.[activeVectorPoint.pointIndex] ?? null
    : null;
  const polygonSides = shapeKind === 'polygon'
    ? Math.max(3, Math.min(12, Math.round(normalizeFiniteNumber(resolved.polygonSides ?? element.base?.polygonSides ?? 6, 6))))
    : null;
  const applyVectorShapeUpdate = (nextVectorData, options = {}) => {
    if (!element || !nextVectorData) return;
    const reframed = reframeVectorShapeData(nextVectorData);
    updateElementLayout(element.id, bpId, {
      ...(Number.isFinite(options.x) ? { x: options.x } : {}),
      ...(Number.isFinite(options.y) ? { y: options.y } : {}),
      width: reframed.width,
      height: reframed.height,
      vectorData: reframed.vectorData,
      svgMarkup: buildVectorShapeSvgMarkup(reframed.vectorData, {
        width: reframed.width,
        height: reframed.height,
        fill: 'none',
        stroke: s.strokeColor ?? s.color ?? '#2563eb',
        strokeWidth: Math.max(0.5, s.strokeWidth || 1.5),
        lineCap: s.lineCap ?? 'round',
      }),
    });
  };
  const componentControlAuthoringSection = activeSurface === 'component' && !isAssetStorageSurface ? (
    <Section
      title="Component Variables"
      action={(
        <HeaderActionButton
          icon={UIIcons.plusCircle}
          title="Add variable"
          label="Add"
          onClick={() => {
            const defaultProperty = componentControlPropertyOptions[0]?.value ?? 'text';
            const inferredType = getComponentControlTypeForProperty(defaultProperty);
            const nextVariableName = `${(element?.name || componentControlPropertyOptions[0]?.label || 'variable')}`
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '') || 'variable';
            const nextControlId = addComponentEditorControl({
              name: nextVariableName,
              label: `${element?.name || 'Element'} ${componentControlPropertyOptions[0]?.label || 'Variable'}`,
              type: inferredType,
              defaultValue: getComponentControlDefaultValue(inferredType),
              options: inferredType === 'select' ? [{ label: 'Option 1', value: 'option-1' }] : [],
              bindings: componentControlTargetId
                ? [{ elementId: componentControlTargetId, property: defaultProperty }]
                : [],
            });
            if (nextControlId) commit();
          }}
        />
      )}
    >
      <div className="fb-artboard-bp-note" style={{ marginBottom: componentEditorControls.length ? 10 : 0 }}>
        Create named variables for this component, bind them to the selected layer, then edit them from component instances on the page.
      </div>
      {!componentEditorControls.length ? (
        <div className="fb-artboard-bp-note">No variables yet. Select a layer, then add one and bind it to text, source, visibility, or style properties.</div>
      ) : null}
      {componentEditorControls.map((control) => {
        const primaryBinding = control.bindings?.[0] ?? null;
        const bindingTargetLabel = primaryBinding?.elementId
          ? (componentSourceLabelMap.get(primaryBinding.elementId) ?? 'Bound element')
          : 'Not bound';
        return (
          <div key={control.id} className="fb-section-block" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Name</span>
              <input
                className="fb-prop-input"
                value={control.name ?? ''}
                onChange={(event) => updateComponentEditorControl(control.id, { name: event.target.value })}
                onBlur={commit}
                placeholder="hero_title"
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Title</span>
              <input
                className="fb-prop-input"
                value={control.label}
                onChange={(event) => updateComponentEditorControl(control.id, { label: event.target.value })}
                onBlur={commit}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Type</span>
              <select
                className="fb-prop-input"
                value={control.type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  const nextOptions = nextType === 'select'
                    ? (control.options?.length ? control.options : [{ label: 'Option 1', value: 'option-1' }])
                    : [];
                  updateComponentEditorControl(control.id, {
                    type: nextType,
                    options: nextOptions,
                    defaultValue: getComponentControlDefaultValue(nextType, nextOptions),
                  });
                  commit();
                }}
              >
                {COMPONENT_CONTROL_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Binding</span>
              <select
                className="fb-prop-input"
                value={primaryBinding?.elementId === componentControlTargetId ? (primaryBinding?.property ?? '') : ''}
                onChange={(event) => {
                  const nextProperty = event.target.value;
                  updateComponentEditorControl(control.id, {
                    bindings: nextProperty && componentControlTargetId
                      ? [{ elementId: componentControlTargetId, property: nextProperty }]
                      : [],
                  });
                  commit();
                }}
              >
                <option value="">Unbound</option>
                {componentControlPropertyOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="fb-artboard-bp-note" style={{ marginTop: -4, marginBottom: 8 }}>
              {primaryBinding
                ? `Exposed as ${getComponentVariableDisplayLabel(control)} and currently bound to ${bindingTargetLabel} · ${primaryBinding.property}`
                : 'Choose a property from the currently selected element to bind this variable.'}
            </div>
            {control.type === 'select' ? (
              <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Options</span>
                <textarea
                  className="fb-prop-input"
                  rows={3}
                  value={formatComponentControlOptionsText(control.options)}
                  onChange={(event) => updateComponentEditorControl(control.id, { options: parseComponentControlOptionsText(event.target.value) })}
                  onBlur={commit}
                />
              </div>
            ) : null}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Default</span>
              {control.type === 'boolean' ? (
                <Toggle
                  value={control.defaultValue === true}
                  onChange={(nextValue) => {
                    updateComponentEditorControl(control.id, { defaultValue: nextValue });
                    commit();
                  }}
                />
              ) : control.type === 'color' ? (
                <ColorInput
                  value={control.defaultValue || '#000000'}
                  onChange={(nextValue) => {
                    updateComponentEditorControl(control.id, { defaultValue: nextValue });
                    commit();
                  }}
                />
              ) : control.type === 'number' ? (
                <NumberInput
                  value={control.defaultValue ?? 0}
                  onChange={(nextValue) => {
                    updateComponentEditorControl(control.id, { defaultValue: nextValue });
                    commit();
                  }}
                />
              ) : control.type === 'select' ? (
                <select
                  className="fb-prop-input"
                  value={control.defaultValue ?? ''}
                  onChange={(event) => {
                    updateComponentEditorControl(control.id, { defaultValue: event.target.value });
                    commit();
                  }}
                >
                  {(control.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : control.type === 'textarea' ? (
                <textarea
                  className="fb-prop-input"
                  rows={3}
                  value={control.defaultValue ?? ''}
                  onChange={(event) => updateComponentEditorControl(control.id, { defaultValue: event.target.value })}
                  onBlur={commit}
                />
              ) : (
                <input
                  className="fb-prop-input"
                  type={control.type === 'url' || control.type === 'image' ? 'url' : 'text'}
                  value={control.defaultValue ?? ''}
                  onChange={(event) => updateComponentEditorControl(control.id, { defaultValue: event.target.value })}
                  onBlur={commit}
                />
              )}
            </div>
            <div className="fb-prop-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="fb-secondary-btn"
                onClick={() => {
                  removeComponentEditorControl(control.id);
                  commit();
                }}
              >
                Remove variable
              </button>
            </div>
          </div>
        );
      })}
    </Section>
  ) : null;

  const saveElementStyleAsset = () => {
    if (!element || !resolved) return;
    const nextStyle = buildPanelElementStyleAsset(element, resolved);
    if ((elementStyles ?? []).some((entry) => isSameAssetStyle(entry, nextStyle))) return;
    saveElementStyles([...(elementStyles ?? []), nextStyle]);
  };

  const saveTextStyleAsset = () => {
    if (!element || element.type !== 'text' || !resolved) return;
    const nextStyle = buildPanelTextStyleAsset(element, resolved);
    if ((textStyles ?? []).some((entry) => isSameAssetStyle(entry, nextStyle))) return;
    saveTextStyles([...(textStyles ?? []), nextStyle]);
  };

  const saveColorAsset = () => {
    const colorValue = typeof resolved?.styles?.backgroundColor === 'string' && resolved.styles.backgroundColor && !resolved.styles.backgroundColor.includes('gradient(')
      ? resolved.styles.backgroundColor
      : (typeof resolved?.styles?.color === 'string' ? resolved.styles.color : '');
    if (!colorValue) return;
    const nextStyle = {
      id: `clr-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${element?.name || element?.type || 'Color'} Color`,
      value: colorValue,
      source: 'builder',
      sourceId: element?.id || '',
    };
    const exists = (colorStyles ?? []).some((entry) => (`${entry?.name || ''}`.trim().toLowerCase() === nextStyle.name.trim().toLowerCase() && `${entry?.value || ''}` === nextStyle.value));
    if (exists) return;
    saveColorStyles([...(colorStyles ?? []), nextStyle]);
  };

  const saveAsAssetSection = (
    <Section title="Assets" defaultOpen={false}>
      <div className="fb-artboard-bp-note" style={{ marginBottom: 10 }}>
        Save the current layer styling into the Assets library, or jump straight to Storage.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="fb-secondary-btn" onClick={saveElementStyleAsset}>Save Element Style</button>
        {element?.type === 'text' ? <button type="button" className="fb-secondary-btn" onClick={saveTextStyleAsset}>Save Text Style</button> : null}
        <button type="button" className="fb-secondary-btn" onClick={saveColorAsset}>Save Color</button>
        <button type="button" className="fb-secondary-btn" onClick={openAssetStorage}>Open Storage</button>
      </div>
    </Section>
  );

  if (activeSurface === 'component' && !isAssetStorageSurface && element.componentRoot) {
    return (
      <>
        <aside className="fb-right">
          <div className="fb-right__header">{selectedEditorVariantLabel}</div>
          <div className="fb-panel-body">
            <Section title="Component">
              <div className="fb-prop-row">
                <span className="fb-prop-label">Name</span>
                <input
                  className="fb-prop-input"
                  value={componentEditor.page?.title ?? editingComponentMeta?.name ?? ''}
                  onChange={(event) => updateEditingComponentMeta({ name: event.target.value })}
                  onBlur={commit}
                  placeholder="Component name"
                />
              </div>
              <div className="fb-artboard-bp-note">
                This name is shown in the assets list and in the instance properties panel.
              </div>
            </Section>
            <Section title="Size">
              <div className="fb-size-section" style={{ marginBottom: 6 }}>
                <div className="fb-size-section__rows fb-size-section__rows--compact">
                  <div className="fb-quad">
                    <NumberInput
                      value={resolved.width ?? 240}
                      min={20}
                      label="W"
                      onChange={v => { applyFixedSizeChange('width', Math.max(20, v)); commit(); }}
                    />
                    <NumberInput
                      value={resolved.height ?? 160}
                      min={20}
                      label="H"
                      onChange={v => { applyFixedSizeChange('height', Math.max(20, v)); commit(); }}
                    />
                  </div>
                  <div className="fb-size-aspect-row">
                    <span className="fb-size-aspect-row__label">Aspect</span>
                    <button
                      type="button"
                      className={`fb-size-aspect-toggle${aspectRatioLocked ? ' is-active' : ''}`}
                      onClick={() => { upd('lockAspectRatio', !aspectRatioLocked); commit(); }}
                    >
                      <span className="fb-size-aspect-toggle__icon" aria-hidden="true">{UIIcons.link}</span>
                      <span>{aspectRatioLocked ? 'Locked' : 'Unlocked'}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="fb-artboard-bp-note">
                {selectedEditorVariant?.mode === 'hover' || selectedEditorVariant?.mode === 'pressed'
                  ? 'This state inherits from its parent variant. Only the properties you override here stay different.'
                  : selectedEditorVariant?.name === 'Primary'
                    ? 'Primary defines the base component size. Other variants inherit from it unless they override width or height.'
                    : 'This variant inherits from Primary until you override its size here. Instances on the main canvas can still be resized independently.'}
              </div>
            </Section>
            {isDefaultVariant(selectedEditorVariant) ? (
              <Section title="Transition">
                {selectedRootTransitionSource ? (
                  <>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Type</span>
                      <button
                        type="button"
                        className="fb-secondary-btn fb-prop-action-btn"
                        onContextMenu={openTransitionContextMenu}
                        onClick={() => setTransitionModalState(
                          selectedRootTransitionSource.kind === 'variant-child'
                            ? {
                                kind: 'variant-child',
                                variantId: selectedRootTransitionSource.variantId,
                                targetName: childInteractionCountForSelectedVariant === 1
                                  ? (selectedRootTransitionTarget?.name || 'Connected child variant')
                                  : `${childInteractionCountForSelectedVariant} child connections`,
                              }
                            : { kind: 'variant', variantId: selectedRootTransitionSource.variantId }
                        )}
                      >
                        {getTransitionSummary({ targetVariantId: selectedRootTransitionSource.targetVariantId || 'child', transition: selectedRootTransitionSource.transition })}
                      </button>
                    </div>
                    <div className="fb-artboard-bp-note">
                      {selectedRootTransitionSource.kind === 'variant-child'
                        ? `Applies this transition style to all child connections in ${selectedRootTransitionSource.sourceName || 'this variant'}.`
                        : `Animates ${selectedRootTransitionSource.sourceName || 'this variant'} to ${selectedRootTransitionTarget?.name || 'the target variant'} on component change.`}
                    </div>
                  </>
                ) : childInteractionCountForSelectedVariant > 0 && element.componentRoot ? (
                  <div className="fb-artboard-bp-note">
                    This variant has {childInteractionCountForSelectedVariant} connected child transition{childInteractionCountForSelectedVariant === 1 ? '' : 's'}. Select a connected layer to edit one.
                  </div>
                ) : (
                  <div className="fb-artboard-bp-note">
                    Connect this variant to another variant first. Then you can edit how the change animates here.
                  </div>
                )}
              </Section>
            ) : null}
          </div>
        </aside>
        {transitionModalState && transitionEditorSource && transitionEditorTarget && typeof document !== 'undefined' ? createPortal(
          <VariantTransitionModal
            sourceName={transitionEditorSource.sourceName}
            targetName={transitionEditorTarget.name}
            initialTransition={transitionEditorSource.kind === 'variant-child' ? transitionEditorSource.transition : transitionEditorSource.interaction?.transition}
            initialDelay={transitionEditorSource.kind === 'variant-child' ? 0 : (transitionEditorSource.interaction?.delay ?? 0)}
            onCancel={() => setTransitionModalState(null)}
            onSave={({ transition, delay }) => {
              if (transitionEditorSource.kind === 'variant-child') {
                updateComponentEditorVariantChildTransition(transitionEditorSource.variant.id, transition);
              } else if (transitionEditorSource._rootElementId) {
                updateComponentEditorElementInteraction(transitionEditorSource._rootElementId, {
                  targetVariantId: transitionEditorSource.interaction?.targetVariantId,
                  trigger: transitionEditorSource.interaction?.trigger ?? 'click',
                  delay,
                  transition,
                });
              } else {
                updateComponentEditorVariantInteraction(transitionEditorSource.variant.id, {
                  targetVariantId: transitionEditorSource.interaction?.targetVariantId,
                  trigger: transitionEditorSource.interaction?.trigger ?? 'click',
                  delay,
                  transition,
                });
              }
              commit();
              setTransitionModalState(null);
            }}
          />,
          document.body,
        ) : null}
        {transitionContextMenu && typeof document !== 'undefined' ? createPortal(
          <div
            className="fb-context-menu"
            style={{ left: transitionContextMenu.x, top: transitionContextMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="fb-context-menu__item" onClick={copySelectedTransition}>Copy transition</button>
            <button type="button" className="fb-context-menu__item" onClick={pasteSelectedTransition} disabled={!hasStoredTransitionClipboard}>Paste transition</button>
          </div>,
          document.body,
        ) : null}
      </>
    );
  }

  // Override helpers — only meaningful on tablet/mobile breakpoints
  const bpOv  = bpId !== 'desktop' ? (element.overrides?.[bpId] ?? {}) : {};
  const bpSOv = bpOv.styles ?? {};
  const isOv  = (...keys) => bpId !== 'desktop' && keys.some(k => k in bpOv);
  const isSOv = (...keys) => bpId !== 'desktop' && keys.some(k => k in bpSOv);
  const resetOv  = (...keys) => { keys.forEach(k => removeOverrideFn(element.id, bpId, k)); commit(); };
  const resetSOv = (...keys) => { keys.forEach(k => removeStyleOverrideFn(element.id, bpId, k)); commit(); };
  const has3DRotation = hasElement3DRotation(resolved);
  const textBinding = getBindingForProperty('text');
  const fontFamilyBinding = getBindingForProperty('styles.fontFamily');
  const textColorBinding = getBindingForProperty('styles.color');
  const iconColorBinding = getBindingForProperty('styles.color');
  const hiddenBinding = getBindingForProperty('hidden');
  const linkUrlBinding = getBindingForProperty('linkUrl');
  const fillBinding = getBindingForProperty('styles.backgroundColor');
  const backgroundImageBinding = getBindingForProperty('styles.backgroundImage');
  const sourceBinding = getBindingForProperty('src');
  const zIndexBinding = getBindingForProperty('styles.zIndex');
  const textBindingVariable = getInlineBoundVariable('text');
  const fontFamilyBindingVariable = getInlineBoundVariable('styles.fontFamily');
  const textColorBindingVariable = getInlineBoundVariable('styles.color');
  const iconColorBindingVariable = getInlineBoundVariable('styles.color');
  const hiddenBindingVariable = getInlineBoundVariable('hidden');
  const linkUrlBindingVariable = getInlineBoundVariable('linkUrl');
  const fillBindingVariable = getInlineBoundVariable('styles.backgroundColor');
  const backgroundImageBindingVariable = getInlineBoundVariable('styles.backgroundImage');
  const sourceBindingVariable = getInlineBoundVariable('src');
  const zIndexBindingVariable = getInlineBoundVariable('styles.zIndex');

  return (
    <>
    <aside className={`fb-right${selectedElementAnimation ? ' fb-right--loop-popup-open' : ''}`} ref={selectedPanelRef}>
      <div className="fb-right__header">
        <span className="fb-right__header-title">
          {element.name || element.type}
        </span>
        <div className="fb-right__header-actions">
          <HeaderActionButton
            icon={UIIcons.trash}
            title="Delete element"
            label="Delete"
            onClick={() => { deleteElement(element.id); pushHistory(); }}
          />
        </div>
      </div>

      <div className="fb-panel-body">

        {activeSurface === 'page' ? (
          <InteractionSection
            flow={selectedElementFlow}
            legacyInteractions={interactions}
            onOpenFlow={handleOpenInteractionFlow}
            onMigrateLegacy={handleMigrateLegacyInteractions}
          />
        ) : null}

        {activeSurface === 'component' && !isAssetStorageSurface && !element.componentRoot ? (
          null
        ) : null}

        {isComponentInstanceOnPage && componentMeta ? (
          <Section title="Component">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Name</span>
              <div className="fb-prop-value">{componentMeta.name}</div>
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Variant</span>
              <select
                className="fb-prop-input"
                value={componentVariantId}
                onChange={e => {
                  changeComponentInstanceVariant(element.id, e.target.value);
                  commit();
                }}
              >
                {componentVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>{variant.name}</option>
                ))}
              </select>
            </div>
            {(componentMeta.controls ?? []).map((control) => {
              const value = getComponentControlEffectiveValue(control, element.componentInstance?.props ?? {});
              const variableDisplayName = getComponentVariableDisplayLabel(control);
              const boundVariable = getComponentInstanceBoundVariable(control.id);
              return (
                <div key={control.id} className="fb-prop-row" style={{ alignItems: control.type === 'textarea' ? 'flex-start' : 'center' }}>
                  <VariableBindingLabel label={variableDisplayName}>
                    {renderComponentInstanceBindingButton(control)}
                  </VariableBindingLabel>
                  {boundVariable ? (
                    <BoundVariableCta variable={boundVariable} fallbackLabel={variableDisplayName} />
                  ) : control.type === 'boolean' ? (
                    <Toggle
                      value={value === true}
                      onChange={(nextValue) => {
                        updateComponentInstanceProp(element.id, control.id, nextValue);
                        commit();
                      }}
                    />
                  ) : control.type === 'color' ? (
                    <ColorInput
                      value={value || '#000000'}
                      onChange={(nextValue) => {
                        updateComponentInstanceProp(element.id, control.id, nextValue);
                        commit();
                      }}
                    />
                  ) : control.type === 'number' ? (
                    <NumberInput
                      value={value ?? 0}
                      onChange={(nextValue) => {
                        updateComponentInstanceProp(element.id, control.id, nextValue);
                        commit();
                      }}
                    />
                  ) : control.type === 'select' ? (
                    <select
                      className="fb-prop-input"
                      value={value ?? ''}
                      onChange={(event) => {
                        updateComponentInstanceProp(element.id, control.id, event.target.value);
                        commit();
                      }}
                    >
                      {(control.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : control.type === 'textarea' ? (
                    <textarea
                      className="fb-prop-input"
                      rows={3}
                      value={value ?? ''}
                      onChange={(event) => updateComponentInstanceProp(element.id, control.id, event.target.value)}
                      onBlur={commit}
                    />
                  ) : (
                    <input
                      className="fb-prop-input"
                      type={control.type === 'url' || control.type === 'image' ? 'url' : 'text'}
                      value={value ?? ''}
                      onChange={(event) => updateComponentInstanceProp(element.id, control.id, event.target.value)}
                      onBlur={commit}
                    />
                  )}
                </div>
              );
            })}
          </Section>
        ) : null}

        {saveAsAssetSection}

        {activeSurface === 'page' ? (
          <Section
            title={(
              <span className="fb-section-title-with-badge">
                <span>Animation</span>
                {resolvedAnimations.length ? <span className="fb-section-badge is-active">{resolvedAnimations.length}</span> : null}
              </span>
            )}
          >
            <div onContextMenu={openAnimationSectionContextMenu}>
            {bpId !== 'desktop' && !Array.isArray(element.animations?.[bpId]) ? (
              <div className="fb-artboard-bp-note">Animations inherit from desktop here until you change this breakpoint.</div>
            ) : null}
            {resolvedAnimations.length ? (
              <div className="fb-animation-section__list">
                {resolvedAnimations.map((animation) => (
                  <button
                    key={animation.id}
                    type="button"
                    className="fb-animation-card is-configured"
                    onClick={(event) => openElementAnimationModal(animation.id, event.currentTarget)}
                    onContextMenu={(event) => openAnimationCardContextMenu(event, animation)}
                  >
                    <span className="fb-animation-card__type-row">
                      <span className="fb-animation-card__type">{getElementAnimationTypeLabel(animation.type)}</span>
                      {animation.type === 'loop' || animation.type === 'hover' ? (
                        <span
                          className={`fb-loop-indicator${((animation.type === 'loop' ? loopAnimationPreview : hoverAnimationPreview)?.animationId === animation.id) ? ' is-live' : ''}`}
                          aria-label={animation.type === 'loop' ? 'Loop animation' : 'Hover animation'}
                          title={animation.type === 'loop' ? 'Loop animation' : 'Hover animation'}
                        />
                      ) : null}
                    </span>
                    <span className="fb-animation-card__name">{animation.name}</span>
                    <span className="fb-animation-card__summary">{getElementAnimationSummary(animation, animationVariantOptions)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="fb-artboard-bp-note">Add an appear, scroll, hover, loop, or scroll-variant animation for this element.</div>
            )}
            <div
              className={`fb-animation-section__paste-target${hasStoredAnimationClipboard ? ' is-ready' : ''}`}
              onContextMenu={openAnimationSectionContextMenu}
              title={hasStoredAnimationClipboard ? 'Right-click to paste animation' : 'Right-click for animation actions'}
              ref={animationPasteTargetRef}
            >
              <div className="fb-animation-section__actions">
                <span>{hasStoredAnimationClipboard ? 'Right-click here to paste animation' : 'Right-click here for animation actions'}</span>
                <div className="fb-animation-section__add-wrap">
                  <button
                    type="button"
                    className="fb-secondary-btn fb-animation-section__paste-action"
                    onClick={() => setAnimationAddMenuOpen((current) => !current)}
                  >
                    <span>{resolvedAnimations.length ? 'Add More' : 'Add'}</span>
                    <span className="fb-animation-section__paste-action-icon" aria-hidden="true">{UIIcons.chevronDown}</span>
                  </button>
                  {animationAddMenuOpen ? (
                    <div className="fb-animation-section__add-menu">
                      <button type="button" className="fb-animation-section__add-menu-item" onClick={() => addAnimationFromMenu('enter')}>Appear</button>
                      <button type="button" className="fb-animation-section__add-menu-item" onClick={() => addAnimationFromMenu('scroll')}>Scroll</button>
                      <button type="button" className="fb-animation-section__add-menu-item" onClick={() => addAnimationFromMenu('loop')}>Loop</button>
                      <button type="button" className="fb-animation-section__add-menu-item" onClick={() => addAnimationFromMenu('hover')}>Hover</button>
                      <button
                        type="button"
                        className="fb-animation-section__add-menu-item"
                        disabled={!isComponentInstanceOnPage || !animationVariantOptions.length}
                        onClick={() => {
                          if (!isComponentInstanceOnPage || !animationVariantOptions.length) return;
                          addAnimationFromMenu('scroll-variant');
                        }}
                      >
                        Scroll Variant
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            </div>
          </Section>
        ) : null}

        {/* ── Align strip (top of panel, active for absolute/fixed) ─── */}
        <AlignStrip
          resolved={resolved}
          containerW={containerW}
          containerH={containerH}
          upd={upd}
          commit={commit}
          disabled={['relative', 'sticky'].includes(resolved.positionType ?? 'absolute') || isFlowInLayout}
        />

        {/* ── Position ──────────────────────────────────────── */}
        <Section title="Position" action={<ResetBtn show={isOv('x','y','constraints','positionType')} onReset={() => resetOv('x','y','constraints','positionType')} />}>
          {/* Auto-layout position override — full type selector incl. exceptions */}
          {inAutoLayout && (
            <div className="fb-prop-row" style={{ marginBottom: 6 }}>
              <span className="fb-prop-label">Position</span>
              <select
                className="fb-prop-input"
                value={(() => {
                  if (!resolved.absoluteInLayout) {
                    return (resolved.positionType ?? 'relative') === 'sticky' ? 'sticky' : 'auto';
                  }
                  return resolved.positionType ?? 'absolute';
                })()}
                onChange={e => {
                  const v = e.target.value;
                  if (v === 'auto') {
                    updateElementLayout(element.id, bpId, {
                      absoluteInLayout: false,
                      positionType: resolved.positionType === 'fixed' ? 'fixed' : 'relative',
                    });
                  } else if (v === 'relative' || v === 'sticky') {
                    updateElementLayout(element.id, bpId, {
                      absoluteInLayout: false,
                      positionType: v,
                      ...(v === 'sticky' ? { x: 0, y: Math.max(0, resolved.y ?? 0) } : {}),
                    });
                  } else {
                    // Mark as exception from auto-layout flow
                    updateElementLayout(element.id, bpId, { absoluteInLayout: true, positionType: v });
                  }
                  commit();
                }}
              >
                <option value="auto">Auto (flow)</option>
                <option value="absolute">Absolute</option>
                <option value="fixed">Fixed</option>
                <option value="relative">Relative</option>
                <option value="sticky">Sticky</option>
              </select>
            </div>
          )}
          {((resolved.positionType ?? 'absolute') === 'sticky' || (!isFlowInLayout && ['absolute', 'fixed'].includes(resolved.positionType ?? 'absolute'))) && (
            <>
              <div className="fb-pos-widget">
                <div className="fb-pos-widget__row">
                  <PosInput value={(resolved.positionType ?? 'absolute') === 'sticky' ? Math.max(0, resolved.y ?? 0) : (resolved.y ?? 0)} label="T" onChange={v => { upd('y', (resolved.positionType ?? 'absolute') === 'sticky' ? Math.max(0, v) : v); commit(); }} />
                </div>
                {(resolved.positionType ?? 'absolute') !== 'sticky' ? (
                  <div className="fb-pos-widget__row">
                    <PosInput value={resolved.x ?? 0} label="L" onChange={v => { upd('x', v); commit(); }} />
                    <ConstraintWidget
                      constraints={resolved.constraints}
                      onChange={v => { upd('constraints', { ...v, horizontal: getConstraintMode(v, 'horizontal'), vertical: getConstraintMode(v, 'vertical') }); commit(); }}
                    />
                    <PosInput
                      value={containerW - (resolved.x ?? 0) - (resolved.width ?? 100)}
                      label="R"
                      onChange={v => { upd('x', containerW - v - (resolved.width ?? 100)); commit(); }}
                    />
                  </div>
                ) : (
                  <div className="fb-artboard-bp-note" style={{ marginTop: 6 }}>
                    Sticky uses only the top offset and follows flow layout.
                  </div>
                )}
                {(resolved.positionType ?? 'absolute') !== 'sticky' ? (
                  <div className="fb-pos-widget__row">
                    <PosInput
                      value={effectiveContainerH - (resolved.y ?? 0) - (resolved.height ?? 100)}
                      label="B"
                      onChange={v => { upd('y', effectiveContainerH - v - (resolved.height ?? 100)); commit(); }}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
          {/* Type dropdown — shown outside auto-layout context */}
          {!inAutoLayout && (
            <div className="fb-prop-row" style={{ marginTop: 6 }}>
              <span className="fb-prop-label">Type</span>
              <select
                className="fb-prop-input"
                value={resolved.positionType ?? 'absolute'}
                onChange={e => { upd('positionType', e.target.value); commit(); }}
              >
                <option value="absolute">Absolute</option>
                <option value="fixed">Fixed</option>
                <option value="relative">Relative</option>
              </select>
            </div>
          )}
        </Section>

        {/* ── Size ──────────────────────────────────────────── */}
        <Section title="Size" action={<ResetBtn show={isOv('width','widthMode','widthPct','widthFr','height','heightMode','heightPct','heightFr','minW','maxW','minH','maxH','lockAspectRatio')} onReset={() => resetOv('width','widthMode','widthPct','widthFr','height','heightMode','heightPct','heightFr','minW','maxW','minH','maxH','lockAspectRatio')} />}>
          <div className="fb-size-section">
            <div className="fb-size-section__rows">
          {/* Width row */}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Width</span>
            <div className="fb-size-row">
              {/* Value input — shown for all modes except hug */}
              {(() => {
                const wm = resolved.widthMode ?? 'fixed';
                if (wm === 'hug') return <div className="fb-prop-mini" style={{ flex: 1 }} />;
                if (wm === 'fill') return <NumberInput key="wfr" value={resolved.widthFr ?? 1} min={0.1} step={0.1} unit="fr" label="fr" onChange={v => { upd('widthFr', v); commit(); }} />;
                if (wm === 'relative') return <NumberInput key="wpct" value={resolved.widthPct ?? resolved.width ?? 100} min={0} max={100} step={1} unit="%" label="%" onChange={v => { upd('widthPct', v); commit(); }} />;
                return <NumberInput key="wpx" value={resolved.width ?? 100} min={1} unit="px" onChange={v => { applyFixedSizeChange('width', v); commit(); }} />;
              })()}
              <select
                className="fb-prop-input fb-size-mode"
                value={resolved.widthMode ?? 'fixed'}
                onChange={e => { upd('widthMode', e.target.value); commit(); }}
              >
                      <option value="fixed">Fixed</option>
                      <option value="fill" disabled={isComponentRoot}>Fill</option>
                      <option value="relative">Rel</option>
                <option value="hug">Hug</option>
              </select>
            </div>
          </div>
          {/* Height row */}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Height</span>
            <div className="fb-size-row">
              {(() => {
                const hm = resolved.heightMode ?? 'fixed';
                if (hm === 'hug') return <div className="fb-prop-mini" style={{ flex: 1 }} />;
                if (hm === 'fill') return <NumberInput key="hfr" value={resolved.heightFr ?? 1} min={0.1} step={0.1} unit="fr" label="fr" onChange={v => { upd('heightFr', v); commit(); }} />;
                if (hm === 'relative') return <NumberInput key="hpct" value={resolved.heightPct ?? resolved.height ?? 100} min={0} max={100} step={1} unit="%" label="%" onChange={v => { upd('heightPct', v); commit(); }} />;
                return <NumberInput key="hpx" value={resolved.height ?? 100} min={1} unit="px" onChange={v => { applyFixedSizeChange('height', v); commit(); }} />;
              })()}
              <select
                className="fb-prop-input fb-size-mode"
                value={resolved.heightMode ?? 'fixed'}
                onChange={e => { upd('heightMode', e.target.value); commit(); }}
              >
                <option value="fixed">Fixed</option>
                <option value="fill" disabled={isComponentRoot}>Fill</option>
                <option value="relative">Rel</option>
                <option value="hug">Hug</option>
              </select>
            </div>
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Aspect</span>
            <div className="fb-size-aspect-row">
              <button
                type="button"
                className={`fb-size-aspect-toggle${aspectRatioLocked ? ' is-active' : ''}`}
                onClick={() => { upd('lockAspectRatio', !aspectRatioLocked); commit(); }}
              >
                <span className="fb-size-aspect-toggle__icon" aria-hidden="true">{UIIcons.link}</span>
                <span>{aspectRatioLocked ? 'Locked' : 'Unlocked'}</span>
              </button>
            </div>
          </div>
            </div>
          </div>
          {isComponentRoot && (
            <div className="fb-artboard-bp-note" style={{ marginTop: 6 }}>
              Top-level component layers use the free canvas. `Fill` is disabled here to avoid unbounded component width or height.
            </div>
          )}
          <MinMaxRow resolved={resolved} upd={upd} commit={commit} />
        </Section>

        <Section title="Transform" action={<ResetBtn show={isOv('rotation','rotationX','rotationY')} onReset={() => resetOv('rotation','rotationX','rotationY')} />}>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Mode</span>
            <ChoiceGroup
              value={singleTransformMode}
              onChange={(value) => {
                setSingleTransformMode(value);
                if (value === '2d') {
                  upd('rotationX', 0);
                  upd('rotationY', 0);
                  commit();
                }
              }}
              options={[
                { value: '2d', label: '2D' },
                { value: '3d', label: '3D' },
              ]}
            />
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Rotate Z</span>
            <NumberInput value={resolved.rotation ?? 0} min={-360} max={360} onChange={v => { upd('rotation', v); commit(); }} label="°" unit="°" />
          </div>
          {singleTransformMode === '3d' ? (
            <>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Rotate X</span>
                <NumberInput value={resolved.rotationX ?? 0} min={-360} max={360} onChange={v => { upd('rotationX', v); commit(); }} label="°" unit="°" />
              </div>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Rotate Y</span>
                <NumberInput value={resolved.rotationY ?? 0} min={-360} max={360} onChange={v => { upd('rotationY', v); commit(); }} label="°" unit="°" />
              </div>
            </>
          ) : null}
          <div className="fb-artboard-bp-note" style={{ marginTop: 6 }}>
            Rotate Z is the flat 2D turn. Switch to 3D to edit X and Y tilt{has3DRotation ? ', which are active on this layer now.' : '.'}
          </div>
        </Section>

        {shapeKind ? (
          <Section title="Shape">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Type</span>
              <div className="fb-prop-value">{getShapeTypeLabel(shapeKind)}</div>
            </div>

            {shapeKind === 'polygon' ? (
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Sides</span>
                <NumberInput
                  value={polygonSides}
                  min={3}
                  max={12}
                  step={1}
                  onChange={(value) => {
                    const nextSides = Math.max(3, Math.min(12, Math.round(normalizeFiniteNumber(value, 6))));
                    upd('polygonSides', nextSides);
                    upd('svgMarkup', buildPolygonSvgMarkup(nextSides));
                    commit();
                  }}
                />
              </div>
            ) : null}

            {shapeKind === 'circle' ? <div className="fb-artboard-bp-note">Circle is a true 1:1 shape. Resize it to change the diameter; aspect ratio stays locked.</div> : null}
            {shapeKind === 'line' ? <div className="fb-artboard-bp-note">Line endpoints are editable on canvas. Drag either endpoint directly in the selection overlay.</div> : null}
            {shapeKind === 'path' ? <div className="fb-artboard-bp-note">Path anchors and Bezier handles are editable on canvas when the shape is selected.</div> : null}
            {shapeKind === 'pen' ? <div className="fb-artboard-bp-note">Pen now draws anchor-based Bezier paths. Click to add points, drag to pull handles, click the first anchor to close, then press Enter or Escape to finish an open path.</div> : null}

            {(shapeKind === 'circle' || shapeKind === 'polygon') ? (
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Fill</span>
                <div style={{ width: '100%' }}>
                  <FillPicker value={s.color ?? '#111827'} onChange={(value) => { updS('color', value); commit(); }} solidOnly />
                </div>
              </div>
            ) : null}

            {(shapeKind === 'path' || shapeKind === 'pen') && vectorShapeData ? (
              <>
                {vectorShapeData.closed ? (
                  <div className="fb-prop-row" style={{ marginTop: 8 }}>
                    <span className="fb-prop-label">Fill</span>
                    <div style={{ width: '100%' }}>
                      <FillPicker value={s.backgroundColor ?? 'rgba(37,99,235,0.16)'} onChange={(value) => { updS('backgroundColor', value); commit(); }} />
                    </div>
                  </div>
                ) : null}

                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Selected anchor</span>
                  <div className="fb-prop-value">{selectedVectorPoint ? `#${activeVectorPoint.pointIndex + 1}` : 'None'}</div>
                </div>

                {selectedVectorPoint ? (
                  <>
                    <div className="fb-prop-row" style={{ marginTop: 8 }}>
                      <span className="fb-prop-label">Anchor mode</span>
                      <ChoiceGroup
                        value={selectedVectorPoint.mode === 'smooth' ? 'smooth' : 'corner'}
                        onChange={(value) => {
                          const nextVectorData = setVectorAnchorMode(vectorShapeData, activeVectorPoint.pointIndex, value === 'smooth' ? 'smooth' : 'corner');
                          applyVectorShapeUpdate(nextVectorData);
                          commit();
                        }}
                        options={[
                          { value: 'corner', label: 'Corner' },
                          { value: 'smooth', label: 'Smooth' },
                        ]}
                      />
                    </div>

                    <div className="fb-prop-row" style={{ marginTop: 8 }}>
                      <span className="fb-prop-label">Anchor actions</span>
                      <div className="fb-style-inline-group" style={{ width: '100%' }}>
                        <button
                          type="button"
                          className="fb-secondary-btn fb-btn--sm"
                          onClick={() => {
                            const removal = removeVectorAnchor(vectorShapeData, activeVectorPoint.pointIndex);
                            if (!removal.removed) return;
                            applyVectorShapeUpdate(removal.vectorData);
                            const nextIndex = Math.max(0, Math.min(activeVectorPoint.pointIndex - 1, removal.vectorData.points.length - 1));
                            if (removal.vectorData.points.length > 0) setActiveVectorPoint({ elementId: element.id, bpId, pointIndex: nextIndex });
                            else clearActiveVectorPoint();
                            commit();
                          }}
                        >
                          Delete anchor
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="fb-artboard-bp-note">Click an anchor on canvas to edit its mode, or double-click the path to insert a new anchor.</div>
                )}
              </>
            ) : null}

            {element.type === 'icon' ? (
              <>
                <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <VariableBindingLabel label={shapeKind === 'polygon' ? 'Fill' : (shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen' ? 'Stroke' : 'Color')}>
                    {allowVariableBindings ? (
                      renderInlineBindingButton('styles.color', (value) => updateStyles(element.id, bpId, shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen'
                        ? { color: value || '#111827', strokeColor: value || '#111827' }
                        : { color: value || '#111827' }), {
                        label: `${shapeKind === 'polygon' ? 'Fill' : (shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen' ? 'Stroke' : 'Color')}`,
                        fallbackLabel: shapeKind === 'polygon' ? 'Fill' : (shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen' ? 'Stroke' : 'Color'),
                        createMeta: 'Create a component color variable for this shape',
                      })
                    ) : null}
                  </VariableBindingLabel>
                  <div style={{ width: '100%' }}>
                    {iconColorBindingVariable ? <BoundVariableCta variable={iconColorBindingVariable} fallbackLabel="Color variable" /> : <FillPicker value={(shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen') ? (s.strokeColor ?? s.color ?? '#111827') : (s.color ?? '#111827')} onChange={(value) => {
                      updS('color', value);
                      if (shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen') updS('strokeColor', value);
                      commit();
                    }} />}
                  </div>
                </div>

                {shapeKind === 'polygon' || shapeKind === 'line' || shapeKind === 'path' || shapeKind === 'pen' ? (
                  <div className="fb-prop-row" style={{ marginTop: 8 }}>
                    <span className="fb-prop-label">Stroke</span>
                    {(s.strokeWidth ?? 0) > 0 ? (
                      <div className="fb-style-inline-group fb-style-inline-group--stacked" style={{ width: '100%' }}>
                        <NumberInput value={s.strokeWidth ?? 0} min={0} step={0.1} onChange={v => { updS('strokeWidth', v); commit(); }} />
                        <FillPicker value={s.strokeColor ?? (s.color ?? '#111827')} onChange={v => { updS('strokeColor', v); commit(); }} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="fb-add-field"
                        onClick={() => {
                          updS('strokeWidth', shapeKind === 'line' ? 2 : 1);
                          updS('strokeColor', s.color ?? '#111827');
                          commit();
                        }}
                      >
                        Add...
                      </button>
                    )}
                  </div>
                ) : null}
                {shapeKind === 'line' ? (
                  <div className="fb-prop-row" style={{ marginTop: 4 }}>
                    <span className="fb-prop-label">Cap</span>
                    <select
                      className="fb-select"
                      value={s.lineCap ?? 'round'}
                      onChange={e => { updS('lineCap', e.target.value); commit(); }}
                    >
                      <option value="round">Round</option>
                      <option value="butt">Butt</option>
                      <option value="square">Square</option>
                    </select>
                  </div>
                ) : null}
              </>
            ) : null}
          </Section>
        ) : null}

        {(element.type === 'text' || isFormSubmitButton) && (
          <Section title="Text" action={<ResetBtn show={isOv('text','richTextHtml') || isSOv('color','strokeWidth','strokeColor','fontFamily','fontWeight','fontStyle','fontSize','fontSizeUnit','letterSpacing','letterSpacingUnit','lineHeight','lineHeightUnit','textAlign','textDecoration')} onReset={() => { resetOv('text','richTextHtml'); resetSOv('color','strokeWidth','strokeColor','fontFamily','fontWeight','fontStyle','fontSize','fontSizeUnit','letterSpacing','letterSpacingUnit','lineHeight','lineHeightUnit','textAlign','textDecoration'); }} />}>
            {element.type === 'text' ? (
              <>
                <div className="fb-prop-row" style={{ marginBottom: 8 }}>
                  <VariableBindingLabel label="Content">
                    {allowVariableBindings ? (
                      renderInlineBindingButton('text', (value) => updText(`${value ?? ''}`), {
                        label: 'Text Content',
                        fallbackLabel: 'Content',
                        createMeta: 'Create a component text variable for this layer',
                      })
                    ) : null}
                  </VariableBindingLabel>
                  {textBindingVariable ? <BoundVariableCta variable={textBindingVariable} fallbackLabel="Text source" /> : <div className="fb-prop-value">Text source</div>}
                </div>
                {textBindingVariable ? null : (
                  <div className="fb-prop-row--full" style={{ marginBottom: 8 }}>
                    <textarea
                      className="fb-prop-input"
                      value={resolved.text ?? 'Text'}
                      onChange={e => updText(e.target.value)}
                      onBlur={commit}
                      rows={4}
                      style={{ width: '100%', resize: 'vertical', minHeight: 92, lineHeight: 1.4 }}
                    />
                  </div>
                )}
              </>
            ) : null}

            <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
              <VariableBindingLabel label="Font">
                {allowVariableBindings ? (
                  renderInlineBindingButton('styles.fontFamily', (value) => updateStyles(element.id, bpId, { fontFamily: `${value ?? ''}` }), {
                    label: 'Font Family',
                    fallbackLabel: 'Font',
                    createMeta: 'Create a component font variable for this layer',
                  })
                ) : null}
              </VariableBindingLabel>
              {fontFamilyBindingVariable ? (
                <BoundVariableCta variable={fontFamilyBindingVariable} fallbackLabel="Font variable" />
              ) : (
                <div style={{ flex: 1 }}>
                  <GoogleFontPicker
                    value={s.fontFamily ?? 'Inter'}
                    onChange={value => commitFontFamily([element.id], bpId, value)}
                    onPreviewChange={(value) => previewFontFamily([element.id], bpId, value)}
                    onPreviewReset={resetFontPreview}
                  />
                </div>
              )}
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Weight</span>
              <select
                className="fb-prop-input"
                value={String(s.fontWeight ?? 400)}
                onChange={e => { updS('fontWeight', Number(e.target.value)); commit(); }}
              >
                {FONT_WEIGHT_OPTIONS.map(weight => (
                  <option key={weight} value={weight}>{weight}</option>
                ))}
              </select>
            </div>

            <div className="fb-prop-row" style={{ marginTop: 6 }}>
              <span className="fb-prop-label">Style</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <IconButton icon={UIIcons.regular} title="Regular" active={(s.fontStyle ?? 'normal') === 'normal'} onClick={() => { updS('fontStyle', 'normal'); commit(); }} />
                <IconButton icon={UIIcons.italic} title="Italic" active={s.fontStyle === 'italic'} onClick={() => { updS('fontStyle', s.fontStyle === 'italic' ? 'normal' : 'italic'); commit(); }} />
                <IconButton icon={UIIcons.underline} title="Underline" active={(s.textDecoration ?? 'none') === 'underline'} onClick={() => { updS('textDecoration', (s.textDecoration ?? 'none') === 'underline' ? 'none' : 'underline'); commit(); }} />
              </div>
            </div>

            <div className="fb-quad" style={{ marginTop: 8 }}>
              <NumberInput value={s.fontSize ?? 42} min={1} label="Size" onChange={v => { updS('fontSize', v); commit(); }} />
              <NumberInput value={s.lineHeight ?? 1.2} min={0.5} step={0.05} label="Line" onChange={v => { updS('lineHeight', v); commit(); }} />
            </div>

            <div className="fb-quad" style={{ marginTop: 6 }}>
              <NumberInput value={s.letterSpacing ?? 0} step={0.01} label="Track" onChange={v => { updS('letterSpacing', v); commit(); }} />
              <div />
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
              <VariableBindingLabel label="Color">
                {allowVariableBindings ? (
                  renderInlineBindingButton('styles.color', (value) => updateStyles(element.id, bpId, { color: value || '#000000' }), {
                    label: 'Text Color',
                    fallbackLabel: 'Color',
                    createMeta: 'Create a component color variable for this text layer',
                  })
                ) : null}
              </VariableBindingLabel>
              {textColorBindingVariable ? <BoundVariableCta variable={textColorBindingVariable} fallbackLabel="Color variable" /> : <FillPicker value={s.color ?? '#000000'} onChange={v => { updS('color', v); commit(); }} />}
            </div>

            {supportsPlaceholderStyling ? (
              <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Placeholder</span>
                <ColorInput value={s.placeholderColor ?? FORM_STYLE_DEFAULTS.placeholderColor} onChange={v => { updS('placeholderColor', v); commit(); }} />
              </div>
            ) : null}

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Align</span>
              <IconGroup
                value={s.textAlign ?? 'left'}
                onChange={v => { updS('textAlign', v); commit(); }}
                options={TEXT_ALIGN_OPTIONS}
              />
            </div>

            {element.type === 'text' ? (
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Grow</span>
                <IconGroup
                  value={textGrow}
                  onChange={value => {
                    if (value === 'auto-width') {
                      updateElementLayout(element.id, bpId, { widthMode: 'hug', heightMode: 'hug' });
                    } else if (value === 'auto-height') {
                      updateElementLayout(element.id, bpId, { widthMode: 'fixed', heightMode: 'hug', width: resolved.width ?? 240 });
                    } else {
                      updateElementLayout(element.id, bpId, { widthMode: 'fixed', heightMode: 'fixed', width: resolved.width ?? 240, height: resolved.height ?? 60 });
                    }
                    commit();
                  }}
                  options={TEXT_GROW_OPTIONS}
                />
              </div>
            ) : null}
          </Section>
        )}

        {element.type === 'icon' && !shapeKind && (
          <Section title="Icon / SVG" action={<ResetBtn show={isOv('iconSource','iconName','svgMarkup') || isSOv('color','strokeWidth','strokeColor')} onReset={() => { resetOv('iconSource','iconName','svgMarkup'); resetSOv('color','strokeWidth','strokeColor'); }} />}>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Source</span>
              <ChoiceGroup
                value={resolved.iconSource ?? 'preset'}
                onChange={(value) => {
                  upd('iconSource', value);
                  commit();
                }}
                options={[
                  { value: 'preset', label: 'Preset' },
                  { value: 'custom', label: 'Custom SVG' },
                ]}
              />
            </div>
            {(resolved.iconSource ?? 'preset') === 'preset' ? (
              <>
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Library</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <div style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', color: s.color ?? '#111827', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel-2)' }} dangerouslySetInnerHTML={{ __html: resolved.svgMarkup ?? '' }} />
                    <button
                      type="button"
                      className="fb-secondary-btn"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openIconLibraryModal({ targetId: element.id, bpId });
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      Browse icon libraries
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="fb-prop-row--full" style={{ marginTop: 8 }}>
                  <textarea
                    className="fb-prop-input"
                    value={resolved.svgMarkup ?? ''}
                    onChange={(event) => upd('svgMarkup', event.target.value)}
                    onBlur={(event) => {
                      upd('svgMarkup', sanitizeSvgMarkup(event.target.value));
                      commit();
                    }}
                    rows={7}
                    spellCheck={false}
                    style={{ width: '100%', resize: 'vertical', minHeight: 140, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.45 }}
                  />
                </div>
                <div className="fb-artboard-bp-note">Custom SVG is sanitized on blur. Use <code>currentColor</code> inside the SVG if you want the tint control to drive its color.</div>
              </>
            )}

            <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
              <VariableBindingLabel label="Tint">
                {allowVariableBindings ? (
                  renderInlineBindingButton('styles.color', (value) => updateStyles(element.id, bpId, { color: value || '#111827' }), {
                    label: 'Icon Tint',
                    fallbackLabel: 'Tint',
                    createMeta: 'Create a component color variable for this icon',
                  })
                ) : null}
              </VariableBindingLabel>
              <div style={{ width: '100%' }}>
                {iconColorBindingVariable ? <BoundVariableCta variable={iconColorBindingVariable} fallbackLabel="Tint variable" /> : <FillPicker value={s.color ?? '#111827'} onChange={(value) => { updS('color', value); commit(); }} />}
              </div>
            </div>
            <div className="fb-artboard-bp-note">Tint uses the same picker as fills. Solid colors are recommended for icons that rely on <code>currentColor</code>.</div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Stroke</span>
              {(s.strokeWidth ?? 0) > 0 ? (
                <div className="fb-style-inline-group fb-style-inline-group--stacked" style={{ width: '100%' }}>
                  <NumberInput value={s.strokeWidth ?? 0} min={0} step={0.1} onChange={v => { updS('strokeWidth', v); commit(); }} />
                  <FillPicker value={s.strokeColor ?? (s.color ?? '#111827')} onChange={v => { updS('strokeColor', v); commit(); }} />
                </div>
              ) : (
                <button
                  type="button"
                  className="fb-add-field"
                  onClick={() => {
                    updS('strokeWidth', 1);
                    updS('strokeColor', s.color ?? '#111827');
                    commit();
                  }}
                >
                  Add...
                </button>
              )}
            </div>
          </Section>
        )}

        {element.type === 'form' ? (
          <Section title="Form">
            <div className="fb-prop-row">
              <span className="fb-prop-label">State</span>
              <ChoiceGroup
                value={formConfig.state ?? 'idle'}
                onChange={(value) => {
                  updBase({
                    formConfig: {
                      ...formConfig,
                      state: value,
                    },
                  });
                  commit();
                }}
                options={FORM_STATE_OPTIONS}
              />
            </div>
            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Submit Label</span>
              <input
                className="fb-prop-input"
                type="text"
                value={formConfig.submitLabel ?? 'Submit'}
                onChange={(event) => {
                  updBase({
                    formConfig: {
                      ...formConfig,
                      submitLabel: event.target.value,
                    },
                  });
                }}
                onBlur={commit}
                placeholder="Submit"
              />
            </div>
            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Success Message</span>
              <input
                className="fb-prop-input"
                type="text"
                value={formConfig.successMessage ?? ''}
                onChange={(event) => {
                  updBase({
                    formConfig: {
                      ...formConfig,
                      successMessage: event.target.value,
                    },
                  });
                }}
                onBlur={commit}
                placeholder="Thanks. Your submission was received."
              />
            </div>
            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Error Message</span>
              <input
                className="fb-prop-input"
                type="text"
                value={formConfig.errorMessage ?? ''}
                onChange={(event) => {
                  updBase({
                    formConfig: {
                      ...formConfig,
                      errorMessage: event.target.value,
                    },
                  });
                }}
                onBlur={commit}
                placeholder="Something went wrong. Please try again."
              />
            </div>
            <div className="fb-artboard-bp-note" style={{ marginTop: 8 }}>
              Configure store, email, webhook, and create actions from the Submission Form node inside the form's interaction flow.
            </div>
          </Section>
        ) : null}

        {isFormField ? (
          <>
            <Section title="Input">
              <div className="fb-prop-row">
                <span className="fb-prop-label">Name</span>
                <input
                  className="fb-prop-input"
                  type="text"
                  value={resolved.label ?? ''}
                  onChange={(event) => updBase({ label: event.target.value })}
                  onBlur={commit}
                  placeholder="Field label"
                />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Field</span>
                <input
                  className="fb-prop-input"
                  type="text"
                  value={resolved.fieldName ?? ''}
                  onChange={(event) => updBase({ fieldName: event.target.value })}
                  onBlur={commit}
                  placeholder="email"
                />
              </div>

              {element.type !== 'checkbox' ? (
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Placeholder</span>
                  <input
                    className="fb-prop-input"
                    type="text"
                    value={resolved.placeholder ?? ''}
                    onChange={(event) => updBase({ placeholder: event.target.value })}
                    onBlur={commit}
                    placeholder="Placeholder"
                  />
                </div>
              ) : null}

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Helper Text</span>
                <input
                  className="fb-prop-input"
                  type="text"
                  value={resolved.helperText ?? ''}
                  onChange={(event) => updBase({ helperText: event.target.value })}
                  onBlur={commit}
                  placeholder="Optional guidance"
                />
              </div>

              {element.type === 'textarea-field' ? (
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Default Text</span>
                  <textarea
                    className="fb-prop-input"
                    value={resolved.defaultValue ?? ''}
                    onChange={(event) => updBase({ defaultValue: event.target.value })}
                    onBlur={commit}
                    rows={4}
                    style={{ width: '100%', resize: 'vertical', minHeight: 96, lineHeight: 1.4 }}
                    placeholder="Prefilled textarea content"
                  />
                </div>
              ) : null}

              {element.type === 'rich-text-editor' ? (
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Default HTML</span>
                  <textarea
                    className="fb-prop-input"
                    value={resolved.defaultValue ?? ''}
                    onChange={(event) => updBase({ defaultValue: event.target.value })}
                    onBlur={commit}
                    rows={5}
                    style={{ width: '100%', resize: 'vertical', minHeight: 110, lineHeight: 1.4 }}
                    placeholder="<p>Prefilled rich text content</p>"
                  />
                </div>
              ) : null}

              {element.type === 'file-upload' ? (
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Selection</span>
                  <ChoiceGroup
                    value={resolved.allowMultipleFiles === true ? 'multiple' : 'single'}
                    onChange={(value) => {
                      updBase({ allowMultipleFiles: value === 'multiple' });
                      commit();
                    }}
                    options={[{ value: 'single', label: 'Single' }, { value: 'multiple', label: 'Multiple' }]}
                  />
                </div>
              ) : null}

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Required</span>
                <ChoiceGroup
                  value={resolved.required === true ? 'yes' : 'no'}
                  onChange={(value) => {
                    updBase({ required: value === 'yes' });
                    commit();
                  }}
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                />
              </div>

            </Section>

            {element.type === 'checkbox' ? (
              <Section title="Checkbox">
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Checked</span>
                  <Toggle
                    value={resolved.defaultValue === true}
                    onChange={(value) => {
                      updBase({ defaultValue: value });
                      commit();
                    }}
                  />
                </div>

                <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <span className="fb-prop-label">Indicator</span>
                  <ColorInput value={s.checkboxAccentColor ?? FORM_STYLE_DEFAULTS.checkboxAccentColor} onChange={v => { updS('checkboxAccentColor', v); commit(); }} />
                </div>
              </Section>
            ) : null}

            {element.type === 'radio-group' ? (
              <Section title="Radio">
                <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <span className="fb-prop-label">Indicator</span>
                  <ColorInput value={s.checkboxAccentColor ?? FORM_STYLE_DEFAULTS.checkboxAccentColor} onChange={v => { updS('checkboxAccentColor', v); commit(); }} />
                </div>
              </Section>
            ) : null}

            {element.type === 'dropdown' ? (
              <Section title="Dropdown">
                <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                  <span className="fb-prop-label">Icon</span>
                  <div style={{ width: '100%', display: 'grid', gap: 8 }}>
                    <div className="fb-icon-group" role="group" aria-label="Dropdown icon">
                      {FORM_SELECT_ICON_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`fb-icon-btn${(s.selectIcon ?? FORM_STYLE_DEFAULTS.selectIcon) === option.value ? ' fb-icon-btn--active' : ''}`}
                          title={option.label}
                          onClick={() => { updS('selectIcon', option.value); commit(); }}
                        >
                          <span aria-hidden="true">{option.icon}</span>
                        </button>
                      ))}
                    </div>
                    {(s.selectIcon ?? FORM_STYLE_DEFAULTS.selectIcon) !== 'none' ? (
                      <ColorInput value={s.iconColor ?? s.placeholderColor ?? FORM_STYLE_DEFAULTS.iconColor} onChange={v => { updS('iconColor', v); commit(); }} />
                    ) : null}
                  </div>
                </div>
              </Section>
            ) : null}

            {(element.type === 'radio-group' || element.type === 'dropdown') ? (
              <Section title="Options">
                <FormOptionsEditor
                  value={formFieldOptions}
                  fieldType={element.type}
                  defaultValue={resolved.defaultValue ?? ''}
                  onChange={(nextOptions) => updBase({ fieldOptions: nextOptions })}
                  onDefaultChange={(nextValue) => updBase({ defaultValue: nextValue })}
                  onCommit={commit}
                />
              </Section>
            ) : null}

            <Section title="Styles">
              <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Font</span>
                <div style={{ flex: 1 }}>
                  <GoogleFontPicker
                    value={s.fontFamily ?? 'Inter'}
                    onChange={value => commitFontFamily([element.id], bpId, value)}
                    onPreviewChange={(value) => previewFontFamily([element.id], bpId, value)}
                    onPreviewReset={resetFontPreview}
                  />
                </div>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Weight</span>
                <select
                  className="fb-prop-input"
                  value={String(s.fontWeight ?? 500)}
                  onChange={e => { updS('fontWeight', Number(e.target.value)); commit(); }}
                >
                  {FONT_WEIGHT_OPTIONS.map(weight => (
                    <option key={weight} value={weight}>{weight}</option>
                  ))}
                </select>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 6 }}>
                <span className="fb-prop-label">Style</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <IconButton icon={UIIcons.regular} title="Regular" active={(s.fontStyle ?? 'normal') === 'normal'} onClick={() => { updS('fontStyle', 'normal'); commit(); }} />
                  <IconButton icon={UIIcons.italic} title="Italic" active={s.fontStyle === 'italic'} onClick={() => { updS('fontStyle', s.fontStyle === 'italic' ? 'normal' : 'italic'); commit(); }} />
                  <IconButton icon={UIIcons.underline} title="Underline" active={(s.textDecoration ?? 'none') === 'underline'} onClick={() => { updS('textDecoration', (s.textDecoration ?? 'none') === 'underline' ? 'none' : 'underline'); commit(); }} />
                </div>
              </div>

              <div className="fb-quad" style={{ marginTop: 8 }}>
                <NumberInput value={s.fontSize ?? 14} min={1} label="Size" onChange={v => { updS('fontSize', v); commit(); }} />
                <NumberInput value={s.lineHeight ?? 1.4} min={0.5} step={0.05} label="Line" onChange={v => { updS('lineHeight', v); commit(); }} />
              </div>

              <div className="fb-quad" style={{ marginTop: 6 }}>
                <NumberInput value={s.letterSpacing ?? 0} step={0.01} label="Track" onChange={v => { updS('letterSpacing', v); commit(); }} />
                <div />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Align</span>
                <IconGroup
                  value={s.textAlign ?? 'left'}
                  onChange={v => { updS('textAlign', v); commit(); }}
                  options={TEXT_ALIGN_OPTIONS}
                />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Color</span>
                <ColorInput value={s.color ?? '#0f172a'} onChange={v => { updS('color', v); commit(); }} />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Helper</span>
                <ColorInput value={s.helperColor ?? FORM_STYLE_DEFAULTS.helperColor} onChange={v => { updS('helperColor', v); commit(); }} />
              </div>

              {supportsPlaceholderStyling ? (
                <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <span className="fb-prop-label">Placeholder</span>
                  <ColorInput value={s.placeholderColor ?? FORM_STYLE_DEFAULTS.placeholderColor} onChange={v => { updS('placeholderColor', v); commit(); }} />
                </div>
              ) : null}

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Opacity</span>
                <div className="fb-slider-field">
                  <input
                    className="fb-prop-input fb-slider-field__value"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Math.round((s.opacity ?? 1) * 100) / 100}
                    onChange={e => { const next = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)); updS('opacity', next); }}
                    onBlur={commit}
                  />
                  <input
                    className="fb-slider"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={s.opacity ?? 1}
                    onChange={e => updS('opacity', parseFloat(e.target.value))}
                    onMouseUp={commit}
                  />
                </div>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Fill</span>
                <div style={{ width: '100%' }}>
                  <FillPicker value={s.backgroundColor ?? '#ffffff'} onChange={v => { updS('backgroundColor', v); commit(); }} />
                </div>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Radius</span>
                <div className="fb-style-inline-group">
                  <NumberInput value={s.borderRadius ?? 0} min={0} onChange={v => { updS('borderRadius', v); commit(); }} />
                  <IconButton icon={UIIcons.radiusLinked} title="All corners equal" active={(s.borderRadiusMode ?? 'linked') === 'linked'} onClick={() => { updS('borderRadiusMode', 'linked'); commit(); }} />
                  <IconButton icon={UIIcons.radiusIndependent} title="Individual corners" active={s.borderRadiusMode === 'independent'} onClick={() => { updS('borderRadiusMode', 'independent'); commit(); }} />
                </div>
              </div>

              {s.borderRadiusMode === 'independent' ? (
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label" />
                  <div className="fb-quad fb-quad--spaced">
                    <NumberInput value={s.borderRadiusTL ?? s.borderRadius ?? 0} min={0} label="TL" onChange={v => { updS('borderRadiusTL', v); commit(); }} />
                    <NumberInput value={s.borderRadiusTR ?? s.borderRadius ?? 0} min={0} label="TR" onChange={v => { updS('borderRadiusTR', v); commit(); }} />
                    <NumberInput value={s.borderRadiusBL ?? s.borderRadius ?? 0} min={0} label="BL" onChange={v => { updS('borderRadiusBL', v); commit(); }} />
                    <NumberInput value={s.borderRadiusBR ?? s.borderRadius ?? 0} min={0} label="BR" onChange={v => { updS('borderRadiusBR', v); commit(); }} />
                  </div>
                </div>
              ) : null}

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Gap</span>
                <NumberInput value={s.gap ?? FORM_STYLE_DEFAULTS.fieldGap} min={0} onChange={v => { updS('gap', v); commit(); }} />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Padding</span>
                <EdgeInsetsControl
                  syncKey={`${element.id}:form-padding`}
                  values={{
                    top: s.paddingTop ?? 0,
                    right: s.paddingRight ?? 0,
                    bottom: s.paddingBottom ?? 0,
                    left: s.paddingLeft ?? 0,
                  }}
                  onChange={(side, nextValue) => {
                    const keyMap = {
                      top: 'paddingTop',
                      right: 'paddingRight',
                      bottom: 'paddingBottom',
                      left: 'paddingLeft',
                    };
                    updS(keyMap[side], nextValue);
                  }}
                />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Border</span>
                {(s.borderWidth ?? 0) > 0 ? (
                  <div className="fb-style-inline-group fb-style-inline-group--stacked">
                    <NumberInput value={s.borderWidth ?? 0} min={0} onChange={v => { updS('borderWidth', v); updS('borderStyle', 'solid'); commit(); }} />
                    <FillPicker value={s.borderColor ?? '#000000'} onChange={v => { updS('borderColor', v); updS('borderStyle', 'solid'); commit(); }} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="fb-add-field"
                    onClick={() => { updS('borderWidth', 1); updS('borderStyle', 'solid'); commit(); }}
                  >
                    Add...
                  </button>
                )}
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Shadows</span>
                <button
                  type="button"
                  className={`fb-shadow-style-cta${s.boxShadow ? ' is-active' : ''}`}
                  ref={shadowTriggerRef}
                  onClick={() => {
                    shadowDraftDirtyRef.current = false;
                    setShadowModalOpen(true);
                  }}
                >
                  <span className={`fb-shadow-style-cta__indicator${s.boxShadow ? ' is-active' : ''}`} />
                  <span>{getShadowSummary(s)}</span>
                </button>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Focus</span>
                <FormStatePopupButton
                  title="Focus"
                  stateKey="focus"
                  styles={s}
                  onPatch={(patch) => updateStyles(element.id, bpId, patch)}
                  onCommit={commit}
                  onPreview={(previewState) => updateStyles(element.id, bpId, { formStatePreview: previewState })}
                />
              </div>

              {(element.type === 'checkbox' || element.type === 'radio-group') ? (
                <div className="fb-prop-row" style={{ marginTop: 8 }}>
                  <span className="fb-prop-label">Checked</span>
                  <FormStatePopupButton
                    title="Checked"
                    stateKey="checked"
                    styles={s}
                    onPatch={(patch) => updateStyles(element.id, bpId, patch)}
                    onCommit={commit}
                    onPreview={(previewState) => updateStyles(element.id, bpId, { formStatePreview: previewState })}
                  />
                </div>
              ) : null}
            </Section>

            <Section title="States">
              <div className="fb-prop-row">
                <span className="fb-prop-label">Preview</span>
                <ChoiceGroup
                  value={s.formStatePreview ?? FORM_STYLE_DEFAULTS.formStatePreview}
                  onChange={(value) => {
                    updS('formStatePreview', value);
                    commit();
                  }}
                  options={FORM_FIELD_PREVIEW_STATE_OPTIONS}
                />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Hover Fill</span>
                <ColorInput value={s.hoverBackgroundColor ?? s.backgroundColor ?? FORM_STYLE_DEFAULTS.hoverBackgroundColor} onChange={v => { updS('hoverBackgroundColor', v); commit(); }} />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Hover Border</span>
                <ColorInput value={s.hoverBorderColor ?? s.borderColor ?? FORM_STYLE_DEFAULTS.hoverBorderColor} onChange={v => { updS('hoverBorderColor', v); commit(); }} />
              </div>
            </Section>
          </>
        ) : null}

        {isFormSubmitButton ? (
          <>
            <Section title="Button">
              <div className="fb-prop-row">
                <span className="fb-prop-label">Label</span>
                <input
                  className="fb-prop-input"
                  type="text"
                  value={resolved.label ?? 'Submit'}
                  onChange={(event) => updBase({ label: event.target.value })}
                  onBlur={commit}
                  placeholder="Submit"
                />
              </div>
              <div className="fb-artboard-bp-note" style={{ marginTop: 8 }}>
                Place this button inside a form container to trigger the live submit runtime.
              </div>
            </Section>

            <Section title="States">
              <div className="fb-prop-row">
                <span className="fb-prop-label">Preview</span>
                <ChoiceGroup
                  value={s.formButtonStatePreview ?? FORM_STYLE_DEFAULTS.formButtonStatePreview}
                  onChange={(value) => {
                    updS('formButtonStatePreview', value);
                    commit();
                  }}
                  options={FORM_BUTTON_PREVIEW_STATE_OPTIONS}
                />
              </div>

              {FORM_BUTTON_STATE_GROUPS.map((state) => {
                const backgroundKey = `${state.key}BackgroundColor`;
                const borderKey = `${state.key}BorderColor`;
                const textKey = `${state.key}TextColor`;
                return (
                  <React.Fragment key={state.key}>
                    <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                      <span className="fb-prop-label">{state.label} Fill</span>
                      <ColorInput value={s[backgroundKey] ?? FORM_STYLE_DEFAULTS[backgroundKey] ?? s.backgroundColor ?? FORM_STYLE_DEFAULTS.backgroundColor} onChange={v => { updS(backgroundKey, v); commit(); }} />
                    </div>

                    <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                      <span className="fb-prop-label">{state.label} Border</span>
                      <ColorInput value={s[borderKey] ?? FORM_STYLE_DEFAULTS[borderKey] ?? s.borderColor ?? FORM_STYLE_DEFAULTS.borderColor} onChange={v => { updS(borderKey, v); commit(); }} />
                    </div>

                    <div className="fb-prop-row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                      <span className="fb-prop-label">{state.label} Text</span>
                      <ColorInput value={s[textKey] ?? FORM_STYLE_DEFAULTS[textKey] ?? s.color ?? FORM_STYLE_DEFAULTS.textColor} onChange={v => { updS(textKey, v); commit(); }} />
                    </div>
                  </React.Fragment>
                );
              })}

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Focus Ring</span>
                <div className="fb-style-inline-group fb-style-inline-group--stacked">
                  <NumberInput value={s.focusRingWidth ?? FORM_STYLE_DEFAULTS.focusRingWidth} min={0} onChange={v => { updS('focusRingWidth', v); commit(); }} />
                  <ColorInput value={s.focusRingColor ?? FORM_STYLE_DEFAULTS.focusRingColor} onChange={v => { updS('focusRingColor', v); commit(); }} />
                </div>
              </div>
            </Section>
          </>
        ) : null}

        {/* ── Layout / Spacing ────────────────────────── */}
        {(element.type === 'frame' || isLoopElement || isFormContainerType(element.type) || isFormSubmitButton) ? (() => {
          if (isComponentInstanceOnPage) return null;
          const supportsAutoLayout = element.type === 'frame' || isLoopElement || isFormContainerType(element.type);
          const supportsGap = supportsAutoLayout || isFormField || isFormSubmitButton;
          const frameLayoutOn = s.display === 'flex';
          return (
            <Section title="Layout" action={<ResetBtn show={isSOv('display','flexDirection','flexWrap','gap','alignItems','justifyContent','paddingTop','paddingRight','paddingBottom','paddingLeft')} onReset={() => resetSOv('display','flexDirection','flexWrap','gap','alignItems','justifyContent','paddingTop','paddingRight','paddingBottom','paddingLeft')} />}>
              {supportsAutoLayout ? (
                <>
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Space</span>
                    <ChoiceGroup
                      value={frameLayoutOn ? 'auto' : 'free'}
                      onChange={v => {
                        if (v === 'free') updS('display', null);
                        else {
                          updS('display', 'flex');
                          if (!s.flexDirection) updS('flexDirection', 'column');
                        }
                        commit();
                      }}
                      options={[
                        { value: 'free', label: 'Free' },
                        { value: 'auto', label: 'Auto' },
                      ]}
                    />
                  </div>
                  {frameLayoutOn && (
                    <>
                      <div className="fb-prop-row">
                        <span className="fb-prop-label">Direction</span>
                        <IconGroup
                          value={s.flexDirection}
                          onChange={v => { updS('flexDirection', v); commit(); }}
                          options={[
                            { value: 'row', icon: LAYOUT_ICONS.row, label: 'Row' },
                            { value: 'column', icon: LAYOUT_ICONS.column, label: 'Column' },
                          ]}
                        />
                      </div>
                      <div className="fb-prop-row">
                        <span className="fb-prop-label">Wrap</span>
                        <IconGroup
                          value={s.flexWrap}
                          onChange={v => { updS('flexWrap', v); commit(); }}
                          options={[
                            { value: 'nowrap', icon: LAYOUT_ICONS.nowrap, label: 'No wrap' },
                            { value: 'wrap', icon: LAYOUT_ICONS.wrap, label: 'Wrap' },
                          ]}
                        />
                      </div>
                      <div className="fb-prop-row">
                        <span className="fb-prop-label">Align</span>
                        <IconGroup
                          value={s.alignItems}
                          onChange={v => { updS('alignItems', v); commit(); }}
                          options={[
                            { value: 'flex-start', icon: LAYOUT_ICONS['align-start'], label: 'Start' },
                            { value: 'center', icon: LAYOUT_ICONS['align-center'], label: 'Center' },
                            { value: 'flex-end', icon: LAYOUT_ICONS['align-end'], label: 'End' },
                            { value: 'stretch', icon: LAYOUT_ICONS['align-stretch'], label: 'Stretch' },
                          ]}
                        />
                      </div>
                      <div className="fb-prop-row">
                        <span className="fb-prop-label">Justify</span>
                        <IconGroup
                          value={s.justifyContent}
                          onChange={v => { updS('justifyContent', v); commit(); }}
                          options={[
                            { value: 'flex-start', icon: LAYOUT_ICONS['just-start'], label: 'Start' },
                            { value: 'center', icon: LAYOUT_ICONS['just-center'], label: 'Center' },
                            { value: 'flex-end', icon: LAYOUT_ICONS['just-end'], label: 'End' },
                            { value: 'space-between', icon: LAYOUT_ICONS['just-between'], label: 'Between' },
                            { value: 'space-around', icon: LAYOUT_ICONS['just-around'], label: 'Around' },
                          ]}
                        />
                      </div>
                    </>
                  )}
                </>
              ) : null}
              {supportsGap ? (
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Gap</span>
                  <NumberInput value={s.gap ?? 0} min={0} onChange={v => { updS('gap', v); commit(); }} />
                </div>
              ) : null}
              <div className="fb-prop-row">
                <span className="fb-prop-label">Padding</span>
                <EdgeInsetsControl
                  syncKey={`${element.id}:layout-padding`}
                  values={{
                    top: s.paddingTop ?? 0,
                    right: s.paddingRight ?? 0,
                    bottom: s.paddingBottom ?? 0,
                    left: s.paddingLeft ?? 0,
                  }}
                  onChange={(side, nextValue) => {
                    const keyMap = {
                      top: 'paddingTop',
                      right: 'paddingRight',
                      bottom: 'paddingBottom',
                      left: 'paddingLeft',
                    };
                    updS(keyMap[side], nextValue);
                  }}
                />
              </div>
            </Section>
          );
        })() : null}

        {isLoopElement && !isComponentInstanceOnPage ? (
          <Section title="Loop" action={<ResetBtn show={isOv('loop')} onReset={() => { upd('loop', normalizeLoopConfig(null)); commit(); }} />}>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Mode</span>
              <ChoiceGroup
                value={loopConfig.mode ?? 'loop'}
                onChange={(value) => {
                  const nextLoop = normalizeLoopConfig({ ...loopConfig, mode: value });
                  if (value === 'slideshow' || value === 'carousel') {
                    upd('loop', nextLoop);
                    updateStyles(element.id, bpId, { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: nextLoop.gap, overflow: 'hidden' });
                  } else if (value === 'ticker') {
                    upd('loop', nextLoop);
                    updateStyles(element.id, bpId, { display: 'flex', flexDirection: nextLoop.ticker?.direction === 'up' || nextLoop.ticker?.direction === 'down' ? 'column' : 'row', flexWrap: 'nowrap', gap: nextLoop.ticker?.gap ?? 24, overflow: 'hidden' });
                  } else {
                    // Switching to loop mode with manual source: keep only first child
                    if ((loopConfig.source ?? 'query') === 'manual') {
                      const kids = element.children ?? [];
                      if (kids.length > 1) {
                        deleteElements(kids.slice(1));
                      }
                    }
                    const styleUpdates = nextLoop.layout === 'grid'
                      ? { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: nextLoop.gap, overflow: undefined }
                      : { display: 'flex', flexDirection: nextLoop.layout === 'horizontal' ? 'row' : 'column', flexWrap: 'nowrap', gap: nextLoop.gap, overflow: undefined };
                    upd('loop', nextLoop);
                    updateStyles(element.id, bpId, styleUpdates);
                  }
                  commit();
                }}
                options={[
                  { value: 'loop', label: 'Loop' },
                  { value: 'slideshow', label: 'Slideshow' },
                  { value: 'ticker', label: 'Ticker' },
                  { value: 'carousel', label: 'Carousel' },
                ]}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Source</span>
              <ChoiceGroup
                value={loopConfig.source ?? 'query'}
                onChange={(value) => {
                  upd('loop', normalizeLoopConfig({ ...loopConfig, source: value }));
                  commit();
                }}
                options={[
                  { value: 'query', label: 'Query' },
                  { value: 'manual', label: 'Manual' },
                ]}
              />
            </div>
            {(loopConfig.mode ?? 'loop') === 'loop' ? (
              <>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Pattern</span>
                  <ChoiceGroup
                    value={loopConfig.layout}
                    onChange={(value) => {
                      const nextLoop = normalizeLoopConfig({ ...loopConfig, layout: value });
                      const styleUpdates = value === 'grid'
                        ? { display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: nextLoop.gap }
                        : { display: 'flex', flexDirection: value === 'horizontal' ? 'row' : 'column', flexWrap: 'nowrap', gap: nextLoop.gap };
                      upd('loop', nextLoop);
                      updateStyles(element.id, bpId, styleUpdates);
                      commit();
                    }}
                    options={[
                      { value: 'vertical', label: 'Vertical' },
                      { value: 'horizontal', label: 'Horizontal' },
                      { value: 'grid', label: 'Grid' },
                    ]}
                  />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Item Gap</span>
                  <NumberInput
                    value={loopConfig.gap}
                    min={0}
                    onChange={(value) => {
                      const nextLoop = normalizeLoopConfig({ ...loopConfig, gap: value });
                      upd('loop', nextLoop);
                      updS('gap', nextLoop.gap);
                      commit();
                    }}
                  />
                </div>
                {loopConfig.layout === 'grid' ? (
                  <>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Columns</span>
                      <NumberInput value={loopConfig.columns} min={1} step={1} onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, columns: value })); commit(); }} />
                    </div>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Min Item Width</span>
                      <NumberInput value={loopConfig.minItemWidth} min={40} step={1} onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, minItemWidth: value })); commit(); }} />
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
            {/* ── Slideshow settings ── */}
            {(loopConfig.mode ?? 'loop') === 'slideshow' ? (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Transition</span>
                  <ChoiceGroup
                    value={loopConfig.slideshow?.transition ?? 'slide'}
                    onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, transition: value } })); commit(); }}
                    options={[
                      { value: 'slide', label: 'Slide' },
                      { value: 'fade', label: 'Fade' },
                      { value: 'none', label: 'None' },
                    ]}
                  />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Duration</span>
                  <NumberInput value={loopConfig.slideshow?.transitionDuration ?? 500} min={0} step={50} suffix="ms" onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, transitionDuration: value } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Autoplay</span>
                  <Toggle value={loopConfig.slideshow?.autoplay ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, autoplay: v } })); commit(); }} />
                </div>
                {(loopConfig.slideshow?.autoplay ?? true) ? (
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Interval</span>
                    <NumberInput value={loopConfig.slideshow?.interval ?? 4000} min={500} step={250} suffix="ms" onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, interval: value } })); commit(); }} />
                  </div>
                ) : null}
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Arrows</span>
                  <Toggle value={loopConfig.slideshow?.showArrows ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, showArrows: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Dots</span>
                  <Toggle value={loopConfig.slideshow?.showDots ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, showDots: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Pause on Hover</span>
                  <Toggle value={loopConfig.slideshow?.pauseOnHover ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, pauseOnHover: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Loop</span>
                  <Toggle value={loopConfig.slideshow?.loop ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, slideshow: { ...loopConfig.slideshow, loop: v } })); commit(); }} />
                </div>
              </>
            ) : null}
            {/* ── Ticker settings ── */}
            {(loopConfig.mode ?? 'loop') === 'ticker' ? (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Direction</span>
                  <ChoiceGroup
                    value={loopConfig.ticker?.direction ?? 'left'}
                    onChange={(value) => {
                      const isVertical = value === 'up' || value === 'down';
                      upd('loop', normalizeLoopConfig({ ...loopConfig, ticker: { ...loopConfig.ticker, direction: value } }));
                      updateStyles(element.id, bpId, { flexDirection: isVertical ? 'column' : 'row' });
                      commit();
                    }}
                    options={[
                      { value: 'left', label: 'Left' },
                      { value: 'right', label: 'Right' },
                      { value: 'up', label: 'Up' },
                      { value: 'down', label: 'Down' },
                    ]}
                  />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Speed</span>
                  <NumberInput value={loopConfig.ticker?.speed ?? 40} min={1} step={5} suffix="px/s" onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, ticker: { ...loopConfig.ticker, speed: value } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Item Gap</span>
                  <NumberInput value={loopConfig.ticker?.gap ?? 24} min={0} onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, ticker: { ...loopConfig.ticker, gap: value } })); updS('gap', value); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Pause on Hover</span>
                  <Toggle value={loopConfig.ticker?.pauseOnHover ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, ticker: { ...loopConfig.ticker, pauseOnHover: v } })); commit(); }} />
                </div>
              </>
            ) : null}
            {/* ── Carousel settings ── */}
            {(loopConfig.mode ?? 'loop') === 'carousel' ? (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Visible Items</span>
                  <NumberInput value={loopConfig.carousel?.visibleItems ?? 3} min={1} step={1} onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, visibleItems: value } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Scroll Items</span>
                  <NumberInput value={loopConfig.carousel?.scrollItems ?? 1} min={1} step={1} onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, scrollItems: value } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Duration</span>
                  <NumberInput value={loopConfig.carousel?.transitionDuration ?? 500} min={0} step={50} suffix="ms" onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, transitionDuration: value } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Autoplay</span>
                  <Toggle value={loopConfig.carousel?.autoplay ?? false} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, autoplay: v } })); commit(); }} />
                </div>
                {(loopConfig.carousel?.autoplay) ? (
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Interval</span>
                    <NumberInput value={loopConfig.carousel?.interval ?? 4000} min={500} step={250} suffix="ms" onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, interval: value } })); commit(); }} />
                  </div>
                ) : null}
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Arrows</span>
                  <Toggle value={loopConfig.carousel?.showArrows ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, showArrows: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Dots</span>
                  <Toggle value={loopConfig.carousel?.showDots ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, showDots: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Pause on Hover</span>
                  <Toggle value={loopConfig.carousel?.pauseOnHover ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, pauseOnHover: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Loop</span>
                  <Toggle value={loopConfig.carousel?.loop ?? true} onChange={(v) => { upd('loop', normalizeLoopConfig({ ...loopConfig, carousel: { ...loopConfig.carousel, loop: v } })); commit(); }} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Item Gap</span>
                  <NumberInput value={loopConfig.gap} min={0} onChange={(value) => { upd('loop', normalizeLoopConfig({ ...loopConfig, gap: value })); updS('gap', value); commit(); }} />
                </div>
              </>
            ) : null}
          </Section>
        ) : null}

        {isLoopElement && !isComponentInstanceOnPage && (loopConfig.source ?? 'query') === 'query' ? (
          <Section title="Query" defaultOpen={false}>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Collection</span>
              <ChoiceGroup
                value={loopConfig.query?.collection ?? 'posts'}
                onChange={(value) => {
                  upd('loop', normalizeLoopConfig({
                    ...loopConfig,
                    query: {
                      ...(loopConfig.query ?? {}),
                      source: 'collection',
                      collection: value,
                      categoryIds: [],
                      selectedIds: [],
                      variable: null,
                    },
                  }));
                  commit();
                }}
                options={[
                  { value: 'posts', label: 'Posts' },
                  { value: 'pages', label: 'Pages' },
                  { value: 'products', label: 'Products' },
                ]}
              />
            </div>
            {(loopConfig.query?.collection ?? 'posts') === 'posts' || (loopConfig.query?.collection ?? 'posts') === 'products' ? (
              <>
                <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                  <span className="fb-prop-label">Categories</span>
                  <select
                    className="fb-prop-input"
                    multiple
                    size={Math.min(8, Math.max(4, (((loopConfig.query?.collection ?? 'posts') === 'products' ? variableSources?.productCategories : variableSources?.postCategories) ?? []).length || 4))}
                    value={(loopConfig.query?.categoryIds ?? []).map((entry) => String(entry))}
                    onChange={(event) => {
                      const categoryIds = Array.from(event.target.selectedOptions)
                        .map((option) => parseInt(option.value, 10))
                        .filter((entry) => Number.isInteger(entry) && entry > 0);
                      upd('loop', normalizeLoopConfig({
                        ...loopConfig,
                        query: {
                          ...(loopConfig.query ?? {}),
                          source: 'collection',
                          categoryIds,
                        },
                      }));
                      commit();
                    }}
                    style={{ minHeight: 124 }}
                  >
                    {(((loopConfig.query?.collection ?? 'posts') === 'products' ? variableSources?.productCategories : variableSources?.postCategories) ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.name}</option>
                    ))}
                  </select>
                </div>
                <div className="fb-artboard-bp-note">Leave empty to include all categories. Hold Command to pick multiple categories.</div>
              </>
            ) : null}

            <div className="fb-prop-row">
              <span className="fb-prop-label">Limit</span>
              <NumberInput
                value={loopConfig.query?.limit ?? 6}
                min={1}
                step={1}
                onChange={(value) => {
                  upd('loop', normalizeLoopConfig({
                    ...loopConfig,
                    query: {
                      ...(loopConfig.query ?? {}),
                      source: 'collection',
                      limit: value,
                    },
                  }));
                  commit();
                }}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Order</span>
              <ChoiceGroup
                value={loopConfig.query?.order ?? 'desc'}
                onChange={(value) => {
                  upd('loop', normalizeLoopConfig({
                    ...loopConfig,
                    query: {
                      ...(loopConfig.query ?? {}),
                      source: 'collection',
                      order: value,
                    },
                  }));
                  commit();
                }}
                options={[
                  { value: 'desc', label: 'Newest' },
                  { value: 'asc', label: 'Oldest' },
                ]}
              />
            </div>
          </Section>
        ) : null}

        <Section title="Overlays" defaultOpen={false} />

        <Section title="Cursor" defaultOpen={false}>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Mode</span>
            <ChoiceGroup
              value={resolved.cursorMode ?? 'default'}
              onChange={(value) => { upd('cursorMode', value); commit(); }}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'image', label: 'Image' },
                { value: 'component', label: 'Component' },
              ]}
            />
          </div>
          {(resolved.cursorMode === 'image') ? (
            <>
              <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                <span className="fb-prop-label">Image</span>
                <div style={{ width: '100%' }}>
                  <MediaPickerButton value={resolved.cursorImage ?? ''} onChange={v => { upd('cursorImage', v); commit(); }} mediaType="image" />
                </div>
              </div>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Hotspot</span>
                <div className="fb-style-inline-group">
                  <NumberInput value={resolved.cursorHotX ?? 0} min={0} label="X" onChange={v => { upd('cursorHotX', v); commit(); }} />
                  <NumberInput value={resolved.cursorHotY ?? 0} min={0} label="Y" onChange={v => { upd('cursorHotY', v); commit(); }} />
                </div>
              </div>
            </>
          ) : null}
          {(resolved.cursorMode === 'component') ? (
            <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
              <span className="fb-prop-label">Component</span>
              <select
                className="fb-prop-input"
                value={resolved.cursorComponentId ?? ''}
                onChange={e => { upd('cursorComponentId', e.target.value); commit(); }}
              >
                <option value="">Select…</option>
                {components.map(c => (<option key={c.id} value={c.id}>{c.name || c.id}</option>))}
              </select>
            </div>
          ) : null}
        </Section>

        {!isFormField ? (() => {
          const _effectDefs = [
            { key: 'pointerEvents', label: 'Pointer', defaultVal: 'auto', activeVal: 'none', allow: true },
            { key: 'blur',          label: 'Blur',       defaultVal: 0,   activeVal: 8,   allow: true },
            { key: 'brightness',    label: 'Brightness', defaultVal: 100, activeVal: 110, allow: true },
            { key: 'contrast',      label: 'Contrast',   defaultVal: 100, activeVal: 110, allow: true },
            { key: 'saturation',    label: 'Saturation', defaultVal: 100, activeVal: 110, allow: true },
            { key: 'backdropBlur',  label: 'Background Blur', defaultVal: 0, activeVal: 8,
              allow: (element.type === 'frame' || isLoopElement || isFormContainerType(element.type)) || element.type === 'icon' },
          ];
          const _isEffectActive = (d) => {
            const v = s[d.key];
            if (v === undefined || v === null || v === '') return false;
            return v !== d.defaultVal;
          };
          const _addEffect = (key) => {
            const d = _effectDefs.find(e => e.key === key);
            if (!d) return;
            updS(d.key, d.activeVal);
            commit();
          };
          const _removeEffect = (key) => {
            const d = _effectDefs.find(e => e.key === key);
            if (!d) return;
            updS(d.key, d.defaultVal);
            commit();
          };
          const _allowed = _effectDefs.filter(d => d.allow);
          const _inactive = _allowed.filter(d => !_isEffectActive(d));
          return (
        <Section title="Styles" action={<>
          {!isComponentInstanceOnPage && _inactive.length > 0 ? (
            <select
              className="fb-effect-add-header"
              value=""
              onChange={(e) => { if (e.target.value) _addEffect(e.target.value); }}
              title="Add effect"
            >
              <option value="">+ Add</option>
              {_inactive.map(d => (<option key={d.key} value={d.key}>{d.label}</option>))}
            </select>
          ) : null}
          <ResetBtn show={isComponentInstanceOnPage ? (isOv('hidden') || isSOv('opacity','zIndex')) : (isOv('hidden','rotation') || isSOv('opacity','mixBlendMode','overflow','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','borderRadius','borderRadiusTL','borderRadiusTR','borderRadiusBL','borderRadiusBR','borderWidth','borderColor','borderStyle','borderRadiusMode','boxShadow','shadowType','shadowPosition','shadowColor','shadowOpacity','shadowX','shadowY','shadowBlur','shadowSpread','shadowDiffusion','shadowFocus','blur','brightness','contrast','saturation','backdropBlur','strokeWidth','strokeColor','objectFit','zIndex'))} onReset={() => { if (isComponentInstanceOnPage) { resetOv('hidden'); resetSOv('opacity','zIndex'); } else { resetOv('hidden','rotation'); resetSOv('opacity','mixBlendMode','overflow','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','borderRadius','borderRadiusTL','borderRadiusTR','borderRadiusBL','borderRadiusBR','borderWidth','borderColor','borderStyle','borderRadiusMode','boxShadow','shadowType','shadowPosition','shadowColor','shadowOpacity','shadowX','shadowY','shadowBlur','shadowSpread','shadowDiffusion','shadowFocus','blur','brightness','contrast','saturation','backdropBlur','strokeWidth','strokeColor','objectFit','zIndex'); } }} />
        </>}>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Opacity</span>
            <div className="fb-slider-field">
              <input
                className="fb-prop-input fb-slider-field__value"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={Math.round((s.opacity ?? 1) * 100) / 100}
                onChange={e => { const next = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)); updS('opacity', next); }}
                onBlur={commit}
              />
              <input
                className="fb-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={s.opacity ?? 1}
                onChange={e => updS('opacity', parseFloat(e.target.value))}
                onMouseUp={commit}
              />
            </div>
          </div>

          {!isComponentInstanceOnPage ? (
            <div className="fb-prop-row">
              <span className="fb-prop-label">Shadow</span>
              <button
                type="button"
                className={`fb-shadow-style-cta${s.boxShadow ? ' is-active' : ''}`}
                ref={shadowTriggerRef}
                onClick={() => {
                  shadowDraftDirtyRef.current = false;
                  setShadowModalOpen(true);
                }}
              >
                <span className={`fb-shadow-style-cta__indicator${s.boxShadow ? ' is-active' : ''}`} />
                <span>{getShadowSummary(s)}</span>
              </button>
            </div>
          ) : null}

          {!isComponentInstanceOnPage && isDropdownField ? (
            <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
              <span className="fb-prop-label">Icon</span>
              <div style={{ width: '100%', display: 'grid', gap: 8 }}>
                <div className="fb-icon-group" role="group" aria-label="Dropdown icon">
                  {FORM_SELECT_ICON_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`fb-icon-btn${(s.selectIcon ?? FORM_STYLE_DEFAULTS.selectIcon) === option.value ? ' fb-icon-btn--active' : ''}`}
                      title={option.label}
                      onClick={() => { updS('selectIcon', option.value); commit(); }}
                    >
                      <span aria-hidden="true">{option.icon}</span>
                    </button>
                  ))}
                </div>
                {(s.selectIcon ?? FORM_STYLE_DEFAULTS.selectIcon) !== 'none' ? (
                  <ColorInput value={s.iconColor ?? s.placeholderColor ?? FORM_STYLE_DEFAULTS.iconColor} onChange={v => { updS('iconColor', v); commit(); }} />
                ) : null}
              </div>
            </div>
          ) : null}

          {!isComponentInstanceOnPage && (
          <div className="fb-prop-row">
            <span className="fb-prop-label">Blend</span>
            <select
              className="fb-prop-input"
              value={s.mixBlendMode ?? 'normal'}
              onChange={e => { updS('mixBlendMode', e.target.value); commit(); }}
            >
              <option value="normal">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="overlay">Overlay</option>
              <option value="darken">Darken</option>
              <option value="lighten">Lighten</option>
              <option value="color-dodge">Color Dodge</option>
              <option value="color-burn">Color Burn</option>
              <option value="hard-light">Hard Light</option>
              <option value="soft-light">Soft Light</option>
              <option value="difference">Difference</option>
              <option value="exclusion">Exclusion</option>
              <option value="hue">Hue</option>
              <option value="saturation">Saturation</option>
              <option value="color">Color</option>
              <option value="luminosity">Luminosity</option>
            </select>
          </div>
          )}

          {/* Optional effects: only shown when "added". Each has an X to remove. */}
          {!isComponentInstanceOnPage && (() => {
            const active = _allowed.filter(_isEffectActive);
            const rowForKey = (key) => {
              if (key === 'pointerEvents') {
                return (
                  <div key={key} className="fb-prop-row fb-prop-row--effect">
                    <span className="fb-prop-label">Pointer</span>
                    <ChoiceGroup
                      value={s.pointerEvents ?? 'auto'}
                      onChange={(value) => { updS('pointerEvents', value); commit(); }}
                      options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'none', label: 'None' },
                      ]}
                    />
                    <button type="button" className="fb-effect-remove" title="Remove" onClick={() => _removeEffect('pointerEvents')}>×</button>
                  </div>
                );
              }
              const cfg = {
                blur:         { max: 64,  step: 0.5, round: 10, fallback: 0 },
                brightness:   { max: 200, step: 1,   round: 1,  fallback: 100 },
                contrast:     { max: 200, step: 1,   round: 1,  fallback: 100 },
                saturation:   { max: 200, step: 1,   round: 1,  fallback: 100 },
                backdropBlur: { max: 64,  step: 0.5, round: 10, fallback: 0 },
              }[key];
              if (!cfg) return null;
              const def = _effectDefs.find(e => e.key === key);
              const val = s[key] ?? cfg.fallback;
              return (
                <div key={key} className="fb-prop-row fb-prop-row--effect">
                  <span className="fb-prop-label">{def.label}</span>
                  <div className="fb-slider-field">
                    <input
                      className="fb-prop-input fb-slider-field__value"
                      type="number"
                      min={0}
                      max={cfg.max}
                      step={cfg.step}
                      value={Math.round(val * cfg.round) / cfg.round}
                      onChange={e => { const next = Math.max(0, Math.min(cfg.max, parseFloat(e.target.value) || 0)); updS(key, next); }}
                      onBlur={commit}
                    />
                    <input
                      className="fb-slider"
                      type="range"
                      min={0}
                      max={cfg.max}
                      step={cfg.step}
                      value={val}
                      onChange={e => updS(key, parseFloat(e.target.value))}
                      onMouseUp={commit}
                    />
                  </div>
                  <button type="button" className="fb-effect-remove" title="Remove" onClick={() => _removeEffect(key)}>×</button>
                </div>
              );
            };
            return active.length > 0 ? active.map(d => rowForKey(d.key)) : null;
          })()}

          {/* removed: old always-on Blur/Brightness/Contrast/Saturation/Backdrop Blur/Pointer rows */}
          {false && (
          <div className="fb-prop-row">
            <span className="fb-prop-label">Blur</span>
            <div className="fb-slider-field">
              <input
                className="fb-prop-input fb-slider-field__value"
                type="number"
                min={0}
                max={64}
                step={0.5}
                value={Math.round((s.blur ?? 0) * 10) / 10}
                onChange={e => { const next = Math.max(0, Math.min(64, parseFloat(e.target.value) || 0)); updS('blur', next); }}
                onBlur={commit}
              />
              <input
                className="fb-slider"
                type="range"
                min={0}
                max={64}
                step={0.5}
                value={s.blur ?? 0}
                onChange={e => updS('blur', parseFloat(e.target.value))}
                onMouseUp={commit}
              />
            </div>
          </div>
          )}

          <div className="fb-prop-row">
            <VariableBindingLabel label="Visible">
              {allowVariableBindings ? (
                renderInlineBindingButton('hidden', (value) => updateElementLayout(element.id, bpId, { hidden: !value }), {
                  label: 'Visible',
                  fallbackLabel: 'Visibility',
                  createMeta: 'Create a component visibility variable for this layer',
                })
              ) : null}
            </VariableBindingLabel>
            {hiddenBindingVariable ? (
              <BoundVariableCta variable={hiddenBindingVariable} fallbackLabel="Visibility variable" />
            ) : (
              <ChoiceGroup
                value={resolved.hidden ? 'no' : 'yes'}
                onChange={v => { upd('hidden', v === 'no'); commit(); }}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
              />
            )}
          </div>

          {supportsDirectLink ? (
            <>
              <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                <VariableBindingLabel label="URL">
                  {allowVariableBindings ? (
                    renderInlineBindingButton('linkUrl', (value) => updateElementLayout(element.id, bpId, { linkUrl: `${value ?? ''}` }), {
                      label: 'Link URL',
                      fallbackLabel: 'URL',
                      createMeta: 'Create a component link variable for this layer',
                    })
                  ) : null}
                </VariableBindingLabel>
                <div style={{ width: '100%' }}>
                  {linkUrlBindingVariable ? (
                    <BoundVariableCta variable={linkUrlBindingVariable} fallbackLabel="Link variable" />
                  ) : (
                    <input
                      className="fb-prop-input"
                      type="text"
                      value={resolved.linkUrl ?? ''}
                      placeholder="https://example.com or /page"
                      onChange={(event) => { upd('linkUrl', event.target.value); }}
                      onBlur={commit}
                    />
                  )}
                </div>
              </div>
              <div className="fb-artboard-bp-note">Published pages use this URL for click and keyboard navigation. Flow interactions take priority if both are configured.</div>
            </>
          ) : null}

          {!isComponentInstanceOnPage && element.type !== 'text' && !(element.type === 'icon' && ['path', 'pen', 'line', 'circle', 'polygon'].includes(shapeKind ?? '')) && (
          <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
            <VariableBindingLabel label="Fill">
              {allowVariableBindings && element.type !== 'image' ? (
                renderInlineBindingButton('styles.backgroundColor', (value) => updateStyles(element.id, bpId, { backgroundColor: value || '#000000' }), {
                  label: 'Background Fill',
                  fallbackLabel: 'Fill',
                  createMeta: 'Create a component fill variable for this layer',
                })
              ) : null}
            </VariableBindingLabel>
            <div style={{ width: '100%' }}>
              {fillBindingVariable ? (
                <BoundVariableCta variable={fillBindingVariable} fallbackLabel="Fill variable" />
              ) : element.type === 'image' ? (
                <MediaPickerButton value={resolved.src ?? ''} onChange={v => { upd('src', v); commit(); }} mediaType="image" />
              ) : (
                <FillPicker value={s.backgroundColor ?? '#ffffff'} onChange={v => { updS('backgroundColor', v); commit(); }} />
              )}
            </div>
          </div>
          )}

          {!isComponentInstanceOnPage && (element.type === 'frame' || isLoopElement || isFormContainerType(element.type)) && (
            <div className="fb-prop-row">
              <VariableBindingLabel label="Image">
                {allowVariableBindings ? (
                  renderInlineBindingButton('styles.backgroundImage', (value) => updateStyles(element.id, bpId, { backgroundImage: `${value ?? ''}` }), {
                    label: 'Background Image',
                    fallbackLabel: 'Image',
                    createMeta: 'Create a component image variable for this layer',
                  })
                ) : null}
              </VariableBindingLabel>
              {backgroundImageBindingVariable ? <BoundVariableCta variable={backgroundImageBindingVariable} fallbackLabel="Image variable" /> : <MediaPickerButton value={s.backgroundImage ?? ''} onChange={v => { updS('backgroundImage', v); commit(); }} mediaType="image" />}
            </div>
          )}

        {element.type === 'video' && (
          <Section title="Video" action={<ResetBtn show={isOv('src','videoProvider','videoControls','videoLoop','videoMuted','videoAutoplay','videoDisableAutoplayInBuilder') || isSOv('objectFit')} onReset={() => { resetOv('src','videoProvider','videoControls','videoLoop','videoMuted','videoAutoplay','videoDisableAutoplayInBuilder'); resetSOv('objectFit'); }} />}>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Provider</span>
              <ChoiceGroup
                value={resolved.videoProvider ?? 'upload'}
                onChange={(value) => {
                  upd('videoProvider', value);
                  upd('src', '');
                  commit();
                }}
                options={[
                  { value: 'youtube', label: 'YouTube' },
                  { value: 'vimeo', label: 'Vimeo' },
                  { value: 'upload', label: 'Media' },
                ]}
              />
            </div>

            <div className="fb-prop-row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
              <span className="fb-prop-label">Source</span>
              <div style={{ flex: 1 }}>
                {(resolved.videoProvider ?? 'upload') === 'upload' ? (
                  <MediaPickerButton value={resolved.src ?? ''} onChange={v => { upd('src', v); commit(); }} mediaType="video" />
                ) : (
                  <input
                    className="fb-prop-input"
                    type="url"
                    value={resolved.src ?? ''}
                    placeholder={(resolved.videoProvider ?? 'upload') === 'vimeo' ? 'https://vimeo.com/...' : 'https://youtube.com/watch?v=...'}
                    onChange={event => upd('src', event.target.value)}
                    onBlur={commit}
                  />
                )}
                <div className="fb-artboard-bp-note" style={{ marginTop: 6 }}>
                  {(resolved.videoProvider ?? 'upload') === 'upload'
                    ? 'Choose a video from the WordPress media library.'
                    : `Paste a ${(resolved.videoProvider ?? 'upload') === 'vimeo' ? 'Vimeo' : 'YouTube'} URL. The builder will convert it to an embed automatically.`}
                </div>
              </div>
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Controls</span>
              <ChoiceGroup
                value={resolved.videoControls !== false ? 'on' : 'off'}
                onChange={(value) => { upd('videoControls', value === 'on'); commit(); }}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Loop</span>
              <ChoiceGroup
                value={resolved.videoLoop === true ? 'on' : 'off'}
                onChange={(value) => { upd('videoLoop', value === 'on'); commit(); }}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Mute</span>
              <ChoiceGroup
                value={resolved.videoMuted === true ? 'on' : 'off'}
                onChange={(value) => { upd('videoMuted', value === 'on'); commit(); }}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Autoplay</span>
              <ChoiceGroup
                value={resolved.videoAutoplay === true ? 'on' : 'off'}
                onChange={(value) => {
                  const enabled = value === 'on';
                  upd('videoAutoplay', enabled);
                  if (enabled) upd('videoMuted', true);
                  commit();
                }}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Builder autoplay</span>
              <ChoiceGroup
                value={resolved.videoDisableAutoplayInBuilder === true ? 'off' : 'on'}
                onChange={(value) => {
                  upd('videoDisableAutoplayInBuilder', value !== 'on');
                  commit();
                }}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Mode</span>
              <IconGroup
                value={s.objectFit ?? 'cover'}
                onChange={v => { updS('objectFit', v); commit(); }}
                options={[
                  { value: 'contain', icon: '⊡', label: 'Fit' },
                  { value: 'cover', icon: '⛶', label: 'Fill' },
                ]}
              />
            </div>
          </Section>
        )}

        {element.type === 'embed' && (
          <Section title="Embed" action={<ResetBtn show={isOv('embedMode','embedCode')} onReset={() => resetOv('embedMode','embedCode')} />}>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Mode</span>
              <ChoiceGroup
                value={resolved.embedMode ?? 'html'}
                onChange={(value) => { upd('embedMode', value); commit(); }}
                options={EMBED_MODE_OPTIONS}
              />
            </div>

            <div className="fb-prop-row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
              <span className="fb-prop-label">Code</span>
              <div style={{ flex: 1 }}>
                <textarea
                  className="fb-prop-input"
                  rows={10}
                  value={resolved.embedCode ?? ''}
                  placeholder={(resolved.embedMode ?? 'html') === 'shortcode'
                    ? '[contact-form-7 id="123"]'
                    : (resolved.embedMode ?? 'html') === 'php'
                      ? '<?php echo do_shortcode("[gallery]"); ?>'
                      : (resolved.embedMode ?? 'html') === 'react'
                        ? '<Component prop="value" />'
                        : '<div style="padding:24px">Custom HTML</div>'}
                  onChange={(event) => upd('embedCode', event.target.value)}
                  onBlur={commit}
                  style={{ minHeight: 170, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}
                />
                <div className="fb-artboard-bp-note" style={{ marginTop: 6 }}>
                  {(resolved.embedMode ?? 'html') === 'html'
                    ? 'HTML renders inside an isolated iframe preview. Scripts are stripped.'
                    : (resolved.embedMode ?? 'html') === 'shortcode'
                      ? 'Shortcodes render on publish in WordPress. The builder keeps this as a placeholder so the editor stays stable.'
                      : (resolved.embedMode ?? 'html') === 'php'
                        ? 'PHP is stored with the element, but it is not executed in the builder or published output.'
                        : 'React snippets are stored with the element, but they are not compiled in the builder or published output.'}
                </div>
              </div>
            </div>
          </Section>
        )}

        {element.type === 'scroll-sequence' && (() => {
          const sequenceType = resolved.scrollSequenceType ?? 'video';
          const sourceMode = resolved.scrollSequenceSourceMode ?? 'library';
          const frameCount = Array.isArray(resolved.scrollSequenceFrames) ? resolved.scrollSequenceFrames.length : 0;
          const hasMedia = sequenceType === 'image-sequence' ? frameCount > 0 : !!resolved.scrollSequenceSrc;
          const mediaStatus = sequenceType === 'image-sequence'
            ? `${frameCount} ${frameCount === 1 ? 'frame' : 'frames'}`
            : (hasMedia ? 'Source ready' : 'Source missing');
          const sequenceLabel = sequenceType === 'image-sequence'
            ? 'Image Sequence'
            : (sequenceType === 'gif' ? 'GIF' : 'Video');
          const sourceLabel = sourceMode === 'library' ? 'Media Library' : 'Direct Link';
          const markerSummary = Number.isFinite(resolved.scrollSequenceStartOffsetPx) && Number.isFinite(resolved.scrollSequenceEndOffsetPx)
            ? `${Math.round(resolved.scrollSequenceStartOffsetPx)} px to ${Math.round(resolved.scrollSequenceEndOffsetPx)} px`
            : 'Artboard-linked marker positions';

          return (
            <Section title="Scroll Sequence" action={<ResetBtn show={isOv('scrollSequenceType','scrollSequenceSourceMode','scrollSequenceSrc','scrollSequenceFrames','scrollSequenceStart','scrollSequenceEnd','scrollSequenceStartOffsetPx','scrollSequenceEndOffsetPx') || isSOv('objectFit')} onReset={() => { resetOv('scrollSequenceType','scrollSequenceSourceMode','scrollSequenceSrc','scrollSequenceFrames','scrollSequenceStart','scrollSequenceEnd','scrollSequenceStartOffsetPx','scrollSequenceEndOffsetPx'); resetSOv('objectFit'); }} />}>
              <div className="fb-scroll-sequence-card">
                <div className="fb-scroll-sequence-card__header">
                  <div className="fb-scroll-sequence-card__copy">
                    <span className="fb-scroll-sequence-card__eyebrow">{sequenceLabel}</span>
                    <span className="fb-scroll-sequence-card__title">{sourceLabel}</span>
                  </div>
                  <span className={`fb-scroll-sequence-card__badge${hasMedia ? ' is-ready' : ''}`}>{mediaStatus}</span>
                </div>
                <div className="fb-scroll-sequence-card__meta">
                  <span>{sourceMode === 'library' ? 'Managed from WordPress media.' : 'Uses a direct public URL.'}</span>
                  <span>{s.objectFit === 'contain' ? 'Fit inside frame' : 'Fill frame bounds'}</span>
                </div>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 10 }}>
                <span className="fb-prop-label">Type</span>
                <ChoiceGroup
                  value={sequenceType}
                  onChange={(value) => {
                    upd('scrollSequenceType', value);
                    if (value !== 'image-sequence') upd('scrollSequenceFrames', []);
                    commit();
                  }}
                  options={[
                    { value: 'video', label: 'Video' },
                    { value: 'image-sequence', label: 'Image Seq' },
                    { value: 'gif', label: 'GIF' },
                  ]}
                />
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Input</span>
                <ChoiceGroup
                  value={sourceMode}
                  onChange={(value) => { upd('scrollSequenceSourceMode', value); commit(); }}
                  options={[
                    { value: 'library', label: 'Library' },
                    { value: 'url', label: 'Link' },
                  ]}
                />
              </div>

              <div className="fb-prop-row fb-prop-row--full fb-scroll-sequence-panel">
                <div className="fb-scroll-sequence-panel__header">
                  <span className="fb-prop-label">Media</span>
                  <span className="fb-scroll-sequence-panel__hint">
                    {sequenceType === 'image-sequence' ? 'Add frames in playback order.' : 'Choose a single source file.'}
                  </span>
                </div>
                <div className="fb-scroll-sequence-panel__body">
                  {sequenceType === 'image-sequence' ? (
                    <ScrollSequenceFrameListEditor
                      value={resolved.scrollSequenceFrames ?? []}
                      sourceMode={sourceMode}
                      onChange={(nextFrames) => { upd('scrollSequenceFrames', nextFrames); commit(); }}
                    />
                  ) : (sourceMode === 'library' ? (
                    <MediaPickerButton
                      value={resolved.scrollSequenceSrc ?? ''}
                      onChange={(nextValue) => { upd('scrollSequenceSrc', nextValue); commit(); }}
                      mediaType={sequenceType === 'video' ? 'video' : 'image'}
                    />
                  ) : (
                    <input
                      className="fb-prop-input"
                      type="url"
                      value={resolved.scrollSequenceSrc ?? ''}
                      placeholder={sequenceType === 'video' ? 'https://example.com/video.mp4' : 'https://example.com/sequence.gif'}
                      onChange={(event) => upd('scrollSequenceSrc', event.target.value)}
                      onBlur={commit}
                    />
                  ))}
                  <div className="fb-artboard-bp-note">
                    {sequenceType === 'image-sequence'
                      ? 'Use consistent dimensions for every frame. Media Library and direct image URLs both work here.'
                      : (sequenceType === 'video'
                        ? 'Use a direct MP4 or WebM file. Hosted media URLs are better than embed pages.'
                        : 'Choose or paste a GIF source. It will scrub inside the same marker range.')}
                  </div>
                </div>
              </div>

              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Fit</span>
                <IconGroup
                  value={s.objectFit ?? 'cover'}
                  onChange={v => { updS('objectFit', v); commit(); }}
                  options={[
                    { value: 'contain', icon: '⊡', label: 'Fit' },
                    { value: 'cover', icon: '⛶', label: 'Fill' },
                  ]}
                />
              </div>

              <div className="fb-prop-row fb-prop-row--full fb-scroll-sequence-panel">
                <div className="fb-scroll-sequence-panel__header">
                  <span className="fb-prop-label">Markers</span>
                  <span className="fb-scroll-sequence-panel__hint">Top of the sequence is 0 px.</span>
                </div>
                <div className="fb-scroll-sequence-panel__actions">
                  <button
                    type="button"
                    className="fb-secondary-btn"
                    onClick={() => openScrollSequenceRangeEditor({ elementId: element.id, bpId })}
                  >
                    Edit Markers
                  </button>
                  <span className="fb-scroll-sequence-panel__range">{markerSummary}</span>
                </div>
              </div>
            </Section>
          );
        })()}

          {!isComponentInstanceOnPage && element.type === 'image' && allowVariableBindings && (
            <div className="fb-prop-row">
              <VariableBindingLabel label="Source">
                {renderInlineBindingButton('src', (value) => updateElementLayout(element.id, bpId, { src: `${value ?? ''}` }), {
                  label: 'Image Source',
                  fallbackLabel: 'Source',
                  createMeta: 'Create a component image variable for this layer',
                })}
              </VariableBindingLabel>
              {sourceBindingVariable ? <BoundVariableCta variable={sourceBindingVariable} fallbackLabel="Source variable" /> : <div className="fb-artboard-bp-note">Image source can be driven by an image variable.</div>}
            </div>
          )}

          {!isComponentInstanceOnPage && ((element.type === 'image') || ((element.type === 'frame' || isLoopElement || isFormContainerType(element.type)) && s.backgroundImage)) && (
            <div className="fb-prop-row">
              <span className="fb-prop-label">Fit</span>
              <IconGroup
                value={element.type === 'image' ? (s.objectFit ?? 'cover') : (s.backgroundSize ?? 'cover')}
                onChange={v => {
                  if (element.type === 'image') updS('objectFit', v);
                  else updS('backgroundSize', v);
                  commit();
                }}
                options={[
                  { value: 'cover', icon: '⛶', label: 'Fill' },
                  { value: 'contain', icon: '⊡', label: 'Contain' },
                  { value: element.type === 'image' ? 'fill' : '100% 100%', icon: '⊞', label: 'Stretch' },
                  { value: element.type === 'image' ? 'none' : 'repeat', icon: '·', label: element.type === 'image' ? 'None' : 'Repeat' },
                ]}
              />
            </div>
          )}

          {!isComponentInstanceOnPage && (
          <div className="fb-prop-row">
            <span className="fb-prop-label">Overflow</span>
            <select
              className="fb-prop-input"
              value={s.overflow ?? 'visible'}
              onChange={e => { updS('overflow', e.target.value); commit(); }}
            >
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          )}

          {!isComponentInstanceOnPage && (
          <div className="fb-prop-row">
            <span className="fb-prop-label">Radius</span>
            <div className="fb-style-inline-group">
              <NumberInput value={s.borderRadius ?? 0} min={0} onChange={v => { updS('borderRadius', v); commit(); }} />
              <IconButton icon={UIIcons.radiusLinked} title="All corners equal" active={(s.borderRadiusMode ?? 'linked') === 'linked'} onClick={() => { updS('borderRadiusMode', 'linked'); commit(); }} />
              <IconButton icon={UIIcons.radiusIndependent} title="Individual corners" active={s.borderRadiusMode === 'independent'} onClick={() => { updS('borderRadiusMode', 'independent'); commit(); }} />
            </div>
          </div>
          )}

          {!isComponentInstanceOnPage && s.borderRadiusMode === 'independent' && (
            <div className="fb-prop-row">
              <span className="fb-prop-label" />
              <div className="fb-quad fb-quad--spaced">
                <NumberInput value={s.borderRadiusTL ?? s.borderRadius ?? 0} min={0} label="TL" onChange={v => { updS('borderRadiusTL', v); commit(); }} />
                <NumberInput value={s.borderRadiusTR ?? s.borderRadius ?? 0} min={0} label="TR" onChange={v => { updS('borderRadiusTR', v); commit(); }} />
                <NumberInput value={s.borderRadiusBL ?? s.borderRadius ?? 0} min={0} label="BL" onChange={v => { updS('borderRadiusBL', v); commit(); }} />
                <NumberInput value={s.borderRadiusBR ?? s.borderRadius ?? 0} min={0} label="BR" onChange={v => { updS('borderRadiusBR', v); commit(); }} />
              </div>
            </div>
          )}

          {!isComponentInstanceOnPage && (
          <div className="fb-prop-row">
            <span className="fb-prop-label">Stroke</span>
            {(s.borderWidth ?? 0) > 0 ? (
              <div className="fb-style-inline-group fb-style-inline-group--stacked">
                <NumberInput value={s.borderWidth ?? 0} min={0} onChange={v => { updS('borderWidth', v); updS('borderStyle', 'solid'); commit(); }} />
                <FillPicker value={s.borderColor ?? '#000000'} onChange={v => { updS('borderColor', v); updS('borderStyle', 'solid'); commit(); }} />
              </div>
            ) : (
              <button
                type="button"
                className="fb-add-field"
                onClick={() => { updS('borderWidth', 1); updS('borderStyle', 'solid'); commit(); }}
              >
                Add...
              </button>
            )}
          </div>
          )}

          {!isComponentInstanceOnPage && element.type === 'text' && (
          <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
            <span className="fb-prop-label">Stroke</span>
            {(s.strokeWidth ?? 0) > 0 ? (
              <div className="fb-style-inline-group fb-style-inline-group--stacked" style={{ width: '100%' }}>
                <NumberInput value={s.strokeWidth ?? 0} min={0} step={0.1} onChange={v => { updS('strokeWidth', v); commit(); }} />
                <FillPicker value={s.strokeColor ?? (element.type === 'icon' ? (s.color ?? '#111827') : '#000000')} onChange={v => { updS('strokeColor', v); commit(); }} />
              </div>
            ) : (
              <button
                type="button"
                className="fb-add-field"
                onClick={() => {
                  updS('strokeWidth', 1);
                  updS('strokeColor', element.type === 'icon' ? (s.color ?? '#111827') : '#000000');
                  commit();
                }}
              >
                Add...
              </button>
            )}
          </div>
          )}

          <div className="fb-prop-row">
            <VariableBindingLabel label="Z Index">
              {allowVariableBindings ? (
                renderInlineBindingButton('styles.zIndex', (value) => updateStyles(element.id, bpId, { zIndex: Math.round(parseFloat(value) || 0) }), {
                  label: 'Z Index',
                  fallbackLabel: 'Z Index',
                  createMeta: 'Create a component z-index variable for this layer',
                })
              ) : null}
            </VariableBindingLabel>
            {zIndexBindingVariable ? (
              <BoundVariableCta variable={zIndexBindingVariable} fallbackLabel="Z-index variable" />
            ) : (
              <div className="fb-stepper-field">
                <input
                  className="fb-prop-input fb-stepper-field__value"
                  type="number"
                  step={1}
                  value={Math.round(s.zIndex ?? 1)}
                  onChange={e => updS('zIndex', Math.round(parseFloat(e.target.value) || 0))}
                  onBlur={commit}
                />
                <div className="fb-icon-group">
                  <IconButton icon={UIIcons.minus} title="Decrease z-index" onClick={() => { updS('zIndex', Math.round((s.zIndex ?? 1) - 1)); commit(); }} />
                  <IconButton icon={UIIcons.plus} title="Increase z-index" onClick={() => { updS('zIndex', Math.round((s.zIndex ?? 1) + 1)); commit(); }} />
                </div>
              </div>
            )}
          </div>
        </Section>
        );})() : null}

        <Section title="Advanced" defaultOpen={false} action={<ResetBtn show={isOv('src')} onReset={() => { resetOv('src'); }} />}>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Name</span>
            <input
              className="fb-prop-input"
              type="text"
              value={element.name || element.base?.name || element.type || ''}
              onChange={e => updateElementBase(element.id, { name: e.target.value })}
              onBlur={commit}
            />
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Lock</span>
            <ChoiceGroup
              value={(resolved.locked ?? element.locked ?? element.base?.locked) ? 'yes' : 'no'}
              onChange={v => { updateElementLayout(element.id, 'desktop', { locked: v === 'yes' }); commit(); }}
              options={[
                { value: 'no', label: 'No' },
                { value: 'yes', label: 'Yes' },
              ]}
            />
          </div>
        </Section>

      </div>
      {selectedElementAnimation?.type === 'loop' || selectedElementAnimation?.type === 'hover' ? (
        <ElementAnimationModal
          animation={selectedElementAnimation}
          anchorRect={elementAnimationModalState?.anchorRect ?? null}
          containerRect={toViewportRect(selectedPanelRef.current)}
          variantOptions={animationVariantOptions}
          onClose={() => {
            if (animationDraftDirtyRef.current) {
              animationDraftDirtyRef.current = false;
              commit();
            }
            setElementAnimationModalState(null);
            closeAnimationEditor();
          }}
          onDelete={() => {
            animationDraftDirtyRef.current = false;
            removeElementAnimation(element.id, bpId, selectedElementAnimation.id);
            commit();
            setElementAnimationModalState(null);
            closeAnimationEditor();
          }}
          onPreview={(nextAnimation) => {
            animationDraftDirtyRef.current = true;
            updateElementAnimation(element.id, bpId, selectedElementAnimation.id, nextAnimation);
          }}
          onSave={(nextAnimation) => {
            animationDraftDirtyRef.current = false;
            updateElementAnimation(element.id, bpId, selectedElementAnimation.id, nextAnimation);
            commit();
          }}
          onOpenEditor={(mode, nextAnimation) => {
            if (nextAnimation) {
              animationDraftDirtyRef.current = false;
              updateElementAnimation(element.id, bpId, selectedElementAnimation.id, nextAnimation);
              commit();
            }
            setElementAnimationModalState(null);
            openAnimationEditor({
              elementId: element.id,
              bpId,
              animationId: selectedElementAnimation.id,
              mode,
            });
          }}
        />
      ) : null}
      {selectedElementAnimation && selectedElementAnimation.type !== 'loop' && selectedElementAnimation.type !== 'hover' ? (
        <ElementAnimationModal
          animation={selectedElementAnimation}
          anchorRect={elementAnimationModalState?.anchorRect ?? null}
          containerRect={toViewportRect(selectedPanelRef.current)}
          variantOptions={animationVariantOptions}
          onClose={() => {
            if (animationDraftDirtyRef.current) {
              animationDraftDirtyRef.current = false;
              commit();
            }
            setElementAnimationModalState(null);
            closeAnimationEditor();
          }}
          onDelete={() => {
            animationDraftDirtyRef.current = false;
            removeElementAnimation(element.id, bpId, selectedElementAnimation.id);
            commit();
            setElementAnimationModalState(null);
            closeAnimationEditor();
          }}
          onPreview={(nextAnimation) => {
            animationDraftDirtyRef.current = true;
            updateElementAnimation(element.id, bpId, selectedElementAnimation.id, nextAnimation);
          }}
          onSave={(nextAnimation) => {
            animationDraftDirtyRef.current = false;
            updateElementAnimation(element.id, bpId, selectedElementAnimation.id, nextAnimation);
            commit();
          }}
          onOpenEditor={(mode, nextAnimation) => {
            if (nextAnimation) {
              animationDraftDirtyRef.current = false;
              updateElementAnimation(element.id, bpId, selectedElementAnimation.id, nextAnimation);
              commit();
            }
            setElementAnimationModalState(null);
            openAnimationEditor({
              elementId: element.id,
              bpId,
              animationId: selectedElementAnimation.id,
              mode,
            });
          }}
        />
      ) : null}
    </aside>
    {animationCardContextMenu && typeof document !== 'undefined' ? createPortal(
      <div
        className="fb-context-menu"
        style={{ left: animationCardContextMenu.x, top: animationCardContextMenu.y }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="fb-context-menu__item" onClick={copyAnimationCard}>Copy animation</button>
        <button type="button" className="fb-context-menu__item" onClick={pasteAnimationCard} disabled={!hasStoredAnimationClipboard}>Paste animation</button>
      </div>,
      document.body,
    ) : null}
    {shadowModalOpen ? (
      <ShadowSetupModal
        anchorRef={shadowTriggerRef}
        initialValue={getShadowDraftFromStyles(s)}
        onClose={() => {
          setShadowModalOpen(false);
          if (shadowDraftDirtyRef.current) {
            shadowDraftDirtyRef.current = false;
            commit();
          }
        }}
        onChange={(draft) => {
          shadowDraftDirtyRef.current = true;
          updateStyles(element.id, bpId, buildShadowStylePayload(draft));
        }}
        onRemove={() => {
          shadowDraftDirtyRef.current = false;
          updateStyles(element.id, bpId, buildShadowStylePayload({ ...getShadowDraftFromStyles(s), enabled: false }));
          setShadowModalOpen(false);
          commit();
        }}
      />
    ) : null}
    </>
  );
}

function ShadowStepper({ value, min = -9999, max = 9999, step = 1, onChange }) {
  const nextValue = clampShadowValue(value, 0, min, max);
  return (
    <div className="fb-shadow-modal__stepper">
      <input
        className="fb-prop-input fb-shadow-modal__stepper-value"
        type="number"
        min={min}
        max={max}
        step={step}
        value={roundShadowValue(nextValue, 2)}
        onChange={(event) => onChange(clampShadowValue(event.target.value, nextValue, min, max))}
      />
      <div className="fb-icon-group fb-shadow-modal__stepper-actions">
        <IconButton icon={UIIcons.minus} title="Decrease value" onClick={() => onChange(clampShadowValue(nextValue - step, nextValue, min, max))} />
        <IconButton icon={UIIcons.plus} title="Increase value" onClick={() => onChange(clampShadowValue(nextValue + step, nextValue, min, max))} />
      </div>
    </div>
  );
}

function ShadowColorField({ color, opacity, onColorChange, onOpacityChange }) {
  const [draft, setDraft] = useState(rgbaToHex(color ?? '#000000').replace('#', '').toUpperCase());

  useEffect(() => {
    setDraft(rgbaToHex(color ?? '#000000').replace('#', '').toUpperCase());
  }, [color]);

  return (
    <div className="fb-shadow-modal__color-wrap">
      <div className="fb-shadow-modal__color-main">
        <FillPicker
          value={buildShadowColor(color, opacity)}
          onChange={(nextValue) => {
            onColorChange(rgbaToHex(nextValue));
            onOpacityChange(getShadowColorOpacity(nextValue));
          }}
          solidOnly
          compact
          title="Edit shadow color"
          popoverPlacement="bottom-start"
        />
        <input
          className="fb-prop-input fb-shadow-modal__hex"
          type="text"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase())}
          onBlur={() => {
            const normalized = draft.length === 6 ? `#${draft}` : rgbaToHex(color ?? '#000000');
            setDraft(normalized.replace('#', '').toUpperCase());
            onColorChange(normalized);
          }}
        />
      </div>
      <input
        className="fb-prop-input fb-shadow-modal__opacity"
        type="number"
        min={0}
        max={100}
        step={1}
        value={Math.round(clampShadowValue(opacity, 1, 0, 1) * 100)}
        onChange={(event) => onOpacityChange(clampShadowValue((parseFloat(event.target.value) || 0) / 100, opacity, 0, 1))}
      />
    </div>
  );
}

function ShadowSetupModal({ anchorRef, initialValue, onClose, onChange, onRemove }) {
  const [draft, setDraft] = useState(initialValue);
  const popupRef = useRef(null);
  const previewFrameRef = useRef(0);
  const queuedDraftRef = useRef(initialValue);
  const [position, setPosition] = useState({ top: 32, left: 32, ready: false });

  useEffect(() => {
    setDraft(initialValue);
    queuedDraftRef.current = initialValue;
  }, [initialValue]);

  useEffect(() => () => {
    if (previewFrameRef.current) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = 0;
    }
  }, []);

  useLayoutEffect(() => {
    if (!anchorRef?.current) return undefined;

    const updatePosition = () => {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const panelRect = anchorRef.current?.closest('.fb-right')?.getBoundingClientRect();
      const popupWidth = Math.min(popupRef.current?.offsetWidth ?? 340, window.innerWidth - 24);
      const popupHeight = Math.min(popupRef.current?.offsetHeight ?? 560, window.innerHeight - 24);
      const panelLeft = panelRect?.left ?? anchorRect?.left ?? 0;
      const panelRight = panelRect?.right ?? anchorRect?.right ?? 12;
      const anchorTop = anchorRect?.top ?? panelRect?.top ?? 24;
      const fitsLeft = panelLeft - popupWidth - 12 >= 12;
      let left = fitsLeft ? panelLeft - popupWidth - 12 : panelRight + 12;
      if (left + popupWidth > window.innerWidth - 12) {
        left = window.innerWidth - popupWidth - 12;
      }
      const top = Math.max(12, Math.min(window.innerHeight - popupHeight - 12, anchorTop - 6));
      setPosition({ top, left: Math.max(12, left), ready: true });
    };

    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target;
      if (popupRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.fb-fill-popover')) return;
      onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, onClose]);

  const updateDraft = (patch) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      queuedDraftRef.current = next;
      if (!previewFrameRef.current) {
        previewFrameRef.current = window.requestAnimationFrame(() => {
          previewFrameRef.current = 0;
          onChange(queuedDraftRef.current);
        });
      }
      return next;
    });
  };

  const popup = (
    <div
      ref={popupRef}
      className="fb-shadow-popup"
      data-inline-editor-ui="true"
      style={{ top: position.top, left: position.left, visibility: position.ready ? 'visible' : 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="fb-shadow-popup__card fb-shadow-modal">
        <div className="fb-shadow-popup__head fb-shadow-modal__head">
          <div>
            <div className="fb-shadow-popup__title">Shadow</div>
            <div className="fb-shadow-modal__subtitle">Tune the layer shadow without leaving the panel.</div>
          </div>
          <IconButton icon={UIIcons.close} title="Close shadow popup" onClick={onClose} />
        </div>

        <div className="fb-shadow-popup__body fb-shadow-modal__body">
          <div className="fb-prop-row">
            <span className="fb-prop-label">Type</span>
            <ChoiceGroup
              value={draft.type}
              onChange={(value) => updateDraft({ type: value })}
              options={[
                { value: 'drop', label: 'Drop' },
                { value: 'realistic', label: 'Realistic' },
              ]}
            />
          </div>

          <div className="fb-prop-row">
            <span className="fb-prop-label">Position</span>
            <ChoiceGroup
              value={draft.position}
              onChange={(value) => updateDraft({ position: value })}
              options={[
                { value: 'outside', label: 'Outside' },
                { value: 'inside', label: 'Inside' },
              ]}
            />
          </div>

          <div className="fb-prop-row">
            <span className="fb-prop-label">Color</span>
            <ShadowColorField
              color={draft.color}
              opacity={draft.opacity}
              onColorChange={(value) => updateDraft({ color: value })}
              onOpacityChange={(value) => updateDraft({ opacity: value })}
            />
          </div>

          <div className="fb-prop-row">
            <span className="fb-prop-label">X</span>
            <ShadowStepper value={draft.x} step={1} onChange={(value) => updateDraft({ x: value })} />
          </div>

          <div className="fb-prop-row">
            <span className="fb-prop-label">Y</span>
            <ShadowStepper value={draft.y} step={1} onChange={(value) => updateDraft({ y: value })} />
          </div>

          {draft.type === 'realistic' ? (
            <>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Diffusion</span>
                <div className="fb-slider-field">
                  <input
                    className="fb-prop-input fb-slider-field__value"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={roundShadowValue(draft.diffusion, 2)}
                    onChange={(event) => updateDraft({ diffusion: clampShadowValue(event.target.value, draft.diffusion, 0, 1) })}
                  />
                  <input
                    className="fb-slider"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.diffusion}
                    onChange={(event) => updateDraft({ diffusion: clampShadowValue(event.target.value, draft.diffusion, 0, 1) })}
                  />
                </div>
              </div>

              <div className="fb-prop-row">
                <span className="fb-prop-label">Focus</span>
                <div className="fb-slider-field">
                  <input
                    className="fb-prop-input fb-slider-field__value"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={roundShadowValue(draft.focus, 2)}
                    onChange={(event) => updateDraft({ focus: clampShadowValue(event.target.value, draft.focus, 0, 1) })}
                  />
                  <input
                    className="fb-slider"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.focus}
                    onChange={(event) => updateDraft({ focus: clampShadowValue(event.target.value, draft.focus, 0, 1) })}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Blur</span>
                <ShadowStepper value={draft.blur} min={0} step={1} onChange={(value) => updateDraft({ blur: value })} />
              </div>

              <div className="fb-prop-row">
                <span className="fb-prop-label">Spread</span>
                <ShadowStepper value={draft.spread} step={1} onChange={(value) => updateDraft({ spread: value })} />
              </div>
            </>
          )}
        </div>

        <div className="fb-shadow-popup__actions">
          <button type="button" className="fb-secondary-btn" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
