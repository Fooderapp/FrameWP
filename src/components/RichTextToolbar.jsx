import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

function normalizeFontFamilySelection(value, fallback = 'Inter') {
  const rawValue = `${value ?? ''}`.trim();
  if (!rawValue) return fallback;
  const firstFamily = rawValue.split(',')[0] ?? '';
  const trimmed = firstFamily.trim().replace(/^['\"]+|['\"]+$/g, '');
  return trimmed || fallback;
}

function getToolbarSelectionStyles(editor, fallbackStyles) {
  const textStyleAttrs = editor?.getAttributes('textStyle') ?? {};
  const fallbackFontFamily = normalizeFontFamilySelection(fallbackStyles?.fontFamily, 'Inter');
  const fallbackFontWeight = `${fallbackStyles?.fontWeight ?? 400}`;
  const fontWeight = `${textStyleAttrs.fontWeight ?? (editor?.isActive('bold') ? '700' : fallbackFontWeight)}`;
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  const selectionNode = selection?.anchorNode;
  const selectionElement = selectionNode?.nodeType === Node.TEXT_NODE
    ? selectionNode.parentElement
    : (selectionNode instanceof Element ? selectionNode : null);
  const editorRoot = editor?.view?.dom ?? null;
  const computedSelectionStyle = selectionElement && editorRoot?.contains(selectionElement)
    ? window.getComputedStyle(selectionElement)
    : null;
  const computedFontSize = computedSelectionStyle?.fontSize ?? null;
  const computedFontWeight = computedSelectionStyle?.fontWeight ?? null;
  const computedColor = computedSelectionStyle?.color ?? null;
  const computedFontFamily = computedSelectionStyle?.fontFamily ?? null;
  return {
    bold: editor?.isActive('bold') ?? false,
    italic: editor?.isActive('italic') ?? false,
    underline: editor?.isActive('underline') ?? false,
    fontSize: Math.round(parseFloat(textStyleAttrs.fontSize ?? computedFontSize ?? fallbackStyles?.fontSize ?? 42)) || 42,
    fontWeight: `${textStyleAttrs.fontWeight ?? computedFontWeight ?? fontWeight}`,
    color: textStyleAttrs.color ?? computedColor ?? fallbackStyles?.color ?? '#000000',
    fontFamily: normalizeFontFamilySelection(textStyleAttrs.fontFamily ?? computedFontFamily, fallbackFontFamily),
    textAlign: fallbackStyles?.textAlign ?? 'left',
  };
}

function ToolbarButton({ active = false, title, children, onClick }) {
  return (
    <button
      type="button"
      className={`fb-inline-text-toolbar__btn${active ? ' is-active' : ''}`}
      title={title}
      aria-label={title}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

function shouldPreserveSelection(event) {
  const interactiveInput = event.target?.closest('input, textarea, [contenteditable="true"]');
  return !interactiveInput;
}

export default function RichTextToolbar({ anchorRect, editor, baseStyles, previewText, onTextAlignChange }) {
  const toolbarRef = useRef(null);
  const fontPreviewSnapshotRef = useRef(null);
  const stylePreviewSnapshotRef = useRef(null);
  const lastTextSelectionRef = useRef(null);
  const [toolbarStyle, setToolbarStyle] = useState(null);
  const [selectionStyles, setSelectionStyles] = useState(() => getToolbarSelectionStyles(editor, baseStyles));

  const ensureTextSelection = () => {
    if (!editor) return false;
    const currentSelection = editor.state.selection;
    if (currentSelection.from !== currentSelection.to) return true;
    const lastSelection = lastTextSelectionRef.current;
    if (!lastSelection || lastSelection.from === lastSelection.to) return false;
    editor.commands.focus();
    editor.commands.setTextSelection(lastSelection);
    return true;
  };

  const captureStylePreviewSnapshot = () => {
    if (!editor || stylePreviewSnapshotRef.current) return true;
    if (!ensureTextSelection()) return false;
    const { from, to } = editor.state.selection;
    if (from === to) return false;
    stylePreviewSnapshotRef.current = {
      html: editor.getHTML(),
      from,
      to,
    };
    return true;
  };

  const captureFontPreviewSnapshot = () => {
    if (!editor || fontPreviewSnapshotRef.current) return true;
    const { from, to } = editor.state.selection;
    if (from === to) return false;
    fontPreviewSnapshotRef.current = {
      html: editor.getHTML(),
      from,
      to,
      fontFamily: getToolbarSelectionStyles(editor, baseStyles).fontFamily,
    };
    return true;
  };

  const restoreFontPreviewSnapshot = (clearAfterRestore = false) => {
    const snapshot = fontPreviewSnapshotRef.current;
    if (!editor || !snapshot) return false;
    editor.commands.setContent(snapshot.html, false);
    editor.commands.focus();
    editor.commands.setTextSelection({ from: snapshot.from, to: snapshot.to });
    editor.view.dispatch(editor.state.tr.setStoredMarks(null));
    if (snapshot.fontFamily) {
      editor.chain().focus().setFontFamily(familyToFontStack(snapshot.fontFamily)).run();
    }
    if (clearAfterRestore) fontPreviewSnapshotRef.current = null;
    return true;
  };

  const restoreStylePreviewSnapshot = (clearAfterRestore = false) => {
    const snapshot = stylePreviewSnapshotRef.current;
    if (!editor || !snapshot) return false;
    editor.commands.setContent(snapshot.html, false);
    editor.commands.focus();
    editor.commands.setTextSelection({ from: snapshot.from, to: snapshot.to });
    editor.view.dispatch(editor.state.tr.setStoredMarks(null));
    if (clearAfterRestore) stylePreviewSnapshotRef.current = null;
    return true;
  };

  const previewFontFamily = (family) => {
    if (!editor) return;
    if (!captureFontPreviewSnapshot()) return;
    ensureGoogleFontLoaded(family, {
      text: previewText,
      weight: Number(selectionStyles.fontWeight) || 400,
      style: selectionStyles.italic ? 'italic' : 'normal',
    });
    restoreFontPreviewSnapshot(false);
    editor.chain().focus().setFontFamily(familyToFontStack(family)).run();
  };

  const resetPreviewTextStyle = () => {
    if (!editor) return;
    editor.chain().focus().clearPreviewTextStyle().run();
  };

  const commitFontFamily = (family) => {
    if (!editor) return;
    ensureGoogleFontLoaded(family, {
      text: previewText,
      weight: Number(selectionStyles.fontWeight) || 400,
      style: selectionStyles.italic ? 'italic' : 'normal',
    });
    restoreFontPreviewSnapshot(true);
    editor.chain().focus().setFontFamily(familyToFontStack(family)).run();
  };

  const previewFontSize = (value) => {
    if (!editor) return;
    if (!ensureTextSelection()) return;
    if (!captureStylePreviewSnapshot()) return;
    restoreStylePreviewSnapshot(false);
    editor.chain().focus().setFontSize(`${value}px`).run();
  };

  const commitFontSize = (value) => {
    if (!editor) return;
    if (!ensureTextSelection()) return;
    restoreStylePreviewSnapshot(true);
    editor.chain().focus().setFontSize(`${value}px`).run();
  };

  const previewFontWeight = (value) => {
    if (!editor) return;
    if (!ensureTextSelection()) return;
    if (!captureStylePreviewSnapshot()) return;
    ensureGoogleFontLoaded(selectionStyles.fontFamily, {
      text: previewText,
      weight: Number(value) || 400,
      style: selectionStyles.italic ? 'italic' : 'normal',
    });
    restoreStylePreviewSnapshot(false);
    editor.chain().focus().setFontWeight(value).run();
  };

  const commitFontWeight = (value) => {
    if (!editor) return;
    if (!ensureTextSelection()) return;
    ensureGoogleFontLoaded(selectionStyles.fontFamily, {
      text: previewText,
      weight: Number(value) || 400,
      style: selectionStyles.italic ? 'italic' : 'normal',
    });
    restoreStylePreviewSnapshot(true);
    editor.chain().focus().setFontWeight(value).run();
  };

  const resetStylePreview = (clearSnapshot = false) => {
    restoreStylePreviewSnapshot(clearSnapshot);
  };

  useEffect(() => {
    if (!editor) return undefined;

    const syncSelectionStyles = () => {
      const nextSelection = editor.state.selection;
      if (nextSelection.from !== nextSelection.to) {
        lastTextSelectionRef.current = { from: nextSelection.from, to: nextSelection.to };
      }
      setSelectionStyles(getToolbarSelectionStyles(editor, baseStyles));
    };

    syncSelectionStyles();
    editor.on('selectionUpdate', syncSelectionStyles);
    editor.on('transaction', syncSelectionStyles);
    editor.on('focus', syncSelectionStyles);
    editor.on('blur', syncSelectionStyles);
    return () => {
      editor.off('selectionUpdate', syncSelectionStyles);
      editor.off('transaction', syncSelectionStyles);
      editor.off('focus', syncSelectionStyles);
      editor.off('blur', syncSelectionStyles);
      editor.commands.clearPreviewTextStyle();
      fontPreviewSnapshotRef.current = null;
      stylePreviewSnapshotRef.current = null;
      lastTextSelectionRef.current = null;
    };
  }, [baseStyles, editor]);

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

  if (!anchorRect || !editor) return null;

  const handleToolbarPointerDown = (event) => {
    if (!shouldPreserveSelection(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return createPortal(
    <div
      ref={toolbarRef}
      className="fb-inline-text-toolbar fb-inline-text-toolbar--portal"
      data-rich-text-editor-ui="true"
      style={toolbarStyle ?? undefined}
      onPointerDown={handleToolbarPointerDown}
      onMouseDown={handleToolbarPointerDown}
    >
      <div className="fb-inline-text-toolbar__group fb-inline-text-toolbar__group--formatting">
        <ToolbarButton active={selectionStyles.bold} title="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton active={selectionStyles.italic} title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
          {UIIcons.italic}
        </ToolbarButton>
        <ToolbarButton active={selectionStyles.underline} title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
          {UIIcons.underline}
        </ToolbarButton>
      </div>

      <div className="fb-inline-text-toolbar__group fb-inline-text-toolbar__group--align">
        <ToolbarButton active={selectionStyles.textAlign === 'left'} title="Align left" onClick={() => onTextAlignChange?.('left')}>
          {UIIcons.alignLeft}
        </ToolbarButton>
        <ToolbarButton active={selectionStyles.textAlign === 'center'} title="Align center" onClick={() => onTextAlignChange?.('center')}>
          {UIIcons.alignCenter}
        </ToolbarButton>
        <ToolbarButton active={selectionStyles.textAlign === 'right'} title="Align right" onClick={() => onTextAlignChange?.('right')}>
          {UIIcons.alignRight}
        </ToolbarButton>
      </div>

      <div className="fb-inline-text-toolbar__group fb-inline-text-toolbar__group--font">
        <div
          className="fb-inline-text-toolbar__font-picker"
          onMouseDown={(event) => {
            if (!shouldPreserveSelection(event)) return;
            event.preventDefault();
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
            onPreviewChange={previewFontFamily}
            onPreviewReset={() => restoreFontPreviewSnapshot(false)}
            onOpenChange={(isOpen) => {
              if (!isOpen) restoreFontPreviewSnapshot(true);
            }}
            onChange={commitFontFamily}
          />
        </div>

        <div
          className="fb-inline-text-toolbar__select-wrap"
          onMouseDown={(event) => {
            if (!shouldPreserveSelection(event)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <InlineStyleDropdown
            value={`${selectionStyles.fontSize}`}
            preserveFocus
            className="fb-inline-text-toolbar__select fb-inline-text-toolbar__select--size"
            editable
            columns={1}
            formatValue={(nextValue) => `${nextValue}px`}
            parseInput={(rawValue) => {
              const parsed = Math.round(parseFloat(rawValue));
              if (!Number.isFinite(parsed)) return null;
              return `${Math.max(1, parsed)}`;
            }}
            popoverMinWidth={112}
            onPreviewChange={previewFontSize}
            onPreviewReset={() => resetStylePreview(false)}
            onOpenChange={(isOpen) => {
              if (!isOpen) resetStylePreview(true);
            }}
            onChange={commitFontSize}
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
            event.stopPropagation();
          }}
        >
          <InlineStyleDropdown
            value={selectionStyles.fontWeight}
            preserveFocus
            className="fb-inline-text-toolbar__select fb-inline-text-toolbar__select--weight"
            columns={1}
            popoverMinWidth={156}
            onPreviewChange={previewFontWeight}
            onPreviewReset={() => resetStylePreview(false)}
            onOpenChange={(isOpen) => {
              if (!isOpen) resetStylePreview(true);
            }}
            onChange={commitFontWeight}
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
            event.stopPropagation();
          }}
        >
          <FillPicker
            value={selectionStyles.color}
            onChange={(value) => {
              editor.chain().focus().setMark('textStyle', { color: value }).run();
            }}
            solidOnly
            compact
            preserveFocus
            title="Edit text color"
            popoverPlacement="bottom-start"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}