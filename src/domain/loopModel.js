export function isLoopElementType(type) {
  return type === 'loop';
}

const VALID_MODES = ['loop', 'slideshow', 'ticker', 'carousel'];
const VALID_SOURCES = ['query', 'manual', 'component'];
const VALID_LAYOUTS = ['vertical', 'horizontal', 'grid'];
const VALID_QUERY_SOURCES = ['collection', 'selected', 'variable'];
const VALID_COLLECTIONS = ['posts', 'pages', 'products'];
const VALID_ORDERS = ['asc', 'desc'];
const VALID_SLIDE_TRANSITIONS = ['slide', 'fade', 'none'];
const VALID_TICKER_DIRECTIONS = ['left', 'right', 'up', 'down'];

export function getDefaultSlideshowConfig() {
  return {
    autoplay: true,
    interval: 4000,
    transition: 'slide',
    transitionDuration: 500,
    showArrows: true,
    showDots: true,
    pauseOnHover: true,
    loop: true,
  };
}

export function getDefaultTickerConfig() {
  return {
    speed: 40,
    direction: 'left',
    pauseOnHover: true,
    gap: 24,
  };
}

export function getDefaultCarouselConfig() {
  return {
    visibleItems: 3,
    scrollItems: 1,
    autoplay: false,
    interval: 4000,
    showArrows: true,
    showDots: true,
    pauseOnHover: true,
    loop: true,
    transition: 'slide',
    transitionDuration: 500,
  };
}

export function getDefaultLoopConfig() {
  return {
    mode: 'loop',
    source: 'query',
    componentId: null,
    layout: 'vertical',
    gap: 16,
    columns: 3,
    minItemWidth: 220,
    query: {
      source: 'collection',
      collection: 'posts',
      limit: 6,
      order: 'desc',
      categoryIds: [],
      selectedIds: [],
      variable: null,
    },
    slideshow: getDefaultSlideshowConfig(),
    ticker: getDefaultTickerConfig(),
    carousel: getDefaultCarouselConfig(),
  };
}

function normalizeSlideshowConfig(value) {
  const defaults = getDefaultSlideshowConfig();
  const src = value && typeof value === 'object' ? value : {};
  return {
    autoplay: typeof src.autoplay === 'boolean' ? src.autoplay : defaults.autoplay,
    interval: Number.isFinite(Number(src.interval)) ? Math.max(500, Number(src.interval)) : defaults.interval,
    transition: VALID_SLIDE_TRANSITIONS.includes(src.transition) ? src.transition : defaults.transition,
    transitionDuration: Number.isFinite(Number(src.transitionDuration)) ? Math.max(0, Number(src.transitionDuration)) : defaults.transitionDuration,
    showArrows: typeof src.showArrows === 'boolean' ? src.showArrows : defaults.showArrows,
    showDots: typeof src.showDots === 'boolean' ? src.showDots : defaults.showDots,
    pauseOnHover: typeof src.pauseOnHover === 'boolean' ? src.pauseOnHover : defaults.pauseOnHover,
    loop: typeof src.loop === 'boolean' ? src.loop : defaults.loop,
  };
}

function normalizeTickerConfig(value) {
  const defaults = getDefaultTickerConfig();
  const src = value && typeof value === 'object' ? value : {};
  return {
    speed: Number.isFinite(Number(src.speed)) ? Math.max(1, Number(src.speed)) : defaults.speed,
    direction: VALID_TICKER_DIRECTIONS.includes(src.direction) ? src.direction : defaults.direction,
    pauseOnHover: typeof src.pauseOnHover === 'boolean' ? src.pauseOnHover : defaults.pauseOnHover,
    gap: Number.isFinite(Number(src.gap)) ? Math.max(0, Number(src.gap)) : defaults.gap,
  };
}

function normalizeCarouselConfig(value) {
  const defaults = getDefaultCarouselConfig();
  const src = value && typeof value === 'object' ? value : {};
  return {
    visibleItems: Number.isFinite(Number(src.visibleItems)) ? Math.max(1, Math.round(Number(src.visibleItems))) : defaults.visibleItems,
    scrollItems: Number.isFinite(Number(src.scrollItems)) ? Math.max(1, Math.round(Number(src.scrollItems))) : defaults.scrollItems,
    autoplay: typeof src.autoplay === 'boolean' ? src.autoplay : defaults.autoplay,
    interval: Number.isFinite(Number(src.interval)) ? Math.max(500, Number(src.interval)) : defaults.interval,
    showArrows: typeof src.showArrows === 'boolean' ? src.showArrows : defaults.showArrows,
    showDots: typeof src.showDots === 'boolean' ? src.showDots : defaults.showDots,
    pauseOnHover: typeof src.pauseOnHover === 'boolean' ? src.pauseOnHover : defaults.pauseOnHover,
    loop: typeof src.loop === 'boolean' ? src.loop : defaults.loop,
    transition: VALID_SLIDE_TRANSITIONS.includes(src.transition) ? src.transition : defaults.transition,
    transitionDuration: Number.isFinite(Number(src.transitionDuration)) ? Math.max(0, Number(src.transitionDuration)) : defaults.transitionDuration,
  };
}

export function normalizeLoopConfig(value) {
  const defaults = getDefaultLoopConfig();
  const source = value && typeof value === 'object' ? value : {};
  const querySource = source.query && typeof source.query === 'object' ? source.query : {};

  // Top-level mode & source
  const mode = VALID_MODES.includes(source.mode) ? source.mode : defaults.mode;
  const childSource = VALID_SOURCES.includes(source.source) ? source.source : defaults.source;
  const componentId = typeof source.componentId === 'string' && source.componentId ? source.componentId : null;

  // Layout
  const layout = typeof source.layout === 'string' ? source.layout.trim().toLowerCase() : defaults.layout;
  const safeLayout = VALID_LAYOUTS.includes(layout) ? layout : defaults.layout;
  const gap = Number.isFinite(Number(source.gap)) ? Math.max(0, Number(source.gap)) : defaults.gap;
  const columns = Number.isFinite(Number(source.columns)) ? Math.max(1, Math.round(Number(source.columns))) : defaults.columns;
  const minItemWidth = Number.isFinite(Number(source.minItemWidth)) ? Math.max(40, Number(source.minItemWidth)) : defaults.minItemWidth;

  // Query
  const sourceType = typeof querySource.source === 'string' ? querySource.source.trim().toLowerCase() : defaults.query.source;
  const safeSourceType = VALID_QUERY_SOURCES.includes(sourceType) ? sourceType : defaults.query.source;
  const collection = typeof querySource.collection === 'string' ? querySource.collection.trim().toLowerCase() : defaults.query.collection;
  const safeCollection = VALID_COLLECTIONS.includes(collection) ? collection : defaults.query.collection;
  const limit = Number.isFinite(Number(querySource.limit)) ? Math.max(1, Math.round(Number(querySource.limit))) : defaults.query.limit;
  const order = typeof querySource.order === 'string' ? querySource.order.trim().toLowerCase() : defaults.query.order;
  const safeOrder = VALID_ORDERS.includes(order) ? order : defaults.query.order;
  const categoryIds = Array.isArray(querySource.categoryIds)
    ? querySource.categoryIds
      .map((entry) => parseInt(entry, 10))
      .filter((entry, index, allEntries) => Number.isInteger(entry) && entry > 0 && allEntries.indexOf(entry) === index)
    : [];
  const selectedIds = Array.isArray(querySource.selectedIds)
    ? querySource.selectedIds
      .map((entry) => parseInt(entry, 10))
      .filter((entry, index, allEntries) => Number.isInteger(entry) && entry > 0 && allEntries.indexOf(entry) === index)
    : [];
  const variableSource = querySource.variable && typeof querySource.variable === 'object'
    ? {
        scope: ['page', 'global'].includes(querySource.variable.scope) ? querySource.variable.scope : 'page',
        variableId: typeof querySource.variable.variableId === 'string' && querySource.variable.variableId.trim()
          ? querySource.variable.variableId.trim()
          : '',
      }
    : null;
  const normalizedVariableSource = variableSource?.variableId ? variableSource : null;

  return {
    mode,
    source: childSource,
    componentId,
    layout: safeLayout,
    gap,
    columns,
    minItemWidth,
    query: {
      source: safeSourceType,
      collection: safeCollection,
      limit,
      order: safeOrder,
      categoryIds,
      selectedIds,
      variable: normalizedVariableSource,
    },
    slideshow: normalizeSlideshowConfig(source.slideshow),
    ticker: normalizeTickerConfig(source.ticker),
    carousel: normalizeCarouselConfig(source.carousel),
    ...(typeof source.templateRootId === 'string' && source.templateRootId ? { templateRootId: source.templateRootId } : {}),
  };
}
