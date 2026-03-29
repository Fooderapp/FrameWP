export const FORM_CONTAINER_TYPES = new Set(['form']);

export const FORM_FIELD_TYPES = new Set([
  'text-field',
  'textarea-field',
  'rich-text-editor',
  'radio-group',
  'dropdown',
  'checkbox',
  'file-upload',
  'captcha',
]);

export const FORM_ACTION_TYPES = new Set(['submit-button']);

export const FORM_ELEMENT_TYPES = new Set([
  ...FORM_CONTAINER_TYPES,
  ...FORM_FIELD_TYPES,
  ...FORM_ACTION_TYPES,
]);

export function isFormContainerType(type) {
  return FORM_CONTAINER_TYPES.has(type);
}

export function isFormFieldType(type) {
  return FORM_FIELD_TYPES.has(type);
}

export function isFormActionType(type) {
  return FORM_ACTION_TYPES.has(type);
}

export function isFormSubmitButtonType(type) {
  return type === 'submit-button';
}

export function isFormElementType(type) {
  return FORM_ELEMENT_TYPES.has(type);
}

export function getDefaultFormConfig() {
  return {
    state: 'idle',
    submitLabel: 'Submit',
    successMessage: 'Thanks. Your submission was received.',
    errorMessage: 'Something went wrong. Please try again.',
    actions: {
      store: { enabled: true },
      email: {
        enabled: false,
        to: '',
        subject: 'New form submission',
      },
      webhook: {
        enabled: false,
        url: '',
      },
    },
  };
}

export function normalizeFormConfig(value) {
  const defaults = getDefaultFormConfig();
  const source = value && typeof value === 'object' ? value : {};
  const actions = source.actions && typeof source.actions === 'object' ? source.actions : {};
  return {
    state: typeof source.state === 'string' && source.state ? source.state : defaults.state,
    submitLabel: typeof source.submitLabel === 'string' && source.submitLabel ? source.submitLabel : defaults.submitLabel,
    successMessage: typeof source.successMessage === 'string' && source.successMessage ? source.successMessage : defaults.successMessage,
    errorMessage: typeof source.errorMessage === 'string' && source.errorMessage ? source.errorMessage : defaults.errorMessage,
    actions: {
      store: {
        enabled: actions.store?.enabled !== false,
      },
      email: {
        enabled: actions.email?.enabled === true,
        to: typeof actions.email?.to === 'string' ? actions.email.to : defaults.actions.email.to,
        subject: typeof actions.email?.subject === 'string' && actions.email.subject
          ? actions.email.subject
          : defaults.actions.email.subject,
      },
      webhook: {
        enabled: actions.webhook?.enabled === true,
        url: typeof actions.webhook?.url === 'string' ? actions.webhook.url : defaults.actions.webhook.url,
      },
    },
  };
}

export function getDefaultFormOptions(type) {
  if (type === 'radio-group' || type === 'dropdown') {
    return [
      { id: `opt-${Date.now()}-1`, label: 'Option 1', value: 'option-1' },
      { id: `opt-${Date.now()}-2`, label: 'Option 2', value: 'option-2' },
      { id: `opt-${Date.now()}-3`, label: 'Option 3', value: 'option-3' },
    ];
  }
  return [];
}