import React, { useEffect, useMemo, useState } from 'react';
import VariantTransitionModal from './VariantTransitionModal';
import { UIIcons } from './UIIcons';

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

function summarizeVariantTargets(targets, variantOptions) {
  if (!Array.isArray(targets) || !targets.length) return 'No markers yet';
  return targets.map((target) => {
    const option = variantOptions.find((entry) => entry.value === target.targetVariantId) ?? null;
    return `${option?.label || 'Variant'} ${Math.round((target.marker ?? 0) * 100)}%`;
  }).join(' · ');
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
    <div className="fb-overlay-modal" onMouseDown={onCancel}>
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
  variantOptions = [],
  onClose,
  onDelete,
  onSave,
  onOpenEditor,
}) {
  const [draft, setDraft] = useState(animation);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [effectEditorOpen, setEffectEditorOpen] = useState(false);

  useEffect(() => {
    setDraft(animation);
  }, [animation]);

  const triggerLabel = useMemo(() => {
    if (draft.type === 'scroll') return `Start ${Math.round((draft.start ?? 0) * 100)}% · End ${Math.round((draft.end ?? 0) * 100)}%`;
    if (draft.type === 'scroll-variant') return summarizeVariantTargets(draft.targets, variantOptions);
    return null;
  }, [draft, variantOptions]);

  const saveAndClose = () => {
    onSave(draft);
    onClose();
  };

  const openCanvasEditor = (mode) => {
    onSave(draft);
    onOpenEditor(mode, draft);
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
            <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={() => openCanvasEditor('enter-start')}>
              Edit on canvas
            </button>
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
            <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={() => openCanvasEditor('scroll-range')}>
              Edit on canvas
            </button>
          </div>
          <div className="fb-artboard-bp-note">Base UI is the start state. Drag the start and end markers on canvas.</div>
          <div className="fb-prop-row">
            <span className="fb-prop-label">End State</span>
            <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={() => openCanvasEditor('scroll-effect')}>
              Edit on canvas
            </button>
          </div>
          <div className="fb-artboard-bp-note">While end-state editing is active, changes on canvas write into the scroll animation end state.</div>
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
              <div className="fb-animation-target-row__marker">{Math.round((target.marker ?? 0) * 100)}%</div>
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

  return (
    <>
      <div className="fb-overlay-modal" onMouseDown={onClose}>
        <div className="fb-overlay-modal__card fb-element-animation-modal" onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="fb-variant-transition-modal__close" onClick={onClose} aria-label="Close animation modal">×</button>
          <div className="fb-element-animation-modal__header">
            <button type="button" className="fb-element-animation-modal__back" onClick={onClose} aria-label="Close animation modal">{UIIcons.arrowLeft}</button>
            <div className="fb-variant-transition-modal__title">
              {draft.type === 'enter' ? 'Appear Animation' : (draft.type === 'scroll' ? 'Scroll Animation' : 'Scroll Variant')}
            </div>
          </div>
          <div className="fb-element-animation-modal__body">
            {content}
          </div>
          <div className="fb-variant-transition-modal__actions">
            <button type="button" className="fb-secondary-btn" onClick={onDelete}>Delete</button>
            <button type="button" className="fb-primary-btn" onClick={saveAndClose}>Save</button>
          </div>
        </div>
      </div>
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
          targetName={draft.type === 'scroll-variant' ? 'Variant' : 'End'}
          initialTransition={draft.transition}
          initialDelay={0}
          onCancel={() => setTransitionOpen(false)}
          onSave={({ transition }) => {
            setDraft((current) => ({ ...current, transition }));
            setTransitionOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
