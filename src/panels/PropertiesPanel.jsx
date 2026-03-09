import React, { useState } from 'react';
import { useEditorStore, resolveElement, resolveBackground, resolvePagePadding } from '../store/editorStore';

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
  const hasAny = resolved.minW != null || resolved.maxW != null || resolved.minH != null || resolved.maxH != null;
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
            <NumberInput value={resolved.minW ?? 0} label="Min W" onChange={v => { upd('minW', v || null); commit(); }} />
            <NumberInput value={resolved.maxW ?? 0} label="Max W" onChange={v => { upd('maxW', v || null); commit(); }} />
          </div>
          <div className="fb-quad" style={{ marginTop: 4 }}>
            <NumberInput value={resolved.minH ?? 0} label="Min H" onChange={v => { upd('minH', v || null); commit(); }} />
            <NumberInput value={resolved.maxH ?? 0} label="Max H" onChange={v => { upd('maxH', v || null); commit(); }} />
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
  const updateBreakpointDef = useEditorStore(s => s.updateBreakpointDef);
  const setPageBackground   = useEditorStore(s => s.setPageBackground);
  const setPagePadding      = useEditorStore(s => s.setPagePadding);
  const page                = useEditorStore(s => s.getCurrentPage());

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
              <ColorInput
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

  // Container dimensions for T/L/R/B position inputs
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

  const upd = (key, val) => {
    updateElementLayout(element.id, bpId, { [key]: val });
  };
  const updS = (key, val) => {
    updateStyles(element.id, bpId, { [key]: val });
  };
  const commit = () => pushHistory();

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

        {/* ── Position ──────────────────────────────────────── */}
        <Section title="Position">
          {['absolute', 'fixed'].includes(resolved.positionType ?? 'absolute') && (
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
                  value={Math.max(0, containerH - (resolved.y ?? 0) - (resolved.height ?? 100))}
                  label="B"
                  onChange={v => { upd('y', Math.max(0, containerH - v - (resolved.height ?? 100))); commit(); }}
                />
              </div>
            </div>
          )}
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
        </Section>

        {/* ── Size ──────────────────────────────────────────── */}
        <Section title="Size">
          <div className="fb-prop-row">
            <span className="fb-prop-label">Width</span>
            <div className="fb-size-row">
              <NumberInput value={resolved.width ?? 100} min={1} onChange={v => { upd('width', v); commit(); }} />
              <select
                className="fb-prop-input fb-size-mode"
                value={resolved.widthMode ?? 'fixed'}
                onChange={e => { upd('widthMode', e.target.value); commit(); }}
              >
                <option value="fixed">Fixed</option>
                <option value="fill">Fill</option>
                <option value="hug">Hug</option>
              </select>
            </div>
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Height</span>
            <div className="fb-size-row">
              <NumberInput value={resolved.height ?? 100} min={1} onChange={v => { upd('height', v); commit(); }} />
              <select
                className="fb-prop-input fb-size-mode"
                value={resolved.heightMode ?? 'fixed'}
                onChange={e => { upd('heightMode', e.target.value); commit(); }}
              >
                <option value="fixed">Fixed</option>
                <option value="fill">Fill</option>
                <option value="hug">Hug</option>
              </select>
            </div>
          </div>
          <MinMaxRow resolved={resolved} upd={upd} commit={commit} />
        </Section>

        {/* ── Transform (rotation, name, lock) ──────────────── */}
        <Section title="Transform" defaultOpen={false}>
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
        <Section title="Fill">
          <div className="fb-prop-row--full">
            <ColorInput
              value={s.backgroundColor ?? '#ffffff'}
              onChange={v => updS('backgroundColor', v)}
            />
          </div>
        </Section>

        {/* ── Border ────────────────────────────────────────── */}
        <Section title="Border" defaultOpen={false}>
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
        <Section title="Shadow" defaultOpen={false}>
          <ShadowEditor value={s.boxShadow ?? ''} onChange={v => { updS('boxShadow', v); commit(); }} />
        </Section>

        {/* ── Layout (frame-specific) ────────────────────────── */}
        {element.type === 'frame' && (
          <Section title="Layout">
            {/* Direction */}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Direction</span>
              <IconGroup
                value={s.flexDirection}
                onChange={v => { updS('flexDirection', v); commit(); }}
                options={[
                  { value: 'row',    icon: '→', label: 'Row' },
                  { value: 'column', icon: '↓', label: 'Column' },
                ]}
              />
            </div>
            {/* Wrap */}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Wrap</span>
              <IconGroup
                value={s.flexWrap}
                onChange={v => { updS('flexWrap', v); commit(); }}
                options={[
                  { value: 'nowrap', icon: '⇥', label: 'No wrap' },
                  { value: 'wrap',   icon: '↵', label: 'Wrap' },
                ]}
              />
            </div>
            {/* Align items */}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Align</span>
              <IconGroup
                value={s.alignItems}
                onChange={v => { updS('alignItems', v); commit(); }}
                options={[
                  { value: 'flex-start', icon: '⤒', label: 'Start' },
                  { value: 'center',     icon: '⊡', label: 'Center' },
                  { value: 'flex-end',   icon: '⤓', label: 'End' },
                  { value: 'stretch',    icon: '↕', label: 'Stretch' },
                ]}
              />
            </div>
            {/* Justify content */}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Justify</span>
              <IconGroup
                value={s.justifyContent}
                onChange={v => { updS('justifyContent', v); commit(); }}
                options={[
                  { value: 'flex-start',    icon: '⤒', label: 'Start' },
                  { value: 'center',        icon: '⊡', label: 'Center' },
                  { value: 'flex-end',      icon: '⤓', label: 'End' },
                  { value: 'space-between', icon: '⤛⤜', label: 'Between' },
                  { value: 'space-around',  icon: '⇔', label: 'Around' },
                ]}
              />
            </div>
            {/* Gap */}
            <div className="fb-prop-row">
              <span className="fb-prop-label">Gap</span>
              <NumberInput value={s.gap ?? 0} min={0} onChange={v => { updS('gap', v); commit(); }} />
            </div>
            {/* Padding */}
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
        )}

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
