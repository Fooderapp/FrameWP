import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../store/editorStore';
import { IconButton, UIIcons } from './UIIcons';

// ── Math helpers ──────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s, v };
}

function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16);
  if (isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

function parseColor(str) {
  if (!str || typeof str !== 'string') return { r: 255, g: 255, b: 255, a: 1 };
  const s = str.trim();
  if (s.startsWith('#')) return { ...hexToRgb(s), a: 1 };
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
  return { r: 255, g: 255, b: 255, a: 1 };
}

function colorToStr(r, g, b, a) {
  if (a >= 1) return rgbToHex({ r, g, b });
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${parseFloat(a.toFixed(3))})`;
}

// ── Gradient helpers ──────────────────────────────────────────────────────────

function isGradient(str) {
  return typeof str === 'string' && /gradient\(/.test(str);
}

function detectFillType(str) {
  if (!str || !isGradient(str)) return 'solid';
  if (str.startsWith('linear-gradient')) return 'linear';
  if (str.startsWith('radial-gradient')) return 'radial';
  if (str.startsWith('conic-gradient'))  return 'conic';
  return 'solid';
}

function splitTopLevel(str) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === ',' && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(str.slice(start).trim());
  return parts;
}

function parseGradient(str) {
  if (!str || !isGradient(str)) return null;
  const type = detectFillType(str);
  const inner = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'));
  const parts = splitTopLevel(inner);
  let angle = 135, startIdx = 0;
  if (type === 'linear') {
    if (parts[0]?.endsWith('deg')) { angle = parseFloat(parts[0]); startIdx = 1; }
    else if (parts[0]?.startsWith('to ')) startIdx = 1;
  } else if (type === 'conic') {
    if (parts[0]?.startsWith('from ')) { angle = parseFloat(parts[0].slice(5)); startIdx = 1; }
  } else if (type === 'radial') {
    if (/^(circle|ellipse)/.test(parts[0] ?? '')) startIdx = 1;
  }
  const stops = [];
  const count = parts.length - startIdx;
  for (let i = startIdx; i < parts.length; i++) {
    const p = parts[i].trim();
    const m = p.match(/^(.*?)\s+([\d.]+)%?\s*$/);
    let colorStr = p, pos = null;
    if (m) { colorStr = m[1].trim(); pos = parseFloat(m[2]); }
    if (pos == null) pos = count <= 1 ? 0 : ((i - startIdx) / (count - 1)) * 100;
    stops.push({ id: i - startIdx, color: colorStr, pos: Math.round(pos) });
  }
  if (stops.length < 2) {
    return { type, angle, stops: [{ id: 0, color: '#ffffff', pos: 0 }, { id: 1, color: '#000000', pos: 100 }] };
  }
  return { type, angle, stops };
}

function buildGradient({ type, angle, stops }) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const parts = sorted.map(s => `${s.color} ${s.pos}%`).join(', ');
  if (type === 'radial') return `radial-gradient(circle, ${parts})`;
  if (type === 'conic')  return `conic-gradient(from ${Math.round(angle)}deg, ${parts})`;
  return `linear-gradient(${Math.round(angle)}deg, ${parts})`;
}

// ── Sat/Val square ────────────────────────────────────────────────────────────

function SatValSquare({ hue, sat, val, onSVChange }) {
  const canvasRef = useRef(null);
  const dragging = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(0, 0, w, h);
    const wg = ctx.createLinearGradient(0, 0, w, 0);
    wg.addColorStop(0, 'rgba(255,255,255,1)');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wg; ctx.fillRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  }, [hue]);

  const pick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    onSVChange({
      sat: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      val: clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1),
    });
  }, [onSVChange]);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    const mv = (e) => { if (dragging.current) pick(e); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [pick]);

  const { r, g, b } = hsvToRgb(hue, sat, val);
  return (
    <div
      style={{ position: 'relative', borderRadius: '8px 8px 0 0', overflow: 'hidden', cursor: 'crosshair', userSelect: 'none' }}
      onMouseDown={e => { dragging.current = true; pick(e); }}
    >
      <canvas ref={canvasRef} width={304} height={180} style={{ display: 'block', width: '100%', height: 180 }} />
      <div style={{
        position: 'absolute', left: `${sat * 100}%`, top: `${(1 - val) * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: 13, height: 13, borderRadius: '50%',
        border: '2px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
        background: `rgb(${r},${g},${b})`, pointerEvents: 'none',
      }} />
    </div>
  );
}

// ── Track slider ──────────────────────────────────────────────────────────────

function TrackSlider({ value, onChange, trackBg, thumbBg }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const pick = useCallback((e) => {
    const rect = ref.current.getBoundingClientRect();
    onChange(clamp((e.clientX - rect.left) / rect.width, 0, 1));
  }, [onChange]);
  useEffect(() => {
    const up = () => { dragging.current = false; };
    const mv = (e) => { if (dragging.current) pick(e); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [pick]);
  return (
    <div
      ref={ref}
      onMouseDown={e => { dragging.current = true; pick(e); }}
      style={{ position: 'relative', height: 14, borderRadius: 7, cursor: 'pointer', userSelect: 'none', ...trackBg }}
    >
      <div style={{
        position: 'absolute', left: `${value * 100}%`, top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 16, height: 16, borderRadius: '50%',
        background: thumbBg, border: '2px solid white',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)', pointerEvents: 'none',
      }} />
    </div>
  );
}

// ── Gradient editor ───────────────────────────────────────────────────────────

function GradientEditor({ type, angle, stops, onTypeChange, onAngleChange, onStopsChange, activeStopIdx, onActiveStopChange }) {
  const barRef = useRef(null);
  const gradCss = buildGradient({ type, angle, stops });

  const handleBarClick = useCallback((e) => {
    if (e.target !== barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pos = Math.round(clamp((e.clientX - rect.left) / rect.width * 100, 0, 100));
    const newStop = { id: Date.now(), color: '#888888', pos };
    const newStops = [...stops, newStop].sort((a, b) => a.pos - b.pos);
    onStopsChange(newStops);
    onActiveStopChange(newStops.findIndex(s => s.id === newStop.id));
  }, [stops, onStopsChange, onActiveStopChange]);

  return (
    <div style={{ padding: '0 12px 4px' }}>
      {/* Type + angle row */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, alignItems: 'center' }}>
        {['linear', 'radial', 'conic'].map(t => (
          <IconButton
            key={t}
            icon={t === 'linear' ? FILL_TYPES[1].icon : t === 'radial' ? FILL_TYPES[2].icon : FILL_TYPES[3].icon}
            title={`${t} gradient`}
            active={type === t}
            onClick={() => onTypeChange(t)}
            style={{ flex: 1 }}
          />
        ))}
        {(type === 'linear' || type === 'conic') && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="number" min={0} max={360}
              value={Math.round(angle)}
              onChange={e => onAngleChange(+e.target.value)}
              className="fb-fill-input"
              style={{ width: 52, textAlign: 'center', fontSize: 11 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>°</span>
          </div>
        )}
      </div>
      {/* Gradient preview bar */}
      <div ref={barRef} onClick={handleBarClick} style={{
        height: 24, borderRadius: 12, background: gradCss,
        position: 'relative', marginBottom: 8, cursor: 'crosshair',
        border: '1px solid var(--border)',
      }}>
        {stops.map((stop, i) => (
          <div
            key={stop.id}
            onMouseDown={e => {
              e.stopPropagation();
              onActiveStopChange(i);
              const startX = e.clientX, startPos = stop.pos;
              const barW = barRef.current.getBoundingClientRect().width;
              const mv = me => {
                const newPos = clamp(Math.round(startPos + (me.clientX - startX) / barW * 100), 0, 100);
                onStopsChange(stops.map((s, j) => j === i ? { ...s, pos: newPos } : s));
              };
              const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
              window.addEventListener('mousemove', mv);
              window.addEventListener('mouseup', up);
            }}
            style={{
              position: 'absolute', top: '50%', left: `${stop.pos}%`,
              transform: 'translate(-50%, -50%)',
              width: 16, height: 16, borderRadius: '50%',
              background: stop.color,
              border: i === activeStopIdx ? '2.5px solid var(--accent-light)' : '2px solid white',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
              cursor: 'ew-resize', zIndex: i === activeStopIdx ? 2 : 1,
            }}
          />
        ))}
      </div>
      {/* Stops list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
        {stops.map((stop, i) => (
          <div
            key={stop.id}
            onClick={() => onActiveStopChange(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
              borderRadius: 6, background: i === activeStopIdx ? 'var(--bg-input)' : 'transparent', cursor: 'pointer',
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 3, background: stop.color, border: '1px solid var(--border)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.color}</span>
            <input
              type="number" min={0} max={100} value={stop.pos}
              onClick={e => e.stopPropagation()}
              onChange={e => onStopsChange(stops.map((s, j) => j === i ? { ...s, pos: clamp(+e.target.value, 0, 100) } : s))}
              className="fb-fill-input"
              style={{ width: 44, textAlign: 'right', fontSize: 11 }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>%</span>
            {stops.length > 2 && (
              <IconButton
                icon={UIIcons.close}
                title="Remove stop"
                onClick={e => {
                  e.stopPropagation();
                  onStopsChange(stops.filter((_, j) => j !== i));
                  onActiveStopChange(Math.max(0, i - 1));
                }}
              />
            )}
          </div>
        ))}
        <IconButton
          icon={UIIcons.plus}
          title="Add gradient stop"
          className="fb-fill-icon-wide"
          onClick={() => {
            const s2 = [...stops, { id: Date.now(), color: '#cccccc', pos: 50 }].sort((a, b) => a.pos - b.pos);
            onStopsChange(s2);
          }}
        />
      </div>
      <div style={{ height: 1, background: 'var(--border)', marginBottom: 8 }} />
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
        Stop {activeStopIdx + 1} color
      </div>
    </div>
  );
}

// ── Fill type SVG icons ───────────────────────────────────────────────────────

const FILL_TYPES = [
  {
    type: 'solid', label: 'Solid',
    icon: <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.5" fill="white" opacity="0.9"/></svg>,
  },
  {
    type: 'linear', label: 'Linear gradient',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18">
        <defs><linearGradient id="fp-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="white"/><stop offset="100%" stopColor="white" stopOpacity="0.1"/></linearGradient></defs>
        <circle cx="9" cy="9" r="7.5" fill="url(#fp-lg)"/>
      </svg>
    ),
  },
  {
    type: 'radial', label: 'Radial gradient',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18">
        <defs><radialGradient id="fp-rg" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white"/><stop offset="100%" stopColor="white" stopOpacity="0.05"/></radialGradient></defs>
        <circle cx="9" cy="9" r="7.5" fill="url(#fp-rg)"/>
      </svg>
    ),
  },
  {
    type: 'conic', label: 'Conic gradient',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18">
        <defs><linearGradient id="fp-cg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="white" stopOpacity="0.1"/><stop offset="50%" stopColor="white"/><stop offset="100%" stopColor="white" stopOpacity="0.1"/></linearGradient></defs>
        <circle cx="9" cy="9" r="7.5" fill="url(#fp-cg)"/>
      </svg>
    ),
  },
];

// ── Main FillPicker ───────────────────────────────────────────────────────────

export default function FillPicker({ value, onChange }) {
  const [open, setOpen]         = useState(false);
  const triggerRef              = useRef(null);
  const popoverRef              = useRef(null);
  const [pos, setPos]           = useState({ top: 0, left: 0 });

  const colorStyles    = useEditorStore(s => s.colorStyles);
  const loadColorStyles = useEditorStore(s => s.loadColorStyles);
  const saveColorStyles = useEditorStore(s => s.saveColorStyles);

  // Internal HSV + alpha state
  const [h, setH]       = useState(0);
  const [sat, setSat]   = useState(0);
  const [val, setVal]   = useState(1);
  const [alpha, setAlpha] = useState(1);

  // Gradient state
  const [fillType, setFillType] = useState('solid');
  const [gradType, setGradType] = useState('linear');
  const [gradAngle, setGradAngle] = useState(135);
  const [gradStops, setGradStops] = useState([
    { id: 0, color: '#ffffff', pos: 0 },
    { id: 1, color: '#000000', pos: 100 },
  ]);
  const [activeStop, setActiveStop] = useState(0);

  // Color styles state
  const [styleSearch, setStyleSearch]   = useState('');
  const [addingStyle, setAddingStyle]   = useState(false);
  const [newStyleName, setNewStyleName] = useState('');

  // Parse incoming value into internal state on open
  useEffect(() => {
    if (!open) return;
    const v = value ?? '#ffffff';
    const ft = detectFillType(v);
    setFillType(ft);
    if (ft === 'solid') {
      const { r, g, b, a } = parseColor(v);
      const hsv = rgbToHsv(r, g, b);
      setH(hsv.h); setSat(hsv.s); setVal(hsv.v); setAlpha(a);
    } else {
      const grad = parseGradient(v);
      if (grad) {
        setGradType(grad.type);
        setGradAngle(grad.angle);
        setGradStops(grad.stops.map((s, i) => ({ ...s, id: i })));
        setActiveStop(0);
        const { r, g, b, a } = parseColor(grad.stops[0]?.color ?? '#ffffff');
        const hsv = rgbToHsv(r, g, b);
        setH(hsv.h); setSat(hsv.s); setVal(hsv.v); setAlpha(a);
      }
    }
    loadColorStyles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Current solid color string
  const { r, g, b } = hsvToRgb(h, sat, val);
  const currentColorStr = colorToStr(r, g, b, alpha);

  // When color picker changes, update fill value
  const handleColorChange = useCallback((newH, newSat, newVal, newAlpha) => {
    setH(newH); setSat(newSat); setVal(newVal); setAlpha(newAlpha);
    const rgb = hsvToRgb(newH, newSat, newVal);
    const cs = colorToStr(rgb.r, rgb.g, rgb.b, newAlpha);
    if (fillType === 'solid') {
      onChange(cs);
    } else {
      setGradStops(prev => {
        const updated = prev.map((s, i) => i === activeStop ? { ...s, color: cs } : s);
        onChange(buildGradient({ type: gradType, angle: gradAngle, stops: updated }));
        return updated;
      });
    }
  }, [fillType, gradType, gradAngle, activeStop, onChange]);

  const handleSVChange = useCallback(({ sat: ns, val: nv }) => {
    handleColorChange(h, ns, nv, alpha);
  }, [h, alpha, handleColorChange]);

  const handleHChange = useCallback((newH) => {
    handleColorChange(newH, sat, val, alpha);
  }, [sat, val, alpha, handleColorChange]);

  const handleAChange = useCallback((newA) => {
    handleColorChange(h, sat, val, newA);
  }, [h, sat, val, handleColorChange]);

  // HEX input: commit on blur/enter
  const [hexInput, setHexInput] = useState('');
  const [hexFocus, setHexFocus] = useState(false);
  const derivedHex = rgbToHex({ r, g, b }).toUpperCase().replace('#', '');
  useEffect(() => { if (!hexFocus) setHexInput(derivedHex); }, [derivedHex, hexFocus]);

  const commitHex = (raw) => {
    const hex = raw.startsWith('#') ? raw : '#' + raw;
    const rgb2 = hexToRgb(hex);
    const hsv = rgbToHsv(rgb2.r, rgb2.g, rgb2.b);
    handleColorChange(hsv.h, hsv.s, hsv.v, alpha);
  };

  // Fill type switch
  const handleFillTypeChange = (ft) => {
    setFillType(ft);
    if (ft === 'solid') {
      onChange(currentColorStr);
    } else {
      setGradType(ft);
      onChange(buildGradient({ type: ft, angle: gradAngle, stops: gradStops }));
    }
  };

  const handleGradTypeChange = (t) => {
    setGradType(t); setFillType(t);
    onChange(buildGradient({ type: t, angle: gradAngle, stops: gradStops }));
  };
  const handleAngleChange = (a) => {
    setGradAngle(a);
    onChange(buildGradient({ type: gradType, angle: a, stops: gradStops }));
  };
  const handleStopsChange = (ns) => {
    setGradStops(ns);
    onChange(buildGradient({ type: gradType, angle: gradAngle, stops: ns }));
  };
  const handleActiveStopChange = (idx) => {
    setActiveStop(idx);
    const stop = gradStops[idx];
    if (stop) {
      const { r: rr, g: gg, b: bb, a } = parseColor(stop.color);
      const hsv = rgbToHsv(rr, gg, bb);
      setH(hsv.h); setSat(hsv.s); setVal(hsv.v); setAlpha(a);
    }
  };

  // Eyedropper
  const handleEyedrop = async () => {
    if (typeof EyeDropper === 'undefined') return;
    try {
      const result = await new EyeDropper().open();
      const rgb2 = hexToRgb(result.sRGBHex);
      const hsv = rgbToHsv(rgb2.r, rgb2.g, rgb2.b);
      handleColorChange(hsv.h, hsv.s, hsv.v, alpha);
    } catch (_) {}
  };

  // Popover positioning
  const openPicker = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const W = 308;
    const left = rect.left - W - 10;
    setPos({ top: Math.max(8, Math.min(rect.top, window.innerHeight - 600)), left: Math.max(8, left) });
    setOpen(true);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  // Color styles
  const filteredStyles = colorStyles.filter(cs =>
    cs.name.toLowerCase().includes(styleSearch.toLowerCase())
  );
  const saveNewStyle = () => {
    if (!newStyleName.trim()) return;
    const ns = { id: Date.now().toString(), name: newStyleName.trim(), value: value ?? '#ffffff' };
    saveColorStyles([...colorStyles, ns]);
    setNewStyleName(''); setAddingStyle(false);
  };

  const alphaPercent = Math.round(alpha * 100);

  return (
    <>
      {/* Trigger swatch — full width, shows gradient/solid preview */}
      <div
        ref={triggerRef}
        className="fb-fill-swatch"
        onClick={openPicker}
        title="Edit fill"
        style={{ background: value && value !== 'transparent' ? value : undefined }}
      >
        {(!value || value === 'transparent') && <div className="fb-fill-swatch__none" />}
      </div>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fb-fill-popover"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="fb-fill-popover__header">
            <span>Fill</span>
            <IconButton icon={UIIcons.close} title="Close fill picker" onClick={() => setOpen(false)} className="fb-fill-close" />
          </div>

          {/* Fill type icons */}
          <div className="fb-fill-typebar">
            {FILL_TYPES.map(({ type: t, label, icon }) => (
              <button
                key={t}
                title={label}
                onClick={() => handleFillTypeChange(t)}
                className={`fb-fill-typeicon${fillType === t ? ' fb-fill-typeicon--active' : ''}`}
              >{icon}</button>
            ))}
          </div>

          {/* Gradient controls (shown above color picker when gradient type) */}
          {fillType !== 'solid' && (
            <GradientEditor
              type={gradType} angle={gradAngle} stops={gradStops}
              onTypeChange={handleGradTypeChange}
              onAngleChange={handleAngleChange}
              onStopsChange={handleStopsChange}
              activeStopIdx={activeStop}
              onActiveStopChange={handleActiveStopChange}
            />
          )}

          {/* Color picker square */}
          <SatValSquare hue={h} sat={sat} val={val} onSVChange={handleSVChange} />

          {/* Sliders + inputs */}
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Hue slider */}
            <TrackSlider
              value={h / 360}
              onChange={v => handleHChange(v * 360)}
              trackBg={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
              thumbBg={`hsl(${h}, 100%, 50%)`}
            />
            {/* Opacity slider */}
            <TrackSlider
              value={alpha}
              onChange={handleAChange}
              trackBg={{
                background: `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b})), repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 10px 10px`,
              }}
              thumbBg={`rgba(${r},${g},${b},${alpha})`}
            />
            {/* HEX + opacity inputs */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="fb-fill-input"
                style={{ flex: 1, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                value={hexFocus ? hexInput : derivedHex}
                onChange={e => setHexInput(e.target.value)}
                onFocus={() => { setHexFocus(true); setHexInput(derivedHex); }}
                onBlur={() => { setHexFocus(false); commitHex(hexInput); }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                maxLength={7}
              />
              <input
                className="fb-fill-input"
                style={{ width: 64 }}
                type="number" min={0} max={100}
                value={alphaPercent}
                onChange={e => handleAChange(clamp(+e.target.value, 0, 100) / 100)}
              />
            </div>
            {/* Format selector + eyedropper */}
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="fb-fill-input" style={{ flex: 1 }}>
                <option value="hex">HEX</option>
                <option value="rgb">RGB</option>
                <option value="hsl">HSL</option>
              </select>
              <button
                className="fb-fill-eyedrop"
                onClick={handleEyedrop}
                title="Pick from screen"
                style={{ opacity: typeof EyeDropper !== 'undefined' ? 1 : 0.35 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 20l4-4L17 5l2 2L8 18l-6 6z"/>
                  <path d="M17 3l4 4-2 2-4-4z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border)', margin: '0 0 10px' }} />

          {/* Color styles library */}
          <div style={{ padding: '0 12px' }}>
            <div className="fb-fill-search-row">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                className="fb-fill-search"
                placeholder="Search..."
                value={styleSearch}
                onChange={e => setStyleSearch(e.target.value)}
              />
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 0 2px' }} />

          <div className="fb-fill-styles-list">
            {filteredStyles.length === 0 && styleSearch && (
              <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11 }}>No results</div>
            )}
            {filteredStyles.length === 0 && !styleSearch && colorStyles.length === 0 && (
              <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11 }}>No styles yet</div>
            )}
            {filteredStyles.map(cs => (
              <div
                key={cs.id}
                className="fb-fill-style-item"
                onClick={() => { onChange(cs.value); setOpen(false); }}
              >
                <div className="fb-fill-style-swatch" style={{ background: cs.value }} />
                <span style={{ flex: 1 }}>{cs.name}</span>
                <IconButton
                  icon={UIIcons.close}
                  className="fb-fill-style-del"
                  title="Remove style"
                  onClick={e => { e.stopPropagation(); saveColorStyles(colorStyles.filter(c => c.id !== cs.id)); }}
                />
              </div>
            ))}
          </div>

          {/* New Style */}
          <div style={{ padding: '8px 12px 12px' }}>
            {addingStyle ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  autoFocus
                  className="fb-fill-input"
                  placeholder="Style name"
                  value={newStyleName}
                  onChange={e => setNewStyleName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveNewStyle(); if (e.key === 'Escape') setAddingStyle(false); }}
                  style={{ flex: 1 }}
                />
                <IconButton icon={UIIcons.check} title="Save style" onClick={saveNewStyle} className="fb-fill-btn-save" />
                <IconButton icon={UIIcons.close} title="Cancel" onClick={() => setAddingStyle(false)} className="fb-fill-btn-cancel" />
              </div>
            ) : (
              <IconButton icon={UIIcons.plus} title="New color style" onClick={() => setAddingStyle(true)} className="fb-fill-new-style" />
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
