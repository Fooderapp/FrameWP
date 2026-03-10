import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ensureGoogleFontLoaded, familyToFontStack, getCachedGoogleFontsCatalog, getGoogleFontsCatalog } from './googleFonts';
import { UIIcons } from './UIIcons';

const PREVIEW_TEXT = 'Hamburgefontsiv 123';

export default function GoogleFontPicker({ value, onChange, previewText = PREVIEW_TEXT }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [families, setFamilies] = useState(() => getCachedGoogleFontsCatalog());
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);

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

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const filteredFamilies = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return families;
    return families.filter((family) => family.toLowerCase().includes(term));
  }, [families, query]);

  return (
    <div className="fb-font-picker" ref={rootRef}>
      <button
        type="button"
        className="fb-font-picker__trigger"
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="fb-font-picker__trigger-label"
          style={{ fontFamily: familyToFontStack(value || 'Inter') }}
        >
          {value || 'Inter'}
        </span>
        <span className="fb-font-picker__trigger-caret">{UIIcons.chevronDown}</span>
      </button>
      {open && (
        <div className="fb-font-picker__popover">
          <input
            className="fb-prop-input fb-font-picker__search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Google Fonts"
            autoFocus
          />
          <div className="fb-font-picker__results">
            {loading && <div className="fb-font-picker__status">Loading fonts...</div>}
            {!loading && filteredFamilies.length === 0 && <div className="fb-font-picker__status">No fonts found</div>}
            {!loading && filteredFamilies.map((family) => (
              <button
                key={family}
                type="button"
                className={`fb-font-picker__option${family === value ? ' fb-font-picker__option--active' : ''}`}
                onMouseEnter={() => ensureGoogleFontLoaded(family, { text: previewText })}
                onFocus={() => ensureGoogleFontLoaded(family, { text: previewText })}
                onClick={() => {
                  ensureGoogleFontLoaded(family, { text: previewText });
                  onChange(family);
                  setOpen(false);
                }}
              >
                <span className="fb-font-picker__preview" style={{ fontFamily: familyToFontStack(family) }}>
                  {family}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
