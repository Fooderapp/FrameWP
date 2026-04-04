import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import VariantTransitionModal from './VariantTransitionModal';

const TRIGGER_OPTIONS = [
  { value: 'click', label: 'Click' },
  { value: 'click-start', label: 'Click Start' },
  { value: 'appear', label: 'Appear' },
  { value: 'mouse-enter', label: 'Mouse Enter' },
  { value: 'mouse-leave', label: 'Mouse Leave' },
];

function getTransitionSummary(transition) {
  if (!transition || transition.type === 'instant') return 'Instant';
  if (transition.type === 'ease') return `Ease · ${Math.round((transition.duration ?? 0.3) * 10) / 10}s`;
  return transition.springMode === 'physics'
    ? `Realistic · Physics · ${Math.round((transition.physicsDuration ?? transition.duration ?? 0.3) * 10) / 10}s`
    : `Realistic · ${Math.round((transition.duration ?? 0.3) * 10) / 10}s`;
}

export default function VariantInteractionModal({ sourceName, targetName, initialInteraction, onCancel, onSave, onDisconnect, showTransition = true }) {
  const [trigger, setTrigger] = useState(initialInteraction?.trigger ?? 'click');
  const [delay, setDelay] = useState(initialInteraction?.delay ?? 0);
  const [transition, setTransition] = useState(initialInteraction?.transition ?? null);
  const [transitionModalOpen, setTransitionModalOpen] = useState(false);

  useEffect(() => {
    setTrigger(initialInteraction?.trigger ?? 'click');
    setDelay(initialInteraction?.delay ?? 0);
    setTransition(initialInteraction?.transition ?? null);
  }, [initialInteraction]);

  return (
    <div className="fb-overlay-modal" onMouseDown={onCancel}>
      <div className="fb-overlay-modal__card fb-variant-interaction-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fb-overlay-modal__head">Interaction</div>
        <div className="fb-overlay-modal__body">
          <div className="fb-variant-interaction-modal__summary">
            <div className="fb-variant-interaction-modal__summary-name">{sourceName}</div>
            <div className="fb-variant-interaction-modal__summary-arrow" />
            <div className="fb-variant-interaction-modal__summary-name">{targetName}</div>
          </div>

          <div className="fb-prop-row">
            <span className="fb-prop-label">On</span>
            <select className="fb-prop-input" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {TRIGGER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="fb-prop-row">
            <span className="fb-prop-label">Delay</span>
            <div className="fb-variant-interaction-modal__delay">
              <input
                className="fb-prop-input fb-variant-interaction-modal__delay-input"
                type="number"
                min={0}
                step={0.1}
                value={Math.round((delay ?? 0) * 10) / 10}
                onChange={(e) => {
                  const nextDelay = parseFloat(e.target.value);
                  setDelay(Number.isFinite(nextDelay) ? Math.max(0, nextDelay) : 0);
                }}
              />
              <span className="fb-variant-interaction-modal__delay-unit">s</span>
              <div className="fb-stepper-field fb-variant-interaction-modal__delay-stepper">
                <button type="button" className="fb-stepper-field__btn" onClick={() => setDelay((current) => Math.max(0, Math.round((current - 0.1) * 10) / 10))}>−</button>
                <button type="button" className="fb-stepper-field__btn" onClick={() => setDelay((current) => Math.round((current + 0.1) * 10) / 10)}>+</button>
              </div>
            </div>
          </div>

          {showTransition ? (
            <div className="fb-prop-row">
              <span className="fb-prop-label">Transition</span>
              <button type="button" className="fb-secondary-btn fb-prop-action-btn" onClick={() => setTransitionModalOpen(true)}>
                {getTransitionSummary(transition)}
              </button>
            </div>
          ) : null}
        </div>
        <div className="fb-overlay-modal__actions fb-variant-interaction-modal__actions">
          {onDisconnect ? (
            <button type="button" className="fb-secondary-btn" onClick={onDisconnect}>Disconnect</button>
          ) : null}
          <button type="button" className="fb-secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="fb-primary-btn"
            onClick={() => onSave({ trigger, delay: Math.max(0, Math.round((delay ?? 0) * 10) / 10), ...(showTransition ? { transition } : {}) })}
          >
            Save
          </button>
        </div>
      </div>
      {showTransition && transitionModalOpen && typeof document !== 'undefined' ? createPortal(
        <VariantTransitionModal
          sourceName={sourceName}
          targetName={targetName}
          initialTransition={transition}
          initialDelay={delay}
          onCancel={() => setTransitionModalOpen(false)}
          onSave={({ transition: nextTransition, delay: nextDelay }) => {
            setTransition(nextTransition);
            setDelay(nextDelay);
            setTransitionModalOpen(false);
          }}
        />,
        document.body,
      ) : null}
    </div>
  );
}