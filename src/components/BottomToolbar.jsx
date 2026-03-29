import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { UIIcons } from './UIIcons';
import { ElementPickerGrid, FORM_ELEMENT_TYPES } from '../panels/ElementsPanel';

const SHAPE_OPTIONS = [
  {
    type: 'circle',
    label: 'Circle',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="7" /></svg>,
  },
  {
    type: 'line',
    label: 'Line',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 18 19 6" /></svg>,
  },
  {
    type: 'polygon',
    label: 'Polygon',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4 19 8v8l-7 4-7-4V8Z" /></svg>,
  },
  {
    type: 'pen',
    label: 'Path',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 17 10 8l4 5 4-8" /><circle cx="6" cy="17" r="1.3" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r="1.3" fill="currentColor" stroke="none" /><circle cx="14" cy="13" r="1.3" fill="currentColor" stroke="none" /><circle cx="18" cy="5" r="1.3" fill="currentColor" stroke="none" /></svg>,
  },
];

function ToolButton({ active = false, icon, title, openable = false, badge = null, className = '', onClick }) {
  return (
    <button type="button" className={`fb-bottom-toolbar__tool${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`} onClick={onClick} title={title} aria-label={title}>
      <span className="fb-bottom-toolbar__icon">{icon}</span>
      {openable ? <span className="fb-bottom-toolbar__chevron">{UIIcons.chevronDown}</span> : null}
      {badge ? <span className="fb-bottom-toolbar__badge">{badge}</span> : null}
    </button>
  );
}

function ShapePickerGrid({ onPick, onDragStart, onDragEnd }) {
  const activeCanvasTool = useEditorStore((state) => state.activeCanvasTool);

  return (
    <div className="fb-elements-grid fb-elements-grid--compact">
      {SHAPE_OPTIONS.map((option) => {
        const active = activeCanvasTool === `draw-${option.type}`;
        return (
          <div
            key={option.type}
            className={`fb-element-card${active ? ' fb-element-card--active' : ''}`}
            draggable
            onDragStart={(event) => onDragStart(event, option.type)}
            onDragEnd={() => onDragEnd?.()}
            onClick={() => onPick(option.type)}
            title={option.label}
          >
            <div className="fb-element-card__icon">{option.icon}</div>
            <div className="fb-element-card__label">{option.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function BottomToolbar() {
  const activeCanvasTool = useEditorStore((state) => state.activeCanvasTool);
  const setActiveCanvasTool = useEditorStore((state) => state.setActiveCanvasTool);
  const setPendingDraw = useEditorStore((state) => state.setPendingDraw);
  const comments = useEditorStore((state) => state.getPageComments());
  const activeCommentId = useEditorStore((state) => state.activeCommentId);
  const activeSurface = useEditorStore((state) => state.activeSurface);
  const [openMenu, setOpenMenu] = useState(null);
  const wrapRef = useRef(null);

  const unresolvedCount = useMemo(() => (comments ?? []).filter((entry) => !entry.resolved).length, [comments]);
  const elementToolActive = ['draw-frame', 'draw-image', 'draw-video', 'draw-text', 'draw-icon'].includes(activeCanvasTool);
  const formToolActive = ['draw-form', 'draw-text-field', 'draw-textarea-field', 'draw-rich-text-editor', 'draw-radio-group', 'draw-dropdown', 'draw-checkbox', 'draw-file-upload', 'draw-captcha', 'draw-submit-button'].includes(activeCanvasTool);
  const shapeToolActive = ['draw-circle', 'draw-line', 'draw-polygon', 'draw-pen'].includes(activeCanvasTool);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpenMenu(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handleShapePick = (type) => {
    setActiveCanvasTool(`draw-${type}`);
    setOpenMenu(null);
  };

  const handleShapeDragStart = (event, type) => {
    setPendingDraw(null);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('fb-element-type', type === 'pen' ? 'path' : type);
  };

  const handleDragEnd = () => setOpenMenu(null);

  return (
    <div className="fb-bottom-toolbar-wrap">
      <div className="fb-bottom-toolbar" ref={wrapRef}>
        <ToolButton
          active={activeCanvasTool === 'select' && !activeCommentId}
          icon={UIIcons.select}
          title="Select"
          onClick={() => {
            setOpenMenu(null);
            setActiveCanvasTool('select');
          }}
        />

        <div className={`fb-bottom-toolbar__group${openMenu === 'elements' ? ' is-open' : ''}`}>
          <ToolButton
            active={elementToolActive}
            icon={UIIcons.elements}
            title="Elements"
            openable
            onClick={() => setOpenMenu((current) => (current === 'elements' ? null : 'elements'))}
          />
          {openMenu === 'elements' ? (
            <div className="fb-bottom-toolbar__modal fb-bottom-toolbar__modal--elements">
              <div className="fb-bottom-toolbar__modal-title">Elements</div>
              <div className="fb-bottom-toolbar__modal-hint">Click to draw or drag directly onto the canvas.</div>
              <ElementPickerGrid compact toolbarPalette onItemChosen={() => setOpenMenu(null)} onItemDragEnd={handleDragEnd} />
            </div>
          ) : null}
        </div>

        <div className={`fb-bottom-toolbar__group${openMenu === 'forms' ? ' is-open' : ''}`}>
          <ToolButton
            active={formToolActive}
            icon={UIIcons.form}
            title="Forms"
            openable
            onClick={() => setOpenMenu((current) => (current === 'forms' ? null : 'forms'))}
          />
          {openMenu === 'forms' ? (
            <div className="fb-bottom-toolbar__modal fb-bottom-toolbar__modal--forms">
              <div className="fb-bottom-toolbar__modal-title">Form Builder</div>
              <div className="fb-bottom-toolbar__modal-hint">Click to draw or drag the first form elements onto the canvas.</div>
              <ElementPickerGrid
                items={FORM_ELEMENT_TYPES}
                compact
                toolbarPalette
                onItemChosen={() => setOpenMenu(null)}
                onItemDragEnd={handleDragEnd}
              />
            </div>
          ) : null}
        </div>

        <div className={`fb-bottom-toolbar__group${openMenu === 'shapes' ? ' is-open' : ''}`}>
          <ToolButton
            active={shapeToolActive}
            icon={UIIcons.shapes}
            title="Shapes"
            openable
            onClick={() => setOpenMenu((current) => (current === 'shapes' ? null : 'shapes'))}
          />
          {openMenu === 'shapes' ? (
            <div className="fb-bottom-toolbar__modal fb-bottom-toolbar__modal--shapes">
              <div className="fb-bottom-toolbar__modal-title">Shapes</div>
              <div className="fb-bottom-toolbar__modal-hint">Draw with one click or drag to place a default shape.</div>
              <ShapePickerGrid onPick={handleShapePick} onDragStart={handleShapeDragStart} onDragEnd={handleDragEnd} />
            </div>
          ) : null}
        </div>

        <ToolButton
          active={activeCanvasTool === 'pan'}
          icon={UIIcons.pan}
          title="Pan"
          onClick={() => {
            setOpenMenu(null);
            setActiveCanvasTool(activeCanvasTool === 'pan' ? 'select' : 'pan');
          }}
        />

        <ToolButton
          active={activeSurface !== 'component' && (activeCanvasTool === 'comment' || !!activeCommentId)}
          icon={UIIcons.comment}
          title="Comment"
          badge={unresolvedCount > 0 ? unresolvedCount : null}
          onClick={() => {
            if (activeSurface === 'component') return;
            setOpenMenu(null);
            setActiveCanvasTool(activeCanvasTool === 'comment' && !activeCommentId ? 'select' : 'comment');
          }}
        />
      </div>
    </div>
  );
}