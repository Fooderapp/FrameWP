import { useEffect, useState } from 'react';

function clamp(value, fallback, min = 0, max = Infinity) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function getTransitionDuration(transition) {
  if (transition?.type === 'realistic' && transition?.springMode === 'physics') {
    return clamp(transition?.physicsDuration, transition?.duration ?? 0.8, 0.05, 20);
  }
  return clamp(transition?.duration, 0.8, 0.05, 20);
}

function getTransitionEasing(transition) {
  if (transition?.type === 'instant') return 'linear';
  if (transition?.type === 'realistic') {
    if (transition?.springMode === 'physics') return 'cubic-bezier(0.16, 1, 0.3, 1)';
    const bounce = clamp(transition?.bounce, 0.2, 0, 1);
    return `cubic-bezier(0.2, ${Math.max(0.55, 1 - (bounce * 0.35))}, 0.2, ${Math.min(1.45, 1 + (bounce * 0.45))})`;
  }
  const bezier = transition?.bezier ?? { x1: 0.44, y1: 0, x2: 0.56, y2: 1 };
  return `cubic-bezier(${clamp(bezier.x1, 0.44, 0, 1)}, ${clamp(bezier.y1, 0, -2, 2)}, ${clamp(bezier.x2, 0.56, 0, 1)}, ${clamp(bezier.y2, 1, -2, 2)})`;
}

function buildLoopTransform(effect, baseTransform = '') {
  const transforms = [];
  const safeBaseTransform = typeof baseTransform === 'string' ? baseTransform.trim() : '';
  if (safeBaseTransform) transforms.push(safeBaseTransform);
  const offsetX = clamp(effect?.offsetX, 0, -4000, 4000);
  const offsetY = clamp(effect?.offsetY, 0, -4000, 4000);
  if (offsetX !== 0 || offsetY !== 0) transforms.push(`translate(${offsetX}px, ${offsetY}px)`);
  const scale = clamp(effect?.scale, 1, 0.1, 4);
  if (scale !== 1) transforms.push(`scale(${scale})`);
  const skewX = clamp(effect?.skewX, 0, -180, 180);
  const skewY = clamp(effect?.skewY, 0, -180, 180);
  if (skewX !== 0 || skewY !== 0) transforms.push(`skew(${skewX}deg, ${skewY}deg)`);
  if (effect?.rotateMode === '3d') {
    transforms.push('perspective(1000px)');
    const rotateX = clamp(effect?.rotateX, 0, -1080, 1080);
    const rotateY = clamp(effect?.rotateY, 0, -1080, 1080);
    const rotateZ = clamp(effect?.rotate, 0, -1080, 1080);
    if (rotateX !== 0) transforms.push(`rotateX(${rotateX}deg)`);
    if (rotateY !== 0) transforms.push(`rotateY(${rotateY}deg)`);
    if (rotateZ !== 0) transforms.push(`rotateZ(${rotateZ}deg)`);
  } else {
    const rotate = clamp(effect?.rotate, 0, -1080, 1080);
    if (rotate !== 0) transforms.push(`rotate(${rotate}deg)`);
  }
  return transforms.join(' ') || 'none';
}

export function getLoopAnimationStyle(animation, baseTransform = '', playState = 'running') {
  if (!animation || animation.type !== 'loop') return null;
  const startOpacity = clamp(animation?.effect?.opacity, 1, 0, 1);
  return {
    '--fb-loop-opacity-from': startOpacity,
    '--fb-loop-transform-from': buildLoopTransform(animation.effect, baseTransform),
    '--fb-loop-transform-to': (typeof baseTransform === 'string' && baseTransform.trim()) ? baseTransform.trim() : 'none',
    animationName: 'fb-loop-animation',
    animationDuration: `${getTransitionDuration(animation.transition)}s`,
    animationTimingFunction: getTransitionEasing(animation.transition),
    animationDelay: `${clamp(animation?.delay, 0, 0, 60)}s`,
    animationIterationCount: 'infinite',
    animationDirection: animation?.loopType === 'mirror' ? 'alternate' : 'normal',
    animationFillMode: 'both',
    animationPlayState: playState,
    transformStyle: animation?.effect?.rotateMode === '3d' ? 'preserve-3d' : undefined,
    willChange: 'transform, opacity',
  };
}

export function useLoopAnimationPlayback(ref, enabled, offscreenBehavior = 'pause') {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!enabled || offscreenBehavior !== 'pause') {
      setIsVisible(true);
      return undefined;
    }
    const node = ref?.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry?.isIntersecting !== false),
      { threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, offscreenBehavior, ref]);

  return enabled && offscreenBehavior === 'pause' && !isVisible ? 'paused' : 'running';
}