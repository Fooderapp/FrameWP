import { create } from 'zustand';

// ── Breakpoint definitions ────────────────────────────────────

const BREAKPOINTS = {
  desktop: { id: 'desktop', name: 'Desktop', icon: '🖥', width: 1440, height: 900, x: 100,  y: 120 },
  tablet:  { id: 'tablet',  name: 'Tablet',  icon: '📟', width: 768,  height: 1024, x: 1600, y: 120 },
  mobile:  { id: 'mobile',  name: 'Mobile',  icon: '📱', width: 375,  height: 812,  x: 2440, y: 120 },
};

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
  elements: [],
});

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
        paddingLeft: 0, alignItems: 'flex-start', justifyContent: 'flex-start', boxShadow: '',
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
export function getChildEls(elements, parentId) { return elements.filter(e => e.parentId === parentId); }
export function findEl(elements, id) { return elements.find(e => e.id === id) ?? null; }

// ── History helpers ──────────────────────────────────────────

function snapshot(pages) { return JSON.stringify(pages); }
const MAX_HISTORY = 60;

// ── Store ────────────────────────────────────────────────────

export const useEditorStore = create((set, get) => {
  // Helper: update elements array of current page
  const withPage = (updater) =>
    set(state => ({
      pages: state.pages.map(p =>
        p.id === state.currentPageId ? { ...p, elements: updater(p.elements) } : p
      ),
    }));

  const getEls = () => {
    const s = get();
    return s.pages.find(p => p.id === s.currentPageId)?.elements ?? [];
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

    // ── UI state ───────────────────────────────────────────
    leftTab: 'layers',
    setLeftTab: (tab) => set({ leftTab: tab }),
    selection: null,   // { elementId, bpId }
    setSelection: (sel) => set({ selection: sel }),
    hoveredId: null,   // elementId hovered in layers panel
    setHoveredId: (id) => set({ hoveredId: id }),
    artboardSel: null, // bpId of the currently selected artboard
    setArtboardSel: (bpId) => set({ artboardSel: bpId }),
    interacting: false,
    setInteracting: (v) => set({ interacting: v }),
    saveStatus: null,
    setSaveStatus: (s) => set({ saveStatus: s }),

    // ── Getters ────────────────────────────────────────────
    getCurrentPage() {
      const s = get();
      return s.pages.find(p => p.id === s.currentPageId) ?? s.pages[0];
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
      set({ selection: { elementId: el.id, bpId: 'desktop' } });
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
      set(state => ({
        breakpointDefs: {
          ...state.breakpointDefs,
          [bpId]: { ...state.breakpointDefs[bpId], ...updates },
        },
      }));
    },

    /** Update page background color for a specific breakpoint */
    setPageBackground(bpId, color) {
      set(state => ({
        pages: state.pages.map(p =>
          p.id === state.currentPageId
            ? { ...p, background: { ...p.background, [bpId]: color } }
            : p
        ),
      }));
    },

    /** Update page padding for a specific breakpoint (null = inherit from parent) */
    setPagePadding(bpId, padObj) {
      set(state => ({
        pages: state.pages.map(p =>
          p.id === state.currentPageId
            ? { ...p, padding: { ...(p.padding ?? {}), [bpId]: padObj } }
            : p
        ),
      }));
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
