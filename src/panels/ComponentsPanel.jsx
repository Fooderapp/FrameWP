import React, { useMemo, useState } from 'react';
import { ASSET_STORAGE_COMPONENT_ID, isAssetStorageComponentId, resolveElementWithVariables, useEditorStore } from '../store/editorStore';
import { canAssetApplyToElement, createAssetDragPayload, FB_ASSET_PAYLOAD_FALLBACK, FB_ASSET_PAYLOAD_MIME, getAssetStyleUpdatesForElement } from '../store/assetStyles';
import { IconButton, UIIcons } from '../components/UIIcons';

const TEXT_STYLE_KEYS = [
  'color', 'fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'fontSizeUnit',
  'lineHeight', 'lineHeightUnit', 'letterSpacing', 'letterSpacingUnit', 'textAlign',
  'textTransform', 'textDecoration',
];

function pickStyleProps(source = {}, keys = []) {
  return keys.reduce((acc, key) => {
    if (source?.[key] != null && source[key] !== '') acc[key] = source[key];
    return acc;
  }, {});
}

function buildTextStyleEntry(element, resolved) {
  const styleProps = pickStyleProps(resolved?.styles ?? {}, TEXT_STYLE_KEYS);
  return {
    id: `txt-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${element?.name || element?.type || 'Text'} Text`,
    type: 'text',
    source: 'builder',
    sourceId: element?.id || '',
    styleProps,
  };
}

function buildElementStyleEntry(element, resolved) {
  return {
    id: `el-style-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${element?.name || element?.type || 'Element'} Style`,
    type: element?.type || 'element',
    source: 'builder',
    sourceId: element?.id || '',
    styleProps: { ...(resolved?.styles ?? {}) },
  };
}

function hasSameStyle(existing, candidate) {
  return `${existing?.name || ''}`.trim().toLowerCase() === `${candidate?.name || ''}`.trim().toLowerCase()
    && JSON.stringify(existing?.styleProps ?? existing?.value ?? null) === JSON.stringify(candidate?.styleProps ?? candidate?.value ?? null);
}

function RenameableAssetCard({
  title,
  subtitle,
  icon,
  onOpen,
  onDelete,
  onRename,
  draggable = false,
  onDragStart,
  children = null,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const commit = () => {
    setEditing(false);
    const nextValue = `${draft || ''}`.trim();
    if (!nextValue || nextValue === title) return;
    onRename?.(nextValue);
  };

  return (
    <div
      className="fb-asset-card"
      draggable={draggable}
      onDragStart={onDragStart}
      onDoubleClick={() => { if (!editing) onOpen?.(); }}
      onClick={draggable ? undefined : () => { if (!editing) onOpen?.(); }}
    >
      <div className="fb-asset-card__icon">{icon}</div>
      <div className="fb-asset-card__meta">
        {editing ? (
          <input
            className="fb-prop-input"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="fb-asset-card__title">{title}</div>
        )}
        <div className="fb-asset-card__sub">{subtitle}</div>
        {children}
      </div>
      <div className="fb-asset-card__actions">
        {onRename ? (
          <IconButton
            icon={UIIcons.text}
            title="Rename asset"
            className="fb-asset-card__delete-icon"
            onClick={(event) => {
              event.stopPropagation();
              setDraft(title);
              setEditing(true);
            }}
          />
        ) : null}
        {onDelete ? (
          <IconButton
            icon={UIIcons.trash}
            title="Delete asset"
            className="fb-asset-card__delete-icon"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function ComponentsPanel() {
  const components = useEditorStore(s => s.components);
  const selection = useEditorStore(s => s.selection);
  const currentPage = useEditorStore(s => s.getCurrentPage());
  const allElements = useEditorStore(s => s.getAllElements());
  const globalVariables = useEditorStore(s => s.globalVariables);
  const colorStyles = useEditorStore(s => s.colorStyles);
  const textStyles = useEditorStore(s => s.textStyles);
  const elementStyles = useEditorStore(s => s.elementStyles);
  const openComponentEditor = useEditorStore(s => s.openComponentEditor);
  const openAssetStorage = useEditorStore(s => s.openAssetStorage);
  const closeComponentEditor = useEditorStore(s => s.closeComponentEditor);
  const deleteComponent = useEditorStore(s => s.deleteComponent);
  const saveComponents = useEditorStore(s => s.saveComponents);
  const saveColorStyles = useEditorStore(s => s.saveColorStyles);
  const saveTextStyles = useEditorStore(s => s.saveTextStyles);
  const saveElementStyles = useEditorStore(s => s.saveElementStyles);
  const updateElementStyles = useEditorStore(s => s.updateElementStyles);
  const componentEditor = useEditorStore(s => s.componentEditor);
  const pushHistory = useEditorStore(s => s.pushHistory);

  const pageVariables = Array.isArray(currentPage?.variables) ? currentPage.variables : [];
  const selectedElement = selection?.elementId
    ? allElements.find((entry) => entry.id === selection.elementId) ?? null
    : null;
  const selectedResolved = selectedElement
    ? resolveElementWithVariables(selectedElement, selection?.bpId ?? 'desktop', pageVariables, globalVariables)
    : null;
  const visibleComponents = useMemo(
    () => (components ?? []).filter((component) => !isAssetStorageComponentId(component.id)),
    [components],
  );
  const fontFamilies = useMemo(() => {
    const seen = new Set();
    return (textStyles ?? [])
      .map((style) => style?.styleProps?.fontFamily)
      .filter((family) => typeof family === 'string' && family.trim())
      .map((family) => family.trim())
      .filter((family) => {
        const key = family.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [textStyles]);
  const isStorageOpen = componentEditor?.isOpen && componentEditor.componentId === ASSET_STORAGE_COMPONENT_ID;

  const handleDragStart = (e, component) => {
    e.dataTransfer.setData('fb-component-id', component.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleAssetDragStart = (event, assetType, asset) => {
    const payload = createAssetDragPayload(assetType, asset);
    if (!payload) return;
    event.dataTransfer.setData(FB_ASSET_PAYLOAD_MIME, payload);
    event.dataTransfer.setData(FB_ASSET_PAYLOAD_FALLBACK, payload);
    event.dataTransfer.setData('text/plain', payload);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const appendTextStyleFromSelection = () => {
    if (!selectedElement || selectedElement.type !== 'text' || !selectedResolved) return;
    const nextStyle = buildTextStyleEntry(selectedElement, selectedResolved);
    if ((textStyles ?? []).some((entry) => hasSameStyle(entry, nextStyle))) return;
    saveTextStyles([...(textStyles ?? []), nextStyle]);
  };

  const appendElementStyleFromSelection = () => {
    if (!selectedElement || !selectedResolved) return;
    const nextStyle = buildElementStyleEntry(selectedElement, selectedResolved);
    if ((elementStyles ?? []).some((entry) => hasSameStyle(entry, nextStyle))) return;
    saveElementStyles([...(elementStyles ?? []), nextStyle]);
  };

  const applyAssetToSelection = (payload) => {
    if (!selectedElement || !selection?.bpId) return;
    const styleUpdates = getAssetStyleUpdatesForElement(selectedElement, payload);
    if (!styleUpdates) return;
    updateElementStyles(selectedElement.id, selection.bpId, styleUpdates);
    pushHistory();
  };

  const selectedSupportsAsset = (payload) => canAssetApplyToElement(selectedElement, payload);

  return (
    <div>
      <div className="fb-section-label">Assets</div>
      <div className="fb-section-block" style={{ marginBottom: 16 }}>
        <div className="fb-artboard-bp-note" style={{ marginBottom: 10 }}>
          Storage opens a free canvas without artboards for collecting shared elements and references.
        </div>
        <button
          type="button"
          className="fb-secondary-btn"
          onClick={() => {
            if (isStorageOpen) closeComponentEditor();
            else openAssetStorage();
          }}
        >
          {isStorageOpen ? 'Close Storage' : 'Open Storage'}
        </button>
      </div>

      <div className="fb-section-label">Components</div>
      <div className="fb-assets-list">
        {visibleComponents.map((component) => (
          <RenameableAssetCard
            key={component.id}
            title={component.name}
            subtitle="Global component"
            icon={UIIcons.component}
            draggable
            onDragStart={(e) => handleDragStart(e, component)}
            onOpen={() => openComponentEditor(component.id)}
            onDelete={() => deleteComponent(component.id)}
            onRename={(nextName) => {
              saveComponents((components ?? []).map((entry) => (
                entry.id === component.id ? { ...entry, name: nextName, updatedAt: Date.now() } : entry
              )));
            }}
          />
        ))}
      </div>
      {visibleComponents.length === 0 && (
        <div className="fb-layers-empty" style={{ paddingTop: 16 }}>
          Create a component from the canvas, then drag it from here onto any artboard.
        </div>
      )}

      <div className="fb-section-label" style={{ marginTop: 18 }}>Colors</div>
      <div className="fb-assets-list">
        {(colorStyles ?? []).map((style) => (
          <RenameableAssetCard
            key={style.id}
            title={style.name}
            subtitle="Saved from color picker"
            icon={<div className="fb-fill-style-swatch" style={{ background: style.value, width: 24, height: 24, borderRadius: 8 }} />}
            draggable
            onDragStart={(event) => handleAssetDragStart(event, 'color', style)}
            onOpen={() => {
              const payload = { assetType: 'color', value: style.value };
              if (selectedSupportsAsset(payload)) applyAssetToSelection(payload);
            }}
            onDelete={() => saveColorStyles((colorStyles ?? []).filter((entry) => entry.id !== style.id))}
            onRename={(nextName) => saveColorStyles((colorStyles ?? []).map((entry) => entry.id === style.id ? { ...entry, name: nextName } : entry))}
          />
        ))}
      </div>
      {!(colorStyles ?? []).length ? <div className="fb-layers-empty" style={{ paddingTop: 10 }}>Saved colors appear here.</div> : null}

      <div className="fb-section-label" style={{ marginTop: 18 }}>Text Styles</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button type="button" className="fb-secondary-btn" onClick={appendTextStyleFromSelection} disabled={!selectedElement || selectedElement.type !== 'text'}>
          Save Selected Text Style
        </button>
      </div>
      <div className="fb-assets-list">
        {(textStyles ?? []).map((style) => (
          <RenameableAssetCard
            key={style.id}
            title={style.name}
            subtitle={`${style.styleProps?.fontFamily || 'Inter'} • ${style.styleProps?.fontSize || 16}${style.styleProps?.fontSizeUnit || 'px'}`}
            icon={UIIcons.text}
            draggable
            onDragStart={(event) => handleAssetDragStart(event, 'text-style', style)}
            onOpen={() => {
              const payload = { assetType: 'text-style', styleProps: style.styleProps };
              if (selectedSupportsAsset(payload)) applyAssetToSelection(payload);
            }}
            onDelete={() => saveTextStyles((textStyles ?? []).filter((entry) => entry.id !== style.id))}
            onRename={(nextName) => saveTextStyles((textStyles ?? []).map((entry) => entry.id === style.id ? { ...entry, name: nextName } : entry))}
          />
        ))}
      </div>
      {!(textStyles ?? []).length ? <div className="fb-layers-empty" style={{ paddingTop: 10 }}>Save a text layer style to reuse it across pages and imports.</div> : null}

      <div className="fb-section-label" style={{ marginTop: 18 }}>Fonts</div>
      <div className="fb-assets-list">
        {fontFamilies.map((family) => (
          <div key={family} className="fb-asset-card">
            <div className="fb-asset-card__icon">{UIIcons.text}</div>
            <div className="fb-asset-card__meta">
              <div className="fb-asset-card__title" style={{ fontFamily: family }}>{family}</div>
              <div className="fb-asset-card__sub">Available through saved text styles</div>
            </div>
          </div>
        ))}
      </div>
      {!fontFamilies.length ? <div className="fb-layers-empty" style={{ paddingTop: 10 }}>Saved text styles will populate the font library.</div> : null}

      <div className="fb-section-label" style={{ marginTop: 18 }}>Element Styles</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button type="button" className="fb-secondary-btn" onClick={appendElementStyleFromSelection} disabled={!selectedElement}>
          Save Selected Element Style
        </button>
      </div>
      <div className="fb-assets-list">
        {(elementStyles ?? []).map((style) => (
          <RenameableAssetCard
            key={style.id}
            title={style.name}
            subtitle={`${style.type || 'element'} style`}
            icon={UIIcons.component}
            draggable
            onDragStart={(event) => handleAssetDragStart(event, 'element-style', style)}
            onOpen={() => {
              const payload = { assetType: 'element-style', styleType: style.type, styleProps: style.styleProps };
              if (selectedSupportsAsset(payload)) applyAssetToSelection(payload);
            }}
            onDelete={() => saveElementStyles((elementStyles ?? []).filter((entry) => entry.id !== style.id))}
            onRename={(nextName) => saveElementStyles((elementStyles ?? []).map((entry) => entry.id === style.id ? { ...entry, name: nextName } : entry))}
          />
        ))}
      </div>
      {!(elementStyles ?? []).length ? <div className="fb-layers-empty" style={{ paddingTop: 10 }}>Save visual styles from any selected element.</div> : null}
    </div>
  );
}