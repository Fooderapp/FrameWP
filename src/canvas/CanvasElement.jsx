import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorStore, resolveElement, resolveElementWithVariables, isElementSelected } from '../store/editorStore';
import { ensureGoogleFontLoaded, familyToFontStack } from '../components/googleFonts';
import InlineTextToolbar from '../components/InlineTextToolbar';
import { sanitizeSvgMarkup } from '../components/iconLibrary';
import { getResolvedRichTextHtml, plainTextToRichTextHtml, richTextHtmlToPlainText, sanitizeRichTextHtml } from '../components/richText';

function getMediaUrl(value) {
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFontFamilySelection(value, fallback = 'Inter') {
  const rawValue = `${value ?? ''}`.trim();
  if (!rawValue) return fallback;
  const firstFamily = rawValue.split(',')[0] ?? '';
  const trimmed = firstFamily.trim().replace(/^['\"]+|['\"]+$/g, '');
  return trimmed || fallback;
}

function getNodeTextLength(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  return node.textContent?.length ?? 0;
}

function unwrapElement(node) {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

function replaceFormattingTag(node) {
  const parent = node.parentNode;
  if (!parent) return null;
  const replacement = node.ownerDocument.createElement('span');
  if (node.getAttribute('style')) replacement.setAttribute('style', node.getAttribute('style'));
  while (node.firstChild) replacement.appendChild(node.firstChild);
  parent.replaceChild(replacement, node);
  return replacement;
}

function clearDescendantOverrideStyles(root, styleKeys) {
  if (!root || !styleKeys?.length) return;
  const keys = new Set(styleKeys);
  const formattingTagMap = new Map([
    ['strong', 'fontWeight'],
    ['b', 'fontWeight'],
    ['em', 'fontStyle'],
    ['i', 'fontStyle'],
    ['u', 'textDecoration'],
  ]);

  const visit = (node) => {
    Array.from(node.children ?? []).forEach((child) => {
      let current = child;
      const mappedStyleKey = formattingTagMap.get(child.tagName.toLowerCase());
      if (mappedStyleKey && keys.has(mappedStyleKey)) {
        current = replaceFormattingTag(child) ?? child;
      }

      if (current.style) {
        styleKeys.forEach((styleKey) => current.style.removeProperty(styleKey.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)));
        if (!current.getAttribute('style')?.trim() && current.tagName.toLowerCase() === 'span') {
          const nextNode = current;
          visit(nextNode);
          unwrapElement(nextNode);
          return;
        }
      }

      visit(current);
    });
  };

  visit(root);
}

function isInlineEditorUiTarget(target) {
  return !!(target instanceof Element && target.closest('[data-inline-editor-ui="true"]'));
}

function isInlineEditorTextInputTarget(target) {
  return !!(target instanceof Element && target.matches('[data-inline-editor-ui="true"] input, [data-inline-editor-ui="true"] textarea'));
}

function isSelectionInsideNode(node, selection) {
  if (!node || !selection || selection.rangeCount === 0) return false;
  return node.contains(selection.anchorNode) && node.contains(selection.focusNode);
}

function isBackwardSelection(selection, range) {
  if (!selection || !range || selection.rangeCount === 0 || selection.isCollapsed) return false;
  return selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
}

export default function CanvasElement({ elementId, bpId, isSelected, isDropTarget, dropTargetId, onStartElementDrag, onStartElementResize, onStartElementRotate, onDropOntoElement, onStartRadiusDrag, onStartPaddingDrag, reorderTarget, artboardLayoutOn, artboardFlexDir, dragPreview = null, draggingElementId = null }) {
  const [dropOver, setDropOver] = useState(false);
  const elementRef = useRef(null);
  const textEditorRef = useRef(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [toolbarRect, setToolbarRect] = useState(null);
  const [textSelectionStyles, setTextSelectionStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    fontSize: 42,
    fontWeight: '400',
    color: '#000000',
    fontFamily: 'Inter',
  });
  const selectionRangeRef = useRef(null);
  const selectionOffsetsRef = useRef(null);
  const expandedSelectionRangeRef = useRef(null);
  const expandedSelectionOffsetsRef = useRef(null);
  const toolbarInteractingRef = useRef(false);
  const inlineEditorInteractionRef = useRef({
    pointerDownInsideUi: false,
    suppressBlurUntil: 0,
  });
  const textEditInitialRef = useRef({ text: 'Text', richTextHtml: plainTextToRichTextHtml('Text') });
  const syncedTextDraftRef = useRef({ text: 'Text', richTextHtml: plainTextToRichTextHtml('Text') });
  const fontPreviewSnapshotRef = useRef(null);
  const selectAllOnTextEditRef = useRef(false);

  const allElements            = useEditorStore(s => s.getAllElements());
  const el                     = allElements.find(e => e.id === elementId);
  const setSelection           = useEditorStore(s => s.setSelection);
  const toggleSelection        = useEditorStore(s => s.toggleSelection);
  const setPrimarySelection    = useEditorStore(s => s.setPrimarySelection);
  const deleteElement          = useEditorStore(s => s.deleteElement);
  const updateElementLayout    = useEditorStore(s => s.updateElementLayout);
  const pushHistory            = useEditorStore(s => s.pushHistory);
  const selection              = useEditorStore(s => s.selection);
  const isHovered              = useEditorStore(s => s.hoveredId === elementId);
  const bpDef                  = useEditorStore(s => s.breakpointDefs[bpId]);
  const drilledContainerId     = useEditorStore(s => s.drilledContainerId);
  const setDrilledContainerId  = useEditorStore(s => s.setDrilledContainerId);
  const pendingDraw            = useEditorStore(s => s.pendingDraw);
  const openComponentEditor    = useEditorStore(s => s.openComponentEditor);
  const activeSurface          = useEditorStore(s => s.activeSurface);
  const setComponentEditorActiveVariant = useEditorStore(s => s.setComponentEditorActiveVariant);
  const viewport               = useEditorStore(s => s.viewport);
  const currentPage            = useEditorStore(s => s.pages.find((page) => page.id === s.currentPageId) ?? null);
  const globalVariables        = useEditorStore(s => s.globalVariables);
  const pageVariables          = Array.isArray(currentPage?.variables) ? currentPage.variables : [];
  const children               = el?.children?.length
    ? el.children.map((childId) => allElements.find((candidate) => candidate.id === childId)).filter(Boolean)
    : allElements.filter((candidate) => candidate.parentId === elementId);

  const parentEl               = el?.parentId ? allElements.find(e => e.id === el.parentId) : null;
  let componentInstanceAncestor = null;
  if (activeSurface === 'page' && el?.parentId) {
    let cursor = parentEl;
    while (cursor) {
      if (cursor.componentInstance) {
        componentInstanceAncestor = cursor;
        break;
      }
      cursor = cursor.parentId ? allElements.find((candidate) => candidate.id === cursor.parentId) : null;
    }
  }
  const resolved               = el ? resolveElementWithVariables(el, bpId, pageVariables, globalVariables) : null;
  const id                     = el?.id ?? elementId;
  const locked                 = el?.locked ?? false;
  const x                      = resolved?.x ?? 0;
  const y                      = resolved?.y ?? 0;
  const width                  = resolved?.width ?? 0;
  const height                 = resolved?.height ?? 0;
  const hidden                 = resolved?.hidden ?? false;
  const rotation               = resolved?.rotation;
  const styles                 = resolved?.styles ?? {};
  const positionType           = resolved?.positionType ?? 'absolute';
  const widthMode              = resolved?.widthMode ?? 'fixed';
  const heightMode             = resolved?.heightMode ?? 'fixed';
  const elType                 = el?.type ?? null;
  const readOnlyComponentRoot  = activeSurface === 'component' && !!el?.componentRoot;
  const interactionLocked      = locked || readOnlyComponentRoot;
  const insideComponentInstanceOnPage = !!componentInstanceAncestor;
  const componentSelectionTargetId = componentInstanceAncestor?.id ?? id;
  const dropTargetElementId = id;
  const isComponentInstanceOnPage = activeSurface === 'page' && !!el?.componentInstance;
  const canDropOnto = !!onDropOntoElement
    && el.type === 'frame'
    && !insideComponentInstanceOnPage
    && !isComponentInstanceOnPage;
  const canvasScale            = viewport?.scale ?? 1;

  const isRelative = positionType === 'relative';
  const isFixed    = positionType === 'fixed';
  // Root-level auto-layout items flow unless explicitly pinned out of layout.
  const isFlowInLayout = !!artboardLayoutOn
    && !el?.parentId
    && !resolved?.absoluteInLayout
    && !isFixed;
  const effectiveRelative = isRelative || isFlowInLayout;

  // ── Parent flex direction (needed for fill mode) ───────────
  const parentResolved = parentEl ? resolveElementWithVariables(parentEl, bpId, pageVariables, globalVariables) : null;
  // 'row' | 'column' | 'block'  (block = not a flex parent)
  const parentDir = (() => {
    if (!effectiveRelative) return 'block';
    if (!el?.parentId && artboardLayoutOn) return artboardFlexDir ?? 'column';
    if (el?.parentId && parentResolved?.styles?.display === 'flex')
      return parentResolved.styles.flexDirection ?? 'row';
    return 'block';
  })();

  // ── Width / Height CSS values ──────────────────────────────
  // Modes: fixed (px), fill (flex/stretch/100%), relative (%), hug (fit-content)
  const wFr  = resolved?.widthFr  ?? 1;
  const hFr  = resolved?.heightFr ?? 1;
  const wPct = resolved?.widthPct  ?? width;
  const hPct = resolved?.heightPct ?? height;
  const csW = widthMode  === 'fill'     ? '100%'
            : widthMode  === 'hug'      ? 'fit-content'
            : widthMode  === 'relative' ? `${wPct}%`
            : width; // fixed px
  const csH = heightMode === 'fill'     ? '100%'
            : heightMode === 'hug'      ? 'fit-content'
            : heightMode === 'relative' ? `${hPct}%`
            : height; // fixed px

  // ── Min / Max constraints (only emit when explicitly set) ──
  const minW = (resolved.minW != null && resolved.minW !== 0) ? resolved.minW : undefined;
  const maxW = (resolved.maxW != null && resolved.maxW !== 0) ? resolved.maxW : undefined;
  const minH = (resolved.minH != null && resolved.minH !== 0) ? resolved.minH : undefined;
  const maxH = (resolved.maxH != null && resolved.maxH !== 0) ? resolved.maxH : undefined;
  const textGrowMode = widthMode === 'hug' && heightMode === 'hug'
    ? 'auto-width'
    : heightMode === 'hug'
      ? 'auto-height'
      : 'fixed';
  const rotateHandles = elType === 'text' && (textGrowMode === 'auto-width' || textGrowMode === 'auto-height')
    ? ['nw', 'ne', 'sw']
    : ['nw', 'ne', 'se', 'sw'];
  const inlineRotateHandles = ['nw', 'ne', 'se', 'sw'];
  const resizeHandles = elType === 'text' && (textGrowMode === 'auto-width' || textGrowMode === 'auto-height')
    ? ['se']
    : ['nw','n','ne','e','se','s','sw','w'];
  const inlineResizeHandles = resizeHandles;
  const resolvedRichTextHtml = el?.type === 'text' ? getResolvedRichTextHtml(resolved, 'Text') : '';

  const restoreTextSelection = () => {
    const node = textEditorRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return false;
    if ((toolbarInteractingRef.current || fontPreviewSnapshotRef.current) && expandedSelectionOffsetsRef.current && restoreSelectionOffsets(expandedSelectionOffsetsRef.current)) {
      return true;
    }
    if (selectionOffsetsRef.current && restoreSelectionOffsets(selectionOffsetsRef.current)) return true;
    if (expandedSelectionOffsetsRef.current && restoreSelectionOffsets(expandedSelectionOffsetsRef.current)) return true;
    if (!selectionRangeRef.current) return false;
    selection.removeAllRanges();
    selection.addRange(selectionRangeRef.current.cloneRange());
    return true;
  };

  const captureTextSelection = () => {
    const node = textEditorRef.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) return false;
    selectionRangeRef.current = range.cloneRange();
    selectionOffsetsRef.current = getSelectionOffsets(range);
    if (!range.collapsed) {
      expandedSelectionRangeRef.current = range.cloneRange();
      expandedSelectionOffsetsRef.current = selectionOffsetsRef.current;
    }
    return true;
  };

  const syncSelectionStyles = () => {
    const node = textEditorRef.current;
    const selection = window.getSelection();
    const fallbackFontFamily = normalizeFontFamilySelection(styles?.fontFamily, 'Inter');
    if (!node || !selection) return;
    let anchorNode = selection.anchorNode;
    if (!anchorNode || !node.contains(anchorNode)) {
      setTextSelectionStyles((current) => ({
        ...current,
        fontSize: styles?.fontSize ?? 42,
        fontWeight: `${styles?.fontWeight ?? 400}`,
        color: styles?.color ?? '#000000',
        fontFamily: fallbackFontFamily,
      }));
      return;
    }
    if (anchorNode.nodeType === Node.TEXT_NODE) anchorNode = anchorNode.parentElement;
    const computed = window.getComputedStyle(anchorNode);
    const colorMatch = `${computed.color || ''}`.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    const nextColor = colorMatch
      ? `#${colorMatch.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`
      : (styles?.color ?? '#000000');
    setTextSelectionStyles({
      bold: typeof document.queryCommandState === 'function' ? document.queryCommandState('bold') : parseInt(computed.fontWeight, 10) >= 600,
      italic: typeof document.queryCommandState === 'function' ? document.queryCommandState('italic') : computed.fontStyle === 'italic',
      underline: typeof document.queryCommandState === 'function' ? document.queryCommandState('underline') : computed.textDecorationLine.includes('underline'),
      fontSize: Math.round(parseFloat(computed.fontSize) || styles?.fontSize || 42),
      fontWeight: `${computed.fontWeight || styles?.fontWeight || 400}`,
      color: nextColor,
      fontFamily: normalizeFontFamilySelection(computed.fontFamily, fallbackFontFamily),
    });
  };

  const getSelectionOffsets = (range) => {
    const root = textEditorRef.current;
    const selection = window.getSelection();
    if (!root || !range) return null;

    const resolveOffset = (targetNode, targetOffset) => {
      let offset = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current === targetNode) return offset + targetOffset;
        offset += current.textContent?.length ?? 0;
        current = walker.nextNode();
      }
      if (targetNode?.nodeType === Node.ELEMENT_NODE && root.contains(targetNode)) {
        const priorChildren = Array.from(targetNode.childNodes).slice(0, targetOffset);
        return offset + priorChildren.reduce((sum, child) => sum + getNodeTextLength(child), 0);
      }
      return offset;
    };

    return {
      start: resolveOffset(range.startContainer, range.startOffset),
      end: resolveOffset(range.endContainer, range.endOffset),
      backward: isBackwardSelection(selection, range),
    };
  };

  const restoreSelectionOffsets = (offsets) => {
    const root = textEditorRef.current;
    const selection = window.getSelection();
    if (!root || !selection || !offsets) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    let current = walker.nextNode();

    while (current) {
      const nextConsumed = consumed + (current.textContent?.length ?? 0);
      if (!startNode && offsets.start <= nextConsumed) {
        startNode = current;
        startOffset = Math.max(0, offsets.start - consumed);
      }
      if (!endNode && offsets.end <= nextConsumed) {
        endNode = current;
        endOffset = Math.max(0, offsets.end - consumed);
        break;
      }
      consumed = nextConsumed;
      current = walker.nextNode();
    }

    if (!startNode || !endNode) return false;
    const range = document.createRange();
    range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length ?? 0));
    selection.removeAllRanges();
    if (offsets.backward && typeof selection.setBaseAndExtent === 'function') {
      selection.setBaseAndExtent(endNode, Math.min(endOffset, endNode.textContent?.length ?? 0), startNode, Math.min(startOffset, startNode.textContent?.length ?? 0));
    } else {
      selection.addRange(range);
    }
    selectionRangeRef.current = range.cloneRange();
    selectionOffsetsRef.current = offsets;
    if (!range.collapsed) {
      expandedSelectionRangeRef.current = range.cloneRange();
      expandedSelectionOffsetsRef.current = offsets;
    }
    return true;
  };

  const restoreFontPreviewSnapshot = (clearAfterRestore = false) => {
    const snapshot = fontPreviewSnapshotRef.current;
    const node = textEditorRef.current;
    if (!snapshot || !node) return false;
    node.innerHTML = snapshot.html;
    node.focus({ preventScroll: true });
    restoreSelectionOffsets(snapshot.offsets);
    captureTextSelection();
    syncSelectionStyles();
    if (clearAfterRestore) fontPreviewSnapshotRef.current = null;
    return true;
  };

  const captureFontPreviewSnapshot = () => {
    if (fontPreviewSnapshotRef.current) return true;
    const node = textEditorRef.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (range.collapsed || !node.contains(range.startContainer) || !node.contains(range.endContainer)) return false;
    fontPreviewSnapshotRef.current = {
      html: node.innerHTML,
      offsets: getSelectionOffsets(range),
    };
    return true;
  };

  const placeCaretFromPoint = (clientX, clientY) => {
    const node = textEditorRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return false;

    let range = null;
    if (typeof document.caretRangeFromPoint === 'function') {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (typeof document.caretPositionFromPoint === 'function') {
      const caretPosition = document.caretPositionFromPoint(clientX, clientY);
      if (caretPosition?.offsetNode) {
        range = document.createRange();
        range.setStart(caretPosition.offsetNode, caretPosition.offset);
        range.collapse(true);
      }
    }

    if (!range || !node.contains(range.startContainer)) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    selectionRangeRef.current = range.cloneRange();
    selectionOffsetsRef.current = getSelectionOffsets(range);
    return true;
  };

  const syncTextDraftFromDom = (sourceHtml) => {
    if (el?.type !== 'text') {
      return {
        nextText: draftText || 'Text',
        nextRichTextHtml: plainTextToRichTextHtml(draftText || 'Text'),
      };
    }
    const nextSourceHtml = sourceHtml ?? textEditorRef.current?.innerHTML ?? '';
    const derivedPlainText = richTextHtmlToPlainText(nextSourceHtml).trim();
    const nextRichTextHtml = sanitizeRichTextHtml(nextSourceHtml) || plainTextToRichTextHtml(derivedPlainText || 'Text');
    const nextText = richTextHtmlToPlainText(nextRichTextHtml) || 'Text';
    setDraftText(nextText);
    if (
      nextText !== syncedTextDraftRef.current.text
      || nextRichTextHtml !== syncedTextDraftRef.current.richTextHtml
    ) {
      syncedTextDraftRef.current = { text: nextText, richTextHtml: nextRichTextHtml };
    }
    return { nextText, nextRichTextHtml };
  };

  const persistTextDraftToStore = (sourceHtml) => {
    const nextState = syncTextDraftFromDom(sourceHtml);
    updateElementLayout(id, bpId, {
      text: nextState.nextText,
      richTextHtml: nextState.nextRichTextHtml,
    });
    return nextState;
  };

  const withRestoredSelection = (callback, options = {}) => {
    const { persist = true } = options;
    const node = textEditorRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    restoreTextSelection();
    callback();
    captureTextSelection();
    if (persist) persistTextDraftToStore(node.innerHTML);
    else syncTextDraftFromDom(node.innerHTML);
    syncSelectionStyles();
  };

  const ensureInlineSelectionSession = () => {
    const node = textEditorRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return false;

    const liveRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const hasExpandedLiveSelection = !!(
      liveRange
      && !liveRange.collapsed
      && node.contains(liveRange.startContainer)
      && node.contains(liveRange.endContainer)
    );

    if (hasExpandedLiveSelection) {
      captureTextSelection();
    }

    const sessionOffsets = hasExpandedLiveSelection
      ? selectionOffsetsRef.current
      : expandedSelectionOffsetsRef.current;

    if (sessionOffsets && !fontPreviewSnapshotRef.current) {
      fontPreviewSnapshotRef.current = {
        html: node.innerHTML,
        offsets: sessionOffsets,
      };
      return true;
    }
    if (fontPreviewSnapshotRef.current) return true;
    if (!captureTextSelection()) return false;
    if (selection.getRangeAt(0).collapsed) return false;
    return captureFontPreviewSnapshot();
  };

  const applyWrappedSelectionStyle = (stylePatch, options = {}) => {
    withRestoredSelection(() => {
      const node = textEditorRef.current;
      const selection = window.getSelection();
      if (!node || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (range.collapsed || !node.contains(range.startContainer) || !node.contains(range.endContainer)) return;
      const styleKeys = Object.keys(stylePatch);
      const span = document.createElement('span');
      Object.entries(stylePatch).forEach(([styleKey, styleValue]) => {
        span.style[styleKey] = styleValue;
      });
      const fragment = range.extractContents();
      clearDescendantOverrideStyles(fragment, styleKeys);
      span.appendChild(fragment);
      range.insertNode(span);
      range.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(range);
    }, options);
  };

  const applyExecCommand = (command, value = null, options = {}) => {
    withRestoredSelection(() => {
      if (typeof document.execCommand !== 'function') return;
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(command, false, value);
    }, options);
  };

  const previewInlineStyle = (stylePatch) => {
    if (!ensureInlineSelectionSession()) return;
    restoreFontPreviewSnapshot(false);
    applyWrappedSelectionStyle(stylePatch, { persist: false });
  };

  const startInlinePreviewSession = () => {
    ensureInlineSelectionSession();
    toolbarInteractingRef.current = true;
  };

  const commitInlineStyle = (stylePatch) => {
    if (!ensureInlineSelectionSession()) return;
    restoreFontPreviewSnapshot(true);
    applyWrappedSelectionStyle(stylePatch);
    requestAnimationFrame(() => {
      toolbarInteractingRef.current = false;
      textEditorRef.current?.focus({ preventScroll: true });
      restoreTextSelection();
      syncSelectionStyles();
    });
  };

  const restoreToolbarSelectionFocus = () => {
    requestAnimationFrame(() => {
      toolbarInteractingRef.current = false;
      textEditorRef.current?.focus({ preventScroll: true });
      restoreTextSelection();
      syncSelectionStyles();
    });
  };

  const cancelInlinePreview = () => {
    restoreFontPreviewSnapshot(true);
    restoreToolbarSelectionFocus();
  };

  const commitInlineColor = (colorValue) => {
    if (fontPreviewSnapshotRef.current) {
      commitInlineStyle({ color: colorValue });
      return;
    }
    startInlinePreviewSession();
    commitInlineStyle({ color: colorValue });
  };

  useEffect(() => {
    if (!el || el.type !== 'text') return;
    ensureGoogleFontLoaded(styles?.fontFamily ?? 'Inter', {
      text: resolved?.text || 'Text',
      weight: styles?.fontWeight ?? 400,
      style: styles?.fontStyle ?? 'normal',
    });
  }, [el?.type, resolved?.text, styles?.fontFamily, styles?.fontStyle, styles?.fontWeight]);

  useEffect(() => {
    if (!el || el.type !== 'text') return;
    if (!isEditingText) setDraftText(resolved?.text || 'Text');
  }, [el?.type, isEditingText, resolved?.text]);

  useEffect(() => {
    if (!el || !isEditingText || el.type !== 'text') return;
    const node = textEditorRef.current;
    if (!node) return;
    const initialText = resolved?.text || 'Text';
    const initialRichTextHtml = resolvedRichTextHtml || plainTextToRichTextHtml(initialText);
    textEditInitialRef.current = { text: initialText, richTextHtml: initialRichTextHtml };
    syncedTextDraftRef.current = { text: initialText, richTextHtml: initialRichTextHtml };
    setDraftText(initialText);
    node.innerHTML = initialRichTextHtml;
    node.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selectAllOnTextEditRef.current) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection?.removeAllRanges();
      selection?.addRange(range);
      selectionRangeRef.current = range.cloneRange();
      selectionOffsetsRef.current = getSelectionOffsets(range);
      captureTextSelection();
    } else {
      selection?.removeAllRanges();
      selectionRangeRef.current = null;
      selectionOffsetsRef.current = null;
    }
    selectAllOnTextEditRef.current = false;
    syncSelectionStyles();
  }, [el?.id, el?.type, isEditingText]);

  useEffect(() => {
    if (!isEditingText || el?.type !== 'text') return undefined;
    const handleSelectionChange = () => {
      const liveSelection = window.getSelection();
      const editorNode = textEditorRef.current;
      if (!editorNode || !liveSelection) return;
      if ((toolbarInteractingRef.current || fontPreviewSnapshotRef.current) && !isSelectionInsideNode(editorNode, liveSelection)) {
        return;
      }
      captureTextSelection();
      syncSelectionStyles();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      fontPreviewSnapshotRef.current = null;
      expandedSelectionRangeRef.current = null;
      expandedSelectionOffsetsRef.current = null;
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [el?.type, isEditingText]);

  useEffect(() => {
    if (!isEditingText || el?.type !== 'text') return undefined;

    const handlePointerDownCapture = (event) => {
      const target = event.target;
      if (isInlineEditorUiTarget(target) || textEditorRef.current?.contains(target)) {
        return;
      }
      toolbarInteractingRef.current = false;
      commitTextEdit();
    };

    const handleFocusInCapture = (event) => {
      const target = event.target;
      if (isInlineEditorUiTarget(target) || textEditorRef.current?.contains(target)) {
        return;
      }
      toolbarInteractingRef.current = false;
      commitTextEdit();
    };

    window.addEventListener('pointerdown', handlePointerDownCapture, true);
    window.addEventListener('focusin', handleFocusInCapture, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownCapture, true);
      window.removeEventListener('focusin', handleFocusInCapture, true);
    };
  }, [el?.type, isEditingText]);

  useEffect(() => {
    if (!isEditingText || el?.type !== 'text') return undefined;

    const handlePointerDownCapture = (event) => {
      const insideUi = isInlineEditorUiTarget(event.target);
      inlineEditorInteractionRef.current = {
        pointerDownInsideUi: insideUi,
        suppressBlurUntil: insideUi ? Date.now() + 400 : 0,
      };
      if (insideUi) {
        toolbarInteractingRef.current = true;
      }
    };

    const clearInteractionGuard = () => {
      if (Date.now() < inlineEditorInteractionRef.current.suppressBlurUntil) return;
      inlineEditorInteractionRef.current = {
        pointerDownInsideUi: false,
        suppressBlurUntil: 0,
      };
    };

    window.addEventListener('pointerdown', handlePointerDownCapture, true);
    window.addEventListener('pointerup', clearInteractionGuard, true);
    window.addEventListener('pointercancel', clearInteractionGuard, true);
    return () => {
      inlineEditorInteractionRef.current = {
        pointerDownInsideUi: false,
        suppressBlurUntil: 0,
      };
      window.removeEventListener('pointerdown', handlePointerDownCapture, true);
      window.removeEventListener('pointerup', clearInteractionGuard, true);
      window.removeEventListener('pointercancel', clearInteractionGuard, true);
    };
  }, [el?.type, isEditingText]);

  useEffect(() => {
    if (!isSelected || isEditingText) return;
    elementRef.current?.focus({ preventScroll: true });
  }, [isEditingText, isSelected]);

  useEffect(() => {
    if (!el) return undefined;
    if (widthMode !== 'hug' && heightMode !== 'hug') return undefined;
    const node = elementRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;

    const syncSize = () => {
      const next = {};
      const measuredW = Math.ceil(Math.max(node.scrollWidth, node.offsetWidth));
      const measuredH = Math.ceil(Math.max(node.scrollHeight, node.offsetHeight));
      if (widthMode === 'hug' && Math.abs((resolved.width ?? 0) - measuredW) > 1) next.width = measuredW;
      if (heightMode === 'hug' && Math.abs((resolved.height ?? 0) - measuredH) > 1) next.height = measuredH;
      if (Object.keys(next).length) updateElementLayout(id, bpId, next);
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [bpId, el, heightMode, id, resolved?.height, resolved?.width, resolvedRichTextHtml, styles?.fontFamily, styles?.fontSize, styles?.fontWeight, styles?.letterSpacing, styles?.lineHeight, updateElementLayout, widthMode]);

  if (!el || hidden) return null;

  // Off-canvas: only meaningful on desktop — tablet/mobile inherit desktop positions
  // which may overflow their narrower artboard, but that's expected behaviour not an error.
  const isOffCanvas = bpId === 'desktop' && !el.parentId && bpDef && !effectiveRelative
    ? (x + width <= 0 || x >= bpDef.width || y + height <= 0 || y >= bpDef.height)
    : false;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (isEditingText) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      toggleSelection({ elementId: componentSelectionTargetId, bpId });
      return;
    }
    if (insideComponentInstanceOnPage) {
      setSelection({ elementId: componentSelectionTargetId, bpId });
      return;
    }
    if (activeSurface === 'component' && el?.componentEditorVariantId) {
      setComponentEditorActiveVariant(el.componentEditorVariantId);
    }
    if (interactionLocked) {
      if (isSelected) setPrimarySelection(id);
      else setSelection({ elementId: id, bpId });
      return;
    }
    onStartElementDrag && onStartElementDrag(e, bpId, { id });
  };

  const handleDoubleClick = (e) => {
    if (insideComponentInstanceOnPage && componentInstanceAncestor?.componentInstance?.componentId) {
      e.stopPropagation();
      setSelection({ elementId: componentSelectionTargetId, bpId });
      openComponentEditor(componentInstanceAncestor.componentInstance.componentId);
      return;
    }
    if (el.componentInstance?.componentId) {
      e.stopPropagation();
      setSelection({ elementId: id, bpId });
      openComponentEditor(el.componentInstance.componentId);
      return;
    }
    if (readOnlyComponentRoot) {
      e.stopPropagation();
      setSelection({ elementId: id, bpId });
      return;
    }
    if (el.type === 'text') {
      e.stopPropagation();
      setSelection({ elementId: id, bpId });
      selectAllOnTextEditRef.current = true;
      setIsEditingText(true);
      return;
    }
    e.stopPropagation();
    if (children.length > 0) {
      setDrilledContainerId(id);
      setSelection({ elementId: id, bpId });
    }
  };

  const handleKeyDown = (e) => {
    if (el.type === 'text' && isEditingText) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        restoreFontPreviewSnapshot(true);
        const initialState = textEditInitialRef.current;
        setDraftText(initialState.text);
        syncedTextDraftRef.current = initialState;
        updateElementLayout(id, bpId, { text: initialState.text, richTextHtml: initialState.richTextHtml });
        if (textEditorRef.current) textEditorRef.current.innerHTML = initialState.richTextHtml;
        setIsEditingText(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        restoreFontPreviewSnapshot(true);
        persistTextDraftToStore();
        const initialState = textEditInitialRef.current;
        const currentState = syncedTextDraftRef.current;
        if (
          currentState.text !== initialState.text
          || currentState.richTextHtml !== initialState.richTextHtml
        ) pushHistory();
        setIsEditingText(false);
      }
      return;
    }
  };

  const moveTextCursor = (key, extendSelection = false) => {
    const node = textEditorRef.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return false;
    if (!node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return false;

    const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? 'backward' : 'forward';
    const granularity = key === 'ArrowUp' || key === 'ArrowDown' ? 'line' : 'character';

    if (!extendSelection && !selection.isCollapsed) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(direction === 'backward');
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }

    if (typeof selection.modify === 'function') {
      selection.modify(extendSelection ? 'extend' : 'move', direction, granularity);
      return true;
    }

    return false;
  };

  const commitTextEdit = () => {
    if (el.type !== 'text') return;
    if (toolbarInteractingRef.current) {
      return;
    }
    restoreFontPreviewSnapshot(true);
    persistTextDraftToStore();
    const initialState = textEditInitialRef.current;
    const currentState = syncedTextDraftRef.current;
    if (
      currentState.text !== initialState.text
      || currentState.richTextHtml !== initialState.richTextHtml
    ) {
      pushHistory();
    }
    setIsEditingText(false);
  };

  // ── Drop-onto for nesting ──────────────────────────────────
  const handleDragOver = (e) => {
    if (canDropOnto) {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(true);
    }
  };
  const handleDragLeave = () => setDropOver(false);
  const handleDrop = (e) => {
    setDropOver(false);
    if (canDropOnto) {
      e.preventDefault();
      e.stopPropagation();
      onDropOntoElement(e, dropTargetElementId);
    }
  };

  // ── Fill-mode flex styles (direction-aware) ───────────────
  // row parent  → width-fill uses flexGrow (main axis), height-fill uses alignSelf
  // column parent → height-fill uses flexGrow (main axis), width-fill uses alignSelf
  // block parent  → fall back to width/height: 100%
  const wFill = effectiveRelative && widthMode  === 'fill';
  const hFill = effectiveRelative && heightMode === 'fill';
  const fillW        = wFill ? (parentDir === 'row'    ? undefined   // flexGrow owns it
                              : parentDir === 'column' ? undefined   // alignSelf owns it
                              : '100%')                              // block fallback
                     : undefined;
  const fillH        = hFill ? (parentDir === 'column' ? undefined   // flexGrow owns it
                              : parentDir === 'row'    ? undefined   // alignSelf owns it
                              : '100%')                              // block fallback
                     : undefined;
  const fillFlexGrow = (wFill && parentDir === 'row')    ? wFr
                     : (hFill && parentDir === 'column') ? hFr
                     : undefined;
  const fillFlexBasis   = fillFlexGrow != null ? '0%' : undefined;
  const fillFlexShrink  = fillFlexGrow != null ? 1   : undefined;
  const fillAlignSelf   = (wFill && parentDir === 'column') ? 'stretch'
                        : (hFill && parentDir === 'row')    ? 'stretch'
                        : undefined;
  const isDragPreviewActive = dragPreview?.elementId === id;
  const isDraggingSource = draggingElementId === id;
  const previewDx = isDragPreviewActive ? (dragPreview.dx ?? 0) : 0;
  const previewDy = isDragPreviewActive ? (dragPreview.dy ?? 0) : 0;
  const absoluteLeft = !effectiveRelative ? x + previewDx : x;
  const absoluteTop = !effectiveRelative ? y + previewDy : y;
  const previewTransform = effectiveRelative && isDragPreviewActive
    ? `translate(${previewDx}px, ${previewDy}px)`
    : '';
  const rotationTransform = rotation ? `rotate(${rotation}deg)` : '';
  const composedTransform = [previewTransform, rotationTransform].filter(Boolean).join(' ') || undefined;
  const backgroundImageUrl = getMediaUrl(styles?.backgroundImage);

  const inlineStyle = {
    position: effectiveRelative ? 'relative' : 'absolute',
    ...(effectiveRelative
      ? { width:      wFill ? fillW : csW,
          height:     hFill ? fillH : csH,
          flexGrow:   fillFlexGrow,
          flexShrink: fillFlexShrink,
          flexBasis:  fillFlexBasis,
          alignSelf:  fillAlignSelf,
        }
      : { left: absoluteLeft, top: absoluteTop, width: csW, height: csH }
    ),
    minWidth:  minW,
    maxWidth:  maxW,
    minHeight: minH,
    maxHeight: maxH,
    transform: composedTransform,
    // backgroundColor can hold a CSS gradient string — route accordingly
    backgroundColor: styles?.backgroundColor && !styles.backgroundColor.includes('gradient(')
      ? styles.backgroundColor
      : undefined,
    backgroundImage: (() => {
      const bg = styles?.backgroundColor;
      if (bg && bg.includes('gradient(')) return bg;
      if (backgroundImageUrl) return `url(${backgroundImageUrl})`;
      return undefined;
    })(),
    borderRadius: (() => {
      if (styles?.borderRadiusMode === 'independent') {
        const tl = typeof styles.borderRadiusTL === 'number' ? styles.borderRadiusTL : (styles.borderRadius ?? 0);
        const tr = typeof styles.borderRadiusTR === 'number' ? styles.borderRadiusTR : (styles.borderRadius ?? 0);
        const br = typeof styles.borderRadiusBR === 'number' ? styles.borderRadiusBR : (styles.borderRadius ?? 0);
        const bl = typeof styles.borderRadiusBL === 'number' ? styles.borderRadiusBL : (styles.borderRadius ?? 0);
        return `${tl}px ${tr}px ${br}px ${bl}px`;
      }
      return typeof styles?.borderRadius === 'number' ? styles.borderRadius + 'px' : styles?.borderRadius;
    })(),
    border: (styles?.borderWidth > 0)
      ? `${styles.borderWidth}px ${styles.borderStyle || 'solid'} ${styles.borderColor || '#000'}`
      : undefined,
    opacity:          (isDraggingSource && effectiveRelative)
      ? Math.min(typeof styles?.opacity === 'number' ? styles.opacity : 1, 0.24)
      : styles?.opacity,
    overflow:         isEditingText && el.type === 'text' ? 'visible' : styles?.overflow,
    display:          styles?.display,
    flexDirection:    styles?.flexDirection,
    flexWrap:         styles?.flexWrap,
    gap:              typeof styles?.gap === 'number' ? styles.gap + 'px' : styles?.gap,
    paddingTop:       typeof styles?.paddingTop === 'number' ? styles.paddingTop + 'px' : styles?.paddingTop,
    paddingRight:     typeof styles?.paddingRight === 'number' ? styles.paddingRight + 'px' : styles?.paddingRight,
    paddingBottom:    typeof styles?.paddingBottom === 'number' ? styles.paddingBottom + 'px' : styles?.paddingBottom,
    paddingLeft:      typeof styles?.paddingLeft === 'number' ? styles.paddingLeft + 'px' : styles?.paddingLeft,
    alignItems:       styles?.alignItems,
    justifyContent:   styles?.justifyContent,
    boxShadow:        styles?.boxShadow || undefined,
    zIndex:           isDragPreviewActive ? 10001 : (isSelected ? 9999 : (styles?.zIndex ?? undefined)),
    // Background size/position/repeat for image fills
    backgroundSize:     (backgroundImageUrl || styles?.backgroundColor?.includes('gradient('))
      ? (styles?.backgroundSize ?? (backgroundImageUrl ? 'cover' : undefined))
      : undefined,
    backgroundPosition: backgroundImageUrl ? (styles?.backgroundPosition ?? 'center center') : undefined,
    backgroundRepeat:   backgroundImageUrl && styles?.backgroundSize === 'repeat' ? 'repeat' : (backgroundImageUrl ? 'no-repeat' : undefined),
    outline: dropOver ? '2px dashed #3b82f6' : isDropTarget ? '2px solid var(--accent-light)' : undefined,
    cursor:  pendingDraw ? 'crosshair' : interactionLocked ? 'not-allowed' : 'move',
    boxSizing: 'border-box',
    pointerEvents: undefined,
  };

  const textStyle = el.type === 'text' ? {
    fontFamily: familyToFontStack(styles?.fontFamily ?? 'Inter'),
    fontWeight: styles?.fontWeight ?? 400,
    fontStyle: styles?.fontStyle ?? 'normal',
    fontSize: `${styles?.fontSize ?? 42}${styles?.fontSizeUnit ?? 'px'}`,
    lineHeight: `${styles?.lineHeight ?? 1.2}${styles?.lineHeightUnit ?? 'em'}`,
    letterSpacing: `${styles?.letterSpacing ?? 0}${styles?.letterSpacingUnit ?? 'em'}`,
    color: styles?.color ?? '#000000',
    textAlign: styles?.textAlign ?? 'left',
    textDecoration: styles?.textDecoration ?? 'none',
    whiteSpace: textGrowMode === 'auto-width' ? 'pre' : 'pre-wrap',
    wordBreak: 'break-word',
    width: '100%',
    height: textGrowMode === 'fixed' ? '100%' : 'auto',
    overflow: 'visible',
    display: 'block',
    userSelect: isEditingText ? 'text' : 'none',
    pointerEvents: isEditingText ? 'auto' : 'none',
    cursor: isEditingText ? 'text' : 'inherit',
    outline: 'none',
  } : null;
  const iconMarkup = el.type === 'icon' ? sanitizeSvgMarkup(resolved?.svgMarkup ?? '') : '';

  useLayoutEffect(() => {
    if (!isEditingText || el?.type !== 'text') {
      setToolbarRect(null);
      return undefined;
    }

    const measure = () => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (!rect) return;
      setToolbarRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };

    measure();
    const node = elementRef.current;
    const resizeObserver = typeof ResizeObserver !== 'undefined' && node ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(node);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [el?.type, isEditingText, viewport?.scale, viewport?.x, viewport?.y, resolved?.width, resolved?.height, x, y]);

  const inlineToolbar = isEditingText && toolbarRect ? (
    <InlineTextToolbar
      anchorRect={toolbarRect}
      selectionStyles={textSelectionStyles}
      previewText={richTextHtmlToPlainText(textEditorRef.current?.innerHTML ?? '') || 'Text'}
      onExecCommand={applyExecCommand}
      onStartPreviewSession={startInlinePreviewSession}
      onPreviewStyle={previewInlineStyle}
      onPreviewCancel={cancelInlinePreview}
      onCommitStyle={commitInlineStyle}
      onColorChange={commitInlineColor}
      onInteractionChange={(nextValue) => {
        toolbarInteractingRef.current = nextValue;
      }}
    />
  ) : null;

  return (
    <div
      ref={elementRef}
      className={`fb-el${isSelected ? ' fb-el--selected' : ''}${!isSelected && isHovered ? ' fb-el--hovered' : ''}${!isSelected && isDropTarget ? ' fb-el--drop-target' : ''}${interactionLocked ? ' fb-el--locked' : ''}${isOffCanvas ? ' fb-el--offcanvas' : ''}${isFixed ? ' fb-el--fixed' : ''}${isFlowInLayout ? ' fb-el--flow' : ''}${id === drilledContainerId ? ' fb-el--drilled' : ''}${el.componentInstance ? ' fb-el--component' : ''}${el.componentRoot ? ' fb-el--component-root' : ''}`}
      style={inlineStyle}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={isSelected ? 0 : -1}
      data-id={id}
    >
      {el.componentRoot && activeSurface === 'component' ? (
        <button
          type="button"
          className="fb-component-root-label"
          style={{
            top: `${-6 / canvasScale}px`,
            transform: `translateY(-100%) scale(${1 / canvasScale})`,
            transformOrigin: 'left bottom',
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (el.componentEditorVariantId) setComponentEditorActiveVariant(el.componentEditorVariantId);
            setSelection({ elementId: id, bpId });
          }}
        >
          {el.componentVariantName || 'Primary'}
        </button>
      ) : null}
      {/* Image element content */}
      {el.type === 'image' && (() => {
        const src = getMediaUrl(resolved.src);
        return src
          ? <img
              src={src}
              alt={el.name || ''}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: styles?.objectFit ?? 'cover',
                borderRadius: 'inherit',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
              draggable={false}
            />
          : <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(120,120,140,0.6)', fontSize: 11, pointerEvents: 'none',
              border: '1.5px dashed rgba(120,120,160,0.35)', borderRadius: 'inherit',
              gap: 4, flexDirection: 'column',
            }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="2" width="14" height="12" rx="1.5"/>
                <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
                <path d="M1 12l4-3.5 3 2.5 2.5-2 4.5 4"/>
              </svg>
              <span>Image</span>
            </div>;
      })()}
      {inlineToolbar}
      {el.type === 'text' && (
        <>
          <div
            ref={textEditorRef}
            className="fb-text-content"
            style={textStyle}
            contentEditable={isEditingText}
            draggable={false}
            suppressContentEditableWarning
            onMouseDown={(e) => {
              if (!isEditingText) return;
              e.stopPropagation();
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey) return;
              const node = textEditorRef.current;
              const selection = window.getSelection();
              if (!node || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
              if (!node.contains(selection.anchorNode) || !node.contains(selection.focusNode)) return;
              placeCaretFromPoint(e.clientX, e.clientY);
            }}
            onDragStart={(e) => {
              if (!isEditingText) return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseUp={(e) => {
              if (!isEditingText) return;
              e.stopPropagation();
              captureTextSelection();
              syncSelectionStyles();
            }}
            onClick={(e) => {
              if (!isEditingText) return;
              e.stopPropagation();
              captureTextSelection();
              syncSelectionStyles();
            }}
            onDoubleClick={(e) => {
              if (!isEditingText) return;
              e.stopPropagation();
              const node = textEditorRef.current;
              const selection = window.getSelection();
              if (!node || !selection) return;
              const range = document.createRange();
              range.selectNodeContents(node);
              selection.removeAllRanges();
              selection.addRange(range);
              selectionRangeRef.current = range.cloneRange();
              selectionOffsetsRef.current = getSelectionOffsets(range);
              captureTextSelection();
              syncSelectionStyles();
            }}
            onInput={(e) => {
              syncTextDraftFromDom(e.currentTarget.innerHTML ?? '');
              captureTextSelection();
              syncSelectionStyles();
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                const node = textEditorRef.current;
                if (node) {
                  const selection = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(node);
                  selection?.removeAllRanges();
                  selection?.addRange(range);
                  selectionRangeRef.current = range.cloneRange();
                  syncSelectionStyles();
                }
                return;
              }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const handled = moveTextCursor(e.key, e.shiftKey);
                if (handled) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                return;
              }
              if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey) && !(e.shiftKey)) {
                e.preventDefault();
                document.execCommand('insertLineBreak');
                return;
              }
              e.stopPropagation();
            }}
            dangerouslySetInnerHTML={!isEditingText ? { __html: resolvedRichTextHtml } : undefined}
          />
        </>
      )}
      {el.type === 'icon' && (iconMarkup ? (
        <div
          className="fb-icon-content"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: styles?.color ?? '#111827',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          dangerouslySetInnerHTML={{ __html: iconMarkup }}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'grid', placeItems: 'center',
          border: '1.5px dashed rgba(120,120,160,0.35)',
          color: 'rgba(120,120,140,0.7)',
          borderRadius: 'inherit',
          fontSize: 11,
          pointerEvents: 'none',
        }}>
          Icon
        </div>
      ))}
      {/* Padding handles — shaded zones + drag lines (when selected and padding > 0) */}
      {isSelected && !interactionLocked && onStartPaddingDrag && (() => {
        const toNum = v => typeof v === 'number' ? v : parseFloat(v) || 0;
        const pt = toNum(styles?.paddingTop);
        const pr = toNum(styles?.paddingRight);
        const pb = toNum(styles?.paddingBottom);
        const pl = toNum(styles?.paddingLeft);
        if (pt === 0 && pr === 0 && pb === 0 && pl === 0) return null;
        return (
          <>
            {pt > 0 && <div className="fb-pad-zone fb-pad-zone--top"    style={{ height: pt }} />}
            {pb > 0 && <div className="fb-pad-zone fb-pad-zone--bottom" style={{ height: pb }} />}
            {pl > 0 && <div className="fb-pad-zone fb-pad-zone--left"   style={{ width: pl, top: pt, bottom: pb }} />}
            {pr > 0 && <div className="fb-pad-zone fb-pad-zone--right"  style={{ width: pr, top: pt, bottom: pb }} />}
            {pt > 0 && <div className="fb-pad-line fb-pad-line--top"    style={{ top:    pt }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'top');    }} />}
            {pb > 0 && <div className="fb-pad-line fb-pad-line--bottom" style={{ bottom: pb }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'bottom'); }} />}
            {pl > 0 && <div className="fb-pad-line fb-pad-line--left"   style={{ left:   pl }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'left');   }} />}
            {pr > 0 && <div className="fb-pad-line fb-pad-line--right"  style={{ right:  pr }} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStartPaddingDrag(e, id, 'right');  }} />}
          </>
        );
      })()}
      {/* Child elements — rendered relative to this element */}
      {children.map(child => {
        return (
          <React.Fragment key={child.id}>
            <CanvasElement
              elementId={child.id}
              bpId={bpId}
              isSelected={isElementSelected(selection, child.id, bpId)}
              isDropTarget={dropTargetId === child.id}
              dropTargetId={dropTargetId}
              onStartElementDrag={onStartElementDrag}
              onStartElementResize={onStartElementResize}
              onStartElementRotate={onStartElementRotate}
              onDropOntoElement={onDropOntoElement}
              onStartRadiusDrag={onStartRadiusDrag}
              onStartPaddingDrag={onStartPaddingDrag}
              reorderTarget={reorderTarget}
              dragPreview={dragPreview}
              draggingElementId={draggingElementId}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
