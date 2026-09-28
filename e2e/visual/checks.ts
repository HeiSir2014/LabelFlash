import type { Page } from '@playwright/test';

/**
 * 视觉验收的自动检查（设计文档 §8.3）。每项检查是一个单独的函数，由 pageChecks 逐个交给 page.evaluate 在页面里执行。
 * page.evaluate 只把函数的源码送进页面，所以每个检查函数都必须自包含：不能引用本文件的其他变量、函数或导入。
 * - 阈值随参数（CheckInput.limits）传入。
 * - 几项检查都要用的工具（范围、可见性、元素描述）由 installCheckKit 先装到页面的全局变量上，检查函数按参数里的名字取用。
 */

export type CheckName =
  | 'horizontal-overflow'
  | 'clipped-text'
  | 'overlap'
  | 'small-target'
  | 'low-contrast'
  /** 颜色写法认不出来，没法算对比度：宁可报出来，也不当成透明悄悄跳过。 */
  | 'unknown-color'
  | 'off-grid-spacing'
  | 'focus'
  /** 由验收脚本自己测量（例如扫码栏中线），pageChecks 不产生。 */
  | 'alignment';

export interface Issue {
  check: CheckName;
  detail: string;
}

export interface CheckOptions {
  /** 只检查这些区域里的元素（配置中心打开时只看配置中心和标题栏，下面被盖住的工作台不算）。 */
  readonly scope: readonly string[];
  /** 两两不能重叠的区域。 */
  readonly regions: readonly string[];
  /** 外边距、内边距必须是 4 的倍数的元素。 */
  readonly spacing: readonly string[];
}

export const DEFAULT_CHECK_OPTIONS: Readonly<CheckOptions> = {
  scope: ['.title-bar', '.config-center', '.workspace:not([inert])', '[role="alertdialog"]'],
  regions: [
    '.title-bar',
    '.config-center__back',
    '.config-header',
    '.config-nav',
    '.config-content',
    '.config-actions',
    '.rules-page__tester',
    '.rule-editing__tester',
    '.rule-editing__form',
    '.template-editing__form',
    '.template-editing__preview',
    '.template-list',
    '.template-stage',
    '.scan-bar',
    '.preview-stage',
    '.side',
  ],
  spacing: [
    '.config-card',
    '.form-section',
    '.setting-row',
    '.form-row',
    '.rule-card',
    '.template-item',
    '.config-actions',
    '.config-header',
    '.config-nav__item',
    '.preview-toolbar',
    '.status-strip',
    '.scan-bar__field',
    '.dialog',
  ],
};

/** CSS 规定 1in = 72pt = 96px，所以 1pt = 4/3px。WCAG 的大字按磅值定义，要换算成像素再和 font-size 比。 */
const PX_PER_PT = 4 / 3;

/** 各项检查的阈值，随参数传进页面。 */
const CHECK_LIMITS = {
  /** 设计文档 §8.3：按钮、导航项、勾选框的可点击高度至少 28px。 */
  minTargetPx: 28,
  /** WCAG AA：正文与背景的对比度至少 4.5:1。 */
  normalContrast: 4.5,
  /** WCAG AA：大字至少 3:1。 */
  largeContrast: 3,
  /** WCAG 的大字：18pt，即 24px。 */
  largeTextPx: 18 * PX_PER_PT,
  /** WCAG 的粗体大字：14pt（约 18.67px）且字重至少 700。 */
  largeBoldTextPx: 14 * PX_PER_PT,
  /** CSS 的 bold 就是 700；600（semibold）不算 WCAG 的粗体。 */
  boldWeight: 700,
  /** 设计文档 §8.3：间距只取 --space-* 的值，都是 4 的倍数。 */
  gridPx: 4,
  /** 计算样式里的长度是浮点数（例如 11.9999px），差这么一点仍算落在网格上。 */
  gridEpsilonPx: 0.01,
  /** 布局取整和边框带来的误差：溢出、重叠、截断差 1px 以内不算。 */
  tolerancePx: 1,
  /** 小数缩放下高度会算成 27.5px 这样的值：比最小点击高度只差半个像素以内不算太小。 */
  subpixelPx: 0.5,
} as const;

/** installCheckKit 把共用工具装在页面的这个全局变量上。 */
const CHECK_KIT_GLOBAL = '__labelflashVisualCheckKit';

/** 交给每个检查函数的参数：必须能序列化（不能带函数）。 */
interface CheckInput extends CheckOptions {
  readonly limits: typeof CHECK_LIMITS;
  /** 共用工具所在的全局变量名。 */
  readonly kitName: string;
}

/** 几项检查共用的页面内工具。 */
interface CheckKit {
  /** scope 里所有可见的元素（SVG 除外）。 */
  visibleInScope: (scope: readonly string[]) => Element[];
  inScope: (element: Element, scope: readonly string[]) => boolean;
  isVisible: (element: Element) => boolean;
  /** 问题描述里的元素：标签名、第一个类名和开头的文字。 */
  describe: (element: Element) => string;
  /** 元素自己直接包含的、不只是空白的文字节点。 */
  ownTexts: (element: Element) => Text[];
}

type PageCheck = (input: CheckInput) => Issue[];

function installCheckKit(kitName: string): void {
  const DESCRIBED_TEXT_LENGTH = 24;
  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      !element.closest('[hidden], .visually-hidden')
    );
  };
  const inScope = (element: Element, scope: readonly string[]) =>
    scope.some((selector) => element.closest(selector) !== null);
  const kit: CheckKit = {
    visibleInScope: (scope) =>
      [...document.querySelectorAll('body *')].filter(
        (element) => !(element instanceof SVGElement) && inScope(element, scope) && isVisible(element),
      ),
    inScope,
    isVisible,
    describe: (element) => {
      const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/)[0] : '';
      const text = (element.textContent ?? '').trim().slice(0, DESCRIBED_TEXT_LENGTH);
      return `<${element.tagName.toLowerCase()}${className ? `.${className}` : ''}>${text ? ` 「${text}」` : ''}`;
    },
    ownTexts: (element) =>
      [...element.childNodes].filter(
        (node): node is Text => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      ),
  };
  (globalThis as unknown as Record<string, CheckKit>)[kitName] = kit;
}

/** 1. 横向溢出：能横向滚动的容器不能真的横向滚动（明确允许的表格除外）；整页也不能横向滚动。 */
function checkHorizontalOverflow({ scope, limits, kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  const issues: Issue[] = [];
  const pageWidth = document.documentElement.scrollWidth;
  if (pageWidth > window.innerWidth + limits.tolerancePx) {
    issues.push({ check: 'horizontal-overflow', detail: `整页宽 ${pageWidth}px` });
  }
  for (const element of kit.visibleInScope(scope)) {
    // 只有 overflow-x 为 auto / scroll 才会横向滚动；overflow-x: hidden 是裁剪，归「意外截断」检查。
    const { overflowX } = getComputedStyle(element);
    const isScrollableX = overflowX === 'auto' || overflowX === 'scroll';
    if (
      isScrollableX &&
      element.scrollWidth > element.clientWidth + limits.tolerancePx &&
      !element.closest('[data-allow-x-scroll]')
    ) {
      issues.push({
        check: 'horizontal-overflow',
        detail: `${kit.describe(element)} 内容宽 ${element.scrollWidth}px，容器 ${element.clientWidth}px`,
      });
    }
  }
  return issues;
}

/**
 * 2. 意外截断：文字超出了裁剪它的容器（元素自己或祖先的 overflow 为 hidden / clip），又没有「省略号 + 悬停提示」。
 * 按轴分别找：横向看 overflow-x，纵向看 overflow-y。遇到能滚动的容器就停——滚动容器里的文字滚过去就能看到。
 */
function checkClippedText({ scope, limits, kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  type Axis = 'x' | 'y';
  interface Clip {
    clipper: Element;
    axis: Axis;
  }
  const clips = (value: string) => value === 'hidden' || value === 'clip';
  const scrolls = (value: string) => value === 'auto' || value === 'scroll';
  const clipBox = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const left = rect.left + element.clientLeft;
    const top = rect.top + element.clientTop;
    return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
  };
  const textRects = (element: Element) =>
    kit.ownTexts(element).flatMap((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    });
  /** 横向超出多少像素；纵向按行算：一行的中线落在可见范围外，这一行就算被裁掉。 */
  const hiddenPart = (rects: DOMRect[], clipper: Element, axis: Axis) => {
    const box = clipBox(clipper);
    if (axis === 'x') {
      return Math.max(0, ...rects.map((rect) => Math.max(rect.right - box.right, box.left - rect.left)));
    }
    return rects.filter((rect) => {
      const middle = rect.top + rect.height / 2;
      return middle < box.top || middle > box.bottom;
    }).length;
  };
  /** 从元素自己往上找裁剪它的容器；绝对定位跳过非定位的祖先，固定定位不再受祖先裁剪。 */
  const findClips = (element: Element, rects: DOMRect[]): Clip[] => {
    const found: Clip[] = [];
    const searching: Record<Axis, boolean> = { x: !element.closest('[data-allow-x-scroll]'), y: true };
    let skipsStatic = false;
    for (let node: Element | null = element; node && (searching.x || searching.y); node = node.parentElement) {
      const style = getComputedStyle(node);
      const isContainingBlock = style.position !== 'static' || style.transform !== 'none';
      if (node === element || !skipsStatic || isContainingBlock) {
        const rect = node.getBoundingClientRect();
        // 宽或高为 0 的容器是有意收起来的（例如折叠动画），里面的文字本来就不该看到。
        const isCollapsed = rect.width === 0 || rect.height === 0;
        for (const axis of ['x', 'y'] as const) {
          const overflow = axis === 'x' ? style.overflowX : style.overflowY;
          if (!searching[axis]) {
            continue;
          }
          if (clips(overflow) && !isCollapsed) {
            const hidden = hiddenPart(rects, node, axis);
            if (axis === 'x' ? hidden > limits.tolerancePx : hidden > 0) {
              found.push({ clipper: node, axis });
              searching[axis] = false;
            }
          } else if (scrolls(overflow)) {
            searching[axis] = false;
          }
        }
        if (node !== element) {
          skipsStatic = false;
        }
      }
      if (style.position === 'fixed') {
        break;
      }
      if (style.position === 'absolute') {
        skipsStatic = true;
      }
    }
    return found;
  };
  const isExplainedEllipsis = (element: Element, clipper: Element) =>
    (getComputedStyle(element).textOverflow === 'ellipsis' || getComputedStyle(clipper).textOverflow === 'ellipsis') &&
    element.closest('[title]') !== null;

  const issues: Issue[] = [];
  for (const element of kit.visibleInScope(scope)) {
    const rects = textRects(element);
    if (rects.length === 0) {
      continue;
    }
    for (const { clipper, axis } of findClips(element, rects)) {
      if (isExplainedEllipsis(element, clipper)) {
        continue;
      }
      const where = clipper === element ? '自己的边框' : kit.describe(clipper);
      const detail =
        axis === 'x'
          ? `${kit.describe(element)} 文字横向超出${where} ${Math.round(hiddenPart(rects, clipper, axis))}px，被裁掉`
          : `${kit.describe(element)} 有 ${hiddenPart(rects, clipper, axis)} 行文字在${where}的可见范围之外`;
      issues.push({ check: 'clipped-text', detail });
    }
  }
  return issues;
}

/** 3. 不重叠：页头、导航、内容、操作条、试一试、预览……两两不相交。 */
function checkOverlap({ scope, regions, limits, kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  const issues: Issue[] = [];
  const found = regions.flatMap((selector) =>
    [...document.querySelectorAll(selector)].filter((element) => kit.inScope(element, scope) && kit.isVisible(element)),
  );
  for (let i = 0; i < found.length; i += 1) {
    for (let j = i + 1; j < found.length; j += 1) {
      const a = found[i] as Element;
      const b = found[j] as Element;
      if (a.contains(b) || b.contains(a)) {
        continue;
      }
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (width > limits.tolerancePx && height > limits.tolerancePx) {
        issues.push({
          check: 'overlap',
          detail: `${kit.describe(a)} 与 ${kit.describe(b)} 重叠 ${Math.round(width)}×${Math.round(height)}px`,
        });
      }
    }
  }
  return issues;
}

/** 4. 点击区域：按钮、标签页、链接、勾选框、下拉框至少 28px 高（行内文字链接除外）。 */
function checkTargetSize({ scope, limits, kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  const issues: Issue[] = [];
  for (const element of kit.visibleInScope(scope)) {
    const isTarget = element.matches('button, [role="tab"], a[href], input[type="checkbox"], select');
    if (!isTarget || element.matches('.link-button') || element.closest('[inert]')) {
      continue;
    }
    // 勾选框本身很小，点击区域是包着它的 label。
    const box = element.matches('input[type="checkbox"]') ? (element.closest('label') ?? element) : element;
    const height = box.getBoundingClientRect().height;
    if (height < limits.minTargetPx - limits.subpixelPx) {
      issues.push({ check: 'small-target', detail: `${kit.describe(box)} 高 ${height.toFixed(1)}px` });
    }
  }
  return issues;
}

/**
 * 5. 对比度：文字颜色对它实际落在的背景（逐层叠加半透明背景，最底下是白色）。
 * 认得 rgb() / rgba() 和 color(srgb …)（Chromium 把 color-mix(in srgb, …) 的结果写成后者）；
 * 别的写法算不出对比度，报「unknown-color」而不是当成透明跳过。
 */
function checkContrast({ scope, limits, kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  type Rgba = [number, number, number, number];
  const CHANNEL_MAX = 255;
  const OPAQUE = 1;
  const TRANSPARENT: Rgba = [0, 0, 0, 0];
  /** 窗口本身的底色：所有背景都透明时文字落在白色上。 */
  const PAGE_BACKGROUND: Rgba = [CHANNEL_MAX, CHANNEL_MAX, CHANNEL_MAX, OPAQUE];
  /** WCAG 2.x 相对亮度公式：sRGB 分量先去掉伽马，再按人眼对三原色的敏感度加权。 */
  const SRGB = { linearLimit: 0.03928, linearSlope: 12.92, offset: 0.055, scale: 1.055, gamma: 2.4 } as const;
  const LUMA_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;
  /** WCAG 对比度公式里两边都加的 0.05（环境光）。 */
  const FLARE = 0.05;
  const RGB_COMPONENTS = 3;
  const RGBA_COMPONENTS = 4;

  const numbers = (body: string) =>
    body
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
  const parseColor = (value: string): Rgba | null => {
    const text = value.trim();
    if (text === 'transparent') {
      return TRANSPARENT;
    }
    const legacy = /^rgba?\(([^)]*)\)$/.exec(text);
    const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(text);
    let parts: number[] | null = null;
    if (legacy) {
      parts = numbers(legacy[1] ?? '');
    } else if (srgb) {
      // color(srgb r g b / a)：前三个分量是 0–1，换算成 0–255。
      parts = numbers(srgb[1] ?? '').map((part, index) => (index < RGB_COMPONENTS ? part * CHANNEL_MAX : part));
    }
    if (
      !parts ||
      parts.length < RGB_COMPONENTS ||
      parts.length > RGBA_COMPONENTS ||
      parts.some((part) => !Number.isFinite(part))
    ) {
      return null;
    }
    const clamp = (part: number) => Math.min(CHANNEL_MAX, Math.max(0, part));
    return [clamp(parts[0] ?? 0), clamp(parts[1] ?? 0), clamp(parts[2] ?? 0), parts[3] ?? OPAQUE];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) {
      return TRANSPARENT;
    }
    const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha;
    return [mix(0), mix(1), mix(2), alpha];
  };
  const luminance = ([r, g, b]: Rgba) => {
    const linear = (value: number) => {
      const c = value / CHANNEL_MAX;
      return c <= SRGB.linearLimit ? c / SRGB.linearSlope : ((c + SRGB.offset) / SRGB.scale) ** SRGB.gamma;
    };
    return LUMA_WEIGHTS.r * linear(r) + LUMA_WEIGHTS.g * linear(g) + LUMA_WEIGHTS.b * linear(b);
  };

  const issues: Issue[] = [];
  const reported = new Set<Element>();
  const reportUnknown = (element: Element, property: string, value: string) => {
    if (!reported.has(element)) {
      reported.add(element);
      issues.push({
        check: 'unknown-color',
        detail: `${kit.describe(element)} 的 ${property}「${value}」无法解析，没有算对比度`,
      });
    }
  };
  /** 元素实际的背景；某一层背景色认不出来时返回 null（已报告）。 */
  const background = (element: Element): Rgba | null => {
    const layers: Rgba[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = getComputedStyle(node).backgroundColor;
      const color = parseColor(value);
      if (!color) {
        reportUnknown(node, 'background-color', value);
        return null;
      }
      if (color[3] > 0) {
        layers.push(color);
        if (color[3] >= OPAQUE) {
          break;
        }
      }
    }
    return layers.reduceRight<Rgba>((below, layer) => over(layer, below), PAGE_BACKGROUND);
  };

  for (const element of kit.visibleInScope(scope)) {
    if (kit.ownTexts(element).length === 0 || element.closest(':disabled, [aria-disabled="true"]')) {
      continue;
    }
    const style = getComputedStyle(element);
    const bg = background(element);
    const color = parseColor(style.color);
    if (!color) {
      reportUnknown(element, 'color', style.color);
      continue;
    }
    if (!bg) {
      continue;
    }
    const fg = over(color, bg);
    const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
    const ratio = (light + FLARE) / (dark + FLARE);
    const size = Number.parseFloat(style.fontSize);
    const isBold = Number(style.fontWeight) >= limits.boldWeight;
    const isLarge = size >= limits.largeTextPx || (size >= limits.largeBoldTextPx && isBold);
    const required = isLarge ? limits.largeContrast : limits.normalContrast;
    if (ratio < required) {
      issues.push({
        check: 'low-contrast',
        detail: `${kit.describe(element)} 对比度 ${ratio.toFixed(2)}，至少 ${required}（${size}px，字重 ${style.fontWeight}）`,
      });
    }
  }
  return issues;
}

/** 6. 间距：卡片、表单行的外边距和内边距只取 4 的倍数。 */
function checkSpacing({ scope, spacing, limits, kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  const issues: Issue[] = [];
  const isOnGrid = (value: number) => {
    const remainder = Math.abs(value % limits.gridPx);
    return remainder <= limits.gridEpsilonPx || limits.gridPx - remainder <= limits.gridEpsilonPx;
  };
  for (const selector of spacing) {
    for (const element of document.querySelectorAll(selector)) {
      if (!kit.inScope(element, scope) || !kit.isVisible(element)) {
        continue;
      }
      const style = getComputedStyle(element);
      // margin: auto 是居中（例如原生 <dialog> 的 showModal），getComputedStyle 给的是算出来的剩余宽度，
      // 不是间距取值；用 Typed OM 的计算值认出 auto 跳过。
      const computed = element.computedStyleMap();
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        for (const kind of ['margin', 'padding'] as const) {
          const specified = computed.get(`${kind}-${side.toLowerCase()}`);
          if (specified instanceof CSSKeywordValue && specified.value === 'auto') {
            continue;
          }
          const value = Number.parseFloat(style[`${kind}${side}`]);
          if (!isOnGrid(value)) {
            issues.push({
              check: 'off-grid-spacing',
              detail: `${kit.describe(element)} ${kind}-${side.toLowerCase()} ${value}px`,
            });
          }
        }
      }
    }
  }
  return issues;
}

/** 7. 焦点：配置中心打开时焦点不能在工作台里，工作台必须是 inert。 */
function checkFocus({ kitName }: CheckInput): Issue[] {
  const kit = (globalThis as unknown as Record<string, CheckKit | undefined>)[kitName];
  if (!kit) {
    throw new Error('The visual check kit is not installed');
  }
  const issues: Issue[] = [];
  const center = document.querySelector('.config-center:not(.config-center--leaving)');
  const workspace = document.querySelector('.workspace');
  if (!center || !workspace) {
    return issues;
  }
  if (!workspace.hasAttribute('inert')) {
    issues.push({ check: 'focus', detail: '配置中心打开时工作台没有 inert' });
  }
  if (document.activeElement && workspace.contains(document.activeElement)) {
    issues.push({ check: 'focus', detail: `焦点在工作台里：${kit.describe(document.activeElement)}` });
  }
  return issues;
}

const PAGE_CHECKS: readonly PageCheck[] = [
  checkHorizontalOverflow,
  checkClippedText,
  checkOverlap,
  checkTargetSize,
  checkContrast,
  checkSpacing,
  checkFocus,
];

/** 在当前页面上跑全部自动检查，返回发现的问题（没有问题时为空数组）。 */
export async function pageChecks(page: Page, options: CheckOptions = DEFAULT_CHECK_OPTIONS): Promise<Issue[]> {
  await page.evaluate(installCheckKit, CHECK_KIT_GLOBAL);
  const input: CheckInput = {
    scope: options.scope,
    regions: options.regions,
    spacing: options.spacing,
    limits: CHECK_LIMITS,
    kitName: CHECK_KIT_GLOBAL,
  };
  const issues: Issue[] = [];
  for (const check of PAGE_CHECKS) {
    issues.push(...(await page.evaluate(check, input)));
  }
  return issues;
}
