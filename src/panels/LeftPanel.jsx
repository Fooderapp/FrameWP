import React from 'react';
import { useEditorStore } from '../store/editorStore';
import LayersPanel from './LayersPanel';
import ComponentsPanel from './ComponentsPanel';
import { IconTab, UIIcons } from '../components/UIIcons';

export default function LeftPanel() {
  const tab    = useEditorStore(s => s.leftTab);
  const setTab = useEditorStore(s => s.setLeftTab);
  const activeSurface = useEditorStore(s => s.activeSurface);
  const showComponentsTab = activeSurface !== 'component';
  const effectiveTab = tab === 'elements' ? 'layers' : tab;

  return (
    <aside className="fb-left">
      <div className="fb-left__head">
        <span className="fb-left__label">Navigate</span>
      </div>
      <div className="fb-tabs">
        <IconTab active={effectiveTab === 'layers'} title="Layers" icon={UIIcons.layers} onClick={() => setTab('layers')} />
        {showComponentsTab ? <IconTab active={effectiveTab === 'components'} title="Components" icon={UIIcons.component} onClick={() => setTab('components')} /> : null}
      </div>

      <div className="fb-panel-body">
        {effectiveTab === 'layers' ? <LayersPanel /> : null}
        {showComponentsTab && effectiveTab === 'components' ? <ComponentsPanel /> : null}
      </div>
    </aside>
  );
}
