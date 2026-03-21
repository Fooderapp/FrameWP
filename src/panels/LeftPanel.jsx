import React from 'react';
import { useEditorStore } from '../store/editorStore';
import LayersPanel from './LayersPanel';
import ComponentsPanel from './ComponentsPanel';
import { IconTab, UIIcons } from '../components/UIIcons';

export default function LeftPanel() {
  const tab    = useEditorStore(s => s.leftTab);
  const setTab = useEditorStore(s => s.setLeftTab);
  const effectiveTab = tab === 'elements' ? 'layers' : tab;

  return (
    <aside className="fb-left">
      <div className="fb-left__panel fb-left__panel--simple">
        <div className="fb-tabs fb-left__tabs fb-left__tabs--icons">
          <IconTab active={effectiveTab === 'layers'} title="Layers" icon={UIIcons.layers} onClick={() => setTab('layers')} />
          <IconTab active={effectiveTab === 'components'} title="Assets" icon={UIIcons.component} onClick={() => setTab('components')} />
        </div>

        <div className="fb-panel-body fb-left__panel-body">
          {effectiveTab === 'layers' ? <LayersPanel /> : null}
          {effectiveTab === 'components' ? <ComponentsPanel /> : null}
        </div>
      </div>
    </aside>
  );
}
