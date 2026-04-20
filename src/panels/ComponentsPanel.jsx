import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { isAssetStorageComponentId, resolveElementWithVariables, useEditorStore } from '../store/editorStore';
import { canAssetApplyToElement, createAssetDragPayload, FB_ASSET_PAYLOAD_FALLBACK, FB_ASSET_PAYLOAD_MIME, getAssetStyleUpdatesForElement, getAssetBindingsForElement } from '../store/assetStyles';
import { UIIcons } from '../components/UIIcons';
import FillPicker from '../components/FillPicker';
import GoogleFontPicker from '../components/GoogleFontPicker';

/* ── Constants & data model helpers ─────────────────────────────────────── */

const SECTION_KEYS = ['components', 'colors', 'text', 'element'];
const EMPTY_FOLDERS_STORAGE_KEY = 'fb_asset_empty_folders';

const TEXT_STYLE_KEYS = [
  'color', 'fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'fontSizeUnit',
  'lineHeight', 'lineHeightUnit', 'letterSpacing', 'letterSpacingUnit', 'textAlign',
  'textTransform', 'textDecoration',
];

const FB_ASSET_MOVE_MIME = 'application/x-fb-asset-move';

function loadEmptyFolders() {
  try {
    const raw = localStorage.getItem(EMPTY_FOLDERS_STORAGE_KEY);
    if (!raw) return { components: [], colors: [], text: [], element: [] };
    const parsed = JSON.parse(raw);
    return {
      components: Array.isArray(parsed.components) ? parsed.components : [],
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      text: Array.isArray(parsed.text) ? parsed.text : [],
      element: Array.isArray(parsed.element) ? parsed.element : [],
    };
  } catch (_) {
    return { components: [], colors: [], text: [], element: [] };
  }
}

function saveEmptyFolders(state) {
  try { localStorage.setItem(EMPTY_FOLDERS_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

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
    collection: '',
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
    collection: '',
    styleProps: { ...(resolved?.styles ?? {}) },
  };
}

function hasSameStyle(existing, candidate) {
  return `${existing?.name || ''}`.trim().toLowerCase() === `${candidate?.name || ''}`.trim().toLowerCase()
    && JSON.stringify(existing?.styleProps ?? existing?.value ?? null) === JSON.stringify(candidate?.styleProps ?? candidate?.value ?? null);
}

/* ── Small icons ─────────────────────────────────────────────────────────── */

const Chevron = ({ open, size = 9 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" style={{ opacity: 0.55, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
    <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FolderIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7, flexShrink: 0 }}>
    <path d="M10 4H4c-1.1 0-2 .9-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
  </svg>
);

const XIcon = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2 2 L8 8 M8 2 L2 8" />
  </svg>
);

/* ── Grouping helper ────────────────────────────────────────────────────── */

function groupByCollection(items, emptyFolders) {
  const ungrouped = [];
  const groups = {};
  (emptyFolders ?? []).forEach((name) => {
    const trimmed = (name || '').trim();
    if (trimmed && !groups[trimmed]) groups[trimmed] = [];
  });
  (items ?? []).forEach((item) => {
    const col = (item.collection || '').trim();
    if (!col) { ungrouped.push(item); return; }
    if (!groups[col]) groups[col] = [];
    groups[col].push(item);
  });
  return { ungrouped, groups };
}

/* ── Section header with + menu ─────────────────────────────────────────── */

function SectionHeader({ label, count, open, onToggle, menuItems }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  return (
    <div className="fb-assets-section__header" onClick={onToggle}>
      <Chevron open={open} />
      <span className="fb-assets-section__label">{label}</span>
      {count > 0 ? <span className="fb-assets-section__count">{count}</span> : null}
      <span style={{ flex: 1 }} />
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          type="button"
          className="fb-assets-section__plus"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          title="Add"
        >+</button>
        {menuOpen ? (
          <div
            className="fb-context-menu"
            style={{ top: '110%', right: 0, minWidth: 180 }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(menuItems ?? []).map((m) => (
              <button
                key={m.label}
                type="button"
                className="fb-context-menu__item"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); if (!m.disabled) m.onClick(); }}
                disabled={m.disabled}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Inline rename input ────────────────────────────────────────────────── */

function InlineRename({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const commit = (nextValue) => {
    const v = (nextValue ?? draft ?? '').trim();
    if (v && v !== value) onCommit(v); else onCommit(null);
  };
  return (
    <input
      className="fb-prop-input fb-asset-rename-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(draft);
        if (e.key === 'Escape') onCommit(null);
      }}
    />
  );
}

/* ── Right-click context menu ───────────────────────────────────────────── */

function useContextMenu() {
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  return [menu, setMenu];
}

/* ── Collection folder ──────────────────────────────────────────────────── */

function CollectionFolder({ name, children, onDropItems, onRename, onDelete, onDoubleClickHeader }) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const onWrapDragOver = (e) => {
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes(FB_ASSET_MOVE_MIME)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  };
  const onWrapDragLeave = (e) => {
    // only clear if leaving the folder entirely
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  };
  const onWrapDrop = (e) => {
    const raw = e.dataTransfer.getData(FB_ASSET_MOVE_MIME);
    setDragOver(false);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const data = JSON.parse(raw);
      if (data?.ids?.length) onDropItems?.(data.ids, name);
    } catch (_) {}
  };

  return (
    <div
      className={`fb-assets-folder${dragOver ? ' is-drag-over' : ''}`}
      onDragOver={onWrapDragOver}
      onDragLeave={onWrapDragLeave}
      onDrop={onWrapDrop}
    >
      <div
        className="fb-assets-folder__header"
        onClick={() => !renaming && setOpen(!open)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (onRename) setRenaming(true);
          onDoubleClickHeader?.();
        }}
      >
        <Chevron open={open} />
        <FolderIcon />
        {renaming ? (
          <InlineRename
            value={name}
            onCommit={(v) => { setRenaming(false); if (v) onRename?.(v); }}
          />
        ) : (
          <span className="fb-assets-folder__name">{name}</span>
        )}
        <span style={{ flex: 1 }} />
        {onDelete ? (
          <button
            type="button"
            className="fb-assets-folder__delete"
            title="Delete folder (items become uncategorized)"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          ><XIcon /></button>
        ) : null}
      </div>
      {open ? <div className="fb-assets-folder__body">{children}</div> : null}
    </div>
  );
}

/* ── Ungrouped drop zone ────────────────────────────────────────────────── */

function UngroupedDropZone({ onDropItems, children, empty }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`fb-assets-ungrouped${dragOver ? ' is-drag-over' : ''}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes(FB_ASSET_MOVE_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const raw = e.dataTransfer.getData(FB_ASSET_MOVE_MIME);
        if (!raw) return;
        e.preventDefault();
        try {
          const data = JSON.parse(raw);
          if (data?.ids?.length) onDropItems?.(data.ids, '');
        } catch (_) {}
      }}
    >
      {empty ? <div className="fb-assets-ungrouped__empty-hint">Drop here to remove from a folder</div> : null}
      {children}
    </div>
  );
}

/* ── Inline text style editor ───────────────────────────────────────────── */

function TextStyleEditor({ style, onChange }) {
  const props = style.styleProps ?? {};
  const upd = (key, val) => onChange({ ...style, styleProps: { ...props, [key]: val } });
  return (
    <div className="fb-text-style-editor" onClick={(e) => e.stopPropagation()}>
      <div className="fb-text-style-editor__row">
        <label>Font</label>
        <div style={{ flex: 1 }}>
          <GoogleFontPicker value={props.fontFamily || 'Inter'} onChange={(v) => upd('fontFamily', v)} />
        </div>
      </div>
      <div className="fb-text-style-editor__row">
        <label>Size</label>
        <input className="fb-prop-input" type="number" style={{ width: 48 }} value={props.fontSize ?? 16} onChange={(e) => upd('fontSize', Number(e.target.value) || 16)} min={1} />
        <label>Weight</label>
        <select className="fb-prop-input" value={props.fontWeight ?? 400} onChange={(e) => upd('fontWeight', Number(e.target.value))}>
          {[100,200,300,400,500,600,700,800,900].map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <div className="fb-text-style-editor__row">
        <label>Color</label>
        <FillPicker value={props.color || '#ffffff'} solidOnly onChange={(v) => upd('color', v)} popoverPlacement="right" />
      </div>
      <div className="fb-text-style-editor__row">
        <label>Line H</label>
        <input className="fb-prop-input" type="number" style={{ width: 48 }} step={0.1} value={props.lineHeight ?? 1.4} onChange={(e) => upd('lineHeight', Number(e.target.value) || 1.4)} />
        <label>Spacing</label>
        <input className="fb-prop-input" type="number" style={{ width: 48 }} step={0.1} value={props.letterSpacing ?? 0} onChange={(e) => upd('letterSpacing', Number(e.target.value))} />
      </div>
    </div>
  );
}

/* ── Main panel ─────────────────────────────────────────────────────────── */

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
  const deleteComponent = useEditorStore(s => s.deleteComponent);
  const saveComponents = useEditorStore(s => s.saveComponents);
  const saveColorStyles = useEditorStore(s => s.saveColorStyles);
  const saveTextStyles = useEditorStore(s => s.saveTextStyles);
  const saveElementStyles = useEditorStore(s => s.saveElementStyles);
  const updateElementStyles = useEditorStore(s => s.updateElementStyles);
  const setElementAssetBindings = useEditorStore(s => s.setElementAssetBindings);
  const propagateAssetUpdate = useEditorStore(s => s.propagateAssetUpdate);
  const pushHistory = useEditorStore(s => s.pushHistory);

  // UI state
  const [sectionOpen, setSectionOpen] = useState({ components: true, colors: true, text: true, element: true });
  const [selectedIds, setSelectedIds] = useState(() => ({ components: new Set(), colors: new Set(), text: new Set(), element: new Set() }));
  const [renamingId, setRenamingId] = useState(null);
  const [editingTextId, setEditingTextId] = useState(null);
  const [contextMenu, setContextMenu] = useContextMenu();
  const [emptyFolders, setEmptyFolders] = useState(loadEmptyFolders);
  const [newFolderPromptFor, setNewFolderPromptFor] = useState(null); // section key or null

  useEffect(() => { saveEmptyFolders(emptyFolders); }, [emptyFolders]);

  const pageVariables = Array.isArray(currentPage?.variables) ? currentPage.variables : [];
  const selectedElement = selection?.elementId
    ? allElements.find((entry) => entry.id === selection.elementId) ?? null
    : null;
  const selectedResolved = selectedElement
    ? resolveElementWithVariables(selectedElement, selection?.bpId ?? 'desktop', pageVariables, globalVariables)
    : null;

  const visibleComponents = useMemo(
    () => (components ?? []).filter((c) => !isAssetStorageComponentId(c.id)),
    [components],
  );

  // Section data map
  const sections = {
    components: { items: visibleComponents, save: saveComponents, label: 'Components' },
    colors: { items: colorStyles ?? [], save: saveColorStyles, label: 'Colors' },
    text: { items: textStyles ?? [], save: saveTextStyles, label: 'Text Styles' },
    element: { items: elementStyles ?? [], save: saveElementStyles, label: 'Element Styles' },
  };

  /* ── Selection helpers ── */

  const clearSelection = () => setSelectedIds({ components: new Set(), colors: new Set(), text: new Set(), element: new Set() });

  const toggleSelect = useCallback((section, id, event) => {
    setSelectedIds((prev) => {
      const next = { ...prev, [section]: new Set(prev[section]) };
      // Clear other sections (single-section selection)
      SECTION_KEYS.forEach((k) => { if (k !== section) next[k] = new Set(); });
      if (event?.shiftKey) {
        const all = sections[section].items.map((x) => x.id);
        const currentArr = Array.from(next[section]);
        const last = currentArr[currentArr.length - 1];
        const startIdx = last ? all.indexOf(last) : 0;
        const endIdx = all.indexOf(id);
        const [a, b] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        for (let i = a; i <= b; i += 1) next[section].add(all[i]);
      } else if (event?.metaKey || event?.ctrlKey) {
        if (next[section].has(id)) next[section].delete(id); else next[section].add(id);
      } else {
        next[section] = new Set([id]);
      }
      return next;
    });
  }, [sections]);

  const isSelected = (section, id) => selectedIds[section]?.has(id) ?? false;

  /* ── Drag (internal move) ── */

  const startInternalDrag = (e, section, id) => {
    const ids = isSelected(section, id) ? Array.from(selectedIds[section]) : [id];
    const payload = JSON.stringify({ section, ids });
    e.dataTransfer.setData(FB_ASSET_MOVE_MIME, payload);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const applyCollection = (section, ids, newCollection) => {
    const { items, save } = sections[section];
    const updated = items.map((item) => ids.includes(item.id) ? { ...item, collection: newCollection, updatedAt: Date.now() } : item);
    save(updated);
    // If moving into an existing empty folder, remove it from empty list since it now has items
    if (newCollection) {
      setEmptyFolders((prev) => ({ ...prev, [section]: (prev[section] ?? []).filter((n) => n !== newCollection) }));
    }
  };

  /* ── Canvas drag (components to canvas, styles via payload) ── */

  const handleComponentCanvasDrag = (e, component) => {
    e.dataTransfer.setData('fb-component-id', component.id);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleAssetCanvasDrag = (event, assetType, asset) => {
    const payload = createAssetDragPayload(assetType, asset);
    if (!payload) return;
    event.dataTransfer.setData(FB_ASSET_PAYLOAD_MIME, payload);
    event.dataTransfer.setData(FB_ASSET_PAYLOAD_FALLBACK, payload);
    event.dataTransfer.setData('text/plain', payload);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  /* ── Actions ── */

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

  const addColorFromSelection = () => {
    const fill = selectedResolved?.styles?.backgroundColor || selectedResolved?.styles?.color || '#ffffff';
    const nextStyle = {
      id: `color-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Color',
      value: fill,
      collection: '',
    };
    saveColorStyles([...(colorStyles ?? []), nextStyle]);
  };

  const applyAssetToSelection = (payload) => {
    if (!selectedElement || !selection?.bpId) return;
    const styleUpdates = getAssetStyleUpdatesForElement(selectedElement, payload);
    if (!styleUpdates) return;
    updateElementStyles(selectedElement.id, selection.bpId, styleUpdates);
    const bindings = getAssetBindingsForElement(selectedElement, payload);
    if (bindings) setElementAssetBindings(selectedElement.id, bindings);
    pushHistory();
  };

  const selectedSupportsAsset = (payload) => canAssetApplyToElement(selectedElement, payload);

  /* ── Renames / updates ── */

  const renameAsset = (section, id, newName) => {
    const { items, save } = sections[section];
    save(items.map((s) => s.id === id ? { ...s, name: newName, updatedAt: Date.now() } : s));
  };

  const deleteSelected = (section) => {
    const ids = Array.from(selectedIds[section] ?? []);
    if (!ids.length) return;
    if (section === 'components') {
      ids.forEach((id) => deleteComponent(id));
    } else {
      const { items, save } = sections[section];
      save(items.filter((s) => !ids.includes(s.id)));
    }
    setSelectedIds((prev) => ({ ...prev, [section]: new Set() }));
  };

  const createCollectionFromSelected = (section) => {
    const ids = Array.from(selectedIds[section] ?? []);
    if (!ids.length) return;
    const name = window.prompt('Collection name', 'New Collection');
    if (!name) return;
    applyCollection(section, ids, name.trim());
    setSelectedIds((prev) => ({ ...prev, [section]: new Set() }));
  };

  const createEmptyFolder = (section) => {
    const name = window.prompt('Folder name', 'New Folder');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setEmptyFolders((prev) => {
      const current = prev[section] ?? [];
      if (current.includes(trimmed)) return prev;
      return { ...prev, [section]: [...current, trimmed] };
    });
  };

  const renameFolder = (section, oldName, newName) => {
    const { items, save } = sections[section];
    save(items.map((s) => s.collection === oldName ? { ...s, collection: newName, updatedAt: Date.now() } : s));
    setEmptyFolders((prev) => ({ ...prev, [section]: (prev[section] ?? []).map((n) => n === oldName ? newName : n) }));
  };

  const deleteFolder = (section, folderName) => {
    const { items, save } = sections[section];
    save(items.map((s) => s.collection === folderName ? { ...s, collection: '', updatedAt: Date.now() } : s));
    setEmptyFolders((prev) => ({ ...prev, [section]: (prev[section] ?? []).filter((n) => n !== folderName) }));
  };

  /* ── Context menu on card ── */

  const openCardContext = (e, section, id) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected(section, id)) {
      setSelectedIds((prev) => {
        const next = { ...prev, [section]: new Set([id]) };
        SECTION_KEYS.forEach((k) => { if (k !== section) next[k] = new Set(); });
        return next;
      });
    }
    setContextMenu({ x: e.clientX, y: e.clientY, section, id });
  };

  /* ── Drop indicator + reorder ── */

  const [dropIndicator, setDropIndicator] = useState(null); // { section, id, pos: 'before'|'after' } | null

  const reorderWithin = (section, movingIds, targetId, pos, targetCollection) => {
    const { items, save } = sections[section];
    const moving = items.filter((x) => movingIds.includes(x.id)).map((x) => ({
      ...x,
      collection: targetCollection ?? x.collection ?? '',
      updatedAt: Date.now(),
    }));
    if (!moving.length) return;
    const rest = items.filter((x) => !movingIds.includes(x.id));
    const idx = rest.findIndex((x) => x.id === targetId);
    if (idx === -1) { save([...rest, ...moving]); return; }
    const insertAt = pos === 'after' ? idx + 1 : idx;
    const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    save(next);
    if (targetCollection) {
      setEmptyFolders((prev) => ({ ...prev, [section]: (prev[section] ?? []).filter((n) => n !== targetCollection) }));
    }
  };

  const handleCardDragOver = (e, section, item) => {
    const types = Array.from(e.dataTransfer.types || []);
    if (!types.includes(FB_ASSET_MOVE_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - rect.top) / rect.height;
    const pos = rel < 0.5 ? 'before' : 'after';
    setDropIndicator((prev) => (
      prev?.section === section && prev?.id === item.id && prev?.pos === pos
        ? prev
        : { section, id: item.id, pos }
    ));
  };

  const handleCardDrop = (e, section, item) => {
    const raw = e.dataTransfer.getData(FB_ASSET_MOVE_MIME);
    setDropIndicator(null);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const data = JSON.parse(raw);
      if (data?.section !== section || !data?.ids?.length) return;
      const movingIds = data.ids.filter((id) => id !== item.id);
      if (!movingIds.length) return;
      const pos = dropIndicator?.pos || 'before';
      reorderWithin(section, movingIds, item.id, pos, item.collection ?? '');
    } catch (_) {}
  };

  /* ── Render: card ── */

  const renderCard = (section, item, opts = {}) => {
    const selected = isSelected(section, item.id);
    const indicator = dropIndicator?.section === section && dropIndicator?.id === item.id ? dropIndicator.pos : null;
    return (
      <div
        key={item.id}
        className={`fb-asset-row${selected ? ' is-selected' : ''}${indicator ? ` is-drop-${indicator}` : ''}`}
        draggable
        onClick={(e) => toggleSelect(section, item.id, e)}
        onContextMenu={(e) => openCardContext(e, section, item.id)}
        onDragStart={(e) => {
          startInternalDrag(e, section, item.id);
          opts.onCanvasDrag?.(e);
        }}
        onDragOver={(e) => handleCardDragOver(e, section, item)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setDropIndicator((prev) => (prev?.id === item.id ? null : prev));
          }
        }}
        onDrop={(e) => handleCardDrop(e, section, item)}
        onDragEnd={() => setDropIndicator(null)}
        onDoubleClick={opts.onDoubleClick}
      >
        <div className="fb-asset-row__icon">{opts.icon}</div>
        <div className="fb-asset-row__meta">
          {renamingId === item.id ? (
            <InlineRename
              value={item.name}
              onCommit={(v) => { setRenamingId(null); if (v) renameAsset(section, item.id, v); }}
            />
          ) : (
            <div
              className="fb-asset-row__title"
              onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(item.id); }}
              style={opts.titleStyle}
            >{item.name}</div>
          )}
          {opts.subtitle ? <div className="fb-asset-row__sub">{opts.subtitle}</div> : null}
        </div>
        {opts.rightSlot ?? null}
      </div>
    );
  };

  /* ── Render helpers per section ── */

  const renderGrouped = (section, renderItem) => {
    const { items } = sections[section];
    const { ungrouped, groups } = groupByCollection(items, emptyFolders[section]);
    const groupNames = Object.keys(groups);
    return (
      <>
        {groupNames.map((name) => (
          <CollectionFolder
            key={name}
            name={name}
            onDropItems={(ids) => applyCollection(section, ids, name)}
            onRename={(newName) => renameFolder(section, name, newName)}
            onDelete={() => deleteFolder(section, name)}
          >
            {groups[name].map(renderItem)}
          </CollectionFolder>
        ))}
        <UngroupedDropZone
          onDropItems={(ids) => applyCollection(section, ids, '')}
          empty={!ungrouped.length && groupNames.length > 0}
        >
          {ungrouped.map(renderItem)}
        </UngroupedDropZone>
      </>
    );
  };

  /* ── Section menu builders ── */

  const menuForComponents = [
    { label: 'New folder', onClick: () => createEmptyFolder('components') },
    { label: 'Collection from selected', onClick: () => createCollectionFromSelected('components'), disabled: selectedIds.components.size === 0 },
  ];
  const menuForColors = [
    { label: 'New folder', onClick: () => createEmptyFolder('colors') },
    { label: 'Collection from selected', onClick: () => createCollectionFromSelected('colors'), disabled: selectedIds.colors.size === 0 },
    { label: selectedElement ? 'Add color from selection' : 'Add color from selection (select an element)', onClick: addColorFromSelection, disabled: !selectedElement },
  ];
  const menuForText = [
    { label: 'New folder', onClick: () => createEmptyFolder('text') },
    { label: 'Collection from selected', onClick: () => createCollectionFromSelected('text'), disabled: selectedIds.text.size === 0 },
    { label: 'Save selected text style', onClick: appendTextStyleFromSelection, disabled: !(selectedElement && selectedElement.type === 'text') },
  ];
  const menuForElement = [
    { label: 'New folder', onClick: () => createEmptyFolder('element') },
    { label: 'Collection from selected', onClick: () => createCollectionFromSelected('element'), disabled: selectedIds.element.size === 0 },
    { label: 'Save selected element style', onClick: appendElementStyleFromSelection, disabled: !selectedElement },
  ];

  /* ── Render ── */

  return (
    <div className="fb-assets-panel" onClick={clearSelection}>
      {/* ── Components ── */}
      <div className="fb-assets-section" onClick={(e) => e.stopPropagation()}>
        <SectionHeader
          label="Components"
          count={visibleComponents.length}
          open={sectionOpen.components}
          onToggle={() => setSectionOpen((p) => ({ ...p, components: !p.components }))}
          menuItems={menuForComponents}
        />
        {sectionOpen.components ? (
          <div className="fb-assets-section__body">
            {visibleComponents.length === 0 && !(emptyFolders.components ?? []).length ? (
              <div className="fb-layers-empty">Create a component from the canvas, then drag it here.</div>
            ) : renderGrouped('components', (component) => renderCard('components', component, {
              icon: UIIcons.component,
              onCanvasDrag: (e) => handleComponentCanvasDrag(e, component),
              onDoubleClick: () => setRenamingId(component.id),
              rightSlot: (
                <button
                  type="button"
                  className="fb-asset-row__edit-btn"
                  title="Edit component"
                  onClick={(e) => { e.stopPropagation(); openComponentEditor(component.id); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              ),
            }))}
          </div>
        ) : null}
      </div>

      {/* ── Colors ── */}
      <div className="fb-assets-section" onClick={(e) => e.stopPropagation()}>
        <SectionHeader
          label="Colors"
          count={(colorStyles ?? []).length}
          open={sectionOpen.colors}
          onToggle={() => setSectionOpen((p) => ({ ...p, colors: !p.colors }))}
          menuItems={menuForColors}
        />
        {sectionOpen.colors ? (
          <div className="fb-assets-section__body">
            {!(colorStyles ?? []).length && !(emptyFolders.colors ?? []).length ? (
              <div className="fb-layers-empty">Saved colors appear here.</div>
            ) : renderGrouped('colors', (style) => renderCard('colors', style, {
              icon: (
                <div onClick={(e) => e.stopPropagation()}>
                  <FillPicker
                    value={style.value || '#000'}
                    onChange={(v) => {
                      saveColorStyles((colorStyles ?? []).map((s) => s.id === style.id ? { ...s, value: v } : s));
                      propagateAssetUpdate('color', style.id, v);
                    }}
                    compact
                    popoverPlacement="right"
                  />
                </div>
              ),
              subtitle: style.value,
              onCanvasDrag: (e) => handleAssetCanvasDrag(e, 'color', style),
              onDoubleClick: () => {
                const payload = { assetType: 'color', id: style.id, value: style.value };
                if (selectedSupportsAsset(payload)) applyAssetToSelection(payload);
              },
            }))}
          </div>
        ) : null}
      </div>

      {/* ── Text Styles ── */}
      <div className="fb-assets-section" onClick={(e) => e.stopPropagation()}>
        <SectionHeader
          label="Text Styles"
          count={(textStyles ?? []).length}
          open={sectionOpen.text}
          onToggle={() => setSectionOpen((p) => ({ ...p, text: !p.text }))}
          menuItems={menuForText}
        />
        {sectionOpen.text ? (
          <div className="fb-assets-section__body">
            {!(textStyles ?? []).length && !(emptyFolders.text ?? []).length ? (
              <div className="fb-layers-empty">Save a text layer's style to reuse across pages.</div>
            ) : renderGrouped('text', (style) => {
              const isEditing = editingTextId === style.id;
              const props = style.styleProps ?? {};
              return (
                <div key={style.id} className={`fb-asset-row-wrap${isEditing ? ' is-editing' : ''}`}>
                  {renderCard('text', style, {
                    icon: UIIcons.text,
                    subtitle: `${props.fontFamily || 'Inter'} · ${props.fontSize || 16}px · ${props.fontWeight ?? 400}`,
                    titleStyle: { fontFamily: props.fontFamily || 'Inter', fontWeight: props.fontWeight ?? 400 },
                    onCanvasDrag: (e) => handleAssetCanvasDrag(e, 'text-style', style),
                    onDoubleClick: () => setEditingTextId(isEditing ? null : style.id),
                  })}
                  {isEditing ? (
                    <TextStyleEditor
                      style={style}
                      onChange={(updated) => {
                        saveTextStyles((textStyles ?? []).map((s) => s.id === style.id ? updated : s));
                        propagateAssetUpdate('text-style', style.id, updated.styleProps ?? {});
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ── Element Styles ── */}
      <div className="fb-assets-section" onClick={(e) => e.stopPropagation()}>
        <SectionHeader
          label="Element Styles"
          count={(elementStyles ?? []).length}
          open={sectionOpen.element}
          onToggle={() => setSectionOpen((p) => ({ ...p, element: !p.element }))}
          menuItems={menuForElement}
        />
        {sectionOpen.element ? (
          <div className="fb-assets-section__body">
            {!(elementStyles ?? []).length && !(emptyFolders.element ?? []).length ? (
              <div className="fb-layers-empty">Save visual styles from any selected element.</div>
            ) : renderGrouped('element', (style) => renderCard('element', style, {
              icon: UIIcons.component,
              subtitle: `${style.type || 'element'} style`,
              onCanvasDrag: (e) => handleAssetCanvasDrag(e, 'element-style', style),
              onDoubleClick: () => {
                const payload = { assetType: 'element-style', id: style.id, styleType: style.type, styleProps: style.styleProps };
                if (selectedSupportsAsset(payload)) applyAssetToSelection(payload);
              },
            }))}
          </div>
        ) : null}
      </div>

      {/* ── Right-click context menu ── */}
      {contextMenu ? (
        <div
          className="fb-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 99999 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="fb-context-menu__item"
            onClick={() => { setRenamingId(contextMenu.id); setContextMenu(null); }}
          >Rename</button>
          <button
            type="button"
            className="fb-context-menu__item"
            disabled={selectedIds[contextMenu.section].size === 0}
            onClick={() => { createCollectionFromSelected(contextMenu.section); setContextMenu(null); }}
          >Create collection from selected ({selectedIds[contextMenu.section].size})</button>
          <button
            type="button"
            className="fb-context-menu__item"
            onClick={() => { deleteSelected(contextMenu.section); setContextMenu(null); }}
          >Delete {selectedIds[contextMenu.section].size > 1 ? `(${selectedIds[contextMenu.section].size})` : ''}</button>
        </div>
      ) : null}
    </div>
  );
}
