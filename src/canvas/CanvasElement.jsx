import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditorStore, resolveElement, resolveElementAnimations, resolveElementWithVariables, isElementSelected, applyAnimationPreviewPatch, getAnimationEditorPreviewPatch, getShapePresetKind, getVectorShapeData, buildVectorShapeSvgMarkup } from '../store/editorStore';
import { canAssetApplyToElement, parseAssetDragPayload } from '../store/assetStyles';
import { ensureGoogleFontLoaded, familyToFontStack } from '../components/googleFonts';
import { getEmbedPreview } from '../components/embedUtils';
import RichTextEditor from '../components/RichTextEditor';
import { sanitizeSvgMarkup } from '../components/iconLibrary';
import { getLoopAnimationStyle, useLoopAnimationPlayback } from '../components/loopAnimation';
import { getResolvedRichTextHtml, plainTextToRichTextHtml } from '../components/richText';
import { getResolvedVideoSource, getVideoEmbedLayout } from '../components/videoUtils';

function rectStateChanged(current, next) {
  if (current === next) return false;
  if (!current || !next) return current !== next;
  return current.left !== next.left
    || current.top !== next.top
    || current.width !== next.width
    || current.height !== next.height;
}

function selectionStyleStateChanged(current, next) {
  if (current === next) return false;
  if (!current || !next) return current !== next;
  return current.bold !== next.bold
    || current.italic !== next.italic
    || current.underline !== next.underline
    || current.fontSize !== next.fontSize
    || current.fontWeight !== next.fontWeight
    || current.color !== next.color
    || current.fontFamily !== next.fontFamily;
}

function getMediaUrl(value) {
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url.trim();
  return typeof value === 'string' ? value.trim() : '';
}

function isGradientPaint(value) {
  return typeof value === 'string' && /gradient\(/i.test(value);
}

function getGradientFallbackColor(value, fallback = '#000000') {
  if (!isGradientPaint(value)) return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const match = value.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^\)]+\)|hsla?\([^\)]+\)|currentColor)/i);
  return match?.[1] || fallback;
}

function getScrollSequenceFrameList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => getMediaUrl(entry))
    .filter(Boolean);
}

function getScrollSequencePreview(resolved) {
  const type = resolved?.scrollSequenceType ?? 'video';
  const src = getMediaUrl(resolved?.scrollSequenceSrc);
  const frames = getScrollSequenceFrameList(resolved?.scrollSequenceFrames);
  if (type === 'image-sequence') {
    return {
      type,
      src: frames[0] ?? '',
      frameCount: frames.length,
      hasMedia: frames.length > 0,
    };
  }
  return {
    type,
    src,
    frameCount: frames.length,
    hasMedia: Boolean(src),
  };
}

function buildSvgDataUrl(markup) {
  if (typeof markup !== 'string' || !markup.trim()) return '';
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(markup)}")`;
}

function scaleTextMetric(value, unit, scale) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return `${value ?? ''}${unit ?? ''}`;
  const resolvedUnit = `${unit ?? ''}`;
  const nextValue = resolvedUnit === 'px'
    ? numericValue * scale
    : numericValue;
  const rounded = Math.round(nextValue * 1000) / 1000;
  return `${rounded}${resolvedUnit}`;
}

function normalizeFontFamilySelection(value, fallback = 'Inter') {
  const rawValue = `${value ?? ''}`.trim();
  if (!rawValue) return fallback;
  const firstFamily = rawValue.split(',')[0] ?? '';
  const trimmed = firstFamily.trim().replace(/^['\"]+|['\"]+$/g, '');
  return trimmed || fallback;
}

function isRichTextEditorUiTarget(target) {
  return !!(
    target instanceof Element
    && target.closest('[data-rich-text-editor-ui="true"], [data-inline-editor-ui="true"]')
  );
}

export default function CanvasElement({ elementId, bpId, isSelected, isDropTarget, dropTargetId, onStartElementDrag, onStartElementResize, onStartElementRotate, onDropOntoElement, onStartRadiusDrag, onStartPaddingDrag, reorderTarget, artboardLayoutOn, artboardFlexDir, artboardAlignItems, dragPreview = null, draggingElementId = null, draggingElementBpId = null }) {
  const [dropOver, setDropOver] = useState(false);
  const elementRef = useRef(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const [toolbarRect, setToolbarRect] = useState(null);
  const textEditInitialRef = useRef({ text: 'Text', richTextHtml: plainTextToRichTextHtml('Text') });
  const syncedTextDraftRef = useRef({ text: 'Text', richTextHtml: plainTextToRichTextHtml('Text') });
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
  const animationEditor        = useEditorStore(s => s.animationEditor);
  const loopAnimationPreview   = useEditorStore(s => s.loopAnimationPreview);
  const currentPage            = useEditorStore((s) => {
    if (s.activeSurface === 'component' && s.componentEditor?.isOpen) {
      return s.componentEditor.page ?? null;
    }
    return s.pages.find((page) => page.id === s.currentPageId) ?? null;
  });
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
  const rawResolved            = el ? resolveElementWithVariables(el, bpId, pageVariables, globalVariables) : null;
  const resolved               = el ? applyAnimationPreviewPatch(rawResolved, getAnimationEditorPreviewPatch(el, bpId, animationEditor)) : null;
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
  const canNestChildrenOnto = !!onDropOntoElement
    && el.type === 'frame'
    && !insideComponentInstanceOnPage
    && !isComponentInstanceOnPage;
  const hasGradientFrameStroke = typeof styles?.borderColor === 'string' && styles.borderColor.includes('gradient(');
  const strokeWidth = Math.max(0, parseFloat(styles?.strokeWidth) || 0);
  const strokeColor = getGradientFallbackColor(styles?.strokeColor, el.type === 'icon' ? (styles?.color ?? '#111827') : '#000000');
  const canvasScale            = viewport?.scale ?? 1;
  const effectiveTextStrokeWidth = strokeWidth > 0 && !isEditingText
    ? (strokeWidth / Math.max(canvasScale, 0.001))
    : 0;
  const useBuilderTextStrokeLayer = el.type === 'text' && effectiveTextStrokeWidth > 0 && !isEditingText;
  const builderTextStrokeRenderScale = useBuilderTextStrokeLayer
    ? Math.max(1, 1 / Math.max(canvasScale, 0.001))
    : 1;

  const isRelative = positionType === 'relative';
  const isSticky   = positionType === 'sticky';
  const isFixed    = positionType === 'fixed';
  // Root-level auto-layout items flow unless explicitly pinned out of layout.
  const isFlowInLayout = !!artboardLayoutOn
    && !el?.parentId
    && !resolved?.absoluteInLayout
    && !isFixed;
  const effectiveFlowPosition = isRelative || isSticky || isFlowInLayout;

  // ── Parent flex direction (needed for fill mode) ───────────
  const parentResolved = parentEl ? resolveElementWithVariables(parentEl, bpId, pageVariables, globalVariables) : null;
  // 'row' | 'column' | 'block'  (block = not a flex parent)
  const parentDir = (() => {
    if (!effectiveFlowPosition) return 'block';
    if (!el?.parentId && artboardLayoutOn) return artboardFlexDir ?? 'column';
    if (el?.parentId && parentResolved?.styles?.display === 'flex')
      return parentResolved.styles.flexDirection ?? 'row';
    return 'block';
  })();
  const parentCrossAlign = (() => {
    if (!effectiveFlowPosition) return undefined;
    if (!el?.parentId && artboardLayoutOn) return artboardAlignItems ?? 'flex-start';
    if (el?.parentId && parentResolved?.styles?.display === 'flex') {
      return parentResolved.styles.alignItems ?? 'stretch';
    }
    return undefined;
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
  const handleRichTextDraftChange = (nextState) => {
    syncedTextDraftRef.current = nextState;
    updateElementLayout(id, bpId, nextState);
  };

  const handleRichTextAlignChange = (textAlign) => {
    updateElementLayout(id, bpId, {
      styles: {
        ...(resolved?.styles ?? {}),
        textAlign,
      },
    });
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
    if (isEditingText) return;
    const nextText = resolved?.text || 'Text';
    const nextRichTextHtml = resolvedRichTextHtml || plainTextToRichTextHtml(nextText);
    syncedTextDraftRef.current = { text: nextText, richTextHtml: nextRichTextHtml };
  }, [el?.type, isEditingText, resolved?.text, resolvedRichTextHtml]);

  useEffect(() => {
    if (!el || !isEditingText || el.type !== 'text') return;
    const initialText = resolved?.text || 'Text';
    const initialRichTextHtml = resolvedRichTextHtml || plainTextToRichTextHtml(initialText);
    textEditInitialRef.current = { text: initialText, richTextHtml: initialRichTextHtml };
    syncedTextDraftRef.current = { text: initialText, richTextHtml: initialRichTextHtml };
    selectAllOnTextEditRef.current = false;
  }, [el?.id, el?.type, isEditingText]);

  useEffect(() => {
    if (!isEditingText || el?.type !== 'text') return undefined;

    const handlePointerDownCapture = (event) => {
      const target = event.target;
      if (isRichTextEditorUiTarget(target) || elementRef.current?.contains(target)) {
        return;
      }
      commitTextEdit();
    };

    const handleFocusInCapture = (event) => {
      const target = event.target;
      if (isRichTextEditorUiTarget(target) || elementRef.current?.contains(target)) {
        return;
      }
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
    if (!isSelected || isEditingText) return;
    elementRef.current?.focus({ preventScroll: true });
  }, [isEditingText, isSelected]);

  useEffect(() => {
    if (!el) return undefined;
    if (isEditingText && el.type === 'text') return undefined;
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
  }, [bpId, el, heightMode, id, isEditingText, resolved?.height, resolved?.width, resolvedRichTextHtml, styles?.fontFamily, styles?.fontSize, styles?.fontWeight, styles?.letterSpacing, styles?.lineHeight, updateElementLayout, widthMode]);

  // Off-canvas: only meaningful on desktop — tablet/mobile inherit desktop positions
  // which may overflow their narrower artboard, but that's expected behaviour not an error.
  const isOffCanvas = bpId === 'desktop' && !el.parentId && bpDef && !effectiveFlowPosition
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
      const initialText = resolved?.text || 'Text';
      const initialRichTextHtml = resolvedRichTextHtml || plainTextToRichTextHtml(initialText);
      textEditInitialRef.current = { text: initialText, richTextHtml: initialRichTextHtml };
      syncedTextDraftRef.current = { text: initialText, richTextHtml: initialRichTextHtml };
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
      e.stopPropagation();
      return;
    }
  };

  const cancelTextEdit = () => {
    const initialState = textEditInitialRef.current;
    syncedTextDraftRef.current = initialState;
    updateElementLayout(id, bpId, initialState);
    setIsEditingText(false);
  };

  const commitTextEdit = () => {
    if (el.type !== 'text') return;
    updateElementLayout(id, bpId, syncedTextDraftRef.current);
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
    const assetPayload = parseAssetDragPayload(e.dataTransfer);
    const canApplyAsset = !insideComponentInstanceOnPage
      && !isComponentInstanceOnPage
      && canAssetApplyToElement(el, assetPayload);
    if (canNestChildrenOnto || canApplyAsset) {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(true);
    }
  };
  const handleDragLeave = () => setDropOver(false);
  const handleDrop = (e) => {
    setDropOver(false);
    const assetPayload = parseAssetDragPayload(e.dataTransfer);
    const canApplyAsset = !insideComponentInstanceOnPage
      && !isComponentInstanceOnPage
      && canAssetApplyToElement(el, assetPayload);
    if (canNestChildrenOnto || canApplyAsset) {
      e.preventDefault();
      e.stopPropagation();
      onDropOntoElement(e, dropTargetElementId);
    }
  };

  // ── Fill-mode flex styles (direction-aware) ───────────────
  // row parent  → width-fill uses flexGrow (main axis), height-fill uses alignSelf
  // column parent → height-fill uses flexGrow (main axis), width-fill uses alignSelf
  // block parent  → fall back to width/height: 100%
  const wFill = effectiveFlowPosition && widthMode  === 'fill';
  const hFill = effectiveFlowPosition && heightMode === 'fill';
  const fillW        = wFill
    ? (parentDir === 'row' ? undefined : '100%')
    : undefined;
  const fillH        = hFill
    ? (parentDir === 'column' ? undefined : '100%')
    : undefined;
  const fillFlexGrow = (wFill && parentDir === 'row')    ? wFr
                     : (hFill && parentDir === 'column') ? hFr
                     : undefined;
  const fillFlexBasis   = fillFlexGrow != null ? '0%' : undefined;
  const fillFlexShrink  = fillFlexGrow != null ? 1   : undefined;
  const fillAlignSelf   = undefined;
  const stickyAlignSelf = isSticky && parentCrossAlign ? parentCrossAlign : undefined;
  const stickyFlowMargins = (() => {
    if (!isSticky || !parentCrossAlign) return null;
    if (parentDir === 'column') {
      if (parentCrossAlign === 'center') return { marginLeft: 'auto', marginRight: 'auto' };
      if (parentCrossAlign === 'flex-end') return { marginLeft: 'auto', marginRight: 0 };
      if (parentCrossAlign === 'flex-start') return { marginLeft: 0, marginRight: 'auto' };
    }
    if (parentDir === 'row') {
      if (parentCrossAlign === 'center') return { marginTop: 'auto', marginBottom: 'auto' };
      if (parentCrossAlign === 'flex-end') return { marginTop: 'auto', marginBottom: 0 };
      if (parentCrossAlign === 'flex-start') return { marginTop: 0, marginBottom: 'auto' };
    }
    return null;
  })();
  const flowMinWidth = wFill && parentDir === 'row' && minW == null ? 0 : minW;
  const flowMinHeight = hFill && parentDir === 'column' && minH == null ? 0 : minH;
  const isDragPreviewActive = dragPreview?.elementId === id && dragPreview?.bpId === bpId;
  const isDraggingSource = draggingElementId === id && draggingElementBpId === bpId;
  const previewDx = isDragPreviewActive ? (dragPreview.dx ?? 0) : 0;
  const previewDy = isDragPreviewActive ? (dragPreview.dy ?? 0) : 0;
  const absoluteLeft = !effectiveFlowPosition ? x + previewDx : x;
  const absoluteTop = !effectiveFlowPosition ? y + previewDy : y;
  const stickyTop = Math.max(0, y ?? 0);
  const previewTransform = effectiveFlowPosition && isDragPreviewActive
    ? `translate(${previewDx}px, ${previewDy}px)`
    : '';
  const rotationTransform = rotation ? `rotate(${rotation}deg)` : '';
  const composedTransform = [previewTransform, rotationTransform].filter(Boolean).join(' ') || undefined;
  const activeLoopAnimation = el ? resolveElementAnimations(el, bpId).find((entry) => entry.type === 'loop') ?? null : null;
  const isLoopPreviewActive = !!activeLoopAnimation
    && loopAnimationPreview?.elementId === id
    && loopAnimationPreview?.bpId === bpId
    && loopAnimationPreview?.animationId === activeLoopAnimation.id;
  const loopAnimationPlayState = useLoopAnimationPlayback(elementRef, isLoopPreviewActive, activeLoopAnimation?.offscreenBehavior);
  const loopAnimationStyle = getLoopAnimationStyle(isLoopPreviewActive ? activeLoopAnimation : null, composedTransform ?? '', loopAnimationPlayState);
  const backgroundImageUrl = getMediaUrl(styles?.backgroundImage);
  const maskedVectorFillActive = (() => {
    const nextShapeKind = getShapePresetKind(resolved) || getShapePresetKind(el);
    if (!['path', 'pen'].includes(nextShapeKind ?? '')) return false;
    const nextVectorShapeData = getVectorShapeData(resolved) || getVectorShapeData(el);
    return nextVectorShapeData?.kind !== 'line' && nextVectorShapeData?.closed === true;
  })();
  const inlineStyle = {
    position: isSticky ? 'sticky' : (effectiveFlowPosition ? 'relative' : 'absolute'),
    '--fb-sticky-top': isSticky ? `${stickyTop}px` : undefined,
    ...(effectiveFlowPosition
      ? { width:      wFill ? fillW : csW,
          height:     hFill ? fillH : csH,
          flexGrow:   fillFlexGrow,
          flexShrink: fillFlexShrink,
          flexBasis:  fillFlexBasis,
          alignSelf:  fillAlignSelf ?? stickyAlignSelf,
          top:        isSticky ? stickyTop : undefined,
          ...(stickyFlowMargins ?? {}),
        }
      : { left: absoluteLeft, top: absoluteTop, width: csW, height: csH }
    ),
    minWidth:  effectiveFlowPosition ? flowMinWidth : minW,
    maxWidth:  maxW,
    minHeight: effectiveFlowPosition ? flowMinHeight : minH,
    maxHeight: maxH,
    transform: loopAnimationStyle ? undefined : composedTransform,
    // backgroundColor can hold a CSS gradient string — route accordingly
    backgroundColor: !maskedVectorFillActive && styles?.backgroundColor && !styles.backgroundColor.includes('gradient(')
      ? styles.backgroundColor
      : undefined,
    backgroundImage: (() => {
      if (maskedVectorFillActive) return undefined;
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
      ? `${styles.borderWidth}px ${styles.borderStyle || 'solid'} ${hasGradientFrameStroke ? 'transparent' : (styles.borderColor || '#000')}`
      : undefined,
    opacity:          (isDraggingSource && effectiveFlowPosition)
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
    mixBlendMode:     styles?.mixBlendMode && styles.mixBlendMode !== 'normal' ? styles.mixBlendMode : undefined,
    filter:           (styles?.blur ?? 0) > 0 ? `blur(${styles.blur}px)` : undefined,
    backdropFilter:   (styles?.backdropBlur ?? 0) > 0 ? `blur(${styles.backdropBlur}px)` : undefined,
    WebkitBackdropFilter: (styles?.backdropBlur ?? 0) > 0 ? `blur(${styles.backdropBlur}px)` : undefined,
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
    ...(loopAnimationStyle ?? {}),
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
    textRendering: 'geometricPrecision',
    WebkitFontSmoothing: 'antialiased',
    position: 'relative',
    zIndex: 1,
    '--fb-text-stroke-width': useBuilderTextStrokeLayer ? undefined : (effectiveTextStrokeWidth > 0 ? `${effectiveTextStrokeWidth}px` : undefined),
    '--fb-text-stroke-color': useBuilderTextStrokeLayer ? undefined : (strokeWidth > 0 && !isEditingText ? strokeColor : undefined),
  } : null;
  const textStrokeLayerStyle = useBuilderTextStrokeLayer ? {
    ...textStyle,
    position: 'absolute',
    inset: 0,
    fontSize: scaleTextMetric(styles?.fontSize ?? 42, styles?.fontSizeUnit ?? 'px', builderTextStrokeRenderScale),
    lineHeight: scaleTextMetric(styles?.lineHeight ?? 1.2, styles?.lineHeightUnit ?? 'em', builderTextStrokeRenderScale),
    letterSpacing: scaleTextMetric(styles?.letterSpacing ?? 0, styles?.letterSpacingUnit ?? 'em', builderTextStrokeRenderScale),
    width: builderTextStrokeRenderScale === 1 ? '100%' : `${builderTextStrokeRenderScale * 100}%`,
    height: textGrowMode === 'fixed'
      ? (builderTextStrokeRenderScale === 1 ? '100%' : `${builderTextStrokeRenderScale * 100}%`)
      : 'auto',
    zIndex: 0,
    pointerEvents: 'none',
    userSelect: 'none',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
    transform: builderTextStrokeRenderScale === 1 ? undefined : `scale(${1 / builderTextStrokeRenderScale})`,
    transformOrigin: 'left top',
    paintOrder: 'stroke fill',
    '--fb-text-stroke-width': `${effectiveTextStrokeWidth * builderTextStrokeRenderScale}px`,
    '--fb-text-stroke-color': strokeColor,
  } : null;
  const iconMarkup = el.type === 'icon' ? sanitizeSvgMarkup(resolved?.svgMarkup ?? '', { forceCurrentColor: false }) : '';
  const shapeKind = getShapePresetKind(resolved) || getShapePresetKind(el);
  const vectorShapeData = ['line', 'path', 'pen'].includes(shapeKind ?? '') ? getVectorShapeData(resolved) || getVectorShapeData(el) : null;
  const vectorFillValue = vectorShapeData?.kind !== 'line' && vectorShapeData?.closed
    ? (styles?.backgroundColor ?? 'transparent')
    : 'transparent';
  const vectorFillMask = vectorShapeData?.kind !== 'line' && vectorShapeData?.closed && vectorFillValue !== 'transparent'
    ? buildSvgDataUrl(buildVectorShapeSvgMarkup(vectorShapeData, {
        width: resolved?.width ?? width,
        height: resolved?.height ?? height,
        fill: '#ffffff',
        stroke: 'none',
        strokeWidth: 0,
      }))
    : '';
  const vectorShapeMarkup = vectorShapeData
    ? buildVectorShapeSvgMarkup(vectorShapeData, {
        width: resolved?.width ?? width,
        height: resolved?.height ?? height,
        fill: vectorShapeData.kind !== 'line' && vectorShapeData.closed && !isGradientPaint(vectorFillValue) && vectorFillValue !== 'transparent'
          ? vectorFillValue
          : 'none',
        stroke: strokeColor,
        strokeWidth: Math.max(0.5, strokeWidth || (shapeKind === 'line' ? 2 : 1.5)),
      })
    : '';
  const builderVideoAutoplay = el.type === 'video'
    ? resolved?.videoAutoplay === true && resolved?.videoDisableAutoplayInBuilder !== true
    : false;
  const videoSource = el.type === 'video'
    ? getResolvedVideoSource(resolved?.videoProvider, resolved?.src, {
        controls: resolved?.videoControls !== false,
        loop: resolved?.videoLoop === true,
        muted: resolved?.videoMuted === true,
        autoplay: builderVideoAutoplay,
      })
    : null;
  const videoEmbedLayout = el.type === 'video'
    ? getVideoEmbedLayout(resolved?.width ?? width, resolved?.height ?? height, styles?.objectFit ?? 'cover')
    : null;
  const scrollSequencePreview = el.type === 'scroll-sequence'
    ? getScrollSequencePreview(resolved)
    : null;
  const embedPreview = el.type === 'embed'
    ? getEmbedPreview(resolved)
    : null;

  useLayoutEffect(() => {
    if (!isEditingText || el?.type !== 'text') {
      setToolbarRect((current) => (current == null ? current : null));
      return undefined;
    }

    const measure = () => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      setToolbarRect((current) => (rectStateChanged(current, nextRect) ? nextRect : current));
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

  if (!el || hidden) return null;

  return (
    <div
      ref={elementRef}
      className={`fb-el${isSelected ? ' fb-el--selected' : ''}${!isSelected && isHovered ? ' fb-el--hovered' : ''}${!isSelected && isDropTarget ? ' fb-el--drop-target' : ''}${interactionLocked ? ' fb-el--locked' : ''}${isOffCanvas ? ' fb-el--offcanvas' : ''}${isFixed ? ' fb-el--fixed' : ''}${isSticky ? ' fb-el--sticky' : ''}${isFlowInLayout ? ' fb-el--flow' : ''}${id === drilledContainerId ? ' fb-el--drilled' : ''}${el.componentInstance ? ' fb-el--component' : ''}${el.componentRoot ? ' fb-el--component-root' : ''}${shapeKind === 'line' ? ' fb-el--vector-line' : ''}`}
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
      {el.type === 'video' && (() => {
        const objectFit = styles?.objectFit ?? 'cover';
        if (!videoSource?.isValid) {
          return (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(120,120,140,0.7)', fontSize: 11, pointerEvents: 'none',
              border: '1.5px dashed rgba(120,120,160,0.35)', borderRadius: 'inherit',
              gap: 6, flexDirection: 'column', background: 'rgba(0,0,0,0.03)',
            }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="1" y="2" width="14" height="12" rx="1.5"/>
                <path d="M6 5.5v5l4-2.5-4-2.5z" fill="currentColor" stroke="none"/>
              </svg>
              <span>Video</span>
            </div>
          );
        }
        if (videoSource.provider === 'upload') {
          return (
            <video
              src={videoSource.src}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit,
                borderRadius: 'inherit',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
              controls={resolved?.videoControls !== false}
              loop={resolved?.videoLoop === true}
              muted={resolved?.videoMuted === true}
              autoPlay={builderVideoAutoplay}
              playsInline
              preload="metadata"
            />
          );
        }
        return (
          <div style={{ ...videoEmbedLayout.wrapperStyle, pointerEvents: 'none' }}>
            <iframe
              src={videoSource.embedUrl}
              title={el.name || 'Video'}
              style={{ ...videoEmbedLayout.frameStyle, pointerEvents: 'none' }}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        );
      })()}
      {el.type === 'scroll-sequence' && (() => {
        const objectFit = styles?.objectFit ?? 'cover';
        const previewType = scrollSequencePreview?.type ?? 'video';
        const previewSrc = scrollSequencePreview?.src ?? '';
        const hasMedia = scrollSequencePreview?.hasMedia === true;
        return (
          <>
            {hasMedia ? (
              previewType === 'video' ? (
                <video
                  src={previewSrc}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit,
                    borderRadius: 'inherit',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    background: '#040712',
                  }}
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={previewSrc}
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit,
                    borderRadius: 'inherit',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                  draggable={false}
                />
              )
            ) : (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(224,231,255,0.82)', fontSize: 11, pointerEvents: 'none',
                border: '1.5px dashed rgba(120,140,255,0.28)', borderRadius: 'inherit',
                gap: 6, flexDirection: 'column', background: 'linear-gradient(180deg, rgba(7,11,25,0.92), rgba(9,17,42,0.82))',
              }}>
                <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1.5" y="2" width="13" height="11" rx="1.8"/>
                  <path d="M4 5.5h5" />
                  <path d="M4 8h8" />
                  <path d="M4 10.5h4" />
                </svg>
                <span>Scroll Sequence</span>
              </div>
            )}
            <div style={{
              position: 'absolute',
              left: 10,
              right: 10,
              bottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              pointerEvents: 'none',
            }}>
              <span style={{
                padding: '5px 8px',
                borderRadius: 999,
                background: 'rgba(5, 10, 24, 0.74)',
                color: '#f8fafc',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                {previewType === 'image-sequence' ? 'Image Sequence' : previewType}
              </span>
              {previewType === 'image-sequence' && scrollSequencePreview?.frameCount ? (
                <span style={{ color: 'rgba(226,232,240,0.92)', fontSize: 10, fontWeight: 600 }}>
                  {scrollSequencePreview.frameCount} frames
                </span>
              ) : null}
            </div>
          </>
        );
      })()}
      {el.type === 'embed' && (() => {
        const mode = embedPreview?.mode ?? 'html';
        const code = embedPreview?.code ?? '';
        if (mode === 'html' && embedPreview?.hasPreview) {
          return (
            <iframe
              srcDoc={embedPreview.srcDoc}
              title={el.name || 'Embed'}
              sandbox=""
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 0,
                background: 'transparent',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          );
        }

        const empty = !code.trim();
        const title = empty
          ? 'Embed'
          : mode === 'shortcode'
            ? 'Shortcode preview renders on publish'
            : mode === 'php'
              ? 'PHP is stored but not executed in the builder'
              : 'React code is stored but not compiled in the builder';
        const badge = empty ? 'Add code' : mode === 'shortcode' ? 'WP' : mode.toUpperCase();
        return (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 18,
            border: '1.5px dashed rgba(120,120,160,0.32)',
            borderRadius: 'inherit',
            background: 'linear-gradient(180deg, rgba(248,250,252,0.92), rgba(241,245,249,0.88))',
            color: '#0f172a',
            pointerEvents: 'none',
          }}>
            <div style={{ display: 'grid', gap: 8, width: '100%', maxWidth: 240 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{title}</span>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(15,23,42,0.08)', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' }}>{badge}</span>
              </div>
              <div style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 10.5,
                lineHeight: 1.5,
                color: 'rgba(15,23,42,0.72)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 110,
                overflow: 'hidden',
              }}>
                {empty ? 'Paste HTML, a shortcode, PHP, or React snippet in Properties.' : code}
              </div>
            </div>
          </div>
        );
      })()}
      {hasGradientFrameStroke && styles?.borderWidth > 0 ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            padding: `${styles.borderWidth}px`,
            boxSizing: 'border-box',
            background: styles.borderColor,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      ) : null}
      {el.type === 'text' && (
        <>
          {textStrokeLayerStyle ? (
            <div
              aria-hidden="true"
              className="fb-text-content fb-text-content--outline-preview"
              style={textStrokeLayerStyle}
              dangerouslySetInnerHTML={{ __html: resolvedRichTextHtml }}
            />
          ) : null}
          {isEditingText ? (
            <RichTextEditor
              value={textEditInitialRef.current.richTextHtml}
              style={textStyle}
              anchorRect={toolbarRect}
              baseStyles={styles}
              selectAllOnMount={selectAllOnTextEditRef.current}
              onChange={handleRichTextDraftChange}
              onCommit={commitTextEdit}
              onCancel={cancelTextEdit}
              onTextAlignChange={handleRichTextAlignChange}
            />
          ) : (
            <div
              className="fb-text-content"
              style={textStyle}
              draggable={false}
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: resolvedRichTextHtml }}
            />
          )}
        </>
      )}
      {el.type === 'icon' && ((vectorShapeMarkup || iconMarkup) ? (
        <div
          className={`fb-icon-content${strokeWidth > 0 ? ' fb-icon-content--stroked' : ''}`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: styles?.color ?? '#111827',
            '--fb-icon-stroke-width': strokeWidth > 0 ? `${strokeWidth}px` : undefined,
            '--fb-icon-stroke-color': strokeWidth > 0 ? strokeColor : undefined,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {vectorFillMask ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: isGradientPaint(vectorFillValue) ? undefined : vectorFillValue,
                backgroundImage: isGradientPaint(vectorFillValue) ? vectorFillValue : undefined,
                WebkitMaskImage: vectorFillMask,
                maskImage: vectorFillMask,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskSize: '100% 100%',
                maskSize: '100% 100%',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
              }}
            />
          ) : null}
          <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: vectorShapeMarkup || iconMarkup }} />
        </div>
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
