import React, { useRef, useEffect, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useEditorStore, createFrame, createImage, createVideo, createEmbed, createScrollSequence, createText, createIcon, createShapePreset, createVectorLineData, resolveElement, resolvePagePadding, resolvePageLayout, getSelectionElementIds, isElementSelected, getShapePresetKind, getVectorShapeData, getVectorShapePathD, reframeVectorShapeData, buildVectorShapeSvgMarkup, moveVectorAnchor, updateVectorHandle, insertVectorAnchorAtSegment, removeVectorAnchor, toggleVectorPathClosed, setVectorAnchorMode, findClosestVectorSegment, scaleVectorShapeToBounds } from '../store/editorStore';
import { getAssetStyleUpdatesForElement, parseAssetDragPayload } from '../store/assetStyles';
import Artboard from './Artboard';
import VariantInteractionModal from '../components/VariantInteractionModal';
import { buildGradient, parseGradient } from '../components/FillPicker';
import { extractSvgMarkup, sanitizeSvgMarkup } from '../components/iconLibrary';
import { plainTextToRichTextHtml, sanitizeRichTextHtml } from '../components/richText';

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;
const SNAP_THRESHOLD_PX = 6;
const COMMENT_CURSOR = "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M6 4h10a4 4 0 0 1 4 4v8H6a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2Z%27 fill=%27%237BE300%27/%3E%3Cpath d=%27M4 18V8%27 stroke=%27%237BE300%27 stroke-width=%274%27 stroke-linecap=%27round%27/%3E%3C/svg%3E\") 6 6, crosshair";
const PEN_CLOSE_SNAP_PX = 16;
const TELEPORT_MARKER = 'FRAMEWP_TELEPORT';

const OVERLAY_HANDLES = ['nw','n','ne','e','se','s','sw','w'];

function isFontResizeTextElement(el, resolved) {
  if ((el?.type ?? '') !== 'text') return false;
  const widthMode = resolved?.widthMode ?? 'fixed';
  const heightMode = resolved?.heightMode ?? 'fixed';
  return (widthMode === 'hug' && heightMode === 'hug')
    || (widthMode === 'fixed' && heightMode === 'hug');
}

// ── Copy/paste helpers ─────────────────────────────────────────
let _cpSeq = 0;
function cloneSubtree(subtree, rootId) {
  const idMap = {};
  subtree.forEach(el => {
    idMap[el.id] = `fr-${Date.now()}-${++_cpSeq}-${Math.random().toString(36).slice(2, 5)}`;
  });
  return subtree.map(el => ({
    ...el,
    id: idMap[el.id],
    parentId: idMap[el.parentId] ?? null,
    children: (el.children ?? []).map(cid => idMap[cid]).filter(Boolean),
    base: el.id === rootId
      ? { ...el.base, x: (el.base.x ?? 0) + 20, y: (el.base.y ?? 0) + 20 }
      : { ...el.base },
    overrides: { ...(el.overrides ?? {}) },
  }));
}

function clampTeleportNumber(value, fallback = 0, min = -100000, max = 100000) {
  const nextValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.min(max, Math.max(min, nextValue));
}

function parseTeleportClipboardPayload(text) {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.marker !== TELEPORT_MARKER || !Array.isArray(parsed?.nodes) || !parsed.nodes.length) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function dedupeTeleportLibraryEntries(existingEntries = [], incomingEntries = [], comparator) {
  const nextEntries = [...existingEntries];
  (incomingEntries ?? []).forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const alreadyExists = nextEntries.some((entry) => comparator(entry, candidate));
    if (!alreadyExists) nextEntries.push(candidate);
  });
  return nextEntries;
}

function mergeTeleportStylesIntoAssets(payload) {
  const styles = payload?.styles;
  if (!styles || typeof styles !== 'object') return;
  const state = useEditorStore.getState();

  if (Array.isArray(styles.colorStyles) && styles.colorStyles.length) {
    const nextColorStyles = dedupeTeleportLibraryEntries(
      state.colorStyles ?? [],
      styles.colorStyles,
      (entry, candidate) => (`${entry?.sourceId || entry?.id || ''}` === `${candidate?.sourceId || candidate?.id || ''}`)
        || ((entry?.name || '').trim().toLowerCase() === (candidate?.name || '').trim().toLowerCase() && `${entry?.value || ''}` === `${candidate?.value || ''}`),
    );
    state.saveColorStyles(nextColorStyles);
  }

  if (Array.isArray(styles.textStyles) && styles.textStyles.length) {
    const nextTextStyles = dedupeTeleportLibraryEntries(
      state.textStyles ?? [],
      styles.textStyles,
      (entry, candidate) => (`${entry?.sourceId || entry?.id || ''}` === `${candidate?.sourceId || candidate?.id || ''}`)
        || ((entry?.name || '').trim().toLowerCase() === (candidate?.name || '').trim().toLowerCase() && JSON.stringify(entry?.styleProps ?? {}) === JSON.stringify(candidate?.styleProps ?? {})),
    );
    state.saveTextStyles(nextTextStyles);
  }

  if (Array.isArray(styles.elementStyles) && styles.elementStyles.length) {
    const nextElementStyles = dedupeTeleportLibraryEntries(
      state.elementStyles ?? [],
      styles.elementStyles,
      (entry, candidate) => (`${entry?.sourceId || entry?.id || ''}` === `${candidate?.sourceId || candidate?.id || ''}`)
        || ((entry?.name || '').trim().toLowerCase() === (candidate?.name || '').trim().toLowerCase() && JSON.stringify(entry?.styleProps ?? {}) === JSON.stringify(candidate?.styleProps ?? {})),
    );
    state.saveElementStyles(nextElementStyles);
  }
}

function getTeleportSizingMode(value, fallback = 'fixed') {
  return value === 'hug' || value === 'fill' || value === 'fixed' ? value : fallback;
}

function getTeleportPosition(node, parentIsLayout = false) {
  if (!parentIsLayout) return {};
  if (node?.positionType === 'absolute' || node?.absoluteInLayout) {
    return { positionType: 'absolute', absoluteInLayout: true };
  }
  return { positionType: 'relative', absoluteInLayout: false };
}

function getTeleportRadiusStyles(node) {
  const mode = node?.borderRadiusMode === 'independent' ? 'independent' : 'linked';
  if (mode !== 'independent') {
    return {
      borderRadius: Math.max(0, clampTeleportNumber(node?.borderRadius, 0, 0)),
      borderRadiusMode: 'linked',
    };
  }
  return {
    borderRadius: Math.max(0, clampTeleportNumber(node?.borderRadius, 0, 0)),
    borderRadiusMode: 'independent',
    borderRadiusTL: Math.max(0, clampTeleportNumber(node?.borderRadiusTL, node?.borderRadius ?? 0, 0)),
    borderRadiusTR: Math.max(0, clampTeleportNumber(node?.borderRadiusTR, node?.borderRadius ?? 0, 0)),
    borderRadiusBR: Math.max(0, clampTeleportNumber(node?.borderRadiusBR, node?.borderRadius ?? 0, 0)),
    borderRadiusBL: Math.max(0, clampTeleportNumber(node?.borderRadiusBL, node?.borderRadius ?? 0, 0)),
  };
}

function buildImportedFrame(node, parentIsLayout = false) {
  const label = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : 'Frame';
  const element = createFrame(
    clampTeleportNumber(node?.x, 0),
    clampTeleportNumber(node?.y, 0),
    label,
  );
  element.name = label;
  const layout = node?.layout && typeof node.layout === 'object' ? node.layout : null;
  element.base = {
    ...element.base,
    name: label,
    width: Math.max(1, clampTeleportNumber(node?.width, 240, 1)),
    height: Math.max(1, clampTeleportNumber(node?.height, 160, 1)),
    widthMode: getTeleportSizingMode(node?.widthMode, element.base.widthMode ?? 'fixed'),
    heightMode: getTeleportSizingMode(node?.heightMode, element.base.heightMode ?? 'fixed'),
    widthFr: Math.max(0.1, clampTeleportNumber(node?.widthFr, element.base.widthFr ?? 1, 0.1)),
    heightFr: Math.max(0.1, clampTeleportNumber(node?.heightFr, element.base.heightFr ?? 1, 0.1)),
    rotation: clampTeleportNumber(node?.rotation, 0),
    hidden: node?.visible === false,
    ...getTeleportPosition(node, parentIsLayout),
    styles: {
      ...element.base.styles,
      backgroundColor: typeof node?.backgroundColor === 'string' ? node.backgroundColor : 'transparent',
      backgroundImage: typeof node?.backgroundImage === 'string' ? node.backgroundImage : '',
      backgroundSize: typeof node?.backgroundSize === 'string' ? node.backgroundSize : element.base.styles.backgroundSize,
      backgroundPosition: typeof node?.backgroundPosition === 'string' ? node.backgroundPosition : element.base.styles.backgroundPosition,
      ...getTeleportRadiusStyles(node),
      borderWidth: Math.max(0, clampTeleportNumber(node?.borderWidth, 0, 0)),
      borderColor: typeof node?.borderColor === 'string' ? node.borderColor : '#000000',
      borderStyle: 'solid',
      opacity: Math.max(0, Math.min(1, clampTeleportNumber(node?.opacity, 1, 0, 1))),
      overflow: node?.overflow === 'hidden' ? 'hidden' : 'visible',
      boxShadow: typeof node?.boxShadow === 'string' ? node.boxShadow : '',
      mixBlendMode: typeof node?.mixBlendMode === 'string' ? node.mixBlendMode : 'normal',
      blur: Math.max(0, clampTeleportNumber(node?.blur, 0, 0)),
      backdropBlur: Math.max(0, clampTeleportNumber(node?.backdropBlur, 0, 0)),
      display: layout ? 'flex' : 'block',
      flexDirection: layout?.flexDirection === 'column' ? 'column' : 'row',
      flexWrap: layout?.flexWrap === 'wrap' ? 'wrap' : 'nowrap',
      gap: Math.max(0, clampTeleportNumber(layout?.gap, 0, 0)),
      paddingTop: Math.max(0, clampTeleportNumber(layout?.paddingTop, 0, 0)),
      paddingRight: Math.max(0, clampTeleportNumber(layout?.paddingRight, 0, 0)),
      paddingBottom: Math.max(0, clampTeleportNumber(layout?.paddingBottom, 0, 0)),
      paddingLeft: Math.max(0, clampTeleportNumber(layout?.paddingLeft, 0, 0)),
      alignItems: layout?.alignItems ?? 'flex-start',
      justifyContent: layout?.justifyContent ?? 'flex-start',
    },
  };
  return element;
}

function buildImportedText(node, parentIsLayout = false) {
  const label = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : 'Text';
  const content = typeof node?.text === 'string' ? node.text : label;
  const richTextHtml = typeof node?.richTextHtml === 'string' && node.richTextHtml.trim()
    ? (sanitizeRichTextHtml(node.richTextHtml) || plainTextToRichTextHtml(content || 'Text'))
    : plainTextToRichTextHtml(content || 'Text');
  const element = createText(
    clampTeleportNumber(node?.x, 0),
    clampTeleportNumber(node?.y, 0),
    label,
  );
  element.name = label;
  element.base = {
    ...element.base,
    name: label,
    width: Math.max(1, clampTeleportNumber(node?.width, 240, 1)),
    height: Math.max(1, clampTeleportNumber(node?.height, 60, 1)),
    widthMode: getTeleportSizingMode(node?.widthMode, element.base.widthMode ?? 'hug'),
    heightMode: getTeleportSizingMode(node?.heightMode, element.base.heightMode ?? 'hug'),
    widthFr: Math.max(0.1, clampTeleportNumber(node?.widthFr, element.base.widthFr ?? 1, 0.1)),
    heightFr: Math.max(0.1, clampTeleportNumber(node?.heightFr, element.base.heightFr ?? 1, 0.1)),
    rotation: clampTeleportNumber(node?.rotation, 0),
    hidden: node?.visible === false,
    text: content,
    richTextHtml,
    ...getTeleportPosition(node, parentIsLayout),
    styles: {
      ...element.base.styles,
      backgroundColor: 'transparent',
      color: typeof node?.color === 'string' ? node.color : '#111111',
      fontFamily: typeof node?.fontFamily === 'string' && node.fontFamily.trim() ? node.fontFamily : 'Inter',
      fontWeight: Math.max(100, clampTeleportNumber(node?.fontWeight, 400, 100, 900)),
      fontStyle: node?.fontStyle === 'italic' ? 'italic' : 'normal',
      fontSize: Math.max(1, clampTeleportNumber(node?.fontSize, 16, 1)),
      fontSizeUnit: 'px',
      lineHeight: node?.lineHeight != null ? clampTeleportNumber(node.lineHeight, 1.2, 0.1) : 1.2,
      lineHeightUnit: node?.lineHeightUnit === 'px' ? 'px' : 'em',
      letterSpacing: clampTeleportNumber(node?.letterSpacing, 0),
      letterSpacingUnit: node?.letterSpacingUnit === 'em' ? 'em' : 'px',
      textAlign: node?.textAlign ?? 'left',
      textTransform: typeof node?.textTransform === 'string' ? node.textTransform : 'none',
      textDecoration: typeof node?.textDecoration === 'string' ? node.textDecoration : 'none',
      opacity: Math.max(0, Math.min(1, clampTeleportNumber(node?.opacity, 1, 0, 1))),
      boxShadow: typeof node?.boxShadow === 'string' ? node.boxShadow : '',
      mixBlendMode: typeof node?.mixBlendMode === 'string' ? node.mixBlendMode : 'normal',
      blur: Math.max(0, clampTeleportNumber(node?.blur, 0, 0)),
      backdropBlur: Math.max(0, clampTeleportNumber(node?.backdropBlur, 0, 0)),
    },
  };
  return element;
}

function buildImportedImage(node, parentIsLayout = false) {
  const label = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : 'Image';
  const element = createImage(
    clampTeleportNumber(node?.x, 0),
    clampTeleportNumber(node?.y, 0),
    label,
  );
  element.name = label;
  element.base = {
    ...element.base,
    name: label,
    width: Math.max(1, clampTeleportNumber(node?.width, 240, 1)),
    height: Math.max(1, clampTeleportNumber(node?.height, 160, 1)),
    widthMode: getTeleportSizingMode(node?.widthMode, element.base.widthMode ?? 'fixed'),
    heightMode: getTeleportSizingMode(node?.heightMode, element.base.heightMode ?? 'fixed'),
    widthFr: Math.max(0.1, clampTeleportNumber(node?.widthFr, element.base.widthFr ?? 1, 0.1)),
    heightFr: Math.max(0.1, clampTeleportNumber(node?.heightFr, element.base.heightFr ?? 1, 0.1)),
    rotation: clampTeleportNumber(node?.rotation, 0),
    hidden: node?.visible === false,
    src: typeof node?.src === 'string' ? node.src : '',
    ...getTeleportPosition(node, parentIsLayout),
    styles: {
      ...element.base.styles,
      ...getTeleportRadiusStyles(node),
      borderWidth: Math.max(0, clampTeleportNumber(node?.borderWidth, 0, 0)),
      borderColor: typeof node?.borderColor === 'string' ? node.borderColor : '#000000',
      opacity: Math.max(0, Math.min(1, clampTeleportNumber(node?.opacity, 1, 0, 1))),
      boxShadow: typeof node?.boxShadow === 'string' ? node.boxShadow : '',
      objectFit: node?.objectFit === 'contain' ? 'contain' : 'cover',
      mixBlendMode: typeof node?.mixBlendMode === 'string' ? node.mixBlendMode : 'normal',
      blur: Math.max(0, clampTeleportNumber(node?.blur, 0, 0)),
      backdropBlur: Math.max(0, clampTeleportNumber(node?.backdropBlur, 0, 0)),
    },
  };
  return element;
}

function buildImportedLine(node, parentIsLayout = false) {
  const label = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : 'Line';
  const element = createShapePreset('line', clampTeleportNumber(node?.x, 0), clampTeleportNumber(node?.y, 0));
  const width = Math.max(1, clampTeleportNumber(node?.width, 160, 1));
  const height = Math.max(1, clampTeleportNumber(node?.height, 24, 1));
  const strokeWidth = Math.max(0.5, clampTeleportNumber(node?.strokeWidth ?? node?.borderWidth, 2, 0.5));
  const strokeColor = typeof node?.strokeColor === 'string' && node.strokeColor
    ? node.strokeColor
    : (typeof node?.borderColor === 'string' && node.borderColor ? node.borderColor : '#111827');
  const vectorData = createVectorLineData(width, height);
  element.name = label;
  element.base = {
    ...element.base,
    name: label,
    width,
    height,
    widthMode: getTeleportSizingMode(node?.widthMode, element.base.widthMode ?? 'fixed'),
    heightMode: getTeleportSizingMode(node?.heightMode, element.base.heightMode ?? 'fixed'),
    widthFr: Math.max(0.1, clampTeleportNumber(node?.widthFr, element.base.widthFr ?? 1, 0.1)),
    heightFr: Math.max(0.1, clampTeleportNumber(node?.heightFr, element.base.heightFr ?? 1, 0.1)),
    rotation: clampTeleportNumber(node?.rotation, 0),
    hidden: node?.visible === false,
    vectorData,
    svgMarkup: buildVectorShapeSvgMarkup(vectorData, { width, height, fill: 'none', stroke: strokeColor, strokeWidth }),
    shapeType: 'line',
    iconName: 'line',
    ...getTeleportPosition(node, parentIsLayout),
    styles: {
      ...element.base.styles,
      backgroundColor: 'transparent',
      color: strokeColor,
      strokeColor,
      strokeWidth,
      opacity: Math.max(0, Math.min(1, clampTeleportNumber(node?.opacity, 1, 0, 1))),
      boxShadow: typeof node?.boxShadow === 'string' ? node.boxShadow : '',
      mixBlendMode: typeof node?.mixBlendMode === 'string' ? node.mixBlendMode : 'normal',
      blur: Math.max(0, clampTeleportNumber(node?.blur, 0, 0)),
      backdropBlur: Math.max(0, clampTeleportNumber(node?.backdropBlur, 0, 0)),
      overflow: 'visible',
    },
  };
  return element;
}

function buildImportedVector(node, parentIsLayout = false) {
  if (node?.vectorKind === 'line') return buildImportedLine(node, parentIsLayout);
  const label = typeof node?.name === 'string' && node.name.trim() ? node.name.trim() : 'Vector';
  const element = createIcon(
    clampTeleportNumber(node?.x, 0),
    clampTeleportNumber(node?.y, 0),
    label,
  );
  element.name = label;
  element.base = {
    ...element.base,
    name: label,
    width: Math.max(1, clampTeleportNumber(node?.width, 48, 1)),
    height: Math.max(1, clampTeleportNumber(node?.height, 48, 1)),
    widthMode: getTeleportSizingMode(node?.widthMode, element.base.widthMode ?? 'fixed'),
    heightMode: getTeleportSizingMode(node?.heightMode, element.base.heightMode ?? 'fixed'),
    widthFr: Math.max(0.1, clampTeleportNumber(node?.widthFr, element.base.widthFr ?? 1, 0.1)),
    heightFr: Math.max(0.1, clampTeleportNumber(node?.heightFr, element.base.heightFr ?? 1, 0.1)),
    rotation: clampTeleportNumber(node?.rotation, 0),
    hidden: node?.visible === false,
    iconSource: 'custom',
    iconName: 'teleport-svg',
    svgMarkup: sanitizeSvgMarkup(typeof node?.svgMarkup === 'string' ? node.svgMarkup : '', { forceCurrentColor: false }),
    ...getTeleportPosition(node, parentIsLayout),
    styles: {
      ...element.base.styles,
      backgroundColor: 'transparent',
      color: typeof node?.strokeColor === 'string' && node.strokeColor
        ? node.strokeColor
        : (typeof node?.borderColor === 'string' && node.borderColor ? node.borderColor : element.base.styles?.color),
      strokeColor: typeof node?.strokeColor === 'string' ? node.strokeColor : (typeof node?.borderColor === 'string' ? node.borderColor : undefined),
      strokeWidth: node?.strokeWidth != null ? Math.max(0, clampTeleportNumber(node.strokeWidth, 0, 0)) : undefined,
      opacity: Math.max(0, Math.min(1, clampTeleportNumber(node?.opacity, 1, 0, 1))),
      boxShadow: typeof node?.boxShadow === 'string' ? node.boxShadow : '',
      mixBlendMode: typeof node?.mixBlendMode === 'string' ? node.mixBlendMode : 'normal',
      blur: Math.max(0, clampTeleportNumber(node?.blur, 0, 0)),
      backdropBlur: Math.max(0, clampTeleportNumber(node?.backdropBlur, 0, 0)),
    },
  };
  return element;
}

function importTeleportNodes(nodes, rootOffset = { x: 0, y: 0 }) {
  const importedElements = [];
  const rootIds = [];

  const visit = (node, parentId = null, parentIsLayout = false) => {
    if (!node || typeof node !== 'object') return null;

    let element = null;
    if (node.kind === 'text') element = buildImportedText(node, parentIsLayout);
    else if (node.kind === 'image') element = buildImportedImage(node, parentIsLayout);
    else if (node.kind === 'vector') element = buildImportedVector(node, parentIsLayout);
    else element = buildImportedFrame(node, parentIsLayout);

    if (!element) return null;
    element.parentId = parentId;
    element.children = [];
    importedElements.push(element);

    const childNodes = Array.isArray(node.children) ? node.children : [];
    childNodes.forEach((childNode) => {
      const childElement = visit(childNode, element.id, !!node.layout);
      if (!childElement) return;
      element.children.push(childElement.id);
    });

    if (!parentId) {
      element.base.x = clampTeleportNumber(element.base.x, 0) + clampTeleportNumber(rootOffset.x, 0);
      element.base.y = clampTeleportNumber(element.base.y, 0) + clampTeleportNumber(rootOffset.y, 0);
      rootIds.push(element.id);
    }

    return element;
  };

  (Array.isArray(nodes) ? nodes : []).forEach((node) => visit(node, null, false));
  return { importedElements, rootIds };
}

function collectDescendantIds(allEls, rootId) {
  const ids = new Set([rootId]);
  const visit = (id) => {
    const el = allEls.find(item => item.id === id);
    (el?.children ?? []).forEach((childId) => {
      if (ids.has(childId)) return;
      ids.add(childId);
      visit(childId);
    });
  };
  visit(rootId);
  return ids;
}

function getSiblingIds(allEls, parentId, excludedId) {
  if (parentId) {
    const parent = allEls.find(el => el.id === parentId);
    return (parent?.children ?? []).filter(id => id !== excludedId);
  }
  return allEls.filter(el => !el.parentId && el.id !== excludedId).map(el => el.id);
}

function getInsertBeforeIdFromDom(parentDom, siblingIds, clientX, clientY, axis = 'y') {
  if (!parentDom) return null;
  for (const siblingId of siblingIds) {
    const node = parentDom.querySelector(`[data-id="${siblingId}"]`);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    const midpoint = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const cursor = axis === 'x' ? clientX : clientY;
    if (cursor < midpoint) return siblingId;
  }
  return null;
}

function getNodeWorldRect(node, boardDom, bp, scale) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (!node || !boardDom || !bp) return null;
  const rect = node.getBoundingClientRect();
  const boardRect = boardDom.getBoundingClientRect();
  const left = bp.x + (rect.left - boardRect.left) / safeScale;
  const top = bp.y + (rect.top - boardRect.top) / safeScale;
  const width = rect.width / safeScale;
  const height = rect.height / safeScale;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function getFlexAxis(node) {
  if (!node) return 'y';
  const style = window.getComputedStyle(node);
  return (style.flexDirection ?? 'column').startsWith('row') ? 'x' : 'y';
}

function pointInClientRect(clientX, clientY, rect) {
  if (!rect) return false;
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function buildConnectorPath(start, end) {
  const deltaX = Math.max(48, Math.abs(end.x - start.x) * 0.35);
  return `M ${start.x} ${start.y} C ${start.x + deltaX} ${start.y}, ${end.x - deltaX} ${end.y}, ${end.x} ${end.y}`;
}

function formatCommentTimestamp(value) {
  if (!Number.isFinite(value)) return 'Now';
  const delta = Math.max(0, Date.now() - value);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getCurrentCommentUserName() {
  return typeof window?.fbData?.currentUser?.displayName === 'string'
    ? window.fbData.currentUser.displayName.trim()
    : '';
}

function getExternalReplyCount(comment, currentUserName) {
  if (!comment || !Array.isArray(comment.messages) || !currentUserName) return 0;
  return comment.messages.slice(1).reduce((count, message) => {
    const author = typeof message?.author === 'string' ? message.author.trim() : '';
    return author && author !== currentUserName ? count + 1 : count;
  }, 0);
}

function clampCommentPositionToArtboard(bp, padding, x, y) {
  if (!bp) {
    return {
      x: Math.max(0, Math.round(Number.isFinite(x) ? x : 0)),
      y: Math.max(0, Math.round(Number.isFinite(y) ? y : 0)),
    };
  }

  const contentWidth = Math.max(0, bp.width - (padding?.left ?? 0) - (padding?.right ?? 0));
  const contentHeight = Math.max(0, bp.height - (padding?.top ?? 0) - (padding?.bottom ?? 0));

  return {
    x: Math.max(0, Math.min(contentWidth, Math.round(Number.isFinite(x) ? x : 0))),
    y: Math.max(0, Math.min(contentHeight, Math.round(Number.isFinite(y) ? y : 0))),
  };
}

function CommentAvatar({ author, avatarUrl, className = '' }) {
  const fallback = (author || '?').trim().charAt(0).toUpperCase() || '?';
  if (avatarUrl) {
    return <img className={`fb-comment-avatar ${className}`.trim()} src={avatarUrl} alt={author || 'User'} />;
  }
  return <span className={`fb-comment-avatar fb-comment-avatar--fallback ${className}`.trim()}>{fallback}</span>;
}

function normalizeAngle(degrees) {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function cssAngleToUnitVector(angle) {
  const radians = normalizeAngle(angle) * Math.PI / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function cssAngleFromVector(dx, dy) {
  return normalizeAngle((Math.atan2(dy, dx) * 180 / Math.PI) + 90);
}

function clampGradientPercent(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function projectPointToSegmentRatio(point, start, end) {
  const segX = end.x - start.x;
  const segY = end.y - start.y;
  const segLenSq = segX * segX + segY * segY;
  if (segLenSq <= 0) return 0;
  const projection = ((point.x - start.x) * segX + (point.y - start.y) * segY) / segLenSq;
  return Math.max(0, Math.min(1, projection));
}

function getProjectionRangeForRect(rect, direction) {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  const values = corners.map((point) => (point.x * direction.x) + (point.y * direction.y));
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function pointForProjection(direction, projection, lineCenter) {
  const centerProjection = (lineCenter.x * direction.x) + (lineCenter.y * direction.y);
  const delta = projection - centerProjection;
  return {
    x: lineCenter.x + direction.x * delta,
    y: lineCenter.y + direction.y * delta,
  };
}

function getAspectRatio(width, height) {
  const safeWidth = Number.isFinite(width) ? Math.max(0.0001, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0.0001, height) : 0;
  if (safeWidth <= 0 || safeHeight <= 0) return 0;
  return safeWidth / safeHeight;
}

function resolveResizedBounds({ startBounds, handle, pointer, minSize = 20, keepAspectRatio = false }) {
  const minDimension = Math.max(1, minSize);
  const origin = {
    minX: startBounds.minX,
    minY: startBounds.minY,
    maxX: startBounds.minX + startBounds.width,
    maxY: startBounds.minY + startBounds.height,
  };
  let minX = origin.minX;
  let minY = origin.minY;
  let maxX = origin.maxX;
  let maxY = origin.maxY;

  if (handle.includes('w')) minX = Math.min(pointer.x, maxX - minDimension);
  if (handle.includes('e')) maxX = Math.max(pointer.x, minX + minDimension);
  if (handle.includes('n')) minY = Math.min(pointer.y, maxY - minDimension);
  if (handle.includes('s')) maxY = Math.max(pointer.y, minY + minDimension);

  if (!keepAspectRatio) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(minDimension, maxX - minX),
      height: Math.max(minDimension, maxY - minY),
    };
  }

  const aspectRatio = getAspectRatio(startBounds.width, startBounds.height);
  if (!aspectRatio) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(minDimension, maxX - minX),
      height: Math.max(minDimension, maxY - minY),
    };
  }

  const activeX = handle.includes('e') || handle.includes('w');
  const activeY = handle.includes('n') || handle.includes('s');
  const startCenterX = origin.minX + ((origin.maxX - origin.minX) / 2);
  const startCenterY = origin.minY + ((origin.maxY - origin.minY) / 2);
  let nextWidth = Math.max(minDimension, maxX - minX);
  let nextHeight = Math.max(minDimension, maxY - minY);

  if (activeX && activeY) {
    if ((nextWidth / nextHeight) > aspectRatio) nextHeight = nextWidth / aspectRatio;
    else nextWidth = nextHeight * aspectRatio;

    if (handle.includes('w')) minX = origin.maxX - nextWidth;
    else maxX = origin.minX + nextWidth;

    if (handle.includes('n')) minY = origin.maxY - nextHeight;
    else maxY = origin.minY + nextHeight;
  } else if (activeX) {
    nextHeight = nextWidth / aspectRatio;
    if (handle.includes('w')) minX = origin.maxX - nextWidth;
    else maxX = origin.minX + nextWidth;
    minY = startCenterY - (nextHeight / 2);
    maxY = startCenterY + (nextHeight / 2);
  } else if (activeY) {
    nextWidth = nextHeight * aspectRatio;
    if (handle.includes('n')) minY = origin.maxY - nextHeight;
    else maxY = origin.minY + nextHeight;
    minX = startCenterX - (nextWidth / 2);
    maxX = startCenterX + (nextWidth / 2);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(minDimension, maxX - minX),
    height: Math.max(minDimension, maxY - minY),
  };
}

function getResizeHandlePoint(startBounds, handle) {
  const minX = startBounds.minX;
  const minY = startBounds.minY;
  const maxX = startBounds.minX + startBounds.width;
  const maxY = startBounds.minY + startBounds.height;
  const centerX = minX + ((maxX - minX) / 2);
  const centerY = minY + ((maxY - minY) / 2);

  return {
    x: handle.includes('w') ? minX : (handle.includes('e') ? maxX : centerX),
    y: handle.includes('n') ? minY : (handle.includes('s') ? maxY : centerY),
  };
}

function normalizeResizeHandle(handle) {
  const value = String(handle || '').replace(/^rotate-/, '');
  if (OVERLAY_HANDLES.includes(value)) return value;
  return 'se';
}

function isDefaultVariant(variant) {
  return (variant?.mode ?? 'default') === 'default';
}

function getBaseVariantId(variants, variantId) {
  const current = (variants ?? []).find((variant) => variant.id === variantId) ?? null;
  if (!current) return (variants ?? []).find(isDefaultVariant)?.id ?? null;
  return isDefaultVariant(current) ? current.id : (current.parentVariantId ?? null);
}

function toContainerPoint(rect, point) {
  if (!point) return null;
  return {
    x: point.x - (rect?.left ?? 0),
    y: point.y - (rect?.top ?? 0),
  };
}

function clientToWorldPoint(containerRect, viewport, point) {
  if (!point) return null;
  const scale = viewport?.scale ?? 1;
  return {
    x: (point.x - (containerRect?.left ?? 0) - (viewport?.x ?? 0)) / scale,
    y: (point.y - (containerRect?.top ?? 0) - (viewport?.y ?? 0)) / scale,
  };
}

function getElementWorldMetrics({ el, bpId, bp, page, boardDom, scale }) {
  if (!el || !bp) return null;

  const resolved = resolveElement(el, bpId);
  const pageLayout = resolvePageLayout(page?.layout, bpId);
  const pad = resolvePagePadding(page?.padding, bpId);
  const width = resolved.width ?? 100;
  const height = resolved.height ?? 100;
  const selectedDom = boardDom?.querySelector(`[data-id="${el.id}"]`) ?? null;
  const selectedRect = selectedDom?.getBoundingClientRect() ?? null;
  const boardRect = boardDom?.getBoundingClientRect() ?? null;
  const isFixed = resolved.positionType === 'fixed';
  const isFlowInLayout = pageLayout !== null && !resolved.absoluteInLayout && !el.parentId && resolved.positionType !== 'fixed';

  let modelWorldX = bp.x;
  let modelWorldY = bp.y;

  if (el.parentId) {
    const parentDom = boardDom?.querySelector(`[data-id="${el.parentId}"]`) ?? null;
    if (parentDom && boardRect) {
      const parentRect = parentDom.getBoundingClientRect();
      const parentOffsetX = (parentRect.left - boardRect.left + parentDom.clientLeft) / scale;
      const parentOffsetY = (parentRect.top - boardRect.top + parentDom.clientTop) / scale;
      modelWorldX = bp.x + parentOffsetX + (resolved.x ?? 0);
      modelWorldY = bp.y + parentOffsetY + (resolved.y ?? 0);
    } else {
      modelWorldX = bp.x + (resolved.x ?? 0);
      modelWorldY = bp.y + (resolved.y ?? 0);
    }
  } else {
    const absX = resolved.x ?? 0;
    const absY = resolved.y ?? 0;
    const isOffCanvas = absX + width <= 0 || absX >= bp.width || absY + height <= 0 || absY >= bp.height;
    const isAutoLayoutException = pageLayout !== null && !!resolved.absoluteInLayout;
    const offsetLeft = isFixed || isOffCanvas || isAutoLayoutException ? 0 : (pad?.left ?? 0);
    const offsetTop = isFixed || isOffCanvas || isAutoLayoutException ? 0 : (pad?.top ?? 0);
    modelWorldX = bp.x + offsetLeft + absX;
    modelWorldY = bp.y + offsetTop + absY;
  }

  const domWorldX = selectedRect && boardRect ? bp.x + (selectedRect.left - boardRect.left) / scale : modelWorldX;
  const domWorldY = selectedRect && boardRect ? bp.y + (selectedRect.top - boardRect.top) / scale : modelWorldY;

  return {
    resolved,
    selectedRect,
    modelWorldX,
    modelWorldY,
    domWorldX,
    domWorldY,
    domWidth: selectedRect ? selectedRect.width / scale : width,
    domHeight: selectedRect ? selectedRect.height / scale : height,
    width,
    height,
    rotation: parseFloat(resolved.rotation) || 0,
    isFixed,
    isFlowInLayout,
  };
}

function getComponentInstanceAncestor(allEls, element) {
  let cursor = element;
  while (cursor) {
    if (cursor.componentInstance) return cursor;
    cursor = cursor.parentId ? allEls.find((candidate) => candidate.id === cursor.parentId) ?? null : null;
  }
  return null;
}

function rotatePointAround(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos) - (dy * sin),
    y: center.y + (dx * sin) + (dy * cos),
  };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function getSvgViewBoxSize(markup) {
  if (typeof markup !== 'string') return { width: 64, height: 64 };
  const viewBoxMatch = markup.match(/viewBox\s*=\s*['"]\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*['"]/i);
  if (!viewBoxMatch) return { width: 64, height: 64 };
  const rawWidth = parseFloat(viewBoxMatch[3]);
  const rawHeight = parseFloat(viewBoxMatch[4]);
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return { width: 64, height: 64 };
  }
  const maxSize = 72;
  if (rawWidth >= rawHeight) {
    return { width: maxSize, height: Math.max(16, Math.round((rawHeight / rawWidth) * maxSize)) };
  }
  return { width: Math.max(16, Math.round((rawWidth / rawHeight) * maxSize)), height: maxSize };
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function offsetFromCenter(point, center, distance) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (dx / length) * distance,
    y: point.y + (dy / length) * distance,
  };
}

function getWorldVectorData(vectorData, worldX, worldY) {
  const data = getVectorShapeData({ shapeType: vectorData?.kind === 'line' ? 'line' : 'path', vectorData }) ?? vectorData;
  return {
    ...data,
    points: (data?.points ?? []).map((point) => ({
      ...point,
      x: point.x + worldX,
      y: point.y + worldY,
      inX: point.inX + worldX,
      inY: point.inY + worldY,
      outX: point.outX + worldX,
      outY: point.outY + worldY,
    })),
  };
}

function buildWorldVectorPathD(vectorData, worldX, worldY) {
  const worldData = getWorldVectorData(vectorData, worldX, worldY);
  return getVectorShapePathD(worldData);
}

function isPathHandleDistinct(point, handleKey) {
  if (!point) return false;
  const handleX = handleKey === 'in' ? point.inX : point.outX;
  const handleY = handleKey === 'in' ? point.inY : point.outY;
  return Math.abs(handleX - point.x) > 0.001 || Math.abs(handleY - point.y) > 0.001;
}

function getDragSessionWorldPosition(session, clientX, clientY, getProjectedWorldPoint) {
  const pointerWorld = getProjectedWorldPoint(clientX, clientY, 0, 0);
  let worldX = pointerWorld.worldX - (session.pointerOffsetWorldX ?? 0);
  let worldY = pointerWorld.worldY - (session.pointerOffsetWorldY ?? 0);

  if (session.hasRotation) {
    const ghostW = session.ghostW ?? 100;
    const ghostH = session.ghostH ?? 40;
    const localAnchorX = Number.isFinite(session.localAnchorX) ? session.localAnchorX : (ghostW / 2);
    const localAnchorY = Number.isFinite(session.localAnchorY) ? session.localAnchorY : (ghostH / 2);
    const anchorFromCenterX = localAnchorX - ghostW / 2;
    const anchorFromCenterY = localAnchorY - ghostH / 2;
    const radians = ((session.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const rotatedAnchorX = (anchorFromCenterX * cos) - (anchorFromCenterY * sin);
    const rotatedAnchorY = (anchorFromCenterX * sin) + (anchorFromCenterY * cos);
    const centerWorldX = pointerWorld.worldX - rotatedAnchorX;
    const centerWorldY = pointerWorld.worldY - rotatedAnchorY;
    worldX = centerWorldX - ghostW / 2;
    worldY = centerWorldY - ghostH / 2;
  }

  return { worldX, worldY };
}

function buildFallbackDragPreview({ session, worldX, worldY, bp, pagePadding, pageLayout, artboardDom, artboardRect }) {
  return {
    bp,
    pagePadding,
    pageLayout,
    artboardDom,
    artboardRect,
    dropContainer: null,
    targetParentId: null,
    mode: session.origPositionType === 'fixed' ? 'fixed-root' : 'root-free',
    insertBeforeId: null,
    reorderTarget: null,
    alignmentGuides: [],
    dropTargetId: null,
    hint: 'Free',
    clientLeft: null,
    clientTop: null,
    worldX,
    worldY,
    ghost: {
      worldX,
      worldY,
      width: session.ghostW ?? 100,
      height: session.ghostH ?? 40,
      bgColor: session.ghostBgColor,
      rotation: session.rotation ?? 0,
    },
  };
}

function shouldUseDirectRotatedMove(session) {
  if (!session?.hasRotation) return false;
  if (session.dragMode === 'flow' || session.origWasFlow || session.origPositionType === 'relative' || session.origPositionType === 'sticky') return false;
  return true;
}

function getAxisAlignedBounds(rect) {
  if (!rect) return null;
  const left = rect.left;
  const top = rect.top;
  const width = rect.width;
  const height = rect.height;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function CanvasContextMenu({ menu, hasClipboard, onClose, onCopy, onCut, onPaste, onDelete }) {
  if (!menu) return null;

  return (
    <div
      className="fb-context-menu"
      style={{ left: menu.clientX, top: menu.clientY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onCopy(); onClose(); }}
        disabled={!menu.elementId}
      >
        Copy
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onCut(); onClose(); }}
        disabled={!menu.elementId}
      >
        Cut
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onPaste(); onClose(); }}
        disabled={!hasClipboard || !menu.canPasteIntoFrame}
      >
        Paste
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { onDelete(); onClose(); }}
        disabled={!menu.elementId}
      >
        Delete
      </button>
      <button
        type="button"
        className="fb-context-menu__item"
        onClick={() => { menu.onCreateComponent?.(); onClose(); }}
        disabled={!menu.elementId}
      >
        Create Component
      </button>
    </div>
  );
}

function ComponentCreateModal({ defaultName, onCancel, onSubmit }) {
  const [name, setName] = useState(defaultName || 'Component');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setName(defaultName || 'Component');
    setErrorMessage('');
  }, [defaultName]);

  return (
    <div className="fb-overlay-modal" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="fb-overlay-modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fb-overlay-modal__head">Create component</div>
        <div className="fb-overlay-modal__body">
          <label className="fb-overlay-modal__label">Component name</label>
          <input
            className="fb-prop-input"
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const result = onSubmit(name);
                setErrorMessage(result?.error || '');
              }
              if (e.key === 'Escape') onCancel();
            }}
          />
          {errorMessage ? <div className="fb-artboard-bp-note" style={{ marginTop: 10, color: '#fda4af' }}>{errorMessage}</div> : null}
        </div>
        <div className="fb-overlay-modal__actions">
          <button type="button" className="fb-secondary-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="fb-primary-btn" onClick={() => {
            const result = onSubmit(name);
            setErrorMessage(result?.error || '');
          }}>Create</button>
        </div>
      </div>
    </div>
  );
}

/** Draggable viewport-fold line, rendered at world-space for every breakpoint. */
function ViewportFoldOverlay({ onStartFoldDrag }) {
  const bpDefs = useEditorStore(s => s.breakpointDefs);
  return (
    <>
      {Object.values(bpDefs).map(bp => {
        const autoFoldH = bp.id === 'desktop'
          ? Math.round(bp.width * 9 / 16)
          : Math.round(bp.width * 16 / 9);
        const foldH = bp.viewportFoldH ?? autoFoldH;
        return (
          <div
            key={bp.id}
            className="fb-viewport-indicator fb-viewport-indicator--draggable"
            style={{ position: 'absolute', left: bp.x, top: bp.y + foldH, width: bp.width }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartFoldDrag(e, bp.id, foldH); }}
          >
            <div className="fb-viewport-indicator__line" />
            <span className="fb-viewport-indicator__pill">Viewport fold</span>
          </div>
        );
      })}
    </>
  );
}

function CommentOverlay({ commentDraft, onStartCommentDrag }) {
  const activeSurface = useEditorStore((state) => state.activeSurface);
  const comments = useEditorStore((state) => state.getPageComments());
  const activeCommentId = useEditorStore((state) => state.activeCommentId);
  const setActiveComment = useEditorStore((state) => state.setActiveComment);
  const setActiveCanvasTool = useEditorStore((state) => state.setActiveCanvasTool);
  const breakpointDefs = useEditorStore((state) => state.breakpointDefs);
  const viewportScale = useEditorStore((state) => state.viewport.scale);
  const page = useEditorStore((state) => state.getCurrentPage());
  const currentUserName = getCurrentCommentUserName();

  if (activeSurface === 'component') return null;

  return (
    <>
      {(comments ?? []).filter((comment) => !comment.resolved).map((comment) => {
        const bp = breakpointDefs[comment.bpId];
        if (!bp) return null;
        const pad = resolvePagePadding(page?.padding, comment.bpId);
        const position = clampCommentPositionToArtboard(bp, pad, comment.x, comment.y);
        const left = bp.x + (pad?.left ?? 0) + position.x;
        const top = bp.y + (pad?.top ?? 0) + position.y;
        const preview = comment.messages?.[comment.messages.length - 1]?.text ?? 'Comment';
        const isActive = comment.id === activeCommentId;
        const pinCount = Math.max(1, (comment.messages ?? []).length || getExternalReplyCount(comment, currentUserName));
        return (
          <button
            key={comment.id}
            type="button"
            className={`fb-comment-pin${isActive ? ' is-active' : ''}${comment.resolved ? ' is-resolved' : ''}`}
            style={{ left, top, transform: `translate(-50%, -50%) scale(${1 / Math.max(viewportScale || 1, MIN_SCALE)})` }}
            onMouseDown={(event) => {
              event.stopPropagation();
              setActiveComment(comment.id);
              setActiveCanvasTool('comment');
              onStartCommentDrag?.(event, comment);
            }}
            title={preview}
          >
            <span className="fb-comment-pin__dot fb-comment-pin__dot--count">
              <span className="fb-comment-pin__count">{pinCount}</span>
            </span>
          </button>
        );
      })}
      {commentDraft ? (
        (() => {
          const bp = breakpointDefs[commentDraft.bpId];
          if (!bp) return null;
          const pad = resolvePagePadding(page?.padding, commentDraft.bpId);
          const position = clampCommentPositionToArtboard(bp, pad, commentDraft.x, commentDraft.y);
          return (
            <button
              type="button"
              className="fb-comment-pin is-draft is-active"
              style={{
                left: bp.x + (pad?.left ?? 0) + position.x,
                top: bp.y + (pad?.top ?? 0) + position.y,
                transform: `translate(-50%, -50%) scale(${1 / Math.max(viewportScale || 1, MIN_SCALE)})`,
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
                onStartCommentDrag?.(event, commentDraft);
              }}
              title="Draft comment"
            >
              <span className="fb-comment-pin__dot fb-comment-pin__dot--draft">
                <span className="fb-comment-pin__plus">+</span>
              </span>
            </button>
          );
        })()
      ) : null}
    </>
  );
}

function CommentCanvasCard({ containerRef, viewport, commentDraft, onSubmitDraft, onDiscardDraft }) {
  const activeSurface = useEditorStore((state) => state.activeSurface);
  const activeComment = useEditorStore((state) => state.getActiveComment());
  const breakpointDefs = useEditorStore((state) => state.breakpointDefs);
  const page = useEditorStore((state) => state.getCurrentPage());
  const addCommentReply = useEditorStore((state) => state.addCommentReply);
  const setCommentResolved = useEditorStore((state) => state.setCommentResolved);
  const clearActiveComment = useEditorStore((state) => state.clearActiveComment);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    setReplyText('');
  }, [activeComment?.id, commentDraft?.id]);

  const cardComment = activeComment ?? commentDraft;
  const hasMessages = (cardComment?.messages ?? []).length > 0;
  const isDraftOnly = !activeComment && !!commentDraft && !hasMessages;

  const cardPosition = useMemo(() => {
    if (activeSurface === 'component' || !cardComment) return null;
    const bp = breakpointDefs[cardComment.bpId];
    if (!bp) return null;
    const pad = resolvePagePadding(page?.padding, cardComment.bpId);
    const position = clampCommentPositionToArtboard(bp, pad, cardComment.x, cardComment.y);
    const anchorX = (bp.x + (pad?.left ?? 0) + position.x) * viewport.scale + viewport.x;
    const anchorY = (bp.y + (pad?.top ?? 0) + position.y) * viewport.scale + viewport.y;
    const containerRect = containerRef.current?.getBoundingClientRect();
    const width = 320;
    const minLeft = 12;
    const maxLeft = Math.max(minLeft, (containerRect?.width ?? width + 24) - width - 12);
    const minTop = 12;
    const maxTop = Math.max(minTop, (containerRect?.height ?? 380) - 260);
    return {
      left: Math.min(Math.max(anchorX + 30, minLeft), maxLeft),
      top: Math.min(Math.max(anchorY - 18, minTop), maxTop),
    };
  }, [cardComment, activeSurface, breakpointDefs, containerRef, page?.padding, viewport.scale, viewport.x, viewport.y]);

  if (!cardComment || !cardPosition || activeSurface === 'component') return null;

  const handleReply = () => {
    if (!replyText.trim()) return;
    if (activeComment?.id) addCommentReply(activeComment.id, replyText);
    else if (commentDraft) onSubmitDraft?.(replyText.trim());
    setReplyText('');
  };

  const handleToggleResolved = () => {
    if (!activeComment?.id) return;
    const nextResolved = !activeComment.resolved;
    setCommentResolved(activeComment.id, nextResolved);
    if (nextResolved) clearActiveComment();
  };

  return (
    <div
      className={`fb-comment-card${activeComment?.resolved ? ' is-resolved' : ''}${isDraftOnly ? ' is-compact' : ''}`}
      style={cardPosition}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {!isDraftOnly ? (
        <div className="fb-comment-card__head">
          <div>
            <div className="fb-comment-card__title">{hasMessages ? 'Comment' : 'New comment'}</div>
            <div className="fb-comment-card__meta">{cardComment.bpId} artboard • {formatCommentTimestamp(cardComment.updatedAt ?? cardComment.createdAt)}</div>
          </div>
          <button type="button" className="fb-comment-card__close" onClick={() => activeComment ? clearActiveComment() : onDiscardDraft?.()} aria-label="Close comment thread">×</button>
        </div>
      ) : null}

      {hasMessages ? (
        <div className="fb-comment-card__messages">
          {(cardComment.messages ?? []).map((message) => (
            <div key={message.id} className="fb-comment-card__message">
              <CommentAvatar author={message.author} avatarUrl={message.avatarUrl} />
              <div className="fb-comment-card__bubble">
                <div className="fb-comment-card__message-head">
                  <strong>{message.author || 'You'}</strong>
                  <span>{formatCommentTimestamp(message.createdAt)}</span>
                </div>
                <div className="fb-comment-card__message-body">{message.text}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={`fb-comment-card__composer${isDraftOnly ? ' is-compact' : ''}`}>
        <input
          className="fb-comment-card__input"
          placeholder={hasMessages ? 'Reply to this thread' : 'Type a comment'}
          value={replyText}
          onChange={(event) => setReplyText(event.target.value)}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleReply();
            }
          }}
        />
        <div className="fb-comment-card__actions">
          {hasMessages ? (
            <button
              type="button"
              className="fb-comment-card__toggle"
              onClick={handleToggleResolved}
            >
              {activeComment.resolved ? 'Reopen' : 'Mark complete'}
            </button>
          ) : null}
          <button
            type="button"
            className="fb-comment-card__submit"
            onClick={handleReply}
            disabled={!replyText.trim()}
            aria-label={hasMessages ? 'Reply' : 'Add comment'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h12" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Renders a bounding-box overlay in world-space, as a sibling of artboards.
 *  Not clipped by artboard's overflow:hidden, so it shows even for overflowing elements. */
function SelectionOverlay({ onStartResize, onStartMove, onStartRadiusDrag, onStartGradientDrag, onStartVectorPointDrag, onInsertVectorPoint, dragOverlay, gradientDragOverlay }) {
  const selection              = useEditorStore(s => s.selection);
  const bpDefs                 = useEditorStore(s => s.breakpointDefs);
  const allElements            = useEditorStore(s => s.getAllElements());
  const page                   = useEditorStore(s => s.getCurrentPage());
  const activeSurface          = useEditorStore(s => s.activeSurface);
  const componentEditor        = useEditorStore(s => s.componentEditor);
  const openComponentEditor    = useEditorStore(s => s.openComponentEditor);
  const setDrilledContainerId  = useEditorStore(s => s.setDrilledContainerId);
  const setSelection           = useEditorStore(s => s.setSelection);
  const viewport               = useEditorStore(s => s.viewport);
  const activeVectorPoint      = useEditorStore(s => s.activeVectorPoint);
  const [measuredRect, setMeasuredRect] = useState(null);
  const selectionIds = getSelectionElementIds(selection);

  const selectedElementId = selection?.elementId ?? null;
  const selectedBpId = selection?.bpId ?? null;
  const selectedEl = selectedElementId ? allElements.find(e => e.id === selectedElementId) : null;

  useLayoutEffect(() => {
    if (!selectedBpId || !selectedEl) {
      setMeasuredRect(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      const currentBoard = document.querySelector(`.fb-artboard[data-bp="${selectedBpId}"]`);
      const currentNode = currentBoard?.querySelector(`[data-id="${selectedEl.id}"]`) ?? null;
      const currentBoardRect = currentBoard?.getBoundingClientRect() ?? null;
      const currentRect = currentNode?.getBoundingClientRect() ?? null;
      if (!currentBoardRect || !currentRect) {
        setMeasuredRect(null);
        return;
      }
      const currentBp = useEditorStore.getState().breakpointDefs[selectedBpId];
      const currentScale = useEditorStore.getState().viewport.scale ?? 1;
      const left = currentBp.x + (currentRect.left - currentBoardRect.left) / currentScale;
      const top = currentBp.y + (currentRect.top - currentBoardRect.top) / currentScale;
      const width = currentRect.width / currentScale;
      const height = currentRect.height / currentScale;
      setMeasuredRect((prev) => (
        prev && Math.abs(prev.left - left) < 0.01 && Math.abs(prev.top - top) < 0.01 && Math.abs(prev.width - width) < 0.01 && Math.abs(prev.height - height) < 0.01
          ? prev
          : { left, top, width, height }
      ));
    };

    frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedBpId, selectedEl, viewport.scale, viewport.x, viewport.y]);

  if (!selection) return null;
  const el = selectedEl;
  if (!el) return null;

  const bp = bpDefs[selection.bpId];
  if (!bp) return null;
  const scale = Math.max(MIN_SCALE, Number.isFinite(viewport.scale) ? viewport.scale : 1);
  const boardDom = document.querySelector(`.fb-artboard[data-bp="${bp.id}"]`);
  const selectedDomNode = boardDom?.querySelector(`[data-id="${el.id}"]`) ?? null;
  if (selectionIds.length > 1) {
    const groupItems = selectionIds
      .map((id) => allElements.find((candidate) => candidate.id === id))
      .filter(Boolean)
      .map((selected) => {
        const resolvedSelected = resolveElement(selected, selection.bpId);
        const metrics = getElementWorldMetrics({ el: selected, bpId: selection.bpId, bp, page, boardDom, scale });
        const isFlow = ['relative', 'sticky'].includes(resolvedSelected.positionType ?? 'absolute')
          || (!selected.parentId && page?.layout?.[selection.bpId] != null && !resolvedSelected.absoluteInLayout && resolvedSelected.positionType !== 'fixed');
        return {
          el: selected,
          resolved: resolvedSelected,
          metrics,
          canResize: !selected.locked && !isFlow && Math.abs(parseFloat(resolvedSelected.rotation) || 0) <= 0.01,
        };
      })
      .filter((item) => item.metrics);
    const metricsList = groupItems.map((item) => item.metrics).filter(Boolean);
    if (!metricsList.length) return null;
    const union = metricsList.reduce((acc, metrics) => ({
      left: Math.min(acc.left, metrics.domWorldX),
      top: Math.min(acc.top, metrics.domWorldY),
      right: Math.max(acc.right, metrics.domWorldX + metrics.domWidth),
      bottom: Math.max(acc.bottom, metrics.domWorldY + metrics.domHeight),
    }), {
      left: metricsList[0].domWorldX,
      top: metricsList[0].domWorldY,
      right: metricsList[0].domWorldX + metricsList[0].domWidth,
      bottom: metricsList[0].domWorldY + metricsList[0].domHeight,
    });
    const left = union.left;
    const top = union.top;
    const width = Math.max(1 / scale, union.right - union.left);
    const height = Math.max(1 / scale, union.bottom - union.top);
    const center = { x: left + width / 2, y: top + height / 2 };
    const tl = { x: left, y: top };
    const tr = { x: left + width, y: top };
    const br = { x: left + width, y: top + height };
    const bl = { x: left, y: top + height };
    const handlePoints = {
      nw: tl,
      n: midpoint(tl, tr),
      ne: tr,
      e: midpoint(tr, br),
      se: br,
      s: midpoint(bl, br),
      sw: bl,
      w: midpoint(tl, bl),
    };
    const canGroupResize = groupItems.length > 1 && groupItems.every((item) => item.canResize);
    const handleSize = 8 / scale;
    const svgWidth = Math.max(...Object.values(bpDefs).map((entry) => entry.x + entry.width), left + width) + 400;
    const svgHeight = Math.max(...Object.values(bpDefs).map((entry) => entry.y + entry.height), top + height) + 400;
    const useComponentSelectionAccent = activeSurface === 'component';
    const outlineColor = useComponentSelectionAccent ? 'var(--component-accent)' : 'var(--accent-light)';
    const outlineShadow = useComponentSelectionAccent ? 'var(--component-accent-strong)' : 'transparent';
    const polygonPoints = [tl, tr, br, bl].map((point) => `${point.x},${point.y}`).join(' ');
    const groupResizePayload = {
      groupBounds: { minX: left, minY: top, width, height },
      items: groupItems.map((item) => ({
        id: item.el.id,
        startX: item.resolved.x ?? item.el.base?.x ?? 0,
        startY: item.resolved.y ?? item.el.base?.y ?? 0,
        startW: item.resolved.width ?? item.el.base?.width ?? 100,
        startH: item.resolved.height ?? item.el.base?.height ?? 40,
        domWorldX: item.metrics.domWorldX,
        domWorldY: item.metrics.domWorldY,
        domWidth: item.metrics.domWidth,
        domHeight: item.metrics.domHeight,
      })),
    };
    return (
      <>
        <div
          className="fb-sel-overlay fb-sel-overlay--group"
          style={{
            left,
            top,
            width,
            height,
            pointerEvents: 'none',
            border: `${2 / scale}px solid ${outlineColor}`,
            boxShadow: `0 0 0 ${1 / scale}px ${activeSurface === 'component' ? 'rgba(154, 108, 255, 0.18)' : 'rgba(132, 210, 108, 0.18)'}`,
            background: activeSurface === 'component' ? 'rgba(154, 108, 255, 0.04)' : 'rgba(132, 210, 108, 0.04)',
          }}
        />
        <svg
          className="fb-sel-overlay-svg"
          width={svgWidth}
          height={svgHeight}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 10000 }}
        >
          <polygon
            points={polygonPoints}
            fill="none"
            stroke={outlineColor}
            strokeWidth={2 / scale}
            vectorEffect="non-scaling-stroke"
            style={{ filter: outlineShadow !== 'transparent' ? `drop-shadow(0 0 ${1 / scale}px ${outlineShadow})` : undefined }}
          />
          {canGroupResize ? OVERLAY_HANDLES.map((handle) => {
            const point = handlePoints[handle];
            return (
              <rect
                key={`group-${handle}`}
                x={point.x - handleSize / 2}
                y={point.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={2 / scale}
                ry={2 / scale}
                fill={useComponentSelectionAccent ? 'var(--component-accent)' : '#fff'}
                stroke={outlineColor}
                strokeWidth={1.5 / scale}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
                style={{ cursor: `${handle}-resize` }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onStartResize(event, selection.bpId, el, `group-${handle}`, groupResizePayload);
                }}
              />
            );
          }) : null}
        </svg>
      </>
    );
  }
  const metrics = getElementWorldMetrics({ el, bpId: selection.bpId, bp, page, boardDom, scale });
  const resolved = metrics?.resolved ?? resolveElement(el, selection.bpId);
  if (resolved.hidden) return null;
  const pageLayout = resolvePageLayout(page?.layout, selection.bpId);
  const boardRect = boardDom?.getBoundingClientRect() ?? null;
  const selectedRect = metrics?.selectedRect ?? null;
  const isFixed = metrics?.isFixed ?? (resolved.positionType === 'fixed');
  const isFlowInLayout = metrics?.isFlowInLayout ?? false;

  // Viewport fold height based on device aspect ratio (desktop 16:9, others 9:16)
  const viewportFoldH = bp.id === 'desktop'
    ? Math.round(bp.width * 9 / 16)
    : Math.round(bp.width * 16 / 9);

  const pad    = resolvePagePadding(page?.padding, selection.bpId);
  const w        = resolved.width  ?? 100;
  const h        = resolved.height ?? 100;
  const rotation = resolved.rotation;
  const constraints = { top: true, left: true, right: false, bottom: false, ...(resolved.constraints ?? {}) };
  const isDragging = dragOverlay?.elementId === el.id;
  const canMoveOverlay = !el.locked && !isDragging && !['relative', 'sticky'].includes(resolved.positionType ?? 'absolute') && !isFlowInLayout;
  const isActiveComponentVariantRoot = activeSurface === 'component'
    && !!el.componentRoot
    && !!el.componentEditorVariantId
    && componentEditor?.activeVariantId === el.componentEditorVariantId;
  const overlayHandles = (isFontResizeTextElement(el, resolved) ? ['se'] : OVERLAY_HANDLES)
    .filter((handle) => !(isActiveComponentVariantRoot && handle === 'e'));
  const rotateHandles = ['nw', 'ne', 'se', 'sw'];
  const overlayCapturesPointer = canMoveOverlay && el.type !== 'text' && Math.abs(parseFloat(rotation) || 0) <= 0.01;

  let worldX = metrics?.modelWorldX ?? bp.x;
  let worldY = metrics?.modelWorldY ?? bp.y;
  let containerWorldLeft = bp.x;
  let containerWorldTop = bp.y;
  let containerWorldWidth = bp.width;
  let containerWorldHeight = isFixed ? viewportFoldH : bp.height;
  if (el.parentId) {
    // Nested element: the parent may be a flex container with no meaningful x/y in the
    // data model. Measure the parent's current screen position and add the element's own
    // x/y from the store. The parent DOM is stable (it's not the one being dragged),
    // and the element x/y in the store is always the latest value — even during drag.
    const sc       = scale;
    // Scope parent lookup to the correct artboard — querySelector without scope
    // would return the Desktop copy when the same element exists in all artboards.
    const parentDom = boardDom?.querySelector(`[data-id="${el.parentId}"]`);
    if (parentDom && boardDom) {
      const parentRect = parentDom.getBoundingClientRect();
      const boardRect  = boardDom.getBoundingClientRect();
      const parentOffX = (parentRect.left - boardRect.left + parentDom.clientLeft) / sc;
      const parentOffY = (parentRect.top  - boardRect.top  + parentDom.clientTop) / sc;
      containerWorldLeft = bp.x + parentOffX;
      containerWorldTop = bp.y + parentOffY;
      containerWorldWidth = parentRect.width / sc;
      containerWorldHeight = parentRect.height / sc;
      worldX = bp.x + parentOffX + (resolved.x ?? 0);
      worldY = bp.y + parentOffY + (resolved.y ?? 0);
    } else {
      // Fallback: no DOM available (SSR / unmounted)
      worldX = bp.x + (resolved.x ?? 0);
      worldY = bp.y + (resolved.y ?? 0);
    }
  } else {
    // Root-level element: use data-model values + page padding
    const absX = resolved.x ?? 0;
    const absY = resolved.y ?? 0;
    const isElOffCanvas = (
      absX + w <= 0 || absX >= bp.width ||
      absY + h <= 0 || absY >= bp.height
    );
    // absoluteInLayout elements are positioned absolute inside artboard-content
    // which carries no additional offset — do NOT add page padding.
    const isAutoLayoutException = pageLayout !== null && !!resolved.absoluteInLayout;
    const offsetLeft = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.left ?? 0);
    const offsetTop = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.top ?? 0);
    const offsetRight = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.right ?? 0);
    const offsetBottom = isFixed || isElOffCanvas || isAutoLayoutException ? 0 : (pad?.bottom ?? 0);
    containerWorldLeft = bp.x + offsetLeft;
    containerWorldTop = bp.y + offsetTop;
    containerWorldWidth = bp.width - offsetLeft - offsetRight;
    containerWorldHeight = (isFixed ? viewportFoldH : bp.height) - offsetTop - offsetBottom;
    worldX = containerWorldLeft + absX;
    worldY = containerWorldTop + absY;
  }

  if (isDragging) {
    worldX = dragOverlay.worldX;
    worldY = dragOverlay.worldY;
  }

  const shapeKind = getShapePresetKind(resolved) || getShapePresetKind(el);
  const isVectorShape = ['line', 'path', 'pen'].includes(shapeKind ?? '');
  const hasRotation = Math.abs(parseFloat(rotation) || 0) > 0.01;
  const visualRect = measuredRect ?? (selectedRect && boardRect
    ? {
        left: metrics?.domWorldX ?? (bp.x + (selectedRect.left - boardRect.left) / scale),
        top: metrics?.domWorldY ?? (bp.y + (selectedRect.top - boardRect.top) / scale),
        width: metrics?.domWidth ?? (selectedRect.width / scale),
        height: metrics?.domHeight ?? (selectedRect.height / scale),
      }
    : null);
  const shouldUseVisualPosition = !!visualRect;
  const shouldUseVisualSize = !!visualRect && !isVectorShape && (['relative', 'sticky'].includes(resolved.positionType ?? 'absolute') || isFlowInLayout || resolved.widthMode === 'hug' || resolved.heightMode === 'hug');
  const overlayW = isDragging
    ? (dragOverlay.width ?? w)
    : (hasRotation ? w : (shouldUseVisualSize ? visualRect.width : w));
  const overlayH = isDragging
    ? (dragOverlay.height ?? h)
    : (hasRotation ? h : (shouldUseVisualSize ? visualRect.height : h));
  if (!isDragging && visualRect) {
    if (hasRotation) {
      worldX = visualRect.left + (visualRect.width / 2) - (overlayW / 2);
      worldY = visualRect.top + (visualRect.height / 2) - (overlayH / 2);
    } else if (shouldUseVisualPosition) {
      worldX = visualRect.left;
      worldY = visualRect.top;
    }
  }
  if (![worldX, worldY, overlayW, overlayH].every(Number.isFinite)) return null;
  const center = { x: worldX + overlayW / 2, y: worldY + overlayH / 2 };
  const selectionRotation = parseFloat(rotation) || 0;
  const tl = rotatePointAround({ x: worldX, y: worldY }, center, selectionRotation);
  const tr = rotatePointAround({ x: worldX + overlayW, y: worldY }, center, selectionRotation);
  const br = rotatePointAround({ x: worldX + overlayW, y: worldY + overlayH }, center, selectionRotation);
  const bl = rotatePointAround({ x: worldX, y: worldY + overlayH }, center, selectionRotation);
  if (![center, tl, tr, br, bl].every(isFinitePoint)) return null;
  const handlePoints = {
    nw: tl,
    n: midpoint(tl, tr),
    ne: tr,
    e: midpoint(tr, br),
    se: br,
    s: midpoint(bl, br),
    sw: bl,
    w: midpoint(tl, bl),
  };
  const rotatePoints = {
    nw: offsetFromCenter(tl, center, 20 / scale),
    ne: offsetFromCenter(tr, center, 20 / scale),
    se: offsetFromCenter(br, center, 20 / scale),
    sw: offsetFromCenter(bl, center, 20 / scale),
  };
  const guideBounds = getAxisAlignedBounds(hasRotation && visualRect ? visualRect : {
    left: worldX,
    top: worldY,
    width: overlayW,
    height: overlayH,
  });
  const midX = guideBounds?.centerX ?? center.x;
  const midY = guideBounds?.centerY ?? center.y;
  const guides = [];
  if (canMoveOverlay && constraints.left) {
    guides.push({ key: 'left', style: { left: containerWorldLeft, top: midY, width: Math.max(0, (guideBounds?.left ?? worldX) - containerWorldLeft), height: 0 } });
  }
  if (canMoveOverlay && constraints.right) {
    const rightStart = guideBounds?.right ?? (worldX + overlayW);
    guides.push({ key: 'right', style: { left: rightStart, top: midY, width: Math.max(0, containerWorldLeft + containerWorldWidth - rightStart), height: 0 } });
  }
  if (canMoveOverlay && constraints.top) {
    guides.push({ key: 'top', style: { left: midX, top: containerWorldTop, width: 0, height: Math.max(0, (guideBounds?.top ?? worldY) - containerWorldTop) } });
  }
  if (canMoveOverlay && constraints.bottom) {
    const bottomStart = guideBounds?.bottom ?? (worldY + overlayH);
    guides.push({ key: 'bottom', style: { left: midX, top: bottomStart, width: 0, height: Math.max(0, containerWorldTop + containerWorldHeight - bottomStart) } });
  }

  const elChildren = allElements.filter(e => e.parentId === el.id);
  const canDrill   = elChildren.length > 0;
  const svgWidth = Math.max(...Object.values(bpDefs).map((entry) => entry.x + entry.width), worldX + overlayW) + 400;
  const svgHeight = Math.max(...Object.values(bpDefs).map((entry) => entry.y + entry.height), worldY + overlayH) + 400;
  const useComponentSelectionAccent = activeSurface === 'component' || el.componentInstance;
  const outlineColor = useComponentSelectionAccent ? 'var(--component-accent)' : 'var(--accent-light)';
  const outlineShadow = useComponentSelectionAccent ? 'var(--component-accent-strong)' : 'transparent';
  const overlayHitRect = hasRotation && visualRect
    ? visualRect
    : { left: worldX, top: worldY, width: overlayW, height: overlayH };
  const overlayBoxStyle = {
    left: overlayHitRect.left,
    top: overlayHitRect.top,
    width: overlayHitRect.width,
    height: overlayHitRect.height,
    transform: hasRotation ? undefined : (selectionRotation ? `rotate(${selectionRotation}deg)` : undefined),
    transformOrigin: '50% 50%',
    pointerEvents: overlayCapturesPointer ? 'auto' : 'none',
    borderColor: hasRotation ? 'transparent' : outlineColor,
    boxShadow: !hasRotation && outlineShadow !== 'transparent'
      ? `0 0 0 calc(1px * var(--inv-scale, 1)) ${outlineShadow}`
      : undefined,
    background: 'rgba(0,0,0,0.001)',
  };
  const resizePayload = {
    frameWorldX: overlayHitRect.left,
    frameWorldY: overlayHitRect.top,
    vectorWidth: overlayHitRect.width,
    vectorHeight: overlayHitRect.height,
  };
  const handleSize = 8 / scale;
  const rotateHandleSize = 14 / scale;
  const radiusHandleSize = 8 / scale;
  const radiusInset = 10 / scale;
  const computedBackgroundImage = selectedDomNode ? window.getComputedStyle(selectedDomNode).backgroundImage : '';
  const gradientFill = parseGradient(
    resolved.styles?.backgroundColor
    ?? (typeof computedBackgroundImage === 'string' && computedBackgroundImage.includes('gradient(') ? computedBackgroundImage : '')
  );
  const gradientEditor = (() => {
    if (!onStartGradientDrag || el.locked || isDragging || !gradientFill || !['linear', 'radial'].includes(gradientFill.type)) return null;
    if (gradientDragOverlay && gradientDragOverlay.elementId === el.id && gradientDragOverlay.bpId === selection.bpId && gradientDragOverlay.type === gradientFill.type) {
      return {
        ...gradientDragOverlay,
        stops: (gradientFill.stops ?? []).map((stop, index) => ({
          index,
          color: stop.color,
          pos: stop.pos ?? 0,
          point: {
            x: gradientDragOverlay.lineStart.x + ((gradientDragOverlay.lineEnd.x - gradientDragOverlay.lineStart.x) * ((stop.pos ?? 0) / 100)),
            y: gradientDragOverlay.lineStart.y + ((gradientDragOverlay.lineEnd.y - gradientDragOverlay.lineStart.y) * ((stop.pos ?? 0) / 100)),
          },
        })),
      };
    }
    if (gradientFill.type === 'linear') {
      const direction = cssAngleToUnitVector(gradientFill.angle ?? 135);
      const localRect = { left: worldX, top: worldY, right: worldX + overlayW, bottom: worldY + overlayH };
      const projectionRange = getProjectionRangeForRect(localRect, direction);
      const firstStop = (gradientFill.stops ?? [])[0]?.pos ?? 0;
      const lastStop = (gradientFill.stops ?? []).at(-1)?.pos ?? 100;
      const startProjection = projectionRange.min + ((projectionRange.max - projectionRange.min) * (firstStop / 100));
      const endProjection = projectionRange.min + ((projectionRange.max - projectionRange.min) * (lastStop / 100));
      const rawStart = pointForProjection(direction, startProjection, center);
      const rawEnd = pointForProjection(direction, endProjection, center);
      const lineStart = rotatePointAround(rawStart, center, selectionRotation);
      const lineEnd = rotatePointAround(rawEnd, center, selectionRotation);
      return {
        type: 'linear',
        elementId: el.id,
        bpId: selection.bpId,
        center,
        radius: Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y) / 2,
        lineStart,
        lineEnd,
        stops: (gradientFill.stops ?? []).map((stop, index) => ({
          index,
          color: stop.color,
          pos: stop.pos ?? 0,
          point: {
            x: lineStart.x + ((lineEnd.x - lineStart.x) * ((stop.pos ?? 0) / 100)),
            y: lineStart.y + ((lineEnd.y - lineStart.y) * ((stop.pos ?? 0) / 100)),
          },
        })),
      };
    }
    const localCenter = {
      x: worldX + (overlayW * ((gradientFill.centerX ?? 50) / 100)),
      y: worldY + (overlayH * ((gradientFill.centerY ?? 50) / 100)),
    };
    const radialCenter = rotatePointAround(localCenter, center, selectionRotation);
    const radialRadius = Math.max(18 / scale, Math.min(overlayW, overlayH) * ((gradientFill.radius ?? 50) / 100));
    const localRadiusPoint = { x: localCenter.x + radialRadius, y: localCenter.y };
    const lineEnd = rotatePointAround(localRadiusPoint, center, selectionRotation);
    return {
      type: 'radial',
      elementId: el.id,
      bpId: selection.bpId,
      center: radialCenter,
      radius: radialRadius,
      lineStart: radialCenter,
      lineEnd,
      stops: (gradientFill.stops ?? []).map((stop, index) => ({
        index,
        color: stop.color,
        pos: stop.pos ?? 0,
        point: {
          x: radialCenter.x + ((lineEnd.x - radialCenter.x) * ((stop.pos ?? 0) / 100)),
          y: radialCenter.y + ((lineEnd.y - radialCenter.y) * ((stop.pos ?? 0) / 100)),
        },
      })),
    };
  })();
  const radiusAnchorPoints = (() => {
    const anchors = resolved.styles?.borderRadiusMode === 'independent'
      ? {
          TL: { x: worldX + radiusInset, y: worldY + radiusInset },
          TR: { x: worldX + overlayW - radiusInset, y: worldY + radiusInset },
          BL: { x: worldX + radiusInset, y: worldY + overlayH - radiusInset },
          BR: { x: worldX + overlayW - radiusInset, y: worldY + overlayH - radiusInset },
        }
      : { all: { x: worldX + radiusInset, y: worldY + radiusInset } };
    return Object.fromEntries(Object.entries(anchors).map(([key, point]) => [key, rotatePointAround(point, center, selectionRotation)]));
  })();
  if (!Object.values(handlePoints).every(isFinitePoint)) return null;
  if (!Object.values(rotatePoints).every(isFinitePoint)) return null;
  if (!Object.values(radiusAnchorPoints).every(isFinitePoint)) return null;
  const polygonPoints = [tl, tr, br, bl].map((point) => `${point.x},${point.y}`).join(' ');
  const edgeResizeLines = !el.locked && !isDragging
    ? [
        { key: 'n', start: tl, end: tr, handle: 'n', enabled: overlayHandles.includes('n') },
        { key: 'e', start: tr, end: br, handle: 'e', enabled: OVERLAY_HANDLES.includes('e') },
        { key: 's', start: bl, end: br, handle: 's', enabled: overlayHandles.includes('s') },
        { key: 'w', start: tl, end: bl, handle: 'w', enabled: overlayHandles.includes('w') },
      ].filter((edge) => edge.enabled)
    : [];
  const vectorShapeData = ['line', 'path', 'pen'].includes(shapeKind ?? '') ? getVectorShapeData(resolved) || getVectorShapeData(el) : null;

  const vectorEditingOverlay = vectorShapeData && shapeKind !== 'line' ? (
    <>
      <path
        d={buildWorldVectorPathD(vectorShapeData, worldX, worldY)}
        fill="none"
        stroke="rgba(0,0,0,0.001)"
        strokeWidth={18 / scale}
        vectorEffect="non-scaling-stroke"
        pointerEvents={el.locked ? 'none' : 'stroke'}
        style={{ cursor: el.locked ? 'default' : 'copy' }}
        onDoubleClick={(event) => {
          if (el.locked) return;
          event.stopPropagation();
          event.preventDefault();
          onInsertVectorPoint(event, selection.bpId, el, worldX, worldY);
        }}
      />
      <path
        d={buildWorldVectorPathD(vectorShapeData, worldX, worldY)}
        fill="none"
        stroke={outlineColor}
        strokeWidth={1.5 / scale}
        strokeDasharray={`${6 / scale} ${4 / scale}`}
        vectorEffect="non-scaling-stroke"
        opacity={0.7}
      />
      {vectorShapeData.points.map((rawPoint, index) => {
        const point = {
          x: rawPoint.x + worldX,
          y: rawPoint.y + worldY,
          inX: rawPoint.inX + worldX,
          inY: rawPoint.inY + worldY,
          outX: rawPoint.outX + worldX,
          outY: rawPoint.outY + worldY,
        };
        return (
          <React.Fragment key={`vector-point-${index}`}>
            {isPathHandleDistinct(point, 'in') ? (
              <>
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={point.inX}
                  y2={point.inY}
                  stroke="rgba(59,130,246,0.7)"
                  strokeWidth={1.5 / scale}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={point.inX}
                  cy={point.inY}
                  r={5 / scale}
                  fill="#fff"
                  stroke="#3b82f6"
                  strokeWidth={1.5 / scale}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents={el.locked ? 'none' : 'all'}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onStartVectorPointDrag(event, selection.bpId, el, index, 'in', worldX, worldY);
                  }}
                />
              </>
            ) : null}
            {isPathHandleDistinct(point, 'out') ? (
              <>
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={point.outX}
                  y2={point.outY}
                  stroke="rgba(59,130,246,0.7)"
                  strokeWidth={1.5 / scale}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={point.outX}
                  cy={point.outY}
                  r={5 / scale}
                  fill="#fff"
                  stroke="#3b82f6"
                  strokeWidth={1.5 / scale}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents={el.locked ? 'none' : 'all'}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onStartVectorPointDrag(event, selection.bpId, el, index, 'out', worldX, worldY);
                  }}
                />
              </>
            ) : null}
            <circle
              cx={point.x}
              cy={point.y}
              r={5.5 / scale}
              fill={activeVectorPoint?.elementId === el.id && activeVectorPoint?.bpId === selection.bpId && activeVectorPoint?.pointIndex === index ? '#fff' : '#3b82f6'}
              stroke={outlineColor}
              strokeWidth={1.5 / scale}
              vectorEffect="non-scaling-stroke"
              pointerEvents={el.locked ? 'none' : 'all'}
              style={{ cursor: el.locked ? 'default' : 'grab' }}
              onMouseDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onStartVectorPointDrag(event, selection.bpId, el, index, 'anchor', worldX, worldY);
              }}
            />
          </React.Fragment>
        );
      })}
    </>
  ) : null;

  if (vectorShapeData && shapeKind === 'line') {
    const pathD = buildWorldVectorPathD(vectorShapeData, worldX, worldY);
    const vectorPoints = vectorShapeData.points.map((point) => ({
      x: point.x + worldX,
      y: point.y + worldY,
      inX: point.inX + worldX,
      inY: point.inY + worldY,
      outX: point.outX + worldX,
      outY: point.outY + worldY,
    }));
    return (
      <svg
        className="fb-sel-overlay-svg"
        width={svgWidth}
        height={svgHeight}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 10000 }}
      >
        <path
          d={pathD}
          fill="none"
          stroke="rgba(0,0,0,0.001)"
          strokeWidth={Math.max(18 / scale, overlayH + 12 / scale)}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          style={{ cursor: el.locked ? 'default' : 'move' }}
          onMouseDown={(event) => {
            if (el.locked) return;
            event.stopPropagation();
            event.preventDefault();
            onStartMove(event, selection.bpId, el);
          }}
        />
        <path
          d={pathD}
          fill="none"
          stroke={outlineColor}
          strokeWidth={2 / scale}
          vectorEffect="non-scaling-stroke"
          style={{ filter: outlineShadow !== 'transparent' ? `drop-shadow(0 0 ${1 / scale}px ${outlineShadow})` : undefined }}
        />
        {vectorPoints.map((point, index) => (
          <circle
            key={`anchor-${index}`}
            cx={point.x}
            cy={point.y}
            r={(shapeKind === 'line' ? 6 : 5.5) / scale}
            fill={shapeKind === 'line' ? '#fff' : '#3b82f6'}
            stroke={outlineColor}
            strokeWidth={1.5 / scale}
            vectorEffect="non-scaling-stroke"
            pointerEvents={el.locked ? 'none' : 'all'}
            style={{ cursor: el.locked ? 'default' : 'grab' }}
              onMouseDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
                onStartVectorPointDrag(event, selection.bpId, el, index, 'anchor', worldX, worldY);
            }}
          />
        ))}
      </svg>
    );
  }

  return (
    <>
      {guides.map((guide) => (
        <div
          key={guide.key}
          className={`fb-constraint-guide fb-constraint-guide--${guide.key}`}
          style={guide.style}
        />
      ))}
      <div
        className={`fb-sel-overlay${el.componentInstance ? ' fb-sel-overlay--component' : ''}`}
        style={overlayBoxStyle}
        onMouseDown={(e) => {
          if (!overlayCapturesPointer || e.target !== e.currentTarget) return;
          e.stopPropagation();
          e.preventDefault();
          onStartMove(e, selection.bpId, el);
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          e.stopPropagation();
          if (el.componentInstance?.componentId) {
            setSelection({ elementId: el.id, bpId: selection.bpId });
            openComponentEditor(el.componentInstance.componentId);
            return;
          }
          if (canDrill) {
            setDrilledContainerId(el.id);
            setSelection({ elementId: el.id, bpId: selection.bpId });
          }
        }}
      />
      <svg
        className="fb-sel-overlay-svg"
        width={svgWidth}
        height={svgHeight}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 10000 }}
      >
        <polygon
          points={polygonPoints}
          fill="none"
          stroke={outlineColor}
          strokeWidth={2 / scale}
          vectorEffect="non-scaling-stroke"
          style={{ filter: outlineShadow !== 'transparent' ? `drop-shadow(0 0 ${1 / scale}px ${outlineShadow})` : undefined }}
        />
        {edgeResizeLines.map((edge) => (
          <line
            key={`edge-${edge.key}`}
            x1={edge.start.x}
            y1={edge.start.y}
            x2={edge.end.x}
            y2={edge.end.y}
            stroke="rgba(0,0,0,0.001)"
            strokeWidth={16 / scale}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            style={{ cursor: `${edge.handle}-resize` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onStartResize(e, selection.bpId, el, edge.handle, resizePayload);
            }}
          />
        ))}
        {!el.locked && !isDragging && overlayHandles.map((handle) => {
          const point = handlePoints[handle];
          return (
            <rect
              key={handle}
              x={point.x - handleSize / 2}
              y={point.y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={2 / scale}
              ry={2 / scale}
              fill={useComponentSelectionAccent ? 'var(--component-accent)' : '#fff'}
              stroke={outlineColor}
              strokeWidth={1.5 / scale}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
              style={{ cursor: `${handle}-resize` }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartResize(e, selection.bpId, el, handle, resizePayload);
              }}
            />
          );
        })}
        {!el.locked && !isDragging && rotateHandles.map((handle) => {
          const point = rotatePoints[handle];
          return (
            <rect
              key={`rotate-${handle}`}
              x={point.x - rotateHandleSize / 2}
              y={point.y - rotateHandleSize / 2}
              width={rotateHandleSize}
              height={rotateHandleSize}
              fill="rgba(0,0,0,0.001)"
              pointerEvents="all"
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartResize(e, selection.bpId, el, `rotate-${handle}`, resizePayload);
              }}
            />
          );
        })}
        {!el.locked && !isDragging && onStartRadiusDrag && Object.entries(radiusAnchorPoints).map(([corner, point]) => {
          const styleKey = corner === 'all' ? 'borderRadius' : `borderRadius${corner}`;
          const radiusValue = resolved.styles?.[styleKey] ?? resolved.styles?.borderRadius;
          const startRadius = typeof radiusValue === 'number' ? radiusValue : parseFloat(radiusValue) || 0;
          return (
            <circle
              key={`radius-${corner}`}
              cx={point.x}
              cy={point.y}
              r={radiusHandleSize / 2}
              fill="#fff"
              stroke="#3b82f6"
              strokeWidth={1.5 / scale}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
              style={{ cursor: 'crosshair' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartRadiusDrag(e, selection.bpId, el.id, startRadius, corner === 'all' ? null : corner);
              }}
            />
          );
        })}
        {gradientEditor ? (
          <>
            {gradientEditor.type === 'radial' ? (
              <circle
                cx={gradientEditor.center.x}
                cy={gradientEditor.center.y}
                r={gradientEditor.radius}
                fill="none"
                stroke="rgba(59,130,246,0.25)"
                strokeWidth={1.5 / scale}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <line
              x1={gradientEditor.lineStart.x}
              y1={gradientEditor.lineStart.y}
              x2={gradientEditor.lineEnd.x}
              y2={gradientEditor.lineEnd.y}
              stroke="rgba(59,130,246,0.92)"
              strokeWidth={2 / scale}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={`${8 / scale} ${6 / scale}`}
            />
            {gradientEditor.stops.map((stop) => (
              <circle
                key={`gradient-stop-${stop.index}`}
                cx={stop.point.x}
                cy={stop.point.y}
                r={7 / scale}
                fill={stop.color}
                stroke="#fff"
                strokeWidth={2 / scale}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onStartGradientDrag(e, selection.bpId, el, 'stop', {
                    stopIndex: stop.index,
                    lineStart: gradientEditor.lineStart,
                    lineEnd: gradientEditor.lineEnd,
                    overlay: gradientEditor,
                  });
                }}
              />
            ))}
            {[
              { key: 'start', point: gradientEditor.lineStart },
              { key: 'end', point: gradientEditor.lineEnd },
            ].map((handle) => (
              <circle
                key={`gradient-${handle.key}`}
                cx={handle.point.x}
                cy={handle.point.y}
                r={10 / scale}
                fill="#fff"
                stroke="#3b82f6"
                strokeWidth={2 / scale}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
                style={{ cursor: 'grab' }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onStartGradientDrag(
                    e,
                    selection.bpId,
                    el,
                    gradientEditor.type === 'linear'
                      ? `linear-${handle.key}`
                      : (handle.key === 'start' ? 'radial-center' : 'radial-radius'),
                    {
                    center: gradientEditor.center,
                    selectionRotation,
                    worldX,
                    worldY,
                    overlayW,
                    overlayH,
                    lineStart: gradientEditor.lineStart,
                    lineEnd: gradientEditor.lineEnd,
                    radius: gradientEditor.radius,
                    overlay: gradientEditor,
                  }
                  );
                }}
              />
            ))}
          </>
        ) : null}
        {vectorEditingOverlay}
      </svg>
    </>
  );
}

export default function InfiniteCanvas() {
  const containerRef = useRef(null);
  const worldRef     = useRef(null);
  const lastPointerClientRef = useRef({ x: null, y: null });
  const skipNextArtboardClickRef = useRef(false);

  const viewport      = useEditorStore(s => s.viewport);
  const setViewport   = useEditorStore(s => s.setViewport);
  const activeSurface = useEditorStore(s => s.activeSurface);
  const selection     = useEditorStore(s => s.selection);
  const activeVectorPoint = useEditorStore(s => s.activeVectorPoint);
  const componentEditor = useEditorStore(s => s.componentEditor);
  const bpDefs        = useEditorStore(s => s.breakpointDefs);
  const page          = useEditorStore(s => s.getCurrentPage());
  const setSelection  = useEditorStore(s => s.setSelection);
  const setActiveVectorPoint = useEditorStore(s => s.setActiveVectorPoint);
  const clearActiveVectorPoint = useEditorStore(s => s.clearActiveVectorPoint);
  const setArtboardSel = useEditorStore(s => s.setArtboardSel);
  const artboardSel    = useEditorStore(s => s.artboardSel);
  const setDrilled     = useEditorStore(s => s.setDrilledContainerId);
  const addElement          = useEditorStore(s => s.addElement);
  const addElements         = useEditorStore(s => s.addElements);
  const createComponentFromElement = useEditorStore(s => s.createComponentFromElement);
  const insertComponentInstance = useEditorStore(s => s.insertComponentInstance);
  const openComponentEditor = useEditorStore(s => s.openComponentEditor);
  const addComponentVariant = useEditorStore(s => s.addComponentVariant);
  const ensureComponentEditorVariantState = useEditorStore(s => s.ensureComponentEditorVariantState);
  const updateComponentEditorVariantInteraction = useEditorStore(s => s.updateComponentEditorVariantInteraction);
  const deleteElement       = useEditorStore(s => s.deleteElement);
  const reparentElement      = useEditorStore(s => s.reparentElement);
  const setHoveredId         = useEditorStore(s => s.setHoveredId);
  const hoveredId            = useEditorStore(s => s.hoveredId);
  const pushHistory          = useEditorStore(s => s.pushHistory);
  const setInteracting       = useEditorStore(s => s.setInteracting);
  const pendingDraw          = useEditorStore(s => s.pendingDraw);
  const setPendingDraw       = useEditorStore(s => s.setPendingDraw);
  const activeCanvasTool     = useEditorStore(s => s.activeCanvasTool);
  const setActiveCanvasTool  = useEditorStore(s => s.setActiveCanvasTool);
  const clearActiveComment   = useEditorStore(s => s.clearActiveComment);
  const activeComment        = useEditorStore(s => s.getActiveComment());
  const [commentDraft, setCommentDraft] = useState(null);
  const [penDraft, setPenDraft] = useState(null);
  const [penDraftCloseHint, setPenDraftCloseHint] = useState(false);

  // Draw-mode rubber-band preview rect (screen coords)
  const [drawRect, setDrawRect] = useState(null); // { left, top, width, height } in screen px

  // ── Pan state ──────────────────────────────────────────────
  const isPanning  = useRef(false);
  const commentDrag = useRef(null);
  const panOrigin  = useRef({ x: 0, y: 0 });
  const panStart   = useRef({ x: 0, y: 0 });
  const spaceDown  = useRef(false);
  const [spacePanCursor, setSpacePanCursor] = useState(false);
  const [reorderTarget,    setReorderTarget]    = useState(null); // { insertBeforeId, bpId, parentId, dragId }
  const [dropTargetId,     setDropTargetId]     = useState(null); // elementId hovered during a 'move' drag
  const [radiusDragInfo,   setRadiusDragInfo]   = useState(null); // { value, clientX, clientY }
  const [paddingDragInfo,  setPaddingDragInfo]  = useState(null); // { value, side, clientX, clientY }
  const [gapDragInfo,      setGapDragInfo]      = useState(null); // { value, clientX, clientY }
  const [foldDragInfo,     setFoldDragInfo]     = useState(null); // { value, clientX, clientY }
  const [textSizeDragInfo, setTextSizeDragInfo] = useState(null); // { value, clientX, clientY }
  const [dragHint,         setDragHint]         = useState(null); // { label, clientX, clientY }
  const [reorderGhost,     setReorderGhost]     = useState(null); // { worldX, worldY, width, height, bgColor? }
  const [reorderIndicatorOverlay, setReorderIndicatorOverlay] = useState(null); // { left, top, width, height, axis } in client px
  const [dragOverlay,      setDragOverlay]      = useState(null); // { elementId, worldX, worldY, width, height }
  const [gradientDragOverlay, setGradientDragOverlay] = useState(null);
  const [alignmentGuides,  setAlignmentGuides]  = useState([]); // [{ orientation, x?, y?, start, end }]
  const [draggingElementId, setDraggingElementId] = useState(null); // element being dragged (for ghost opacity)
  const [draggingElementBpId, setDraggingElementBpId] = useState(null);
  const [variantRootLayout, setVariantRootLayout] = useState({});
  const [variantConnectionDraft, setVariantConnectionDraft] = useState(null); // { sourceVariantId, clientX, clientY }
  const [variantInteractionModal, setVariantInteractionModal] = useState(null); // { sourceVariantId, targetVariantId, initialInteraction }
  const [contextMenu,      setContextMenu]      = useState(null);
  const [componentModal,   setComponentModal]   = useState(null);
  const clipboard = useRef(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const startCommentDrag = useCallback((event, comment) => {
    if (!comment || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    commentDrag.current = {
      commentId: comment.id ?? null,
      bpId: comment.bpId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: comment.x ?? 0,
      startY: comment.y ?? 0,
      isDraft: !!comment.isDraft,
      moved: false,
    };
    setInteracting(true);
  }, [setInteracting]);

  const submitCommentDraft = useCallback((text) => {
    const body = typeof text === 'string' ? text.trim() : '';
    if (!commentDraft || !body) return;
    const state = useEditorStore.getState();
    const commentId = state.addCommentThread({
      bpId: commentDraft.bpId,
      x: commentDraft.x,
      y: commentDraft.y,
      text: body,
    });
    state.setActiveComment(commentId);
    state.pushHistory();
    setCommentDraft(null);
  }, [commentDraft]);

  const discardCommentDraft = useCallback(() => {
    setCommentDraft(null);
  }, []);

  const discardPenDraft = useCallback(() => {
    setPenDraft(null);
    setPenDraftCloseHint(false);
  }, []);

  const commitPenDraft = useCallback((draft = null) => {
    const currentDraft = draft ?? penDraft;
    if (!currentDraft || !Array.isArray(currentDraft.points) || currentDraft.points.length < 2) {
      setPenDraft(null);
      setPenDraftCloseHint(false);
      return false;
    }
    const isClosed = currentDraft.closed === true && currentDraft.points.length > 2;
    const worldVectorData = { kind: 'path', closed: isClosed, points: currentDraft.points };
    const reframed = reframeVectorShapeData(worldVectorData);
    const bp = useEditorStore.getState().breakpointDefs[currentDraft.bpId];
    if (!bp) {
      setPenDraft(null);
      setPenDraftCloseHint(false);
      return false;
    }
    const pageLayout = resolvePageLayout(useEditorStore.getState().getCurrentPage()?.layout, currentDraft.bpId);
    const pagePadding = resolvePagePadding(useEditorStore.getState().getCurrentPage()?.padding, currentDraft.bpId);
    const localX = Math.round(reframed.offsetX - bp.x - (pageLayout ? 0 : (pagePadding?.left ?? 0)));
    const localY = Math.round(reframed.offsetY - bp.y - (pageLayout ? 0 : (pagePadding?.top ?? 0)));
    const element = createShapePreset('pen', localX, localY);
    if (pageLayout) {
      element.base.positionType = 'absolute';
      element.base.absoluteInLayout = true;
    }
    element.base.width = reframed.width;
    element.base.height = reframed.height;
    element.base.vectorData = reframed.vectorData;
    element.base.svgMarkup = buildVectorShapeSvgMarkup(reframed.vectorData, {
      width: reframed.width,
      height: reframed.height,
      fill: isClosed && typeof element.base.styles?.backgroundColor === 'string' && !element.base.styles.backgroundColor.includes('gradient(')
        ? element.base.styles.backgroundColor
        : 'none',
      stroke: element.base.styles?.strokeColor ?? '#2563eb',
      strokeWidth: Math.max(0.5, element.base.styles?.strokeWidth || 1.5),
    });
    addElement(element, null, currentDraft.bpId);
    useEditorStore.getState().setSelection({ elementId: element.id, bpId: currentDraft.bpId });
    setPenDraft(null);
    setPenDraftCloseHint(false);
    pushHistory();
    setPendingDraw(null);
    setActiveCanvasTool('select');
    return true;
  }, [addElement, penDraft, pushHistory, setActiveCanvasTool, setPendingDraw]);

  const resolvePenDraftCloseIntent = useCallback((draft, bpId, worldX, worldY, scaleValue) => {
    if (!draft || draft.bpId !== bpId || !Array.isArray(draft.points) || draft.points.length < 3) return false;
    const firstPoint = draft.points[0];
    if (!firstPoint) return false;
    const threshold = PEN_CLOSE_SNAP_PX / Math.max(scaleValue || 1, MIN_SCALE);
    return Math.hypot(worldX - firstPoint.x, worldY - firstPoint.y) <= threshold;
  }, []);

  useEffect(() => {
    if (!selection?.elementId || !selection?.bpId) {
      setGradientDragOverlay(null);
      return;
    }
    setGradientDragOverlay((prev) => {
      if (!prev) return null;
      return prev.elementId === selection.elementId && prev.bpId === selection.bpId ? prev : null;
    });
  }, [selection?.bpId, selection?.elementId]);
  const resolveVariantRootAtClientPoint = useCallback((clientX, clientY, { excludeVariantId = null } = {}) => {
    const container = containerRef.current;
    if (!container || activeSurface !== 'component') return null;

    const elementIndex = new Map((componentEditor.page?.elements ?? []).map((element) => [element.id, element]));
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      if (!container.contains(node)) continue;
      if (node.closest('.fb-context-menu, .fb-right, .fb-left, .fb-topbar, .fb-overlay-modal, .fb-shadow-popup, .fb-fill-popover')) return null;
      const target = node.closest?.('[data-id]');
      if (!target || !container.contains(target)) continue;

      let cursor = elementIndex.get(target.dataset.id ?? '') ?? null;
      while (cursor?.parentId) {
        cursor = elementIndex.get(cursor.parentId) ?? null;
      }
      if (!cursor?.componentRoot || !cursor?.componentEditorVariantId) continue;
      if (cursor.componentEditorVariantId === excludeVariantId) continue;

      const layout = variantRootLayout[cursor.componentEditorVariantId] ?? null;
      if (!layout || layout.mode !== 'default') continue;
      return layout;
    }

    return null;
  }, [activeSurface, componentEditor.page?.elements, variantRootLayout]);

  const openVariantInteractionModal = useCallback((sourceVariantId, targetVariantId) => {
    if (!sourceVariantId || !targetVariantId) return;
    const sourceVariant = (componentEditor.variants ?? []).find((variant) => variant.id === sourceVariantId) ?? null;
    if (!sourceVariant) return;

    setVariantInteractionModal({
      sourceVariantId,
      targetVariantId,
      initialInteraction: sourceVariant?.interaction?.targetVariantId === targetVariantId
        ? {
            targetVariantId,
            trigger: sourceVariant.interaction.trigger,
            delay: sourceVariant.interaction.delay ?? 0,
            transition: sourceVariant.interaction.transition ?? null,
          }
        : {
            targetVariantId,
            trigger: sourceVariant.interaction?.trigger ?? 'click',
            delay: sourceVariant.interaction?.targetVariantId ? (sourceVariant.interaction.delay ?? 0) : 0,
            transition: sourceVariant.interaction?.transition ?? null,
          },
    });
  }, [componentEditor.variants]);

  useEffect(() => {
    if (!selection && drag.current?.type?.startsWith?.('gradient-linear')) {
      drag.current = null;
      setDragHint(null);
      setInteracting(false);
    }
  }, [selection, setInteracting]);

  useLayoutEffect(() => {
    if (!reorderTarget?.bpId) {
      setReorderIndicatorOverlay(null);
      return;
    }

    const st = useEditorStore.getState();
    const artboardDom = document.querySelector(`.fb-artboard[data-bp="${reorderTarget.bpId}"]`);
    const parentDom = reorderTarget.parentId
      ? artboardDom?.querySelector(`[data-id="${reorderTarget.parentId}"]`)
      : artboardDom?.querySelector('.fb-artboard-content');

    if (!artboardDom || !parentDom) {
      setReorderIndicatorOverlay(null);
      return;
    }

    const parentRect = parentDom.getBoundingClientRect();
    if (!parentRect) {
      setReorderIndicatorOverlay(null);
      return;
    }

    const siblingIds = getSiblingIds(st.getAllElements(), reorderTarget.parentId, reorderTarget.dragId);
    const siblingNodes = siblingIds
      .map((id) => ({ id, node: artboardDom.querySelector(`[data-id="${id}"]`) }))
      .filter((entry) => entry.node);
    const axis = getFlexAxis(parentDom);
    const thickness = 3;
    const insertIndex = reorderTarget.insertBeforeId
      ? siblingNodes.findIndex((entry) => entry.id === reorderTarget.insertBeforeId)
      : siblingNodes.length;

    const beforeNode = insertIndex > 0 ? siblingNodes[insertIndex - 1]?.node : null;
    const beforeRect = beforeNode ? beforeNode.getBoundingClientRect() : null;
    const targetNode = reorderTarget.insertBeforeId
      ? siblingNodes.find((entry) => entry.id === reorderTarget.insertBeforeId)?.node ?? null
      : null;
    const targetRect = targetNode ? targetNode.getBoundingClientRect() : null;

    if (axis === 'x') {
      const left = targetRect
        ? targetRect.left - (thickness / 2)
        : beforeRect
          ? beforeRect.right - (thickness / 2)
          : parentRect.left - (thickness / 2);
      setReorderIndicatorOverlay({
        left,
        top: parentRect.top,
        width: thickness,
        height: Math.max(parentRect.height, 16),
        axis,
      });
      return;
    }

    const top = targetRect
      ? targetRect.top - (thickness / 2)
      : beforeRect
        ? beforeRect.bottom - (thickness / 2)
        : parentRect.top - (thickness / 2);
    setReorderIndicatorOverlay({
      left: parentRect.left,
      top,
      width: Math.max(parentRect.width, 16),
      height: thickness,
      axis,
    });
  }, [reorderTarget, viewport.scale]);

  useLayoutEffect(() => {
    if (activeSurface !== 'component' || !componentEditor?.isOpen) {
      setVariantRootLayout({});
      return;
    }

    const boardDom = document.querySelector('.fb-artboard[data-bp="desktop"]');
    const roots = (componentEditor.page?.elements ?? []).filter((el) => !el.parentId && el.componentRoot);
    if (!boardDom || !roots.length) {
      setVariantRootLayout({});
      return;
    }

    const nextLayout = {};
    const variantIndex = new Map((componentEditor.variants ?? []).map((variant) => [variant.id, variant]));
    roots.forEach((root) => {
      const node = boardDom.querySelector(`[data-id="${root.id}"]`);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const currentBp = useEditorStore.getState().breakpointDefs.desktop;
      const currentScale = useEditorStore.getState().viewport.scale ?? 1;
      const boardRect = boardDom.getBoundingClientRect();
      const left = currentBp.x + (rect.left - boardRect.left) / currentScale;
      const top = currentBp.y + (rect.top - boardRect.top) / currentScale;
      const width = rect.width / currentScale;
      const height = rect.height / currentScale;
      const centerY = top + (height / 2);
      const connectorX = left + width;
      const from = { x: connectorX, y: centerY };
      const to = { x: left, y: centerY };
      const variantMeta = variantIndex.get(root.componentEditorVariantId) ?? null;
      nextLayout[root.componentEditorVariantId] = {
        variantId: root.componentEditorVariantId,
        rootId: root.id,
        name: root.componentVariantName || 'Primary',
        mode: variantMeta?.mode ?? root.componentVariantMode ?? 'default',
        parentVariantId: variantMeta?.parentVariantId ?? root.componentVariantParentId ?? null,
        rect,
        worldRect: {
          left,
          top,
          width,
          height,
        },
        from,
        to,
        connector: from,
      };
    });
    setVariantRootLayout(nextLayout);
  }, [activeSurface, componentEditor?.isOpen, componentEditor?.page?.elements, componentEditor?.variants, viewport.x, viewport.y, viewport.scale, componentEditor?.activeVariantId]);

  useEffect(() => {
    if (!variantConnectionDraft) return undefined;

    const handleMove = (e) => {
      setVariantConnectionDraft((current) => (current
        ? { ...current, clientX: e.clientX, clientY: e.clientY }
        : current));
    };

    const handleUp = (e) => {
      setVariantConnectionDraft((current) => {
        if (!current) return current;
        const target = resolveVariantRootAtClientPoint(e.clientX, e.clientY, { excludeVariantId: current.sourceVariantId });

        if (target) {
          openVariantInteractionModal(current.sourceVariantId, target.variantId);
        }

        return null;
      });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [openVariantInteractionModal, resolveVariantRootAtClientPoint, variantConnectionDraft]);

  const canPasteIntoFrame = useCallback((bpId = null, elementId = null) => {
    if (!clipboard.current) return false;
    const st = useEditorStore.getState();
    const resolvedBpId = bpId || st.selection?.bpId || clipboard.current.bpId || 'desktop';
    const candidateId = elementId ?? st.selection?.elementId ?? null;
    if (!candidateId) return false;
    const candidate = st.getAllElements().find((el) => el.id === candidateId) ?? null;
    if (!candidate || candidate.type !== 'frame') return false;
    const resolved = resolveElement(candidate, resolvedBpId);
    return !resolved.hidden;
  }, []);

  const copyElementToClipboard = useCallback((elementId, bpId) => {
    if (!elementId) return false;
    const allEls = useEditorStore.getState().getAllElements();
    const rootEl = allEls.find(el => el.id === elementId);
    if (!rootEl) return false;
    const subtree = [];
    const collectSubtree = (id) => {
      const elem = allEls.find(el => el.id === id);
      if (!elem) return;
      subtree.push(elem);
      (elem.children ?? []).forEach(collectSubtree);
    };
    collectSubtree(rootEl.id);
    clipboard.current = { subtree, rootId: rootEl.id, bpId };
    return true;
  }, []);

  const cutElementToClipboard = useCallback((elementId, bpId) => {
    if (!copyElementToClipboard(elementId, bpId)) return false;
    deleteElement(elementId);
    pushHistory();
    return true;
  }, [copyElementToClipboard, deleteElement, pushHistory]);

  // ── Drag state ─────────────────────────────────────────────
  const drag = useRef(null);
  // drag.current shape:
  // { type:'element-drag'|'resize'|'artboard-move', bpId, elementId?, handle?,
  //   startMX, startMY, startX?, startY?, startW?, startH?, startBpX?, startBpY? }

  const getProjectedWorldPoint = useCallback((clientX, clientY, grabOffsetWorldX = 0, grabOffsetWorldY = 0) => {
    const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
    const containerRect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      worldX: (clientX - containerRect.left - panX) / scale - grabOffsetWorldX,
      worldY: (clientY - containerRect.top - panY) / scale - grabOffsetWorldY,
    };
  }, []);

  const getPlacementFromClient = useCallback((clientX, clientY, bpHint = null) => {
    if (clientX == null || clientY == null) return null;
    const st = useEditorStore.getState();
    const { worldX, worldY } = getProjectedWorldPoint(clientX, clientY, 0, 0);
    const bpList = Object.values(st.breakpointDefs);
    const hintedBp = bpHint ? st.breakpointDefs[bpHint] ?? null : null;
    const containingBp = bpList.find((bp) => (
      worldX >= bp.x && worldX <= bp.x + bp.width &&
      worldY >= bp.y && worldY <= bp.y + bp.height
    )) ?? null;
    const bp = containingBp ?? hintedBp ?? st.breakpointDefs[st.selection?.bpId ?? ''] ?? st.breakpointDefs.desktop ?? bpList[0] ?? null;
    if (!bp) return null;
    const page = st.getCurrentPage?.();
    const pad = resolvePagePadding(page?.padding, bp.id);
    return {
      bpId: bp.id,
      worldX,
      worldY,
      x: Math.round(worldX - bp.x - (pad?.left ?? 0)),
      y: Math.round(worldY - bp.y - (pad?.top ?? 0)),
    };
  }, [getProjectedWorldPoint]);

  const getParentPlacementFromClient = useCallback((clientX, clientY, bpId, parentId) => {
    if (clientX == null || clientY == null || !bpId || !parentId) return null;
    const { scale } = useEditorStore.getState().viewport;
    const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
    const parentDom = boardDom?.querySelector(`[data-id="${parentId}"]`) ?? null;
    if (!parentDom) return null;
    const rect = parentDom.getBoundingClientRect();
    return {
      x: Math.round((clientX - rect.left - parentDom.clientLeft) / scale),
      y: Math.round((clientY - rect.top - parentDom.clientTop) / scale),
    };
  }, []);

  const pasteClipboardAt = useCallback(({ bpId = null, parentId = null, x = null, y = null, clientX = null, clientY = null }) => {
    if (!clipboard.current) return false;
    const st = useEditorStore.getState();
    const { subtree, rootId, bpId: copiedBpId } = clipboard.current;
    const targetBpId = bpId || st.selection?.bpId || copiedBpId || 'desktop';
    const selectedEl = st.getSelectedElement?.() ?? null;
    const activeSelectedFrameId = selectedEl && selectedEl.type === 'frame' && st.selection?.bpId === targetBpId
      ? selectedEl.id
      : null;
    const targetParentId = parentId ?? activeSelectedFrameId ?? null;
    if (!targetParentId) return false;
    const cursorPlacement = getPlacementFromClient(
      clientX ?? lastPointerClientRef.current.x,
      clientY ?? lastPointerClientRef.current.y,
      targetBpId,
    );
    const parentPlacement = targetParentId
      ? getParentPlacementFromClient(
          clientX ?? lastPointerClientRef.current.x,
          clientY ?? lastPointerClientRef.current.y,
          targetBpId,
          targetParentId,
        )
      : null;
    const targetX = parentPlacement?.x ?? cursorPlacement?.x ?? x ?? 20;
    const targetY = parentPlacement?.y ?? cursorPlacement?.y ?? y ?? 20;
    const cloned = cloneSubtree(subtree, rootId).map((el) => {
      if (targetBpId === 'desktop') return el;
      return {
        ...el,
        base: { ...el.base, hidden: true },
        overrides: {
          ...el.overrides,
          [targetBpId]: {
            ...(el.overrides?.[targetBpId] ?? {}),
            hidden: false,
          },
        },
      };
    });
    const root = cloned[0];
    if (!root) return false;
    if (targetBpId === 'desktop') {
      root.base = { ...root.base, x: targetX, y: targetY };
    } else {
      root.overrides = {
        ...root.overrides,
        [targetBpId]: {
          ...(root.overrides?.[targetBpId] ?? {}),
          x: targetX,
          y: targetY,
          hidden: false,
        },
      };
    }
    addElements(cloned);
    if (targetParentId) {
      st.reparentElement(root.id, targetParentId);
    }
    useEditorStore.getState().setSelection({ elementId: root.id, bpId: targetBpId });
    pushHistory();
    return true;
  }, [addElements, getParentPlacementFromClient, getPlacementFromClient, pushHistory]);

  const pasteSvgMarkupAt = useCallback(({ markup, clientX = null, clientY = null, bpId = null }) => {
    const sanitizedMarkup = sanitizeSvgMarkup(extractSvgMarkup(markup), { forceCurrentColor: false });
    if (!sanitizedMarkup) return false;
    const placement = getPlacementFromClient(
      clientX ?? lastPointerClientRef.current.x,
      clientY ?? lastPointerClientRef.current.y,
      bpId,
    );
    if (!placement) return false;

    const icon = createIcon(placement.x, placement.y);
    const size = getSvgViewBoxSize(sanitizedMarkup);
    icon.base.iconSource = 'custom';
    icon.base.iconName = 'custom-svg';
    icon.base.svgMarkup = sanitizedMarkup;
    icon.base.width = size.width;
    icon.base.height = size.height;
    addElement(icon, null, placement.bpId);
    useEditorStore.getState().setSelection({ elementId: icon.id, bpId: placement.bpId });
    setArtboardSel(null);
    pushHistory();
    return true;
  }, [addElement, getPlacementFromClient, pushHistory, setArtboardSel]);

  const importTeleportPayloadAt = useCallback(({ payload, clientX = null, clientY = null }) => {
    if (!payload?.nodes?.length) return false;
    const state = useEditorStore.getState();
    const fallbackBpId = state.selection?.bpId ?? 'desktop';
    const placement = getPlacementFromClient(
      clientX ?? lastPointerClientRef.current.x,
      clientY ?? lastPointerClientRef.current.y,
      fallbackBpId,
    ) ?? { bpId: fallbackBpId, x: 40, y: 40 };

    const { importedElements, rootIds } = importTeleportNodes(payload.nodes, {
      x: placement.x,
      y: placement.y,
    });
    if (!importedElements.length || !rootIds.length) return false;

    if (placement.bpId !== 'desktop') {
      importedElements.forEach((element) => {
        const nextOverrides = {
          ...(element.overrides ?? {}),
          [placement.bpId]: {
            ...(element.overrides?.[placement.bpId] ?? {}),
            hidden: false,
          },
        };
        if (rootIds.includes(element.id)) {
          nextOverrides[placement.bpId] = {
            ...nextOverrides[placement.bpId],
            x: element.base.x,
            y: element.base.y,
          };
        }
        element.overrides = nextOverrides;
        element.base.hidden = true;
      });
    }

    mergeTeleportStylesIntoAssets(payload);
    addElements(importedElements);
    useEditorStore.getState().setSelection({ elementId: rootIds[0], bpId: placement.bpId });
    setArtboardSel(null);
    pushHistory();
    return true;
  }, [addElements, getPlacementFromClient, pushHistory, setArtboardSel]);

  const resolveHoveredElementId = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return null;
    if (variantConnectionDraft) {
      const eligibleRoot = resolveVariantRootAtClientPoint(clientX, clientY, { excludeVariantId: variantConnectionDraft.sourceVariantId });
      return eligibleRoot?.rootId ?? null;
    }
    const topNode = document.elementFromPoint(clientX, clientY);
    if (!topNode || !container.contains(topNode)) return null;
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      if (!container.contains(node)) continue;
      if (node.closest('.fb-context-menu, .fb-right, .fb-left, .fb-topbar, .fb-overlay-modal, .fb-shadow-popup, .fb-fill-popover')) return null;
      const target = node.closest?.('[data-id]');
      if (!target || !container.contains(target)) continue;
      return target.dataset.id ?? null;
    }
    return null;
  }, [resolveVariantRootAtClientPoint, variantConnectionDraft]);

  const resolveElementDragDrop = useCallback((session, clientX, clientY) => {
    const st = useEditorStore.getState();
    const allEls = st.getAllElements();
    const draggedEl = allEls.find(el => el.id === session.elementId);
    if (!draggedEl) return null;

    const bp = st.breakpointDefs[session.bpId];
    if (!bp) return null;

    const page = st.getCurrentPage?.();
    const pagePadding = resolvePagePadding(page?.padding, session.bpId);
    const pageLayout = resolvePageLayout(page?.layout, session.bpId);
    const artboardDom = document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`);
    const artboardRect = artboardDom?.getBoundingClientRect() ?? null;
    const { scale } = st.viewport;
    const { worldX: projectedWorldX, worldY: projectedWorldY } = getDragSessionWorldPosition(session, clientX, clientY, getProjectedWorldPoint);

    const projectedClientW = session.ghostClientW ?? ((session.ghostW ?? 100) * scale);
    const projectedClientH = session.ghostClientH ?? ((session.ghostH ?? 40) * scale);
    const clientLeft = clientX - (session.grabOffsetClientX ?? projectedClientW / 2);
    const clientTop = clientY - (session.grabOffsetClientY ?? projectedClientH / 2);
    const clientRight = clientLeft + projectedClientW;
    const clientBottom = clientTop + projectedClientH;
    let worldX = projectedWorldX;
    let worldY = projectedWorldY;

    const overlapRatioWithRect = (rect) => {
      if (!rect) return 0;
      const overlapW = Math.max(0, Math.min(clientRight, rect.right) - Math.max(clientLeft, rect.left));
      const overlapH = Math.max(0, Math.min(clientBottom, rect.bottom) - Math.max(clientTop, rect.top));
      return (overlapW * overlapH) / Math.max(1, projectedClientW * projectedClientH);
    };

    const pointerInsideArtboard = !!artboardRect
      && clientX >= artboardRect.left
      && clientX <= artboardRect.right
      && clientY >= artboardRect.top
      && clientY <= artboardRect.bottom;
    const treatAsFlowDrag = session.origWasFlow || session.dragMode === 'flow' || session.origPositionType === 'relative' || session.origPositionType === 'sticky';
    const offCanvas = treatAsFlowDrag
      ? !pointerInsideArtboard
      : (!artboardRect || overlapRatioWithRect(artboardRect) < 0.35);
    const descendants = collectDescendantIds(allEls, session.elementId);
    let dropContainer = null;
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      const dataId = node.dataset?.id;
      if (!dataId || descendants.has(dataId)) continue;
      const candidate = allEls.find(el => el.id === dataId);
      if (!candidate || candidate.type !== 'frame') continue;
      const componentContainer = st.activeSurface === 'page'
        ? getComponentInstanceAncestor(allEls, candidate)
        : null;
      if (componentContainer) continue;
      const resolvedCandidate = candidate;
      if (descendants.has(resolvedCandidate.id)) continue;
      const candidateResolved = resolveElement(resolvedCandidate, session.bpId);
      if (candidateResolved.hidden) continue;
      dropContainer = resolvedCandidate;
      break;
    }

    const containerResolved = dropContainer ? resolveElement(dropContainer, session.bpId) : null;
    const containerIsFlex = containerResolved?.styles?.display === 'flex';
    const wasRootLevel = session.origParentId == null;
    const canRootFlow = !!pageLayout
      && session.origPositionType !== 'fixed'
      && wasRootLevel
      && (session.origWasFlow || session.origWasOffCanvas || session.dragMode === 'flow');

    let mode = 'root-free';
    let targetParentId = null;
    if (session.origPositionType === 'fixed') {
      mode = 'fixed-root';
    } else if (offCanvas) {
      mode = 'offcanvas';
    } else if (dropContainer) {
      targetParentId = dropContainer.id;
      mode = containerIsFlex ? 'container-flow' : 'container-free';
    } else if (canRootFlow) {
      mode = 'root-flow';
    }

    let reorderTarget = null;
    let insertBeforeId = null;
    let snappedWorldX = worldX;
    let snappedWorldY = worldY;
    let alignmentGuideData = [];
    if (mode === 'root-flow' || mode === 'container-flow') {
      const reorderParentId = mode === 'container-flow' ? targetParentId : null;
      const siblingIds = getSiblingIds(allEls, reorderParentId, session.elementId);
      const parentDom = reorderParentId ? artboardDom?.querySelector(`[data-id="${reorderParentId}"]`) : artboardDom;
      const axis = reorderParentId
        ? ((containerResolved?.styles?.flexDirection ?? 'column') === 'row' ? 'x' : 'y')
        : ((pageLayout?.flexDirection ?? 'column') === 'row' ? 'x' : 'y');
      insertBeforeId = getInsertBeforeIdFromDom(parentDom, siblingIds, clientX, clientY, axis);
      reorderTarget = {
        insertBeforeId,
        bpId: session.bpId,
        parentId: reorderParentId,
        dragId: session.elementId,
      };
    } else if (!session.hasRotation) {
      const snapParentId = mode === 'container-free' ? targetParentId : null;
      const snapSiblingIds = getSiblingIds(allEls, snapParentId, session.elementId);
      const snapParentDom = snapParentId ? artboardDom?.querySelector(`[data-id="${snapParentId}"]`) : artboardDom;
      const draggedRect = {
        left: worldX,
        top: worldY,
        width: session.ghostW ?? 100,
        height: session.ghostH ?? 40,
        right: worldX + (session.ghostW ?? 100),
        bottom: worldY + (session.ghostH ?? 40),
        centerX: worldX + (session.ghostW ?? 100) / 2,
        centerY: worldY + (session.ghostH ?? 40) / 2,
      };
      let bestSnapX = null;
      let bestSnapY = null;
      for (const siblingId of snapSiblingIds) {
        const node = snapParentDom?.querySelector(`[data-id="${siblingId}"]`);
        const siblingRect = getNodeWorldRect(node, artboardDom, bp, scale);
        if (!siblingRect) continue;
        const xPairs = [
          { target: siblingRect.left, source: draggedRect.left },
          { target: siblingRect.centerX, source: draggedRect.centerX },
          { target: siblingRect.right, source: draggedRect.right },
        ];
        const yPairs = [
          { target: siblingRect.top, source: draggedRect.top },
          { target: siblingRect.centerY, source: draggedRect.centerY },
          { target: siblingRect.bottom, source: draggedRect.bottom },
        ];
        for (const pair of xPairs) {
          const delta = pair.target - pair.source;
          const distancePx = Math.abs(delta) * scale;
          if (distancePx > SNAP_THRESHOLD_PX) continue;
          if (!bestSnapX || distancePx < bestSnapX.distancePx) {
            bestSnapX = {
              delta,
              distancePx,
              guide: {
                orientation: 'vertical',
                x: pair.target,
                start: Math.min(draggedRect.top, siblingRect.top),
                end: Math.max(draggedRect.bottom, siblingRect.bottom),
              },
            };
          }
        }
        for (const pair of yPairs) {
          const delta = pair.target - pair.source;
          const distancePx = Math.abs(delta) * scale;
          if (distancePx > SNAP_THRESHOLD_PX) continue;
          if (!bestSnapY || distancePx < bestSnapY.distancePx) {
            bestSnapY = {
              delta,
              distancePx,
              guide: {
                orientation: 'horizontal',
                y: pair.target,
                start: Math.min(draggedRect.left, siblingRect.left),
                end: Math.max(draggedRect.right, siblingRect.right),
              },
            };
          }
        }
      }
      if (bestSnapX) {
        snappedWorldX += bestSnapX.delta;
        alignmentGuideData.push(bestSnapX.guide);
      }
      if (bestSnapY) {
        snappedWorldY += bestSnapY.delta;
        alignmentGuideData.push(bestSnapY.guide);
      }
    }

    return {
      bp,
      pagePadding,
      pageLayout,
      artboardDom,
      artboardRect,
      dropContainer,
      targetParentId,
      mode,
      insertBeforeId,
      reorderTarget,
      alignmentGuides: alignmentGuideData,
      dropTargetId: dropContainer?.id ?? null,
      hint: mode === 'root-flow' || mode === 'container-flow' ? 'Auto' : 'Free',
      clientLeft,
      clientTop,
      worldX: snappedWorldX,
      worldY: snappedWorldY,
      ghost: {
        worldX: snappedWorldX,
        worldY: snappedWorldY,
        width: session.ghostW ?? 100,
        height: session.ghostH ?? 40,
        bgColor: session.ghostBgColor,
        rotation: session.rotation ?? 0,
      },
    };
  }, [getProjectedWorldPoint]);

  const commitVectorShapeData = useCallback((elementId, bpId, resolvedElement, nextVectorData) => {
    const reframed = reframeVectorShapeData(nextVectorData);
    const shapeKind = getShapePresetKind(resolvedElement);
    const strokeColor = resolvedElement?.styles?.strokeColor ?? resolvedElement?.styles?.color ?? (shapeKind === 'line' ? '#111827' : '#2563eb');
    const strokeWidth = Math.max(0.5, resolvedElement?.styles?.strokeWidth || (shapeKind === 'line' ? 2 : 1.5));
    const fillValue = reframed.vectorData.kind !== 'line' && reframed.vectorData.closed && typeof resolvedElement?.styles?.backgroundColor === 'string' && !resolvedElement.styles.backgroundColor.includes('gradient(')
      ? resolvedElement.styles.backgroundColor
      : 'none';
    useEditorStore.getState().updateElementLayout(elementId, bpId, {
      ...(Number.isFinite(resolvedElement?.x) ? { x: resolvedElement.x } : {}),
      ...(Number.isFinite(resolvedElement?.y) ? { y: resolvedElement.y } : {}),
      ...(typeof resolvedElement?.positionType === 'string' ? { positionType: resolvedElement.positionType } : {}),
      ...(resolvedElement?.absoluteInLayout != null ? { absoluteInLayout: resolvedElement.absoluteInLayout } : {}),
      width: reframed.width,
      height: reframed.height,
      vectorData: reframed.vectorData,
      svgMarkup: buildVectorShapeSvgMarkup(reframed.vectorData, {
        width: reframed.width,
        height: reframed.height,
        fill: fillValue,
        stroke: strokeColor,
        strokeWidth,
      }),
    });
    return reframed;
  }, []);

  // ── Keyboard ───────────────────────────────────────────────
  useEffect(() => {
    const handlePointerDown = () => setContextMenu(null);
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const isEditableTarget = e.target.matches('input,textarea') || e.target.isContentEditable;
      if (!isEditableTarget && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useEditorStore.getState().setPendingDraw('frame');
        return;
      }
      if (!isEditableTarget && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        useEditorStore.getState().setActiveCanvasTool('pan');
        return;
      }
      if (!isEditableTarget && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        useEditorStore.getState().setActiveCanvasTool('comment');
        return;
      }
      if (e.code === 'Space' && !e.target.matches('input,textarea')) {
        e.preventDefault();
        spaceDown.current = true;
        setSpacePanCursor(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      }
      // Escape: cancel draw mode first, then move one level up in drill mode.
      if (e.key === 'Escape' && !isEditableTarget) {
        const st = useEditorStore.getState();
        if (penDraft) {
          if (!commitPenDraft({ ...penDraft, closed: false })) {
            setPenDraft(null);
            setPenDraftCloseHint(false);
            st.setPendingDraw(null);
            st.setActiveCanvasTool('select');
          }
          return;
        }
        if (st.pendingDraw) {
          st.setPendingDraw(null);
          return;
        }
        if (st.activeCanvasTool === 'comment' || st.activeCanvasTool === 'pan') {
          st.setActiveCanvasTool('select');
          st.clearActiveComment();
          setCommentDraft(null);
          return;
        }
        const drilled = st.drilledContainerId;
        if (drilled !== null) {
          const drilledEl = st.getAllElements().find(el => el.id === drilled);
          const parentId = drilledEl?.parentId ?? null;
          st.setDrilledContainerId(parentId);
        }
      }
      if (e.key === 'Enter' && !isEditableTarget && penDraft) {
        e.preventDefault();
        commitPenDraft({ ...penDraft, closed: false });
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget) {
        const vectorPoint = useEditorStore.getState().activeVectorPoint;
        const liveSelection = useEditorStore.getState().selection;
        if (vectorPoint?.elementId && Number.isInteger(vectorPoint.pointIndex)) {
          const vectorEl = useEditorStore.getState().getAllElements().find((entry) => entry.id === vectorPoint.elementId) ?? null;
          if (vectorEl && liveSelection?.bpId === vectorPoint.bpId) {
            e.preventDefault();
            const resolvedVectorEl = resolveElement(vectorEl, vectorPoint.bpId);
            const vectorData = getVectorShapeData(resolvedVectorEl) || getVectorShapeData(vectorEl);
            if (vectorData) {
              const removal = removeVectorAnchor(vectorData, vectorPoint.pointIndex);
              if (removal.removed) {
                commitVectorShapeData(vectorPoint.elementId, vectorPoint.bpId, resolvedVectorEl, removal.vectorData);
                const nextIndex = Math.max(0, Math.min(vectorPoint.pointIndex - 1, removal.vectorData.points.length - 1));
                if (removal.vectorData.points.length > 0) setActiveVectorPoint({ elementId: vectorPoint.elementId, bpId: vectorPoint.bpId, pointIndex: nextIndex });
                else clearActiveVectorPoint();
                pushHistory();
                return;
              }
            }
          }
        }
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        const allSelected = useEditorStore.getState().getSelectedElements().filter((el) => !el.locked);
        if (!allSelected.length) return;
        e.preventDefault();
        useEditorStore.getState().deleteElements(allSelected.map((el) => el.id));
        pushHistory();
        return;
      }
      // Arrow nudge (1px, or 10px with Shift)
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        e.preventDefault();
        const selectedElements = useEditorStore.getState().getSelectedElements().filter((el) => !el.locked);
        if (!selectedElements.length) return;
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
        selectedElements.forEach((nudgeEl) => {
          const nudgeRes = resolveElement(nudgeEl, selection.bpId);
          if (nudgeRes.positionType === 'relative' || nudgeRes.positionType === 'sticky') return;
          useEditorStore.getState().updateElementLayout(nudgeEl.id, selection.bpId, {
            x: (nudgeRes.x ?? 0) + dx,
            y: (nudgeRes.y ?? 0) + dy,
          });
        });
        useEditorStore.getState().pushHistory();
      }
      // Copy (Cmd/Ctrl+C)
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        copyElementToClipboard(selection.elementId, selection.bpId);
      }
      // Cut (Cmd/Ctrl+X)
      if ((e.metaKey || e.ctrlKey) && e.key === 'x' && !isEditableTarget) {
        const { selection } = useEditorStore.getState();
        if (!selection) return;
        cutElementToClipboard(selection.elementId, selection.bpId);
      }
    };
    const onPaste = (e) => {
      const target = e.target;
      const isEditablePasteTarget = target?.matches?.('input,textarea') || target?.isContentEditable;
      if (isEditablePasteTarget) return;

      const clipboardData = e.clipboardData;
      const plainText = clipboardData?.getData('text/plain') ?? '';
      const teleportPayload = parseTeleportClipboardPayload(plainText);
      if (teleportPayload) {
        if (importTeleportPayloadAt({ payload: teleportPayload, clientX: lastPointerClientRef.current.x, clientY: lastPointerClientRef.current.y })) {
          e.preventDefault();
        }
        return;
      }

      const htmlText = clipboardData?.getData('text/html') ?? '';
      const svgMarkup = extractSvgMarkup(plainText) || extractSvgMarkup(htmlText);

      if (svgMarkup) {
        if (pasteSvgMarkupAt({ markup: svgMarkup, clientX: lastPointerClientRef.current.x, clientY: lastPointerClientRef.current.y })) {
          e.preventDefault();
        }
        return;
      }

      if (!clipboard.current) return;
      const currentBpId = useEditorStore.getState().selection?.bpId ?? clipboard.current.bpId;
      if (!canPasteIntoFrame(currentBpId)) return;
      e.preventDefault();
      pasteClipboardAt({
        bpId: currentBpId,
        clientX: lastPointerClientRef.current.x,
        clientY: lastPointerClientRef.current.y,
      });
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        setSpacePanCursor(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [canPasteIntoFrame, commitPenDraft, copyElementToClipboard, cutElementToClipboard, deleteElement, importTeleportPayloadAt, pasteClipboardAt, pasteSvgMarkupAt, penDraft, pushHistory]);

  // ── Initial fit-to-canvas ─────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    // All artboards total width
    const bps = Object.values(bpDefs);
    const totalW = bps.reduce((sum, b, i) => sum + b.width + (i < bps.length - 1 ? 100 : 0), 0) + 200;
    const totalH = Math.max(...bps.map(b => b.height)) + 280;
    const scaleX = (width - 60) / totalW;
    const scaleY = (height - 60) / totalH;
    const scale  = Math.min(scaleX, scaleY, 0.9);
    const worldW = totalW * scale;
    const worldH = totalH * scale;
    setViewport({ x: (width - worldW) / 2, y: (height - worldH) / 2 + 20, scale });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wheel (zoom + pan) ─────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // Zoom towards pointer
      setViewport((vp) => {
        const factor   = e.deltaY > 0 ? 0.92 : 1.08;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * factor));
        const ratio    = newScale / vp.scale;
        return {
          x: mx - (mx - vp.x) * ratio,
          y: my - (my - vp.y) * ratio,
          scale: newScale,
        };
      });
    } else {
      // Pan
      setViewport((vp) => ({
        ...vp,
        x: vp.x - e.deltaX,
        y: vp.y - e.deltaY,
      }));
    }
  }, [setViewport]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Mouse down (pan only; empty-space clicks keep selection) ─────────────
  const onMouseDown = (e) => {
    if (contextMenu) setContextMenu(null);
    if (e.target.closest('.fb-comment-card, .fb-comment-pin')) return;
    if (commentDraft) {
      setCommentDraft(null);
    }
    if (activeComment) {
      clearActiveComment();
    }
    if (e.button === 1 || (e.button === 0 && (spaceDown.current || activeCanvasTool === 'pan'))) {
      e.preventDefault();
      isPanning.current = true;
      panOrigin.current = { x: e.clientX, y: e.clientY };
      panStart.current  = { x: viewport.x, y: viewport.y };
      return;
    }
    if (e.button === 0 && e.target === e.currentTarget) {
      setSelection(null);
      setArtboardSel(null);
      setDrilled(null);
      clearActiveComment();
      setCommentDraft(null);
    }
  };

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const artboardNode = e.target.closest('.fb-artboard[data-bp]');
    const bpId = artboardNode?.dataset.bp ?? useEditorStore.getState().selection?.bpId ?? 'desktop';
    const elementNode = e.target.closest('[data-id]');
    const elementId = elementNode?.dataset.id ?? null;
    const bp = useEditorStore.getState().breakpointDefs[bpId];
    const page = useEditorStore.getState().getCurrentPage();
    const pad = resolvePagePadding(page?.padding, bpId);
    const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
    const worldX = (e.clientX - containerRect.left - panX) / scale;
    const worldY = (e.clientY - containerRect.top - panY) / scale;
    const localX = bp ? Math.max(0, Math.round(worldX - bp.x - (pad?.left ?? 0))) : 80;
    const localY = bp ? Math.max(0, Math.round(worldY - bp.y - (pad?.top ?? 0))) : 80;

    if (elementId && !isElementSelected(useEditorStore.getState().selection, elementId, bpId)) {
      setSelection({ elementId, bpId });
      setArtboardSel(null);
    }

    setContextMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      bpId,
      elementId,
      canPasteIntoFrame: canPasteIntoFrame(bpId, elementId),
      localX,
      localY,
      onCreateComponent: () => {
        if (!elementId) return;
        const element = useEditorStore.getState().getAllElements().find(el => el.id === elementId);
        setComponentModal({
          elementId,
          defaultName: element?.name || 'Component',
        });
      },
    });
  }, [canPasteIntoFrame, setArtboardSel, setSelection]);

  // ── Mouse move (pan + element drag/resize) ─────────────────
  const onMouseMove = useCallback((e) => {
    lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
    if (penDraft && !drag.current && (pendingDraw === 'pen' || activeCanvasTool === 'draw-pen')) {
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const state = useEditorStore.getState();
      let targetBpId = null;
      for (const bp of Object.values(state.breakpointDefs)) {
        if (pointer.worldX >= bp.x && pointer.worldX <= bp.x + bp.width && pointer.worldY >= bp.y && pointer.worldY <= bp.y + bp.height) {
          targetBpId = bp.id;
          break;
        }
      }
      setPenDraftCloseHint(resolvePenDraftCloseIntent(penDraft, targetBpId, pointer.worldX, pointer.worldY, state.viewport.scale));
    } else if (penDraftCloseHint) {
      setPenDraftCloseHint(false);
    }
    if (commentDrag.current) {
      const state = useEditorStore.getState();
      const session = commentDrag.current;
      const bp = state.breakpointDefs[session.bpId];
      if (!bp) return;
      const pad = resolvePagePadding(state.getCurrentPage?.()?.padding, session.bpId);
      const dxWorld = (e.clientX - session.startClientX) / Math.max(state.viewport.scale, MIN_SCALE);
      const dyWorld = (e.clientY - session.startClientY) / Math.max(state.viewport.scale, MIN_SCALE);
      const nextPosition = clampCommentPositionToArtboard(bp, pad, session.startX + dxWorld, session.startY + dyWorld);
      const nextX = nextPosition.x;
      const nextY = nextPosition.y;
      if (nextX !== session.startX || nextY !== session.startY) session.moved = true;
      if (session.isDraft) {
        setCommentDraft((current) => current ? { ...current, x: nextX, y: nextY, updatedAt: Date.now() } : current);
      } else {
        state.updateCommentThread(session.commentId, (comment) => ({
          ...comment,
          x: nextX,
          y: nextY,
        }));
      }
      return;
    }
    // Pan — read scale from store to avoid stale closure
    if (isPanning.current) {
      const currentScale = useEditorStore.getState().viewport.scale;
      const dx = e.clientX - panOrigin.current.x;
      const dy = e.clientY - panOrigin.current.y;
      setViewport({ x: panStart.current.x + dx, y: panStart.current.y + dy, scale: currentScale });
      return;
    }

    // Element hover
    if (!drag.current) {
      const hoveredId = resolveHoveredElementId(e.clientX, e.clientY);
      if (useEditorStore.getState().hoveredId !== hoveredId) {
        setHoveredId(hoveredId);
      }
      return;
    }

    // ── Draw rubber-band preview ────────────────────────────
    if (drag.current.type === 'draw') {
      const rect = containerRef.current.getBoundingClientRect();
      const rawW = e.clientX - drag.current.startMX;
      const rawH = e.clientY - drag.current.startMY;
      setDrawRect({
        left:   rect.left + Math.min(drag.current.startMX, e.clientX) - rect.left,
        top:    rect.top  + Math.min(drag.current.startMY, e.clientY) - rect.top,
        width:  Math.abs(rawW),
        height: Math.abs(rawH),
      });
      return;
    }

    const { type, bpId, elementId, handle,
            startMX, startMY, startX, startY, startW, startH } = drag.current;
    const { scale } = useEditorStore.getState().viewport;

    const dxScreen = e.clientX - startMX;
    const dyScreen = e.clientY - startMY;
    const dxWorld  = dxScreen / scale;
    const dyWorld  = dyScreen / scale;
    // Track last mouse position (used for off-canvas eject)
    drag.current.lastMX = e.clientX;
    drag.current.lastMY = e.clientY;

    if (type === 'pen-create-point') {
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      setPenDraft((current) => {
        if (!current) return current;
        const nextPoints = current.points.map((point, index) => {
          if (index !== drag.current.pointIndex) return point;
          const anchorX = point.x;
          const anchorY = point.y;
          const dx = pointer.worldX - anchorX;
          const dy = pointer.worldY - anchorY;
          if (Math.hypot(dx, dy) < 1 / Math.max(scale, MIN_SCALE)) {
            return { ...point, inX: anchorX, inY: anchorY, outX: anchorX, outY: anchorY };
          }
          return {
            ...point,
            inX: anchorX - dx,
            inY: anchorY - dy,
            outX: pointer.worldX,
            outY: pointer.worldY,
          };
        });
        return { ...current, points: nextPoints };
      });
    } else if (type === 'element-drag') {
      const hasMoved = Math.abs(e.clientX - drag.current.startMX) > 4 ||
        Math.abs(e.clientY - drag.current.startMY) > 4;
      if (hasMoved) drag.current.hasMoved = true;
      if (shouldUseDirectRotatedMove(drag.current)) {
        useEditorStore.getState().updateElementLayout(elementId, bpId, {
          x: drag.current.startX + dxWorld,
          y: drag.current.startY + dyWorld,
        });
        setReorderTarget(null);
        setDropTargetId(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
        setDragHint(null);
        return;
      }
      const resolvedPreview = resolveElementDragDrop(drag.current, e.clientX, e.clientY);
      const fallbackWorld = getDragSessionWorldPosition(drag.current, e.clientX, e.clientY, getProjectedWorldPoint);
      const fallbackPreview = buildFallbackDragPreview({
        session: drag.current,
        worldX: fallbackWorld.worldX,
        worldY: fallbackWorld.worldY,
        bp: useEditorStore.getState().breakpointDefs[drag.current.bpId] ?? null,
        pagePadding: resolvePagePadding(useEditorStore.getState().getCurrentPage?.()?.padding, drag.current.bpId),
        pageLayout: resolvePageLayout(useEditorStore.getState().getCurrentPage?.()?.layout, drag.current.bpId),
        artboardDom: document.querySelector(`.fb-artboard[data-bp="${drag.current.bpId}"]`),
        artboardRect: document.querySelector(`.fb-artboard[data-bp="${drag.current.bpId}"]`)?.getBoundingClientRect?.() ?? null,
      });
      const preview = resolvedPreview ?? fallbackPreview;
      const previewIsValid = preview
        && [preview.worldX, preview.worldY, preview.ghost?.worldX, preview.ghost?.worldY, preview.ghost?.width, preview.ghost?.height].every(Number.isFinite);
      if (!previewIsValid) {
        setReorderTarget(null);
        setDropTargetId(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
        setDragHint(null);
        return;
      }
      drag.current.preview = preview;
      setReorderTarget(preview.reorderTarget);
      setDropTargetId(preview.dropTargetId);
      setDragOverlay({ elementId, ...preview.ghost });
      setReorderGhost(preview.hint === 'Auto' ? preview.ghost : null);
      setAlignmentGuides(preview.alignmentGuides ?? []);
      setDragHint({ label: preview.hint, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'vector-point') {
      if (Math.abs(dxScreen) > 1 || Math.abs(dyScreen) > 1) drag.current.hasMoved = true;
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const state = useEditorStore.getState();
      const vectorEl = state.getAllElements().find((candidate) => candidate.id === elementId);
      if (!vectorEl) return;
      const resolvedVectorEl = resolveElement(vectorEl, bpId);
      const vectorShapeData = getVectorShapeData(resolvedVectorEl) || getVectorShapeData(vectorEl);
      if (!vectorShapeData) return;

      const frameWorldX = Number.isFinite(drag.current.frameWorldX) ? drag.current.frameWorldX : (resolvedVectorEl.x ?? 0);
      const frameWorldY = Number.isFinite(drag.current.frameWorldY) ? drag.current.frameWorldY : (resolvedVectorEl.y ?? 0);
      const worldVectorData = getWorldVectorData(vectorShapeData, frameWorldX, frameWorldY);
      let nextWorldVectorData = worldVectorData;
      if (drag.current.handleMode === 'anchor') {
        nextWorldVectorData = moveVectorAnchor(worldVectorData, drag.current.pointIndex, { x: pointer.worldX, y: pointer.worldY });
      } else if (drag.current.handleMode === 'in' || drag.current.handleMode === 'out') {
        nextWorldVectorData = updateVectorHandle(worldVectorData, drag.current.pointIndex, drag.current.handleMode, { x: pointer.worldX, y: pointer.worldY }, !e.altKey);
      }

      const reframed = reframeVectorShapeData(nextWorldVectorData);
      const nextLocalX = (drag.current.localX ?? resolvedVectorEl.x ?? 0) + (reframed.offsetX - frameWorldX);
      const nextLocalY = (drag.current.localY ?? resolvedVectorEl.y ?? 0) + (reframed.offsetY - frameWorldY);
      commitVectorShapeData(elementId, bpId, { ...resolvedVectorEl, x: nextLocalX, y: nextLocalY }, nextWorldVectorData);
      drag.current.frameWorldX = reframed.offsetX;
      drag.current.frameWorldY = reframed.offsetY;
      drag.current.localX = nextLocalX;
      drag.current.localY = nextLocalY;
    } else if (type === 'vector-resize') {
      if (Math.abs(dxScreen) > 1 || Math.abs(dyScreen) > 1) drag.current.hasMoved = true;
      const session = drag.current;
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const center = {
        x: session.originFrameWorldX + (session.originVectorWidth / 2),
        y: session.originFrameWorldY + (session.originVectorHeight / 2),
      };
      const unrotatedPointer = rotatePointAround(pointer, center, -(session.startRotation ?? 0));
      const nextBounds = resolveResizedBounds({
        startBounds: {
          minX: session.originFrameWorldX,
          minY: session.originFrameWorldY,
          width: session.originVectorWidth,
          height: session.originVectorHeight,
        },
        handle: session.handle,
        pointer: unrotatedPointer,
        minSize: 20,
        keepAspectRatio: session.lockAspectRatio || e.shiftKey,
      });
      const nextLocalVectorData = scaleVectorShapeToBounds(session.startVectorData, {
        minX: 0,
        minY: 0,
        width: nextBounds.width,
        height: nextBounds.height,
      });
      const state = useEditorStore.getState();
      const vectorEl = state.getAllElements().find((candidate) => candidate.id === elementId);
      if (!vectorEl) return;
      const resolvedVectorEl = resolveElement(vectorEl, bpId);
      const nextLocalX = (session.originX ?? resolvedVectorEl.x ?? 0) + (nextBounds.minX - session.originFrameWorldX);
      const nextLocalY = (session.originY ?? resolvedVectorEl.y ?? 0) + (nextBounds.minY - session.originFrameWorldY);
      const reframed = commitVectorShapeData(elementId, bpId, {
        ...resolvedVectorEl,
        positionType: session.pinToAbsoluteLayout ? 'absolute' : resolvedVectorEl.positionType,
        absoluteInLayout: session.pinToAbsoluteLayout ? true : resolvedVectorEl.absoluteInLayout,
        x: nextLocalX,
        y: nextLocalY,
        width: nextBounds.width,
        height: nextBounds.height,
      }, nextLocalVectorData);
      drag.current.frameWorldX = nextBounds.minX;
      drag.current.frameWorldY = nextBounds.minY;
      drag.current.localX = nextLocalX;
      drag.current.localY = nextLocalY;
      drag.current.startVectorWidth = reframed.width;
      drag.current.startVectorHeight = reframed.height;
    } else if (type === 'vector-rotate') {
      if (Math.abs(dxScreen) > 1 || Math.abs(dyScreen) > 1) drag.current.hasMoved = true;
      const session = drag.current;
      const currentAngle = Math.atan2(e.clientY - session.centerClientY, e.clientX - session.centerClientX) * 180 / Math.PI;
      const startAngle = Math.atan2(session.startMY - session.centerClientY, session.startMX - session.centerClientX) * 180 / Math.PI;
      let nextRotation = Math.round(((session.startRotation ?? 0) + currentAngle - startAngle) * 10) / 10;
      if (e.shiftKey) nextRotation = Math.round(nextRotation / 15) * 15;
      state.updateElementLayout(elementId, bpId, { rotation: nextRotation });
      setDragHint({ label: `${Math.round(nextRotation)}deg`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'multi-element-drag') {
      const hasMoved = Math.abs(e.clientX - drag.current.startMX) > 4 ||
        Math.abs(e.clientY - drag.current.startMY) > 4;
      if (hasMoved) drag.current.hasMoved = true;
      drag.current.items.forEach((item) => {
        useEditorStore.getState().updateElementLayout(item.id, bpId, {
          x: item.startX + dxWorld,
          y: item.startY + dyWorld,
        });
      });
    } else if (type === 'multi-resize') {
      const session = drag.current;
      const hasMoved = Math.abs(e.clientX - session.startMX) > 4 || Math.abs(e.clientY - session.startMY) > 4;
      if (hasMoved) session.hasMoved = true;
      const nextBounds = resolveResizedBounds({
        startBounds: session.groupBounds,
        handle: session.handle,
        pointer: {
          x: (session.startHandleX ?? (session.groupBounds.minX + session.groupBounds.width)) + dxWorld,
          y: (session.startHandleY ?? (session.groupBounds.minY + session.groupBounds.height)) + dyWorld,
        },
        minSize: 20,
        keepAspectRatio: session.lockAspectRatio || e.shiftKey,
      });
      const startBounds = session.groupBounds;
      const scaleX = nextBounds.width / Math.max(startBounds.width, 1);
      const scaleY = nextBounds.height / Math.max(startBounds.height, 1);
      session.items.forEach((item) => {
        const relativeLeft = item.domWorldX - startBounds.minX;
        const relativeTop = item.domWorldY - startBounds.minY;
        const nextWorldX = nextBounds.minX + (relativeLeft * scaleX);
        const nextWorldY = nextBounds.minY + (relativeTop * scaleY);
        const nextWidth = Math.max(1, item.domWidth * scaleX);
        const nextHeight = Math.max(1, item.domHeight * scaleY);
        useEditorStore.getState().updateElementLayout(item.id, bpId, {
          x: item.startX + (nextWorldX - item.domWorldX),
          y: item.startY + (nextWorldY - item.domWorldY),
          width: nextWidth,
          height: nextHeight,
        });
      });
    } else if (type === 'artboard-move') {
      useEditorStore.getState().updateBreakpointDef(bpId, {
        x: drag.current.startBpX + dxWorld,
        y: drag.current.startBpY + dyWorld,
      });
    } else if (type === 'artboard-resize') {
      useEditorStore.getState().updateBreakpointDef(bpId, {
        height: Math.max(100, drag.current.startH + dyWorld),
      });
    } else if (type === 'artboard-padding') {
      const { side, startPad } = drag.current;
      const newPad = { ...startPad };
      if (side === 'top')    newPad.top    = Math.max(0, startPad.top    + dyWorld);
      if (side === 'bottom') newPad.bottom = Math.max(0, startPad.bottom - dyWorld);
      if (side === 'left')   newPad.left   = Math.max(0, startPad.left   + dxWorld);
      if (side === 'right')  newPad.right  = Math.max(0, startPad.right  - dxWorld);
      useEditorStore.getState().setPagePadding(bpId, newPad);
      setPaddingDragInfo({ side, value: Math.round(newPad[side]), clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'artboard-gap') {
      const { isRow, startGap, layout } = drag.current;
      const newGap = Math.max(0, Math.round(startGap + (isRow ? dxWorld : dyWorld)));
      useEditorStore.getState().setPageLayout(bpId, { ...layout, gap: newGap });
      setGapDragInfo({ value: newGap, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'rotate') {
      const { elementId: rotId, startRotation = 0, startAngle = 0, centerX = 0, centerY = 0 } = drag.current;
      const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      let nextRotation = Math.round((startRotation + currentAngle - startAngle) * 10) / 10;
      if (e.shiftKey) nextRotation = Math.round(nextRotation / 15) * 15;
      useEditorStore.getState().updateElementLayout(rotId, bpId, { rotation: nextRotation });
      setDragHint({ label: `${Math.round(nextRotation)}deg`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'resize') {
      const nextBounds = resolveResizedBounds({
        startBounds: { minX: startX, minY: startY, width: startW, height: startH },
        handle,
        pointer: {
          x: (drag.current.startHandleX ?? (startX + startW)) + dxWorld,
          y: (drag.current.startHandleY ?? (startY + startH)) + dyWorld,
        },
        minSize: 20,
        keepAspectRatio: drag.current.lockAspectRatio || e.shiftKey,
      });
      useEditorStore.getState().updateElementLayout(elementId, bpId, {
        x: nextBounds.minX,
        y: nextBounds.minY,
        width: nextBounds.width,
        height: nextBounds.height,
      });
    } else if (type === 'text-font-size') {
      const { elementId: textId, bpId: textBpId, startFontSize } = drag.current;
      const delta = Math.max(dxWorld, dyWorld);
      let nextFontSize = Math.max(4, Math.round((startFontSize + delta) * 10) / 10);
      if (e.shiftKey) nextFontSize = Math.max(4, Math.round(nextFontSize / 4) * 4);
      useEditorStore.getState().updateElementStyles(textId, textBpId, { fontSize: nextFontSize, fontSizeUnit: 'px' });
      setTextSizeDragInfo({ value: nextFontSize, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'gradient-linear-handle') {
      const { elementId: gradId, bpId: gradBp, selectionRotation = 0, handle = 'linear-end', lineStart, lineEnd, worldX, worldY, overlayW, overlayH } = drag.current;
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const nextLineStart = handle === 'linear-start' ? { x: pointer.worldX, y: pointer.worldY } : lineStart;
      const nextLineEnd = handle === 'linear-end' ? { x: pointer.worldX, y: pointer.worldY } : lineEnd;
      const lineCenter = midpoint(nextLineStart, nextLineEnd);
      const overlayCenter = { x: worldX + overlayW / 2, y: worldY + overlayH / 2 };
      const rawStart = rotatePointAround(nextLineStart, overlayCenter, -selectionRotation);
      const rawEnd = rotatePointAround(nextLineEnd, overlayCenter, -selectionRotation);
      const nextAngle = cssAngleFromVector(rawEnd.x - rawStart.x, rawEnd.y - rawStart.y);
      const state = useEditorStore.getState();
      const gradEl = state.getAllElements().find((candidate) => candidate.id === gradId);
      const gradient = gradEl ? parseGradient(resolveElement(gradEl, gradBp).styles?.backgroundColor ?? '') : null;
      if (!gradient || gradient.type !== 'linear') return;
      const direction = cssAngleToUnitVector(nextAngle);
      const localRect = { left: worldX, top: worldY, right: worldX + overlayW, bottom: worldY + overlayH };
      const projectionRange = getProjectionRangeForRect(localRect, direction);
      const range = Math.max(0.0001, projectionRange.max - projectionRange.min);
      const startProjection = (rawStart.x * direction.x) + (rawStart.y * direction.y);
      const endProjection = (rawEnd.x * direction.x) + (rawEnd.y * direction.y);
      const nextStartPos = clampGradientPercent(((startProjection - projectionRange.min) / range) * 100);
      const nextEndPos = clampGradientPercent(((endProjection - projectionRange.min) / range) * 100);
      const currentStops = [...(gradient.stops ?? [])].sort((a, b) => a.pos - b.pos);
      const oldStartPos = currentStops[0]?.pos ?? 0;
      const oldEndPos = currentStops.at(-1)?.pos ?? 100;
      const oldRange = Math.max(0.0001, oldEndPos - oldStartPos);
      const nextStops = currentStops.map((stop) => {
        const t = (stop.pos - oldStartPos) / oldRange;
        return {
          ...stop,
          pos: Math.round(nextStartPos + ((nextEndPos - nextStartPos) * t)),
        };
      });
      state.updateElementStyles(gradId, gradBp, { backgroundColor: buildGradient({ ...gradient, angle: nextAngle, stops: nextStops }) });
      drag.current.lineStart = nextLineStart;
      drag.current.lineEnd = nextLineEnd;
      setGradientDragOverlay((prev) => prev && prev.elementId === gradId ? { ...prev, lineStart: nextLineStart, lineEnd: nextLineEnd, center: lineCenter } : prev);
      setDragHint({ label: `${Math.round(nextAngle)}deg`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'gradient-stop') {
      const { elementId: gradId, bpId: gradBp, stopIndex, lineStart, lineEnd, gradientType } = drag.current;
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const nextPos = Math.round(projectPointToSegmentRatio({ x: pointer.worldX, y: pointer.worldY }, lineStart, lineEnd) * 100);
      const state = useEditorStore.getState();
      const gradEl = state.getAllElements().find((candidate) => candidate.id === gradId);
      const gradient = gradEl ? parseGradient(resolveElement(gradEl, gradBp).styles?.backgroundColor ?? '') : null;
      if (!gradient || gradient.type !== gradientType) return;
      const nextStops = (gradient.stops ?? []).map((stop, index) => (index === stopIndex ? { ...stop, pos: nextPos } : stop));
      state.updateElementStyles(gradId, gradBp, { backgroundColor: buildGradient({ ...gradient, stops: nextStops }) });
      setDragHint({ label: `${nextPos}%`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'gradient-radial-center') {
      const { elementId: gradId, bpId: gradBp, worldX, worldY, overlayW, overlayH, selectionRotation = 0, radius = 0 } = drag.current;
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const overlayCenter = { x: worldX + overlayW / 2, y: worldY + overlayH / 2 };
      const unrotatedPointer = rotatePointAround({ x: pointer.worldX, y: pointer.worldY }, overlayCenter, -selectionRotation);
      const nextCenterX = clampGradientPercent(((unrotatedPointer.x - worldX) / Math.max(overlayW, 1)) * 100);
      const nextCenterY = clampGradientPercent(((unrotatedPointer.y - worldY) / Math.max(overlayH, 1)) * 100);
      const state = useEditorStore.getState();
      const gradEl = state.getAllElements().find((candidate) => candidate.id === gradId);
      const gradient = gradEl ? parseGradient(resolveElement(gradEl, gradBp).styles?.backgroundColor ?? '') : null;
      if (!gradient || gradient.type !== 'radial') return;
      state.updateElementStyles(gradId, gradBp, { backgroundColor: buildGradient({ ...gradient, centerX: nextCenterX, centerY: nextCenterY }) });
      const localCenter = { x: worldX + (overlayW * (nextCenterX / 100)), y: worldY + (overlayH * (nextCenterY / 100)) };
      const nextCenter = rotatePointAround(localCenter, overlayCenter, selectionRotation);
      const nextLineEnd = rotatePointAround({ x: localCenter.x + radius, y: localCenter.y }, overlayCenter, selectionRotation);
      drag.current.centerWorldX = nextCenter.x;
      drag.current.centerWorldY = nextCenter.y;
      drag.current.lineStart = nextCenter;
      drag.current.lineEnd = nextLineEnd;
      setGradientDragOverlay((prev) => prev && prev.elementId === gradId ? { ...prev, center: nextCenter, lineStart: nextCenter, lineEnd: nextLineEnd } : prev);
      setDragHint({ label: `${Math.round(nextCenterX)}%, ${Math.round(nextCenterY)}%`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'gradient-radial-radius') {
      const { elementId: gradId, bpId: gradBp, worldX, worldY, overlayW, overlayH, selectionRotation = 0, centerWorldX, centerWorldY } = drag.current;
      const pointer = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
      const overlayCenter = { x: worldX + overlayW / 2, y: worldY + overlayH / 2 };
      const unrotatedPointer = rotatePointAround({ x: pointer.worldX, y: pointer.worldY }, overlayCenter, -selectionRotation);
      const unrotatedCenter = rotatePointAround({ x: centerWorldX, y: centerWorldY }, overlayCenter, -selectionRotation);
      const nextRadius = clampGradientPercent(Math.hypot(unrotatedPointer.x - unrotatedCenter.x, unrotatedPointer.y - unrotatedCenter.y) / Math.max(Math.min(overlayW, overlayH), 1) * 100, 1, 150);
      const state = useEditorStore.getState();
      const gradEl = state.getAllElements().find((candidate) => candidate.id === gradId);
      const gradient = gradEl ? parseGradient(resolveElement(gradEl, gradBp).styles?.backgroundColor ?? '') : null;
      if (!gradient || gradient.type !== 'radial') return;
      state.updateElementStyles(gradId, gradBp, { backgroundColor: buildGradient({ ...gradient, radius: nextRadius }) });
      const nextRadiusWorld = Math.max(18 / Math.max(viewport.scale || 1, MIN_SCALE), Math.min(overlayW, overlayH) * (nextRadius / 100));
      const nextLineEnd = rotatePointAround({ x: unrotatedCenter.x + nextRadiusWorld, y: unrotatedCenter.y }, overlayCenter, selectionRotation);
      drag.current.radius = nextRadiusWorld;
      drag.current.lineEnd = nextLineEnd;
      setGradientDragOverlay((prev) => prev && prev.elementId === gradId ? { ...prev, radius: nextRadiusWorld, lineEnd: nextLineEnd } : prev);
      setDragHint({ label: `${Math.round(nextRadius)}%`, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'radius') {
      const { elementId: radId, bpId: radBp, startRadius, corner } = drag.current;
      const allEls = useEditorStore.getState().getAllElements();
      const radEl  = allEls.find(el => el.id === radId);
      if (!radEl) return;
      const res    = resolveElement(radEl, radBp);
      const maxR   = Math.floor(Math.min(res.width ?? 9999, res.height ?? 9999) / 2);
      const newR   = Math.max(0, Math.min(maxR, Math.round(startRadius + dxWorld)));
      const styleKey = corner ? `borderRadius${corner}` : 'borderRadius';
      useEditorStore.getState().updateElementStyles(radId, radBp, { [styleKey]: newR });
      setRadiusDragInfo({ value: newR, clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'element-padding') {
      const { side, startPad, elementId: elId, bpId: elBp } = drag.current;
      const newPad = { ...startPad };
      if (side === 'top')    newPad.paddingTop    = Math.max(0, Math.round(startPad.paddingTop    + dyWorld));
      if (side === 'bottom') newPad.paddingBottom = Math.max(0, Math.round(startPad.paddingBottom - dyWorld));
      if (side === 'left')   newPad.paddingLeft   = Math.max(0, Math.round(startPad.paddingLeft   + dxWorld));
      if (side === 'right')  newPad.paddingRight  = Math.max(0, Math.round(startPad.paddingRight  - dxWorld));
      const capKey = side.charAt(0).toUpperCase() + side.slice(1);
      useEditorStore.getState().updateElementStyles(elId, elBp, newPad);
      setPaddingDragInfo({ side, value: newPad[`padding${capKey}`], clientX: e.clientX, clientY: e.clientY });
    } else if (type === 'viewport-fold') {
      const { startFoldH, bpId: foldBpId, initialFixedEls } = drag.current;
      const newFoldH = Math.max(100, Math.round(startFoldH + dyWorld));
      useEditorStore.getState().updateBreakpointDef(foldBpId, { viewportFoldH: newFoldH });
      // Move fixed elements with bottom constraint: maintain their distance from the fold
      if (initialFixedEls?.length) {
        const foldDelta = newFoldH - startFoldH;
        initialFixedEls.forEach(({ id, y }) => {
          useEditorStore.getState().updateElementLayout(id, foldBpId, { y: y + foldDelta });
        });
      }
      setFoldDragInfo({ value: newFoldH, clientX: e.clientX, clientY: e.clientY });
    }
  }, [activeCanvasTool, getProjectedWorldPoint, penDraft, penDraftCloseHint, pendingDraw, resolveElementDragDrop, resolveHoveredElementId, resolvePenDraftCloseIntent, setHoveredId, setViewport]);

  const onMouseUp = useCallback((e) => {
    if (commentDrag.current) {
      const session = commentDrag.current;
      commentDrag.current = null;
      if (session.moved) pushHistory();
      setInteracting(false);
      return;
    }
    if (isPanning.current) {
      isPanning.current = false;
    }
    // ── Commit draw ─────────────────────────────────────────
    if (drag.current?.type === 'draw') {
      const { drawType, startMX, startMY, startWorldX, startWorldY } = drag.current;
      drag.current = null;
      setDrawRect(null);
      const { x: panX, y: panY, scale } = useEditorStore.getState().viewport;
      const rect = containerRef.current.getBoundingClientRect();
      const endWorldX = (e.clientX - rect.left - panX) / scale;
      const endWorldY = (e.clientY - rect.top  - panY) / scale;
      const rawW = endWorldX - startWorldX;
      const rawH = endWorldY - startWorldY;
      const elX = Math.round(Math.min(startWorldX, endWorldX));
      const elY = Math.round(Math.min(startWorldY, endWorldY));
      const elW = Math.max(20, Math.round(Math.abs(rawW)));
      const elH = Math.max(20, Math.round(Math.abs(rawH)));
      // Detect which artboard: check which bp contains the DRAW-START point.
      // Falls back to nearest artboard centre so drawing outside artboards still works.
      const bpDefsNow = useEditorStore.getState().breakpointDefs;
      let targetBpId = null;
      for (const bp of Object.values(bpDefsNow)) {
        if (startWorldX >= bp.x && startWorldX <= bp.x + bp.width &&
            startWorldY >= bp.y && startWorldY <= bp.y + bp.height) {
          targetBpId = bp.id; break;
        }
      }
      if (!targetBpId) {
        // Off-canvas draw: assign to nearest artboard
        let minDist = Infinity;
        for (const bp of Object.values(bpDefsNow)) {
          const d = Math.hypot(startWorldX - (bp.x + bp.width / 2), startWorldY - (bp.y + bp.height / 2));
          if (d < minDist) { minDist = d; targetBpId = bp.id; }
        }
      }
      if (!targetBpId) { setPendingDraw(null); return; }
      const targetBpDef = bpDefsNow[targetBpId];
      const page2 = useEditorStore.getState().getCurrentPage();
      const pageLayout2 = resolvePageLayout(page2?.layout, targetBpId);
      const pad2  = resolvePagePadding(page2?.padding, targetBpId);
      let localX = Math.round(elX - targetBpDef.x - (pad2?.left ?? 0));
      let localY = Math.round(elY - targetBpDef.y - (pad2?.top  ?? 0));
      // Hit-test at the START of the draw to find the parent container
      let parentId = null;
      {
        const hits = document.elementsFromPoint(startMX, startMY);
        const allEls = useEditorStore.getState().getAllElements();
        for (const domEl of hits) {
          const dataId = domEl.dataset?.id;
          if (!dataId) continue;
          const candidate = allEls.find(el => el.id === dataId);
          if (!candidate || candidate.type !== 'frame') continue;
          const candidateResolved = resolveElement(candidate, targetBpId);
          if (candidateResolved.hidden) continue;
          parentId = dataId;
          const cRect = domEl.getBoundingClientRect();
          const aRect = containerRef.current.getBoundingClientRect();
          const { x: panX2, y: panY2, scale: sc2 } = useEditorStore.getState().viewport;
          const cWorldX = (cRect.left - aRect.left - panX2) / sc2;
          const cWorldY = (cRect.top  - aRect.top  - panY2) / sc2;
          localX = Math.round(elX - cWorldX);
          localY = Math.round(elY - cWorldY);
          break;
        }
      }
      const rootAbsoluteInLayout = !parentId && pageLayout2 !== null;
      if (rootAbsoluteInLayout) {
        localX = Math.round(elX - targetBpDef.x);
        localY = Math.round(elY - targetBpDef.y);
      }
      const newEl = drawType === 'image'
        ? createImage(localX, localY)
        : drawType === 'video'
          ? createVideo(localX, localY)
        : drawType === 'embed'
          ? createEmbed(localX, localY)
        : drawType === 'scroll-sequence'
          ? createScrollSequence(localX, localY)
        : drawType === 'text'
          ? createText(localX, localY)
          : drawType === 'icon'
            ? createIcon(localX, localY)
            : ['circle', 'line', 'polygon', 'path', 'pen'].includes(drawType)
              ? createShapePreset(drawType === 'pen' ? 'path' : drawType, localX, localY)
            : createFrame(localX, localY);
      if (drawType === 'circle') {
        const circleSize = Math.max(elW, elH);
        newEl.base.width = circleSize;
        newEl.base.height = circleSize;
      } else {
        newEl.base.width = elW;
        newEl.base.height = drawType === 'line' ? Math.max(2, Math.min(elH, 12)) : elH;
      }
      if (drawType === 'line') {
        const lineWidth = Math.max(1, Math.round(Math.abs(rawW)));
        const lineHeight = Math.max(1, Math.round(Math.abs(rawH)));
        const vectorData = reframeVectorShapeData({
          kind: 'line',
          points: [
            { x: rawW < 0 ? lineWidth : 0, y: rawH < 0 ? lineHeight : 0 },
            { x: rawW < 0 ? 0 : lineWidth, y: rawH < 0 ? 0 : lineHeight },
          ],
        });
        newEl.base.width = vectorData.width;
        newEl.base.height = vectorData.height;
        newEl.base.vectorData = vectorData.vectorData;
        newEl.base.svgMarkup = buildVectorShapeSvgMarkup(vectorData.vectorData, {
          width: vectorData.width,
          height: vectorData.height,
          fill: 'none',
          stroke: newEl.base.styles?.strokeColor ?? '#111827',
          strokeWidth: Math.max(0.5, newEl.base.styles?.strokeWidth || 2),
        });
      }
      if (drawType === 'path') {
        const vectorData = getVectorShapeData(newEl.base) || getVectorShapeData(newEl);
        if (vectorData) {
          const baseBounds = reframeVectorShapeData(vectorData);
          const scaleX = Math.max(0.1, elW / Math.max(baseBounds.width, 1));
          const scaleY = Math.max(0.1, elH / Math.max(baseBounds.height, 1));
          const scaled = {
            ...baseBounds.vectorData,
            points: baseBounds.vectorData.points.map((point) => ({
              ...point,
              x: point.x * scaleX,
              y: point.y * scaleY,
              inX: point.inX * scaleX,
              inY: point.inY * scaleY,
              outX: point.outX * scaleX,
              outY: point.outY * scaleY,
            })),
          };
          const reframed = reframeVectorShapeData(scaled);
          newEl.base.width = reframed.width;
          newEl.base.height = reframed.height;
          newEl.base.vectorData = reframed.vectorData;
          newEl.base.svgMarkup = buildVectorShapeSvgMarkup(reframed.vectorData, {
            width: reframed.width,
            height: reframed.height,
            fill: 'none',
            stroke: newEl.base.styles?.strokeColor ?? '#2563eb',
            strokeWidth: Math.max(0.5, newEl.base.styles?.strokeWidth || 1.5),
          });
        }
      }
      if (rootAbsoluteInLayout) {
        newEl.base.positionType = 'absolute';
        newEl.base.absoluteInLayout = true;
      }
      addElement(newEl, parentId, targetBpId);
      // If drawn inside a container, drill into it so the element is interactable
      if (parentId) useEditorStore.getState().setDrilledContainerId(parentId);
      skipNextArtboardClickRef.current = true;
      setArtboardSel(null);
      useEditorStore.getState().setSelection({ elementId: newEl.id, bpId: targetBpId });
      pushHistory();
      setPendingDraw(null);
      if (['circle', 'line', 'polygon', 'path', 'pen'].includes(drawType)) {
        setActiveCanvasTool('select');
      }
      return;
    }
    if (drag.current?.type === 'pen-create-point') {
      const session = drag.current;
      drag.current = null;
      setInteracting(false);
      if (session.finalizeOnUp) {
        commitPenDraft();
      }
      return;
    }
    if (drag.current) {
      let shouldPushHistory = drag.current.type !== 'element-drag' || !!drag.current.hasMoved;
      if (drag.current.type === 'vector-point') {
        shouldPushHistory = !!drag.current.hasMoved;
      }
      if (drag.current.type === 'vector-resize' || drag.current.type === 'vector-rotate') {
        shouldPushHistory = !!drag.current.hasMoved;
      }
      if (drag.current.type === 'viewport-fold') {
        setFoldDragInfo(null);
        drag.current = null;
        setInteracting(false);
        return;
      }
      if (drag.current.type === 'multi-element-drag') {
        shouldPushHistory = !!drag.current.hasMoved;
      }
      if (drag.current.type === 'multi-resize') {
        shouldPushHistory = !!drag.current.hasMoved;
      }
      if (drag.current.type === 'element-drag') {
        const session = drag.current;
        shouldPushHistory = !!session.hasMoved;
        if (shouldUseDirectRotatedMove(session)) {
          setReorderTarget(null);
          setDropTargetId(null);
        } else if (session.hasMoved) {
          const fallbackWorld = getDragSessionWorldPosition(session, e.clientX, e.clientY, getProjectedWorldPoint);
          const fallbackDrop = buildFallbackDragPreview({
            session,
            worldX: fallbackWorld.worldX,
            worldY: fallbackWorld.worldY,
            bp: useEditorStore.getState().breakpointDefs[session.bpId] ?? null,
            pagePadding: resolvePagePadding(useEditorStore.getState().getCurrentPage?.()?.padding, session.bpId),
            pageLayout: resolvePageLayout(useEditorStore.getState().getCurrentPage?.()?.layout, session.bpId),
            artboardDom: document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`),
            artboardRect: document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`)?.getBoundingClientRect?.() ?? null,
          });
          const drop = session.preview ?? resolveElementDragDrop(session, e.clientX, e.clientY) ?? fallbackDrop;
          const st = useEditorStore.getState();
          const dragEl = st.getAllElements().find(el => el.id === session.elementId);
          if (drop && dragEl) {
            const resolvedDragEl = resolveElement(dragEl, session.bpId);
            const fixedWidth = session.layoutW ?? resolvedDragEl.width ?? 100;
            const fixedHeight = session.layoutH ?? resolvedDragEl.height ?? 40;
            const moveToParent = (nextParentId) => {
              const currentEl = st.getAllElements().find(el => el.id === session.elementId);
              if ((currentEl?.parentId ?? null) !== (nextParentId ?? null)) {
                st.reparentElement(session.elementId, nextParentId ?? null);
              }
            };
            const reorderWithinParent = (parentId, insertBeforeId) => {
              const siblingIds = getSiblingIds(st.getAllElements(), parentId, session.elementId);
              let nextIndex = insertBeforeId ? siblingIds.indexOf(insertBeforeId) : siblingIds.length;
              if (nextIndex < 0) nextIndex = siblingIds.length;
              st.reorderElementInParent(session.elementId, nextIndex);
            };

            if (drop.mode === 'container-flow' || drop.mode === 'root-flow') {
              moveToParent(drop.mode === 'container-flow' ? drop.targetParentId : null);
              if (drop.mode === 'container-flow') st.setDrilledContainerId(drop.targetParentId);
              else st.setDrilledContainerId(null);
              st.updateElementLayout(session.elementId, session.bpId, {
                positionType: 'relative',
                absoluteInLayout: false,
                x: 0,
                y: 0,
                widthMode: 'fixed',
                heightMode: 'fixed',
                width: fixedWidth,
                height: fixedHeight,
              });
              reorderWithinParent(drop.mode === 'container-flow' ? drop.targetParentId : null, drop.insertBeforeId);
            } else if (drop.mode === 'container-free') {
              moveToParent(drop.targetParentId);
              st.setDrilledContainerId(drop.targetParentId);
              const containerNode = drop.dropContainer
                ? document.querySelector(`.fb-artboard[data-bp="${session.bpId}"]`)?.querySelector(`[data-id="${drop.targetParentId}"]`)
                : null;
              const containerWorldRect = getNodeWorldRect(containerNode, drop.artboardDom, drop.bp, st.viewport.scale);
              const localX = containerWorldRect ? Math.round(drop.worldX - containerWorldRect.left - ((containerNode?.clientLeft ?? 0) / st.viewport.scale)) : 0;
              const localY = containerWorldRect ? Math.round(drop.worldY - containerWorldRect.top - ((containerNode?.clientTop ?? 0) / st.viewport.scale)) : 0;
              st.updateElementLayout(session.elementId, session.bpId, {
                positionType: 'absolute',
                absoluteInLayout: false,
                widthMode: 'fixed',
                heightMode: 'fixed',
                width: fixedWidth,
                height: fixedHeight,
                x: localX,
                y: localY,
              });
            } else {
              moveToParent(null);
              st.setDrilledContainerId(null);
              const absoluteInLayout = drop.mode !== 'fixed-root' && !!drop.pageLayout;
              const offsetX = absoluteInLayout ? 0 : (drop.pagePadding?.left ?? 0);
              const offsetY = absoluteInLayout ? 0 : (drop.pagePadding?.top ?? 0);
              st.updateElementLayout(session.elementId, session.bpId, {
                positionType: drop.mode === 'fixed-root' ? 'fixed' : 'absolute',
                absoluteInLayout: drop.mode === 'fixed-root' ? false : absoluteInLayout,
                widthMode: 'fixed',
                heightMode: 'fixed',
                width: fixedWidth,
                height: fixedHeight,
                x: Math.round(drop.worldX - drop.bp.x - offsetX),
                y: Math.round(drop.worldY - drop.bp.y - offsetY),
              });
            }
            st.setSelection({ elementId: session.elementId, bpId: session.bpId });
          } else {
            shouldPushHistory = false;
          }
        }
        setReorderTarget(null);
        setDropTargetId(null);
      }
      if (drag.current.type === 'radius') {
        setRadiusDragInfo(null);
      }
      if (drag.current.type === 'element-padding' || drag.current.type === 'artboard-padding') {
        setPaddingDragInfo(null);
      }
      if (drag.current.type === 'artboard-gap') {
        setGapDragInfo(null);
      }
      if (drag.current.type === 'text-font-size') {
        setTextSizeDragInfo(null);
      }
      if (drag.current.type === 'element-drag') {
        setDragHint(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
      }
      if (drag.current.type === 'multi-element-drag') {
        setDragHint(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
      }
      if (drag.current.type === 'multi-resize') {
        setDragHint(null);
        setReorderGhost(null);
        setDragOverlay(null);
        setAlignmentGuides([]);
      }
      if (drag.current.type === 'rotate') {
        setDragHint(null);
      }
      if (drag.current.type === 'gradient-linear-handle' || drag.current.type === 'gradient-stop' || drag.current.type === 'gradient-radial-center' || drag.current.type === 'gradient-radial-radius') {
        setDragHint(null);
      }
      if (drag.current.type === 'vector-point') {
        setDragHint(null);
      }
      setDraggingElementId(null);
      setDraggingElementBpId(null);
      if (shouldPushHistory) pushHistory();
      drag.current = null;
      setInteracting(false);
    }
  }, [getProjectedWorldPoint, pushHistory, resolveElementDragDrop, setInteracting, setDraggingElementId]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // ── Draw mode: capture-phase mousedown so child stopPropagation can't block it
  // Always registered (empty deps) — reads fresh store state each time to avoid
  // stale-closure bugs where pendingDraw was set to null but the old listener
  // is still active because React hasn't yet re-run the cleanup effect.
  useEffect(() => {
    const handleCaptureDown = (e) => {
      const state = useEditorStore.getState();
      const drawType = state.pendingDraw; // always fresh
      const tool = state.activeCanvasTool;
      if (e.button !== 0 || spaceDown.current) return;
      if (!containerRef.current?.contains(e.target)) return;
      if (e.target.closest('.fb-artboard-header, .fb-right, .fb-left, .fb-topbar, .fb-bottom-toolbar-wrap, .fb-shadow-popup, .fb-fill-popover')) return;
      if (e.target.closest('.fb-comment-card')) return;
      if (tool === 'pan') {
        e.preventDefault();
        e.stopPropagation();
        isPanning.current = true;
        panOrigin.current = { x: e.clientX, y: e.clientY };
        panStart.current = { x: state.viewport.x, y: state.viewport.y };
        return;
      }
      if (tool === 'comment') {
        if (state.activeSurface === 'component') return;
        if (e.target.closest('.fb-comment-pin, .fb-comment-card')) return;
        if (commentDraft || state.activeCommentId) {
          state.clearActiveComment();
          setCommentDraft(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const rect = containerRef.current.getBoundingClientRect();
        const { x: panX, y: panY, scale } = state.viewport;
        const worldX = (e.clientX - rect.left - panX) / scale;
        const worldY = (e.clientY - rect.top - panY) / scale;
        let targetBp = null;
        for (const bp of Object.values(state.breakpointDefs)) {
          if (worldX >= bp.x && worldX <= bp.x + bp.width && worldY >= bp.y && worldY <= bp.y + bp.height) {
            targetBp = bp;
            break;
          }
        }
        if (!targetBp) return;
        const pad = resolvePagePadding(state.getCurrentPage()?.padding, targetBp.id);
        const localPosition = clampCommentPositionToArtboard(
          targetBp,
          pad,
          worldX - targetBp.x - (pad?.left ?? 0),
          worldY - targetBp.y - (pad?.top ?? 0),
        );
        state.clearActiveComment();
        setCommentDraft({
          id: 'draft-comment',
          isDraft: true,
          bpId: targetBp.id,
          x: localPosition.x,
          y: localPosition.y,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        });
        return;
      }
      if (!drawType) return;
      if (drawType === 'pen') {
        e.preventDefault();
        e.stopPropagation();
        const rect = containerRef.current.getBoundingClientRect();
        const { x: panX, y: panY, scale } = state.viewport;
        const worldX = (e.clientX - rect.left - panX) / scale;
        const worldY = (e.clientY - rect.top - panY) / scale;
        let targetBpId = null;
        for (const bp of Object.values(state.breakpointDefs)) {
          if (worldX >= bp.x && worldX <= bp.x + bp.width && worldY >= bp.y && worldY <= bp.y + bp.height) {
            targetBpId = bp.id;
            break;
          }
        }
        if (!targetBpId) return;
        if (resolvePenDraftCloseIntent(penDraft, targetBpId, worldX, worldY, scale)) {
          e.preventDefault();
          e.stopPropagation();
          commitPenDraft({ ...penDraft, closed: true });
          return;
        }
        setPenDraft((current) => {
          const nextPoint = { x: worldX, y: worldY, inX: worldX, inY: worldY, outX: worldX, outY: worldY };
          const nextDraft = current && current.bpId === targetBpId
            ? { ...current, closed: false, points: [...current.points, nextPoint] }
            : { bpId: targetBpId, closed: false, points: [nextPoint] };
          drag.current = {
            type: 'pen-create-point',
            bpId: targetBpId,
            pointIndex: nextDraft.points.length - 1,
            startMX: e.clientX,
            startMY: e.clientY,
            finalizeOnUp: e.detail >= 2 && nextDraft.points.length > 1,
          };
          setInteracting(true);
          return nextDraft;
        });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current.getBoundingClientRect();
      const { x: panX, y: panY, scale } = state.viewport;
      const worldX = (e.clientX - rect.left - panX) / scale;
      const worldY = (e.clientY - rect.top  - panY) / scale;
      drag.current = {
        type: 'draw', drawType,
        startMX: e.clientX, startMY: e.clientY,
        startWorldX: worldX, startWorldY: worldY,
      };
      setDrawRect({ left: e.clientX - rect.left, top: e.clientY - rect.top, width: 0, height: 0 });
    };
    window.addEventListener('mousedown', handleCaptureDown, true);
    return () => window.removeEventListener('mousedown', handleCaptureDown, true);
  }, [commentDraft, commitPenDraft, penDraft, resolvePenDraftCloseIntent, setCommentDraft]); // reads store directly; local draft setter is stable
  // ── Start move from overlay (for elements clipped by artboard overflow) ───
  const startMoveFromOverlay = useCallback((e, bpId, element) => {
    const { getAllElements } = useEditorStore.getState();
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
    const page = useEditorStore.getState().getCurrentPage();
    const domEl = boardDom?.querySelector(`[data-id="${el.id}"]`);
    const rect = domEl?.getBoundingClientRect() ?? e.currentTarget?.getBoundingClientRect?.();
    const scale = useEditorStore.getState().viewport.scale;
    const bpDef = useEditorStore.getState().breakpointDefs[bpId];
    const metrics = getElementWorldMetrics({ el, bpId, bp: bpDef, page, boardDom, scale });
    const ghostW = rect ? (rect.width / scale) : (resolved.width ?? el.base?.width ?? 100);
    const ghostH = rect ? (rect.height / scale) : (resolved.height ?? el.base?.height ?? 40);
    const startWorldX = metrics?.modelWorldX ?? (resolved.x ?? el.base?.x ?? 0);
    const startWorldY = metrics?.modelWorldY ?? (resolved.y ?? el.base?.y ?? 0);
    const pointerWorld = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
    const pointerPoint = { x: pointerWorld.worldX, y: pointerWorld.worldY };
    const rotationValue = Math.abs(parseFloat(resolved.rotation) || 0);
    const rotationDegrees = parseFloat(resolved.rotation) || 0;
    const center = { x: startWorldX + ghostW / 2, y: startWorldY + ghostH / 2 };
    const unrotatedPointer = rotationValue > 0.01
      ? rotatePointAround(pointerPoint, center, -rotationDegrees)
      : pointerPoint;
    const isGeomOffCanvas = !el.parentId && bpDef
      ? ((resolved.x ?? 0) + ghostW <= 0 || (resolved.x ?? 0) >= bpDef.width || (resolved.y ?? 0) + ghostH <= 0 || (resolved.y ?? 0) >= bpDef.height)
      : false;
    const grabOffsetClientX = rect ? (e.clientX - rect.left) : 0;
    const grabOffsetClientY = rect ? (e.clientY - rect.top) : 0;
    drag.current = {
      type: 'element-drag',
      dragMode: 'free',
      bpId,
      elementId: el.id,
      startMX: e.clientX, startMY: e.clientY,
      startWorldX,
      startWorldY,
      previewStartWorldX: metrics?.domWorldX ?? startWorldX,
      previewStartWorldY: metrics?.domWorldY ?? startWorldY,
      pointerOffsetWorldX: pointerWorld.worldX - startWorldX,
      pointerOffsetWorldY: pointerWorld.worldY - startWorldY,
      localAnchorX: unrotatedPointer.x - startWorldX,
      localAnchorY: unrotatedPointer.y - startWorldY,
      rotation: rotationDegrees,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      layoutW: resolved.width ?? el.base?.width ?? 100,
      layoutH: resolved.height ?? el.base?.height ?? 40,
      origParentId: el.parentId ?? null,
      origPositionType: resolved.positionType ?? 'absolute',
      origWasFlow: false,
      origWasOffCanvas: isGeomOffCanvas,
      hasRotation: rotationValue > 0.01,
      ghostBgColor: resolved.styles?.backgroundColor ?? null,
      ghostW,
      ghostH,
      ghostClientW: rect?.width ?? ghostW * scale,
      ghostClientH: rect?.height ?? ghostH * scale,
      grabOffsetClientX,
      grabOffsetClientY,
      grabOffsetWorldX: grabOffsetClientX / scale,
      grabOffsetWorldY: grabOffsetClientY / scale,
    };
    setDraggingElementId(el.id);
    setDraggingElementBpId(bpId);
    setInteracting(true);
  }, [getProjectedWorldPoint, setInteracting, setDraggingElementBpId, setDraggingElementId]);
  // ── Start artboard drag (called from Artboard header) ───────
  const startArtboardDrag = useCallback((e, bpId) => {
    const bp = useEditorStore.getState().breakpointDefs[bpId];
    drag.current = {
      type: 'artboard-move', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startBpX: bp.x, startBpY: bp.y,
    };
    setInteracting(true);
  }, [setInteracting]);

  // ── Start artboard resize (drag bottom handle) ────────────
  const startArtboardResize = useCallback((e, bpId) => {
    e.stopPropagation();
    const bp = useEditorStore.getState().breakpointDefs[bpId];
    drag.current = {
      type: 'artboard-resize', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startH: bp.height,
    };
    setInteracting(true);
  }, [setInteracting]);

  // ── Start artboard padding drag ──────────────────────────
  const startArtboardPaddingDrag = useCallback((e, bpId, side) => {
    e.stopPropagation();
    const page = useEditorStore.getState().getCurrentPage();
    const pad  = resolvePagePadding(page?.padding, bpId);
    drag.current = {
      type: 'artboard-padding', bpId, side,
      startMX: e.clientX, startMY: e.clientY,
      startPad: { ...pad },
    };
    setInteracting(true);
  }, [setInteracting]);
  // ── Start artboard gap drag ───────────────────────────
  const startArtboardGapDrag = useCallback((e, bpId) => {
    e.stopPropagation();
    const page   = useEditorStore.getState().getCurrentPage();
    const layout = resolvePageLayout(page?.layout, bpId);
    if (!layout) return;
    drag.current = {
      type: 'artboard-gap', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startGap: layout.gap ?? 0,
      isRow: layout.flexDirection === 'row',
      layout: { ...layout },
    };
    setGapDragInfo({ value: layout.gap ?? 0, clientX: e.clientX, clientY: e.clientY });
    setInteracting(true);
  }, [setInteracting]);
  // ── Start viewport-fold drag ───────────────────────────────
  const startViewportFoldDrag = useCallback((e, bpId, startFoldH) => {
    const allEls0 = useEditorStore.getState().getAllElements();
    // Capture current y of fixed root elements constrained to bottom so they can follow fold
    const initialFixedEls = allEls0
      .filter(el => !el.parentId)
      .flatMap(el => {
        const r = resolveElement(el, bpId);
        if (r.positionType !== 'fixed') return [];
        if (!r.constraints?.bottom) return [];
        return [{ id: el.id, y: r.y ?? 0 }];
      });
    drag.current = {
      type: 'viewport-fold', bpId,
      startMX: e.clientX, startMY: e.clientY,
      startFoldH,
      initialFixedEls,
    };
    setInteracting(true);
  }, [setInteracting]);

  // ── Start element padding drag ─────────────────────────────
  const startElementPaddingDrag = useCallback((e, bpId, elementId, side) => {
    e.stopPropagation();
    e.preventDefault();
    const el = useEditorStore.getState().getAllElements().find(el => el.id === elementId);
    if (!el) return;
    const s = resolveElement(el, bpId).styles ?? {};
    const toNum = v => typeof v === 'number' ? v : parseFloat(v) || 0;
    const startPad = {
      paddingTop:    toNum(s.paddingTop),
      paddingRight:  toNum(s.paddingRight),
      paddingBottom: toNum(s.paddingBottom),
      paddingLeft:   toNum(s.paddingLeft),
    };
    drag.current = {
      type: 'element-padding', bpId, elementId, side,
      startMX: e.clientX, startMY: e.clientY,
      startPad,
    };
    const capKey = side.charAt(0).toUpperCase() + side.slice(1);
    setPaddingDragInfo({ side, value: startPad[`padding${capKey}`], clientX: e.clientX, clientY: e.clientY });
    setInteracting(true);
  }, [setInteracting]);

  // ── Start border-radius drag ──────────────────────────────
  const startRadiusDrag = useCallback((e, bpId, elementId, startRadius, corner = null) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = {
      type: 'radius', bpId, elementId, corner,
      startMX: e.clientX, startMY: e.clientY,
      startRadius: startRadius ?? 0,
    };
    setInteracting(true);
  }, [setInteracting]);

  const startGradientDrag = useCallback((e, bpId, element, mode, payload = {}) => {
    e.stopPropagation();
    e.preventDefault();
    const gradientType = payload.overlay?.type ?? (mode.startsWith('radial') ? 'radial' : 'linear');
    drag.current = {
      type:
        mode === 'stop' ? 'gradient-stop'
          : mode === 'radial-center' ? 'gradient-radial-center'
            : mode === 'radial-radius' ? 'gradient-radial-radius'
              : 'gradient-linear-handle',
      bpId,
      elementId: element.id,
      startMX: e.clientX,
      startMY: e.clientY,
      handle: mode,
      gradientType,
      stopIndex: payload.stopIndex ?? null,
      lineStart: payload.lineStart ?? null,
      lineEnd: payload.lineEnd ?? null,
      centerWorldX: payload.center?.x ?? 0,
      centerWorldY: payload.center?.y ?? 0,
      selectionRotation: payload.selectionRotation ?? 0,
      worldX: payload.worldX ?? 0,
      worldY: payload.worldY ?? 0,
      overlayW: payload.overlayW ?? 0,
      overlayH: payload.overlayH ?? 0,
      radius: payload.radius ?? 0,
    };
    setGradientDragOverlay(payload.overlay ?? null);
    setInteracting(true);
  }, [setInteracting]);

  const startVectorPointDrag = useCallback((e, bpId, element, pointIndex, handleMode = 'anchor', frameWorldX = 0, frameWorldY = 0) => {
    e.stopPropagation();
    e.preventDefault();
    const resolved = resolveElement(element, bpId);
    setActiveVectorPoint({ elementId: element.id, bpId, pointIndex });
    drag.current = {
      type: 'vector-point',
      bpId,
      elementId: element.id,
      pointIndex,
      handleMode,
      frameWorldX,
      frameWorldY,
      localX: resolved.x ?? 0,
      localY: resolved.y ?? 0,
      startMX: e.clientX,
      startMY: e.clientY,
    };
    setInteracting(true);
  }, [setActiveVectorPoint, setInteracting]);

  const startVectorResize = useCallback((e, bpId, element, handle, frameWorldX, frameWorldY, vectorWidth, vectorHeight, centerClientX, centerClientY) => {
    e.stopPropagation();
    e.preventDefault();
    const state = useEditorStore.getState();
    let resolved = resolveElement(element, bpId);
    let vectorData = getVectorShapeData(resolved) || getVectorShapeData(element);
    if (!vectorData) return;
    const reframedVector = reframeVectorShapeData(vectorData);
    const needsNormalization = Math.abs(reframedVector.offsetX) > 0.001
      || Math.abs(reframedVector.offsetY) > 0.001
      || Math.abs(reframedVector.width - (resolved.width ?? reframedVector.width)) > 0.001
      || Math.abs(reframedVector.height - (resolved.height ?? reframedVector.height)) > 0.001;
    if (needsNormalization) {
      resolved = {
        ...resolved,
        x: (resolved.x ?? 0) + reframedVector.offsetX,
        y: (resolved.y ?? 0) + reframedVector.offsetY,
        width: reframedVector.width,
        height: reframedVector.height,
        vectorData: reframedVector.vectorData,
      };
      vectorData = reframedVector.vectorData;
      frameWorldX += reframedVector.offsetX;
      frameWorldY += reframedVector.offsetY;
      vectorWidth = reframedVector.width;
      vectorHeight = reframedVector.height;
    }
    const pageLayout = resolvePageLayout(state.getCurrentPage()?.layout, bpId);
    const bp = state.breakpointDefs[bpId] ?? null;
    const pinToAbsoluteLayout = !element.parentId
      && pageLayout !== null
      && !resolved.absoluteInLayout
      && resolved.positionType !== 'fixed';
    const originLocalX = pinToAbsoluteLayout && bp ? Math.round(frameWorldX - bp.x) : (resolved.x ?? 0);
    const originLocalY = pinToAbsoluteLayout && bp ? Math.round(frameWorldY - bp.y) : (resolved.y ?? 0);
    drag.current = {
      type: String(handle).startsWith('rotate-') ? 'vector-rotate' : 'vector-resize',
      bpId,
      elementId: element.id,
      handle,
      startMX: e.clientX,
      startMY: e.clientY,
      startX: originLocalX,
      startY: originLocalY,
      startRotation: parseFloat(resolved.rotation) || 0,
      lockAspectRatio: resolved.lockAspectRatio === true,
      originFrameWorldX: frameWorldX,
      originFrameWorldY: frameWorldY,
      originVectorWidth: vectorWidth,
      originVectorHeight: vectorHeight,
      originX: originLocalX,
      originY: originLocalY,
      originWidth: resolved.width ?? vectorWidth,
      originHeight: resolved.height ?? vectorHeight,
      pinToAbsoluteLayout,
      frameWorldX,
      frameWorldY,
      startVectorWidth: vectorWidth,
      startVectorHeight: vectorHeight,
      startVectorData: vectorData,
      centerClientX,
      centerClientY,
    };
    clearActiveVectorPoint();
    setInteracting(true);
  }, [clearActiveVectorPoint, setInteracting]);

  const insertVectorPoint = useCallback((event, bpId, element, frameWorldX, frameWorldY) => {
    const resolved = resolveElement(element, bpId);
    const vectorData = getVectorShapeData(resolved) || getVectorShapeData(element);
    if (!vectorData || vectorData.kind === 'line') return;
    const pointer = getProjectedWorldPoint(event.clientX, event.clientY, 0, 0);
    const localPoint = { x: pointer.worldX - frameWorldX, y: pointer.worldY - frameWorldY };
    const closestSegment = findClosestVectorSegment(vectorData, localPoint);
    if (!closestSegment) return;
    const insertion = insertVectorAnchorAtSegment(vectorData, closestSegment.segmentIndex, closestSegment.t);
    if (insertion.insertedIndex < 0) return;
    commitVectorShapeData(element.id, bpId, resolved, insertion.vectorData);
    setActiveVectorPoint({ elementId: element.id, bpId, pointIndex: insertion.insertedIndex });
    pushHistory();
  }, [commitVectorShapeData, getProjectedWorldPoint, pushHistory, setActiveVectorPoint]);


  // ── Select artboard (deselects any element) ───────────────
  const onSelectArtboard = useCallback((bpId) => {
    setArtboardSel(bpId);
    setSelection(null);
    setDrilled(null);
  }, [setArtboardSel, setSelection, setDrilled]);

  // ── Start element drag (called from child) ─────────────────
  // When an element is selected, clear artboard selection
  const startElementDrag = useCallback((e, bpId, element) => {
    e.stopPropagation();
    setArtboardSel(null);
    const { getAllElements } = useEditorStore.getState();
    const clickedEl = getAllElements().find(ee => ee.id === element.id) ?? element;
    const activeSelection = useEditorStore.getState().selection;
    const selectedIds = activeSelection?.bpId === bpId ? getSelectionElementIds(activeSelection) : [];
    const dragSelectionIds = selectedIds.includes(clickedEl.id) ? selectedIds : [clickedEl.id];
    const dragElementId = dragSelectionIds[0] ?? clickedEl.id;
    const el = getAllElements().find(ee => ee.id === dragElementId) ?? clickedEl;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    const page0 = useEditorStore.getState().getCurrentPage();
    const boardDom0 = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
    const metrics = getElementWorldMetrics({
      el,
      bpId,
      bp: useEditorStore.getState().breakpointDefs[bpId],
      page: page0,
      boardDom: boardDom0,
      scale: useEditorStore.getState().viewport.scale,
    });
    const pointerWorld = getProjectedWorldPoint(e.clientX, e.clientY, 0, 0);
    if (!isElementSelected(activeSelection, clickedEl.id, bpId)) {
      setSelection({ elementId: dragElementId, bpId });
    }

    if (dragSelectionIds.length > 1) {
      const groupItems = dragSelectionIds
        .map((id) => getAllElements().find((candidate) => candidate.id === id))
        .filter(Boolean)
        .map((item) => {
          const itemResolved = resolveElement(item, bpId);
          const groupIsFlow = ['relative', 'sticky'].includes(itemResolved.positionType ?? 'absolute')
            || (!item.parentId && page0?.layout?.[bpId] != null && !itemResolved.absoluteInLayout && itemResolved.positionType !== 'fixed');
          return {
            id: item.id,
            locked: !!item.locked,
            hasRotation: Math.abs(parseFloat(itemResolved.rotation) || 0) > 0.01,
            isFlow: groupIsFlow,
            startX: itemResolved.x ?? item.base?.x ?? 0,
            startY: itemResolved.y ?? item.base?.y ?? 0,
          };
        });
      const canGroupDrag = groupItems.length > 1 && groupItems.every((item) => !item.locked && !item.hasRotation && !item.isFlow);
      if (canGroupDrag) {
        drag.current = {
          type: 'multi-element-drag',
          bpId,
          elementIds: dragSelectionIds,
          startMX: e.clientX,
          startMY: e.clientY,
          items: groupItems,
        };
        setInteracting(true);
        return;
      }
    }
    const domEl = document.querySelector(`.fb-artboard[data-bp="${bpId}"] [data-id="${dragElementId}"]`) ?? e.currentTarget;
    const computedPosition = domEl ? window.getComputedStyle(domEl).position : null;
    const bpDef0 = useEditorStore.getState().breakpointDefs[bpId];
    const elX0 = resolved.x ?? el.base?.x ?? 0;
    const elY0 = resolved.y ?? el.base?.y ?? 0;
    const elW0 = resolved.width ?? el.base?.width ?? 100;
    const elH0 = resolved.height ?? el.base?.height ?? 40;
    const isGeomOffCanvas = !el.parentId && bpDef0
      ? (elX0 + elW0 <= 0 || elX0 >= bpDef0.width || elY0 + elH0 <= 0 || elY0 >= bpDef0.height)
      : false;
    // Flow context: explicitly relative, OR root-level element in auto-layout artboard
    // that hasn't been pinned as absoluteInLayout (matches CanvasElement's effectiveRelative logic).
    // Root auto-layout exceptions that are geometrically off-canvas are not flow items.
    const pgLayout = resolvePageLayout(page0?.layout, bpId);
    const heuristicFlowCtx = ['relative', 'sticky'].includes(resolved.positionType ?? 'absolute')
      || (!el.parentId && pgLayout !== null && !resolved.absoluteInLayout
          && resolved.positionType !== 'fixed' && !isGeomOffCanvas);
    const isFlowCtx = computedPosition != null
      ? computedPosition === 'relative' || computedPosition === 'sticky'
      : heuristicFlowCtx;
    const origPositionType = isFlowCtx ? (resolved.positionType ?? 'relative') : (resolved.positionType ?? 'absolute');
    // For ghost sizing during reorder drag, try to get actual rendered dimensions from DOM
    let ghostW = resolved.width ?? 100;
    let ghostH = resolved.height ?? 40;
    let ghostClientW = ghostW * useEditorStore.getState().viewport.scale;
    let ghostClientH = ghostH * useEditorStore.getState().viewport.scale;
    let grabOffsetClientX = ghostClientW / 2;
    let grabOffsetClientY = ghostClientH / 2;
    const rotationValue = Math.abs(parseFloat(resolved.rotation) || 0);
    if (domEl) {
      const dr = domEl.getBoundingClientRect();
      const sc0 = useEditorStore.getState().viewport.scale;
      ghostClientW = dr.width;
      ghostClientH = dr.height;
      grabOffsetClientX = e.clientX - dr.left;
      grabOffsetClientY = e.clientY - dr.top;
      ghostW = dr.width / sc0;
      ghostH = dr.height / sc0;
    }
    const scale0 = useEditorStore.getState().viewport.scale;
    const startWorldX = (isFlowCtx ? (metrics?.domWorldX ?? metrics?.modelWorldX) : metrics?.modelWorldX) ?? 0;
    const startWorldY = (isFlowCtx ? (metrics?.domWorldY ?? metrics?.modelWorldY) : metrics?.modelWorldY) ?? 0;
    const rotationDegrees = parseFloat(resolved.rotation) || 0;
    const center = { x: startWorldX + ghostW / 2, y: startWorldY + ghostH / 2 };
    const pointerPoint = { x: pointerWorld.worldX, y: pointerWorld.worldY };
    const unrotatedPointer = rotationValue > 0.01
      ? rotatePointAround(pointerPoint, center, -rotationDegrees)
      : pointerPoint;
    // Detect if element currently lives off the artboard (x/y outside bp bounds).
    // IMPORTANT: relative/flow elements are NEVER off-canvas (x/y are meaningless for flow).
    // Used at drop time: off-canvas elements dropped on auto-layout artboard become flow.
    const origWasOffCanvas = isFlowCtx ? false : isGeomOffCanvas;
    drag.current = {
      type: 'element-drag',
      dragMode: isFlowCtx ? 'flow' : 'free',
      bpId,
      elementId: dragElementId,
      startMX: e.clientX, startMY: e.clientY,
      startWorldX,
      startWorldY,
      previewStartWorldX: metrics?.domWorldX ?? startWorldX,
      previewStartWorldY: metrics?.domWorldY ?? startWorldY,
      pointerOffsetWorldX: pointerWorld.worldX - startWorldX,
      pointerOffsetWorldY: pointerWorld.worldY - startWorldY,
      localAnchorX: unrotatedPointer.x - startWorldX,
      localAnchorY: unrotatedPointer.y - startWorldY,
      rotation: rotationDegrees,
      startX: resolved.x ?? el.base?.x ?? 0,
      startY: resolved.y ?? el.base?.y ?? 0,
      layoutW: resolved.width ?? el.base?.width ?? 100,
      layoutH: resolved.height ?? el.base?.height ?? 40,
      origPositionType,
      origParentId: el.parentId ?? null,
      origWasFlow: isFlowCtx,
      origWasOffCanvas,
      hasRotation: rotationValue > 0.01,
      ghostBgColor: resolved.styles?.backgroundColor ?? null,
      ghostW, ghostH,
      ghostClientW, ghostClientH,
      grabOffsetClientX,
      grabOffsetClientY,
      grabOffsetWorldX: grabOffsetClientX / scale0,
      grabOffsetWorldY: grabOffsetClientY / scale0,
    };
    setDraggingElementId(dragElementId);
    setDraggingElementBpId(bpId);
    setInteracting(true);
  }, [getProjectedWorldPoint, setSelection, setArtboardSel, setInteracting, setDraggingElementBpId, setDraggingElementId]);

  // ── Start resize (called from child) ──────────────────────
  const startResize = useCallback((e, bpId, element, handle, payload = null) => {
    e.stopPropagation();
    e.preventDefault();
    const { getAllElements } = useEditorStore.getState();
    const el = getAllElements().find(ee => ee.id === element.id) ?? element;
    const resolved = resolveElement ? resolveElement(el, bpId) : el;
    const shapeKind = getShapePresetKind(resolved) || getShapePresetKind(el);
    if ((shapeKind === 'path' || shapeKind === 'pen') && (String(handle).startsWith('rotate-') || ['nw','n','ne','e','se','s','sw','w'].includes(handle))) {
      setSelection({ elementId: el.id, bpId });
      const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
      const domRect = boardDom?.querySelector(`[data-id="${el.id}"]`)?.getBoundingClientRect() ?? null;
      startVectorResize(
        e,
        bpId,
        el,
        handle,
        payload?.frameWorldX ?? (resolved.x ?? 0),
        payload?.frameWorldY ?? (resolved.y ?? 0),
        payload?.vectorWidth ?? (resolved.width ?? el.base?.width ?? 100),
        payload?.vectorHeight ?? (resolved.height ?? el.base?.height ?? 100),
        domRect ? domRect.left + (domRect.width / 2) : e.clientX,
        domRect ? domRect.top + (domRect.height / 2) : e.clientY,
      );
      return;
    }
    if (String(handle).startsWith('rotate-')) {
      setSelection({ elementId: el.id, bpId });
      const boardDom = document.querySelector(`.fb-artboard[data-bp="${bpId}"]`);
      const domEl = boardDom?.querySelector(`[data-id="${el.id}"]`);
      const rect = domEl?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : e.clientX;
      const centerY = rect ? rect.top + rect.height / 2 : e.clientY;
      const startRotation = typeof resolved.rotation === 'number' ? resolved.rotation : parseFloat(resolved.rotation) || 0;
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;
      drag.current = {
        type: 'rotate', bpId, elementId: el.id, handle,
        startMX: e.clientX, startMY: e.clientY,
        startRotation,
        startAngle,
        centerX,
        centerY,
      };
      setDragHint({ label: `${Math.round(startRotation)}deg`, clientX: e.clientX, clientY: e.clientY });
      setInteracting(true);
      return;
    }
    if (handle === 'se' && isFontResizeTextElement(el, resolved)) {
      setSelection({ elementId: el.id, bpId });
      drag.current = {
        type: 'text-font-size', bpId, elementId: el.id, handle,
        startMX: e.clientX, startMY: e.clientY,
        startFontSize: typeof resolved.styles?.fontSize === 'number'
          ? resolved.styles.fontSize
          : parseFloat(resolved.styles?.fontSize) || 42,
      };
      setTextSizeDragInfo({
        value: typeof resolved.styles?.fontSize === 'number'
          ? resolved.styles.fontSize
          : parseFloat(resolved.styles?.fontSize) || 42,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      setInteracting(true);
      return;
    }
    if (String(handle).startsWith('group-')) {
      const groupHandle = normalizeResizeHandle(handle.slice(6));
      const groupBounds = payload?.groupBounds;
      const groupItems = Array.isArray(payload?.items) ? payload.items : [];
      if (!groupBounds || groupItems.length < 2) return;
      const startHandlePoint = getResizeHandlePoint(groupBounds, groupHandle);
      const lockAspectRatio = groupItems.every((item) => {
        const candidate = getAllElements().find((entry) => entry.id === item.id);
        const candidateResolved = candidate ? (resolveElement ? resolveElement(candidate, bpId) : candidate) : null;
        return candidateResolved?.lockAspectRatio === true;
      });
      drag.current = {
        type: 'multi-resize',
        bpId,
        elementIds: groupItems.map((item) => item.id),
        handle: groupHandle,
        startMX: e.clientX,
        startMY: e.clientY,
        startHandleX: startHandlePoint.x,
        startHandleY: startHandlePoint.y,
        groupBounds,
        items: groupItems,
        lockAspectRatio,
      };
      setInteracting(true);
      return;
    }
    setSelection({ elementId: el.id, bpId });
    const startBounds = {
      minX: resolved.x ?? el.base?.x ?? 0,
      minY: resolved.y ?? el.base?.y ?? 0,
      width: resolved.width ?? el.base?.width ?? 100,
      height: resolved.height ?? el.base?.height ?? 100,
    };
    const startHandlePoint = getResizeHandlePoint(startBounds, handle);
    drag.current = {
      type: 'resize', bpId, elementId: el.id, handle,
      startMX: e.clientX, startMY: e.clientY,
      startX: startBounds.minX,
      startY: startBounds.minY,
      startW: startBounds.width,
      startH: startBounds.height,
      startHandleX: startHandlePoint.x,
      startHandleY: startHandlePoint.y,
      lockAspectRatio: resolved.lockAspectRatio === true,
    };
    setInteracting(true);
  }, [setSelection, setInteracting, startVectorResize]);

  // ── Drop from elements panel ───────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('fb-element-type');
    const componentId = e.dataTransfer.getData('fb-component-id');
    const placement = getPlacementFromClient(e.clientX, e.clientY, useEditorStore.getState().selection?.bpId ?? null);
    if (componentId) {
      const rootId = insertComponentInstance(componentId, {
        bpId: placement?.bpId ?? 'desktop',
        x: placement?.x ?? 80,
        y: placement?.y ?? 80,
      });
      if (rootId) pushHistory();
      return;
    }
    if (!type) return;
    const targetBpId = placement?.bpId ?? 'desktop';
    const elX = placement?.x ?? 80;
    const elY = placement?.y ?? 80;

    if (type === 'frame') {
      const el = createFrame(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'image') {
      const el = createImage(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'video') {
      const el = createVideo(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'embed') {
      const el = createEmbed(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'scroll-sequence') {
      const el = createScrollSequence(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'text') {
      const el = createText(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    } else if (type === 'icon') {
      const el = createIcon(elX, elY);
      addElement(el, null, targetBpId);
      pushHistory();
    }
  }, [addElement, getPlacementFromClient, insertComponentInstance, pushHistory]);

  // ── Drop onto element for nesting ─────────────────────────
  const onDropOntoElement = useCallback((e, targetElementId) => {
    const type = e.dataTransfer.getData('fb-element-type');
    const draggedId = e.dataTransfer.getData('fb-element-id');
    const componentId = e.dataTransfer.getData('fb-component-id');
    const targetElement = useEditorStore.getState().getAllElements().find((entry) => entry.id === targetElementId) ?? null;
    if (useEditorStore.getState().activeSurface === 'page' && targetElement?.componentInstance) {
      return;
    }
    const targetBpId = e.target.closest('.fb-artboard[data-bp]')?.dataset.bp ?? useEditorStore.getState().selection?.bpId ?? 'desktop';
    const assetPayload = parseAssetDragPayload(e.dataTransfer);
    const assetStyleUpdates = getAssetStyleUpdatesForElement(targetElement, assetPayload);
    if (assetStyleUpdates) {
      useEditorStore.getState().updateElementStyles(targetElementId, targetBpId, assetStyleUpdates);
      pushHistory();
      return;
    }
    const localPlacement = getParentPlacementFromClient(e.clientX, e.clientY, targetBpId, targetElementId);
    const localX = localPlacement?.x ?? 20;
    const localY = localPlacement?.y ?? 20;
    if (componentId) {
      const rootId = insertComponentInstance(componentId, { parentId: targetElementId, x: localX, y: localY });
      if (rootId) pushHistory();
      return;
    }
    if (type === 'frame') {
      const el = createFrame(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'image') {
      const el = createImage(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'video') {
      const el = createVideo(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'embed') {
      const el = createEmbed(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'scroll-sequence') {
      const el = createScrollSequence(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'text') {
      const el = createText(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (type === 'icon') {
      const el = createIcon(localX, localY);
      addElement(el, targetElementId, targetBpId);
      pushHistory();
    } else if (draggedId && draggedId !== targetElementId) {
      reparentElement(draggedId, targetElementId);
      pushHistory();
    }
  }, [addElement, getParentPlacementFromClient, insertComponentInstance, reparentElement, pushHistory]);

  const onDragOver = (e) => e.preventDefault();

  const cursor = pendingDraw
    ? ((pendingDraw === 'pen' && penDraftCloseHint) ? 'pointer' : 'crosshair')
    : activeCanvasTool === 'comment'
    ? COMMENT_CURSOR
    : activeCanvasTool === 'pan'
    ? (isPanning.current ? 'grabbing' : 'grab')
    : spacePanCursor
    ? (isPanning.current ? 'grabbing' : 'grab')
    : isPanning.current
    ? 'grabbing'
    : 'default';

  const { x: panX, y: panY, scale } = viewport;
  const baseVariantId = activeSurface === 'component'
    ? getBaseVariantId(componentEditor.variants ?? [], componentEditor.activeVariantId)
    : null;
  const variantStateControlGroups = activeSurface === 'component'
    ? (componentEditor.variants ?? [])
        .filter(isDefaultVariant)
        .map((variant) => {
          const layout = variantRootLayout[variant.id] ?? null;
          if (!layout?.worldRect) return null;
          return {
            variantId: variant.id,
            name: variant.name,
            isSelectedFamily: baseVariantId === variant.id,
            worldRect: layout.worldRect,
            states: ['hover', 'pressed'].map((mode) => {
              const existing = (componentEditor.variants ?? []).find((entry) => entry.mode === mode && entry.parentVariantId === variant.id) ?? null;
              return {
                mode,
                variantId: existing?.id ?? null,
                label: existing ? (mode === 'hover' ? 'Hover' : 'Pressed') : `+ ${mode === 'hover' ? 'Hover' : 'Pressed'}`,
                isActive: existing?.id === componentEditor.activeVariantId,
              };
            }),
          };
        })
        .filter(Boolean)
    : [];
  const activeDragPreview = dragOverlay && drag.current?.type === 'element-drag'
    ? {
        elementId: dragOverlay.elementId,
        bpId: drag.current?.bpId ?? null,
        dx: dragOverlay.worldX - (drag.current?.previewStartWorldX ?? drag.current?.startWorldX ?? dragOverlay.worldX),
        dy: dragOverlay.worldY - (drag.current?.previewStartWorldY ?? drag.current?.startWorldY ?? dragOverlay.worldY),
      }
    : null;
  const rotatedCursorGhost = dragOverlay && drag.current?.type === 'element-drag' && drag.current?.hasRotation
    ? {
        left: (drag.current?.lastMX ?? drag.current?.startMX ?? 0) - (drag.current?.grabOffsetClientX ?? 0),
        top: (drag.current?.lastMY ?? drag.current?.startMY ?? 0) - (drag.current?.grabOffsetClientY ?? 0),
        width: drag.current?.ghostClientW ?? 0,
        height: drag.current?.ghostClientH ?? 0,
        bgColor: dragOverlay.bgColor,
        rotation: drag.current?.rotation ?? 0,
      }
    : null;
  const activeVariantConnector = activeSurface === 'component'
    ? (() => {
        const entry = variantRootLayout[componentEditor.activeVariantId] ?? null;
        return entry?.mode === 'default' ? entry : null;
      })()
    : null;
  const connectorContainerRect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const connectorWorldBounds = {
    width: Math.max(...Object.values(bpDefs).map((entry) => entry.x + entry.width), ...Object.values(variantRootLayout).map((entry) => (entry.worldRect?.left ?? 0) + (entry.worldRect?.width ?? 0)), 0) + 400,
    height: Math.max(...Object.values(bpDefs).map((entry) => entry.y + entry.height), ...Object.values(variantRootLayout).map((entry) => (entry.worldRect?.top ?? 0) + (entry.worldRect?.height ?? 0)), 0) + 400,
  };
  const variantConnectionLines = activeSurface === 'component'
    ? (componentEditor.variants ?? []).flatMap((variant) => {
        if (!isDefaultVariant(variant)) return [];
        if (variant.id !== componentEditor.activeVariantId) return [];
        const source = variantRootLayout[variant.id];
        const target = variant.interaction?.targetVariantId ? variantRootLayout[variant.interaction.targetVariantId] : null;
        if (!source || !target) return [];
        return [{
          key: `${variant.id}-${variant.interaction.targetVariantId}`,
          sourceVariantId: variant.id,
          targetVariantId: variant.interaction.targetVariantId,
          path: buildConnectorPath(source.from, target.to),
          end: target.to,
          trigger: variant.interaction.trigger,
          delay: variant.interaction.delay ?? 0,
        }];
      })
    : [];
  const draftHoverTarget = variantConnectionDraft
    ? resolveVariantRootAtClientPoint(variantConnectionDraft.clientX, variantConnectionDraft.clientY, { excludeVariantId: variantConnectionDraft.sourceVariantId })
    : null;
  const draftEndpoint = draftHoverTarget?.to ?? (variantConnectionDraft
    ? clientToWorldPoint(connectorContainerRect, viewport, { x: variantConnectionDraft.clientX, y: variantConnectionDraft.clientY })
    : null);
  const variantDraftPath = variantConnectionDraft && variantRootLayout[variantConnectionDraft.sourceVariantId]
    ? buildConnectorPath(variantRootLayout[variantConnectionDraft.sourceVariantId].from, draftEndpoint)
    : null;
  const variantInteractionSource = variantInteractionModal
    ? (componentEditor.variants ?? []).find((variant) => variant.id === variantInteractionModal.sourceVariantId) ?? null
    : null;
  const variantInteractionTarget = variantInteractionModal
    ? (componentEditor.variants ?? []).find((variant) => variant.id === variantInteractionModal.targetVariantId) ?? null
    : null;
  const penDraftPath = penDraft?.points?.length ? getVectorShapePathD({ kind: 'path', points: penDraft.points, closed: penDraft.closed === true }) : '';
  const saveVariantInteraction = useCallback((nextInteraction) => {
    if (!variantInteractionModal?.sourceVariantId || !variantInteractionModal?.targetVariantId) return;
    const sourceVariant = (componentEditor.variants ?? []).find((variant) => variant.id === variantInteractionModal.sourceVariantId) ?? null;
    updateComponentEditorVariantInteraction(variantInteractionModal.sourceVariantId, {
      targetVariantId: variantInteractionModal.targetVariantId,
      trigger: nextInteraction.trigger,
      delay: nextInteraction.delay,
      transition: nextInteraction.transition ?? sourceVariant?.interaction?.transition ?? null,
    });
    setVariantInteractionModal(null);
  }, [componentEditor.variants, updateComponentEditorVariantInteraction, variantInteractionModal]);
  const disconnectVariantInteraction = useCallback(() => {
    if (!variantInteractionModal?.sourceVariantId) return;
    updateComponentEditorVariantInteraction(variantInteractionModal.sourceVariantId, null);
    setVariantInteractionModal(null);
  }, [updateComponentEditorVariantInteraction, variantInteractionModal]);

  return (
    <div
      ref={containerRef}
      className="fb-canvas-container"
      style={{ cursor }}
      onMouseDown={onMouseDown}
      onMouseLeave={() => setHoveredId(null)}
      onContextMenu={onContextMenu}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div
        ref={worldRef}
        className="fb-canvas-world"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          '--inv-scale': 1 / scale,
        }}
      >
        {Object.values(bpDefs).map(bp => (
          <Artboard
            key={bp.id}
            bp={bp}
            surfaceMode={activeSurface === 'component' ? 'component' : 'artboard'}
            onStartElementDrag={startElementDrag}
            onStartResize={startResize}
            onStartRotate={startResize}
            onDropOntoElement={onDropOntoElement}
            onStartArtboardDrag={startArtboardDrag}
            onStartArtboardResize={startArtboardResize}
            onStartArtboardPaddingDrag={startArtboardPaddingDrag}
            onStartArtboardGapDrag={startArtboardGapDrag}
            onSelectArtboard={onSelectArtboard}
            isArtboardSelected={artboardSel === bp.id}
            onStartRadiusDrag={startRadiusDrag}
            onStartPaddingDrag={startElementPaddingDrag}
            reorderTarget={reorderTarget}
            dropTargetId={dropTargetId}
            dragPreview={activeDragPreview}
            draggingElementId={draggingElementId}
            draggingElementBpId={draggingElementBpId}
            skipNextBoardClickRef={skipNextArtboardClickRef}
          />
        ))}
        {activeSurface !== 'component' ? <ViewportFoldOverlay onStartFoldDrag={startViewportFoldDrag} /> : null}
        <CommentOverlay
          commentDraft={commentDraft ? {
            ...commentDraft,
            left: (bpDefs[commentDraft.bpId]?.x ?? 0) + (resolvePagePadding(page?.padding, commentDraft.bpId)?.left ?? 0) + (commentDraft.x ?? 0),
            top: (bpDefs[commentDraft.bpId]?.y ?? 0) + (resolvePagePadding(page?.padding, commentDraft.bpId)?.top ?? 0) + (commentDraft.y ?? 0),
          } : null}
          onStartCommentDrag={startCommentDrag}
        />
        <SelectionOverlay onStartResize={startResize} onStartMove={startMoveFromOverlay} onStartRadiusDrag={startRadiusDrag} onStartGradientDrag={startGradientDrag} onStartVectorPointDrag={startVectorPointDrag} onInsertVectorPoint={insertVectorPoint} dragOverlay={dragOverlay} gradientDragOverlay={gradientDragOverlay} />
        {penDraft?.points?.length ? (
          <svg
            className="fb-sel-overlay-svg"
            width={Math.max(...Object.values(bpDefs).map((entry) => entry.x + entry.width), 0) + 400}
            height={Math.max(...Object.values(bpDefs).map((entry) => entry.y + entry.height), 0) + 400}
            style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 10000 }}
          >
            <path
              d={penDraftPath}
              fill={penDraft?.closed ? 'rgba(37,99,235,0.14)' : 'none'}
              stroke="#2563eb"
              strokeWidth={2 / Math.max(scale, MIN_SCALE)}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={penDraft?.closed ? undefined : `${8 / Math.max(scale, MIN_SCALE)} ${6 / Math.max(scale, MIN_SCALE)}`}
            />
            {penDraft.points.flatMap((point, index) => {
              const items = [];
              if (isPathHandleDistinct(point, 'in')) {
                items.push(
                  <g key={`pen-in-${index}`}>
                    <line x1={point.x} y1={point.y} x2={point.inX} y2={point.inY} stroke="rgba(37,99,235,0.7)" strokeWidth={1.5 / Math.max(scale, MIN_SCALE)} vectorEffect="non-scaling-stroke" />
                    <circle cx={point.inX} cy={point.inY} r={4.5 / Math.max(scale, MIN_SCALE)} fill="#fff" stroke="#2563eb" strokeWidth={1.5 / Math.max(scale, MIN_SCALE)} vectorEffect="non-scaling-stroke" />
                  </g>
                );
              }
              if (isPathHandleDistinct(point, 'out')) {
                items.push(
                  <g key={`pen-out-${index}`}>
                    <line x1={point.x} y1={point.y} x2={point.outX} y2={point.outY} stroke="rgba(37,99,235,0.7)" strokeWidth={1.5 / Math.max(scale, MIN_SCALE)} vectorEffect="non-scaling-stroke" />
                    <circle cx={point.outX} cy={point.outY} r={4.5 / Math.max(scale, MIN_SCALE)} fill="#fff" stroke="#2563eb" strokeWidth={1.5 / Math.max(scale, MIN_SCALE)} vectorEffect="non-scaling-stroke" />
                  </g>
                );
              }
              items.push(
                <circle
                  key={`pen-anchor-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={(index === 0 && penDraftCloseHint) ? (7 / Math.max(scale, MIN_SCALE)) : (5 / Math.max(scale, MIN_SCALE))}
                  fill={index === 0 && penDraftCloseHint ? '#fff' : '#2563eb'}
                  stroke="#2563eb"
                  strokeWidth={1.5 / Math.max(scale, MIN_SCALE)}
                  vectorEffect="non-scaling-stroke"
                />
              );
              if (index === 0 && penDraftCloseHint) {
                items.push(
                  <circle
                    key="pen-anchor-close-ring"
                    cx={point.x}
                    cy={point.y}
                    r={11 / Math.max(scale, MIN_SCALE)}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={1.5 / Math.max(scale, MIN_SCALE)}
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={`${4 / Math.max(scale, MIN_SCALE)} ${3 / Math.max(scale, MIN_SCALE)}`}
                  />
                );
              }
              return items;
            })}
          </svg>
        ) : null}
        {alignmentGuides.map((guide, index) => (
          <div
            key={`${guide.orientation}-${index}`}
            className={`fb-alignment-guide fb-alignment-guide--${guide.orientation}`}
            style={guide.orientation === 'vertical'
              ? { left: guide.x, top: guide.start, height: Math.max(0, guide.end - guide.start) }
              : { left: guide.start, top: guide.y, width: Math.max(0, guide.end - guide.start) }}
          />
        ))}
        {reorderGhost && (
          <div
            className="fb-reorder-ghost"
            style={{
              position: 'absolute',
              left: reorderGhost.worldX,
              top: reorderGhost.worldY,
              width: reorderGhost.width,
              height: reorderGhost.height,
              pointerEvents: 'none',
              opacity: 0.65,
              background: reorderGhost.bgColor || undefined,
              transform: (Math.abs(reorderGhost.rotation ?? 0) > 0.01) ? `rotate(${reorderGhost.rotation}deg)` : undefined,
              transformOrigin: 'center center',
            }}
          />
        )}
        {variantStateControlGroups.map((group) => (
          <div
            key={group.variantId}
            className="fb-component-variant-state-controls"
            style={{
              left: group.worldRect.left + (group.worldRect.width / 2),
              top: group.worldRect.top + group.worldRect.height + (18 / Math.max(0.001, scale)),
              transform: `translateX(-50%) scale(${1 / Math.max(0.001, scale)})`,
              transformOrigin: 'top center',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {group.states.map((stateButton) => (
              <button
                key={`${group.variantId}-${stateButton.mode}`}
                type="button"
                className={`fb-component-variant-state-controls__btn${stateButton.variantId ? ' is-created' : ''}${stateButton.isActive ? ' is-active' : ''}`}
                onClick={() => ensureComponentEditorVariantState(stateButton.mode, group.variantId)}
              >
                {stateButton.label}
              </button>
            ))}
            {group.isSelectedFamily ? (
              <button
                type="button"
                className="fb-component-variant-state-controls__btn fb-component-variant-state-controls__btn--add"
                onClick={() => addComponentVariant()}
              >
                + Variant
              </button>
            ) : null}
          </div>
        ))}
        {activeSurface === 'component' && (variantConnectionLines.length || variantDraftPath) ? (
          <svg
            className="fb-variant-connector-layer"
            width={connectorWorldBounds.width}
            height={connectorWorldBounds.height}
          >
            {variantConnectionLines.map((line) => (
              <g key={line.key}>
                <path className="fb-variant-connector-line fb-variant-connector-line--glow" d={line.path} />
                <path
                  className="fb-variant-connector-line fb-variant-connector-line--interactive"
                  d={line.path}
                  style={{ pointerEvents: 'stroke' }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openVariantInteractionModal(line.sourceVariantId, line.targetVariantId);
                  }}
                />
                <circle
                  className="fb-variant-connector-end-dot fb-variant-connector-end-dot--interactive"
                  cx={line.end.x}
                  cy={line.end.y}
                  r="4.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openVariantInteractionModal(line.sourceVariantId, line.targetVariantId);
                  }}
                />
              </g>
            ))}
            {variantDraftPath ? (
              <g>
                <path className="fb-variant-connector-line fb-variant-connector-line--draft" d={variantDraftPath} />
                <circle className="fb-variant-connector-end-dot fb-variant-connector-end-dot--draft" cx={draftEndpoint.x} cy={draftEndpoint.y} r="4.5" />
              </g>
            ) : null}
          </svg>
        ) : null}
        {draftHoverTarget ? (
          <div
            className="fb-variant-connector-target"
            style={{
              left: draftHoverTarget.worldRect.left,
              top: draftHoverTarget.worldRect.top,
              width: draftHoverTarget.worldRect.width,
              height: draftHoverTarget.worldRect.height,
            }}
          />
        ) : null}
        {activeVariantConnector ? (
          <button
            type="button"
            className="fb-variant-connector-handle"
            style={{
              left: activeVariantConnector.connector.x,
              top: activeVariantConnector.connector.y,
              transform: `translate(-50%, -50%) scale(${1 / Math.max(0.001, scale)})`,
              transformOrigin: 'center center',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setVariantConnectionDraft({
                sourceVariantId: activeVariantConnector.variantId,
                clientX: e.clientX,
                clientY: e.clientY,
              });
            }}
            title={`Connect ${activeVariantConnector.name}`}
          >
            <span className="fb-variant-connector-handle__dot" />
            <span className="fb-variant-connector-handle__core" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {(activeComment || commentDraft) ? (
        <CommentCanvasCard
          containerRef={containerRef}
          viewport={viewport}
          commentDraft={commentDraft}
          onSubmitDraft={submitCommentDraft}
          onDiscardDraft={discardCommentDraft}
        />
      ) : null}
      {reorderIndicatorOverlay && (
        <div
          className={`fb-reorder-indicator-overlay fb-reorder-indicator-overlay--${reorderIndicatorOverlay.axis}`}
          style={{
            left: reorderIndicatorOverlay.left,
            top: reorderIndicatorOverlay.top,
            width: reorderIndicatorOverlay.width,
            height: reorderIndicatorOverlay.height,
          }}
        />
      )}
      {rotatedCursorGhost && (
        <div
          className="fb-drag-cursor-ghost"
          style={{
            left: rotatedCursorGhost.left,
            top: rotatedCursorGhost.top,
            width: rotatedCursorGhost.width,
            height: rotatedCursorGhost.height,
            pointerEvents: 'none',
            background: rotatedCursorGhost.bgColor || undefined,
            transform: Math.abs(rotatedCursorGhost.rotation ?? 0) > 0.01 ? `rotate(${rotatedCursorGhost.rotation}deg)` : undefined,
            transformOrigin: 'center center',
          }}
        />
      )}
      {variantInteractionModal && variantInteractionSource && variantInteractionTarget ? (
        <VariantInteractionModal
          sourceName={variantInteractionSource.name}
          targetName={variantInteractionTarget.name}
          initialInteraction={variantInteractionModal.initialInteraction}
          onCancel={() => setVariantInteractionModal(null)}
          onSave={saveVariantInteraction}
          onDisconnect={variantInteractionSource.interaction ? disconnectVariantInteraction : null}
        />
      ) : null}
      {radiusDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: radiusDragInfo.clientX + 14, top: radiusDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          {radiusDragInfo.value}px
        </div>
      )}
      {paddingDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: paddingDragInfo.clientX + 14, top: paddingDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          {paddingDragInfo.side}: {paddingDragInfo.value}px
        </div>
      )}
      {gapDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: gapDragInfo.clientX + 14, top: gapDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          gap: {gapDragInfo.value}px
        </div>
      )}
      {activeSurface !== 'component' && foldDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: foldDragInfo.clientX + 14, top: foldDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          viewport fold: {foldDragInfo.value}px
        </div>
      )}
      {textSizeDragInfo && (
        <div className="fb-radius-tooltip" style={{ position: 'fixed', left: textSizeDragInfo.clientX + 14, top: textSizeDragInfo.clientY - 28, pointerEvents: 'none', zIndex: 99999 }}>
          font size: {textSizeDragInfo.value}px
        </div>
      )}
      {dragHint && (
        <div className="fb-drag-hint" style={{ position: 'fixed', left: dragHint.clientX + 16, top: dragHint.clientY - 30, pointerEvents: 'none', zIndex: 99999 }}>
          {dragHint.label}
        </div>
      )}
      {drawRect && (
        <div style={{
          position: 'fixed',
          left: drawRect.left,
          top: drawRect.top,
          width: drawRect.width,
          height: drawRect.height,
          border: '1.5px dashed var(--accent-light)',
          background: 'rgba(99,179,237,0.08)',
          pointerEvents: 'none',
          zIndex: 99999,
        }} />
      )}
      <CanvasContextMenu
        menu={contextMenu}
        hasClipboard={!!clipboard.current}
        onClose={closeContextMenu}
        onCopy={() => contextMenu?.elementId && copyElementToClipboard(contextMenu.elementId, contextMenu.bpId)}
        onCut={() => contextMenu?.elementId && cutElementToClipboard(contextMenu.elementId, contextMenu.bpId)}
        onPaste={() => contextMenu?.canPasteIntoFrame && pasteClipboardAt({ bpId: contextMenu.bpId, parentId: contextMenu.elementId, clientX: contextMenu.clientX, clientY: contextMenu.clientY })}
        onDelete={() => {
          if (!contextMenu?.elementId) return;
          deleteElement(contextMenu.elementId);
          pushHistory();
        }}
      />
      {componentModal && (
        <ComponentCreateModal
          defaultName={componentModal.defaultName}
          onCancel={() => setComponentModal(null)}
          onSubmit={(name) => {
            const result = createComponentFromElement(componentModal.elementId, name);
            if (result?.componentId) {
              setComponentModal(null);
              pushHistory();
              openComponentEditor(result.componentId);
            }
            return result;
          }}
        />
      )}
    </div>
  );
}
