const TELEPORT_MARKER = 'FRAMEWP_TELEPORT';

type TeleportSizingMode = 'fixed' | 'hug' | 'fill';

type TeleportNode = {
  kind: 'frame' | 'text' | 'image' | 'vector';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  opacity: number;
  mixBlendMode?: string;
  widthMode?: TeleportSizingMode;
  heightMode?: TeleportSizingMode;
  widthFr?: number;
  heightFr?: number;
  positionType?: 'absolute' | 'relative';
  absoluteInLayout?: boolean;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  borderRadius?: number;
  borderRadiusMode?: 'linked' | 'independent';
  borderRadiusTL?: number;
  borderRadiusTR?: number;
  borderRadiusBR?: number;
  borderRadiusBL?: number;
  borderWidth?: number;
  borderColor?: string;
  overflow?: 'visible' | 'hidden';
  boxShadow?: string;
  blur?: number;
  backdropBlur?: number;
  layout?: {
    flexDirection: 'row' | 'column';
    flexWrap: 'nowrap' | 'wrap';
    gap: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    alignItems: 'flex-start' | 'center' | 'flex-end' | 'stretch';
    justifyContent: 'flex-start' | 'center' | 'flex-end' | 'space-between';
  } | null;
  text?: string;
  richTextHtml?: string;
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  lineHeight?: number;
  lineHeightUnit?: 'px' | 'em';
  letterSpacing?: number;
  letterSpacingUnit?: 'px' | 'em';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  src?: string;
  objectFit?: 'cover' | 'contain';
  svgMarkup?: string;
  vectorKind?: 'svg' | 'line';
  strokeColor?: string;
  strokeWidth?: number;
  children?: TeleportNode[];
};

type TeleportColorStyle = {
  id: string;
  name: string;
  value: string;
  source: 'figma';
  sourceId: string;
};

type TeleportTextStyle = {
  id: string;
  name: string;
  type: 'text';
  source: 'figma';
  sourceId: string;
  styleProps: Record<string, string | number | boolean | null>;
};

type TeleportElementStyle = {
  id: string;
  name: string;
  type: string;
  source: 'figma';
  sourceId: string;
  styleProps: Record<string, string | number | boolean | null>;
};

type TeleportStyleLibrary = {
  colorStyles: TeleportColorStyle[];
  textStyles: TeleportTextStyle[];
  elementStyles: TeleportElementStyle[];
};

type TeleportPayload = {
  marker: typeof TELEPORT_MARKER;
  version: 2;
  source: 'figma';
  copiedAt: string;
  selectionName: string;
  nodeCount: number;
  nodes: TeleportNode[];
  styles?: TeleportStyleLibrary;
};

type UiMessage =
  | { type: 'refresh-selection' }
  | { type: 'cancel' };

type LayoutSizedNode = SceneNode & {
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutGrow?: number;
  layoutAlign?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT';
};

type StyledSceneNode = SceneNode & {
  fillStyleId?: string | PluginAPI['mixed'];
  textStyleId?: string | PluginAPI['mixed'];
  effectStyleId?: string | PluginAPI['mixed'];
  strokeStyleId?: string | PluginAPI['mixed'];
};

type RadiusNode = SceneNode & {
  cornerRadius?: number | PluginAPI['mixed'];
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
};

const imageHashCache = new Map<string, Promise<string>>();
let selectionSyncToken = 0;

function clampNumber(value: number, fallback = 0, min = -100000, max = 100000): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, fallback = 0): number {
  return Math.round(clampNumber(value, fallback) * 1000) / 1000;
}

function escapeHtml(value: string): string {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textContentToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function joinCssDeclarations(declarations: Array<string | null | undefined>): string {
  return declarations.filter(Boolean).join('; ');
}

function rgbaToCss(color: RGBA | RGB | null | undefined, opacityMultiplier = 1): string | null {
  if (!color) return null;
  const alpha = 'a' in color ? clampNumber(color.a, 1, 0, 1) : 1;
  const nextAlpha = Math.max(0, Math.min(1, alpha * opacityMultiplier));
  const red = Math.round(clampNumber(color.r, 0, 0, 1) * 255);
  const green = Math.round(clampNumber(color.g, 0, 0, 1) * 255);
  const blue = Math.round(clampNumber(color.b, 0, 0, 1) * 255);
  return nextAlpha >= 0.999
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${Math.round(nextAlpha * 1000) / 1000})`;
}

function isVisiblePaint(paint: Paint | PluginAPI['mixed']): paint is Paint {
  return paint !== figma.mixed && !!paint && paint.visible !== false;
}

function getVisiblePaints(node: SceneNode): Paint[] {
  if (!('fills' in node) || node.fills === figma.mixed || !Array.isArray(node.fills)) return [];
  return node.fills.filter(isVisiblePaint);
}

function getVisibleStrokes(node: SceneNode): Paint[] {
  if (!('strokes' in node) || !Array.isArray(node.strokes)) return [];
  return node.strokes.filter(isVisiblePaint);
}

function getSolidPaintColor(paints: Paint[]): string | null {
  const solid = paints.find((paint) => paint.type === 'SOLID') as SolidPaint | undefined;
  return solid ? rgbaToCss(solid.color, solid.opacity ?? 1) : null;
}

function getTextCaseCss(textCase: TextCase | null | undefined): 'none' | 'uppercase' | 'lowercase' | 'capitalize' {
  if (textCase === 'UPPER') return 'uppercase';
  if (textCase === 'LOWER') return 'lowercase';
  if (textCase === 'TITLE') return 'capitalize';
  return 'none';
}

function getTextDecorationCss(textDecoration: TextDecoration | null | undefined): 'none' | 'underline' | 'line-through' {
  if (textDecoration === 'UNDERLINE') return 'underline';
  if (textDecoration === 'STRIKETHROUGH') return 'line-through';
  return 'none';
}

function getLetterSpacingCss(letterSpacing: LetterSpacing | null | undefined): { value: number; unit: 'px' | 'em' } {
  if (!letterSpacing) return { value: 0, unit: 'px' };
  if (letterSpacing.unit === 'PERCENT') return { value: round(letterSpacing.value / 100, 0), unit: 'em' };
  return { value: round(letterSpacing.value, 0), unit: 'px' };
}

function getLineHeightCss(lineHeight: LineHeight | null | undefined): { value: number; unit: 'px' | 'em' } {
  if (!lineHeight || lineHeight.unit === 'AUTO') return { value: 1.2, unit: 'em' };
  if (lineHeight.unit === 'PERCENT') return { value: round(lineHeight.value / 100, 1.2), unit: 'em' };
  return { value: round(lineHeight.value, 0), unit: 'px' };
}

function matrixPoint(transform: Transform, x: number, y: number): { x: number; y: number } {
  return {
    x: (transform[0][0] * x) + (transform[0][1] * y) + transform[0][2],
    y: (transform[1][0] * x) + (transform[1][1] * y) + transform[1][2],
  };
}

function gradientStopsToCss(stops: ReadonlyArray<ColorStop>): string {
  return stops
    .map((stop) => `${rgbaToCss(stop.color, 1) ?? 'transparent'} ${round(stop.position * 100, 0)}%`)
    .join(', ');
}

function gradientPaintToCss(paint: GradientPaint): string {
  const stops = gradientStopsToCss(paint.gradientStops);
  if (paint.type === 'GRADIENT_LINEAR') {
    const start = matrixPoint(paint.gradientTransform, 0, 0.5);
    const end = matrixPoint(paint.gradientTransform, 1, 0.5);
    const angle = round(90 + ((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI), 0);
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  if (paint.type === 'GRADIENT_ANGULAR') {
    return `conic-gradient(from 0deg at 50% 50%, ${stops})`;
  }
  return `radial-gradient(circle at 50% 50%, ${stops})`;
}

function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return 'image/png';
}

async function imageHashToDataUrl(imageHash: string | null): Promise<string> {
  if (!imageHash) return '';
  if (!imageHashCache.has(imageHash)) {
    imageHashCache.set(imageHash, (async () => {
      const image = figma.getImageByHash(imageHash);
      if (!image) return '';
      const bytes = await image.getBytesAsync();
      return `data:${detectImageMime(bytes)};base64,${figma.base64Encode(bytes)}`;
    })());
  }
  return imageHashCache.get(imageHash) ?? Promise.resolve('');
}

function mapBlendMode(value: BlendMode | 'PASS_THROUGH' | null | undefined): string {
  if (!value || value === 'NORMAL' || value === 'PASS_THROUGH') return 'normal';
  return `${value}`.toLowerCase().replace(/_/g, '-');
}

function getNodeOpacity(node: SceneNode): number {
  if (!('opacity' in node) || node.opacity == null) return 1;
  return Math.max(0, Math.min(1, node.opacity));
}

function getNodeRotation(node: SceneNode): number {
  if (!('rotation' in node) || node.rotation == null) return 0;
  return round(node.rotation, 0);
}

function getNodeEffects(node: SceneNode): { boxShadow: string; blur: number; backdropBlur: number } {
  if (!('effects' in node) || !Array.isArray(node.effects)) return { boxShadow: '', blur: 0, backdropBlur: 0 };
  const shadows: string[] = [];
  let blur = 0;
  let backdropBlur = 0;
  node.effects.forEach((effect) => {
    if (!effect || effect.visible === false) return;
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const color = rgbaToCss(effect.color, 1);
      if (!color) return;
      const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
      shadows.push(`${inset}${round(effect.offset.x)}px ${round(effect.offset.y)}px ${round(effect.radius)}px ${round(effect.spread ?? 0)}px ${color}`);
      return;
    }
    if (effect.type === 'LAYER_BLUR') {
      blur = Math.max(blur, round(effect.radius, 0));
      return;
    }
    if (effect.type === 'BACKGROUND_BLUR') {
      backdropBlur = Math.max(backdropBlur, round(effect.radius, 0));
    }
  });
  return { boxShadow: shadows.join(', '), blur, backdropBlur };
}

function hasVisibleNodeEffects(node: SceneNode): boolean {
  if (!('effects' in node) || !Array.isArray(node.effects)) return false;
  return node.effects.some((effect) => !!effect && effect.visible !== false && (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW' || effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR'));
}

async function getPaintStyle(paint: Paint | undefined): Promise<Partial<TeleportNode>> {
  if (!paint || paint.visible === false) return {};
  if (paint.type === 'SOLID') {
    return { backgroundColor: rgbaToCss(paint.color, paint.opacity ?? 1) ?? 'transparent' };
  }
  if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND') {
    return { backgroundColor: gradientPaintToCss(paint) };
  }
  if (paint.type === 'IMAGE') {
    const backgroundImage = await imageHashToDataUrl(paint.imageHash);
    if (!backgroundImage) return {};
    if (paint.scaleMode === 'FIT') {
      return { backgroundImage, backgroundSize: 'contain', backgroundPosition: 'center center', objectFit: 'contain' };
    }
    if (paint.scaleMode === 'TILE') {
      return { backgroundImage, backgroundSize: 'repeat', backgroundPosition: 'top left', objectFit: 'cover' };
    }
    return { backgroundImage, backgroundSize: 'cover', backgroundPosition: 'center center', objectFit: 'cover' };
  }
  return {};
}

function getNodeBorder(node: SceneNode): { borderWidth: number; borderColor: string | null } {
  if (!('strokeWeight' in node)) return { borderWidth: 0, borderColor: null };
  const stroke = getVisibleStrokes(node)[0];
  if (!stroke) return { borderWidth: 0, borderColor: null };
  const borderWidth = node.strokeWeight === figma.mixed ? 0 : clampNumber(node.strokeWeight ?? 0, 0, 0, 9999);
  if (borderWidth <= 0) return { borderWidth: 0, borderColor: null };
  if (stroke.type === 'SOLID') return { borderWidth, borderColor: rgbaToCss(stroke.color, stroke.opacity ?? 1) };
  if (stroke.type === 'GRADIENT_LINEAR' || stroke.type === 'GRADIENT_RADIAL' || stroke.type === 'GRADIENT_ANGULAR' || stroke.type === 'GRADIENT_DIAMOND') {
    return { borderWidth, borderColor: gradientPaintToCss(stroke) };
  }
  return { borderWidth, borderColor: null };
}

function getNodeBorderRadiusData(node: SceneNode, width: number, height: number): Partial<TeleportNode> {
  if (node.type === 'ELLIPSE') {
    const radius = round(Math.min(width, height) / 2, 0);
    return { borderRadius: radius, borderRadiusMode: 'linked' };
  }
  const radiusNode = node as RadiusNode;
  if (typeof radiusNode.cornerRadius === 'number') {
    return { borderRadius: clampNumber(radiusNode.cornerRadius, 0, 0, 9999), borderRadiusMode: 'linked' };
  }
  const corners = [
    clampNumber(radiusNode.topLeftRadius ?? 0, 0, 0, 9999),
    clampNumber(radiusNode.topRightRadius ?? 0, 0, 0, 9999),
    clampNumber(radiusNode.bottomRightRadius ?? 0, 0, 0, 9999),
    clampNumber(radiusNode.bottomLeftRadius ?? 0, 0, 0, 9999),
  ];
  if (!corners.some((value) => value > 0)) return { borderRadius: 0, borderRadiusMode: 'linked' };
  if (corners.every((value) => value === corners[0])) return { borderRadius: corners[0], borderRadiusMode: 'linked' };
  return {
    borderRadius: Math.max(...corners),
    borderRadiusMode: 'independent',
    borderRadiusTL: corners[0],
    borderRadiusTR: corners[1],
    borderRadiusBR: corners[2],
    borderRadiusBL: corners[3],
  };
}

function getAbsolutePosition(node: SceneNode): { x: number; y: number } {
  const transform = node.absoluteTransform;
  return {
    x: round(transform[0][2], 0),
    y: round(transform[1][2], 0),
  };
}

function isLayoutContainer(node: BaseNode | null): node is FrameNode | ComponentNode | InstanceNode {
  return !!node && 'layoutMode' in node && (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE');
}

function mapCounterAxisAlign(value: FrameNode['counterAxisAlignItems']): 'flex-start' | 'center' | 'flex-end' | 'stretch' {
  if (value === 'CENTER') return 'center';
  if (value === 'MAX') return 'flex-end';
  return 'flex-start';
}

function mapPrimaryAxisAlign(value: FrameNode['primaryAxisAlignItems']): 'flex-start' | 'center' | 'flex-end' | 'space-between' {
  if (value === 'CENTER') return 'center';
  if (value === 'MAX') return 'flex-end';
  if (value === 'SPACE_BETWEEN') return 'space-between';
  return 'flex-start';
}

function getNodeLayout(node: SceneNode): TeleportNode['layout'] {
  if (!isLayoutContainer(node) || node.layoutMode === 'NONE') return null;
  return {
    flexDirection: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
    flexWrap: node.layoutWrap === 'WRAP' ? 'wrap' : 'nowrap',
    gap: round(node.itemSpacing ?? 0, 0),
    paddingTop: round(node.paddingTop ?? 0, 0),
    paddingRight: round(node.paddingRight ?? 0, 0),
    paddingBottom: round(node.paddingBottom ?? 0, 0),
    paddingLeft: round(node.paddingLeft ?? 0, 0),
    alignItems: mapCounterAxisAlign(node.counterAxisAlignItems),
    justifyContent: mapPrimaryAxisAlign(node.primaryAxisAlignItems),
  };
}

function isVectorLikeNode(node: SceneNode): boolean {
  return node.type === 'VECTOR'
    || node.type === 'LINE'
    || node.type === 'POLYGON'
    || node.type === 'STAR'
    || node.type === 'BOOLEAN_OPERATION';
}

function canExportAsGroupedVector(node: SceneNode): boolean {
  if (!nodeSupportsChildren(node) || !node.children.length) return false;
  if (getNodeLayout(node)) return false;
  if (getVisiblePaints(node).length || getVisibleStrokes(node).length) return false;
  if (hasVisibleNodeEffects(node)) return false;
  return node.children.every((child) => isVectorLikeNode(child as SceneNode));
}

function getTextValue<T>(value: T | PluginAPI['mixed'], fallback: T): T {
  return value === figma.mixed || value == null ? fallback : value;
}

function textAlignToCss(value: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'): 'left' | 'center' | 'right' | 'justify' {
  if (value === 'CENTER') return 'center';
  if (value === 'RIGHT') return 'right';
  if (value === 'JUSTIFIED') return 'justify';
  return 'left';
}

function nodeSupportsChildren(node: SceneNode): node is (SceneNode & ChildrenMixin) {
  return 'children' in node;
}

function getSizingMode(value: 'FIXED' | 'HUG' | 'FILL' | undefined, fallback: TeleportSizingMode = 'fixed'): TeleportSizingMode {
  if (value === 'HUG') return 'hug';
  if (value === 'FILL') return 'fill';
  if (value === 'FIXED') return 'fixed';
  return fallback;
}

function getNodeSizing(node: SceneNode): Pick<TeleportNode, 'widthMode' | 'heightMode' | 'widthFr' | 'heightFr' | 'positionType' | 'absoluteInLayout'> {
  const sizedNode = node as LayoutSizedNode;
  let widthMode = getSizingMode(sizedNode.layoutSizingHorizontal, 'fixed');
  let heightMode = getSizingMode(sizedNode.layoutSizingVertical, 'fixed');
  let widthFr = 1;
  let heightFr = 1;
  let positionType: 'absolute' | 'relative' = 'absolute';
  let absoluteInLayout = false;

  if (node.type === 'TEXT') {
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
      widthMode = 'hug';
      heightMode = 'hug';
    } else if (node.textAutoResize === 'HEIGHT') {
      widthMode = 'fixed';
      heightMode = 'hug';
    }
  }

  const parent = node.parent;
  if (isLayoutContainer(parent) && parent.layoutMode !== 'NONE') {
    if (sizedNode.layoutPositioning === 'ABSOLUTE') {
      positionType = 'absolute';
      absoluteInLayout = true;
    } else {
      positionType = 'relative';
    }
    if (widthMode === 'fill' && typeof sizedNode.layoutGrow === 'number' && sizedNode.layoutGrow > 0) widthFr = round(sizedNode.layoutGrow, 1);
    if (heightMode === 'fill' && typeof sizedNode.layoutGrow === 'number' && sizedNode.layoutGrow > 0) heightFr = round(sizedNode.layoutGrow, 1);
  }

  return {
    widthMode,
    heightMode,
    widthFr,
    heightFr,
    positionType,
    absoluteInLayout,
  };
}

async function getStyleByIdSafe(styleId: string | null | undefined): Promise<BaseStyle | null> {
  if (!styleId) return null;
  if (typeof figma.getStyleByIdAsync === 'function') {
    return await figma.getStyleByIdAsync(styleId);
  }
  return figma.getStyleById(styleId);
}

async function collectTeleportStyles(selection: readonly SceneNode[]): Promise<TeleportStyleLibrary> {
  const colorStyles: TeleportColorStyle[] = [];
  const textStyles: TeleportTextStyle[] = [];
  const elementStyles: TeleportElementStyle[] = [];
  const seen = new Set<string>();

  const visit = async (node: SceneNode): Promise<void> => {
    const styledNode = node as StyledSceneNode;

    if (typeof styledNode.fillStyleId === 'string' && styledNode.fillStyleId) {
      const style = await getStyleByIdSafe(styledNode.fillStyleId);
      const key = `paint:${styledNode.fillStyleId}`;
      if (!seen.has(key) && style?.type === 'PAINT') {
        seen.add(key);
        const paints = getVisiblePaints(node);
        const paintStyle = await getPaintStyle(paints[0]);
        const value = typeof paintStyle.backgroundColor === 'string' && paintStyle.backgroundColor
          ? paintStyle.backgroundColor
          : (typeof paintStyle.backgroundImage === 'string' ? paintStyle.backgroundImage : '');
        if (value) {
          colorStyles.push({
            id: `figma-color-${styledNode.fillStyleId}`,
            name: style.name || node.name || 'Figma Color Style',
            value,
            source: 'figma',
            sourceId: styledNode.fillStyleId,
          });
        }
      }
    }

    if (node.type === 'TEXT' && typeof styledNode.textStyleId === 'string' && styledNode.textStyleId) {
      const style = await getStyleByIdSafe(styledNode.textStyleId);
      const key = `text:${styledNode.textStyleId}`;
      if (!seen.has(key) && style?.type === 'TEXT') {
        seen.add(key);
        const fills = getVisiblePaints(node);
        const textColor = getSolidPaintColor(fills) ?? '#111111';
        textStyles.push({
          id: `figma-text-${styledNode.textStyleId}`,
          name: style.name || node.name || 'Figma Text Style',
          type: 'text',
          source: 'figma',
          sourceId: styledNode.textStyleId,
          styleProps: {
            ...getTextMetrics(node),
            color: textColor,
            fontSizeUnit: 'px',
            textTransform: getTextCaseCss(node.textCase === figma.mixed ? null : node.textCase),
            textDecoration: getTextDecorationCss(node.textDecoration === figma.mixed ? null : node.textDecoration),
          },
        });
      }
    }

    if (typeof styledNode.effectStyleId === 'string' && styledNode.effectStyleId) {
      const style = await getStyleByIdSafe(styledNode.effectStyleId);
      const key = `effect:${styledNode.effectStyleId}`;
      if (!seen.has(key) && style?.type === 'EFFECT') {
        seen.add(key);
        const effects = getNodeEffects(node);
        if (effects.boxShadow || effects.blur || effects.backdropBlur) {
          elementStyles.push({
            id: `figma-effect-${styledNode.effectStyleId}`,
            name: style.name || node.name || 'Figma Effect Style',
            type: 'effect',
            source: 'figma',
            sourceId: styledNode.effectStyleId,
            styleProps: {
              boxShadow: effects.boxShadow,
              blur: effects.blur,
              backdropBlur: effects.backdropBlur,
            },
          });
        }
      }
    }

    if (typeof styledNode.strokeStyleId === 'string' && styledNode.strokeStyleId) {
      const style = await getStyleByIdSafe(styledNode.strokeStyleId);
      const key = `stroke:${styledNode.strokeStyleId}`;
      if (!seen.has(key) && style?.type === 'PAINT') {
        seen.add(key);
        const border = getNodeBorder(node);
        if (border.borderWidth > 0) {
          elementStyles.push({
            id: `figma-stroke-${styledNode.strokeStyleId}`,
            name: style.name || `${node.name || node.type} Stroke`,
            type: 'stroke',
            source: 'figma',
            sourceId: styledNode.strokeStyleId,
            styleProps: {
              borderWidth: border.borderWidth,
              borderColor: border.borderColor ?? 'transparent',
              borderStyle: 'solid',
              strokeWidth: border.borderWidth,
              strokeColor: border.borderColor ?? 'transparent',
              color: border.borderColor ?? 'transparent',
            },
          });
        }
      }
    }

    if (nodeSupportsChildren(node)) {
      for (const child of node.children) {
        await visit(child as SceneNode);
      }
    }
  };

  for (const node of selection) {
    await visit(node);
  }

  return { colorStyles, textStyles, elementStyles };
}

function shouldExportAsImage(node: SceneNode): boolean {
  return !nodeSupportsChildren(node) && getVisiblePaints(node).some((paint) => paint.type === 'IMAGE');
}

function shouldExportAsVector(node: SceneNode): boolean {
  return ['VECTOR', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'].indexOf(node.type) >= 0;
}

async function exportNodeAsPngDataUrl(node: SceneNode): Promise<string> {
  const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
  return `data:image/png;base64,${figma.base64Encode(bytes)}`;
}

function bytesToString(bytes: Uint8Array): string {
  let output = '';
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    output += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return output;
}

async function exportNodeAsSvgMarkup(node: SceneNode): Promise<string> {
  const bytes = await node.exportAsync({ format: 'SVG' });
  return bytesToString(bytes);
}

function inferFontWeight(style: string): number {
  const lower = style.toLowerCase();
  if (lower.includes('thin')) return 100;
  if (lower.includes('extralight') || lower.includes('ultralight')) return 200;
  if (lower.includes('light')) return 300;
  if (lower.includes('medium')) return 500;
  if (lower.includes('semibold') || lower.includes('demibold')) return 600;
  if (lower.includes('extrabold') || lower.includes('ultrabold')) return 800;
  if (lower.includes('black') || lower.includes('heavy')) return 900;
  if (lower.includes('bold')) return 700;
  return 400;
}

function getTextMetrics(node: TextNode): Pick<TeleportNode, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontSize' | 'lineHeight' | 'lineHeightUnit' | 'letterSpacing' | 'letterSpacingUnit' | 'textAlign'> {
  const fontName = getTextValue(node.fontName, { family: 'Inter', style: 'Regular' });
  const lineHeight = node.lineHeight === figma.mixed || node.lineHeight == null
    ? { unit: 'AUTO' as const }
    : node.lineHeight;
  const letterSpacing = getTextValue(node.letterSpacing, { unit: 'PIXELS', value: 0 });
  const lineHeightValue = lineHeight.unit === 'PIXELS'
    ? round(lineHeight.value, 0)
    : lineHeight.unit === 'PERCENT'
      ? round(lineHeight.value / 100, 1.2)
      : 1.2;
  const lineHeightUnit = lineHeight.unit === 'PIXELS' ? 'px' : 'em';
  const letterSpacingValue = letterSpacing.unit === 'PERCENT'
    ? round(letterSpacing.value / 100, 0)
    : round(letterSpacing.value, 0);
  const letterSpacingUnit = letterSpacing.unit === 'PERCENT' ? 'em' : 'px';
  return {
    fontFamily: fontName.family || 'Inter',
    fontWeight: inferFontWeight(fontName.style || 'Regular'),
    fontStyle: `${fontName.style || ''}`.toLowerCase().includes('italic') ? 'italic' : 'normal',
    fontSize: round(getTextValue(node.fontSize, 16), 16),
    lineHeight: lineHeightValue,
    lineHeightUnit,
    letterSpacing: letterSpacingValue,
    letterSpacingUnit,
    textAlign: textAlignToCss(getTextValue(node.textAlignHorizontal, 'LEFT')),
  };
}

type TeleportTextSegment = Pick<StyledTextSegment, 'characters' | 'fontName' | 'fontWeight' | 'fontStyle' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'textDecoration' | 'textCase' | 'fills'>;

function getStyledSegments(node: TextNode): TeleportTextSegment[] {
  return node.getStyledTextSegments([
    'fontName',
    'fontWeight',
    'fontStyle',
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'textDecoration',
    'textCase',
    'fills',
  ]) as TeleportTextSegment[];
}

function buildRichTextHtml(node: TextNode, segments: TeleportTextSegment[]): string {
  if (!segments.length) return textContentToHtml(node.characters || '');
  return segments.map((segment) => {
    const color = getSolidPaintColor(Array.isArray(segment.fills) ? segment.fills.filter((paint) => paint?.visible !== false) : []) ?? null;
    const lineHeight = getLineHeightCss(segment.lineHeight);
    const letterSpacing = getLetterSpacingCss(segment.letterSpacing);
    const style = joinCssDeclarations([
      segment.fontName?.family ? `font-family:${/^[a-z-]+$/i.test(segment.fontName.family) ? segment.fontName.family : `'${segment.fontName.family.replace(/'/g, "\\'")}'`}` : null,
      Number.isFinite(segment.fontWeight) ? `font-weight:${segment.fontWeight}` : null,
      `${segment.fontStyle || ''}`.toLowerCase().includes('italic') ? 'font-style:italic' : null,
      Number.isFinite(segment.fontSize) ? `font-size:${round(segment.fontSize, 16)}px` : null,
      color ? `color:${color}` : null,
      getTextDecorationCss(segment.textDecoration) !== 'none' ? `text-decoration:${getTextDecorationCss(segment.textDecoration)}` : null,
      getTextCaseCss(segment.textCase) !== 'none' ? `text-transform:${getTextCaseCss(segment.textCase)}` : null,
      letterSpacing.value !== 0 ? `letter-spacing:${letterSpacing.value}${letterSpacing.unit}` : null,
      lineHeight.value !== 1.2 || lineHeight.unit !== 'em' ? `line-height:${lineHeight.value}${lineHeight.unit}` : null,
    ]);
    const content = textContentToHtml(segment.characters || '');
    return style ? `<span style="${style}">${content}</span>` : content;
  }).join('');
}

async function convertNode(node: SceneNode, rootOffset: { x: number; y: number }, isRoot = false): Promise<TeleportNode | null> {
  const rootPosition = getAbsolutePosition(node);
  const x = isRoot ? round(rootPosition.x - rootOffset.x, 0) : round('x' in node ? node.x : 0, 0);
  const y = isRoot ? round(rootPosition.y - rootOffset.y, 0) : round('y' in node ? node.y : 0, 0);
  const width = round('width' in node ? node.width : 0, 0);
  const height = round('height' in node ? node.height : 0, 0);
  const { borderWidth, borderColor } = getNodeBorder(node);
  const { boxShadow, blur, backdropBlur } = getNodeEffects(node);
  const fills = getVisiblePaints(node);
  const primaryFillStyle = await getPaintStyle(fills[0]);
  const sizing = getNodeSizing(node);
  const baseMeta: Omit<TeleportNode, 'kind'> = {
    name: node.name || node.type,
    x,
    y,
    width,
    height,
    rotation: getNodeRotation(node),
    visible: node.visible,
    opacity: getNodeOpacity(node),
    mixBlendMode: 'blendMode' in node ? mapBlendMode(node.blendMode) : 'normal',
    widthMode: sizing.widthMode,
    heightMode: sizing.heightMode,
    widthFr: sizing.widthFr,
    heightFr: sizing.heightFr,
    positionType: sizing.positionType,
    absoluteInLayout: sizing.absoluteInLayout,
    borderWidth,
    borderColor: borderColor ?? undefined,
    boxShadow,
    blur,
    backdropBlur,
  };

  if (node.type === 'TEXT') {
    const segments = getStyledSegments(node);
    const primarySegment = segments.find((segment) => `${segment.characters || ''}`.length > 0) ?? segments[0] ?? null;
    const primaryColor = primarySegment
      ? (getSolidPaintColor(Array.isArray(primarySegment.fills) ? primarySegment.fills.filter((paint) => paint?.visible !== false) : []) ?? null)
      : null;
    const primaryLineHeight = primarySegment ? getLineHeightCss(primarySegment.lineHeight) : { value: 1.2, unit: 'em' as const };
    const primaryLetterSpacing = primarySegment ? getLetterSpacingCss(primarySegment.letterSpacing) : { value: 0, unit: 'px' as const };
    const richTextHtml = buildRichTextHtml(node, segments);
    return {
      kind: 'text',
      ...baseMeta,
      ...getTextMetrics(node),
      ...getNodeBorderRadiusData(node, width, height),
      text: node.characters || '',
      richTextHtml,
      color: primaryColor ?? getSolidPaintColor(fills) ?? '#111111',
      fontFamily: primarySegment?.fontName?.family || getTextMetrics(node).fontFamily,
      fontWeight: Number.isFinite(primarySegment?.fontWeight) ? primarySegment.fontWeight : getTextMetrics(node).fontWeight,
      fontStyle: `${primarySegment?.fontStyle || ''}`.toLowerCase().includes('italic') ? 'italic' : getTextMetrics(node).fontStyle,
      fontSize: Number.isFinite(primarySegment?.fontSize) ? round(primarySegment.fontSize, 16) : getTextMetrics(node).fontSize,
      lineHeight: primaryLineHeight.value,
      lineHeightUnit: primaryLineHeight.unit,
      letterSpacing: primaryLetterSpacing.value,
      letterSpacingUnit: primaryLetterSpacing.unit,
      textTransform: primarySegment ? getTextCaseCss(primarySegment.textCase) : 'none',
      textDecoration: primarySegment ? getTextDecorationCss(primarySegment.textDecoration) : 'none',
      backgroundColor: typeof primaryFillStyle.backgroundColor === 'string' && primaryFillStyle.backgroundColor.includes('gradient(')
        ? 'transparent'
        : (primaryFillStyle.backgroundColor ?? 'transparent'),
    };
  }

  if (shouldExportAsImage(node)) {
    const imagePaint = fills.find((paint) => paint.type === 'IMAGE') as ImagePaint | undefined;
    return {
      kind: 'image',
      ...baseMeta,
      ...getNodeBorderRadiusData(node, width, height),
      src: imagePaint?.imageHash ? await imageHashToDataUrl(imagePaint.imageHash) : await exportNodeAsPngDataUrl(node),
      objectFit: primaryFillStyle.objectFit ?? 'cover',
    };
  }

  if (node.type === 'LINE') {
    return {
      kind: 'vector',
      ...baseMeta,
      vectorKind: 'line',
      strokeColor: borderColor ?? '#111827',
      strokeWidth: Math.max(0.5, borderWidth || 1),
      svgMarkup: await exportNodeAsSvgMarkup(node),
    };
  }

  if (shouldExportAsVector(node) || canExportAsGroupedVector(node)) {
    return {
      kind: 'vector',
      ...baseMeta,
      ...getNodeBorderRadiusData(node, width, height),
      vectorKind: 'svg',
      strokeColor: borderColor ?? undefined,
      strokeWidth: borderWidth > 0 ? borderWidth : undefined,
      svgMarkup: await exportNodeAsSvgMarkup(node),
    };
  }

  const layout = getNodeLayout(node);
  const children = nodeSupportsChildren(node)
    ? (await Promise.all(node.children.map((child) => convertNode(child as SceneNode, rootOffset, false)))).filter((child): child is TeleportNode => !!child)
    : [];

  return {
    kind: 'frame',
    ...baseMeta,
    ...getNodeBorderRadiusData(node, width, height),
    backgroundColor: primaryFillStyle.backgroundColor ?? 'transparent',
    backgroundImage: primaryFillStyle.backgroundImage,
    backgroundSize: primaryFillStyle.backgroundSize,
    backgroundPosition: primaryFillStyle.backgroundPosition,
    overflow: 'clipsContent' in node && node.clipsContent ? 'hidden' : 'visible',
    layout,
    children,
  };
}

async function buildTeleportPayload(selection: readonly SceneNode[]): Promise<TeleportPayload> {
  const roots = [...selection];
  const positions = roots.map(getAbsolutePosition);
  const minX = Math.min(...positions.map((point) => point.x));
  const minY = Math.min(...positions.map((point) => point.y));
  const rootOffset = { x: minX, y: minY };
  const nodes = (await Promise.all(roots.map((node) => convertNode(node, rootOffset, true)))).filter((entry): entry is TeleportNode => !!entry);
  const styles = await collectTeleportStyles(roots);
  return {
    marker: TELEPORT_MARKER,
    version: 2,
    source: 'figma',
    copiedAt: new Date().toISOString(),
    selectionName: roots.length === 1 ? (roots[0].name || roots[0].type) : `${roots.length} layers`,
    nodeCount: nodes.length,
    nodes,
    styles,
  };
}

function postSelectionStateBase(selection: readonly SceneNode[], payloadReady: boolean): void {
  figma.ui.postMessage({
    type: 'selection-state',
    selectionCount: selection.length,
    selectionName: selection.length === 1 ? (selection[0].name || selection[0].type) : (selection.length ? `${selection.length} layers selected` : 'Nothing selected'),
    canCopy: selection.length > 0,
    payloadReady,
  });
}

async function syncSelectionState(): Promise<void> {
  const selection = [...figma.currentPage.selection];
  const token = ++selectionSyncToken;
  postSelectionStateBase(selection, false);
  if (!selection.length) return;

  try {
    const payload = await buildTeleportPayload(selection);
    if (token !== selectionSyncToken) return;
    figma.ui.postMessage({
      type: 'selection-state',
      selectionCount: selection.length,
      selectionName: payload.selectionName,
      canCopy: true,
      payloadReady: true,
      payloadText: JSON.stringify(payload),
      nodeCount: payload.nodeCount,
      copiedAt: payload.copiedAt,
    });
  } catch (error) {
    if (token !== selectionSyncToken) return;
    const message = error instanceof Error ? error.message : 'Export failed.';
    figma.ui.postMessage({ type: 'copy-error', message });
  }
}

if (figma.editorType !== 'figma') {
  figma.closePlugin('Atomiq Teleport currently supports Figma design files only.');
} else {
  figma.showUI(__html__, {
    width: 320,
    height: 300,
    themeColors: true,
    title: 'Atomiq Teleport',
  });

  void syncSelectionState();
  figma.on('selectionchange', () => {
    void syncSelectionState();
  });

  figma.ui.onmessage = async (msg: UiMessage) => {
    if (msg.type === 'cancel') {
      figma.closePlugin();
      return;
    }
    if (msg.type === 'refresh-selection') {
      await syncSelectionState();
    }
  };
}
