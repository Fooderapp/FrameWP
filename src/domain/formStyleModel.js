export const FORM_STYLE_DEFAULTS = {
  fieldGap: 8,
  fieldPaddingTop: 14,
  fieldPaddingRight: 18,
  fieldPaddingBottom: 14,
  fieldPaddingLeft: 18,
  submitPaddingTop: 14,
  submitPaddingRight: 22,
  submitPaddingBottom: 14,
  submitPaddingLeft: 22,
  fontFamily: 'Inter',
  fontSize: 14,
  fontWeight: 500,
  fontStyle: 'normal',
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
  textDecoration: 'none',
  textColor: '#0f172a',
  helperColor: 'rgba(15,23,42,0.58)',
  placeholderColor: 'rgba(15,23,42,0.58)',
  iconColor: 'rgba(15,23,42,0.58)',
  selectIcon: 'caret',
  formStatePreview: 'default',
  formButtonStatePreview: 'default',
  hoverBorderColor: 'rgba(37,99,235,0.32)',
  hoverBackgroundColor: '#ffffff',
  hoverTextColor: '#ffffff',
  focusBorderColor: '#2563eb',
  focusBackgroundColor: '#ffffff',
  focusBoxShadow: '',
  focusRingColor: 'rgba(37,99,235,0.2)',
  focusRingWidth: 3,
  checkedBorderColor: '#2563eb',
  checkedBackgroundColor: '#eff6ff',
  checkedBoxShadow: '',
  stateTransitionDuration: 0.16,
  stateTransitionEasing: 'ease',
  pressedBorderColor: 'rgba(15,23,42,0.22)',
  pressedBackgroundColor: '#111827',
  pressedTextColor: '#ffffff',
  processingBorderColor: 'rgba(15,23,42,0.18)',
  processingBackgroundColor: 'rgba(15,23,42,0.72)',
  processingTextColor: '#ffffff',
  successBorderColor: 'rgba(4,120,87,0.32)',
  successBackgroundColor: '#047857',
  successTextColor: '#ffffff',
  errorBorderColor: 'rgba(185,28,28,0.32)',
  errorBackgroundColor: '#b91c1c',
  errorTextColor: '#ffffff',
  checkboxAccentColor: '#2563eb',
  checkboxSize: 16,
  fileUploadBorderColor: 'rgba(148,163,184,0.55)',
  fileUploadBackground: 'rgba(248,250,252,0.72)',
  captchaLabelColor: '#065f46',
  captchaHelperColor: 'rgba(6,95,70,0.72)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(15,23,42,0.12)',
  backgroundColor: '#ffffff',
  boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
};

function toFiniteNumber(value, fallback) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundToThousandths(value) {
  return Math.round(value * 1000) / 1000;
}

function appendBoxShadow(baseShadow, shadow) {
  const normalizedBase = `${baseShadow ?? ''}`.trim();
  const normalizedShadow = `${shadow ?? ''}`.trim();
  if (!normalizedBase || normalizedBase === 'none') return normalizedShadow || 'none';
  if (!normalizedShadow || normalizedShadow === 'none') return normalizedBase;
  return `${normalizedBase}, ${normalizedShadow}`;
}

export function getFormVisualModel(styles = {}, options = {}) {
  const submit = options.submit === true;
  const fontFamily = `${styles?.fontFamily ?? ''}`.trim() || FORM_STYLE_DEFAULTS.fontFamily;
  const fontSize = Math.max(10, toFiniteNumber(styles?.fontSize, FORM_STYLE_DEFAULTS.fontSize));
  const fontWeight = toFiniteNumber(styles?.fontWeight, submit ? 600 : FORM_STYLE_DEFAULTS.fontWeight);
  const lineHeight = Math.max(0.8, toFiniteNumber(styles?.lineHeight, submit ? 1.2 : FORM_STYLE_DEFAULTS.lineHeight));
  const letterSpacing = toFiniteNumber(styles?.letterSpacing, FORM_STYLE_DEFAULTS.letterSpacing);
  const gap = Math.max(0, toFiniteNumber(styles?.gap, FORM_STYLE_DEFAULTS.fieldGap));
  const paddingTop = Math.max(0, toFiniteNumber(styles?.paddingTop, submit ? FORM_STYLE_DEFAULTS.submitPaddingTop : FORM_STYLE_DEFAULTS.fieldPaddingTop));
  const paddingRight = Math.max(0, toFiniteNumber(styles?.paddingRight, submit ? FORM_STYLE_DEFAULTS.submitPaddingRight : FORM_STYLE_DEFAULTS.fieldPaddingRight));
  const paddingBottom = Math.max(0, toFiniteNumber(styles?.paddingBottom, submit ? FORM_STYLE_DEFAULTS.submitPaddingBottom : FORM_STYLE_DEFAULTS.fieldPaddingBottom));
  const paddingLeft = Math.max(0, toFiniteNumber(styles?.paddingLeft, submit ? FORM_STYLE_DEFAULTS.submitPaddingLeft : FORM_STYLE_DEFAULTS.fieldPaddingLeft));
  const labelFontSize = Math.max(10, Math.round(fontSize * 0.86));
  const helperFontSize = Math.max(11, fontSize - 1);
  const captchaHelperFontSize = Math.max(10, fontSize - 2);
  const controlMinHeight = Math.max(36, roundToThousandths(fontSize * lineHeight + paddingTop + paddingBottom));

  return {
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle: `${styles?.fontStyle ?? FORM_STYLE_DEFAULTS.fontStyle}` || FORM_STYLE_DEFAULTS.fontStyle,
    lineHeight,
    letterSpacing,
    textAlign: `${styles?.textAlign ?? (submit ? 'center' : FORM_STYLE_DEFAULTS.textAlign)}` || (submit ? 'center' : FORM_STYLE_DEFAULTS.textAlign),
    textDecoration: `${styles?.textDecoration ?? FORM_STYLE_DEFAULTS.textDecoration}` || FORM_STYLE_DEFAULTS.textDecoration,
    textColor: `${styles?.color ?? (submit ? '#ffffff' : FORM_STYLE_DEFAULTS.textColor)}` || (submit ? '#ffffff' : FORM_STYLE_DEFAULTS.textColor),
    helperColor: `${styles?.helperColor ?? FORM_STYLE_DEFAULTS.helperColor}` || FORM_STYLE_DEFAULTS.helperColor,
    placeholderColor: `${styles?.placeholderColor ?? FORM_STYLE_DEFAULTS.placeholderColor}` || FORM_STYLE_DEFAULTS.placeholderColor,
    iconColor: `${styles?.iconColor ?? styles?.placeholderColor ?? FORM_STYLE_DEFAULTS.iconColor}` || FORM_STYLE_DEFAULTS.iconColor,
    selectIcon: `${styles?.selectIcon ?? FORM_STYLE_DEFAULTS.selectIcon}` || FORM_STYLE_DEFAULTS.selectIcon,
    gap,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    labelFontSize,
    helperFontSize,
    captchaHelperFontSize,
    controlMinHeight,
    borderWidth: Math.max(0, toFiniteNumber(styles?.borderWidth, FORM_STYLE_DEFAULTS.borderWidth)),
    borderStyle: `${styles?.borderStyle ?? FORM_STYLE_DEFAULTS.borderStyle}` || FORM_STYLE_DEFAULTS.borderStyle,
    borderColor: `${styles?.borderColor ?? FORM_STYLE_DEFAULTS.borderColor}` || FORM_STYLE_DEFAULTS.borderColor,
    backgroundColor: `${styles?.backgroundColor ?? (submit ? '#0f172a' : FORM_STYLE_DEFAULTS.backgroundColor)}` || (submit ? '#0f172a' : FORM_STYLE_DEFAULTS.backgroundColor),
    boxShadow: `${styles?.boxShadow ?? (submit ? '0 8px 18px rgba(15,23,42,0.16)' : FORM_STYLE_DEFAULTS.boxShadow)}` || (submit ? '0 8px 18px rgba(15,23,42,0.16)' : FORM_STYLE_DEFAULTS.boxShadow),
  };
}

export function getFormStateVisualModel(styles = {}, options = {}) {
  const submit = options.submit === true;
  const visualModel = options.visualModel ?? getFormVisualModel(styles, options);
  const rawPreviewState = `${submit ? (styles?.formButtonStatePreview ?? styles?.formStatePreview ?? '') : (styles?.formStatePreview ?? '')}`;
  const previewState = (submit
    ? ['default', 'hover', 'pressed', 'submitting', 'success', 'error']
    : ['default', 'hover', 'focus']
  ).includes(rawPreviewState)
    ? rawPreviewState
    : (submit ? FORM_STYLE_DEFAULTS.formButtonStatePreview : FORM_STYLE_DEFAULTS.formStatePreview);
  const hoverBorderColor = `${styles?.hoverBorderColor ?? visualModel.borderColor ?? FORM_STYLE_DEFAULTS.hoverBorderColor}` || FORM_STYLE_DEFAULTS.hoverBorderColor;
  const hoverBackgroundColor = `${styles?.hoverBackgroundColor ?? visualModel.backgroundColor ?? FORM_STYLE_DEFAULTS.hoverBackgroundColor}` || FORM_STYLE_DEFAULTS.hoverBackgroundColor;
  const hoverTextColor = `${styles?.hoverTextColor ?? visualModel.textColor ?? FORM_STYLE_DEFAULTS.hoverTextColor}` || FORM_STYLE_DEFAULTS.hoverTextColor;
  const focusBorderColor = `${styles?.focusBorderColor ?? FORM_STYLE_DEFAULTS.focusBorderColor}` || FORM_STYLE_DEFAULTS.focusBorderColor;
  const focusBackgroundColor = `${styles?.focusBackgroundColor ?? visualModel.backgroundColor ?? FORM_STYLE_DEFAULTS.focusBackgroundColor}` || FORM_STYLE_DEFAULTS.focusBackgroundColor;
  const focusBoxShadow = `${styles?.focusBoxShadow ?? FORM_STYLE_DEFAULTS.focusBoxShadow}` || '';
  const focusRingColor = `${styles?.focusRingColor ?? FORM_STYLE_DEFAULTS.focusRingColor}` || FORM_STYLE_DEFAULTS.focusRingColor;
  const focusRingWidth = Math.max(0, toFiniteNumber(styles?.focusRingWidth, FORM_STYLE_DEFAULTS.focusRingWidth));
  const focusRingShadow = focusRingWidth > 0 ? `0 0 0 ${roundToThousandths(focusRingWidth)}px ${focusRingColor}` : 'none';
  const checkedBorderColor = `${styles?.checkedBorderColor ?? focusBorderColor ?? FORM_STYLE_DEFAULTS.checkedBorderColor}` || FORM_STYLE_DEFAULTS.checkedBorderColor;
  const checkedBackgroundColor = `${styles?.checkedBackgroundColor ?? focusBackgroundColor ?? FORM_STYLE_DEFAULTS.checkedBackgroundColor}` || FORM_STYLE_DEFAULTS.checkedBackgroundColor;
  const checkedBoxShadow = `${styles?.checkedBoxShadow ?? FORM_STYLE_DEFAULTS.checkedBoxShadow}` || '';
  const stateTransitionDuration = Math.max(0, toFiniteNumber(styles?.stateTransitionDuration, FORM_STYLE_DEFAULTS.stateTransitionDuration));
  const stateTransitionEasing = `${styles?.stateTransitionEasing ?? FORM_STYLE_DEFAULTS.stateTransitionEasing}` || FORM_STYLE_DEFAULTS.stateTransitionEasing;
  const pressedBorderColor = `${styles?.pressedBorderColor ?? hoverBorderColor ?? visualModel.borderColor ?? FORM_STYLE_DEFAULTS.pressedBorderColor}` || FORM_STYLE_DEFAULTS.pressedBorderColor;
  const pressedBackgroundColor = `${styles?.pressedBackgroundColor ?? hoverBackgroundColor ?? visualModel.backgroundColor ?? FORM_STYLE_DEFAULTS.pressedBackgroundColor}` || FORM_STYLE_DEFAULTS.pressedBackgroundColor;
  const pressedTextColor = `${styles?.pressedTextColor ?? hoverTextColor ?? visualModel.textColor ?? FORM_STYLE_DEFAULTS.pressedTextColor}` || FORM_STYLE_DEFAULTS.pressedTextColor;
  const processingBorderColor = `${styles?.processingBorderColor ?? visualModel.borderColor ?? FORM_STYLE_DEFAULTS.processingBorderColor}` || FORM_STYLE_DEFAULTS.processingBorderColor;
  const processingBackgroundColor = `${styles?.processingBackgroundColor ?? visualModel.backgroundColor ?? FORM_STYLE_DEFAULTS.processingBackgroundColor}` || FORM_STYLE_DEFAULTS.processingBackgroundColor;
  const processingTextColor = `${styles?.processingTextColor ?? visualModel.textColor ?? FORM_STYLE_DEFAULTS.processingTextColor}` || FORM_STYLE_DEFAULTS.processingTextColor;
  const successBorderColor = `${styles?.successBorderColor ?? FORM_STYLE_DEFAULTS.successBorderColor}` || FORM_STYLE_DEFAULTS.successBorderColor;
  const successBackgroundColor = `${styles?.successBackgroundColor ?? FORM_STYLE_DEFAULTS.successBackgroundColor}` || FORM_STYLE_DEFAULTS.successBackgroundColor;
  const successTextColor = `${styles?.successTextColor ?? FORM_STYLE_DEFAULTS.successTextColor}` || FORM_STYLE_DEFAULTS.successTextColor;
  const errorBorderColor = `${styles?.errorBorderColor ?? FORM_STYLE_DEFAULTS.errorBorderColor}` || FORM_STYLE_DEFAULTS.errorBorderColor;
  const errorBackgroundColor = `${styles?.errorBackgroundColor ?? FORM_STYLE_DEFAULTS.errorBackgroundColor}` || FORM_STYLE_DEFAULTS.errorBackgroundColor;
  const errorTextColor = `${styles?.errorTextColor ?? FORM_STYLE_DEFAULTS.errorTextColor}` || FORM_STYLE_DEFAULTS.errorTextColor;

  return {
    previewState,
    hoverBorderColor,
    hoverBackgroundColor,
    hoverTextColor,
    focusBorderColor,
    focusBackgroundColor,
    focusShadow: focusBoxShadow,
    focusRingColor,
    focusRingWidth,
    focusBoxShadow: appendBoxShadow(appendBoxShadow(visualModel.boxShadow, focusBoxShadow), focusRingShadow),
    checkedBorderColor,
    checkedBackgroundColor,
    checkedShadow: checkedBoxShadow,
    checkedBoxShadow: appendBoxShadow(visualModel.boxShadow, checkedBoxShadow),
    stateTransitionDuration,
    stateTransitionEasing,
    pressedBorderColor,
    pressedBackgroundColor,
    pressedTextColor,
    processingBorderColor,
    processingBackgroundColor,
    processingTextColor,
    successBorderColor,
    successBackgroundColor,
    successTextColor,
    errorBorderColor,
    errorBackgroundColor,
    errorTextColor,
  };
}

export function getFormSelectPaddingRight(paddingRight) {
  return Math.max(40, paddingRight + 26);
}

export function getFormIndicatorOffset(paddingRight) {
  return Math.max(12, paddingRight);
}