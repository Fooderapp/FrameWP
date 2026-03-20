import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GoogleFontPicker from './GoogleFontPicker';
import FillPicker from './FillPicker';
import InlineStyleDropdown from './InlineStyleDropdown';
import { ensureGoogleFontLoaded, familyToFontStack } from './googleFonts';
import { UIIcons } from './UIIcons';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toolbarStyleChanged(current, next) {
  if (current === next) return false;
  if (!current || !next) return current !== next;
  return current.position !== next.position
    || current.left !== next.left
    || current.top !== next.top
    || current.zIndex !== next.zIndex;
}

function ToolbarButton({ active = false, title, children, onClick }) {
  return (
    <button
      type="button"
      className={`fb-inline-text-toolbar__btn${active ? ' is-active' : ''}`}
      title={title}
      aria-label={title}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function shouldPreserveSelection(event) {
  const interactiveInput = event.target?.closest('input, textarea, [contenteditable="true"]');
  return !interactiveInput;
}

export default function InlineTextToolbar({
  anchorRect,
  selectionStyles,
  previewText,
  onExecCommand,
  onStartPreviewSession,
  onPreviewStyle,
  onPreviewCancel,
  onCommitStyle,
  onColorChange,
  onInteractionChange,
}) {
  const toolbarRef = useRef(null);
  const [toolbarStyle, setToolbarStyle] = useState(null);

  useLayoutEffect(() => {
    if (!anchorRect) {
      setToolbarStyle((current) => (current == null ? current : null));
      return undefined;
    }

    const updatePosition = () => {
      const toolbarNode = toolbarRef.current;
      const toolbarWidth = toolbarNode?.offsetWidth ?? 560;
      const toolbarHeight = toolbarNode?.offsetHeight ?? 54;
      const viewportPadding = 12;
      const offset = 10;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - toolbarWidth - viewportPadding);
      const left = clamp(anchorRect.left, viewportPadding, maxLeft);
      const canPlaceAbove = anchorRect.top - offset - toolbarHeight >= viewportPadding;
      const top = canPlaceAbove
        ? anchorRect.top - toolbarHeight - offset
        : clamp(anchorRect.top + anchorRect.height + offset, viewportPadding, Math.max(viewportPadding, window.innerHeight - toolbarHeight - viewportPadding));

      const nextStyle = {
        position: 'fixed',
        left,
        top,
        zIndex: 120300,
      };
      setToolbarStyle((current) => (toolbarStyleChanged(current, nextStyle) ? nextStyle : current));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRect]);

  if (!anchorRect) return null;

  const beginPreviewControl = () => {
    onStartPreviewSession();
    onInteractionChange(true);
  };

  const handleToolbarPointerDown = (event) => {
    if (!shouldPreserveSelection(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onInteractionChange(true);
  };

  return createPortal(
    <div
      ref={toolbarRef}
      className="fb-inline-text-toolbar fb-inline-text-toolbar--portal"
      data-inline-editor-ui="true"
      style={toolbarStyle ?? undefined}
      onMouseDown={handleToolbarPointerDown}
    >
      <div className="fb-inline-text-toolbar__group fb-inline-text-toolbar__group--formatting">
        <ToolbarButton active={selectionStyles.bold} title="Bold" onClick={() => onExecCommand('bold')}>
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton active={selectionStyles.italic} title="Italic" onClick={() => onExecCommand('italic')}>
          {UIIcons.italic}
        </ToolbarButton>
        <ToolbarButton active={selectionStyles.underline} title="Underline" onClick={() => onExecCommand('underline')}>
          {UIIcons.underline}
        </ToolbarButton>
      </div>

      <div className="fb-inline-text-toolbar__group fb-inline-text-toolbar__group--font">
        <div
          className="fb-inline-text-toolbar__font-picker"
          onMouseDown={(event) => {
            if (!shouldPreserveSelection(event)) return;
            event.preventDefault();
            beginPreviewControl();
            event.stopPropagation();
          }}
        >
          <GoogleFontPicker
            value={selectionStyles.fontFamily}
            previewText={previewText}
            preserveFocus
            showSearch={false}
            showPreviewSample
            portal
            placement="bottom-start"
            minPopoverWidth={280}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                beginPreviewControl();
                return;
              }
              onInteractionChange(false);
            }}
            onPreviewChange={(family) => {
              onPreviewStyle({ fontFamily: familyToFontStack(family) });
            }}
            onPreviewReset={onPreviewCancel}
            onChange={(family) => {
              ensureGoogleFontLoaded(family, {
                text: previewText,
                weight: Number(selectionStyles.fontWeight) || 400,
                style: selectionStyles.italic ? 'italic' : 'normal',
              });
              onCommitStyle({ fontFamily: familyToFontStack(family) });
            }}
          />
        </div>

        <div
          className="fb-inline-text-toolbar__select-wrap"
          onMouseDown={(event) => {
            if (!shouldPreserveSelection(event)) return;
            event.preventDefault();
            beginPreviewControl();
            event.stopPropagation();
          }}
        >
          <InlineStyleDropdown
            value={`${selectionStyles.fontSize}`}
            preserveFocus
            className="fb-inline-text-toolbar__select"
            editable
            columns={3}
            formatValue={(nextValue) => `${nextValue}px`}
            parseInput={(rawValue) => {
              const parsed = Math.round(parseFloat(rawValue));
              if (!Number.isFinite(parsed)) return null;
              return `${Math.max(8, Math.min(144, parsed))}`;
            }}
            popoverMinWidth={228}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                beginPreviewControl();
                return;
              }
              onInteractionChange(false);
            }}
            onPreviewChange={(nextValue) => onPreviewStyle({ fontSize: `${nextValue}px` })}
            onPreviewReset={onPreviewCancel}
            onChange={(value) => {
              onCommitStyle({ fontSize: `${value}px` });
            }}
            renderOption={(option) => (
              <span style={{ fontSize: `${Math.min(Number(option.value) || 16, 26)}px`, lineHeight: 1 }}>
                {option.label}
              </span>
            )}
            options={[12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map((value) => ({ value: `${value}`, label: `${value}px` }))}
          />
        </div>

        <div
          className="fb-inline-text-toolbar__select-wrap"
          onMouseDown={(event) => {
            if (!shouldPreserveSelection(event)) return;
            event.preventDefault();
            beginPreviewControl();
            event.stopPropagation();
          }}
        >
          <InlineStyleDropdown
            value={selectionStyles.fontWeight}
            preserveFocus
            className="fb-inline-text-toolbar__select"
            columns={2}
            popoverMinWidth={188}
            onOpenChange={(isOpen) => {
              if (isOpen) {
                beginPreviewControl();
                return;
              }
              onInteractionChange(false);
            }}
            onPreviewChange={(nextValue) => onPreviewStyle({ fontWeight: nextValue })}
            onPreviewReset={onPreviewCancel}
            onChange={(value) => {
              onCommitStyle({ fontWeight: value });
            }}
            renderOption={(option) => (
              <span style={{ fontWeight: option.value, lineHeight: 1.1 }}>
                {option.label}
              </span>
            )}
            options={[
              { value: '300', label: 'Light' },
              { value: '400', label: 'Regular' },
              { value: '500', label: 'Medium' },
              { value: '600', label: 'Semibold' },
              { value: '700', label: 'Bold' },
              { value: '800', label: 'Extra Bold' },
            ]}
          />
        </div>
      </div>

      <div className="fb-inline-text-toolbar__group fb-inline-text-toolbar__group--color">
        <div
          className="fb-inline-text-toolbar__color"
          onMouseDown={(event) => {
            event.preventDefault();
            onInteractionChange(true);
            event.stopPropagation();
          }}
        >
          <FillPicker
            value={selectionStyles.color}
            onChange={onColorChange}
            solidOnly
            compact
            preserveFocus
            title="Edit text color"
            onOpenChange={(isOpen) => {
              if (isOpen) {
                onInteractionChange(true);
                return;
              }
              onInteractionChange(false);
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}