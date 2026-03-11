import React from 'react';
import { useEditorStore } from '../store/editorStore';
import LayersPanel from './LayersPanel';
import ElementsPanel from './ElementsPanel';
import ComponentsPanel from './ComponentsPanel';
import { IconTab, UIIcons } from '../components/UIIcons';

export default function LeftPanel() {
  const tab    = useEditorStore(s => s.leftTab);
  const setTab = useEditorStore(s => s.setLeftTab);

  return (
    <aside className="fb-left">
      <div className="fb-tabs">
        <IconTab active={tab === 'layers'} title="Layers" icon={UIIcons.layers} onClick={() => setTab('layers')} />
        <IconTab active={tab === 'elements'} title="Elements" icon={UIIcons.elements} onClick={() => setTab('elements')} />
        <IconTab active={tab === 'components'} title="Components" icon={UIIcons.component} onClick={() => setTab('components')} />
      </div>

      <div className="fb-panel-body">
        {tab === 'layers'   ? <LayersPanel />   : null}
        {tab === 'elements' ? <ElementsPanel /> : null}
        {tab === 'components' ? <ComponentsPanel /> : null}
      </div>
    </aside>
  );
}
