import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { IconButton, UIIcons } from './UIIcons';

const VARIABLE_TYPE_OPTIONS = [
  { value: 'string', label: 'String' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'color', label: 'Color' },
  { value: 'number', label: 'Number' },
  { value: 'image', label: 'Image' },
  { value: 'post', label: 'Post' },
  { value: 'product', label: 'Woo Product' },
];

function VariableField({ label, children }) {
  return (
    <label className="fb-variable-field">
      <span className="fb-variable-field__label">{label}</span>
      {children}
    </label>
  );
}

function VariableValueField({ variable, sources, onChange }) {
  if (variable.type === 'boolean') {
    return (
      <select className="fb-prop-input" value={variable.value ? 'true' : 'false'} onChange={(event) => onChange(event.target.value === 'true')}>
        <option value="false">False</option>
        <option value="true">True</option>
      </select>
    );
  }

  if (variable.type === 'color') {
    return <input className="fb-prop-input" type="color" value={variable.value || '#000000'} onChange={(event) => onChange(event.target.value)} />;
  }

  if (variable.type === 'image') {
    return <input className="fb-prop-input" type="url" placeholder="https://..." value={variable.value ?? ''} onChange={(event) => onChange(event.target.value)} />;
  }

  if (variable.type === 'number') {
    return <input className="fb-prop-input" type="number" value={variable.value ?? 0} onChange={(event) => onChange(parseFloat(event.target.value) || 0)} />;
  }

  if (variable.type === 'post' || variable.type === 'product') {
    const options = variable.type === 'product' ? sources.products : sources.posts;
    return (
      <select
        className="fb-prop-input"
        value={variable.value?.id || ''}
        onChange={(event) => {
          const next = options.find((entry) => String(entry.id) === event.target.value) || null;
          onChange(next ? { id: next.id, title: next.title, url: next.url, postType: next.postType } : null);
        }}
      >
        <option value="">Select…</option>
        {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
      </select>
    );
  }

  return <input className="fb-prop-input" type="text" value={variable.value ?? ''} onChange={(event) => onChange(event.target.value)} />;
}

function VariableRow({ variable, scope, sources, onChange, onRemove }) {
  return (
    <div className="fb-variable-row">
      <div className="fb-variable-row__main">
        <VariableField label="Name">
          <input className="fb-prop-input" type="text" value={variable.name} placeholder="Variable name" onChange={(event) => onChange({ ...variable, name: event.target.value })} />
        </VariableField>
        <VariableField label="Category">
          <input className="fb-prop-input" type="text" value={variable.category} placeholder="Category" onChange={(event) => onChange({ ...variable, category: event.target.value })} />
        </VariableField>
        <VariableField label="Type">
          <select className="fb-prop-input" value={variable.type} onChange={(event) => onChange({ ...variable, type: event.target.value, value: undefined })}>
            {VARIABLE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </VariableField>
      </div>
      <div className="fb-variable-row__main">
        <VariableField label="Default Value">
          <VariableValueField variable={variable} sources={sources} onChange={(value) => onChange({ ...variable, value })} />
        </VariableField>
        <VariableField label="Persistence">
          <label className="fb-variable-row__toggle">
            <input type="checkbox" checked={!!variable.persistent} onChange={(event) => onChange({ ...variable, persistent: event.target.checked })} />
            <span>Persistent</span>
          </label>
        </VariableField>
        <VariableField label="Scope">
          <div className="fb-variable-row__scope">{scope === 'global' ? 'Global' : 'Page'}</div>
        </VariableField>
        <IconButton icon={UIIcons.trash} title="Remove variable" onClick={onRemove} />
      </div>
    </div>
  );
}

export default function VariablesModal() {
  const currentPage = useEditorStore((state) => state.pages.find((page) => page.id === state.currentPageId) ?? null);
  const globalVariables = useEditorStore((state) => state.globalVariables);
  const variableSources = useEditorStore((state) => state.variableSources);
  const upsertPageVariable = useEditorStore((state) => state.upsertPageVariable);
  const removePageVariable = useEditorStore((state) => state.removePageVariable);
  const upsertGlobalVariable = useEditorStore((state) => state.upsertGlobalVariable);
  const removeGlobalVariable = useEditorStore((state) => state.removeGlobalVariable);
  const setVariablesModalOpen = useEditorStore((state) => state.setVariablesModalOpen);
  const pageVariables = Array.isArray(currentPage?.variables) ? currentPage.variables : [];

  const addVariable = (scope) => {
    const nextVariable = {
      scope,
      name: scope === 'global' ? 'Global Variable' : 'Page Variable',
      category: 'General',
      type: 'string',
      persistent: false,
      value: '',
    };
    if (scope === 'global') upsertGlobalVariable(nextVariable);
    else upsertPageVariable(nextVariable);
  };

  return (
    <div className="fb-overlay-modal" onMouseDown={() => setVariablesModalOpen(false)}>
      <div className="fb-overlay-modal__card fb-variables-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fb-overlay-modal__head">Variables</div>
        <div className="fb-overlay-modal__body fb-variables-modal__body">
          <div className="fb-variables-modal__section">
            <div className="fb-variables-modal__section-head">
              <div>
                <strong>Page Variables</strong>
                <div className="fb-artboard-bp-note">Saved with the current page layout.</div>
              </div>
              <IconButton icon={UIIcons.plusCircle} title="Add page variable" onClick={() => addVariable('page')} />
            </div>
            <div className="fb-variables-modal__list">
              {pageVariables.length ? pageVariables.map((variable) => (
                <VariableRow
                  key={variable.id}
                  variable={variable}
                  scope="page"
                  sources={variableSources}
                  onChange={upsertPageVariable}
                  onRemove={() => removePageVariable(variable.id)}
                />
              )) : <div className="fb-empty-state__text">No page variables yet.</div>}
            </div>
          </div>

          <div className="fb-variables-modal__section">
            <div className="fb-variables-modal__section-head">
              <div>
                <strong>Global Variables</strong>
                <div className="fb-artboard-bp-note">Stored site-wide. Persistent variables keep visitor-updated values in local storage.</div>
              </div>
              <IconButton icon={UIIcons.plusCircle} title="Add global variable" onClick={() => addVariable('global')} />
            </div>
            <div className="fb-variables-modal__list">
              {globalVariables.length ? globalVariables.map((variable) => (
                <VariableRow
                  key={variable.id}
                  variable={variable}
                  scope="global"
                  sources={variableSources}
                  onChange={upsertGlobalVariable}
                  onRemove={() => removeGlobalVariable(variable.id)}
                />
              )) : <div className="fb-empty-state__text">No global variables yet.</div>}
            </div>
          </div>
        </div>
        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-primary-btn" onClick={() => setVariablesModalOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}