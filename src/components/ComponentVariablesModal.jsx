import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../store/editorStore';

const COMPONENT_CONTROL_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'color', label: 'Color' },
  { value: 'url', label: 'URL' },
  { value: 'image', label: 'Image URL' },
  { value: 'select', label: 'Select' },
];

function getComponentControlDefaultValue(type, options = []) {
  if (type === 'boolean') return false;
  if (type === 'number') return 0;
  if (type === 'color') return '#000000';
  if (type === 'select') return options[0]?.value ?? '';
  return '';
}

function getComponentControlTypeForProperty(property) {
  if (property === 'hidden') return 'boolean';
  if (property === 'styles.backgroundColor' || property === 'styles.color') return 'color';
  if (property === 'styles.opacity' || property === 'styles.borderRadius' || property === 'styles.borderWidth' || property === 'styles.zIndex') return 'number';
  if (property === 'src' || property === 'styles.backgroundImage') return 'image';
  if (property === 'linkUrl') return 'url';
  if (property === 'text') return 'text';
  return 'text';
}

function getComponentControlPropertyOptions(element) {
  const options = [];
  if (!element) return options;
  if (element.type === 'text') options.push({ value: 'text', label: 'Text content' });
  if (element.type === 'image' || element.type === 'video') options.push({ value: 'src', label: 'Source' });
  options.push({ value: 'hidden', label: 'Visibility' });
  options.push({ value: 'linkUrl', label: 'Link URL' });
  options.push({ value: 'styles.backgroundColor', label: 'Background fill' });
  options.push({ value: 'styles.backgroundImage', label: 'Background image' });
  options.push({ value: 'styles.color', label: 'Color' });
  options.push({ value: 'styles.fontFamily', label: 'Font family' });
  options.push({ value: 'styles.borderRadius', label: 'Radius' });
  options.push({ value: 'styles.borderWidth', label: 'Border width' });
  options.push({ value: 'styles.opacity', label: 'Opacity' });
  options.push({ value: 'styles.zIndex', label: 'Z index' });
  return options;
}

function formatComponentControlOptionsText(options = []) {
  return (options ?? [])
    .map((option) => `${option.label ?? option.value}:${option.value}`)
    .join('\n');
}

function parseComponentControlOptionsText(text) {
  return `${text ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, valuePart] = line.split(':');
      const label = (labelPart ?? '').trim();
      const value = (valuePart ?? labelPart ?? '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
      return { label: label || value || 'Option', value: value || 'option' };
    });
}

function getComponentVariableDisplayLabel(control) {
  return control?.label?.trim() || control?.name?.trim() || 'Variable';
}

function Toggle({ value, onChange }) {
  return (
    <button type="button" className={`fb-toggle${value ? ' is-active' : ''}`} onClick={() => onChange(!value)}>
      <span className="fb-toggle__track" />
      <span className="fb-toggle__thumb" />
    </button>
  );
}

function ColorInput({ value, onChange }) {
  return <input className="fb-prop-input" type="color" value={value || '#000000'} onChange={(event) => onChange(event.target.value)} />;
}

function NumberInput({ value, onChange, min = 0, step = 1 }) {
  return <input className="fb-prop-input" type="number" value={value ?? 0} min={min} step={step} onChange={(event) => onChange(parseFloat(event.target.value) || 0)} />;
}

export default function ComponentVariablesModal({ onClose }) {
  const [selectedControlId, setSelectedControlId] = useState(null);
  const activeSurface = useEditorStore((state) => state.activeSurface);
  const componentEditor = useEditorStore((state) => state.componentEditor);
  const components = useEditorStore((state) => state.components);
  const selectedElement = useEditorStore((state) => state.getSelectedElement());
  const addComponentEditorControl = useEditorStore((state) => state.addComponentEditorControl);
  const updateComponentEditorControl = useEditorStore((state) => state.updateComponentEditorControl);
  const removeComponentEditorControl = useEditorStore((state) => state.removeComponentEditorControl);
  const pushHistory = useEditorStore((state) => state.pushHistory);

  const component = components.find((entry) => entry.id === componentEditor.componentId) ?? null;
  const componentControlTargetId = selectedElement?.componentSourceId ?? selectedElement?.id ?? null;
  const componentControlPropertyOptions = getComponentControlPropertyOptions(selectedElement);
  const componentSourceLabelMap = useMemo(() => new Map((componentEditor.page?.elements ?? []).map((element) => [element.componentSourceId ?? element.id, element.name || element.type || 'Layer'])), [componentEditor.page?.elements]);
  const controls = componentEditor.controls ?? [];
  const selectedControl = controls.find((control) => control.id === selectedControlId) ?? controls[0] ?? null;

  useEffect(() => {
    if (!controls.length) {
      if (selectedControlId !== null) setSelectedControlId(null);
      return;
    }
    if (!selectedControlId || !controls.some((control) => control.id === selectedControlId)) {
      setSelectedControlId(controls[0].id);
    }
  }, [controls, selectedControlId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (activeSurface !== 'component' || !componentEditor?.isOpen || !component) return null;

  const handleAddVariable = () => {
    const defaultProperty = componentControlPropertyOptions[0]?.value ?? 'text';
    const inferredType = getComponentControlTypeForProperty(defaultProperty);
    const nextVariableName = `${(selectedElement?.name || componentControlPropertyOptions[0]?.label || 'variable')}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'variable';
    const nextControlId = addComponentEditorControl({
      name: nextVariableName,
      label: `${selectedElement?.name || 'Element'} ${componentControlPropertyOptions[0]?.label || 'Variable'}`,
      type: inferredType,
      defaultValue: getComponentControlDefaultValue(inferredType),
      options: inferredType === 'select' ? [{ label: 'Option 1', value: 'option-1' }] : [],
      bindings: componentControlTargetId ? [{ elementId: componentControlTargetId, property: defaultProperty }] : [],
    });
    if (nextControlId) {
      setSelectedControlId(nextControlId);
      pushHistory();
    }
  };

  const getBindingSummary = (control) => {
    const primaryBinding = control?.bindings?.[0] ?? null;
    if (!primaryBinding) return 'Unbound';
    const targetLabel = primaryBinding.elementId ? (componentSourceLabelMap.get(primaryBinding.elementId) ?? 'Layer') : 'Layer';
    return `${targetLabel} · ${primaryBinding.property}`;
  };

  const modal = (
    <div className="fb-overlay-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="fb-overlay-modal__card fb-component-variables-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fb-overlay-modal__head">Component Variables</div>
        <div className="fb-overlay-modal__body">
          <div className="fb-component-variables-modal__intro">
            <div>
              <div className="fb-component-variables-modal__eyebrow">Selected layer</div>
              <div className="fb-component-variables-modal__selected-name">{selectedElement?.name || selectedElement?.type || 'No layer selected'}</div>
              <div className="fb-artboard-bp-note">Create named variables, bind them to the selected layer, then edit them from page instances.</div>
            </div>
            <button type="button" className="fb-primary-btn" onClick={handleAddVariable}>Add Variable</button>
          </div>

          {!controls.length ? (
            <div className="fb-artboard-bp-note">No variables yet. Select a layer, then add one and bind it to text, source, visibility, or style properties.</div>
          ) : (
            <div className="fb-component-variables-modal__layout">
              <div className="fb-component-variables-modal__sidebar">
                <div className="fb-component-variables-modal__sidebar-head">
                  <span>{controls.length} variable{controls.length === 1 ? '' : 's'}</span>
                </div>
                <div className="fb-component-variables-modal__list">
                  {controls.map((control) => (
                    <button
                      key={control.id}
                      type="button"
                      className={`fb-component-variables-modal__item${selectedControl?.id === control.id ? ' is-active' : ''}`}
                      onClick={() => setSelectedControlId(control.id)}
                    >
                      <span className="fb-component-variables-modal__item-title">{getComponentVariableDisplayLabel(control)}</span>
                      <span className="fb-component-variables-modal__item-meta">{control.type} · {getBindingSummary(control)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="fb-component-variables-modal__editor">
                {selectedControl ? (
                  <>
                    <div className="fb-component-variables-modal__editor-head">
                      <div>
                        <div className="fb-component-variables-modal__editor-title">{getComponentVariableDisplayLabel(selectedControl)}</div>
                        <div className="fb-artboard-bp-note">Machine name: {selectedControl.name || 'variable'}</div>
                      </div>
                      <button type="button" className="fb-secondary-btn" onClick={() => { removeComponentEditorControl(selectedControl.id); pushHistory(); }}>Delete</button>
                    </div>

                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Name</span>
                      <input className="fb-prop-input" value={selectedControl.name ?? ''} onChange={(event) => updateComponentEditorControl(selectedControl.id, { name: event.target.value })} onBlur={pushHistory} placeholder="hero_title" />
                    </div>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Title</span>
                      <input className="fb-prop-input" value={selectedControl.label} onChange={(event) => updateComponentEditorControl(selectedControl.id, { label: event.target.value })} onBlur={pushHistory} />
                    </div>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Type</span>
                      <select
                        className="fb-prop-input"
                        value={selectedControl.type}
                        onChange={(event) => {
                          const nextType = event.target.value;
                          const nextOptions = nextType === 'select' ? (selectedControl.options?.length ? selectedControl.options : [{ label: 'Option 1', value: 'option-1' }]) : [];
                          updateComponentEditorControl(selectedControl.id, {
                            type: nextType,
                            options: nextOptions,
                            defaultValue: getComponentControlDefaultValue(nextType, nextOptions),
                          });
                          pushHistory();
                        }}
                      >
                        {COMPONENT_CONTROL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Bind To</span>
                      <select
                        className="fb-prop-input"
                        value={selectedControl.bindings?.[0]?.elementId === componentControlTargetId ? (selectedControl.bindings?.[0]?.property ?? '') : ''}
                        onChange={(event) => {
                          const nextProperty = event.target.value;
                          updateComponentEditorControl(selectedControl.id, {
                            bindings: nextProperty && componentControlTargetId ? [{ elementId: componentControlTargetId, property: nextProperty }] : [],
                          });
                          pushHistory();
                        }}
                        disabled={!componentControlPropertyOptions.length}
                      >
                        <option value="">Unbound</option>
                        {componentControlPropertyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    <div className="fb-artboard-bp-note" style={{ marginTop: -4, marginBottom: 12 }}>
                      {selectedControl.bindings?.[0]
                        ? `Currently bound to ${getBindingSummary(selectedControl)}`
                        : componentControlPropertyOptions.length
                          ? 'Choose a property from the selected layer to expose through this variable.'
                          : 'Select a layer to bind this variable to a property.'}
                    </div>
                    {selectedControl.type === 'select' ? (
                      <div className="fb-prop-row" style={{ alignItems: 'flex-start' }}>
                        <span className="fb-prop-label">Options</span>
                        <textarea className="fb-prop-input" rows={4} value={formatComponentControlOptionsText(selectedControl.options)} onChange={(event) => updateComponentEditorControl(selectedControl.id, { options: parseComponentControlOptionsText(event.target.value) })} onBlur={pushHistory} />
                      </div>
                    ) : null}
                    <div className="fb-prop-row">
                      <span className="fb-prop-label">Default</span>
                      {selectedControl.type === 'boolean' ? (
                        <Toggle value={selectedControl.defaultValue === true} onChange={(nextValue) => { updateComponentEditorControl(selectedControl.id, { defaultValue: nextValue }); pushHistory(); }} />
                      ) : selectedControl.type === 'color' ? (
                        <ColorInput value={selectedControl.defaultValue || '#000000'} onChange={(nextValue) => { updateComponentEditorControl(selectedControl.id, { defaultValue: nextValue }); pushHistory(); }} />
                      ) : selectedControl.type === 'number' ? (
                        <NumberInput value={selectedControl.defaultValue ?? 0} onChange={(nextValue) => { updateComponentEditorControl(selectedControl.id, { defaultValue: nextValue }); pushHistory(); }} />
                      ) : selectedControl.type === 'select' ? (
                        <select className="fb-prop-input" value={selectedControl.defaultValue ?? ''} onChange={(event) => { updateComponentEditorControl(selectedControl.id, { defaultValue: event.target.value }); pushHistory(); }}>
                          {(selectedControl.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : selectedControl.type === 'textarea' ? (
                        <textarea className="fb-prop-input" rows={4} value={selectedControl.defaultValue ?? ''} onChange={(event) => updateComponentEditorControl(selectedControl.id, { defaultValue: event.target.value })} onBlur={pushHistory} />
                      ) : (
                        <input className="fb-prop-input" type={selectedControl.type === 'url' || selectedControl.type === 'image' ? 'url' : 'text'} value={selectedControl.defaultValue ?? ''} onChange={(event) => updateComponentEditorControl(selectedControl.id, { defaultValue: event.target.value })} onBlur={pushHistory} />
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body);
  }

  return modal;
}