import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  filterPackIcons,
  getCachedIconPreviewMarkup,
  getManifestPack,
  ICON_PACK_MANIFEST,
  loadIconPack,
  setCachedIconPreviewMarkup,
} from './iconCatalog';
import { IconButton, UIIcons } from './UIIcons';

const MAX_VISIBLE_ICONS = 160;
const PREVIEW_BATCH_SIZE = 24;
const SYNC_PREVIEW_BATCH_SIZE = 48;

export default function IconLibraryModal({ onSelect, onClose, isTargetMissing = false }) {
  const [loadedPacks, setLoadedPacks] = useState({});
  const [packErrors, setPackErrors] = useState({});
  const [activePackId, setActivePackId] = useState('material');
  const [search, setSearch] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [previewMarkup, setPreviewMarkup] = useState({});
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
    setSelectionError('');

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
    () => (activePack ? filterPackIcons(activePack, deferredSearch, MAX_VISIBLE_ICONS) : []),
    [activePack, deferredSearch],
  );

  const seededPreviewMarkup = useMemo(() => {
    if (!activePack || !visibleIcons.length) return {};

    return Object.fromEntries(
      visibleIcons.slice(0, SYNC_PREVIEW_BATCH_SIZE).map((icon) => {
        const cachedMarkup = getCachedIconPreviewMarkup(activePack.id, icon.value);
        const markup = cachedMarkup || setCachedIconPreviewMarkup(activePack.id, icon.value, activePack.getIconMarkup(icon.Component) || '');
        return [icon.value, markup];
      }),
    );
  }, [activePack, visibleIcons]);

  useEffect(() => {
    if (!Object.keys(seededPreviewMarkup).length) return;
    setPreviewMarkup((current) => ({ ...seededPreviewMarkup, ...current }));
  }, [seededPreviewMarkup]);

  useEffect(() => {
    if (!activePack || !visibleIcons.length) return undefined;

    const missingIcons = visibleIcons.filter((icon) => !(previewMarkup[icon.value] || seededPreviewMarkup[icon.value]));
    if (!missingIcons.length) return undefined;

    let cancelled = false;

    const warmBatch = (startIndex) => {
      if (cancelled) return;
      const batch = missingIcons.slice(startIndex, startIndex + PREVIEW_BATCH_SIZE);
      if (!batch.length) return;

      const nextEntries = {};
      batch.forEach((icon) => {
        const cachedMarkup = getCachedIconPreviewMarkup(activePack.id, icon.value);
        nextEntries[icon.value] = cachedMarkup || setCachedIconPreviewMarkup(activePack.id, icon.value, activePack.getIconMarkup(icon.Component) || '');
      });

      setPreviewMarkup((current) => ({ ...current, ...nextEntries }));

      if (startIndex + PREVIEW_BATCH_SIZE < missingIcons.length) {
        window.setTimeout(() => warmBatch(startIndex + PREVIEW_BATCH_SIZE), 0);
      }
    };

    warmBatch(0);

    return () => {
      cancelled = true;
    };
  }, [activePack, previewMarkup, seededPreviewMarkup, visibleIcons]);

  const handleSelect = (icon) => {
    if (!activePack) return;
    const markup = previewMarkup[icon.value]
      || seededPreviewMarkup[icon.value]
      || getCachedIconPreviewMarkup(activePack.id, icon.value)
      || setCachedIconPreviewMarkup(activePack.id, icon.value, activePack.getIconMarkup(icon.Component) || '');
    if (!markup) {
      setSelectionError('This icon could not be rendered. Please choose a different icon.');
      return;
    }
    setSelectionError('');
    onSelect({ ...icon, markup });
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
          {selectionError ? <div className="fb-artboard-bp-note">{selectionError}</div> : null}
          {activePack && !isTargetMissing ? (
            <div className="fb-icon-browser__grid">
              {visibleIcons.map((icon) => {
                const iconMarkup = previewMarkup[icon.value] || seededPreviewMarkup[icon.value] || '';
                const isReady = !!iconMarkup;

                return (
                  <button
                    key={icon.value}
                    type="button"
                    className="fb-icon-browser__icon-card"
                    title={icon.label}
                    disabled={!isReady}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleSelect(icon);
                    }}
                  >
                    <div className="fb-icon-browser__icon-glyph">
                      {isReady ? (
                        <div dangerouslySetInnerHTML={{ __html: iconMarkup }} />
                      ) : (
                        <div className="fb-icon-browser__icon-placeholder" aria-hidden="true" />
                      )}
                    </div>
                    <div className="fb-icon-browser__icon-name">{icon.label}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {activePack && !isTargetMissing && !visibleIcons.length ? <div className="fb-artboard-bp-note">No icons matched that search.</div> : null}
        </div>
      </div>
    </div>
  );

  if (!portalReady || typeof document === 'undefined' || !document.body) return null;
  return createPortal(modal, document.body);
}