import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore, resolveElement, resolveElementAnimations, resolveElementWithVariables, resolvePageLayout, isElementSelected, getSelectionElementIds, applyAnimationPreviewPatch, getAnimationEditorPreviewPatch, getShapePresetKind, getVectorShapeData, buildVectorShapeSvgMarkup, buildLineSvgMarkup, getLoopItemPreviewVariables, loopTemplateRootHasContent } from '../store/editorStore';
import { canAssetApplyToElement, parseAssetDragPayload } from '../store/assetStyles';
import { ensureGoogleFontLoaded, familyToFontStack } from '../components/googleFonts';
import { getEmbedPreview } from '../components/embedUtils';
import RichTextEditor from '../components/RichTextEditor';
import { sanitizeSvgMarkup } from '../components/iconLibrary';
import { getHoverAnimationStyle, getLoopAnimationStyle, useLoopAnimationPlayback } from '../components/loopAnimation';
import { getResolvedRichTextHtml, plainTextToRichTextHtml } from '../components/richText';
import { getResolvedVideoSource, getVideoEmbedLayout } from '../components/videoUtils';
import { buildElementRotationTransform, hasElement3DRotation } from '../utils/elementTransform';
import { isFormContainerType, isFormFieldType, isFormSubmitButtonType } from '../domain/formModel';
import { isLoopElementType, normalizeLoopConfig } from '../domain/loopModel';
import { FORM_STYLE_DEFAULTS, getFormIndicatorOffset, getFormSelectPaddingRight, getFormStateVisualModel, getFormVisualModel } from '../domain/formStyleModel';

const _emptyArr = [];

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

function getConstraintMode(constraints, axis = 'horizontal') {
  const raw = constraints && typeof constraints === 'object' ? constraints : {};
  if (axis === 'horizontal') {
    if (typeof raw.horizontal === 'string') return raw.horizontal;
    if (raw.left && raw.right) return 'stretch';
    if (raw.right && !raw.left) return 'right';
    return 'left';
  }
  if (typeof raw.vertical === 'string') return raw.vertical;
  if (raw.top && raw.bottom) return 'stretch';
  if (raw.bottom && !raw.top) return 'bottom';
  return 'top';
}

function clampFilterPercent(value, fallback = 100) {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(200, parsed));
}

function formatFilterNumber(value) {
  return `${Math.round(value * 1000) / 1000}`;
}

function buildElementFilter(styles) {
  if (!styles || typeof styles !== 'object') return undefined;
  const blur = Math.max(0, typeof styles.blur === 'number' ? styles.blur : parseFloat(styles.blur) || 0);
  const brightness = clampFilterPercent(styles.brightness, 100);
  const contrast = clampFilterPercent(styles.contrast, 100);
  const saturation = clampFilterPercent(styles.saturation, 100);
  const filters = [];

  if (Math.abs(brightness - 100) > 0.01) filters.push(`brightness(${formatFilterNumber(brightness)}%)`);
  if (Math.abs(contrast - 100) > 0.01) filters.push(`contrast(${formatFilterNumber(contrast)}%)`);
  if (Math.abs(saturation - 100) > 0.01) filters.push(`saturate(${formatFilterNumber(saturation)}%)`);
  if (blur > 0.01) filters.push(`blur(${formatFilterNumber(blur)}px)`);

  return filters.length ? filters.join(' ') : undefined;
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

function getLoopPreviewMetrics({ containerWidth, paddingLeft, paddingRight, templateWidth, templateHeight, loopConfig }) {
  const contentWidth = Math.max(56, (containerWidth || 0) - (paddingLeft || 0) - (paddingRight || 0));
  const gap = Math.max(0, loopConfig?.gap ?? 0);
  const layout = loopConfig?.layout ?? 'vertical';
  const columns = Math.max(1, loopConfig?.columns ?? 1);
  const minItemWidth = Math.max(56, loopConfig?.minItemWidth ?? 56);
  const baseWidth = Math.max(56, templateWidth ?? minItemWidth ?? 160);
  const itemHeight = Math.max(48, templateHeight ?? 96);

  if (layout === 'grid') {
    const computedColumnWidth = Math.max(56, (contentWidth - (gap * (columns - 1))) / columns);
    const itemWidth = Math.max(56, Math.min(contentWidth, Math.max(minItemWidth, computedColumnWidth)));
    return { contentWidth, gap, layout, columns, itemWidth, itemHeight };
  }

  return {
    contentWidth,
    gap,
    layout,
    columns,
    itemWidth: Math.min(baseWidth, contentWidth),
    itemHeight,
  };
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

function CanvasElement({ elementId, bpId, isSelected, isDropTarget, dropTargetId, onStartElementDrag, onStartElementResize, onStartElementRotate, onDropOntoElement, onStartRadiusDrag, onStartPaddingDrag, reorderTarget, artboardLayoutOn, artboardFlexDir, artboardAlignItems, dragPreview = null, draggingElementId = null, draggingElementBpId = null }) {
  const [dropOver, setDropOver] = useState(false);
  const [isHoverAnimationActive, setIsHoverAnimationActive] = useState(false);
  const elementRef = useRef(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const [toolbarRect, setToolbarRect] = useState(null);
  const textEditInitialRef = useRef({ text: 'Text', richTextHtml: plainTextToRichTextHtml('Text') });
  const syncedTextDraftRef = useRef({ text: 'Text', richTextHtml: plainTextToRichTextHtml('Text') });
  const selectAllOnTextEditRef = useRef(false);

  const elsById                = useEditorStore(s => s.getElementsById());
  const el                     = elsById[elementId] ?? null;
  const setSelection           = useEditorStore(s => s.setSelection);
  const toggleSelection        = useEditorStore(s => s.toggleSelection);
  const setPrimarySelection    = useEditorStore(s => s.setPrimarySelection);
  const deleteElement          = useEditorStore(s => s.deleteElement);
  const updateElementLayout    = useEditorStore(s => s.updateElementLayout);
  const pushHistory            = useEditorStore(s => s.pushHistory);
  const selection              = useEditorStore(s => s.selection);
  const isHovered              = useEditorStore(s => s.hoveredId === elementId || s.layerHoveredId === elementId);
  const bpDef                  = useEditorStore(s => s.breakpointDefs[bpId]);
  const drilledContainerId     = useEditorStore(s => s.drilledContainerId);
  const setDrilledContainerId  = useEditorStore(s => s.setDrilledContainerId);
  const pendingDraw            = useEditorStore(s => s.pendingDraw);
  const openComponentEditor    = useEditorStore(s => s.openComponentEditor);
  const activeSurface          = useEditorStore(s => s.activeSurface);
  const loopActiveIdx          = useEditorStore(s => s.loopActiveChildIndex[elementId] ?? 0);
  const setLoopActiveChildIndex = useEditorStore(s => s.setLoopActiveChildIndex);
  const setComponentEditorActiveVariant = useEditorStore(s => s.setComponentEditorActiveVariant);
  const canvasScale            = useEditorStore(s => s.viewport.scale);
  const animationEditor        = useEditorStore(s => s.animationEditor);
  const loopAnimationPreview   = useEditorStore(s => s.loopAnimationPreview);
  const hoverAnimationPreview  = useEditorStore(s => s.hoverAnimationPreview);
  const pageVariables          = useEditorStore((s) => {
    const page = s.activeSurface === 'component' && s.componentEditor?.isOpen
      ? (s.componentEditor.page ?? null)
      : (s.pages.find((p) => p.id === s.currentPageId) ?? null);
    return page?.variables ?? _emptyArr;
  });
  const pageLayout             = useEditorStore((s) => {
    const page = s.activeSurface === 'component' && s.componentEditor?.isOpen
      ? (s.componentEditor.page ?? null)
      : (s.pages.find((p) => p.id === s.currentPageId) ?? null);
    return resolvePageLayout(page?.layout, bpId);
  });
  const globalVariables        = useEditorStore(s => s.globalVariables);
  const variableSources        = useEditorStore(s => s.variableSources);
  const children               = useMemo(() => {
    const allElements = useEditorStore.getState().getAllElements();
    return el?.children?.length
      ? el.children.map((childId) => elsById[childId]).filter(Boolean)
      : allElements.filter((candidate) => candidate.parentId === elementId);
  }, [el?.children, elsById, elementId]);

  const parentEl               = el?.parentId ? (elsById[el.parentId] ?? null) : null;
  let componentInstanceAncestor = null;
  if (activeSurface === 'page' && el?.parentId) {
    let cursor = parentEl;
    while (cursor) {
      if (cursor.componentInstance) {
        componentInstanceAncestor = cursor;
        break;
      }
      cursor = cursor.parentId ? (elsById[cursor.parentId] ?? null) : null;
    }
  }
  const loopItemVariables      = el ? getLoopItemPreviewVariables(el, useEditorStore.getState().getAllElements(), variableSources, pageVariables, globalVariables) : [];
  const rawResolved            = el ? resolveElementWithVariables(el, bpId, pageVariables, globalVariables, loopItemVariables) : null;
  const animationPreviewPatch  = el ? getAnimationEditorPreviewPatch(el, bpId, animationEditor) : null;
  const previewTreatAsFlowPositioned = !!rawResolved && (
    ['relative', 'sticky'].includes(rawResolved.positionType ?? 'absolute')
    || (!el?.parentId && pageLayout !== null && !rawResolved.absoluteInLayout && rawResolved.positionType !== 'fixed')
  );
  const resolved               = el ? applyAnimationPreviewPatch(rawResolved, animationPreviewPatch, { treatAsFlowPositioned: previewTreatAsFlowPositioned }) : null;
  const id                     = el?.id ?? elementId;
  const locked                 = el?.locked ?? false;
  const x                      = resolved?.x ?? 0;
  const y                      = resolved?.y ?? 0;
  const width                  = resolved?.width ?? 0;
  const height                 = resolved?.height ?? 0;
  const hidden                 = resolved?.hidden ?? false;
  const rotation               = resolved?.rotation;
  const styles                 = resolved?.styles ?? {};
  const loopConfig             = isLoopElementType(el?.type) ? normalizeLoopConfig(resolved?.loop) : null;
  const loopMode               = loopConfig?.mode ?? 'loop';
  const loopSource             = loopConfig?.source ?? 'query';
  const loopTemplateChild      = isLoopElementType(el?.type) && loopSource === 'query'
    ? (children.find((child) => child?.loopTemplateRootFor === el.id) ?? children[0] ?? null)
    : null;
  const loopTemplateHasContent = loopTemplateRootHasContent(loopTemplateChild);
  const renderedChildrenBase   = isLoopElementType(el?.type) && loopTemplateChild && !loopTemplateHasContent
    ? children.filter((child) => child.id !== loopTemplateChild.id)
    : children;
  const renderedChildren       = (() => {
    if (isLoopElementType(el?.type) && loopSource === 'manual' && (loopMode === 'slideshow' || loopMode === 'carousel') && renderedChildrenBase.length > 0) {
      const idx = Math.min(loopActiveIdx, renderedChildrenBase.length - 1);
      return [renderedChildrenBase[idx]];
    }
    return renderedChildrenBase;
  })();
  const resolvedLoopTemplate   = loopTemplateChild ? resolveElementWithVariables(loopTemplateChild, bpId, pageVariables, globalVariables, getLoopItemPreviewVariables(loopTemplateChild, useEditorStore.getState().getAllElements(), variableSources, pageVariables, globalVariables)) : null;
  const loopPreviewItemCount   = (() => {
    if (!isLoopElementType(el?.type)) return 0;
    // For manual source, count is direct children (minus template shell)
    if (loopSource === 'manual' || loopSource === 'component') {
      return Math.max(1, children.length);
    }
    const sourceType = loopConfig?.query?.source ?? 'collection';
    if (sourceType === 'selected') return Math.max(0, (loopConfig?.query?.selectedIds ?? []).length);
    if (sourceType === 'variable') return loopItemVariables.length ? 1 : 0;
    return Math.max(0, loopConfig?.query?.limit ?? 1);
  })();
  const ghostCountRaw          = (() => {
    if (!isLoopElementType(el?.type)) return 0;
    if (loopMode === 'slideshow') return 0; // slideshow shows one item at a time
    if (loopMode === 'carousel') return Math.max(0, Math.min(loopConfig.carousel?.visibleItems ?? 3, loopPreviewItemCount) - 1);
    if (loopMode === 'ticker') return Math.min(3, Math.max(0, loopPreviewItemCount - 1));
    return Math.max(0, loopPreviewItemCount - 1);
  })();
  const ghostCount             = Math.min(ghostCountRaw, 4);
  const loopGhostPaddingTop    = Math.max(0, parseFloat(styles?.paddingTop) || 0);
  const loopGhostPaddingRight  = Math.max(0, parseFloat(styles?.paddingRight) || 0);
  const loopGhostPaddingBottom = Math.max(0, parseFloat(styles?.paddingBottom) || 0);
  const loopGhostPaddingLeft   = Math.max(0, parseFloat(styles?.paddingLeft) || 0);
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
    && (el.type === 'frame' || isLoopElementType(el.type) || isFormContainerType(el.type))
    && !insideComponentInstanceOnPage
    && !isComponentInstanceOnPage;
  const hasGradientFrameStroke = typeof styles?.borderColor === 'string' && styles.borderColor.includes('gradient(');
  const strokeWidth = Math.max(0, parseFloat(styles?.strokeWidth) || 0);
  const strokeColor = getGradientFallbackColor(styles?.strokeColor, el.type === 'icon' ? (styles?.color ?? '#111827') : '#000000');
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
  const isSurfaceStyledFormField = isFormFieldType(el.type);

  // ── Parent flex direction (needed for fill mode) ───────────
  const parentResolved = parentEl ? resolveElementWithVariables(parentEl, bpId, pageVariables, globalVariables, getLoopItemPreviewVariables(parentEl, useEditorStore.getState().getAllElements(), variableSources, pageVariables, globalVariables)) : null;
  const parentIsLoopElement = isLoopElementType(parentEl?.type);
  const isLoopTemplateRoot = !!(el?.loopTemplateRootFor && parentIsLoopElement && el.loopTemplateRootFor === parentEl.id);
  const parentLoopConfig = isLoopTemplateRoot ? normalizeLoopConfig(parentResolved?.loop ?? parentEl?.base?.loop) : null;
  const parentLoopStyles = parentResolved?.styles ?? parentEl?.base?.styles ?? {};
  const absoluteContainerW = parentEl ? (parentResolved?.width ?? bpDef?.width ?? 0) : (bpDef?.width ?? 0);
  const absoluteContainerH = isFixed
    ? (bpDef?.viewportFoldH ?? bpDef?.height ?? 0)
    : (parentEl ? (parentResolved?.height ?? bpDef?.height ?? 0) : (bpDef?.height ?? 0));
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
    if (!el) return;
    const shouldLoadFont = el.type === 'text' || isFormFieldType(el.type) || isFormSubmitButtonType(el.type);
    if (!shouldLoadFont) return;
    ensureGoogleFontLoaded(styles?.fontFamily ?? FORM_STYLE_DEFAULTS.fontFamily, {
      text: resolved?.text || resolved?.label || resolved?.placeholder || el.name || 'Text',
      weight: styles?.fontWeight ?? (isFormSubmitButtonType(el.type) ? 600 : 400),
      style: styles?.fontStyle ?? 'normal',
    });
  }, [el, resolved?.label, resolved?.placeholder, resolved?.text, styles?.fontFamily, styles?.fontStyle, styles?.fontWeight]);

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
    if (isLoopElementType(el.type)) return undefined;
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
    // Double-click on a selected container — check for a line child near cursor & drill in
    if (isSelected && e.detail >= 2 && elementRef.current) {
      const allEls = useEditorStore.getState().getAllElements();
      const childLines = elementRef.current.querySelectorAll('.fb-el--vector-line');
      const hitDist = 6;
      for (const lineDom of childLines) {
        const svgLine = lineDom.querySelector('line');
        if (!svgLine) continue;
        const ctm = svgLine.closest('svg')?.getScreenCTM();
        if (!ctm) continue;
        const a = new DOMPoint(svgLine.x1.baseVal.value, svgLine.y1.baseVal.value).matrixTransform(ctm);
        const b = new DOMPoint(svgLine.x2.baseVal.value, svgLine.y2.baseVal.value).matrixTransform(ctm);
        const dx = b.x - a.x, dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1) continue;
        const t = Math.max(0, Math.min(1, ((e.clientX - a.x) * dx + (e.clientY - a.y) * dy) / lenSq));
        const px = a.x + t * dx, py = a.y + t * dy;
        const dist = Math.sqrt((e.clientX - px) ** 2 + (e.clientY - py) ** 2);
        if (dist <= hitDist) {
          e.preventDefault();
          setDrilledContainerId(id);
          setSelection({ elementId: lineDom.dataset.id, bpId });
          return;
        }
      }
    }
    onStartElementDrag && onStartElementDrag(e, bpId, { id });
  };

  const handleMouseDownCapture = (e) => {
    if (e.button !== 0 || !onStartElementDrag) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (isEditingText || isRichTextEditorUiTarget(e.target)) return;

    const selectedIds = getSelectionElementIds(selection);
    if (!selectedIds.length || selectedIds.includes(id)) return;

    let cursor = el;
    let selectedAncestorId = null;
    while (cursor?.parentId) {
      cursor = elsById[cursor.parentId] ?? null;
      if (cursor && selectedIds.includes(cursor.id)) {
        selectedAncestorId = cursor.id;
        break;
      }
    }

    if (!selectedAncestorId) return;

    // Double-click on a child inside a selected container → drill into the container
    if (e.detail >= 2) {
      e.preventDefault();
      e.stopPropagation();
      const ancestor = elsById[selectedAncestorId];
      if (ancestor?.componentInstance?.componentId) {
        setSelection({ elementId: selectedAncestorId, bpId });
        openComponentEditor(ancestor.componentInstance.componentId);
      } else {
        // Find the direct child of the ancestor that is (or contains) this element
        let directChild = el;
        while (directChild && directChild.parentId !== selectedAncestorId) {
          directChild = elsById[directChild.parentId] ?? null;
        }
        setDrilledContainerId(selectedAncestorId);
        if (directChild) {
          setSelection({ elementId: directChild.id, bpId });
        } else {
          setSelection({ elementId: selectedAncestorId, bpId });
        }
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setPrimarySelection(selectedAncestorId);
    onStartElementDrag(e, bpId, { id: selectedAncestorId });
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
  const explicitAlignSelf = ['auto', 'flex-start', 'center', 'flex-end', 'stretch'].includes(styles?.alignSelf)
    ? styles.alignSelf
    : undefined;
  const fillAlignSelf   = explicitAlignSelf ?? (
    (hFill && parentDir === 'row') || (wFill && parentDir === 'column')
      ? 'stretch'
      : undefined
  );
  const stickyAlignSelf = isSticky && parentCrossAlign ? parentCrossAlign : undefined;
  const effectiveCrossAxisAlign = explicitAlignSelf && explicitAlignSelf !== 'auto'
    ? explicitAlignSelf
    : parentCrossAlign;
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
  const constraintHorizontal = getConstraintMode(resolved?.constraints, 'horizontal');
  const constraintVertical = getConstraintMode(resolved?.constraints, 'vertical');
  const displayWidthPx = widthMode === 'relative' ? ((absoluteContainerW || 0) * (wPct / 100)) : (widthMode === 'fill' ? (absoluteContainerW || 0) : width);
  const displayHeightPx = heightMode === 'relative' ? ((absoluteContainerH || 0) * (hPct / 100)) : (heightMode === 'fill' ? (absoluteContainerH || 0) : height);
  const absoluteRight = (absoluteContainerW || 0) - (x + previewDx) - displayWidthPx;
  const absoluteBottom = (absoluteContainerH || 0) - (y + previewDy) - displayHeightPx;
  const absoluteCenterOffsetX = (x + previewDx) - (((absoluteContainerW || 0) - displayWidthPx) / 2);
  const absoluteCenterOffsetY = (y + previewDy) - (((absoluteContainerH || 0) - displayHeightPx) / 2);
  const stickyTop = Math.max(0, y ?? 0);
  const previewTransform = effectiveFlowPosition && isDragPreviewActive
    ? `translate(${previewDx}px, ${previewDy}px)`
    : '';
  const naturalFlowAlignedOffsetX = (() => {
    if (!effectiveFlowPosition || !animationPreviewPatch?.layout) return 0;
    if (parentDir !== 'column') return 0;
    const baseWidth = typeof rawResolved?.width === 'number' ? rawResolved.width : (parseFloat(rawResolved?.width) || 0);
    const nextWidth = typeof resolved?.width === 'number' ? resolved.width : (parseFloat(resolved?.width) || 0);
    const widthDelta = Math.max(0, baseWidth - nextWidth);
    if (widthDelta <= 0.0001) return 0;
    if (effectiveCrossAxisAlign === 'center') return widthDelta / 2;
    if (effectiveCrossAxisAlign === 'flex-end') return widthDelta;
    return 0;
  })();
  const naturalFlowAlignedOffsetY = (() => {
    if (!effectiveFlowPosition || !animationPreviewPatch?.layout) return 0;
    if (parentDir !== 'row') return 0;
    const baseHeight = typeof rawResolved?.height === 'number' ? rawResolved.height : (parseFloat(rawResolved?.height) || 0);
    const nextHeight = typeof resolved?.height === 'number' ? resolved.height : (parseFloat(resolved?.height) || 0);
    const heightDelta = Math.max(0, baseHeight - nextHeight);
    if (heightDelta <= 0.0001) return 0;
    if (effectiveCrossAxisAlign === 'center') return heightDelta / 2;
    if (effectiveCrossAxisAlign === 'flex-end') return heightDelta;
    return 0;
  })();
  const animationPreviewPatchTransforms = effectiveFlowPosition && animationPreviewPatch?.layout
    ? [
        (resolved?.x != null && rawResolved?.x != null && (resolved.x !== rawResolved.x || naturalFlowAlignedOffsetX !== 0))
          ? `translateX(${(resolved.x - rawResolved.x) - naturalFlowAlignedOffsetX}px)`
          : '',
        (!isSticky && resolved?.y != null && rawResolved?.y != null && (resolved.y !== rawResolved.y || naturalFlowAlignedOffsetY !== 0))
          ? `translateY(${(resolved.y - rawResolved.y) - naturalFlowAlignedOffsetY}px)`
          : '',
      ].filter(Boolean).join(' ')
    : '';
  const rotationTransform = buildElementRotationTransform(resolved ?? el ?? {});
  const absoluteConstraintTransforms = [];
  const absolutePositionStyle = !effectiveFlowPosition ? (() => {
    const nextStyle = { width: csW, height: csH };

    if (widthMode === 'fill') {
      nextStyle.left = 0;
      nextStyle.right = 0;
      nextStyle.width = 'auto';
    } else if (constraintHorizontal === 'stretch') {
      nextStyle.left = x + previewDx;
      nextStyle.right = absoluteRight;
      nextStyle.width = 'auto';
    } else if (constraintHorizontal === 'right') {
      nextStyle.right = absoluteRight;
    } else if (constraintHorizontal === 'center') {
      nextStyle.left = `calc(50% + ${absoluteCenterOffsetX}px)`;
      absoluteConstraintTransforms.push('translateX(-50%)');
    } else {
      nextStyle.left = x + previewDx;
    }

    if (heightMode === 'fill') {
      nextStyle.top = 0;
      nextStyle.bottom = 0;
      nextStyle.height = 'auto';
    } else if (constraintVertical === 'stretch') {
      nextStyle.top = y + previewDy;
      nextStyle.bottom = absoluteBottom;
      nextStyle.height = 'auto';
    } else if (constraintVertical === 'bottom') {
      nextStyle.bottom = absoluteBottom;
    } else if (constraintVertical === 'center') {
      nextStyle.top = `calc(50% + ${absoluteCenterOffsetY}px)`;
      absoluteConstraintTransforms.push('translateY(-50%)');
    } else {
      nextStyle.top = y + previewDy;
    }

    return nextStyle;
  })() : null;
  const composedTransform = [previewTransform, animationPreviewPatchTransforms, ...absoluteConstraintTransforms, rotationTransform].filter(Boolean).join(' ') || undefined;
  const activeLoopAnimation = el ? resolveElementAnimations(el, bpId).find((entry) => entry.type === 'loop') ?? null : null;
  const activeHoverAnimation = el ? resolveElementAnimations(el, bpId).find((entry) => entry.type === 'hover') ?? null : null;
  const isLoopPreviewActive = !!activeLoopAnimation
    && loopAnimationPreview?.elementId === id
    && loopAnimationPreview?.bpId === bpId
    && loopAnimationPreview?.animationId === activeLoopAnimation.id;
  const isHoverPreviewActive = !!activeHoverAnimation
    && hoverAnimationPreview?.elementId === id
    && hoverAnimationPreview?.bpId === bpId
    && hoverAnimationPreview?.animationId === activeHoverAnimation.id;
  const loopAnimationPlayState = useLoopAnimationPlayback(elementRef, isLoopPreviewActive, activeLoopAnimation?.offscreenBehavior);
  const loopAnimationStyle = getLoopAnimationStyle(isLoopPreviewActive ? activeLoopAnimation : null, composedTransform ?? '', loopAnimationPlayState);
  const baseOpacity = resolved?.hidden ? 0 : (styles?.opacity ?? 1);
  const hoverAnimationStyle = isHoverPreviewActive
    ? getHoverAnimationStyle(activeHoverAnimation, composedTransform ?? '', baseOpacity, isHoverAnimationActive)
    : null;
  const activeAnimationStyle = hoverAnimationStyle ?? loopAnimationStyle;
  const backgroundImageUrl = getMediaUrl(styles?.backgroundImage);
  const elementFilter = buildElementFilter(styles);
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
          alignSelf:  isSticky ? (explicitAlignSelf ?? stickyAlignSelf) : fillAlignSelf,
          top:        isSticky ? stickyTop : undefined,
          ...(stickyFlowMargins ?? {}),
        }
      : absolutePositionStyle
    ),
    minWidth:  effectiveFlowPosition ? flowMinWidth : minW,
    maxWidth:  maxW,
    minHeight: effectiveFlowPosition ? flowMinHeight : minH,
    maxHeight: maxH,
    transform: activeAnimationStyle ? undefined : composedTransform,
    transformOrigin: 'center center',
    transformStyle: hasElement3DRotation(resolved ?? el ?? {}) ? 'preserve-3d' : undefined,
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
    filter:           elementFilter,
    backdropFilter:   (styles?.backdropBlur ?? 0) > 0 ? `blur(${styles.backdropBlur}px)` : undefined,
    WebkitBackdropFilter: (styles?.backdropBlur ?? 0) > 0 ? `blur(${styles.backdropBlur}px)` : undefined,
    zIndex:           isDragPreviewActive ? 10001 : (styles?.zIndex ?? undefined),
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
    ...(activeAnimationStyle ?? {}),
  };

  if (isLoopTemplateRoot && parentLoopConfig) {
    const loopMetrics = getLoopPreviewMetrics({
      containerWidth: parentResolved?.width ?? parentEl?.base?.width ?? 0,
      paddingLeft: Math.max(0, parseFloat(parentLoopStyles?.paddingLeft) || 0),
      paddingRight: Math.max(0, parseFloat(parentLoopStyles?.paddingRight) || 0),
      templateWidth: resolved?.width ?? width,
      templateHeight: resolved?.height ?? height,
      loopConfig: parentLoopConfig,
    });
    const itemWidth = loopMetrics.itemWidth;

    inlineStyle.width = itemWidth;
    inlineStyle.minWidth = itemWidth;

    if (parentLoopConfig.layout === 'grid' || parentLoopConfig.layout === 'horizontal') {
      inlineStyle.flex = `0 0 ${itemWidth}px`;
      inlineStyle.maxWidth = itemWidth;
    }
  }

  const elementBorderRadiusValue = (() => {
    if (styles?.borderRadiusMode === 'independent') {
      const tl = typeof styles.borderRadiusTL === 'number' ? styles.borderRadiusTL : (styles.borderRadius ?? 0);
      const tr = typeof styles.borderRadiusTR === 'number' ? styles.borderRadiusTR : (styles.borderRadius ?? 0);
      const br = typeof styles.borderRadiusBR === 'number' ? styles.borderRadiusBR : (styles.borderRadius ?? 0);
      const bl = typeof styles.borderRadiusBL === 'number' ? styles.borderRadiusBL : (styles.borderRadius ?? 0);
      return `${tl}px ${tr}px ${br}px ${bl}px`;
    }
    return typeof styles?.borderRadius === 'number' ? `${styles.borderRadius}px` : (styles?.borderRadius ?? '0px');
  })();

  if (isSurfaceStyledFormField) {
    inlineStyle.backgroundColor = undefined;
    inlineStyle.backgroundImage = undefined;
    inlineStyle.borderRadius = undefined;
    inlineStyle.border = undefined;
    inlineStyle.boxShadow = undefined;
    inlineStyle.overflow = 'visible';
    inlineStyle.display = undefined;
    inlineStyle.gap = undefined;
    inlineStyle.paddingTop = undefined;
    inlineStyle.paddingRight = undefined;
    inlineStyle.paddingBottom = undefined;
    inlineStyle.paddingLeft = undefined;
    inlineStyle.alignItems = undefined;
    inlineStyle.justifyContent = undefined;
  }

  const textStyle = el.type === 'text' ? {
    fontFamily: familyToFontStack(styles?.fontFamily ?? 'Inter'),
    fontWeight: styles?.fontWeight ?? 400,
    fontStyle: styles?.fontStyle ?? 'normal',
    fontSize: `${styles?.fontSize ?? 42}${styles?.fontSizeUnit ?? 'px'}`,
    lineHeight: `${styles?.lineHeight ?? 1.2}${styles?.lineHeightUnit ?? 'em'}`,
    letterSpacing: `${styles?.letterSpacing ?? 0}${styles?.letterSpacingUnit ?? 'em'}`,
    color: (typeof styles?.color === 'string' && styles.color.includes('gradient(')) || (typeof styles?.backgroundColor === 'string' && styles.backgroundColor.includes('gradient('))
      ? 'transparent'
      : (styles?.color ?? '#000000'),
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
    backgroundImage: (() => {
      const colorGrad = typeof styles?.color === 'string' && styles.color.includes('gradient(') ? styles.color : '';
      const bgGrad = typeof styles?.backgroundColor === 'string' && styles.backgroundColor.includes('gradient(') ? styles.backgroundColor : '';
      return colorGrad || bgGrad || undefined;
    })(),
    backgroundClip: (typeof styles?.color === 'string' && styles.color.includes('gradient(')) || (typeof styles?.backgroundColor === 'string' && styles.backgroundColor.includes('gradient('))
      ? 'text'
      : undefined,
    WebkitBackgroundClip: (typeof styles?.color === 'string' && styles.color.includes('gradient(')) || (typeof styles?.backgroundColor === 'string' && styles.backgroundColor.includes('gradient('))
      ? 'text'
      : undefined,
    WebkitTextFillColor: (typeof styles?.color === 'string' && styles.color.includes('gradient(')) || (typeof styles?.backgroundColor === 'string' && styles.backgroundColor.includes('gradient('))
      ? 'transparent'
      : undefined,
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
  const lineMarkup = shapeKind === 'line' ? buildLineSvgMarkup({
    stroke: strokeColor || '#111827',
    strokeWidth: Math.max(0.5, strokeWidth || 2),
    lineCap: styles?.lineCap ?? 'round',
  }) : '';
  const vectorShapeData = ['path', 'pen'].includes(shapeKind ?? '') ? getVectorShapeData(resolved) || getVectorShapeData(el) : null;
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
        lineCap: styles?.lineCap ?? 'round',
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
  }, [el?.type, isEditingText, canvasScale, resolved?.width, resolved?.height, x, y]);

  if (!el || hidden) return null;

  return (
    <div
      ref={elementRef}
      className={`fb-el${isSelected ? ' fb-el--selected' : ''}${isHovered ? ' fb-el--hovered' : ''}${!isSelected && isDropTarget ? ' fb-el--drop-target' : ''}${interactionLocked ? ' fb-el--locked' : ''}${isOffCanvas ? ' fb-el--offcanvas' : ''}${isFixed ? ' fb-el--fixed' : ''}${isSticky ? ' fb-el--sticky' : ''}${isFlowInLayout ? ' fb-el--flow' : ''}${id === drilledContainerId ? ' fb-el--drilled' : ''}${el.componentInstance ? ' fb-el--component' : ''}${el.componentRoot ? ' fb-el--component-root' : ''}${shapeKind === 'line' ? ' fb-el--vector-line' : ''}`}
      style={inlineStyle}
      onMouseEnter={() => setIsHoverAnimationActive(true)}
      onMouseLeave={() => setIsHoverAnimationActive(false)}
      onMouseDownCapture={handleMouseDownCapture}
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
      {isFormContainerType(el.type) ? (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
            borderRadius: 999,
            background: 'rgba(5,10,24,0.64)',
            color: 'rgba(255,255,255,0.92)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          <span>Form</span>
          <span style={{ opacity: 0.6 }}>{children.length} fields</span>
        </div>
      ) : null}
      {isFormFieldType(el.type) ? (() => {
        const label = resolved?.label || el.name || 'Field';
        const placeholder = resolved?.placeholder || '';
        const helperText = resolved?.helperText || '';
        const options = Array.isArray(resolved?.fieldOptions) ? resolved.fieldOptions.filter((option) => option?.enabled !== false) : [];
        const visualModel = getFormVisualModel(styles);
        const stateVisualModel = getFormStateVisualModel(styles, { visualModel });
        const previewState = stateVisualModel.previewState;
        const isHoverStatePreview = previewState === 'hover';
        const isFocusStatePreview = previewState === 'focus';
        const isCheckedStatePreview = previewState === 'checked';
        const fontFamily = familyToFontStack(visualModel.fontFamily);
        const fontSize = visualModel.fontSize;
        const lineHeight = visualModel.lineHeight;
        const letterSpacing = visualModel.letterSpacing;
        const fieldGap = visualModel.gap;
        const paddingTop = visualModel.paddingTop;
        const paddingRight = visualModel.paddingRight;
        const paddingBottom = visualModel.paddingBottom;
        const paddingLeft = visualModel.paddingLeft;
        const textAlign = visualModel.textAlign;
        const textColor = visualModel.textColor;
        const fontWeight = visualModel.fontWeight;
        const labelStyle = {
          fontFamily,
          fontSize: visualModel.labelFontSize,
          fontWeight: Math.max(600, fontWeight),
          color: textColor,
          letterSpacing,
          lineHeight,
          textAlign,
        };
        const bodyTextStyle = {
          fontFamily,
          fontSize,
          fontWeight,
          fontStyle: styles?.fontStyle ?? 'normal',
          color: textColor,
          letterSpacing,
          lineHeight,
          textAlign,
          textDecoration: styles?.textDecoration ?? 'none',
        };
        const helperStyle = {
          ...bodyTextStyle,
          fontSize: visualModel.helperFontSize,
          color: visualModel.helperColor,
        };
        const placeholderColor = visualModel.placeholderColor;
        const indicatorColor = visualModel.iconColor;
        const selectIcon = visualModel.selectIcon;
        const checkboxAccentColor = styles?.checkboxAccentColor ?? FORM_STYLE_DEFAULTS.checkboxAccentColor;
        const controlBorderColor = isFocusStatePreview
          ? stateVisualModel.focusBorderColor
          : (isHoverStatePreview ? stateVisualModel.hoverBorderColor : visualModel.borderColor);
        const controlBackgroundColor = isFocusStatePreview
          ? stateVisualModel.focusBackgroundColor
          : (isHoverStatePreview ? stateVisualModel.hoverBackgroundColor : visualModel.backgroundColor);
        const controlBoxShadow = isFocusStatePreview ? stateVisualModel.focusBoxShadow : visualModel.boxShadow;
        const choiceControlBorderColor = isCheckedStatePreview
          ? stateVisualModel.checkedBorderColor
          : controlBorderColor;
        const choiceControlBackgroundColor = isCheckedStatePreview
          ? stateVisualModel.checkedBackgroundColor
          : controlBackgroundColor;
        const choiceControlBoxShadow = isCheckedStatePreview
          ? stateVisualModel.checkedBoxShadow
          : controlBoxShadow;
        const stateTransition = `${Math.max(0, stateVisualModel.stateTransitionDuration)}s ${stateVisualModel.stateTransitionEasing}`;
        const shellStyle = {
          position: 'absolute',
          inset: 0,
          borderRadius: elementBorderRadiusValue,
          border: `${visualModel.borderWidth}px ${visualModel.borderStyle} ${controlBorderColor}`,
          background: controlBackgroundColor,
          color: '#0f172a',
          pointerEvents: 'none',
          overflow: 'hidden',
          boxShadow: controlBoxShadow,
        };
        const controlShellStyle = {
          ...shellStyle,
          position: 'relative',
          inset: 'auto',
          minHeight: visualModel.controlMinHeight,
          width: '100%',
          boxSizing: 'border-box',
          flex: '0 0 auto',
        };
        const nativeControlStyle = {
          width: '100%',
          minHeight: visualModel.controlMinHeight,
          display: 'block',
          boxSizing: 'border-box',
          border: 0,
          outline: 'none',
          background: 'transparent',
          color: textColor,
          boxShadow: 'none',
          WebkitBoxShadow: 'none',
          margin: 0,
          maxWidth: 'none',
          minWidth: 0,
          borderRadius: 0,
          ...bodyTextStyle,
        };
        const transparentShellStyle = {
          ...shellStyle,
          border: 'none',
          borderRadius: 0,
          background: 'transparent',
          boxShadow: 'none',
        };
        const stackHeight = heightMode === 'hug' ? 'auto' : '100%';
        const buildFieldGridRows = (controlMinHeight) => {
          const rows = [];
          if (label) rows.push('auto');
          rows.push(`minmax(${controlMinHeight}px, ${heightMode === 'hug' ? 'auto' : '1fr'})`);
          if (helperText) rows.push('auto');
          return rows.join(' ');
        };
        const richTextPreviewHtml = typeof resolved?.defaultValue === 'string' ? resolved.defaultValue.trim() : '';
        const richTextPreviewPlainText = richTextPreviewHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const richTextPreviewIsEmpty = richTextPreviewPlainText.length === 0;
        const choiceControlStyle = {
          width: FORM_STYLE_DEFAULTS.checkboxSize,
          height: FORM_STYLE_DEFAULTS.checkboxSize,
          minWidth: FORM_STYLE_DEFAULTS.checkboxSize,
          minHeight: FORM_STYLE_DEFAULTS.checkboxSize,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          border: `${visualModel.borderWidth}px ${visualModel.borderStyle} ${choiceControlBorderColor}`,
          borderRadius: elementBorderRadiusValue,
          background: choiceControlBackgroundColor,
          boxShadow: choiceControlBoxShadow,
          color: checkboxAccentColor,
          transition: `border-color ${stateTransition}, background-color ${stateTransition}, box-shadow ${stateTransition}, color ${stateTransition}`,
          flex: '0 0 auto',
        };
        const checkboxMarkStyle = {
          width: 8,
          height: 5,
          borderLeft: `1.8px solid ${checkboxAccentColor}`,
          borderBottom: `1.8px solid ${checkboxAccentColor}`,
          transform: 'rotate(-45deg) translateY(-1px)',
        };
        const radioDotStyle = {
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: checkboxAccentColor,
        };

        if (el.type === 'checkbox') {
          const isChecked = isCheckedStatePreview || !!resolved?.defaultValue;
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', height: '100%', alignContent: 'center', gap: fieldGap }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: fieldGap, width: '100%', height: '100%', color: textColor, ...bodyTextStyle }}>
                <span aria-hidden="true" style={choiceControlStyle}>{isChecked ? <span style={checkboxMarkStyle} /> : null}</span>
                <span>{label}</span>
              </label>
              {helperText ? <span style={helperStyle}>{helperText}</span> : null}
            </div>
          );
        }

        if (el.type === 'radio-group') {
          const checkedValue = isCheckedStatePreview
            ? (resolved?.defaultValue || options[0]?.value || '')
            : (resolved?.defaultValue || '');
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', height: '100%', alignContent: 'start', gap: fieldGap }}>
              {label ? <span style={labelStyle}>{label}</span> : null}
              <div style={{ display: 'grid', gap: fieldGap }}>
                {options.length
                  ? options.map((option) => (
                      <label key={option.id || option.value} style={{ display: 'flex', alignItems: 'center', gap: fieldGap, color: textColor, ...bodyTextStyle }}>
                        <span aria-hidden="true" style={{ ...choiceControlStyle, borderRadius: '999px' }}>{checkedValue === option.value ? <span style={radioDotStyle} /> : null}</span>
                        <span>{option.label}</span>
                      </label>
                    ))
                  : <span style={bodyTextStyle}>{label}</span>}
              </div>
              {helperText ? <span style={helperStyle}>{helperText}</span> : null}
            </div>
          );
        }

        if (el.type === 'dropdown') {
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', height: '100%', alignContent: 'start', gap: fieldGap }}>
              {label ? <span style={labelStyle}>{label}</span> : null}
              <div style={{ ...controlShellStyle }}>
                <select
                  value={resolved?.defaultValue ?? ''}
                  disabled
                  tabIndex={-1}
                  style={{
                    ...nativeControlStyle,
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    padding: `${paddingTop}px ${getFormSelectPaddingRight(paddingRight)}px ${paddingBottom}px ${paddingLeft}px`,
                    color: placeholderColor,
                  }}
                >
                  <option value="">{placeholder || 'Select an option'}</option>
                  {options.map((option) => (
                    <option key={option.id || option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {selectIcon !== 'none' ? <span aria-hidden="true" style={{ position: 'absolute', right: getFormIndicatorOffset(paddingRight), top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: indicatorColor, pointerEvents: 'none' }}>{selectIcon === 'chevron' ? '⌄' : '▼'}</span> : null}
              </div>
              {helperText ? <span style={helperStyle}>{helperText}</span> : null}
            </div>
          );
        }

        if (el.type === 'textarea-field') {
          const previewContent = `${resolved?.defaultValue ?? ''}`.trim();
          const controlMinHeight = Math.max(96, visualModel.controlMinHeight);
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', height: stackHeight, alignContent: 'start', gap: fieldGap, gridTemplateRows: buildFieldGridRows(controlMinHeight) }}>
              {label ? <span style={labelStyle}>{label}</span> : null}
              <div style={{ ...controlShellStyle, minHeight: controlMinHeight, height: heightMode === 'hug' ? 'auto' : '100%', display: 'flex', alignItems: 'stretch' }}>
                <textarea
                  value={previewContent || placeholder || 'Write a longer message...'}
                  readOnly
                  tabIndex={-1}
                  rows={4}
                  style={{
                    ...nativeControlStyle,
                    minHeight: controlMinHeight,
                    height: heightMode === 'hug' ? 'auto' : '100%',
                    color: previewContent ? textColor : placeholderColor,
                    padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
                    resize: 'none',
                  }}
                />
              </div>
              {helperText ? <span style={helperStyle}>{helperText}</span> : null}
            </div>
          );
        }

        if (el.type === 'rich-text-editor') {
          const controlMinHeight = Math.max(120, visualModel.controlMinHeight);
          const editorMinHeight = Math.max(96, visualModel.controlMinHeight);
          const toolbarStyle = {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            minHeight: 36,
            background: 'rgba(15,23,42,0.04)',
            padding: `8px ${paddingRight}px 8px ${paddingLeft}px`,
            borderBottom: `${visualModel.borderWidth}px ${visualModel.borderStyle} ${controlBorderColor}`,
            ...bodyTextStyle,
            fontSize,
            color: textColor,
          };
          const toolbarButtonStyle = {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 30,
            height: 28,
            padding: '0 8px',
            border: 0,
            borderRadius: 8,
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 600,
            lineHeight: 1,
            opacity: 0.78,
          };
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', height: stackHeight, alignContent: 'start', gap: fieldGap, gridTemplateRows: buildFieldGridRows(controlMinHeight) }}>
              {label ? <span style={labelStyle}>{label}</span> : null}
              <div style={{ ...controlShellStyle, display: 'grid', gridTemplateRows: `auto minmax(${editorMinHeight}px, ${heightMode === 'hug' ? 'auto' : '1fr'})`, minHeight: controlMinHeight, height: heightMode === 'hug' ? 'auto' : '100%' }}>
                <div style={toolbarStyle}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={toolbarButtonStyle}>P</span>
                    <span style={toolbarButtonStyle}>H2</span>
                    <span style={toolbarButtonStyle}>Q</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={toolbarButtonStyle}><strong>B</strong></span>
                    <span style={toolbarButtonStyle}><em>I</em></span>
                    <span style={toolbarButtonStyle}><span style={{ textDecoration: 'underline' }}>U</span></span>
                    <span style={toolbarButtonStyle}>Tx</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={toolbarButtonStyle}>•</span>
                    <span style={toolbarButtonStyle}>1.</span>
                    <span style={toolbarButtonStyle}>Link</span>
                    <span style={toolbarButtonStyle}>↺</span>
                    <span style={toolbarButtonStyle}>↻</span>
                  </span>
                </div>
                <div
                  className="fb-builder-form-richtext__editor"
                  style={{
                    padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
                    minHeight: editorMinHeight,
                    height: heightMode === 'hug' ? 'auto' : '100%',
                    overflow: heightMode === 'hug' ? 'visible' : 'auto',
                    color: richTextPreviewIsEmpty ? placeholderColor : textColor,
                    ...bodyTextStyle,
                  }}
                >
                  {richTextPreviewIsEmpty ? (
                    <span>{placeholder || 'Write formatted content...'}</span>
                  ) : (
                    <div
                      className="fb-builder-form-richtext__content fb-text-content"
                      dangerouslySetInnerHTML={{ __html: richTextPreviewHtml }}
                    />
                  )}
                </div>
              </div>
              {helperText ? <span style={helperStyle}>{helperText}</span> : null}
            </div>
          );
        }

        if (el.type === 'file-upload') {
          const allowsMultipleFiles = resolved?.allowMultipleFiles === true;
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', height: '100%', alignContent: 'start', gap: fieldGap }}>
              {label ? <span style={labelStyle}>{label}</span> : null}
              <div style={{ display: 'grid', placeItems: 'center', gap: fieldGap, height: '100%', padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`, textAlign: 'center', border: `1.5px dashed ${controlBorderColor}`, borderRadius: elementBorderRadiusValue, background: controlBackgroundColor, boxShadow: controlBoxShadow }}>
                <span style={{ ...labelStyle, textAlign: 'center' }}>{allowsMultipleFiles ? 'Multi-file dropzone' : 'File dropzone'}</span>
                <span style={{ ...helperStyle, textAlign: 'center', color: placeholderColor }}>{placeholder || 'Drop files here or browse'}</span>
                <span style={{ ...helperStyle, textAlign: 'center', fontSize: Math.max(10, visualModel.helperFontSize - 1), opacity: 0.85 }}>{allowsMultipleFiles ? 'Accepts multiple files' : 'Accepts one file'}</span>
              </div>
              {helperText ? <span style={helperStyle}>{helperText}</span> : null}
            </div>
          );
        }

        if (el.type === 'captcha') {
          return (
            <div style={{ ...transparentShellStyle, display: 'grid', placeItems: 'center', gap: fieldGap, height: '100%', padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`, textAlign: 'center' }}>
              <span style={{ ...labelStyle, color: FORM_STYLE_DEFAULTS.captchaLabelColor, textAlign: 'center' }}>Captcha</span>
              <span style={{ ...bodyTextStyle, fontSize: visualModel.captchaHelperFontSize, color: FORM_STYLE_DEFAULTS.captchaHelperColor, textAlign: 'center' }}>{placeholder || 'Provider-backed verification'}</span>
            </div>
          );
        }

        return (
          <div style={{ ...transparentShellStyle, display: 'grid', height: '100%', alignContent: 'start', gap: fieldGap }}>
            {label ? <span style={labelStyle}>{label}</span> : null}
            <div style={{ ...controlShellStyle }}>
              <input
                type="text"
                value={placeholder || 'Type here...'}
                readOnly
                tabIndex={-1}
                style={{
                  ...nativeControlStyle,
                  color: placeholderColor,
                  padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
                }}
              />
            </div>
            {helperText ? <span style={helperStyle}>{helperText}</span> : null}
          </div>
        );
      })() : null}
      {isFormSubmitButtonType(el.type) ? (() => {
        const label = resolved?.label || el.name || 'Submit';
        const visualModel = getFormVisualModel(styles, { submit: true });
        const stateVisualModel = getFormStateVisualModel(styles, { submit: true, visualModel });
        const previewState = stateVisualModel.previewState;
        const fontFamily = familyToFontStack(visualModel.fontFamily);
        const fontSize = visualModel.fontSize;
        const lineHeight = visualModel.lineHeight;
        const letterSpacing = visualModel.letterSpacing;
        const paddingTop = visualModel.paddingTop;
        const paddingRight = visualModel.paddingRight;
        const paddingBottom = visualModel.paddingBottom;
        const paddingLeft = visualModel.paddingLeft;
        let textColor = visualModel.textColor;
        let backgroundColor = visualModel.backgroundColor;
        let borderColor = visualModel.borderColor;
        let buttonLabel = label;
        if (previewState === 'hover') {
          textColor = stateVisualModel.hoverTextColor;
          backgroundColor = stateVisualModel.hoverBackgroundColor;
          borderColor = stateVisualModel.hoverBorderColor;
        } else if (previewState === 'pressed') {
          textColor = stateVisualModel.pressedTextColor;
          backgroundColor = stateVisualModel.pressedBackgroundColor;
          borderColor = stateVisualModel.pressedBorderColor;
        } else if (previewState === 'submitting') {
          textColor = stateVisualModel.processingTextColor;
          backgroundColor = stateVisualModel.processingBackgroundColor;
          borderColor = stateVisualModel.processingBorderColor;
          buttonLabel = 'Submitting...';
        } else if (previewState === 'success') {
          textColor = stateVisualModel.successTextColor;
          backgroundColor = stateVisualModel.successBackgroundColor;
          borderColor = stateVisualModel.successBorderColor;
        } else if (previewState === 'error') {
          textColor = stateVisualModel.errorTextColor;
          backgroundColor = stateVisualModel.errorBackgroundColor;
          borderColor = stateVisualModel.errorBorderColor;
        }
        const fontWeight = visualModel.fontWeight;
        return (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`,
              borderRadius: 'inherit',
              background: backgroundColor,
              border: `${visualModel.borderWidth}px ${visualModel.borderStyle} ${borderColor}`,
              boxShadow: visualModel.boxShadow,
              color: textColor,
              fontFamily,
              fontSize,
              fontWeight,
              fontStyle: visualModel.fontStyle,
              lineHeight,
              letterSpacing,
              textAlign: visualModel.textAlign,
              textDecoration: visualModel.textDecoration,
              pointerEvents: 'none',
              overflow: 'hidden',
            }}
          >
            <span>{buttonLabel}</span>
          </div>
        );
      })() : null}
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
      {el.type === 'icon' && ((lineMarkup || vectorShapeMarkup || iconMarkup) ? (
        <div
          className={`fb-icon-content${strokeWidth > 0 ? ' fb-icon-content--stroked' : ''}`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: styles?.color ?? '#111827',
            overflow: shapeKind === 'line' ? 'visible' : undefined,
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
          <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: lineMarkup || vectorShapeMarkup || iconMarkup }} />
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
      {isSelected && !interactionLocked && onStartPaddingDrag && !isSurfaceStyledFormField && (() => {
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
      {renderedChildren.map(child => {
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
      {isLoopElementType(el?.type) && loopTemplateChild && loopTemplateHasContent && ghostCount > 0
        ? Array.from({ length: ghostCount }, (_, index) => {
            const metrics = getLoopPreviewMetrics({
              containerWidth: width,
              paddingLeft: loopGhostPaddingLeft,
              paddingRight: loopGhostPaddingRight,
              templateWidth: resolvedLoopTemplate?.width,
              templateHeight: resolvedLoopTemplate?.height,
              loopConfig,
            });
            let ghostStyle = {
              width: metrics.itemWidth,
              minWidth: metrics.itemWidth,
              height: metrics.itemHeight,
              minHeight: metrics.itemHeight,
            };

            if (metrics.layout === 'horizontal' || metrics.layout === 'grid') {
              ghostStyle = {
                ...ghostStyle,
                flex: `0 0 ${metrics.itemWidth}px`,
                maxWidth: metrics.itemWidth,
              };
            }

            return (
              <div
                key={`ghost-${id}-${index}`}
                className="fb-loop-ghost"
                style={ghostStyle}
                aria-hidden="true"
              />
            );
          })
        : null}
      {isLoopElementType(el?.type) && loopMode !== 'loop' ? (
        <div
          className="fb-loop-mode-badge"
          style={{
            position: 'absolute', top: 4, right: 4, zIndex: 10,
            background: 'rgba(0,0,0,.65)', color: '#fff',
            fontSize: 10, lineHeight: '16px', padding: '0 6px',
            borderRadius: 4, pointerEvents: 'none', textTransform: 'capitalize',
          }}
          aria-hidden="true"
        >
          {loopMode}
        </div>
      ) : null}
      {isLoopElementType(el?.type) && (loopMode === 'slideshow' || loopMode === 'carousel') && (loopConfig?.[loopMode]?.showArrows ?? true) ? (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 9,
              width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,.35)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: loopSource === 'manual' ? 'auto' : 'none', cursor: loopSource === 'manual' ? 'pointer' : 'default',
            }}
            onMouseDown={loopSource === 'manual' ? (e) => {
              e.stopPropagation();
              const total = renderedChildrenBase.length;
              if (total > 0) {
                const cur = loopActiveIdx;
                setLoopActiveChildIndex(el.id, (cur - 1 + total) % total);
              }
            } : undefined}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </div>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 9,
              width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,.35)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: loopSource === 'manual' ? 'auto' : 'none', cursor: loopSource === 'manual' ? 'pointer' : 'default',
            }}
            onMouseDown={loopSource === 'manual' ? (e) => {
              e.stopPropagation();
              const total = renderedChildrenBase.length;
              if (total > 0) {
                const cur = loopActiveIdx;
                setLoopActiveChildIndex(el.id, (cur + 1) % total);
              }
            } : undefined}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </>
      ) : null}
      {isLoopElementType(el?.type) && (loopMode === 'slideshow' || loopMode === 'carousel') && (loopConfig?.[loopMode]?.showDots ?? true) ? (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', bottom: 4, left: 0, right: 0, zIndex: 9,
            display: 'flex', justifyContent: 'center', gap: 5, pointerEvents: 'none',
          }}
        >
          {Array.from({ length: Math.min(loopPreviewItemCount || 3, 12) }, (_, i) => (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i === (loopSource === 'manual' ? loopActiveIdx : 0) ? 'rgba(0,0,0,.7)' : 'rgba(0,0,0,.25)',
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default React.memo(CanvasElement);
