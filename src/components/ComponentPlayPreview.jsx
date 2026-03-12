import React, { useEffect, useMemo, useState } from 'react';
import { resolveElement } from '../store/editorStore';
import { familyToFontStack } from './googleFonts';

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override;
  const next = { ...base };
  Object.keys(override).forEach((key) => {
    next[key] = key in base ? deepMerge(base[key], override[key]) : override[key];
  });
  return next;
}

function getSnapshotRoot(snapshot = []) {
  const idSet = new Set(snapshot.map((el) => el.id));
  return snapshot.find((el) => !idSet.has(el.parentId)) ?? snapshot[0] ?? null;
}

function applyVariantOverrides(primarySnapshot = [], overrideSnapshot = []) {
  const baseMap = new Map(primarySnapshot.map((el) => [el.id, structuredClone(el)]));
  const deleteIds = new Set();

  const collectDeleteIds = (elementId) => {
    if (deleteIds.has(elementId)) return;
    deleteIds.add(elementId);
    const element = baseMap.get(elementId);
    (element?.children ?? []).forEach(collectDeleteIds);
  };

  overrideSnapshot.forEach((entry) => {
    if (entry?.__deleted) collectDeleteIds(entry.id);
  });

  const next = primarySnapshot
    .filter((el) => !deleteIds.has(el.id))
    .map((el) => ({ ...structuredClone(el), children: (el.children ?? []).filter((childId) => !deleteIds.has(childId)) }));

  const nextMap = new Map(next.map((el) => [el.id, el]));
  overrideSnapshot.forEach((entry) => {
    if (!entry || entry.__deleted) return;
    if (nextMap.has(entry.id)) {
      const merged = deepMerge(nextMap.get(entry.id), entry);
      delete merged.__added;
      nextMap.set(entry.id, merged);
      return;
    }
    const added = structuredClone(entry);
    delete added.__added;
    nextMap.set(added.id, added);
  });

  return Array.from(nextMap.values());
}

function composeVariantSnapshot(variants = [], activeVariantId = null) {
  const primary = variants[0] ?? null;
  if (!primary) return [];
  if (!activeVariantId || activeVariantId === primary.id) return structuredClone(primary.snapshot ?? []);
  const variant = variants.find((item) => item.id === activeVariantId) ?? primary;
  if (variant.id === primary.id) return structuredClone(primary.snapshot ?? []);
  return applyVariantOverrides(structuredClone(primary.snapshot ?? []), structuredClone(variant.snapshot ?? []));
}

function PreviewNode({ element, indexById, bpId = 'desktop' }) {
  const resolved = resolveElement(element, bpId);
  const styles = resolved?.styles ?? {};
  const widthMode = resolved?.widthMode ?? 'fixed';
  const heightMode = resolved?.heightMode ?? 'fixed';
  const width = resolved?.width ?? 0;
  const height = resolved?.height ?? 0;
  const widthPct = resolved?.widthPct ?? width;
  const heightPct = resolved?.heightPct ?? height;
  const isRelative = (resolved?.positionType ?? 'absolute') === 'relative';
  const backgroundColor = styles?.backgroundColor && !String(styles.backgroundColor).includes('gradient(')
    ? styles.backgroundColor
    : undefined;
  const backgroundImage = String(styles?.backgroundColor ?? '').includes('gradient(')
    ? styles.backgroundColor
    : (styles?.backgroundImage ? `url(${styles.backgroundImage})` : undefined);

  const style = {
    position: isRelative ? 'relative' : 'absolute',
    left: isRelative ? undefined : resolved?.x ?? 0,
    top: isRelative ? undefined : resolved?.y ?? 0,
    width: widthMode === 'hug' ? 'fit-content' : widthMode === 'relative' ? `${widthPct}%` : width,
    height: heightMode === 'hug' ? 'fit-content' : heightMode === 'relative' ? `${heightPct}%` : height,
    minWidth: resolved?.minW ?? undefined,
    maxWidth: resolved?.maxW ?? undefined,
    minHeight: resolved?.minH ?? undefined,
    maxHeight: resolved?.maxH ?? undefined,
    transform: resolved?.rotation ? `rotate(${resolved.rotation}deg)` : undefined,
    backgroundColor,
    backgroundImage,
    backgroundSize: backgroundImage ? (styles?.backgroundSize ?? 'cover') : undefined,
    backgroundPosition: backgroundImage ? (styles?.backgroundPosition ?? 'center center') : undefined,
    backgroundRepeat: styles?.backgroundSize === 'repeat' ? 'repeat' : 'no-repeat',
    borderRadius: styles?.borderRadiusMode === 'independent'
      ? `${styles?.borderRadiusTL ?? styles?.borderRadius ?? 0}px ${styles?.borderRadiusTR ?? styles?.borderRadius ?? 0}px ${styles?.borderRadiusBR ?? styles?.borderRadius ?? 0}px ${styles?.borderRadiusBL ?? styles?.borderRadius ?? 0}px`
      : (typeof styles?.borderRadius === 'number' ? `${styles.borderRadius}px` : styles?.borderRadius),
    border: styles?.borderWidth > 0 ? `${styles.borderWidth}px ${styles.borderStyle || 'solid'} ${styles.borderColor || '#000'}` : undefined,
    opacity: styles?.opacity,
    overflow: styles?.overflow,
    boxShadow: styles?.boxShadow,
    display: styles?.display,
    flexDirection: styles?.flexDirection,
    flexWrap: styles?.flexWrap,
    gap: typeof styles?.gap === 'number' ? `${styles.gap}px` : styles?.gap,
    paddingTop: typeof styles?.paddingTop === 'number' ? `${styles.paddingTop}px` : styles?.paddingTop,
    paddingRight: typeof styles?.paddingRight === 'number' ? `${styles.paddingRight}px` : styles?.paddingRight,
    paddingBottom: typeof styles?.paddingBottom === 'number' ? `${styles.paddingBottom}px` : styles?.paddingBottom,
    paddingLeft: typeof styles?.paddingLeft === 'number' ? `${styles.paddingLeft}px` : styles?.paddingLeft,
    alignItems: styles?.alignItems,
    justifyContent: styles?.justifyContent,
    boxSizing: 'border-box',
  };

  const textStyle = element.type === 'text' ? {
    fontFamily: familyToFontStack(styles?.fontFamily ?? 'Inter'),
    fontWeight: styles?.fontWeight ?? 400,
    fontStyle: styles?.fontStyle ?? 'normal',
    fontSize: `${styles?.fontSize ?? 42}${styles?.fontSizeUnit ?? 'px'}`,
    lineHeight: `${styles?.lineHeight ?? 1.2}${styles?.lineHeightUnit ?? 'em'}`,
    letterSpacing: `${styles?.letterSpacing ?? 0}${styles?.letterSpacingUnit ?? 'em'}`,
    color: styles?.color ?? '#000',
    textAlign: styles?.textAlign ?? 'left',
    textDecoration: styles?.textDecoration ?? 'none',
    whiteSpace: widthMode === 'hug' && heightMode === 'hug' ? 'pre' : 'pre-wrap',
    wordBreak: 'break-word',
    width: '100%',
    display: 'block',
  } : null;

  return (
    <div className="fb-component-play-preview__node" style={style}>
      {element.type === 'image' && resolved?.src ? (
        <img
          src={resolved.src}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: styles?.objectFit ?? 'cover', borderRadius: 'inherit' }}
          draggable={false}
        />
      ) : null}
      {element.type === 'text' ? (
        <div className="fb-component-play-preview__text" style={textStyle}>{resolved?.text ?? 'Text'}</div>
      ) : null}
      {(element.children ?? []).map((childId) => {
        const child = indexById.get(childId);
        return child ? <PreviewNode key={child.id} element={child} indexById={indexById} bpId={bpId} /> : null;
      })}
    </div>
  );
}

export default function ComponentPlayPreview({ componentName, variants, initialVariantId, onClose }) {
  const [activeVariantId, setActiveVariantId] = useState(initialVariantId ?? variants?.[0]?.id ?? null);

  useEffect(() => {
    setActiveVariantId(initialVariantId ?? variants?.[0]?.id ?? null);
  }, [initialVariantId, variants]);

  const variantMap = useMemo(() => new Map((variants ?? []).map((variant) => [variant.id, variant])), [variants]);
  const activeVariant = activeVariantId ? (variantMap.get(activeVariantId) ?? null) : null;
  const activeSnapshot = useMemo(() => composeVariantSnapshot(variants ?? [], activeVariantId), [variants, activeVariantId]);
  const activeRoot = useMemo(() => getSnapshotRoot(activeSnapshot), [activeSnapshot]);
  const indexById = useMemo(() => new Map(activeSnapshot.map((element) => [element.id, element])), [activeSnapshot]);

  const runInteraction = (expectedTrigger) => {
    const interaction = activeVariant?.interaction;
    if (!interaction?.targetVariantId || interaction.trigger !== expectedTrigger) return;
    const delay = Math.max(0, Number(interaction.delay) || 0) * 1000;
    window.setTimeout(() => setActiveVariantId(interaction.targetVariantId), delay);
  };

  useEffect(() => {
    const interaction = activeVariant?.interaction;
    if (!interaction?.targetVariantId || interaction.trigger !== 'appear') return undefined;
    const timeoutId = window.setTimeout(() => setActiveVariantId(interaction.targetVariantId), Math.max(0, Number(interaction.delay) || 0) * 1000);
    return () => window.clearTimeout(timeoutId);
  }, [activeVariant]);

  if (!activeRoot) return null;

  const resolvedRoot = resolveElement(activeRoot, 'desktop');
  const stageStyle = {
    width: resolvedRoot?.width ?? 320,
    height: resolvedRoot?.height ?? 220,
  };

  return (
    <div className="fb-component-play-preview" onMouseDown={onClose}>
      <div className="fb-component-play-preview__panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fb-component-play-preview__header">
          <div>
            <div className="fb-component-play-preview__eyebrow">Play Test</div>
            <div className="fb-component-play-preview__title">{componentName}</div>
          </div>
          <button type="button" className="fb-secondary-btn" onClick={onClose}>Close</button>
        </div>
        <div className="fb-component-play-preview__toolbar">
          {(variants ?? []).map((variant) => (
            <button
              key={variant.id}
              type="button"
              className={`fb-component-play-preview__chip${variant.id === activeVariantId ? ' fb-component-play-preview__chip--active' : ''}`}
              onClick={() => setActiveVariantId(variant.id)}
            >
              {variant.name}
            </button>
          ))}
        </div>
        <div className="fb-component-play-preview__stage-wrap">
          <div
            className="fb-component-play-preview__stage"
            onClick={() => runInteraction('click')}
            onPointerDown={() => runInteraction('click-start')}
            onMouseEnter={() => runInteraction('mouse-enter')}
            onMouseLeave={() => runInteraction('mouse-leave')}
          >
            <div className="fb-component-play-preview__surface" style={stageStyle}>
              <PreviewNode element={activeRoot} indexById={indexById} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
