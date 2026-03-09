import React from 'react';
import { useEditorStore } from '../store/editorStore';
import LayersPanel from './LayersPanel';
import ElementsPanel from './ElementsPanel';

export default function LeftPanel() {
  const tab    = useEditorStore(s => s.leftTab);
  const setTab = useEditorStore(s => s.setLeftTab);

  return (
    <aside className="fb-left">
      <div className="fb-tabs">
        <div
          className={`fb-tab${tab === 'layers' ? ' fb-tab--active' : ''}`}
          onClick={() => setTab('layers')}
        >
          Layers
        </div>
        <div
          className={`fb-tab${tab === 'elements' ? ' fb-tab--active' : ''}`}
          onClick={() => setTab('elements')}
        >
          Elements
        </div>
      </div>

      <div className="fb-panel-body">
        {tab === 'layers'   ? <LayersPanel />   : null}
        {tab === 'elements' ? <ElementsPanel /> : null}
      </div>
    </aside>
  );
}
