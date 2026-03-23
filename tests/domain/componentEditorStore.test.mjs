import test from 'node:test';
import assert from 'node:assert/strict';

import { useEditorStore } from '../../src/store/editorStore.js';

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
};

const windowStub = {
  fbData: null,
  localStorage: memoryStorage(),
  addEventListener() {},
  removeEventListener() {},
};

global.window = windowStub;
global.localStorage = windowStub.localStorage;

function resetStore() {
  useEditorStore.setState({
    pages: [{
      id: 'page-1',
      title: 'Page',
      background: { desktop: '#ffffff', tablet: null, mobile: null },
      smoothScroll: { desktop: false, tablet: null, mobile: null },
      padding: { desktop: { top: 0, right: 0, bottom: 0, left: 0 }, tablet: null, mobile: null },
      layout: { desktop: null, tablet: null, mobile: null },
      elements: [],
      variables: [],
      flows: [],
      comments: [],
    }],
    currentPageId: 'page-1',
    activeSurface: 'page',
    selection: null,
    artboardSel: null,
    hoveredId: null,
    layerHoveredId: null,
    drilledContainerId: null,
    pendingDraw: null,
    leftTab: 'layers',
    history: [],
    historyIndex: -1,
    componentHistory: [],
    componentHistoryIndex: -1,
    components: [],
  });
  window.localStorage.clear();
}

test('component editor round-trips a new variant back into the component library', async () => {
  resetStore();

  const component = {
    id: 'cmp-1',
    name: 'Button',
    defaultVariantId: 'variant-primary',
    controls: [],
    variants: [{
      id: 'variant-primary',
      name: 'Primary',
      mode: 'default',
      parentVariantId: null,
      interaction: null,
      snapshot: [{
        id: 'root-1',
        type: 'frame',
        name: 'Primary',
        parentId: null,
        children: ['text-1'],
        componentRoot: true,
        base: {
          x: 0,
          y: 0,
          width: 180,
          height: 56,
          rotation: 0,
          hidden: false,
          locked: false,
          widthMode: 'fixed',
          heightMode: 'fixed',
          widthPct: null,
          heightPct: null,
          widthFr: 1,
          heightFr: 1,
          lockAspectRatio: false,
          minW: null,
          maxW: null,
          minH: null,
          maxH: null,
          constraints: { horizontal: 'left', vertical: 'top', top: true, left: true, right: false, bottom: false },
          styles: {
            backgroundColor: '#111111',
            borderRadius: 12,
            borderWidth: 0,
            borderColor: 'transparent',
            borderStyle: 'solid',
            opacity: 1,
            mixBlendMode: 'normal',
            overflow: 'visible',
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'nowrap',
            gap: 0,
            paddingTop: 0,
            paddingRight: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '',
            zIndex: 1,
          },
        },
        overrides: { tablet: {}, mobile: {} },
      }, {
        id: 'text-1',
        type: 'text',
        name: 'Label',
        parentId: 'root-1',
        children: [],
        base: {
          x: 24,
          y: 16,
          width: 132,
          height: 24,
          rotation: 0,
          hidden: false,
          styles: {
            color: '#ffffff',
            fontFamily: 'Inter',
            fontWeight: 600,
            fontSize: 16,
            fontSizeUnit: 'px',
            lineHeight: 1.2,
            lineHeightUnit: 'em',
            letterSpacing: 0,
            letterSpacingUnit: 'em',
            textAlign: 'center',
            textDecoration: 'none',
          },
          text: 'Button',
          richTextHtml: '<p>Button</p>',
        },
        overrides: { tablet: {}, mobile: {} },
      }],
    }],
    snapshot: [],
    createdAt: 1,
    updatedAt: 1,
  };

  useEditorStore.setState({ components: [component] });

  const store = useEditorStore.getState();
  store.openComponentEditor('cmp-1');

  let state = useEditorStore.getState();
  assert.equal(state.activeSurface, 'component');
  assert.equal(state.componentEditor.isOpen, true);
  assert.equal(state.componentEditor.variants.length, 1);
  assert.equal(state.componentHistory.length, 1);

  store.addComponentVariant();

  state = useEditorStore.getState();
  assert.equal(state.componentEditor.variants.length, 2);
  assert.equal(state.componentEditor.activeVariantId, state.componentEditor.variants[1].id);
  assert.equal(state.componentEditor.page.elements.some((element) => element.componentEditorVariantId === state.componentEditor.variants[1].id), true);

  store.closeComponentEditor();

  await new Promise((resolve) => setTimeout(resolve, 0));

  state = useEditorStore.getState();
  assert.equal(state.activeSurface, 'page');
  assert.equal(state.componentEditor.isOpen, false);
  assert.equal(state.components.length, 1);
  assert.equal(state.components[0].variants.length, 2);
  assert.equal(state.components[0].variants[1].mode, 'default');
  assert.equal(Array.isArray(state.components[0].variants[1].snapshot), true);

  const persisted = JSON.parse(window.localStorage.getItem('fb_component_library'));
  assert.equal(Array.isArray(persisted), true);
  assert.equal(persisted[0].variants.length, 2);
  assert.equal(Array.isArray(persisted[0].variants[1].snapshot), true);
});