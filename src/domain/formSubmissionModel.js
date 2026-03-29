function makeSubmissionConfigId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeSubmissionMappings(mappings, keyName) {
  if (!Array.isArray(mappings)) return [];
  return mappings.map((entry) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    return {
      id: typeof source.id === 'string' && source.id ? source.id : makeSubmissionConfigId(keyName),
      [keyName]: typeof source[keyName] === 'string' ? source[keyName] : '',
      fieldName: typeof source.fieldName === 'string' ? source.fieldName : '',
    };
  }).filter((entry) => entry[keyName]);
}

export function getDefaultSubmissionActionConfig(legacyActions = null) {
  const source = legacyActions && typeof legacyActions === 'object' ? legacyActions : {};
  return {
    store: { enabled: source.store?.enabled === true },
    email: {
      enabled: source.email?.enabled === true,
      to: typeof source.email?.to === 'string' ? source.email.to : '',
      subject: typeof source.email?.subject === 'string' && source.email.subject ? source.email.subject : 'New form submission',
    },
    webhook: {
      enabled: source.webhook?.enabled === true,
      url: typeof source.webhook?.url === 'string' ? source.webhook.url : '',
    },
    createPost: { enabled: false, status: 'draft', fieldMappings: [], acfMappings: [] },
    createCategory: { enabled: false, fieldMappings: [], acfMappings: [] },
    createProductCategory: { enabled: false, fieldMappings: [], acfMappings: [] },
    createProduct: { enabled: false, status: 'draft', fieldMappings: [], acfMappings: [] },
  };
}

export function normalizeSubmissionActionConfig(actions, legacyActions = null) {
  const defaults = getDefaultSubmissionActionConfig(legacyActions);
  const source = actions && typeof actions === 'object' ? actions : {};
  const hasExplicitStore = source.store && typeof source.store === 'object' && Object.prototype.hasOwnProperty.call(source.store, 'enabled');
  return {
    store: { enabled: hasExplicitStore ? source.store?.enabled === true : defaults.store.enabled === true },
    email: {
      enabled: source.email?.enabled === true,
      to: typeof source.email?.to === 'string' ? source.email.to : defaults.email.to,
      subject: typeof source.email?.subject === 'string' && source.email.subject ? source.email.subject : defaults.email.subject,
    },
    webhook: {
      enabled: source.webhook?.enabled === true,
      url: typeof source.webhook?.url === 'string' ? source.webhook.url : defaults.webhook.url,
    },
    createPost: {
      enabled: source.createPost?.enabled === true,
      status: typeof source.createPost?.status === 'string' && source.createPost.status ? source.createPost.status : 'draft',
      fieldMappings: sanitizeSubmissionMappings(source.createPost?.fieldMappings, 'targetKey'),
      acfMappings: sanitizeSubmissionMappings(source.createPost?.acfMappings, 'fieldKey'),
    },
    createCategory: {
      enabled: source.createCategory?.enabled === true,
      fieldMappings: sanitizeSubmissionMappings(source.createCategory?.fieldMappings, 'targetKey'),
      acfMappings: sanitizeSubmissionMappings(source.createCategory?.acfMappings, 'fieldKey'),
    },
    createProductCategory: {
      enabled: source.createProductCategory?.enabled === true,
      fieldMappings: sanitizeSubmissionMappings(source.createProductCategory?.fieldMappings, 'targetKey'),
      acfMappings: sanitizeSubmissionMappings(source.createProductCategory?.acfMappings, 'fieldKey'),
    },
    createProduct: {
      enabled: source.createProduct?.enabled === true,
      status: typeof source.createProduct?.status === 'string' && source.createProduct.status ? source.createProduct.status : 'draft',
      fieldMappings: sanitizeSubmissionMappings(source.createProduct?.fieldMappings, 'targetKey'),
      acfMappings: sanitizeSubmissionMappings(source.createProduct?.acfMappings, 'fieldKey'),
    },
  };
}

export function normalizeSubmissionFieldEntries(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => {
    const source = field && typeof field === 'object' ? field : {};
    const fieldName = typeof source.fieldName === 'string' ? source.fieldName : '';
    if (!fieldName) return null;
    return {
      id: typeof source.id === 'string' && source.id ? source.id : fieldName,
      fieldName,
      label: typeof source.label === 'string' && source.label ? source.label : fieldName,
      type: typeof source.type === 'string' ? source.type : 'text-field',
      valueType: typeof source.valueType === 'string' ? source.valueType : 'string',
      path: typeof source.path === 'string' && source.path ? source.path : `submission.values.${fieldName}`,
    };
  }).filter(Boolean);
}

export function createSubmissionNodeConfig(fields = [], actions = null) {
  return {
    schemaVersion: 2,
    fields: normalizeSubmissionFieldEntries(fields),
    actions: normalizeSubmissionActionConfig(actions),
  };
}
