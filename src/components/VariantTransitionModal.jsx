import React, { useEffect, useMemo, useRef, useState } from 'react';

const EASE_OPTIONS = [
  { value: 'easeInOut', label: 'Ease In Out', bezier: { x1: 0.44, y1: 0, x2: 0.56, y2: 1 } },
  { value: 'easeOut', label: 'Ease Out', bezier: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 } },
  { value: 'easeIn', label: 'Ease In', bezier: { x1: 0.64, y1: 0, x2: 0.78, y2: 0 } },
  { value: 'linear', label: 'Linear', bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } },
  { value: 'custom', label: 'Custom', bezier: null },
];

const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 180;
const GRAPH_LEFT_PAD = 0;
const GRAPH_RIGHT_PAD = 0;
const GRAPH_TOP_PAD = 18;
const GRAPH_BOTTOM_PAD = 16;
const GRAPH_OVERSHOOT_HEADROOM = 0.28;

function clamp(value, fallback, min = 0, max = Infinity) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function normalizeTransition(transition) {
  const type = ['instant', 'ease', 'realistic'].includes(transition?.type) ? transition.type : 'instant';
  const preset = EASE_OPTIONS.find((option) => option.value === transition?.easePreset && option.bezier) ?? EASE_OPTIONS[0];
  const easePreset = EASE_OPTIONS.some((option) => option.value === transition?.easePreset) ? transition.easePreset : 'easeInOut';
  const springMode = transition?.springMode === 'physics' ? 'physics' : 'time';
  return {
    type,
    duration: clamp(transition?.duration, 0.3, 0, 20),
    easePreset,
    springMode,
    bounce: clamp(transition?.bounce, 0.2, 0, 1),
    stiffness: clamp(transition?.stiffness, 500, 1, 2000),
    damping: clamp(transition?.damping, 24, 1, 300),
    mass: clamp(transition?.mass, 1, 0.1, 20),
    bezier: {
      x1: clamp(transition?.bezier?.x1, preset.bezier?.x1 ?? 0.44, 0, 1),
      y1: clamp(transition?.bezier?.y1, preset.bezier?.y1 ?? 0, 0, 1),
      x2: clamp(transition?.bezier?.x2, preset.bezier?.x2 ?? 0.56, 0, 1),
      y2: clamp(transition?.bezier?.y2, preset.bezier?.y2 ?? 1, 0, 1),
    },
  };
}

function formatBezier(bezier) {
  return `${bezier.x1.toFixed(2)}, ${bezier.y1.toFixed(2)}, ${bezier.x2.toFixed(2)}, ${bezier.y2.toFixed(2)}`;
}

function getGraphMetrics() {
  const baselineY = GRAPH_HEIGHT - GRAPH_BOTTOM_PAD;
  const targetY = GRAPH_TOP_PAD + ((baselineY - GRAPH_TOP_PAD) * (GRAPH_OVERSHOOT_HEADROOM / (1 + GRAPH_OVERSHOOT_HEADROOM)));
  return {
    baselineY,
    targetY,
    leftX: GRAPH_LEFT_PAD,
    rightX: GRAPH_WIDTH - GRAPH_RIGHT_PAD,
  };
}

function progressToGraphY(progress) {
  const { baselineY, targetY } = getGraphMetrics();
  const visibleRange = baselineY - GRAPH_TOP_PAD;
  const normalizedProgress = Math.max(0, Math.min(1 + GRAPH_OVERSHOOT_HEADROOM, progress));
  return baselineY - ((normalizedProgress / (1 + GRAPH_OVERSHOOT_HEADROOM)) * visibleRange);
}

function graphXFromRatio(ratio) {
  const { leftX, rightX } = getGraphMetrics();
  return leftX + ((rightX - leftX) * ratio);
}

function getHandlePoint(bezier, handle) {
  if (handle === 'start') {
    return { x: graphXFromRatio(bezier.x1), y: progressToGraphY(bezier.y1) };
  }
  return { x: graphXFromRatio(bezier.x2), y: progressToGraphY(bezier.y2) };
}

function getCurvePath(transition) {
  const { baselineY, targetY, rightX } = getGraphMetrics();
  if (transition.type === 'instant') {
    const midX = graphXFromRatio(0.5);
    return `M 0 ${baselineY} L ${midX} ${baselineY} L ${midX} ${targetY} L ${rightX} ${targetY}`;
  }
  if (transition.type === 'realistic') {
    const samples = transition.springMode === 'physics'
      ? getPhysicsSpringSamples(transition)
      : getTimeOvershootSamples(transition);
    return buildSamplePath(samples);
  }
  const cp1 = getHandlePoint(transition.bezier, 'start');
  const cp2 = getHandlePoint(transition.bezier, 'end');
  return `M 0 ${baselineY} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${rightX} ${targetY}`;
}

function getPhysicsSpringConfig(transition) {
  const mass = Math.max(0.1, transition?.mass ?? 1);
  const stiffness = Math.max(1, transition?.stiffness ?? 500);
  const damping = Math.max(1, transition?.damping ?? 24);
  const angularFrequency = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const duration = dampingRatio < 1
    ? Math.log(1 / 0.0025) / (Math.max(0.05, dampingRatio) * angularFrequency)
    : Math.log(1 / 0.0025) / angularFrequency;
  return {
    angularFrequency,
    dampingRatio,
    duration: Math.max(0.45, Math.min(2.4, duration)),
  };
}

function sampleSpringValue(initialValue, elapsed, spring) {
  if (!initialValue) return 0;
  const velocity = 0;
  const { angularFrequency, dampingRatio } = spring;
  if (dampingRatio < 1) {
    const dampedFrequency = angularFrequency * Math.sqrt(1 - (dampingRatio * dampingRatio));
    const envelope = Math.exp(-dampingRatio * angularFrequency * elapsed);
    const coefficient = (velocity + (dampingRatio * angularFrequency * initialValue)) / dampedFrequency;
    return envelope * ((initialValue * Math.cos(dampedFrequency * elapsed)) + (coefficient * Math.sin(dampedFrequency * elapsed)));
  }
  if (Math.abs(dampingRatio - 1) < 0.0001) {
    return (initialValue + ((velocity + (angularFrequency * initialValue)) * elapsed)) * Math.exp(-angularFrequency * elapsed);
  }
  const decay = Math.sqrt((dampingRatio * dampingRatio) - 1);
  const rateA = -angularFrequency * (dampingRatio - decay);
  const rateB = -angularFrequency * (dampingRatio + decay);
  const coeffA = (velocity - (rateB * initialValue)) / (rateA - rateB);
  const coeffB = initialValue - coeffA;
  return (coeffA * Math.exp(rateA * elapsed)) + (coeffB * Math.exp(rateB * elapsed));
}

function getPhysicsSpringSamples(transition) {
  const spring = getPhysicsSpringConfig(transition);
  const steps = 28;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const elapsed = (spring.duration * index) / steps;
    const progress = 1 - sampleSpringValue(1, elapsed, spring);
    return {
      x: graphXFromRatio(index / steps),
      y: progressToGraphY(progress),
    };
  });
}

function getTimeOvershootSamples(transition) {
  const overshoot = 1 + Math.max(0.08, transition.bounce * 0.24);
  const peak = Math.min(1 + GRAPH_OVERSHOOT_HEADROOM * 0.92, 1 + ((overshoot - 1) * 1.7));
  return [
    { x: graphXFromRatio(0), y: progressToGraphY(0) },
    { x: graphXFromRatio(0.44), y: progressToGraphY(0.92) },
    { x: graphXFromRatio(0.68), y: progressToGraphY(peak) },
    { x: graphXFromRatio(1), y: progressToGraphY(1) },
  ];
}

function buildSamplePath(samples) {
  if (!samples.length) return `M 0 ${GRAPH_HEIGHT} L ${GRAPH_WIDTH} 0`;
  return samples.reduce((path, point, index) => (
    `${path}${index === 0 ? 'M' : ' L'} ${point.x} ${point.y}`
  ), '');
}

function getPreviewKeyframes(transition) {
  if (transition.type === 'instant') {
    return [
      { left: '8px', opacity: 1, offset: 0 },
      { left: '8px', opacity: 1, offset: 0.45 },
      { left: 'calc(100% - 50px)', opacity: 1, offset: 0.46 },
      { left: 'calc(100% - 50px)', opacity: 1, offset: 1 },
    ];
  }
  if (transition.type === 'realistic') {
    if (transition.springMode === 'physics') {
      const spring = getPhysicsSpringConfig(transition);
      const steps = 18;
      return Array.from({ length: steps + 1 }, (_, index) => {
        const elapsed = (spring.duration * index) / steps;
        const progress = 1 - sampleSpringValue(1, elapsed, spring);
        const scale = 1 + Math.max(-0.08, Math.min(0.24, sampleSpringValue(-0.14, elapsed, spring)));
        return {
          left: `calc(8px + (100% - 58px) * ${progress})`,
          transform: `translateY(-50%) scale(${scale.toFixed(3)})`,
          opacity: 0.92 + (progress * 0.08),
          offset: index / steps,
        };
      });
    }
    const overshoot = Math.max(0.08, transition.bounce * 0.22);
    return [
      { left: '8px', transform: 'translateY(-50%) scale(0.94)', opacity: 0.92, offset: 0 },
      { left: `calc(100% - 50px + ${Math.round(overshoot * 42)}px)`, transform: `translateY(-50%) scale(${(1 + overshoot).toFixed(3)})`, opacity: 1, offset: 0.72 },
      { left: 'calc(100% - 50px)', transform: 'translateY(-50%) scale(1)', opacity: 1, offset: 1 },
    ];
  }
  return [
    { left: '8px', transform: 'translateY(-50%) scale(1)', opacity: 0.92, offset: 0 },
    { left: 'calc(100% - 50px)', transform: 'translateY(-50%) scale(1)', opacity: 1, offset: 1 },
  ];
}

function getPreviewTiming(transition) {
  if (transition.type === 'instant') {
    return { duration: 800, easing: 'linear', iterations: Infinity, direction: 'alternate' };
  }
  if (transition.type === 'realistic') {
    const duration = transition.springMode === 'physics'
      ? getPhysicsSpringConfig(transition).duration * 1000
      : Math.max(180, transition.duration * 1000);
    return {
      duration,
      easing: transition.springMode === 'physics'
        ? 'cubic-bezier(0.16, 1, 0.3, 1)'
        : `cubic-bezier(0.2, ${Math.max(0.7, 1 - transition.bounce * 0.4)}, 0.2, 1)`,
      iterations: Infinity,
      direction: 'alternate',
    };
  }
  const bezier = transition.bezier;
  return {
    duration: Math.max(120, transition.duration * 1000),
    easing: `cubic-bezier(${bezier.x1}, ${bezier.y1}, ${bezier.x2}, ${bezier.y2})`,
    iterations: Infinity,
    direction: 'alternate',
  };
}

export default function VariantTransitionModal({ sourceName, targetName, initialTransition, initialDelay = 0, onCancel, onSave }) {
  const [transition, setTransition] = useState(() => normalizeTransition(initialTransition));
  const [delay, setDelay] = useState(() => clamp(initialDelay, 0, 0, 60));
  const previewDotRef = useRef(null);

  useEffect(() => {
    setTransition(normalizeTransition(initialTransition));
    setDelay(clamp(initialDelay, 0, 0, 60));
  }, [initialDelay, initialTransition]);

  useEffect(() => {
    const previewDot = previewDotRef.current;
    if (!previewDot || typeof previewDot.animate !== 'function') return undefined;
    const animation = previewDot.animate(getPreviewKeyframes(transition), getPreviewTiming(transition));
    return () => animation.cancel();
  }, [transition]);

  const bezierLabel = useMemo(() => formatBezier(transition.bezier), [transition.bezier]);
  const curvePath = useMemo(() => getCurvePath(transition), [transition]);
  const startHandle = useMemo(() => getHandlePoint(transition.bezier, 'start'), [transition.bezier]);
  const endHandle = useMemo(() => getHandlePoint(transition.bezier, 'end'), [transition.bezier]);
  const graphMetrics = useMemo(() => getGraphMetrics(), []);
  const dampingSliderMax = useMemo(() => {
    const critical = 2 * Math.sqrt(Math.max(1, transition.stiffness) * Math.max(0.1, transition.mass));
    return Math.max(60, Math.round(critical * 1.35));
  }, [transition.mass, transition.stiffness]);

  const setPreset = (value) => {
    const option = EASE_OPTIONS.find((entry) => entry.value === value) ?? EASE_OPTIONS[0];
    setTransition((current) => ({
      ...current,
      easePreset: option.value,
      bezier: option.bezier ? { ...option.bezier } : current.bezier,
    }));
  };

  const startHandleDrag = (handle, event) => {
    if (transition.type !== 'ease') return;
    event.preventDefault();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const updateHandle = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width, handle === 'start' ? transition.bezier.x1 : transition.bezier.x2, 0, 1);
      const y = clamp(1 - ((clientY - rect.top) / rect.height), handle === 'start' ? transition.bezier.y1 : transition.bezier.y2, 0, 1);
      setTransition((current) => ({
        ...current,
        easePreset: 'custom',
        bezier: {
          ...current.bezier,
          ...(handle === 'start' ? { x1: x, y1: y } : { x2: x, y2: y }),
        },
      }));
    };
    const handleMove = (moveEvent) => updateHandle(moveEvent.clientX, moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    updateHandle(event.clientX, event.clientY);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div className="fb-overlay-modal" onMouseDown={onCancel}>
      <div className="fb-overlay-modal__card fb-variant-transition-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="fb-variant-transition-modal__close" onClick={onCancel} aria-label="Close transition modal">
          ×
        </button>
        <div className="fb-variant-transition-modal__title">Transition</div>

        <div className="fb-variant-transition-modal__tabs">
          {['instant', 'ease', 'realistic'].map((type) => (
            <button
              key={type}
              type="button"
              className={`fb-variant-transition-modal__tab${transition.type === type ? ' is-active' : ''}`}
              onClick={() => setTransition((current) => ({ ...current, type }))}
            >
              {type === 'realistic' ? 'Realistic' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        <div className="fb-variant-transition-modal__curve-preview">
          <div className={`fb-variant-transition-modal__curve fb-variant-transition-modal__curve--${transition.type}`}>
            <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="fb-variant-transition-modal__curve-svg" aria-hidden="true">
              <path d={`M ${graphMetrics.leftX} ${graphMetrics.baselineY} L ${graphMetrics.rightX} ${graphMetrics.baselineY}`} className="fb-variant-transition-modal__curve-axis" />
              <path d={`M ${graphMetrics.leftX} ${GRAPH_TOP_PAD} L ${graphMetrics.leftX} ${graphMetrics.baselineY}`} className="fb-variant-transition-modal__curve-axis" />
              <path d={`M ${graphMetrics.leftX} ${graphMetrics.targetY} L ${graphMetrics.rightX} ${graphMetrics.targetY}`} className="fb-variant-transition-modal__curve-axis fb-variant-transition-modal__curve-axis--target" />
              {transition.type === 'ease' ? (
                <>
                  <path d={`M ${graphMetrics.leftX} ${graphMetrics.baselineY} L ${startHandle.x} ${startHandle.y}`} className="fb-variant-transition-modal__curve-guide" />
                  <path d={`M ${graphMetrics.rightX} ${graphMetrics.targetY} L ${endHandle.x} ${endHandle.y}`} className="fb-variant-transition-modal__curve-guide" />
                </>
              ) : null}
              <path d={curvePath} className="fb-variant-transition-modal__curve-line" />
              <circle cx={graphMetrics.leftX} cy={graphMetrics.baselineY} r="8" className="fb-variant-transition-modal__curve-point fb-variant-transition-modal__curve-point--anchor" />
              <circle cx={graphMetrics.rightX} cy={graphMetrics.targetY} r="8" className="fb-variant-transition-modal__curve-point fb-variant-transition-modal__curve-point--anchor fb-variant-transition-modal__curve-point--anchor-end" />
              {transition.type === 'ease' ? (
                <>
                  <circle
                    cx={startHandle.x}
                    cy={startHandle.y}
                    r="10"
                    className="fb-variant-transition-modal__curve-point fb-variant-transition-modal__curve-point--handle"
                    onPointerDown={(event) => startHandleDrag('start', event)}
                  />
                  <circle
                    cx={endHandle.x}
                    cy={endHandle.y}
                    r="10"
                    className="fb-variant-transition-modal__curve-point fb-variant-transition-modal__curve-point--handle fb-variant-transition-modal__curve-point--handle-end"
                    onPointerDown={(event) => startHandleDrag('end', event)}
                  />
                </>
              ) : null}
            </svg>
          </div>
        </div>

        <div className="fb-variant-transition-modal__route">
          <span>{sourceName}</span>
          <span className="fb-variant-transition-modal__route-arrow">→</span>
          <span>{targetName}</span>
        </div>

        {transition.type === 'ease' ? (
          <div className="fb-variant-transition-modal__grid">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Ease</span>
              <select
                className="fb-prop-input"
                value={transition.easePreset}
                onChange={(e) => setPreset(e.target.value)}
              >
                {EASE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Bezier</span>
              <div className="fb-prop-value">{bezierLabel}</div>
            </div>
            <div className="fb-prop-row">
              <span className="fb-prop-label">Time</span>
              <NumberField value={transition.duration} unit="s" step={0.1} min={0} onChange={(value) => setTransition((current) => ({ ...current, duration: value }))} />
            </div>
          </div>
        ) : null}

        {transition.type === 'realistic' ? (
          <div className="fb-variant-transition-modal__grid">
            <div className="fb-prop-row">
              <span className="fb-prop-label">Based On</span>
              <div className="fb-choice-group">
                <button
                  type="button"
                  className={`fb-choice-group__btn${transition.springMode === 'time' ? ' fb-choice-group__btn--active' : ''}`}
                  onClick={() => setTransition((current) => ({ ...current, springMode: 'time' }))}
                >
                  Time
                </button>
                <button
                  type="button"
                  className={`fb-choice-group__btn${transition.springMode === 'physics' ? ' fb-choice-group__btn--active' : ''}`}
                  onClick={() => setTransition((current) => ({ ...current, springMode: 'physics' }))}
                >
                  Physics
                </button>
              </div>
            </div>
            {transition.springMode === 'time' ? (
              <>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Time</span>
                  <NumberField value={transition.duration} unit="s" step={0.1} min={0} onChange={(value) => setTransition((current) => ({ ...current, duration: value }))} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Bounce</span>
                  <NumberField value={transition.bounce} step={0.05} min={0} max={1} onChange={(value) => setTransition((current) => ({ ...current, bounce: value }))} />
                </div>
              </>
            ) : (
              <>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Stiffness</span>
                  <SliderField value={transition.stiffness} min={40} max={1200} step={1} onChange={(value) => setTransition((current) => ({ ...current, stiffness: value }))} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Damping</span>
                  <SliderField value={transition.damping} min={1} max={Math.max(dampingSliderMax, Math.round(transition.damping))} step={1} onChange={(value) => setTransition((current) => ({ ...current, damping: value }))} />
                </div>
                <div className="fb-prop-row">
                  <span className="fb-prop-label">Mass</span>
                  <NumberField value={transition.mass} step={0.1} min={0.1} max={20} onChange={(value) => setTransition((current) => ({ ...current, mass: value }))} />
                </div>
              </>
            )}
          </div>
        ) : null}

        <div className="fb-prop-row fb-variant-transition-modal__delay-row">
          <span className="fb-prop-label">Delay</span>
          <NumberField value={delay} unit="s" step={0.1} min={0} onChange={setDelay} />
        </div>

        <div className="fb-variant-transition-modal__preview">
          <span className="fb-variant-transition-modal__preview-label">Preview</span>
          <div className={`fb-variant-transition-modal__preview-bar fb-variant-transition-modal__preview-bar--${transition.type}`}>
            <div ref={previewDotRef} className="fb-variant-transition-modal__preview-dot" />
          </div>
        </div>

        <div className="fb-overlay-modal__actions fb-variant-transition-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="fb-primary-btn"
            onClick={() => onSave({ transition: normalizeTransition(transition), delay: clamp(delay, 0, 0, 60) })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField({ value, onChange, unit = null, min = 0, max = Infinity, step = 0.1 }) {
  return (
    <div className="fb-variant-transition-modal__number-field">
      <input
        className="fb-prop-input"
        type="number"
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        value={Math.round((value ?? 0) * 100) / 100}
        onChange={(e) => onChange(clamp(e.target.value, value ?? 0, min, max))}
      />
      {unit ? <span className="fb-variant-transition-modal__number-unit">{unit}</span> : null}
    </div>
  );
}

function SliderField({ value, onChange, min = 0, max = 100, step = 1 }) {
  return (
    <div className="fb-slider-field">
      <input
        className="fb-prop-input fb-slider-field__value"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Math.round((value ?? 0) * 100) / 100}
        onChange={(e) => onChange(clamp(e.target.value, value ?? 0, min, max))}
      />
      <input
        className="fb-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        onChange={(e) => onChange(clamp(e.target.value, value ?? 0, min, max))}
      />
    </div>
  );
}
