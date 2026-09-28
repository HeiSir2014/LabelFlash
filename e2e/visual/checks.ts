/**
 * 视觉验收的自动检查（设计文档 §8.3）。整个函数交给 page.evaluate 在页面里执行，
 * 所以必须自包含：不能引用外部变量或导入，辅助函数都写在里面。
 */

export type CheckName =
  | 'horizontal-overflow'
  | 'clipped-text'
  | 'overlap'
  | 'small-target'
  | 'low-contrast'
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
  scope: string[];
  /** 两两不能重叠的区域。 */
  regions: string[];
  /** 外边距、内边距必须是 4 的倍数的元素。 */
  spacing: string[];
}

export const DEFAULT_CHECK_OPTIONS: CheckOptions = {
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

export function pageChecks(options: CheckOptions): Issue[] {
  const issues: Issue[] = [];
  const MIN_TARGET_PX = 28;
  const NORMAL_CONTRAST = 4.5;
  const LARGE_CONTRAST = 3;
  const LARGE_TEXT_PX = 18;
  const LARGE_BOLD_TEXT_PX = 14;
  const BOLD_WEIGHT = 600;
  const GRID_PX = 4;
  const TOLERANCE_PX = 1;

  const scopes = options.scope.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const inScope = (element: Element) => scopes.some((scope) => scope.contains(element));
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
  const name = (element: Element) => {
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/)[0] : '';
    const text = (element.textContent ?? '').trim().slice(0, 24);
    return `<${element.tagName.toLowerCase()}${className ? `.${className}` : ''}>${text ? ` 「${text}」` : ''}`;
  };
  const candidates = [...document.querySelectorAll('body *')].filter(
    (element) => !(element instanceof SVGElement) && inScope(element) && isVisible(element),
  );

  // 1. 横向溢出：可滚动的容器不能横向滚动（明确允许的表格除外）；整页也不能横向滚动。
  if (document.documentElement.scrollWidth > window.innerWidth + TOLERANCE_PX) {
    issues.push({ check: 'horizontal-overflow', detail: `整页宽 ${document.documentElement.scrollWidth}px` });
  }
  for (const element of candidates) {
    const style = getComputedStyle(element);
    const scrolls = ['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflowY);
    if (
      scrolls &&
      element.scrollWidth > element.clientWidth + TOLERANCE_PX &&
      !element.closest('[data-allow-x-scroll]')
    ) {
      issues.push({
        check: 'horizontal-overflow',
        detail: `${name(element)} 内容宽 ${element.scrollWidth}px，容器 ${element.clientWidth}px`,
      });
    }
  }

  // 2. 意外截断：文字被裁掉，又没有省略号 + 悬停提示。
  const hasOwnText = (element: Element) =>
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
  for (const element of candidates) {
    if (!hasOwnText(element) || element.closest('[data-allow-x-scroll]')) {
      continue;
    }
    const style = getComputedStyle(element);
    const clips = style.overflowX !== 'visible' || style.overflow !== 'visible';
    if (!clips || element.scrollWidth <= element.clientWidth + TOLERANCE_PX) {
      continue;
    }
    const explained = style.textOverflow === 'ellipsis' && element.closest('[title]') !== null;
    if (!explained) {
      issues.push({
        check: 'clipped-text',
        detail: `${name(element)} 文字宽 ${element.scrollWidth}px，只显示 ${element.clientWidth}px`,
      });
    }
  }

  // 3. 不重叠：页头、导航、内容、操作条、试一试、预览……两两不相交。
  const regions = options.regions.flatMap((selector) =>
    [...document.querySelectorAll(selector)].filter((element) => inScope(element) && isVisible(element)),
  );
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const a = regions[i] as Element;
      const b = regions[j] as Element;
      if (a.contains(b) || b.contains(a)) {
        continue;
      }
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (width > TOLERANCE_PX && height > TOLERANCE_PX) {
        issues.push({
          check: 'overlap',
          detail: `${name(a)} 与 ${name(b)} 重叠 ${Math.round(width)}×${Math.round(height)}px`,
        });
      }
    }
  }

  // 4. 点击区域：按钮、标签页、链接、勾选框至少 28px 高（行内文字链接除外）。
  for (const element of candidates) {
    const isTarget = element.matches('button, [role="tab"], a[href], input[type="checkbox"], select');
    if (!isTarget || element.matches('.link-button') || element.closest('[inert]')) {
      continue;
    }
    const box = element.matches('input[type="checkbox"]') ? (element.closest('label') ?? element) : element;
    const height = box.getBoundingClientRect().height;
    if (height < MIN_TARGET_PX - 0.5) {
      issues.push({ check: 'small-target', detail: `${name(box)} 高 ${height.toFixed(1)}px` });
    }
  }

  // 5. 对比度：文字颜色对它实际落在的背景（逐层叠加半透明背景）。
  type Rgba = [number, number, number, number];
  const parse = (value: string): Rgba => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) {
      return [0, 0, 0, 0];
    }
    const parts = (match[1] ?? '')
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const alpha = top[3] + bottom[3] * (1 - top[3]);
    if (alpha === 0) {
      return [0, 0, 0, 0];
    }
    const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha;
    return [mix(0), mix(1), mix(2), alpha];
  };
  const background = (element: Element): Rgba => {
    const layers: Rgba[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color[3] > 0) {
        layers.push(color);
        if (color[3] >= 1) {
          break;
        }
      }
    }
    return layers.reduceRight<Rgba>((acc, layer) => over(layer, acc), [255, 255, 255, 1]);
  };
  const luminance = ([r, g, b]: Rgba) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  for (const element of candidates) {
    if (!hasOwnText(element) || element.closest(':disabled, [aria-disabled="true"]')) {
      continue;
    }
    const style = getComputedStyle(element);
    const bg = background(element);
    const fg = over(parse(style.color), bg);
    const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
    const ratio = (light + 0.05) / (dark + 0.05);
    const size = Number.parseFloat(style.fontSize);
    const isLarge = size >= LARGE_TEXT_PX || (size >= LARGE_BOLD_TEXT_PX && Number(style.fontWeight) >= BOLD_WEIGHT);
    const required = isLarge ? LARGE_CONTRAST : NORMAL_CONTRAST;
    if (ratio < required) {
      issues.push({ check: 'low-contrast', detail: `${name(element)} 对比度 ${ratio.toFixed(2)}，至少 ${required}` });
    }
  }

  // 6. 间距：卡片、表单行的外边距和内边距只取 4 的倍数。
  for (const selector of options.spacing) {
    for (const element of document.querySelectorAll(selector)) {
      if (!inScope(element) || !isVisible(element)) {
        continue;
      }
      const style = getComputedStyle(element);
      const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
      for (const side of sides) {
        for (const kind of ['margin', 'padding'] as const) {
          const value = Number.parseFloat(style[`${kind}${side}`]);
          if (Math.abs(value % GRID_PX) > 0.01 && Math.abs((value % GRID_PX) - GRID_PX) > 0.01) {
            issues.push({
              check: 'off-grid-spacing',
              detail: `${name(element)} ${kind}-${side.toLowerCase()} ${value}px`,
            });
          }
        }
      }
    }
  }

  // 7. 焦点：配置中心打开时焦点不能在工作台里，工作台必须是 inert。
  const center = document.querySelector('.config-center:not(.config-center--leaving)');
  const workspace = document.querySelector('.workspace');
  if (center && workspace) {
    if (!workspace.hasAttribute('inert')) {
      issues.push({ check: 'focus', detail: '配置中心打开时工作台没有 inert' });
    }
    if (document.activeElement && workspace.contains(document.activeElement)) {
      issues.push({ check: 'focus', detail: `焦点在工作台里：${name(document.activeElement)}` });
    }
  }

  return issues;
}
