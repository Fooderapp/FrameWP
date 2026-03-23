import React, { useEffect, useMemo, useRef, useState } from 'react';
import VariantTransitionModal from './VariantTransitionModal';
import { UIIcons } from './UIIcons';
import { resolveFloatingInspectorPosition } from '../utils/rect';

const ENTER_PRESETS = [
  {
    value: 'fadeUp',
    label: 'Fade Up',
    effect: { opacity: 0, scale: 1, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 40 },
  },
  {
    value: 'fadeIn',
    label: 'Fade In',
    effect: { opacity: 0, scale: 1, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 0 },
  },
  {
    value: 'scaleIn',
    label: 'Scale In',
    effect: { opacity: 0, scale: 0.92, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 0 },
  },
  {
    value: 'slideLeft',
    label: 'Slide Left',
    effect: { opacity: 0, scale: 1, rotateMode: '2d', rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, offsetX: -48, offsetY: 0 },
  },
];

function clamp(value, fallback, min = 0, max = Infinity) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function findPresetLabel(value) {
  return ENTER_PRESETS.find((preset) => preset.value === value)?.label ?? 'Custom';
}

function summarizeEnterEffect(effect) {
  if (!effect) return 'Custom';
  const parts = [];
  if ((effect.offsetY ?? 0) !== 0) parts.push(`Y ${Math.round(effect.offsetY)}px`);
  if ((effect.offsetX ?? 0) !== 0) parts.push(`X ${Math.round(effect.offsetX)}px`);
  if ((effect.opacity ?? 1) !== 1) parts.push(`Opacity ${Math.round((effect.opacity ?? 1) * 100)}%`);
  if ((effect.scale ?? 1) !== 1) parts.push(`Scale ${Math.round((effect.scale ?? 1) * 100)}%`);
  if ((effect.rotate ?? 0) !== 0) parts.push(`Rotate ${Math.round(effect.rotate)}°`);
  if (!(parts.length)) return 'Custom';
  return parts.join(' · ');
}

function hasPatchState(state) {
  if (!state || typeof state !== 'object') return false;
  const layout = state.layout && typeof state.layout === 'object' ? state.layout : null;
  const styles = state.styles && typeof state.styles === 'object' ? state.styles : null;
  return Boolean((layout && Object.keys(layout).length) || (styles && Object.keys(styles).length));
}

function EffectNumberRow({ label, value, min, max, step = 0.01, onChange, rangeMin = null, rangeMax = null, rangeStep = null, className = '' }) {
  return (
    <label className={`fb-animation-modal__control-row${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      <input type="number" className="fb-prop-input" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} />
      {rangeMin != null && rangeMax != null ? (
        <input type="range" min={rangeMin} max={rangeMax} step={rangeStep ?? step} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : <div />}
    </label>
  );
}

function summarizeVariantTargets(targets, variantOptions) {
  if (!Array.isArray(targets) || !targets.length) return 'No markers yet';
  return targets.map((target) => {
    const option = variantOptions.find((entry) => entry.value === target.targetVariantId) ?? null;
    if (Number.isFinite(target.markerOffsetPx)) {
      return `${option?.label || 'Variant'} ${Math.round(target.markerOffsetPx)}px`;
    }
    return `${option?.label || 'Variant'} marker`;
  }).join(' · ');
}

function getAnimationModalTitle(type) {
  if (type === 'enter') return 'Appear Animation';
  if (type === 'scroll') return 'Scroll Animation';
  if (type === 'loop') return 'Loop Animation';
  if (type === 'hover') return 'Hover Animation';
  return 'Scroll Variant';
}

function getAnimationModalSubtitle(draft, triggerLabel) {
  if (!draft) return '';
  if (draft.type === 'scroll') return triggerLabel || 'Link scroll range and start state.';
  if (draft.type === 'enter') return 'Tune the effect and optional start-state patch.';
  if (draft.type === 'loop') return 'Continuous motion with timing and off-screen behavior.';
  if (draft.type === 'hover') return 'Interactive motion applied while the pointer is over the element.';
  return triggerLabel || 'Switch variants from scroll markers.';
}

function SummaryChip({ label, value }) {
  if (!value) return null;
  return (
    <div className="fb-element-animation-modal__summary-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CanvasEditActionButton({ icon, label, onClick }) {
  return (
    <button type="button" className="fb-secondary-btn fb-prop-action-btn fb-prop-action-btn--canvas" onClick={onClick}>
      <span className="fb-prop-action-btn__icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function TransitionSummaryButton({ transition, onClick }) {
  const summary = transition?.type === 'instant'
    ? 'Instant'
    : transition?.type === 'realistic'
      ? (transition?.springMode === 'physics'
        ? `Realistic · Physics · ${Math.round((transition?.physicsDuration ?? transition?.duration ?? 0.6) * 10) / 10}s`
        : `Realistic · ${Math.round((transition?.duration ?? 0.6) * 10) / 10}s`)
      : `Ease · ${Math.round((transition?.duration ?? 0.6) * 10) / 10}s`;
  return (
    <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={onClick}>
      {summary}
    </button>
  );
}

function EnterEffectEditorModal({ effect, preset, onCancel, onSave }) {
  const [draft, setDraft] = useState(effect);
  const [draftPreset, setDraftPreset] = useState(preset);

  useEffect(() => {
    setDraft(effect);
    setDraftPreset(preset);
  }, [effect, preset]);

  const update = (key, value) => {
    setDraftPreset('custom');
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="fb-overlay-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="fb-overlay-modal__card fb-enter-effect-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="fb-variant-transition-modal__close" onClick={onCancel} aria-label="Close enter effect modal">×</button>
        <div className="fb-variant-transition-modal__title">Enter Effect</div>
        <div className="fb-animation-modal__preset-grid fb-animation-modal__preset-grid--top">
          {ENTER_PRESETS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`fb-animation-modal__preset${draftPreset === item.value ? ' is-active' : ''}`}
              onClick={() => {
                setDraftPreset(item.value);
                setDraft(item.effect);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="fb-enter-effect-modal__grid">
          <label className="fb-animation-modal__control-row">
            <span>Opacity</span>
            <input type="number" className="fb-prop-input" value={draft.opacity} min={0} max={1} step={0.01} onChange={(event) => update('opacity', clamp(event.target.value, draft.opacity, 0, 1))} />
            <input type="range" min={0} max={1} step={0.01} value={draft.opacity} onChange={(event) => update('opacity', clamp(event.target.value, draft.opacity, 0, 1))} />
          </label>
          <label className="fb-animation-modal__control-row">
            <span>Scale</span>
            <input type="number" className="fb-prop-input" value={draft.scale} min={0.1} max={4} step={0.01} onChange={(event) => update('scale', clamp(event.target.value, draft.scale, 0.1, 4))} />
            <input type="range" min={0.1} max={2} step={0.01} value={draft.scale} onChange={(event) => update('scale', clamp(event.target.value, draft.scale, 0.1, 4))} />
          </label>
          <div className="fb-animation-modal__control-row">
            <span>Rotate</span>
            <input type="number" className="fb-prop-input" value={draft.rotateMode === '3d' ? draft.rotateX : draft.rotate} step={1} onChange={(event) => (draft.rotateMode === '3d' ? update('rotateX', clamp(event.target.value, 0, -1080, 1080)) : update('rotate', clamp(event.target.value, 0, -1080, 1080)))} />
            <div className="fb-animation-modal__segmented">
              <button type="button" className={draft.rotateMode === '2d' ? 'is-active' : ''} onClick={() => update('rotateMode', '2d')}>2D</button>
              <button type="button" className={draft.rotateMode === '3d' ? 'is-active' : ''} onClick={() => update('rotateMode', '3d')}>3D</button>
            </div>
          </div>
          <div className="fb-animation-modal__double-grid">
            <label className="fb-animation-modal__mini-control">
              <span>Skew X</span>
              <input type="number" className="fb-prop-input" value={draft.skewX} step={1} onChange={(event) => update('skewX', clamp(event.target.value, 0, -180, 180))} />
            </label>
            <label className="fb-animation-modal__mini-control">
              <span>Skew Y</span>
              <input type="number" className="fb-prop-input" value={draft.skewY} step={1} onChange={(event) => update('skewY', clamp(event.target.value, 0, -180, 180))} />
            </label>
          </div>
          <div className="fb-animation-modal__double-grid">
            <label className="fb-animation-modal__mini-control">
              <span>Offset X</span>
              <input type="number" className="fb-prop-input" value={draft.offsetX} step={1} onChange={(event) => update('offsetX', clamp(event.target.value, 0, -4000, 4000))} />
            </label>
            <label className="fb-animation-modal__mini-control">
              <span>Offset Y</span>
              <input type="number" className="fb-prop-input" value={draft.offsetY} step={1} onChange={(event) => update('offsetY', clamp(event.target.value, 0, -4000, 4000))} />
            </label>
          </div>
        </div>
        <div className="fb-variant-transition-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="fb-primary-btn" onClick={() => onSave({ effect: draft, preset: draftPreset })}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default function ElementAnimationModal({
  animation,
  anchorRect = null,
  containerRect = null,
  variantOptions = [],
  onClose,
  onDelete,
  onSave,
  onPreview,
  onOpenEditor,
}) {
  const [draft, setDraft] = useState(animation);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [effectEditorOpen, setEffectEditorOpen] = useState(false);
  const isFloatingCompactEditor = draft?.type === 'loop' || draft?.type === 'hover';
  const modalRef = useRef(null);

  useEffect(() => {
    setDraft(animation);
  }, [animation?.id]);

  useEffect(() => {
    if (!draft || !onPreview || (draft.type !== 'loop' && draft.type !== 'hover')) return;
    onPreview(draft);
  }, [draft]);

  useEffect(() => {
    if (!isFloatingCompactEditor) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isFloatingCompactEditor, onClose]);

  useEffect(() => {
    if (isFloatingCompactEditor) return undefined;
    const handlePointerDown = (event) => {
      if (modalRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isFloatingCompactEditor, onClose]);

  const triggerLabel = useMemo(() => {
    if (draft.type === 'scroll') {
      if (Number.isFinite(draft.startOffsetPx) && Number.isFinite(draft.endOffsetPx)) {
        return `Start ${Math.round(draft.startOffsetPx)}px · End ${Math.round(draft.endOffsetPx)}px`;
      }
      return 'Artboard-linked start and end markers';
    }
    if (draft.type === 'scroll-variant') return summarizeVariantTargets(draft.targets, variantOptions);
    return null;
  }, [draft, variantOptions]);
  const title = getAnimationModalTitle(draft?.type);
  const subtitle = getAnimationModalSubtitle(draft, triggerLabel);
  const isDockedInspector = !isFloatingCompactEditor;
  const dockedInspectorStyle = useMemo(() => {
    if (!isDockedInspector) return undefined;
    return resolveFloatingInspectorPosition({ anchorRect, containerRect });
  }, [anchorRect, containerRect, isDockedInspector]);

  const saveAndClose = () => {
    onSave(draft);
    onClose();
  };

  const openCanvasEditor = (mode) => {
    onOpenEditor(mode, draft);
  };

  const resetStartState = () => {
    if (draft.type !== 'scroll' && draft.type !== 'enter') return;
    setDraft((current) => ({
      ...current,
      startState: { layout: {}, styles: {} },
    }));
  };

  const content = (() => {
    if (draft.type === 'enter') {
      return (
        <>
          <div className="fb-animation-modal__preset-grid">
            {ENTER_PRESETS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`fb-animation-modal__preset${draft.preset === item.value ? ' is-active' : ''}`}
                onClick={() => setDraft((current) => ({ ...current, preset: item.value, effect: item.effect }))}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Enter</span>
            <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={() => setEffectEditorOpen(true)}>
              {draft.preset === 'custom' ? 'Custom' : findPresetLabel(draft.preset)}
            </button>
          </div>
          <div className="fb-artboard-bp-note">{summarizeEnterEffect(draft.effect)}</div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Start State</span>
            <div className="fb-animation-modal__action-group">
              <CanvasEditActionButton icon={UIIcons.select} label="Edit on canvas" onClick={() => openCanvasEditor('enter-start')} />
              <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={resetStartState} disabled={!hasPatchState(draft.startState)}>
                <span className="fb-prop-action-btn__icon" aria-hidden="true">{UIIcons.undo}</span>
                <span>Reset</span>
              </button>
            </div>
          </div>
          <div className="fb-artboard-bp-note">Base UI is the final state. Canvas editing defines the appear start state.</div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Playback</span>
            <div className="fb-animation-modal__segmented">
              <button type="button" className={draft.playback === 'once' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, playback: 'once' }))}>Once</button>
              <button type="button" className={draft.playback === 'replay' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, playback: 'replay' }))}>Replay</button>
            </div>
          </div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Transition</span>
            <TransitionSummaryButton transition={draft.transition} onClick={() => setTransitionOpen(true)} />
          </div>
        </>
      );
    }

    if (draft.type === 'scroll') {
      return (
        <>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Markers</span>
            <CanvasEditActionButton icon={UIIcons.flow} label="Markers on canvas" onClick={() => openCanvasEditor('scroll-range')} />
          </div>
          <div className="fb-artboard-bp-note">Base UI is the end state. Marker 0px is the selected element top. Start and end markers are measured from there with negative or positive px values.</div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Start State</span>
            <div className="fb-animation-modal__action-group">
              <CanvasEditActionButton icon={UIIcons.select} label="Edit on canvas" onClick={() => openCanvasEditor('scroll-start')} />
              <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={resetStartState} disabled={!hasPatchState(draft.startState)}>
                <span className="fb-prop-action-btn__icon" aria-hidden="true">{UIIcons.undo}</span>
                <span>Reset</span>
              </button>
            </div>
          </div>
          <div className="fb-artboard-bp-note">While start-state editing is active, changes on canvas write into the scroll animation start state.</div>
          <div className="fb-artboard-bp-note">{triggerLabel}</div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">Playback</span>
            <div className="fb-animation-modal__segmented">
              <button type="button" className={draft.playback === 'once' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, playback: 'once' }))}>Once</button>
              <button type="button" className={draft.playback === 'replay' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, playback: 'replay' }))}>Replay</button>
            </div>
          </div>
        </>
      );
    }

    if (draft.type === 'loop' || draft.type === 'hover') {
      const updateEffect = (key, value, fallback, min, max) => {
        setDraft((current) => ({
          ...current,
          effect: {
            ...(current.effect ?? {}),
            [key]: clamp(value, fallback, min, max),
          },
        }));
      };
      const effect = draft.effect ?? {};
      return (
        <>
          {draft.type === 'loop' ? (
            <>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Type</span>
                <div className="fb-animation-modal__segmented">
                  <button type="button" className={draft.loopType === 'loop' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, loopType: 'loop' }))}>Loop</button>
                  <button type="button" className={draft.loopType === 'mirror' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, loopType: 'mirror' }))}>Mirror</button>
                </div>
              </div>
              <div className="fb-prop-row">
                <span className="fb-prop-label">Delay</span>
                <div className="fb-variant-transition-modal__number-field">
                  <input
                    className="fb-prop-input"
                    type="number"
                    min={0}
                    max={60}
                    step={0.1}
                    value={Math.round((draft.delay ?? 0) * 100) / 100}
                    onChange={(event) => setDraft((current) => ({ ...current, delay: clamp(event.target.value, current.delay ?? 0, 0, 60) }))}
                  />
                  <span className="fb-variant-transition-modal__number-unit">s</span>
                </div>
              </div>
            </>
          ) : null}
          <EffectNumberRow label="Opacity" className="fb-animation-modal__control-row--range" value={effect.opacity ?? 1} min={0} max={1} step={0.01} rangeMin={0} rangeMax={1} rangeStep={0.01} onChange={(value) => updateEffect('opacity', value, effect.opacity ?? 1, 0, 1)} />
          <EffectNumberRow label="Scale" className="fb-animation-modal__control-row--range" value={effect.scale ?? 1} min={0.1} max={4} step={0.01} rangeMin={0.1} rangeMax={2} rangeStep={0.01} onChange={(value) => updateEffect('scale', value, effect.scale ?? 1, 0.1, 4)} />
          <div className="fb-animation-modal__control-row fb-animation-modal__control-row--rotate">
            <span>{effect.rotateMode === '3d' ? 'Rotate Z' : 'Rotate'}</span>
            <input
              type="number"
              className="fb-prop-input"
              value={effect.rotate ?? 0}
              step={1}
              onChange={(event) => {
                updateEffect('rotate', event.target.value, effect.rotate ?? 0, -1080, 1080);
              }}
            />
            <div className="fb-animation-modal__segmented">
              <button type="button" className={effect.rotateMode !== '3d' ? 'is-active' : ''} onClick={() => updateEffect('rotateMode', '2d', '2d')}>2D</button>
              <button type="button" className={effect.rotateMode === '3d' ? 'is-active' : ''} onClick={() => updateEffect('rotateMode', '3d', '3d')}>3D</button>
            </div>
          </div>
          {effect.rotateMode === '3d' ? (
            <div className="fb-animation-modal__double-grid">
              <label className="fb-animation-modal__mini-control">
                <span>Rotate X</span>
                <input type="number" className="fb-prop-input" value={effect.rotateX ?? 0} step={1} onChange={(event) => updateEffect('rotateX', event.target.value, effect.rotateX ?? 0, -1080, 1080)} />
              </label>
              <label className="fb-animation-modal__mini-control">
                <span>Rotate Y</span>
                <input type="number" className="fb-prop-input" value={effect.rotateY ?? 0} step={1} onChange={(event) => updateEffect('rotateY', event.target.value, effect.rotateY ?? 0, -1080, 1080)} />
              </label>
            </div>
          ) : null}
          <div className="fb-animation-modal__double-grid">
            <label className="fb-animation-modal__mini-control">
              <span>Skew X</span>
              <input type="number" className="fb-prop-input" value={effect.skewX ?? 0} step={1} onChange={(event) => updateEffect('skewX', event.target.value, effect.skewX ?? 0, -180, 180)} />
            </label>
            <label className="fb-animation-modal__mini-control">
              <span>Skew Y</span>
              <input type="number" className="fb-prop-input" value={effect.skewY ?? 0} step={1} onChange={(event) => updateEffect('skewY', event.target.value, effect.skewY ?? 0, -180, 180)} />
            </label>
          </div>
          <div className="fb-animation-modal__double-grid">
            <label className="fb-animation-modal__mini-control">
              <span>Offset X</span>
              <input type="number" className="fb-prop-input" value={effect.offsetX ?? 0} step={1} onChange={(event) => updateEffect('offsetX', event.target.value, effect.offsetX ?? 0, -4000, 4000)} />
            </label>
            <label className="fb-animation-modal__mini-control">
              <span>Offset Y</span>
              <input type="number" className="fb-prop-input" value={effect.offsetY ?? 0} step={1} onChange={(event) => updateEffect('offsetY', event.target.value, effect.offsetY ?? 0, -4000, 4000)} />
            </label>
          </div>
          {draft.type === 'loop' ? (
            <div className="fb-prop-row">
              <span className="fb-prop-label">Off Screen</span>
              <div className="fb-animation-modal__segmented">
                <button type="button" className={draft.offscreenBehavior === 'play' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, offscreenBehavior: 'play' }))}>Play</button>
                <button type="button" className={draft.offscreenBehavior !== 'play' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, offscreenBehavior: 'pause' }))}>Pause</button>
              </div>
            </div>
          ) : null}
          <div className="fb-prop-row">
            <span className="fb-prop-label">Transition</span>
            <TransitionSummaryButton transition={draft.transition} onClick={() => setTransitionOpen(true)} />
          </div>
        </>
      );
    }

    return (
      <>
        <div className="fb-prop-row">
          <span className="fb-prop-label">Markers</span>
          <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={() => openCanvasEditor('scroll-variant-marker')}>
            Edit on canvas
          </button>
        </div>
        <div className="fb-artboard-bp-note">Open the canvas editor to drag all variant trigger markers and return with Exit Editing.</div>
        <div className="fb-animation-target-list">
          {(draft.targets ?? []).map((target, index) => (
            <div key={target.id || index} className="fb-animation-target-row">
              <select
                className="fb-prop-input"
                value={target.targetVariantId ?? ''}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  targets: (current.targets ?? []).map((entry, entryIndex) => (
                    entryIndex === index ? { ...entry, targetVariantId: event.target.value || null } : entry
                  )),
                }))}
              >
                <option value="">Select variant</option>
                {variantOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="fb-animation-target-row__marker">
                {Number.isFinite(target.markerOffsetPx) ? `${Math.round(target.markerOffsetPx)}px` : 'Marker'}
              </div>
              <button
                type="button"
                className="fb-icon-btn"
                aria-label="Remove variant trigger"
                onClick={() => setDraft((current) => ({
                  ...current,
                  targets: (current.targets ?? []).filter((_, entryIndex) => entryIndex !== index),
                }))}
              >
                {UIIcons.trash}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="fb-secondary-btn"
          onClick={() => setDraft((current) => ({
            ...current,
            targets: [
              ...(current.targets ?? []),
              {
                id: `target-${Date.now()}`,
                targetVariantId: variantOptions[0]?.value ?? null,
                marker: Math.min(0.95, 0.3 + ((current.targets ?? []).length * 0.16)),
              },
            ],
          }))}
        >
          Add Variant Marker
        </button>
        <div className="fb-artboard-bp-note">Drag all trigger markers on the canvas overlay.</div>
        <div className="fb-prop-row">
          <span className="fb-prop-label">Playback</span>
          <div className="fb-animation-modal__segmented">
            <button type="button" className={draft.playback === 'once' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, playback: 'once' }))}>Once</button>
            <button type="button" className={draft.playback === 'replay' ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, playback: 'replay' }))}>Replay</button>
          </div>
        </div>
        <div className="fb-prop-row">
          <span className="fb-prop-label">Transition</span>
          <TransitionSummaryButton transition={draft.transition} onClick={() => setTransitionOpen(true)} />
        </div>
      </>
    );
  })();

  const card = (
    <div
      className={`fb-overlay-modal__card fb-element-animation-modal${isFloatingCompactEditor ? ' fb-element-animation-modal--floating' : ' fb-element-animation-modal--inspector'}`}
      ref={modalRef}
      style={dockedInspectorStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" className="fb-variant-transition-modal__close" onClick={onClose} aria-label="Close animation modal">×</button>
      {isDockedInspector ? <div className="fb-element-animation-modal__kicker">Animation</div> : null}
      <div className="fb-element-animation-modal__header">
        <button type="button" className="fb-element-animation-modal__back" onClick={onClose} aria-label="Close animation modal">{UIIcons.arrowLeft}</button>
        <div>
          <div className="fb-variant-transition-modal__title">{title}</div>
          {isDockedInspector && subtitle ? <div className="fb-element-animation-modal__subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {isDockedInspector ? (
        <div className="fb-element-animation-modal__summary">
          <SummaryChip label="Playback" value={draft.playback === 'replay' ? 'Replay' : 'Once'} />
          <SummaryChip label="Transition" value={draft.transition?.type === 'realistic' ? 'Realistic' : (draft.transition?.type === 'instant' ? 'Instant' : 'Ease')} />
          {draft.type === 'enter' ? <SummaryChip label="Preset" value={draft.preset === 'custom' ? 'Custom' : findPresetLabel(draft.preset)} /> : null}
          {draft.type === 'loop' ? <SummaryChip label="Loop" value={draft.loopType === 'mirror' ? 'Mirror' : 'Loop'} /> : null}
        </div>
      ) : null}
      {isDockedInspector && (draft.type === 'scroll' || draft.type === 'scroll-variant' || draft.type === 'enter') ? (
        <div className="fb-element-animation-modal__inline-note">
          Use the canvas edit actions here, then exit editing from the overlay on canvas.
        </div>
      ) : null}
      <div className={`fb-element-animation-modal__body${isDockedInspector ? ' fb-element-animation-modal__body--inspector' : ''}`}>
        {content}
      </div>
      <div className="fb-variant-transition-modal__actions">
        <button type="button" className="fb-secondary-btn" onClick={onDelete}>Delete</button>
        <button type="button" className="fb-primary-btn" onClick={saveAndClose}>{isFloatingCompactEditor ? 'Done' : 'Save'}</button>
      </div>
    </div>
  );

  const modalTree = (
    <>
      {isFloatingCompactEditor ? (
        card
      ) : (
        card
      )}
      {effectEditorOpen ? (
        <EnterEffectEditorModal
          effect={draft.effect}
          preset={draft.preset}
          onCancel={() => setEffectEditorOpen(false)}
          onSave={({ effect, preset }) => {
            setDraft((current) => ({ ...current, effect, preset }));
            setEffectEditorOpen(false);
          }}
        />
      ) : null}
      {transitionOpen ? (
        <VariantTransitionModal
          sourceName={draft.name}
          targetName={draft.type === 'scroll-variant' ? 'Variant' : (draft.type === 'loop' ? 'Loop' : (draft.type === 'hover' ? 'Hover' : 'End'))}
          initialTransition={draft.transition}
          initialDelay={draft.type === 'loop' ? (draft.delay ?? 0) : 0}
          onCancel={() => setTransitionOpen(false)}
          onSave={({ transition, delay }) => {
            setDraft((current) => ({
              ...current,
              transition,
              ...(current.type === 'loop' ? { delay } : {}),
            }));
            setTransitionOpen(false);
          }}
        />
      ) : null}
    </>
  );

  return modalTree;
}
