function coerceUrlCandidate(value) {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (!rawValue) return '';
  if (/^[a-z]+:/i.test(rawValue)) return rawValue;
  if (/^(www\.|[\w-]+\.[a-z]{2,})/i.test(rawValue)) return `https://${rawValue}`;
  return rawValue;
}

function parseUrl(value) {
  const candidate = coerceUrlCandidate(value);
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function normalizeVideoProvider(value) {
  return ['youtube', 'vimeo', 'upload'].includes(value) ? value : 'upload';
}

export function getYouTubeVideoId(value) {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(rawValue)) return rawValue;
  const parsed = parseUrl(rawValue);
  if (!parsed) return '';
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
  }
  if (!host.includes('youtube.com') && !host.includes('youtube-nocookie.com')) return '';
  if (parsed.pathname === '/watch') {
    const id = parsed.searchParams.get('v') ?? '';
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const markerIndex = segments.findIndex((segment) => ['embed', 'shorts', 'live', 'v'].includes(segment));
  const id = markerIndex >= 0 ? (segments[markerIndex + 1] ?? '') : '';
  return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
}

export function getVimeoVideoId(value) {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (/^\d+$/.test(rawValue)) return rawValue;
  const parsed = parseUrl(rawValue);
  if (!parsed) return '';
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (!host.includes('vimeo.com')) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (/^\d+$/.test(segments[index])) return segments[index];
  }
  return '';
}

export function getVideoEmbedUrl(provider, source, options = {}) {
  const normalizedProvider = normalizeVideoProvider(provider);
  const controls = options.controls !== false;
  const loop = options.loop === true;
  const muted = options.muted === true;
  const autoplay = options.autoplay === true;

  if (normalizedProvider === 'youtube') {
    const id = getYouTubeVideoId(source);
    if (!id) return '';
    const params = new URLSearchParams({
      controls: controls ? '1' : '0',
      rel: '0',
      modestbranding: '1',
      playsinline: '1',
    });
    if (loop) {
      params.set('loop', '1');
      params.set('playlist', id);
    }
    if (muted) params.set('mute', '1');
    if (autoplay) params.set('autoplay', '1');
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }

  if (normalizedProvider === 'vimeo') {
    const id = getVimeoVideoId(source);
    if (!id) return '';
    const params = new URLSearchParams({
      controls: controls ? '1' : '0',
      title: '0',
      byline: '0',
      portrait: '0',
      dnt: '1',
    });
    if (loop) params.set('loop', '1');
    if (muted) params.set('muted', '1');
    if (autoplay) params.set('autoplay', '1');
    return `https://player.vimeo.com/video/${id}?${params.toString()}`;
  }

  return '';
}

export function getResolvedVideoSource(provider, source, options = {}) {
  const normalizedProvider = normalizeVideoProvider(provider);
  const normalizedSource = typeof source === 'string' ? source.trim() : '';
  if (normalizedProvider === 'upload') {
    return {
      provider: normalizedProvider,
      src: normalizedSource,
      embedUrl: '',
      isValid: !!normalizedSource,
    };
  }
  const embedUrl = getVideoEmbedUrl(normalizedProvider, normalizedSource, options);
  return {
    provider: normalizedProvider,
    src: normalizedSource,
    embedUrl,
    isValid: !!embedUrl,
  };
}

export function getVideoEmbedLayout(width, height, mode = 'cover') {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const aspectRatio = 16 / 9;
  const containerRatio = safeWidth / safeHeight;
  const normalizedMode = mode === 'contain' ? 'contain' : 'cover';

  const shouldSizeByHeight = normalizedMode === 'contain'
    ? containerRatio > aspectRatio
    : containerRatio < aspectRatio;

  const renderWidth = shouldSizeByHeight ? safeHeight * aspectRatio : safeWidth;
  const renderHeight = shouldSizeByHeight ? safeHeight : (safeWidth / aspectRatio);

  return {
    wrapperStyle: {
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      borderRadius: 'inherit',
      background: '#000',
    },
    frameStyle: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${renderWidth}px`,
      height: `${renderHeight}px`,
      transform: 'translate(-50%, -50%)',
      border: 0,
      background: '#000',
    },
  };
}