import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore, resolveElement, resolveBackground, resolvePagePadding, resolvePageLayout } from '../store/editorStore';
import FillPicker from '../components/FillPicker';

// ── Helpers ──────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fb-prop-section">
      <div className="fb-prop-section__head" onClick={() => setOpen(o => !o)}>
        <span className="fb-prop-section__title">{title}</span>
        {action && <span className="fb-prop-section__action" onClick={e => e.stopPropagation()}>{action}</span>}
        <span className="fb-prop-section__toggle">{open ? '▾' : '▸'}</span>
      </div>
      {open && <div className="fb-prop-section__body">{children}</div>}
    </div>
  );
}

function NumberInput({ value, onChange, label, unit = 'px', min, max, step = 1 }) {
  const ext = typeof value === 'number' ? value : (parseFloat(value) || 0);
  const fmt = v => String(Math.round(v * 10) / 10);

  const [draft, setDraft] = React.useState(fmt(ext));
  const [focused, setFocused] = React.useState(false);

  // Sync external value changes while not focused (e.g., canvas drag)
  React.useEffect(() => {
    if (!focused) setDraft(fmt(ext));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  return (
    <div className="fb-prop-mini">
      <input
        className="fb-prop-input"
        type="number"
        value={focused ? draft : fmt(ext)}
        min={min}
        max={max}
        step={step}
        onFocus={e => { setFocused(true); setDraft(fmt(ext)); e.target.select(); }}
        onBlur={() => {
          setFocused(false);
          const num = parseFloat(draft);
          if (!isNaN(num)) onChange(num);
          else setDraft(fmt(ext)); // revert if left empty/invalid
        }}
        onChange={e => {
          const raw = e.target.value;
          setDraft(raw);
          const num = parseFloat(raw);
          // Fire immediately if valid (keeps canvas in sync while typing)
          if (!isNaN(num) && raw !== '' && raw !== '-') onChange(num);
        }}
        style={{ textAlign: 'center' }}
      />
      {label && <label>{label}</label>}
    </div>
  );
}

/** Like NumberInput but shows blank when value is null/0/undefined */
function NullableNumberInput({ value, onChange, label, placeholder = '', min, step = 1 }) {
  const hasValue = value != null && value !== 0;
  const [draft, setDraft] = React.useState(hasValue ? String(value) : '');
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(value != null && value !== 0 ? String(Math.round(value * 10) / 10) : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  return (
    <div className="fb-prop-mini">
      <input
        className="fb-prop-input"
        type="number"
        value={focused ? draft : (value != null && value !== 0 ? String(Math.round(value * 10) / 10) : '')}
        placeholder={placeholder}
        min={min}
        step={step}
        onFocus={e => { setFocused(true); setDraft(value != null && value !== 0 ? String(Math.round(value * 10) / 10) : ''); e.target.select(); }}
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

function ColorInput({ value, onChange }) {
  const hex = rgbaToHex(value ?? '#cccccc');

  return (
    <div className="fb-color-row">
      <div className="fb-color-swatch" style={{ background: value }}>
        <input
          type="color"
          value={hex}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      <input
        className="fb-prop-input fb-color-hex"
        type="text"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
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

function AlignStrip({ resolved, containerW, containerH, upd, commit, disabled }) {
  const w = resolved.width ?? 100;
  const h = resolved.height ?? 100;
  const go = (axis, val) => { upd(axis, val); commit(); };
  return (
    <div className={`fb-align-strip${disabled ? ' fb-align-strip--disabled' : ''}`}>
      <div className="fb-align-strip__btn" title="Align left"         onClick={() => !disabled && go('x', 0)}>{ALIGN_SVG.left}</div>
      <div className="fb-align-strip__btn" title="Center horizontal"  onClick={() => !disabled && go('x', Math.round((containerW - w) / 2))}>{ALIGN_SVG.hcenter}</div>
      <div className="fb-align-strip__btn" title="Align right"        onClick={() => !disabled && go('x', containerW - w)}>{ALIGN_SVG.right}</div>
      <div className="fb-align-strip__sep" />
      <div className="fb-align-strip__btn" title="Align top"          onClick={() => !disabled && go('y', 0)}>{ALIGN_SVG.top}</div>
      <div className="fb-align-strip__btn" title="Center vertical"    onClick={() => !disabled && go('y', Math.round((containerH - h) / 2))}>{ALIGN_SVG.vcenter}</div>
      <div className="fb-align-strip__btn" title="Align bottom"       onClick={() => !disabled && go('y', containerH - h)}>{ALIGN_SVG.bottom}</div>
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

function MediaPickerModal({ onSelect, onClose }) {
  const adminUrl = (window.fbData?.adminUrl ?? '').replace(/\/$/, '');
  const src = `${adminUrl}/admin.php?page=fb-media-picker`;

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
          <button onMouseDown={onClose} style={{ all: 'unset', cursor: 'pointer', fontSize: 17, color: '#aaa', lineHeight: 1 }}>✕</button>
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
  return (
    <>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {value ? (
          <div style={{ width: 36, height: 36, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
            <img src={value} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : null}
        <button
          className="fb-icon-btn"
          style={{ fontSize: 11, padding: '0 8px', flex: 1 }}
          onClick={() => setOpen(true)}
        >{value ? '⇄ Change' : '+ Select image'}</button>
        {value ? (
          <button
            className="fb-icon-btn"
            style={{ fontSize: 11, padding: '0 6px' }}
            title="Remove image"
            onClick={() => onChange('')}
          >✕</button>
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

// ── Reset override button ───────────────────────────────────────
function ResetBtn({ show, onReset }) {
  if (!show) return null;
  return (
    <button
      className="fb-reset-btn"
      title="Reset to desktop value"
      onClick={e => { e.stopPropagation(); e.preventDefault(); onReset(); }}
    >↩</button>
  );
}

// ── Main component ────────────────────────────────────────────

export default function PropertiesPanel() {
  const selection           = useEditorStore(s => s.selection);
  const element             = useEditorStore(s => s.getSelectedElement());
  const updateElementLayout = useEditorStore(s => s.updateElementLayout);
  const updateStyles        = useEditorStore(s => s.updateElementStyles);
  const pushHistory         = useEditorStore(s => s.pushHistory);
  const deleteElement       = useEditorStore(s => s.deleteElement);
  const allEls              = useEditorStore(s => s.getAllElements());

  // Artboard selection
  const artboardSel         = useEditorStore(s => s.artboardSel);
  const bpDefs              = useEditorStore(s => s.breakpointDefs);
  const updateBreakpointDef    = useEditorStore(s => s.updateBreakpointDef);
  const setPageBackground       = useEditorStore(s => s.setPageBackground);
  const setPagePadding          = useEditorStore(s => s.setPagePadding);
  const setPageLayout           = useEditorStore(s => s.setPageLayout);
  const page                    = useEditorStore(s => s.getCurrentPage());
  // Remembers the last active layout per artboard bp before it was turned off,
  // so toggling back on restores gap/direction/etc. instead of resetting to defaults.
  const savedLayoutRef          = useRef({});
  const removeOverrideFn        = useEditorStore(s => s.removeOverride);
  const removeStyleOverrideFn   = useEditorStore(s => s.removeStyleOverride);

  // Show artboard panel when artboard is selected and no element is selected
  if (!element && artboardSel && bpDefs[artboardSel]) {
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
                  : <button
                      style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent-light)', fontSize: 11 }}
                      onClick={() => setPageBackground(artboardSel, null)}
                    >↩ Inherit from parent</button>
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
                  : <button
                      style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent-light)', fontSize: 11 }}
                      onClick={() => setPagePadding(artboardSel, null)}
                    >↩ Inherit from parent</button>
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
                    <button
                      className={`fb-icon-btn${!layoutOn ? ' fb-icon-btn--active' : ''}`}
                      title="Off"
                      onClick={() => {
                        // Save the current layout before clearing, so re-enabling restores it
                        if (layoutOn) savedLayoutRef.current[artboardSel] = { ...activeLayout };
                        setPageLayout(artboardSel, null);
                      }}
                    >✕</button>
                    <button
                      className={`fb-icon-btn${layoutOn ? ' fb-icon-btn--active' : ''}`}
                      title="On"
                      onClick={() => {
                        if (!layoutOn) {
                          // Restore last saved layout, or fall back to defaults
                          setPageLayout(artboardSel, savedLayoutRef.current[artboardSel] ?? { ...DEFAULT_LAYOUT });
                        }
                      }}
                    >⇌</button>
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
                      : <button
                          style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent-light)', fontSize: 11 }}
                          onClick={() => setPageLayout(artboardSel, null)}
                        >↩ Inherit from parent</button>
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
          <div className="fb-empty-state__icon">🎨</div>
          <div className="fb-empty-state__text">Select an element<br />to edit its properties</div>
        </div>
      </aside>
    );
  }

  const bpId = selection.bpId || 'desktop';
  const resolved = resolveElement(element, bpId);
  const s = resolved.styles || {};

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

  // Override helpers — only meaningful on tablet/mobile breakpoints
  const bpOv  = bpId !== 'desktop' ? (element.overrides?.[bpId] ?? {}) : {};
  const bpSOv = bpOv.styles ?? {};
  const isOv  = (...keys) => bpId !== 'desktop' && keys.some(k => k in bpOv);
  const isSOv = (...keys) => bpId !== 'desktop' && keys.some(k => k in bpSOv);
  const resetOv  = (...keys) => { keys.forEach(k => removeOverrideFn(element.id, bpId, k)); commit(); };
  const resetSOv = (...keys) => { keys.forEach(k => removeStyleOverrideFn(element.id, bpId, k)); commit(); };

  return (
    <aside className="fb-right">
      <div className="fb-right__header">
        <span style={{ color: 'var(--text-primary)' }}>
          {element.name || element.type}
        </span>
        <button
          className="fb-btn fb-btn--icon fb-btn--sm"
          style={{ float: 'right', color: 'var(--red, #ef4444)', border: 'none', background: 'none', cursor: 'pointer' }}
          title="Delete element"
          onClick={() => { deleteElement(element.id); pushHistory(); }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M5 4V2.5h6V4M4 4l.7 9.5h6.6L12 4M6.5 7v4M9.5 7v4"/>
          </svg>
        </button>
      </div>

      <div className="fb-panel-body">

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
                <option value="fill">Fill fr</option>
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
                <option value="fill">Fill fr</option>
                <option value="relative">Relative %</option>
                <option value="hug">Hug</option>
              </select>
            </div>
          </div>
          <MinMaxRow resolved={resolved} upd={upd} commit={commit} />
        </Section>

        {/* ── Transform (rotation, name, lock) ──────────────── */}
        <Section title="Transform" defaultOpen={false} action={<ResetBtn show={isOv('rotation') || isSOv('opacity')} onReset={() => { resetOv('rotation'); resetSOv('opacity'); }} />}>
          <div className="fb-quad" style={{ marginBottom: 6 }}>
            <NumberInput value={resolved.rotation ?? 0} min={-360} max={360} onChange={v => { upd('rotation', v); commit(); }} label="°" />
            <NumberInput value={(s.opacity ?? 1) * 100} min={0} max={100} onChange={v => { updS('opacity', v / 100); commit(); }} label="%" />
          </div>
          <div className="fb-prop-row" style={{ marginTop: 8 }}>
            <span className="fb-prop-label">Name</span>
            <input
              className="fb-prop-input"
              type="text"
              value={element.base?.name || element.type || ''}
              onChange={e => updateElementLayout(element.id, 'desktop', { name: e.target.value })}
              onBlur={commit}
            />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <Toggle value={element.base?.locked} onChange={v => { updateElementLayout(element.id, 'desktop', { locked: v }); commit(); }} label="Lock" />
            <Toggle
              value={s.overflow === 'hidden'}
              onChange={v => { updS('overflow', v ? 'hidden' : 'visible'); commit(); }}
              label="Clip"
            />
          </div>
        </Section>

        {/* ── Fill ──────────────────────────────────────────── */}
        <Section title="Fill" action={<ResetBtn show={isSOv('backgroundColor','backgroundImage','backgroundSize','backgroundPosition')} onReset={() => resetSOv('backgroundColor','backgroundImage','backgroundSize','backgroundPosition')} />}>
          {/* Color / gradient fill */}
          <div className="fb-prop-row--full">
            <FillPicker
              value={s.backgroundColor ?? '#ffffff'}
              onChange={v => updS('backgroundColor', v)}
            />
          </div>
          {/* Image fill — only on frames */}
          {element.type === 'frame' && (
            <>
              <div className="fb-prop-row" style={{ marginTop: 8 }}>
                <span className="fb-prop-label">Image</span>
              </div>
              <div className="fb-prop-row--full" style={{ marginTop: 4 }}>
                <MediaPickerButton
                  value={s.backgroundImage ?? ''}
                  onChange={v => updS('backgroundImage', v)}
                />
              </div>
              {s.backgroundImage !== undefined && s.backgroundImage !== '' && (
                <>
                  <div className="fb-prop-row" style={{ marginTop: 6 }}>
                    <span className="fb-prop-label">Fit</span>
                    <IconGroup
                      value={s.backgroundSize ?? 'cover'}
                      onChange={v => updS('backgroundSize', v)}
                      options={[
                        { value: 'cover',   icon: '⛶', label: 'Fill' },
                        { value: 'contain', icon: '⊡', label: 'Contain' },
                        { value: '100% 100%', icon: '⊞', label: 'Stretch' },
                        { value: 'repeat',  icon: '⊞⊞', label: 'Repeat' },
                      ]}
                    />
                  </div>
                  <div className="fb-prop-row" style={{ marginTop: 4 }}>
                    <span className="fb-prop-label">Position</span>
                    <select
                      className="fb-prop-input"
                      value={s.backgroundPosition ?? 'center center'}
                      onChange={e => updS('backgroundPosition', e.target.value)}
                    >
                      <option value="center center">Center</option>
                      <option value="top left">Top left</option>
                      <option value="top center">Top center</option>
                      <option value="top right">Top right</option>
                      <option value="center left">Center left</option>
                      <option value="center right">Center right</option>
                      <option value="bottom left">Bottom left</option>
                      <option value="bottom center">Bottom center</option>
                      <option value="bottom right">Bottom right</option>
                    </select>
                  </div>
                </>
              )}
            </>
          )}
        </Section>

        {/* ── Image source (image element only) ─────────────── */}
        {element.type === 'image' && (
          <Section title="Image" action={<ResetBtn show={isOv('src')} onReset={() => resetOv('src')} />}>
            <div className="fb-prop-row--full" style={{ marginBottom: 6 }}>
              <MediaPickerButton
                value={resolved.src ?? ''}
                onChange={v => { upd('src', v); commit(); }}
              />
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Fit</span>
              <IconGroup
                value={s.objectFit ?? 'cover'}
                onChange={v => { updS('objectFit', v); commit(); }}
                options={[
                  { value: 'cover',   icon: '⛶', label: 'Fill' },
                  { value: 'contain', icon: '⊡', label: 'Contain' },
                  { value: 'fill',    icon: '⊞', label: 'Stretch' },
                  { value: 'none',    icon: '·', label: 'None' },
                ]}
              />
            </div>
          </Section>
        )}

        {/* ── Border ────────────────────────────────────────── */}
        <Section title="Border" defaultOpen={false} action={<ResetBtn show={isSOv('borderRadius','borderRadiusTL','borderRadiusTR','borderRadiusBL','borderRadiusBR','borderWidth','borderColor','borderStyle','borderRadiusMode')} onReset={() => resetSOv('borderRadius','borderRadiusTL','borderRadiusTR','borderRadiusBL','borderRadiusBR','borderWidth','borderColor','borderStyle','borderRadiusMode')} />}>
          {/* Radius */}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Radius</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <div
                className={`fb-icon-btn${(s.borderRadiusMode ?? 'linked') === 'linked' ? ' fb-icon-btn--active' : ''}`}
                title="All corners equal" style={{ fontSize: 11, padding: '0 6px' }}
                onClick={() => { updS('borderRadiusMode', 'linked'); commit(); }}
              >⊔ All</div>
              <div
                className={`fb-icon-btn${s.borderRadiusMode === 'independent' ? ' fb-icon-btn--active' : ''}`}
                title="Individual corners" style={{ fontSize: 11, padding: '0 6px' }}
                onClick={() => { updS('borderRadiusMode', 'independent'); commit(); }}
              >⊓ ×4</div>
            </div>
          </div>
          {(s.borderRadiusMode ?? 'linked') === 'linked' ? (
            <div className="fb-prop-row">
              <span className="fb-prop-label" />
              <NumberInput value={s.borderRadius ?? 0} min={0} onChange={v => { updS('borderRadius', v); commit(); }} />
            </div>
          ) : (
            <>
              <div className="fb-quad" style={{ marginTop: 4 }}>
                <NumberInput value={s.borderRadiusTL ?? s.borderRadius ?? 0} min={0} label="TL" onChange={v => { updS('borderRadiusTL', v); commit(); }} />
                <NumberInput value={s.borderRadiusTR ?? s.borderRadius ?? 0} min={0} label="TR" onChange={v => { updS('borderRadiusTR', v); commit(); }} />
              </div>
              <div className="fb-quad" style={{ marginTop: 4 }}>
                <NumberInput value={s.borderRadiusBL ?? s.borderRadius ?? 0} min={0} label="BL" onChange={v => { updS('borderRadiusBL', v); commit(); }} />
                <NumberInput value={s.borderRadiusBR ?? s.borderRadius ?? 0} min={0} label="BR" onChange={v => { updS('borderRadiusBR', v); commit(); }} />
              </div>
            </>
          )}
          {/* Width */}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Width</span>
            <NumberInput
              value={s.borderWidth ?? 0}
              min={0}
              onChange={v => updS('borderWidth', v)}
            />
          </div>
          {/* Style */}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Style</span>
            <select
              className="fb-prop-input"
              value={s.borderStyle ?? 'solid'}
              onChange={e => updS('borderStyle', e.target.value)}
            >
              <option>solid</option>
              <option>dashed</option>
              <option>dotted</option>
              <option>none</option>
            </select>
          </div>
          {/* Color */}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Color</span>
            <ColorInput value={s.borderColor ?? '#000000'} onChange={v => updS('borderColor', v)} />
          </div>
        </Section>

        {/* ── Shadow ────────────────────────────────────────── */}
        <Section title="Shadow" defaultOpen={false} action={<ResetBtn show={isSOv('boxShadow')} onReset={() => resetSOv('boxShadow')} />}>
          <ShadowEditor value={s.boxShadow ?? ''} onChange={v => { updS('boxShadow', v); commit(); }} />
        </Section>

        {/* ── Layout (frame-specific) ────────────────────────── */}
        {element.type === 'frame' && (() => {
          const frameLayoutOn = s.display === 'flex';
          return (
            <Section title="Layout" action={<ResetBtn show={isSOv('display','flexDirection','flexWrap','gap','alignItems','justifyContent','paddingTop','paddingRight','paddingBottom','paddingLeft')} onReset={() => resetSOv('display','flexDirection','flexWrap','gap','alignItems','justifyContent','paddingTop','paddingRight','paddingBottom','paddingLeft')} />}>
              {/* Auto layout toggle */}
              <div className="fb-prop-row" style={{ marginBottom: 6 }}>
                <span className="fb-prop-label">Auto layout</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={`fb-icon-btn${!frameLayoutOn ? ' fb-icon-btn--active' : ''}`}
                    title="Off – Group (free positioning)"
                    onClick={() => { updS('display', null); commit(); }}
                  >✕</button>
                  <button
                    className={`fb-icon-btn${frameLayoutOn ? ' fb-icon-btn--active' : ''}`}
                    title="On – Auto layout (flex stack)"
                    onClick={() => { updS('display', 'flex'); if (!s.flexDirection) updS('flexDirection', 'column'); commit(); }}
                  >⇌</button>
                </div>
              </div>
              {/* Direction, Wrap, Align, Justify, Gap — only when layout is on */}
              {frameLayoutOn && (
                <>
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Direction</span>
                    <IconGroup
                      value={s.flexDirection}
                      onChange={v => { updS('flexDirection', v); commit(); }}
                      options={[
                        { value: 'row',    icon: LAYOUT_ICONS.row,    label: 'Row' },
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
                        { value: 'wrap',   icon: LAYOUT_ICONS.wrap,   label: 'Wrap' },
                      ]}
                    />
                  </div>
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Align</span>
                    <IconGroup
                      value={s.alignItems}
                      onChange={v => { updS('alignItems', v); commit(); }}
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
                      value={s.justifyContent}
                      onChange={v => { updS('justifyContent', v); commit(); }}
                      options={[
                        { value: 'flex-start',    icon: LAYOUT_ICONS['just-start'],   label: 'Start' },
                        { value: 'center',        icon: LAYOUT_ICONS['just-center'],  label: 'Center' },
                        { value: 'flex-end',      icon: LAYOUT_ICONS['just-end'],     label: 'End' },
                        { value: 'space-between', icon: LAYOUT_ICONS['just-between'], label: 'Between' },
                        { value: 'space-around',  icon: LAYOUT_ICONS['just-around'],  label: 'Around' },
                      ]}
                    />
                  </div>
                  <div className="fb-prop-row">
                    <span className="fb-prop-label">Gap</span>
                    <NumberInput value={s.gap ?? 0} min={0} onChange={v => { updS('gap', v); commit(); }} />
                  </div>
                </>
              )}
              {/* Padding — always visible */}
              <div className="fb-prop-row" style={{ marginTop: 4 }}>
                <span className="fb-prop-label">Padding</span>
              </div>
              <div className="fb-quad-wide" style={{ marginTop: 2 }}>
                <NumberInput value={s.paddingTop    ?? 0} min={0} onChange={v => updS('paddingTop',    v)} label="T" />
                <NumberInput value={s.paddingRight  ?? 0} min={0} onChange={v => updS('paddingRight',  v)} label="R" />
                <NumberInput value={s.paddingBottom ?? 0} min={0} onChange={v => updS('paddingBottom', v)} label="B" />
                <NumberInput value={s.paddingLeft   ?? 0} min={0} onChange={v => updS('paddingLeft',   v)} label="L" />
              </div>
            </Section>
          );
        })()}

      </div>
    </aside>
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
    <div>
      <div style={{ marginBottom: 6 }}>
        <Toggle value={enabled} onChange={toggle} label="Enable shadow" />
      </div>
      {enabled && (
        <input
          className="fb-prop-input"
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0px 4px 16px rgba(0,0,0,0.2)"
          style={{ width: '100%' }}
        />
      )}
    </div>
  );
}
