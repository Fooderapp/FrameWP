export function isLoopElementType(type) {
  return type === 'loop';
}

export function getDefaultLoopConfig() {
  return {
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
  };
}

export function normalizeLoopConfig(value) {
  const defaults = getDefaultLoopConfig();
  const source = value && typeof value === 'object' ? value : {};
  const querySource = source.query && typeof source.query === 'object' ? source.query : {};
  const layout = typeof source.layout === 'string' ? source.layout.trim().toLowerCase() : defaults.layout;
  const safeLayout = ['vertical', 'horizontal', 'grid'].includes(layout) ? layout : defaults.layout;
  const gap = Number.isFinite(Number(source.gap)) ? Math.max(0, Number(source.gap)) : defaults.gap;
  const columns = Number.isFinite(Number(source.columns)) ? Math.max(1, Math.round(Number(source.columns))) : defaults.columns;
  const minItemWidth = Number.isFinite(Number(source.minItemWidth)) ? Math.max(40, Number(source.minItemWidth)) : defaults.minItemWidth;
  const sourceType = typeof querySource.source === 'string' ? querySource.source.trim().toLowerCase() : defaults.query.source;
  const safeSourceType = ['collection', 'selected', 'variable'].includes(sourceType) ? sourceType : defaults.query.source;
  const collection = typeof querySource.collection === 'string' ? querySource.collection.trim().toLowerCase() : defaults.query.collection;
  const safeCollection = ['posts', 'pages', 'products'].includes(collection) ? collection : defaults.query.collection;
  const limit = Number.isFinite(Number(querySource.limit)) ? Math.max(1, Math.round(Number(querySource.limit))) : defaults.query.limit;
  const order = typeof querySource.order === 'string' ? querySource.order.trim().toLowerCase() : defaults.query.order;
  const safeOrder = ['asc', 'desc'].includes(order) ? order : defaults.query.order;
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
    ...(typeof source.templateRootId === 'string' && source.templateRootId ? { templateRootId: source.templateRootId } : {}),
  };
}
