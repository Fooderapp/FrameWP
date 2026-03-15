import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore, resolveElement, resolveElementWithVariables, resolveBackground, resolvePagePadding, resolvePageLayout, getSelectionElementIds } from '../store/editorStore';
import FillPicker from '../components/FillPicker';
import GoogleFontPicker from '../components/GoogleFontPicker';
import CustomSelect from '../components/CustomSelect';
import { IconButton, UIIcons } from '../components/UIIcons';
import { getSvgStrokeWidth, hasSvgVisibleStroke, sanitizeSvgMarkup, setSvgStrokeWidth } from '../components/iconLibrary';
import { getRichTextInlineStyleValues } from '../components/richText';
import VariantTransitionModal from '../components/VariantTransitionModal';

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

function getDefaultInteractionValue(variableType) {
  if (variableType === 'boolean') return false;
  if (variableType === 'color') return '#000000';
  if (variableType === 'number') return 0;
  return '';
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

function VariableBindingButton({ variables, binding, onSelect, onRemove, title = 'Bind variable' }) {
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

function InteractionSection({ interactions, variableSources, interactionVariables, allVariables, updateInteraction, removeInteraction, addInteraction }) {
  const interactionCount = interactions.length;
  const title = (
    <span className="fb-section-title-with-badge">
      <span>Interactions</span>
      {interactionCount ? <span className="fb-section-badge">{interactionCount} added</span> : null}
    </span>
  );

  return (
    <Section
      title={title}
      defaultOpen={interactionCount > 0}
      action={<button type="button" className="fb-add-field fb-add-field--compact" onClick={addInteraction}>Add</button>}
    >
      {interactionCount ? interactions.map((interaction) => {
        const selectedVariable = interaction.type === 'set-variable'
          ? allVariables.find((variable) => variable.id === interaction.variableId && variable.scope === interaction.variableScope) ?? null
          : null;
        const operation = interaction.operation || 'set';
        const usesDefaultValue = operation === 'default';
        const usesToggle = selectedVariable?.type === 'boolean' && operation === 'toggle';
        const showValueInput = !!selectedVariable && !usesDefaultValue && !usesToggle;

        return (
          <div key={interaction.id} className="fb-interaction-card">
            <div className="fb-interaction-card__head">
              <select
                className="fb-prop-input"
                value={interaction.type}
                onChange={(event) => {
                  if (event.target.value === 'navigate') {
                    const nextPage = variableSources.pages[0] ?? null;
                    updateInteraction(interaction.id, {
                      type: 'navigate',
                      pageId: nextPage?.id ?? 0,
                      pageTitle: nextPage?.title ?? '',
                      pageUrl: nextPage?.url ?? '',
                    });
                    return;
                  }
                  const nextVariable = interactionVariables[0] ?? null;
                  updateInteraction(interaction.id, {
                    type: 'set-variable',
                    variableId: nextVariable?.id ?? '',
                    variableScope: nextVariable?.scope ?? 'page',
                    variableType: nextVariable?.type ?? 'string',
                    operation: 'set',
                    value: getDefaultInteractionValue(nextVariable?.type ?? 'string'),
                  });
                }}
              >
                <option value="navigate">Navigate to</option>
                <option value="set-variable">Set variable</option>
              </select>
              <span className="fb-interaction-card__status">Added</span>
              <IconButton icon={UIIcons.trash} title="Remove interaction" onClick={() => removeInteraction(interaction.id)} />
            </div>

            {interaction.type === 'navigate' ? (
              <div className="fb-prop-row" style={{ marginBottom: 0 }}>
                <span className="fb-prop-label">Page</span>
                <select
                  className="fb-prop-input"
                  value={interaction.pageId || ''}
                  onChange={(event) => {
                    const nextPage = variableSources.pages.find((pageEntry) => String(pageEntry.id) === event.target.value) ?? null;
                    updateInteraction(interaction.id, {
                      pageId: nextPage?.id ?? 0,
                      pageTitle: nextPage?.title ?? '',
                      pageUrl: nextPage?.url ?? '',
                    });
                  }}
                >
                  <option value="">Select page</option>
                  {variableSources.pages.map((pageEntry) => <option key={pageEntry.id} value={pageEntry.id}>{pageEntry.title}</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Variable</span>
                  <select
                    className="fb-prop-input"
                    value={`${interaction.variableScope}:${interaction.variableId}`}
                    onChange={(event) => {
                      const nextVariable = allVariables.find((variable) => `${variable.scope}:${variable.id}` === event.target.value) ?? null;
                      if (!nextVariable) return;
                      updateInteraction(interaction.id, {
                        variableId: nextVariable.id,
                        variableScope: nextVariable.scope,
                        variableType: nextVariable.type,
                        operation: 'set',
                        value: getDefaultInteractionValue(nextVariable.type),
                      });
                    }}
                  >
                    <option value="">Select variable</option>
                    {interactionVariables.map((variable) => <option key={`${variable.scope}:${variable.id}`} value={`${variable.scope}:${variable.id}`}>{variable.name} ({variable.scope})</option>)}
                  </select>
                </div>

                {selectedVariable?.type === 'number' ? (
                  <div className="fb-quad" style={{ marginTop: 6 }}>
                    <select className="fb-prop-input" value={operation} onChange={(event) => updateInteraction(interaction.id, { operation: event.target.value })}>
                      <option value="set">Set exact</option>
                      <option value="increment">Increase</option>
                      <option value="decrement">Decrease</option>
                      <option value="default">Set default value</option>
                    </select>
                    {showValueInput ? <input className="fb-prop-input" type="number" value={interaction.value ?? 0} onChange={(event) => updateInteraction(interaction.id, { value: parseFloat(event.target.value) || 0 })} /> : <div className="fb-interaction-card__hint">Uses the variable&apos;s default value</div>}
                  </div>
                ) : null}

                {selectedVariable?.type === 'string' ? (
                  <div className="fb-quad" style={{ marginTop: 6 }}>
                    <select className="fb-prop-input" value={operation} onChange={(event) => updateInteraction(interaction.id, { operation: event.target.value })}>
                      <option value="set">Set exact</option>
                      <option value="default">Set default value</option>
                    </select>
                    {showValueInput ? <input className="fb-prop-input" type="text" value={interaction.value ?? ''} onChange={(event) => updateInteraction(interaction.id, { value: event.target.value })} /> : <div className="fb-interaction-card__hint">Uses the variable&apos;s default value</div>}
                  </div>
                ) : null}

                {selectedVariable?.type === 'color' ? (
                  <div className="fb-quad" style={{ marginTop: 6 }}>
                    <select className="fb-prop-input" value={operation} onChange={(event) => updateInteraction(interaction.id, { operation: event.target.value })}>
                      <option value="set">Set exact</option>
                      <option value="default">Set default value</option>
                    </select>
                    {showValueInput ? <FillPicker value={interaction.value || '#000000'} onChange={(value) => updateInteraction(interaction.id, { value })} /> : <div className="fb-interaction-card__hint">Uses the variable&apos;s default value</div>}
                  </div>
                ) : null}

                {selectedVariable?.type === 'boolean' ? (
                  <div className="fb-quad" style={{ marginTop: 6 }}>
                    <select className="fb-prop-input" value={operation} onChange={(event) => updateInteraction(interaction.id, { operation: event.target.value })}>
                      <option value="set">Set exact</option>
                      <option value="toggle">Toggle</option>
                      <option value="default">Set default value</option>
                    </select>
                    {showValueInput ? (
                      <select className="fb-prop-input" value={interaction.value ? 'true' : 'false'} onChange={(event) => updateInteraction(interaction.id, { value: event.target.value === 'true' })}>
                        <option value="false">False</option>
                        <option value="true">True</option>
                      </select>
                    ) : <div className="fb-interaction-card__hint">{usesToggle ? 'Flips the current value' : 'Uses the variable\'s default value'}</div>}
                  </div>
                ) : null}
              </>
            )}
          </div>
        );
      }) : <div className="fb-artboard-bp-note">No interactions yet.</div>}
    </Section>
  );
}

function MediaPickerModal({ onSelect, onClose }) {
  const adminUrl = window.fbData?.adminUrl ?? '';
  const siteUrl = window.fbData?.siteUrl ?? window.location.origin;
  let src = '';
  try {
    src = new URL('admin.php?page=fb-media-picker', adminUrl || `${siteUrl.replace(/\/$/, '')}/wp-admin/`).toString();
  } catch (error) {
    src = `${siteUrl.replace(/\/$/, '')}/wp-admin/admin.php?page=fb-media-picker`;
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
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#f0f0f1', letterSpacing: '0.02em' }}>Media Library</span>
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

function MediaPickerButton({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const previewUrl = getMediaUrl(value);
  return (
    <>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {previewUrl ? (
          <div style={{ width: 36, height: 36, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
            <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : null}
        <IconButton
          icon={previewUrl ? UIIcons.swap : UIIcons.image}
          title={previewUrl ? 'Change image' : 'Select image'}
          style={{ flex: 1 }}
          onClick={() => setOpen(true)}
        />
        {previewUrl ? (
          <IconButton icon={UIIcons.trash} title="Remove image" onClick={() => onChange('')} />
        ) : null}
      </div>
      {open && <MediaPickerModal onSelect={onChange} onClose={() => setOpen(false)} />}
    </>
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

/** Visual constraint selector — placed in center of TLRB cross; lines = toggleable pins */
function ConstraintWidget({ constraints, onChange }) {
  const c = { top: true, left: true, right: false, bottom: false, ...constraints };
  const t = (key) => onChange({ ...c, [key]: !c[key] });
  return (
    <div className="fb-cw">
      <button className={`fb-cw-btn fb-cw-btn--top${c.top ? ' active' : ''}`}    title="Pin top"    onClick={() => t('top')}    />
      <button className={`fb-cw-btn fb-cw-btn--right${c.right ? ' active' : ''}`} title="Pin right"  onClick={() => t('right')}  />
      <button className={`fb-cw-btn fb-cw-btn--bottom${c.bottom ? ' active' : ''}`} title="Pin bottom" onClick={() => t('bottom')} />
      <button className={`fb-cw-btn fb-cw-btn--left${c.left ? ' active' : ''}`}  title="Pin left"   onClick={() => t('left')}   />
      <div className="fb-cw-inner" />
    </div>
  );
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

// ── rgba ↔ hex helpers ────────────────────────────────────────

function rgbaToHex(color) {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

function getTransitionTypeLabel(type) {
  if (type === 'realistic') return 'Realistic';
  if (type === 'ease') return 'Ease';
  return 'Instant';
}

function getTransitionSummary(interaction) {
  if (!interaction?.targetVariantId) return 'No transition';
  const transition = interaction.transition ?? { type: 'instant' };
  if (transition.type === 'instant') return 'Instant';
  if (transition.type === 'ease') return `${getTransitionTypeLabel(transition.type)} · ${Math.round((transition.duration ?? 0.3) * 10) / 10}s`;
  return transition.springMode === 'physics'
    ? 'Realistic · Physics'
    : `Realistic · ${Math.round((transition.duration ?? 0.3) * 10) / 10}s`;
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

// ── Reset override button ───────────────────────────────────────
function ResetBtn({ show, onReset }) {
  if (!show) return null;
  return (
    <button
      className="fb-reset-btn"
      title="Reset to desktop value"
      onClick={e => { e.stopPropagation(); e.preventDefault(); onReset(); }}
    >{UIIcons.inherit}</button>
  );
}

// ── Main component ────────────────────────────────────────────

export default function PropertiesPanel() {
  const [transitionModalState, setTransitionModalState] = useState(null);
  const fontPreviewSnapshotRef = useRef(null);
  const selection           = useEditorStore(s => s.selection);
  const activeSurface       = useEditorStore(s => s.activeSurface);
  const componentEditor     = useEditorStore(s => s.componentEditor);
  const element             = useEditorStore(s => s.getSelectedElement());
  const globalVariables     = useEditorStore(s => s.globalVariables);
  const components          = useEditorStore(s => s.components);
  const changeComponentInstanceVariant = useEditorStore(s => s.changeComponentInstanceVariant);
  const updateComponentEditorVariantInteraction = useEditorStore(s => s.updateComponentEditorVariantInteraction);
  const updateElementLayout = useEditorStore(s => s.updateElementLayout);
  const updateElementsLayout = useEditorStore(s => s.updateElementsLayout);
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
  const allEls              = useEditorStore(s => s.getAllElements());
  const viewportScale       = useEditorStore(s => s.viewport.scale);
  const openIconLibraryModal = useEditorStore(s => s.openIconLibraryModal);

  // Artboard selection
  const artboardSel         = useEditorStore(s => s.artboardSel);
  const bpDefs              = useEditorStore(s => s.breakpointDefs);
  const updateBreakpointDef    = useEditorStore(s => s.updateBreakpointDef);
  const setPageBackground       = useEditorStore(s => s.setPageBackground);
  const setPagePadding          = useEditorStore(s => s.setPagePadding);
  const setPageLayout           = useEditorStore(s => s.setPageLayout);
  const page                    = useEditorStore(s => s.getCurrentPage());
  const pageVariables           = Array.isArray(page?.variables) ? page.variables : [];
  // Remembers the last active layout per artboard bp before it was turned off,
  // so toggling back on restores gap/direction/etc. instead of resetting to defaults.
  const savedLayoutRef          = useRef({});
  const removeOverrideFn        = useEditorStore(s => s.removeOverride);
  const removeStyleOverrideFn   = useEditorStore(s => s.removeStyleOverride);
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
  const hasMultiSelection = selectionIds.length > 1;
  const allVariables = [...pageVariables, ...globalVariables];
  const variableLookup = new Map(allVariables.map((variable) => [`${variable.scope}:${variable.id}`, variable]));

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

  const resolveBoundVariable = (binding) => binding ? (variableLookup.get(`${binding.scope}:${binding.variableId}`) ?? null) : null;
  const getBindingForProperty = (propertyKey) => element ? getElementPropertyBinding(element.id, selection?.bpId || 'desktop', propertyKey) : null;
  const getCompatibleBindingVariables = (propertyKey) => getCompatibleVariables(propertyKey);
  const commitBinding = (propertyKey, binding, applyValue) => {
    if (!element || !selection) return;
    setElementPropertyBinding(element.id, selection.bpId || 'desktop', propertyKey, binding);
    const variable = resolveBoundVariable(binding);
    if (variable && typeof applyValue === 'function') applyValue(variable.value);
    pushHistory();
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
    const updatePad   = (key, val) => {
      const cur = rawPad ?? { ...effectivePad };
      setPagePadding(artboardSel, { ...cur, [key]: val });
    };
    return (
      <aside className="fb-right">
        <div className="fb-right__header">{bp.name} Artboard</div>
        <div className="fb-panel-body">
          <Section title="Size">
            <div className="fb-quad" style={{ marginBottom: 6 }}>
              <NumberInput
                value={bp.width}
                min={100}
                label="W"
                onChange={v => updateBreakpointDef(artboardSel, { width: Math.max(100, v) })}
              />
              <NumberInput
                value={bp.height}
                min={100}
                label="H"
                onChange={v => updateBreakpointDef(artboardSel, { height: Math.max(100, v) })}
              />
            </div>
            <div className="fb-artboard-bp-note">
              {artboardSel === 'desktop'
                ? 'Canvas width for builder display. Live site is fully responsive.'
                : `Breakpoint threshold ≤ ${bp.width}px. Live site is fully responsive.`}
            </div>
          </Section>
          <Section title="Background">
            <div className="fb-prop-row--full">
              <FillPicker
                value={effectiveBg}
                onChange={v => setPageBackground(artboardSel, v)}
              />
            </div>
            {artboardSel !== 'desktop' && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {isBgInherited
                  ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                  : <IconButton icon={UIIcons.inherit} title="Inherit background from parent" onClick={() => setPageBackground(artboardSel, null)} />
                }
              </div>
            )}
          </Section>
          <Section title="Padding">
            <div className="fb-quad" style={{ marginBottom: 6 }}>
              <NumberInput value={activePad.top}    label="T" onChange={v => updatePad('top', v)}    />
              <NumberInput value={activePad.right}  label="R" onChange={v => updatePad('right', v)}  />
              <NumberInput value={activePad.bottom} label="B" onChange={v => updatePad('bottom', v)} />
              <NumberInput value={activePad.left}   label="L" onChange={v => updatePad('left', v)}   />
            </div>
            {artboardSel !== 'desktop' && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {isPadInherited
                  ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                  : <IconButton icon={UIIcons.inherit} title="Inherit padding from parent" onClick={() => setPagePadding(artboardSel, null)} />
                }
              </div>
            )}
          </Section>
          {(() => {
            const rawLayout      = page?.layout?.[artboardSel] ?? null;
            const effectiveLayout = resolvePageLayout(page?.layout, artboardSel);
            const isLayoutInherited = artboardSel !== 'desktop' && rawLayout == null;
            const layoutOn       = effectiveLayout !== null;
            const DEFAULT_LAYOUT = { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', flexWrap: 'nowrap', gap: 0 };
            const activeLayout   = effectiveLayout ?? savedLayoutRef.current[artboardSel] ?? DEFAULT_LAYOUT;
            const updLayout      = (key, val) => {
              const cur = rawLayout ?? { ...activeLayout };
              setPageLayout(artboardSel, { ...cur, [key]: val });
            };
            return (
              <Section title="Layout">
                {/* On/Off toggle row */}
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Auto layout</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <IconButton
                      icon={UIIcons.layoutOff}
                      active={!layoutOn}
                      title="Auto layout off"
                      onClick={() => {
                        // Save the current layout before clearing, so re-enabling restores it
                        if (layoutOn) savedLayoutRef.current[artboardSel] = { ...activeLayout };
                        setPageLayout(artboardSel, null);
                      }}
                    />
                    <IconButton
                      icon={UIIcons.layoutOn}
                      active={layoutOn}
                      title="Auto layout on"
                      onClick={() => {
                        if (!layoutOn) {
                          // Restore last saved layout, or fall back to defaults
                          setPageLayout(artboardSel, savedLayoutRef.current[artboardSel] ?? { ...DEFAULT_LAYOUT });
                        }
                      }}
                    />
                  </div>
                </div>
                {layoutOn && (
                  <>
                    <LayoutGrid
                      layout={activeLayout}
                      onChange={(key, val) => updLayout(key, val)}
                    />
                    <div className="fb-prop-row" style={{ marginTop: 6 }}>
                      <span className="fb-prop-label">Gap</span>
                      <NumberInput value={activeLayout.gap ?? 0} min={0} onChange={v => updLayout('gap', v)} />
                    </div>
                  </>
                )}
                {artboardSel !== 'desktop' && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isLayoutInherited
                      ? <span style={{ opacity: 0.7 }}>↑ Inherited from parent</span>
                      : <IconButton icon={UIIcons.inherit} title="Inherit layout from parent" onClick={() => setPageLayout(artboardSel, null)} />
                    }
                  </div>
                )}
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

  if (hasMultiSelection && selectedElements.length) {
    const resolvedSelections = selectedElements.map((selected) => ({
      element: selected,
      resolved: resolveElementWithVariables(selected, bpId, pageVariables, globalVariables),
    }));
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
    const lockedValue = getSharedValue(({ element }) => !!element.base?.locked);
    const allFrames = selectedElements.every((selected) => selected.type === 'frame' && !selected.componentInstance && !selected.componentRoot);
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
          <span style={{ color: 'var(--text-primary)' }}>{selectionIds.length} elements</span>
          <IconButton
            icon={UIIcons.trash}
            title="Delete selected elements"
            className="fb-btn--sm"
            onClick={() => { deleteElements(selectionIds); pushHistory(); }}
          />
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
              <span className="fb-prop-label">Rotate</span>
              <MixedNumberInput
                value={rotationValue}
                min={-360}
                max={360}
                step={1}
                onCommit={(value) => applyLayout({ rotation: value })}
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
  const textColorMeta = element.type === 'text' ? getTextColorMeta(resolved) : { baseColor: s.color ?? '#000000', mixed: false };
  const hasVisibleIconStroke = element?.type === 'icon' && hasSvgVisibleStroke(resolved?.svgMarkup ?? '');
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
  const updS = (key, val) => {
    updateStyles(element.id, bpId, { [key]: val });
  };
  const commit = () => pushHistory();

  // Auto-layout context: element is a root element inside an artboard with layout on
  const artboardLayout = resolvePageLayout(page?.layout, bpId);
  const inAutoLayout   = !element.parentId && artboardLayout !== null;
  const isFlowInLayout = inAutoLayout && !resolved.absoluteInLayout;
  const isComponentRoot = activeSurface === 'component' && !element.parentId;
  const isComponentInstanceOnPage = activeSurface === 'page' && !!element.componentInstance;
  const allowVariableBindings = activeSurface === 'page';
  const componentMeta = isComponentInstanceOnPage ? selectedComponentMeta : null;
  const componentVariants = isComponentInstanceOnPage ? selectedComponentVariants : [];
  const componentVariantId = componentVariants.some((variant) => variant.id === element.componentInstance?.variantId)
    ? element.componentInstance?.variantId
    : componentMeta?.defaultVariantId ?? componentVariants[0]?.id ?? '';
  const selectedEditorVariant = activeSurface === 'component' && element.componentRoot
    ? (componentEditor.variants ?? []).find((variant) => variant.id === element.componentEditorVariantId)
    : null;
  const selectedEditorVariantLabel = getVariantLabel(componentEditor.variants ?? [], selectedEditorVariant);
  const selectedEditorTransitionTarget = selectedEditorVariant?.interaction?.targetVariantId
    ? (componentEditor.variants ?? []).find((variant) => variant.id === selectedEditorVariant.interaction.targetVariantId) ?? null
    : null;

  if (activeSurface === 'component' && element.componentRoot) {
    return (
      <>
        <aside className="fb-right">
          <div className="fb-right__header">{selectedEditorVariantLabel}</div>
          <div className="fb-panel-body">
            <Section title="Size">
              <div className="fb-quad" style={{ marginBottom: 6 }}>
                <NumberInput
                  value={resolved.width ?? 240}
                  min={20}
                  label="W"
                  onChange={v => { updateElementLayout(element.id, bpId, { width: Math.max(20, v), widthMode: 'fixed' }); commit(); }}
                />
                <NumberInput
                  value={resolved.height ?? 160}
                  min={20}
                  label="H"
                  onChange={v => { updateElementLayout(element.id, bpId, { height: Math.max(20, v), heightMode: 'fixed' }); commit(); }}
                />
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
                {selectedEditorTransitionTarget ? (
                  <>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Type</span>
                      <button
                        type="button"
                        className="fb-secondary-btn fb-prop-action-btn"
                        onClick={() => setTransitionModalState({ variantId: selectedEditorVariant.id })}
                      >
                        {getTransitionSummary(selectedEditorVariant?.interaction)}
                      </button>
                    </div>
                    <div className="fb-artboard-bp-note">
                      Animates {selectedEditorVariant?.name || 'this variant'} to {selectedEditorTransitionTarget.name || 'the target variant'} on component change.
                    </div>
                  </>
                ) : (
                  <div className="fb-artboard-bp-note">
                    Connect this variant to another variant first. Then you can edit how the change animates here.
                  </div>
                )}
              </Section>
            ) : null}
          </div>
        </aside>
        {transitionModalState && selectedEditorVariant && selectedEditorTransitionTarget ? (
          <VariantTransitionModal
            sourceName={selectedEditorVariant.name}
            targetName={selectedEditorTransitionTarget.name}
            initialTransition={selectedEditorVariant.interaction?.transition}
            initialDelay={selectedEditorVariant.interaction?.delay ?? 0}
            onCancel={() => setTransitionModalState(null)}
            onSave={({ transition, delay }) => {
              updateComponentEditorVariantInteraction(selectedEditorVariant.id, {
                targetVariantId: selectedEditorVariant.interaction?.targetVariantId,
                trigger: selectedEditorVariant.interaction?.trigger ?? 'click',
                delay,
                transition,
              });
              commit();
              setTransitionModalState(null);
            }}
          />
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
  const textBinding = getBindingForProperty('text');
  const fontFamilyBinding = getBindingForProperty('styles.fontFamily');
  const textColorBinding = getBindingForProperty('styles.color');
  const iconColorBinding = getBindingForProperty('styles.color');
  const hiddenBinding = getBindingForProperty('hidden');
  const fillBinding = getBindingForProperty('styles.backgroundColor');
  const backgroundImageBinding = getBindingForProperty('styles.backgroundImage');
  const sourceBinding = getBindingForProperty('src');
  const zIndexBinding = getBindingForProperty('styles.zIndex');
  const textBindingVariable = resolveBoundVariable(textBinding);
  const fontFamilyBindingVariable = resolveBoundVariable(fontFamilyBinding);
  const textColorBindingVariable = resolveBoundVariable(textColorBinding);
  const iconColorBindingVariable = resolveBoundVariable(iconColorBinding);
  const hiddenBindingVariable = resolveBoundVariable(hiddenBinding);
  const fillBindingVariable = resolveBoundVariable(fillBinding);
  const backgroundImageBindingVariable = resolveBoundVariable(backgroundImageBinding);
  const sourceBindingVariable = resolveBoundVariable(sourceBinding);
  const zIndexBindingVariable = resolveBoundVariable(zIndexBinding);

  return (
    <>
    <aside className="fb-right">
      <div className="fb-right__header">
        <span style={{ color: 'var(--text-primary)' }}>
          {element.name || element.type}
        </span>
        <IconButton
          icon={UIIcons.trash}
          title="Delete element"
          className="fb-btn--sm"
          onClick={() => { deleteElement(element.id); pushHistory(); }}
        />
      </div>

      <div className="fb-panel-body">

        {activeSurface === 'page' ? (
          <InteractionSection
            interactions={interactions}
            variableSources={variableSources}
            interactionVariables={interactionVariables}
            allVariables={allVariables}
            updateInteraction={updateInteraction}
            removeInteraction={removeInteraction}
            addInteraction={addInteraction}
          />
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
          </Section>
        ) : null}

        {/* ── Align strip (top of panel, active for absolute/fixed) ─── */}
        <AlignStrip
          resolved={resolved}
          containerW={containerW}
          containerH={containerH}
          upd={upd}
          commit={commit}
          disabled={['relative'].includes(resolved.positionType ?? 'absolute') || isFlowInLayout}
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
                  if (!resolved.absoluteInLayout) return 'auto';
                  return resolved.positionType ?? 'absolute';
                })()}
                onChange={e => {
                  const v = e.target.value;
                  if (v === 'auto') {
                    updateElementLayout(element.id, bpId, {
                      absoluteInLayout: false,
                      positionType: resolved.positionType === 'fixed' ? 'fixed' : 'relative',
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
              </select>
            </div>
          )}
          {!isFlowInLayout && ['absolute', 'fixed'].includes(resolved.positionType ?? 'absolute') && (
            <div className="fb-pos-widget">
              <div className="fb-pos-widget__row">
                <PosInput value={resolved.y ?? 0} label="T" onChange={v => { upd('y', v); commit(); }} />
              </div>
              <div className="fb-pos-widget__row">
                <PosInput value={resolved.x ?? 0} label="L" onChange={v => { upd('x', v); commit(); }} />
                <ConstraintWidget
                  constraints={resolved.constraints}
                  onChange={v => { upd('constraints', v); commit(); }}
                />
                <PosInput
                  value={Math.max(0, containerW - (resolved.x ?? 0) - (resolved.width ?? 100))}
                  label="R"
                  onChange={v => { upd('x', Math.max(0, containerW - v - (resolved.width ?? 100))); commit(); }}
                />
              </div>
              <div className="fb-pos-widget__row">
                <PosInput
                  value={Math.max(0, effectiveContainerH - (resolved.y ?? 0) - (resolved.height ?? 100))}
                  label="B"
                  onChange={v => { upd('y', Math.max(0, effectiveContainerH - v - (resolved.height ?? 100))); commit(); }}
                />
              </div>
            </div>
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
        <Section title="Size" action={<ResetBtn show={isOv('width','widthMode','widthPct','widthFr','height','heightMode','heightPct','heightFr','minW','maxW','minH','maxH')} onReset={() => resetOv('width','widthMode','widthPct','widthFr','height','heightMode','heightPct','heightFr','minW','maxW','minH','maxH')} />}>
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
                return <NumberInput key="wpx" value={resolved.width ?? 100} min={1} unit="px" onChange={v => { upd('width', v); commit(); }} />;
              })()}
              <select
                className="fb-prop-input fb-size-mode"
                value={resolved.widthMode ?? 'fixed'}
                onChange={e => { upd('widthMode', e.target.value); commit(); }}
              >
                <option value="fixed">Fixed px</option>
                <option value="fill" disabled={isComponentRoot}>Fill fr</option>
                <option value="relative">Relative %</option>
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
                return <NumberInput key="hpx" value={resolved.height ?? 100} min={1} unit="px" onChange={v => { upd('height', v); commit(); }} />;
              })()}
              <select
                className="fb-prop-input fb-size-mode"
                value={resolved.heightMode ?? 'fixed'}
                onChange={e => { upd('heightMode', e.target.value); commit(); }}
              >
                <option value="fixed">Fixed px</option>
                <option value="fill" disabled={isComponentRoot}>Fill fr</option>
                <option value="relative">Relative %</option>
                <option value="hug">Hug</option>
              </select>
            </div>
          </div>
          {isComponentRoot && (
            <div className="fb-artboard-bp-note" style={{ marginTop: 6 }}>
              Top-level component layers use the free canvas. `Fill` is disabled here to avoid unbounded component width or height.
            </div>
          )}
          <MinMaxRow resolved={resolved} upd={upd} commit={commit} />
        </Section>

        {element.type === 'text' && (
          <Section title="Text" action={<ResetBtn show={isOv('text','richTextHtml') || isSOv('color','fontFamily','fontWeight','fontStyle','fontSize','fontSizeUnit','letterSpacing','letterSpacingUnit','lineHeight','lineHeightUnit','textAlign','textDecoration')} onReset={() => { resetOv('text','richTextHtml'); resetSOv('color','fontFamily','fontWeight','fontStyle','fontSize','fontSizeUnit','letterSpacing','letterSpacingUnit','lineHeight','lineHeightUnit','textAlign','textDecoration'); }} />}>
            <div className="fb-prop-row" style={{ marginBottom: 8 }}>
              <VariableBindingLabel label="Content">
                {allowVariableBindings ? (
                  <VariableBindingButton
                    variables={getCompatibleBindingVariables('text')}
                    binding={textBinding}
                    onSelect={(binding) => commitBinding('text', binding, (value) => updateElementLayout(element.id, bpId, { text: `${value ?? ''}` }))}
                    onRemove={() => commitBinding('text', null)}
                  />
                ) : null}
              </VariableBindingLabel>
              {textBindingVariable ? <BoundVariableCta variable={textBindingVariable} fallbackLabel="Text source" /> : <div className="fb-prop-value">Text source</div>}
            </div>
            {textBindingVariable ? null : (
              <div className="fb-prop-row--full" style={{ marginBottom: 8 }}>
                <textarea
                  className="fb-prop-input"
                  value={resolved.text ?? 'Text'}
                  onChange={e => upd('text', e.target.value)}
                  onBlur={commit}
                  rows={4}
                  style={{ width: '100%', resize: 'vertical', minHeight: 92, lineHeight: 1.4 }}
                />
              </div>
            )}

            <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
              <VariableBindingLabel label="Font">
                {allowVariableBindings ? (
                  <VariableBindingButton
                    variables={getCompatibleBindingVariables('styles.fontFamily')}
                    binding={fontFamilyBinding}
                    onSelect={(binding) => commitBinding('styles.fontFamily', binding, (value) => updateStyles(element.id, bpId, { fontFamily: `${value ?? ''}` }))}
                    onRemove={() => commitBinding('styles.fontFamily', null)}
                  />
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
                  <VariableBindingButton
                    variables={getCompatibleBindingVariables('styles.color')}
                    binding={textColorBinding}
                    onSelect={(binding) => commitBinding('styles.color', binding, (value) => updateStyles(element.id, bpId, { color: value || '#000000' }))}
                    onRemove={() => commitBinding('styles.color', null)}
                  />
                ) : null}
              </VariableBindingLabel>
              {textColorBindingVariable ? <BoundVariableCta variable={textColorBindingVariable} fallbackLabel="Color variable" /> : <ColorInput value={textColorMeta.baseColor} mixed={textColorMeta.mixed} onChange={v => { updS('color', v); commit(); }} />}
            </div>

            <div className="fb-prop-row" style={{ marginTop: 8 }}>
              <span className="fb-prop-label">Align</span>
              <IconGroup
                value={s.textAlign ?? 'left'}
                onChange={v => { updS('textAlign', v); commit(); }}
                options={TEXT_ALIGN_OPTIONS}
              />
            </div>

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
          </Section>
        )}

        {element.type === 'icon' && (
          <Section title="Icon / SVG" action={<ResetBtn show={isOv('iconSource','iconName','svgMarkup') || isSOv('color')} onReset={() => { resetOv('iconSource','iconName','svgMarkup'); resetSOv('color'); }} />}>
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

            {hasVisibleIconStroke ? (
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Stroke</span>
                <NumberInput
                  value={getSvgStrokeWidth(resolved.svgMarkup ?? '') ?? 2}
                  min={0.1}
                  step={0.1}
                  unit="px"
                  label="px"
                  onChange={v => {
                    upd('svgMarkup', setSvgStrokeWidth(resolved.svgMarkup ?? '', v));
                    commit();
                  }}
                />
              </div>
            ) : null}

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
                  <VariableBindingButton
                    variables={getCompatibleBindingVariables('styles.color')}
                    binding={iconColorBinding}
                    onSelect={(binding) => commitBinding('styles.color', binding, (value) => updateStyles(element.id, bpId, { color: value || '#111827' }))}
                    onRemove={() => commitBinding('styles.color', null)}
                  />
                ) : null}
              </VariableBindingLabel>
              <div style={{ width: '100%' }}>
                {iconColorBindingVariable ? <BoundVariableCta variable={iconColorBindingVariable} fallbackLabel="Tint variable" /> : <FillPicker value={s.color ?? '#111827'} onChange={(value) => { updS('color', value); commit(); }} />}
              </div>
            </div>
            <div className="fb-artboard-bp-note">Tint uses the same picker as fills. Solid colors are recommended for icons that rely on <code>currentColor</code>.</div>
          </Section>
        )}

        {/* ── Layout (frame-specific) ────────────────────────── */}
        {element.type === 'frame' ? (() => {
          if (isComponentInstanceOnPage) return null;
          const frameLayoutOn = s.display === 'flex';
          return (
            <Section title="Layout" action={<ResetBtn show={isSOv('display','flexDirection','flexWrap','gap','alignItems','justifyContent','paddingTop','paddingRight','paddingBottom','paddingLeft')} onReset={() => resetSOv('display','flexDirection','flexWrap','gap','alignItems','justifyContent','paddingTop','paddingRight','paddingBottom','paddingLeft')} />}>
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
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Gap</span>
                    <NumberInput value={s.gap ?? 0} min={0} onChange={v => { updS('gap', v); commit(); }} />
                  </div>
                </>
              )}
              <div className="fb-prop-row">
                <span className="fb-prop-label">Padding</span>
                <div className="fb-quad-wide fb-quad-wide--compact">
                  <NumberInput value={s.paddingTop ?? 0} min={0} onChange={v => updS('paddingTop', v)} label="T" />
                  <NumberInput value={s.paddingRight ?? 0} min={0} onChange={v => updS('paddingRight', v)} label="R" />
                  <NumberInput value={s.paddingBottom ?? 0} min={0} onChange={v => updS('paddingBottom', v)} label="B" />
                  <NumberInput value={s.paddingLeft ?? 0} min={0} onChange={v => updS('paddingLeft', v)} label="L" />
                </div>
              </div>
            </Section>
          );
        })() : (
          <Section title="Layout" defaultOpen={false} />
        )}

        {!isComponentInstanceOnPage && (
        <Section title="Effects" defaultOpen={false} action={<ResetBtn show={isSOv('boxShadow')} onReset={() => resetSOv('boxShadow')} />}>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Appear</span>
            <ShadowEditor value={s.boxShadow ?? ''} onChange={v => { updS('boxShadow', v); commit(); }} />
          </div>
        </Section>
        )}

        <Section title="Overlays" defaultOpen={false} />

        <Section title="Cursor" defaultOpen={false} />

        <Section title="Styles" action={<ResetBtn show={isComponentInstanceOnPage ? (isOv('hidden') || isSOv('opacity','zIndex')) : (isOv('hidden','rotation') || isSOv('opacity','overflow','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','borderRadius','borderRadiusTL','borderRadiusTR','borderRadiusBL','borderRadiusBR','borderWidth','borderColor','borderStyle','borderRadiusMode','boxShadow','objectFit','zIndex'))} onReset={() => { if (isComponentInstanceOnPage) { resetOv('hidden'); resetSOv('opacity','zIndex'); } else { resetOv('hidden','rotation'); resetSOv('opacity','overflow','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','borderRadius','borderRadiusTL','borderRadiusTR','borderRadiusBL','borderRadiusBR','borderWidth','borderColor','borderStyle','borderRadiusMode','boxShadow','objectFit','zIndex'); } }} />}>
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

          <div className="fb-prop-row">
            <VariableBindingLabel label="Visible">
              {allowVariableBindings ? (
                <VariableBindingButton
                  variables={getCompatibleBindingVariables('hidden')}
                  binding={hiddenBinding}
                    onSelect={(binding) => commitBinding('hidden', binding, (value) => updateElementLayout(element.id, bpId, { hidden: !value }))}
                  onRemove={() => commitBinding('hidden', null)}
                />
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

          {!isComponentInstanceOnPage && (
          <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
            <VariableBindingLabel label="Fill">
              {allowVariableBindings && element.type !== 'image' ? (
                <VariableBindingButton
                  variables={getCompatibleBindingVariables('styles.backgroundColor')}
                  binding={fillBinding}
                  onSelect={(binding) => commitBinding('styles.backgroundColor', binding, (value) => updateStyles(element.id, bpId, { backgroundColor: value || '#000000' }))}
                  onRemove={() => commitBinding('styles.backgroundColor', null)}
                />
              ) : null}
            </VariableBindingLabel>
            <div style={{ width: '100%' }}>
              {fillBindingVariable ? (
                <BoundVariableCta variable={fillBindingVariable} fallbackLabel="Fill variable" />
              ) : element.type === 'image' ? (
                <MediaPickerButton value={resolved.src ?? ''} onChange={v => { upd('src', v); commit(); }} />
              ) : (
                <FillPicker value={s.backgroundColor ?? '#ffffff'} onChange={v => { updS('backgroundColor', v); commit(); }} />
              )}
            </div>
          </div>
          )}

          {!isComponentInstanceOnPage && element.type === 'frame' && (
            <div className="fb-prop-row">
              <VariableBindingLabel label="Image">
                {allowVariableBindings ? (
                  <VariableBindingButton
                    variables={getCompatibleBindingVariables('styles.backgroundImage')}
                    binding={backgroundImageBinding}
                    onSelect={(binding) => commitBinding('styles.backgroundImage', binding, (value) => updateStyles(element.id, bpId, { backgroundImage: `${value ?? ''}` }))}
                    onRemove={() => commitBinding('styles.backgroundImage', null)}
                  />
                ) : null}
              </VariableBindingLabel>
              {backgroundImageBindingVariable ? <BoundVariableCta variable={backgroundImageBindingVariable} fallbackLabel="Image variable" /> : <MediaPickerButton value={s.backgroundImage ?? ''} onChange={v => { updS('backgroundImage', v); commit(); }} />}
            </div>
          )}

          {!isComponentInstanceOnPage && element.type === 'image' && allowVariableBindings && (
            <div className="fb-prop-row">
              <VariableBindingLabel label="Source">
                <VariableBindingButton
                  variables={getCompatibleBindingVariables('src')}
                  binding={sourceBinding}
                  onSelect={(binding) => commitBinding('src', binding, (value) => updateElementLayout(element.id, bpId, { src: `${value ?? ''}` }))}
                  onRemove={() => commitBinding('src', null)}
                />
              </VariableBindingLabel>
              {sourceBindingVariable ? <BoundVariableCta variable={sourceBindingVariable} fallbackLabel="Source variable" /> : <div className="fb-artboard-bp-note">Image source can be driven by an image variable.</div>}
            </div>
          )}

          {!isComponentInstanceOnPage && (element.type === 'image' || (element.type === 'frame' && s.backgroundImage)) && (
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
            <span className="fb-prop-label">Border</span>
            {(s.borderWidth ?? 0) > 0 ? (
              <div className="fb-style-inline-group fb-style-inline-group--stacked">
                <NumberInput value={s.borderWidth ?? 0} min={0} onChange={v => { updS('borderWidth', v); commit(); }} />
                <CustomSelect
                  value={s.borderStyle ?? 'solid'}
                  onChange={value => { updS('borderStyle', value); commit(); }}
                  options={[
                    { value: 'solid', label: 'Solid' },
                    { value: 'dashed', label: 'Dashed' },
                    { value: 'dotted', label: 'Dotted' },
                    { value: 'none', label: 'None' },
                  ]}
                />
                <ColorInput value={s.borderColor ?? '#000000'} onChange={v => { updS('borderColor', v); commit(); }} />
              </div>
            ) : (
              <button
                type="button"
                className="fb-add-field"
                onClick={() => { updS('borderWidth', 1); commit(); }}
              >
                Add...
              </button>
            )}
          </div>
          )}

          <div className="fb-prop-row">
            <VariableBindingLabel label="Z Index">
              {allowVariableBindings ? (
                <VariableBindingButton
                  variables={getCompatibleBindingVariables('styles.zIndex')}
                  binding={zIndexBinding}
                  onSelect={(binding) => commitBinding('styles.zIndex', binding, (value) => updateStyles(element.id, bpId, { zIndex: Math.round(parseFloat(value) || 0) }))}
                  onRemove={() => commitBinding('styles.zIndex', null)}
                />
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

        <Section title="Advanced" defaultOpen={false} action={<ResetBtn show={isOv('rotation') || isOv('src')} onReset={() => { resetOv('rotation','src'); }} />}>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Name</span>
            <input
              className="fb-prop-input"
              type="text"
              value={element.base?.name || element.type || ''}
              onChange={e => updateElementLayout(element.id, 'desktop', { name: e.target.value })}
              onBlur={commit}
            />
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Rotate</span>
            <NumberInput value={resolved.rotation ?? 0} min={-360} max={360} onChange={v => { upd('rotation', v); commit(); }} label="°" />
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Lock</span>
            <ChoiceGroup
              value={element.base?.locked ? 'yes' : 'no'}
              onChange={v => { updateElementLayout(element.id, 'desktop', { locked: v === 'yes' }); commit(); }}
              options={[
                { value: 'no', label: 'No' },
                { value: 'yes', label: 'Yes' },
              ]}
            />
          </div>
        </Section>

      </div>
    </aside>
    </>
  );
}

// ── Shadow editor (simple text + quick-add) ───────────────────

function ShadowEditor({ value, onChange }) {
  const [enabled, setEnabled] = useState(!!value);

  const toggle = (on) => {
    setEnabled(on);
    if (!on) onChange('');
    else onChange(value || '0px 4px 16px rgba(0,0,0,0.2)');
  };

  return (
    <div className="fb-shadow-field">
      {!enabled && (
        <button type="button" className="fb-add-field" onClick={() => toggle(true)}>
          Add...
        </button>
      )}
      {enabled && (
        <div className="fb-shadow-field__active">
          <input
            className="fb-prop-input"
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="0px 4px 16px rgba(0,0,0,0.2)"
            style={{ width: '100%' }}
          />
          <IconButton icon={UIIcons.close} title="Remove shadow" onClick={() => toggle(false)} />
        </div>
      )}
    </div>
  );
}
