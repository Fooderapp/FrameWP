import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ensureGoogleFontLoaded, familyToFontStack, getCachedGoogleFontsCatalog, getGoogleFontsCatalog } from './googleFonts';
import { UIIcons } from './UIIcons';

const PREVIEW_TEXT = 'Hamburgefontsiv 123'; 

function eventHitsNode(event, node) {
  if (!node) return false;
  if (node.contains(event.target)) return true;
  if (typeof event.composedPath === 'function') {
    return event.composedPath().includes(node);
  }
  return false;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPickerFamily(value) {
  return value || 'Inter';
}

export default function GoogleFontPicker({
  value,
  onChange,
  onPreviewChange,
  onPreviewReset,
  onOpenChange,
  previewText = PREVIEW_TEXT,
  preserveFocus = false,
  showSearch = true,
  showPreviewSample = false,
  portal = false,
  placement = 'bottom-start',
  offset = 8,
  minPopoverWidth = 220,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [families, setFamilies] = useState(() => getCachedGoogleFontsCatalog());
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [popoverStyle, setPopoverStyle] = useState(null);

  const handlePointerMouseDown = (event) => {
    if (!preserveFocus) return;
    event.preventDefault();
  };

  const handlePointerDown = (event) => {
    if (!preserveFocus) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePopoverPointerDown = (event) => {
    const interactiveInput = event.target?.closest('input, textarea, [contenteditable="true"]');
    if (!interactiveInput) {
      event.preventDefault();
    }
    event.stopPropagation();
  };

  const handlePopoverMouseDown = (event) => {
    event.stopPropagation();
  };

  useEffect(() => {
    ensureGoogleFontLoaded(value || 'Inter', { text: previewText });
  }, [value, previewText]);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    getGoogleFontsCatalog()
      .then((nextFamilies) => setFamilies(nextFamilies))
      .finally(() => setLoading(false));
    return undefined;
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !portal) return undefined;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popoverHeight = popoverRef.current?.offsetHeight ?? 340;
      const width = clamp(Math.max(rect.width, minPopoverWidth), 180, window.innerWidth - 24);
      const left = clamp(rect.left, 12, Math.max(12, window.innerWidth - width - 12));
      const nextTop = placement === 'bottom-start' && rect.bottom + offset + popoverHeight <= window.innerHeight - 12
        ? rect.bottom + offset
        : Math.max(12, rect.top - popoverHeight - offset);
      setPopoverStyle((current) => {
        const next = {
          position: 'fixed',
          top: nextTop,
          left,
          width,
          right: 'auto',
          zIndex: 120500,
        };
        if (
          current
          && current.top === next.top
          && current.left === next.left
          && current.width === next.width
        ) return current;
        return next;
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [minPopoverWidth, offset, open, placement, portal]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (eventHitsNode(event, rootRef.current) || eventHitsNode(event, popoverRef.current)) return;
      setOpen(false);
      onOpenChange?.(false);
    };
    if (typeof window.PointerEvent === 'function') {
      window.addEventListener('pointerdown', handlePointerDown);
      return () => window.removeEventListener('pointerdown', handlePointerDown);
    }
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (open) return undefined;
    setQuery('');
    onOpenChange?.(false);
    onPreviewReset?.();
    return undefined;
  }, [onOpenChange, onPreviewReset, open]);

  const filteredFamilies = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return families;
    return families.filter((family) => family.toLowerCase().includes(term));
  }, [families, query]);

  const previewFamily = (family) => {
    ensureGoogleFontLoaded(family, { text: previewText });
    onPreviewChange?.(family);
  };

  const popoverContent = open ? (
    <div ref={popoverRef} className="fb-font-picker__popover" data-inline-editor-ui="true" style={portal ? popoverStyle ?? undefined : undefined} onPointerDown={handlePopoverPointerDown} onMouseDown={handlePopoverMouseDown}>
      {showSearch ? (
        <input
          className="fb-prop-input fb-font-picker__search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Google Fonts"
          autoFocus={!preserveFocus}
        />
      ) : null}
      <div className="fb-font-picker__results" onMouseLeave={() => onPreviewReset?.()}>
        {loading && <div className="fb-font-picker__status">Loading fonts...</div>}
        {!loading && filteredFamilies.length === 0 && <div className="fb-font-picker__status">No fonts found</div>}
        {!loading && filteredFamilies.map((family) => (
          <button
            key={family}
            type="button"
            className={`fb-font-picker__option${family === value ? ' fb-font-picker__option--active' : ''}`}
            onPointerDown={handlePointerDown}
            onMouseDown={handlePointerMouseDown}
            onClick={() => {
              ensureGoogleFontLoaded(family, { text: previewText });
              onChange(family);
              setOpen(false);
            }}
            onMouseEnter={() => previewFamily(family)}
            onFocus={() => previewFamily(family)}
          >
            <span className="fb-font-picker__option-main" style={{ fontFamily: familyToFontStack(family) }}>
              {family}
            </span>
            {showPreviewSample ? (
              <span className="fb-font-picker__option-sample" style={{ fontFamily: familyToFontStack(family) }}>
                {previewText}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="fb-font-picker" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="fb-font-picker__trigger"
        onPointerDown={handlePointerDown}
        onMouseDown={handlePointerMouseDown}
        onClick={() => setOpen((current) => {
          const next = !current;
          onOpenChange?.(next);
          return next;
        })}
      >
        <span
          className="fb-font-picker__trigger-label"
          style={{ fontFamily: familyToFontStack(getPickerFamily(value)) }}
        >
          {getPickerFamily(value)}
        </span>
        <span className="fb-font-picker__trigger-caret">{UIIcons.chevronDown}</span>
      </button>
      {portal ? (popoverContent ? createPortal(popoverContent, document.body) : null) : popoverContent}
    </div>
  );
}
