import { create } from 'zustand';

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (obj && key in obj) acc[key] = obj[key];
    return acc;
  }, {});
}

// ── Breakpoint definitions ────────────────────────────────────

const BREAKPOINTS = {
  desktop: { id: 'desktop', name: 'Desktop', icon: '🖥', width: 1440, height: 900, x: 100,  y: 120, viewportFoldH: null },
  tablet:  { id: 'tablet',  name: 'Tablet',  icon: '📟', width: 768,  height: 1024, x: 1600, y: 120, viewportFoldH: null },
  mobile:  { id: 'mobile',  name: 'Mobile',  icon: '📱', width: 375,  height: 812,  x: 2440, y: 120, viewportFoldH: null },
};

const COMPONENT_EDITOR_BREAKPOINTS = {
  desktop: { id: 'desktop', name: 'Component', icon: '⬢', width: 820, height: 560, x: 120, y: 120, viewportFoldH: null },
};

const COMPONENT_ROOT_LAYOUT_KEYS = [
  'width', 'height', 'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
  'minW', 'maxW', 'minH', 'maxH', 'hidden', 'constraints',
];

function makeComponentPrimaryRoot(config = {}) {
  return {
    id: config.id ?? makeId('cmp-root'),
    type: 'frame',
    name: 'Primary',
    parentId: null,
    children: [],
    componentRoot: true,
    base: {
      x: config.x ?? 0,
      y: config.y ?? 0,
      width: config.width ?? 240,
      height: config.height ?? 160,
      rotation: 0,
      locked: config.locked ?? false,
      hidden: false,
      widthMode: config.widthMode ?? 'fixed',
      heightMode: config.heightMode ?? 'fixed',
      widthPct: config.widthPct ?? null,
      heightPct: config.heightPct ?? null,
      widthFr: config.widthFr ?? 1,
      heightFr: config.heightFr ?? 1,
      minW: config.minW ?? null,
      maxW: config.maxW ?? null,
      minH: config.minH ?? null,
      maxH: config.maxH ?? null,
      constraints: deepClone(config.constraints ?? { top: true, left: true, right: false, bottom: false }),
      styles: {
        backgroundColor: 'transparent',
        borderRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        borderStyle: 'solid',
        opacity: 1,
        overflow: 'visible',
        display: null,
        flexDirection: 'row',
        flexWrap: 'nowrap',
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        boxShadow: '',
        zIndex: config.zIndex ?? 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

function ensureComponentPrimaryRoot(snapshot = []) {
  const normalized = deepClone(snapshot ?? []);
  const root = getSnapshotRoot(normalized);
  if (!root) return [];

  normalized.forEach((el) => {
    delete el.componentInstance;
  });

  if (root.componentRoot) {
    root.name = 'Primary';
    root.parentId = null;
    root.base = {
      ...root.base,
      widthMode: 'fixed',
      heightMode: 'fixed',
    };
    return normalized;
  }

  const rootBase = root.base ?? {};
  const wrapper = makeComponentPrimaryRoot({
    ...pick(rootBase, COMPONENT_ROOT_LAYOUT_KEYS),
    zIndex: rootBase.styles?.zIndex ?? 1,
  });

  ['tablet', 'mobile'].forEach((bpId) => {
    const sourceOverride = root.overrides?.[bpId] ?? {};
    const nextOverride = pick(sourceOverride, COMPONENT_ROOT_LAYOUT_KEYS);
    const zIndex = sourceOverride.styles?.zIndex;
    if (zIndex != null) nextOverride.styles = { zIndex };
    if (Object.keys(nextOverride).length) wrapper.overrides[bpId] = nextOverride;
  });

  wrapper.children = [root.id];
  root.parentId = wrapper.id;
  root.base = { ...root.base, x: 0, y: 0 };
  ['tablet', 'mobile'].forEach((bpId) => {
    const override = root.overrides?.[bpId];
    if (!override) return;
    root.overrides[bpId] = {
      ...override,
      ...(override.x != null ? { x: 0 } : {}),
      ...(override.y != null ? { y: 0 } : {}),
    };
  });

  return [wrapper, ...normalized];
}

function normalizeStoredComponent(component) {
  return {
    ...component,
    snapshot: ensureComponentPrimaryRoot(component?.snapshot ?? []),
  };
}

function makeComponentEditorBreakpoints(snapshot = []) {
  const root = getSnapshotRoot(snapshot);
  const width = Math.max(1400, Math.round((root?.base?.width ?? 420) + 720));
  const height = Math.max(960, Math.round((root?.base?.height ?? 280) + 560));
  return {
    desktop: {
      ...COMPONENT_EDITOR_BREAKPOINTS.desktop,
      width,
      height,
    },
  };
}

// Elements live in a flat page.elements array.
// Every element has base (desktop truth) + overrides per breakpoint.
// Adding/moving always writes to base. Tablet/Mobile inherit + can override.
const makeDefaultPage = () => ({
  id: 'page-1',
  title: 'Untitled Page',
  // tablet/mobile start as null = inherit from parent breakpoint
  background: { desktop: '#ffffff', tablet: null, mobile: null },
  // padding: null per bp = inherit from parent breakpoint
  padding: { desktop: { top: 0, right: 0, bottom: 0, left: 0 }, tablet: null, mobile: null },
  // layout: null per bp = inherit; object = { flexDirection, alignItems, justifyContent, flexWrap, gap }
  layout: { desktop: null, tablet: null, mobile: null },
  elements: [],
});

const makeComponentEditorPage = () => ({
  ...makeDefaultPage(),
  title: 'Component',
  background: { desktop: '#16161c', tablet: null, mobile: null },
  padding: { desktop: { top: 0, right: 0, bottom: 0, left: 0 }, tablet: null, mobile: null },
});

function makeEmptyComponentEditor() {
  return {
    isOpen: false,
    componentId: null,
    page: makeComponentEditorPage(),
    breakpointDefs: deepClone(COMPONENT_EDITOR_BREAKPOINTS),
    uiRestore: null,
  };
}

// ── Element factory ──────────────────────────────────────────

export function createFrame(x = 80, y = 80, name) {
  return {
    id: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'frame',
    name: name || 'Frame',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 160, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      styles: {
        backgroundColor: 'rgba(180,180,200,0.18)',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, overflow: 'visible', display: 'flex', flexDirection: 'row',
        flexWrap: 'nowrap', gap: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0,
        paddingLeft: 0, alignItems: 'flex-start', justifyContent: 'flex-start', boxShadow: '', zIndex: 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createImage(x = 80, y = 80, name) {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'image',
    name: name || 'Image',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 160, rotation: 0, locked: false, hidden: false,
      widthMode: 'fixed', heightMode: 'fixed',
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      src: '',
      styles: {
        backgroundColor: 'transparent',
        borderRadius: 0, borderWidth: 0, borderColor: '#000000', borderStyle: 'solid',
        opacity: 1, objectFit: 'cover', boxShadow: '', zIndex: 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

export function createText(x = 80, y = 80, name) {
  return {
    id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'text',
    name: name || 'Text',
    parentId: null,
    children: [],
    base: {
      x, y, width: 240, height: 60, rotation: 0, locked: false, hidden: false,
      widthMode: 'hug', heightMode: 'hug',
      minW: null, maxW: null, minH: null, maxH: null,
      constraints: { top: true, left: true, right: false, bottom: false },
      text: 'Text',
      styles: {
        backgroundColor: 'transparent',
        color: '#000000',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontStyle: 'normal',
        fontSize: 42,
        fontSizeUnit: 'px',
        letterSpacing: 0,
        letterSpacingUnit: 'em',
        lineHeight: 1.2,
        lineHeightUnit: 'em',
        textAlign: 'left',
        textDecoration: 'none',
        boxShadow: '',
        opacity: 1,
        zIndex: 1,
      },
    },
    overrides: { tablet: {}, mobile: {} },
  };
}

// Merge base + breakpoint overrides into rendered props.
// Cascade: desktop (base)  →  tablet  →  mobile
export function resolveElement(el, bpId) {
  if (bpId === 'desktop') return { ...el.base, styles: { ...el.base.styles } };
  const tabOv = el.overrides?.tablet ?? {};
  if (bpId === 'tablet') {
    return { ...el.base, ...tabOv, styles: { ...el.base.styles, ...(tabOv.styles ?? {}) } };
  }
  // mobile: base  →  tablet override  →  mobile override
  const mobOv = el.overrides?.mobile ?? {};
  return {
    ...el.base, ...tabOv, ...mobOv,
    styles: { ...el.base.styles, ...(tabOv.styles ?? {}), ...(mobOv.styles ?? {}) },
  };
}

export function getRootElements(elements) { return elements.filter(e => !e.parentId); }

// Cascade background: tablet/mobile inherit from parent breakpoint when null
export function resolveBackground(background, bpId) {
  const bg = background ?? {};
  if (bpId === 'mobile') return bg.mobile ?? bg.tablet ?? bg.desktop ?? '#ffffff';
  if (bpId === 'tablet') return bg.tablet ?? bg.desktop ?? '#ffffff';
  return bg.desktop ?? '#ffffff';
}

// Cascade page padding: null = inherit from parent breakpoint
const ZERO_PAD = { top: 0, right: 0, bottom: 0, left: 0 };
export function resolvePagePadding(padding, bpId) {
  const p = padding ?? {};
  if (bpId === 'mobile') return p.mobile ?? p.tablet ?? p.desktop ?? ZERO_PAD;
  if (bpId === 'tablet') return p.tablet ?? p.desktop ?? ZERO_PAD;
  return p.desktop ?? ZERO_PAD;
}

// Cascade page layout: null = inherit / disabled
export function resolvePageLayout(layout, bpId) {
  const l = layout ?? {};
  if (bpId === 'mobile') return l.mobile ?? l.tablet ?? l.desktop ?? null;
  if (bpId === 'tablet') return l.tablet ?? l.desktop ?? null;
  return l.desktop ?? null;
}
export function getChildEls(elements, parentId) {
  const parent = elements.find(e => e.id === parentId);
  if (parent?.children?.length) {
    // Return in parent.children order so reorderElementInParent is reflected
    return parent.children.map(cid => elements.find(e => e.id === cid)).filter(Boolean);
  }
  return elements.filter(e => e.parentId === parentId);
}
export function findEl(elements, id) { return elements.find(e => e.id === id) ?? null; }

function collectSubtree(elements, rootId) {
  const subtree = [];
  const visit = (id) => {
    const el = findEl(elements, id);
    if (!el) return;
    subtree.push(el);
    (el.children ?? []).forEach(visit);
  };
  visit(rootId);
  return subtree;
}

function getSnapshotRoot(snapshot) {
  const idSet = new Set(snapshot.map(el => el.id));
  return snapshot.find(el => !idSet.has(el.parentId)) ?? snapshot[0] ?? null;
}

function normalizeComponentSnapshot(subtree, rootId) {
  const normalized = deepClone(subtree).map((el) => {
    const next = { ...el };
    if (el.id === rootId) next.parentId = null;
    delete next.componentInstance;
    return next;
  });
  return ensureComponentPrimaryRoot(normalized);
}

function instantiateComponentSnapshot(snapshot, {
  targetRootId = null,
  targetParentId = null,
  rootPosition = null,
  bpId = 'desktop',
  componentInstance = null,
} = {}) {
  const root = getSnapshotRoot(snapshot);
  if (!root) return [];

  const idMap = {};
  snapshot.forEach((el) => {
    idMap[el.id] = el.id === root.id && targetRootId ? targetRootId : makeId(el.type === 'text' ? 'txt' : el.type === 'image' ? 'img' : 'fr');
  });

  return deepClone(snapshot).map((el) => {
    const isRoot = el.id === root.id;
    const mappedId = idMap[el.id];
    const next = {
      ...el,
      id: mappedId,
      parentId: isRoot ? targetParentId : (idMap[el.parentId] ?? null),
      children: (el.children ?? []).map(cid => idMap[cid]).filter(Boolean),
      overrides: deepClone(el.overrides ?? { tablet: {}, mobile: {} }),
    };

    if (bpId !== 'desktop') {
      next.base = { ...next.base, hidden: true };
      next.overrides = {
        ...next.overrides,
        [bpId]: {
          ...(next.overrides?.[bpId] ?? {}),
          hidden: false,
        },
      };
    }

    if (isRoot && rootPosition) {
      if (bpId === 'desktop') {
        next.base = { ...next.base, x: rootPosition.x, y: rootPosition.y };
      } else {
        next.overrides = {
          ...next.overrides,
          [bpId]: {
            ...(next.overrides?.[bpId] ?? {}),
            x: rootPosition.x,
            y: rootPosition.y,
          },
        };
      }
    }

    if (isRoot && componentInstance) {
      next.componentInstance = { ...componentInstance };
    } else {
      delete next.componentInstance;
    }

    return next;
  });
}

function preserveComponentRootPlacement(nextRoot, currentRoot) {
  if (!nextRoot || !currentRoot) return nextRoot;
  const layoutKeys = [
    'x', 'y', 'width', 'height', 'rotation',
    'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
    'minW', 'maxW', 'minH', 'maxH',
    'hidden', 'locked', 'positionType', 'absoluteInLayout', 'constraints',
  ];
  const result = {
    ...nextRoot,
    parentId: currentRoot.parentId ?? null,
    base: { ...nextRoot.base, ...pick(currentRoot.base ?? {}, layoutKeys) },
    componentInstance: currentRoot.componentInstance ? { ...currentRoot.componentInstance } : nextRoot.componentInstance,
    overrides: deepClone(nextRoot.overrides ?? { tablet: {}, mobile: {} }),
  };

  ['tablet', 'mobile'].forEach((bpId) => {
    const preserved = pick(currentRoot.overrides?.[bpId] ?? {}, [
      'x', 'y', 'width', 'height', 'rotation',
      'widthMode', 'heightMode', 'widthPct', 'heightPct', 'widthFr', 'heightFr',
      'minW', 'maxW', 'minH', 'maxH',
      'hidden', 'positionType', 'absoluteInLayout', 'constraints',
    ]);
    if (Object.keys(preserved).length) {
      result.overrides = {
        ...result.overrides,
        [bpId]: {
          ...(result.overrides?.[bpId] ?? {}),
          ...preserved,
        },
      };
    }
  });

  return result;
}

function replaceSubtree(elements, rootId, nextSubtree) {
  const currentRoot = findEl(elements, rootId);
  if (!currentRoot || !nextSubtree.length) return elements;

  const toDelete = new Set();
  const visit = (id) => {
    toDelete.add(id);
    const el = findEl(elements, id);
    (el?.children ?? []).forEach(visit);
  };
  visit(rootId);

  const rootNext = getSnapshotRoot(nextSubtree);
  const rootOrder = elements.filter(el => !el.parentId).map(el => el.id);
  const rootInsertIndex = currentRoot.parentId == null ? rootOrder.indexOf(rootId) : -1;
  const filtered = elements
    .filter(el => !toDelete.has(el.id))
    .map(el => ({ ...el, children: (el.children ?? []).filter(cid => !toDelete.has(cid) || cid === rootId) }));

  const replaced = filtered.map((el) => {
    if (el.id !== currentRoot.parentId) return el;
    const existing = (el.children ?? []).filter(cid => cid !== rootId);
    const insertIndex = (currentRoot.parentId ? (el.children ?? []).indexOf(rootId) : -1);
    const nextChildren = [...existing];
    if (insertIndex >= 0) nextChildren.splice(insertIndex, 0, rootNext.id);
    else nextChildren.push(rootNext.id);
    return { ...el, children: nextChildren };
  });

  if (currentRoot.parentId == null) {
    const rootIdsAfter = replaced.filter(el => !el.parentId).map(el => el.id);
    const insertionIndex = rootInsertIndex >= 0 ? Math.min(rootInsertIndex, rootIdsAfter.length) : rootIdsAfter.length;
    const rootIdSet = new Set(rootIdsAfter);
    const rootEntries = replaced.filter(el => !el.parentId);
    const nestedEntries = replaced.filter(el => el.parentId);
    const nextRootEntries = nextSubtree.filter(el => !el.parentId);
    const nextNestedEntries = nextSubtree.filter(el => el.parentId);
    const orderedRoots = [...rootEntries];
    orderedRoots.splice(insertionIndex, 0, ...nextRootEntries);
    return [...orderedRoots, ...nestedEntries, ...nextNestedEntries.filter(el => !rootIdSet.has(el.id))];
  }

  return replaced.concat(nextSubtree);
}

function upsertComponent(components, component) {
  const exists = components.some(item => item.id === component.id);
  if (exists) return components.map(item => item.id === component.id ? component : item);
  return [...components, component];
}

// ── History helpers ──────────────────────────────────────────

function snapshot(pages) { return JSON.stringify(pages); }
const MAX_HISTORY = 60;

// ── Store ────────────────────────────────────────────────────

export const useEditorStore = create((set, get) => {
  // Helper: update elements array of current page
  const withPage = (updater) =>
    set(state => {
      if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
        return {
          componentEditor: {
            ...state.componentEditor,
            page: {
              ...state.componentEditor.page,
              elements: updater(state.componentEditor.page?.elements ?? []),
            },
          },
        };
      }
      return {
        pages: state.pages.map(p =>
          p.id === state.currentPageId ? { ...p, elements: updater(p.elements) } : p
        ),
      };
    });

  const getEls = () => {
    const s = get();
    if (s.activeSurface === 'component' && s.componentEditor?.isOpen) {
      return s.componentEditor.page?.elements ?? [];
    }
    return s.pages.find(p => p.id === s.currentPageId)?.elements ?? [];
  };

  const getActivePage = () => {
    const s = get();
    if (s.activeSurface === 'component' && s.componentEditor?.isOpen) return s.componentEditor.page;
    return s.pages.find(p => p.id === s.currentPageId) ?? s.pages[0];
  };

  return {
    // ── Viewport ───────────────────────────────────────────
    viewport: { x: 80, y: 80, scale: 0.55 },
    setViewport: (vp) => set(state => ({
      viewport: typeof vp === 'function' ? vp(state.viewport) : vp,
    })),

    // ── Pages ──────────────────────────────────────────────
    pages: [makeDefaultPage()],
    currentPageId: 'page-1',
    breakpointDefs: BREAKPOINTS,
    activeSurface: 'page',
    componentEditor: makeEmptyComponentEditor(),

    // ── Color styles (site-wide) ───────────────────────────
    colorStyles: [],
    setColorStyles: (styles) => set({ colorStyles: styles }),

    // ── Components (site-wide) ─────────────────────────────
    components: [],
    setComponents: (components) => set({ components }),

    async loadComponents() {
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'components?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
          if (data.success && Array.isArray(data.components)) {
            set({ components: data.components.map(normalizeStoredComponent) });
          }
        } else {
          const stored = localStorage.getItem('fb_component_library');
          if (stored) set({ components: JSON.parse(stored).map(normalizeStoredComponent) });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadComponents failed', e);
      }
    },

    async saveComponents(components) {
      const normalizedComponents = components.map(normalizeStoredComponent);
      set({ components: normalizedComponents });
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'components?_wpnonce=' + encodeURIComponent(nonce);
          await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ components: normalizedComponents }),
          });
        } else {
          localStorage.setItem('fb_component_library', JSON.stringify(normalizedComponents));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveComponents failed', e);
      }
    },

    createComponentFromElement(elementId, name) {
      const elements = get().pages.find(p => p.id === get().currentPageId)?.elements ?? [];
      const rootEl = findEl(elements, elementId);
      if (!rootEl) return null;
      const activeBpId = get().selection?.bpId ?? 'desktop';
      const resolvedRoot = resolveElement(rootEl, activeBpId);

      const subtree = collectSubtree(elements, elementId);
      const componentId = makeId('cmp');
      const now = Date.now();
      const component = {
        id: componentId,
        name: name?.trim() || rootEl.name || 'Component',
        createdAt: now,
        updatedAt: now,
        snapshot: normalizeComponentSnapshot(subtree, elementId),
      };

      const nextComponents = upsertComponent(get().components, component);
      get().saveComponents(nextComponents);

      const instantiated = instantiateComponentSnapshot(component.snapshot, {
        targetRootId: elementId,
        targetParentId: rootEl.parentId ?? null,
        rootPosition: { x: resolvedRoot.x ?? rootEl.base?.x ?? 0, y: resolvedRoot.y ?? rootEl.base?.y ?? 0 },
        bpId: activeBpId,
        componentInstance: { componentId, role: 'main' },
      });
      const wrapperRoot = getSnapshotRoot(instantiated);
      const patched = instantiated.map((el) => (
        el.id === wrapperRoot?.id ? preserveComponentRootPlacement(el, rootEl) : el
      ));
      withPage(els => replaceSubtree(els, elementId, patched));
      set({ selection: { elementId, bpId: get().selection?.bpId ?? 'desktop' }, artboardSel: null });

      return { componentId };
    },

    insertComponentInstance(componentId, { x = 80, y = 80, bpId = 'desktop', parentId = null } = {}) {
      const component = get().components.find(item => item.id === componentId);
      if (!component?.snapshot?.length) return null;

      const instantiated = instantiateComponentSnapshot(ensureComponentPrimaryRoot(component.snapshot), {
        targetParentId: parentId,
        rootPosition: { x, y },
        bpId,
        componentInstance: { componentId, role: 'instance' },
      });
      const root = getSnapshotRoot(instantiated);
      if (!root) return null;

      withPage((els) => {
        let next = [...els, ...instantiated];
        if (parentId) {
          next = next.map(el => (
            el.id === parentId
              ? { ...el, children: [...(el.children ?? []), root.id] }
              : el
          ));
        }
        return next;
      });
      set({ selection: { elementId: root.id, bpId } });
      return root.id;
    },

    applyComponentToInstances(componentId) {
      const component = get().components.find(item => item.id === componentId);
      if (!component?.snapshot?.length) return;
      const normalizedSnapshot = ensureComponentPrimaryRoot(component.snapshot);

      withPage((els) => {
        let nextEls = els;
        const roots = nextEls.filter(el => el.componentInstance?.componentId === componentId);
        roots.forEach((rootEl) => {
          const instantiated = instantiateComponentSnapshot(normalizedSnapshot, {
            targetRootId: rootEl.id,
            targetParentId: rootEl.parentId ?? null,
            componentInstance: { ...(rootEl.componentInstance ?? {}), componentId },
          });
          const rootNext = getSnapshotRoot(instantiated);
          if (!rootNext) return;
          const patched = instantiated.map(el => (
            el.id === rootNext.id ? preserveComponentRootPlacement(el, rootEl) : el
          ));
          nextEls = replaceSubtree(nextEls, rootEl.id, patched);
        });
        return nextEls;
      });
    },

    deleteComponent(componentId) {
      const nextComponents = get().components.filter(component => component.id !== componentId);
      get().saveComponents(nextComponents);
      withPage((els) => els.map((el) => {
        if (el.componentInstance?.componentId !== componentId) return el;
        const next = { ...el };
        delete next.componentInstance;
        return next;
      }));

      const state = get();
      if (state.componentEditor?.isOpen && state.componentEditor.componentId === componentId) {
        set({
          activeSurface: 'page',
          selection: state.componentEditor.uiRestore?.selection ?? null,
          artboardSel: state.componentEditor.uiRestore?.artboardSel ?? null,
          hoveredId: state.componentEditor.uiRestore?.hoveredId ?? null,
          drilledContainerId: state.componentEditor.uiRestore?.drilledContainerId ?? null,
          pendingDraw: state.componentEditor.uiRestore?.pendingDraw ?? null,
          leftTab: state.componentEditor.uiRestore?.leftTab ?? 'layers',
          breakpointDefs: state.componentEditor.uiRestore?.breakpointDefs ?? BREAKPOINTS,
          componentEditor: makeEmptyComponentEditor(),
        });
      }
    },

    openComponentEditor(componentId) {
      const component = get().components.find(item => item.id === componentId);
      if (!component) return;
      const normalizedComponent = normalizeStoredComponent(component);
      const componentBreakpoints = makeComponentEditorBreakpoints(normalizedComponent.snapshot ?? []);

      const state = get();
      const uiRestore = {
        selection: state.selection,
        artboardSel: state.artboardSel,
        hoveredId: state.hoveredId,
        drilledContainerId: state.drilledContainerId,
        pendingDraw: state.pendingDraw,
        leftTab: state.leftTab,
        breakpointDefs: deepClone(state.breakpointDefs),
      };

      set({
        activeSurface: 'component',
        breakpointDefs: deepClone(componentBreakpoints),
        leftTab: 'layers',
        selection: null,
        artboardSel: null,
        hoveredId: null,
        drilledContainerId: null,
        pendingDraw: null,
        componentEditor: {
          isOpen: true,
          componentId,
          page: {
            ...makeComponentEditorPage(),
            title: normalizedComponent.name,
            elements: deepClone(normalizedComponent.snapshot ?? []),
          },
          breakpointDefs: deepClone(componentBreakpoints),
          uiRestore,
        },
      });
    },

    closeComponentEditor() {
      const state = get();
      if (state.activeSurface !== 'component' || !state.componentEditor?.isOpen) return;
      const current = state.componentEditor;
      const nextComponents = state.components.map(component => (
        component.id === current.componentId
          ? { ...component, updatedAt: Date.now(), snapshot: ensureComponentPrimaryRoot(current.page.elements ?? []) }
          : component
      ));
      set({
        activeSurface: 'page',
        selection: current.uiRestore?.selection ?? null,
        artboardSel: current.uiRestore?.artboardSel ?? null,
        hoveredId: current.uiRestore?.hoveredId ?? null,
        drilledContainerId: current.uiRestore?.drilledContainerId ?? null,
        pendingDraw: current.uiRestore?.pendingDraw ?? null,
        leftTab: current.uiRestore?.leftTab ?? 'layers',
        breakpointDefs: current.uiRestore?.breakpointDefs ?? BREAKPOINTS,
        componentEditor: makeEmptyComponentEditor(),
      });
      get().saveComponents(nextComponents);
      get().applyComponentToInstances(current.componentId);
    },

    async loadColorStyles() {
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'color-styles?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
          if (data.success && Array.isArray(data.styles)) {
            set({ colorStyles: data.styles });
          }
        } else {
          const stored = localStorage.getItem('fb_color_styles');
          if (stored) set({ colorStyles: JSON.parse(stored) });
        }
      } catch (e) {
        console.error('[FrameBuilder] loadColorStyles failed', e);
      }
    },

    async saveColorStyles(styles) {
      set({ colorStyles: styles });
      try {
        if (window.fbData?.restUrl) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'color-styles?_wpnonce=' + encodeURIComponent(nonce);
          await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ styles }),
          });
        } else {
          localStorage.setItem('fb_color_styles', JSON.stringify(styles));
        }
      } catch (e) {
        console.error('[FrameBuilder] saveColorStyles failed', e);
      }
    },

    // ── UI state ───────────────────────────────────────────
    leftTab: 'layers',
    setLeftTab: (tab) => set({ leftTab: tab }),
    selection: null,   // { elementId, bpId }
    setSelection: (sel) => set({ selection: sel }),
    hoveredId: null,   // elementId hovered in layers panel
    setHoveredId: (id) => set({ hoveredId: id }),
    drilledContainerId: null, // element whose direct children are single-click selectable (null = artboard root)
    setDrilledContainerId: (id) => set({ drilledContainerId: id }),
    artboardSel: null, // bpId of the currently selected artboard
    setArtboardSel: (bpId) => set({ artboardSel: bpId }),
    pendingDraw: null, // 'frame' | 'image' | null — click-to-draw mode
    setPendingDraw: (type) => set({ pendingDraw: type }),
    interacting: false,
    setInteracting: (v) => set({ interacting: v }),
    saveStatus: null,
    setSaveStatus: (s) => set({ saveStatus: s }),

    // ── Getters ────────────────────────────────────────────
    getCurrentPage() {
      return getActivePage();
    },
    getAllElements() { return getEls(); },
    getRootElements() { return getRootElements(getEls()); },
    getChildElements(parentId) { return getChildEls(getEls(), parentId); },
    getSelectedElement() {
      const { selection } = get();
      if (!selection) return null;
      return findEl(getEls(), selection.elementId) ?? null;
    },

    // ── Element mutations ──────────────────────────────────

    /** Add element. If bpId is non-desktop, element is hidden by default everywhere
     *  except the originating breakpoint. */
    addElement(element, parentId = null, bpId = 'desktop') {
      let el = { ...element, parentId: parentId ?? null };
      if (bpId && bpId !== 'desktop') {
        // Hide on all breakpoints via base, then show only on originating bp
        el = {
          ...el,
          base: { ...el.base, hidden: true },
          overrides: {
            ...el.overrides,
            [bpId]: { ...(el.overrides?.[bpId] ?? {}), hidden: false },
          },
        };
      }
      withPage(els => {
        const next = [...els, el];
        if (parentId) {
          return next.map(e =>
            e.id === parentId ? { ...e, children: [...(e.children ?? []), el.id] } : e
          );
        }
        return next;
      });
      set({ selection: { elementId: el.id, bpId: bpId ?? 'desktop' } });
    },

    /** Update base (desktop) non-style props: name, locked, etc. */
    updateElementBase(elementId, updates) {
      withPage(els =>
        els.map(el => el.id === elementId ? { ...el, base: { ...el.base, ...updates } } : el)
      );
    },

    /** Update style props for a breakpoint.
     *  Desktop → base.styles. Tablet/Mobile → overrides[bpId].styles */
    updateElementStyles(elementId, bpId, styleUpdates) {
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        if (bpId === 'desktop') {
          return { ...el, base: { ...el.base, styles: { ...el.base.styles, ...styleUpdates } } };
        }
        const ov = el.overrides?.[bpId] ?? {};
        return {
          ...el,
          overrides: {
            ...el.overrides,
            [bpId]: { ...ov, styles: { ...(ov.styles ?? {}), ...styleUpdates } },
          },
        };
      }));
    },

    /** Update layout props (x,y,w,h,rotation,hidden,locked) for a breakpoint.
     *  Desktop → base. Tablet/Mobile → overrides[bpId]. */
    updateElementLayout(elementId, bpId, updates) {
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        if (bpId === 'desktop') return { ...el, base: { ...el.base, ...updates } };
        const ov = el.overrides?.[bpId] ?? {};
        return { ...el, overrides: { ...el.overrides, [bpId]: { ...ov, ...updates } } };
      }));
      if (updates?.hidden === true) {
        const currentDrilled = get().drilledContainerId;
        const nextUiState = {};
        if (currentDrilled === elementId) {
          nextUiState.drilledContainerId = null;
        }
        if (Object.keys(nextUiState).length) {
          set(nextUiState);
        }
      }
    },

    /** Remove a per-breakpoint override key, reverting to desktop value */
    removeOverride(elementId, bpId, key) {
      if (bpId === 'desktop') return;
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        const ov = { ...(el.overrides?.[bpId] ?? {}) };
        delete ov[key];
        return { ...el, overrides: { ...el.overrides, [bpId]: ov } };
      }));
    },

    /** Remove a per-breakpoint style key, reverting to desktop value */
    removeStyleOverride(elementId, bpId, styleKey) {
      if (bpId === 'desktop') return;
      withPage(els => els.map(el => {
        if (el.id !== elementId) return el;
        const ov     = { ...(el.overrides?.[bpId] ?? {}) };
        const styles = { ...(ov.styles ?? {}) };
        delete styles[styleKey];
        return { ...el, overrides: { ...el.overrides, [bpId]: { ...ov, styles } } };
      }));
    },

    /** Delete element and all its descendants */
    deleteElement(elementId) {
      const els = getEls();
      const toDelete = new Set();
      const collect = (id) => {
        toDelete.add(id);
        const el = findEl(els, id);
        (el?.children ?? []).forEach(collect);
      };
      collect(elementId);
      withPage(currEls => currEls
        .filter(e => !toDelete.has(e.id))
        .map(e => ({ ...e, children: (e.children ?? []).filter(c => !toDelete.has(c)) }))
      );
      set(state => ({
        selection: toDelete.has(state.selection?.elementId) ? null : state.selection,
      }));
    },

    /** Update artboard position/size/name in breakpointDefs */
    updateBreakpointDef(bpId, updates) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            breakpointDefs: {
              ...state.componentEditor.breakpointDefs,
              [bpId]: { ...state.componentEditor.breakpointDefs[bpId], ...updates },
            },
            componentEditor: {
              ...state.componentEditor,
              breakpointDefs: {
                ...state.componentEditor.breakpointDefs,
                [bpId]: { ...state.componentEditor.breakpointDefs[bpId], ...updates },
              },
            },
          };
        }
        return {
          breakpointDefs: {
            ...state.breakpointDefs,
            [bpId]: { ...state.breakpointDefs[bpId], ...updates },
          },
        };
      });
    },

    /** Update page background color for a specific breakpoint */
    setPageBackground(bpId, color) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                background: { ...state.componentEditor.page.background, [bpId]: color },
              },
            },
          };
        }
        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? { ...p, background: { ...p.background, [bpId]: color } }
              : p
          ),
        };
      });
    },

    /** Update page padding for a specific breakpoint (null = inherit from parent) */
    setPagePadding(bpId, padObj) {
      set(state => {
        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                padding: { ...(state.componentEditor.page.padding ?? {}), [bpId]: padObj },
              },
            },
          };
        }
        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? { ...p, padding: { ...(p.padding ?? {}), [bpId]: padObj } }
              : p
          ),
        };
      });
    },

    /** Update page layout for a specific breakpoint (null = inherit / disabled) */
    setPageLayout(bpId, layoutObj) {
      set(state => {
        const normalizeElements = (elements) => (
          layoutObj == null ? elements : elements.map(el => {
            const resolved = resolveElement(el, bpId);
            const shouldNormalizeToFlow = !el.parentId
              && !resolved.absoluteInLayout
              && resolved.positionType !== 'fixed'
              && resolved.positionType !== 'relative';
            if (!shouldNormalizeToFlow) return el;
            if (bpId === 'desktop') {
              return { ...el, base: { ...el.base, positionType: 'relative' } };
            }
            const ov = el.overrides?.[bpId] ?? {};
            return {
              ...el,
              overrides: {
                ...el.overrides,
                [bpId]: { ...ov, positionType: 'relative' },
              },
            };
          })
        );

        if (state.activeSurface === 'component' && state.componentEditor?.isOpen) {
          return {
            componentEditor: {
              ...state.componentEditor,
              page: {
                ...state.componentEditor.page,
                layout: { ...(state.componentEditor.page.layout ?? {}), [bpId]: layoutObj },
                elements: normalizeElements(state.componentEditor.page.elements ?? []),
              },
            },
          };
        }

        return {
          pages: state.pages.map(p =>
            p.id === state.currentPageId
              ? {
                  ...p,
                  layout: { ...(p.layout ?? {}), [bpId]: layoutObj },
                  elements: normalizeElements(p.elements),
                }
              : p
          ),
        };
      });
    },

    toggleElementVisibility(elementId, bpId) {
      const el = findEl(getEls(), elementId);
      if (!el) return;
      const resolved = resolveElement(el, bpId);
      get().updateElementLayout(elementId, bpId, { hidden: !resolved.hidden });
    },

    /** Reorder element among its siblings (same parent or root).
     *  newIndex is 0-based among siblings excluding the element itself. */
    reorderElementInParent(elementId, newIndex) {
      withPage(els => {
        const el = findEl(els, elementId);
        if (!el) return els;
        const parentId = el.parentId;
        if (parentId) {
          return els.map(e => {
            if (e.id !== parentId) return e;
            const children = [...(e.children ?? [])];
            const cur = children.indexOf(elementId);
            if (cur === -1) return e;
            children.splice(cur, 1);
            children.splice(Math.min(Math.max(0, newIndex), children.length), 0, elementId);
            return { ...e, children };
          });
        } else {
          const without = els.filter(e => e.id !== elementId);
          let rootCount = 0;
          let insertAt = without.length;
          for (let i = 0; i < without.length; i++) {
            if (!without[i].parentId) {
              if (rootCount === newIndex) { insertAt = i; break; }
              rootCount++;
            }
          }
          const result = [...without];
          result.splice(insertAt, 0, el);
          return result;
        }
      });
    },

    /** Bulk-add a flat array of pre-cloned elements (for paste). */
    addElements(elements) {
      withPage(els => [...els, ...elements]);
    },

    /** Move element under a new parent (or null = root). Prevents circular nesting. */
    reparentElement(elementId, newParentId) {
      if (elementId === newParentId) return;
      withPage(els => {
        // Guard: collect descendants to prevent circular
        const descendants = new Set();
        const collect = (id) => {
          descendants.add(id);
          const e = findEl(els, id);
          (e?.children ?? []).forEach(collect);
        };
        collect(elementId);
        if (newParentId && descendants.has(newParentId)) return els;

        const el = findEl(els, elementId);
        if (!el) return els;
        const oldParentId = el.parentId;

        return els.map(e => {
          if (e.id === elementId) return { ...e, parentId: newParentId ?? null };
          if (e.id === oldParentId) {
            return { ...e, children: (e.children ?? []).filter(c => c !== elementId) };
          }
          if (newParentId && e.id === newParentId) {
            return { ...e, children: [...(e.children ?? []), elementId] };
          }
          return e;
        });
      });
    },

    /** Eject element to root. Assigns a canvas position if the element had none (e.g. was relative/nested).
     *  toOffCanvas=true places it beyond the artboard right edge. */
    ejectElement(elementId, { toOffCanvas = false, artboardWidth = 1440 } = {}) {
      const el = findEl(getEls(), elementId);
      if (!el) return;
      const wasNested = !!el.parentId;
      const hasX = el.base.x != null;
      const hasY = el.base.y != null;
      get().reparentElement(elementId, null);
      if (wasNested && (!hasX || !hasY)) {
        get().updateElementLayout(elementId, 'desktop', {
          x: toOffCanvas ? artboardWidth + 80 : 40,
          y: 40,
          width: el.base.width ?? 200,
          height: el.base.height ?? 80,
        });
      } else if (toOffCanvas && hasX) {
        get().updateElementLayout(elementId, 'desktop', { x: artboardWidth + 80 });
      }
    },

    // ── History ────────────────────────────────────────────
    history: [],
    historyIndex: -1,

    pushHistory() {
      const snap = snapshot(get().pages);
      set(state => {
        const trimmed = state.history.slice(0, state.historyIndex + 1);
        const next = [...trimmed, snap].slice(-MAX_HISTORY);
        return { history: next, historyIndex: next.length - 1 };
      });
    },

    undo() {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      set({ pages: JSON.parse(history[historyIndex - 1]), historyIndex: historyIndex - 1 });
    },

    redo() {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      set({ pages: JSON.parse(history[historyIndex + 1]), historyIndex: historyIndex + 1 });
    },

    // ── Persist / Load / Publish ───────────────────────────

    async saveLayout() {
      const state = get();
      const page = state.pages.find(p => p.id === state.currentPageId);
      get().setSaveStatus('saving');
      // wp_localize_script converts everything to strings, so postId is "0" not 0
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const nonce = window.fbData.nonce;
          // Send nonce both as header AND as _wpnonce URL param (Nginx may strip custom headers)
          const url = window.fbData.restUrl + 'save-layout?_wpnonce=' + encodeURIComponent(nonce);
          const payload = { ...page, _breakpointDefs: state.breakpointDefs };
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ post_id: postId, layout: payload }),
          });
          const data = await res.json();
          get().setSaveStatus(data.success ? 'ok' : 'error');
        } else {
          const payload = { ...page, _breakpointDefs: state.breakpointDefs };
          localStorage.setItem('fb_layout_' + page.id, JSON.stringify(payload));
          get().setSaveStatus('ok');
        }
      } catch (err) {
        console.error('[FrameBuilder] save failed', err);
        get().setSaveStatus('error');
      }
      setTimeout(() => get().setSaveStatus(null), 2500);
    },

    async loadLayout() {
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'get-layout/' + postId + '?_wpnonce=' + encodeURIComponent(nonce);
          const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': nonce },
          });
          const data = await res.json();
          if (data.success && data.layout) {
            const { _breakpointDefs, ...cleanLayout } = data.layout;
            set(state => ({
              pages: state.pages.map(p =>
                p.id === state.currentPageId
                  ? { ...cleanLayout, id: state.currentPageId }
                  : p
              ),
              ...(_breakpointDefs ? { breakpointDefs: _breakpointDefs } : {}),
            }));
          }
        } else {
          const stored = localStorage.getItem('fb_layout_page-1');
          if (stored) {
            const { _breakpointDefs, ...cleanLayout } = JSON.parse(stored);
            set(state => ({
              pages: state.pages.map(p =>
                p.id === state.currentPageId ? { ...cleanLayout, id: state.currentPageId } : p
              ),
              ...(_breakpointDefs ? { breakpointDefs: _breakpointDefs } : {}),
            }));
          }
        }
      } catch (err) {
        console.warn('[FrameBuilder] loadLayout failed', err);
      }
    },

    async publishLayout() {
      const state = get();
      const page = state.pages.find(p => p.id === state.currentPageId);
      get().setSaveStatus('saving');
      const postId = parseInt(window.fbData?.postId, 10);
      try {
        if (window.fbData && postId > 0) {
          const nonce = window.fbData.nonce;
          const url = window.fbData.restUrl + 'publish?_wpnonce=' + encodeURIComponent(nonce);
          const publishPayload = { ...page, _breakpointDefs: state.breakpointDefs };
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            body: JSON.stringify({ post_id: postId, layout: publishPayload }),
          });
          const data = await res.json();
          get().setSaveStatus(data.success ? 'ok' : 'error');
          if (data.success && data.permalink) window.open(data.permalink, '_blank');
        } else {
          get().setSaveStatus('ok');
        }
      } catch (err) {
        console.error('[FrameBuilder] publish failed', err);
        get().setSaveStatus('error');
      }
      setTimeout(() => get().setSaveStatus(null), 3000);
    },
  };
});
