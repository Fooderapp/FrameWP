import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterPackIcons, getManifestPack, ICON_PACK_MANIFEST, loadIconPack } from './iconCatalog';
import { getPackRenderProps } from './iconPacks/shared';
import { IconButton, UIIcons } from './UIIcons';

export default function IconLibraryModal({ onSelect, onClose, isTargetMissing = false }) {
  const [loadedPacks, setLoadedPacks] = useState({});
  const [packErrors, setPackErrors] = useState({});
  const [activePackId, setActivePackId] = useState('material');
  const [search, setSearch] = useState('');
  const [portalReady, setPortalReady] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const searchInputRef = useRef(null);

  useEffect(() => {
    setPortalReady(true);
    const rafId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    loadIconPack(activePackId)
      .then((pack) => {
        if (cancelled || !pack) return;
        setLoadedPacks((current) => (current[pack.id] ? current : { ...current, [pack.id]: pack }));
        setPackErrors((current) => {
          if (!current[pack.id]) return current;
          const next = { ...current };
          delete next[pack.id];
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPackErrors((current) => ({
          ...current,
          [activePackId]: error?.message || 'Failed to load icon pack.',
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [activePackId]);

  useEffect(() => {
    const preloadIds = ICON_PACK_MANIFEST.filter((pack) => pack.id !== activePackId).map((pack) => pack.id);
    const timer = window.setTimeout(() => {
      preloadIds.forEach((packId) => {
        loadIconPack(packId)
          .then((pack) => {
            setLoadedPacks((current) => (current[pack.id] ? current : { ...current, [pack.id]: pack }));
          })
          .catch(() => {});
      });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [activePackId]);

  const packMeta = useMemo(() => getManifestPack(activePackId), [activePackId]);
  const activePack = loadedPacks[activePackId] ?? null;
  const activeError = packErrors[activePackId] || '';

  const visibleIcons = useMemo(
    () => (activePack ? filterPackIcons(activePack, deferredSearch) : []),
    [activePack, deferredSearch],
  );
  const visibleIconCards = useMemo(
    () => visibleIcons.map((icon) => ({
      ...icon,
      previewMarkup: activePack ? activePack.getIconMarkup(icon.Component) : '',
    })),
    [activePack, visibleIcons],
  );
  const handleSelect = (icon) => {
    if (!activePack) return;
    onSelect({ ...icon, markup: icon.previewMarkup || activePack.getIconMarkup(icon.Component) });
  };

  const modal = (
    <div className="fb-icon-browser">
      <div className="fb-icon-browser__panel fb-icon-browser__panel--minimal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fb-icon-browser__topbar">
          <div className="fb-icon-browser__search-wrap">
            <input
              ref={searchInputRef}
              className="fb-prop-input fb-icon-browser__search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${packMeta?.label || 'icons'}...`}
            />
          </div>
          <IconButton icon={UIIcons.close} title="Close icon library" onClick={onClose} />
        </div>

        <div className="fb-icon-browser__tabs" role="tablist" aria-label="Icon libraries">
          {ICON_PACK_MANIFEST.map((pack) => {
            const isActive = pack.id === activePackId;
            const loaded = loadedPacks[pack.id];
            return (
              <button
                key={pack.id}
                type="button"
                className={`fb-icon-browser__tab${isActive ? ' is-active' : ''}`}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActivePackId(pack.id)}
              >
                <span>{pack.label}</span>
                <span>{loaded ? loaded.icons.length : '...'}</span>
              </button>
            );
          })}
        </div>

        <div className="fb-icon-browser__results">
          {isTargetMissing ? <div className="fb-artboard-bp-note">The original icon target is no longer available. Re-select an icon element and reopen the library.</div> : null}
          {!activePack && !activeError ? <div className="fb-artboard-bp-note">Loading {packMeta?.label || 'icon'} library...</div> : null}
          {activeError ? <div className="fb-artboard-bp-note">{activeError}</div> : null}
          {activePack && !isTargetMissing ? (
            <div className="fb-icon-browser__grid">
              {visibleIconCards.map((icon) => (
                <button
                  key={icon.value}
                  type="button"
                  className="fb-icon-browser__icon-card"
                  title={icon.label}
                  onClick={() => handleSelect(icon)}
                >
                  <div className="fb-icon-browser__icon-glyph">
                    <icon.Component {...getPackRenderProps(activePack.id, 24)} />
                  </div>
                  <div className="fb-icon-browser__icon-name">{icon.label}</div>
                </button>
              ))}
            </div>
          ) : null}
          {activePack && !isTargetMissing && !visibleIconCards.length ? <div className="fb-artboard-bp-note">No icons matched that search.</div> : null}
        </div>
      </div>
    </div>
  );

  if (!portalReady || typeof document === 'undefined' || !document.body) return null;
  return createPortal(modal, document.body);
}