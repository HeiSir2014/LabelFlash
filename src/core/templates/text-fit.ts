import { type FieldArrangement, TEMPLATE_LIMITS } from './template-model';

/**
 * 标签文字排版估算。打印窗口不运行脚本（安全要求），没法在页面里实测文字宽度，
 * 所以在生成 HTML 前按字符类别估算字宽、逐字模拟折行，算出放得下的字号。
 * 字宽按微软雅黑 / 苹方粗体偏保守取值：宁可略小，也不能被标签边缘裁掉。
 */

const EM = {
  wide: 1,
  upperWide: 0.92,
  upper: 0.7,
  lowerWide: 0.86,
  lower: 0.56,
  digit: 0.58,
  narrow: 0.3,
  dash: 0.4,
  space: 0.32,
  other: 0.62,
} as const;

/** 全角字符：韩文字母、CJK 及符号、韩文音节、兼容汉字、竖排与全角标点。 */
const WIDE_CHAR_PATTERN = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const NARROW_CHARS = new Set([..."iIl1|.,:;!'`()[]{}/\\"]);
const DASH_CHARS = new Set([...'-_']);
const UPPER_WIDE_CHARS = new Set([...'MW@%']);
const LOWER_WIDE_CHARS = new Set([...'mw']);

export const LINE_HEIGHT = 1.2;
const FONT_SIZE_STEP_PER_MM = 10;

export function charWidthEm(char: string): number {
  if (WIDE_CHAR_PATTERN.test(char)) return EM.wide;
  if (char === ' ') return EM.space;
  if (NARROW_CHARS.has(char)) return EM.narrow;
  if (DASH_CHARS.has(char)) return EM.dash;
  if (UPPER_WIDE_CHARS.has(char)) return EM.upperWide;
  if (LOWER_WIDE_CHARS.has(char)) return EM.lowerWide;
  if (char >= '0' && char <= '9') return EM.digit;
  if (char >= 'A' && char <= 'Z') return EM.upper;
  if (char >= 'a' && char <= 'z') return EM.lower;
  return EM.other;
}

export function estimateTextWidthEm(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charWidthEm(char);
  }
  return width;
}

/**
 * 逐字模拟折行（与 CSS word-break: break-all 一致：任意两个字符之间都能断行），返回行数。
 * 显式换行分段计算，空段也占一行。
 */
export function countLines(text: string, fontSizeMm: number, widthMm: number): number {
  if (widthMm <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const widthEm = widthMm / fontSizeMm;
  let lines = 0;
  for (const segment of text.split('\n')) {
    lines += 1;
    let used = 0;
    for (const char of segment) {
      const width = charWidthEm(char);
      if (used > 0 && used + width > widthEm) {
        lines += 1;
        used = 0;
      }
      used += width;
    }
  }
  return lines;
}

export function textHeightMm(text: string, fontSizeMm: number, widthMm: number): number {
  return countLines(text, fontSizeMm, widthMm) * fontSizeMm * LINE_HEIGHT;
}

/** 缩小后的字号向下取到 0.1mm（向上取会让文本再次超出），不低于最小字号。 */
export function roundDownFontSizeMm(fontSizeMm: number): number {
  const rounded = Math.floor(fontSizeMm * FONT_SIZE_STEP_PER_MM + 1e-9) / FONT_SIZE_STEP_PER_MM;
  return Math.max(TEMPLATE_LIMITS.fontSizeMm.min, rounded);
}

/**
 * 在 [最小字号, maxFontSizeMm] 里按 0.1mm 二分查找「满足 fits 的最大字号」；
 * 最小字号也不满足时返回最小字号（宁可溢出一点，也不能小到看不清）。
 */
export function largestFitting(maxFontSizeMm: number, fits: (fontSizeMm: number) => boolean): number {
  const toSteps = (mm: number) => Math.round(mm * FONT_SIZE_STEP_PER_MM);
  let low = toSteps(TEMPLATE_LIMITS.fontSizeMm.min);
  let high = Math.max(low, Math.floor(maxFontSizeMm * FONT_SIZE_STEP_PER_MM + 1e-9));
  if (fits(high / FONT_SIZE_STEP_PER_MM)) {
    return high / FONT_SIZE_STEP_PER_MM;
  }
  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle / FONT_SIZE_STEP_PER_MM)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low / FONT_SIZE_STEP_PER_MM;
}

/** 文本在 maxLines 行内放得下的最大字号（不超过模板字号）。 */
export function fitFontSizeMm(text: string, fontSizeMm: number, widthMm: number, maxLines: number): number {
  return largestFitting(fontSizeMm, (size) => countLines(text, size, widthMm) <= maxLines);
}

/** 字段区一行：前缀、值和模板给的字号。 */
export interface RowText {
  prefix: string;
  value: string;
  fontSizeMm: number;
}

export interface RowFitOptions {
  arrangement: FieldArrangement;
  /** true = 所有行用同一个字号（「全部字段」模式，看起来整齐）；false = 每行按自己的字号缩放。 */
  uniform: boolean;
}

/** 垂直排列时，前缀（字段名）行的字号相对于值的比例：字段名小一号，值更醒目。 */
export const STACKED_PREFIX_SCALE = 0.8;
/** 缩小到原字号的这个比例以内就能放进一行时，宁可缩小也不折行（例如订单号不从中间断开）。 */
const ONE_LINE_MIN_RATIO = 0.75;
/** 横向排列时值一列至少占字段区宽度的这个比例，前缀再长也要给值留出位置。 */
const MIN_VALUE_COLUMN_RATIO = 0.4;
const SCALE_PRECISION = 0.01;

/**
 * 字段区的字号（与 rows 一一对应）：
 * 1. 每行先看缩小一点能不能把值放进一行，能就缩小，不能就保持原字号、允许折行；
 * 2. 所有行加起来比可用高度高时，整体按同一比例缩小，二分查找放得下的最大比例。
 */
export function fitRowFontSizes(
  rows: readonly RowText[],
  widthMm: number,
  heightMm: number,
  options: RowFitOptions,
): number[] {
  if (rows.length === 0) {
    return [];
  }
  const layout = rowLayout(rows, widthMm, options.arrangement);
  const oneLineSizes = rows.map(({ value, fontSizeMm: base }) => {
    const oneLine = fitFontSizeMm(value, base, layout.baseValueWidthMm, 1);
    const isOneLine = countLines(value, oneLine, layout.baseValueWidthMm) === 1;
    return isOneLine && oneLine >= base * ONE_LINE_MIN_RATIO ? oneLine : base;
  });
  const preferred = options.uniform ? oneLineSizes.map(() => Math.min(...oneLineSizes)) : oneLineSizes;
  const sizesFor = (scale: number) => preferred.map((size) => (scale >= 1 ? size : roundDownFontSizeMm(size * scale)));
  const fits = (scale: number) => layout.totalHeightMm(sizesFor(scale)) <= heightMm;
  if (fits(1)) {
    return sizesFor(1);
  }
  let low = 0;
  let high = 1;
  while (high - low > SCALE_PRECISION) {
    const middle = (low + high) / 2;
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return sizesFor(low);
}

/** 两种排列下：按模板字号时值的可用宽度，以及给定字号时字段区的总高度。 */
function rowLayout(rows: readonly RowText[], widthMm: number, arrangement: FieldArrangement) {
  if (arrangement === 'stacked') {
    return {
      baseValueWidthMm: widthMm,
      totalHeightMm: (sizes: readonly number[]) =>
        rows.reduce((sum, row, index) => {
          const size = sizes[index] ?? row.fontSizeMm;
          const prefixHeight = row.prefix === '' ? 0 : textHeightMm(row.prefix, size * STACKED_PREFIX_SCALE, widthMm);
          return sum + prefixHeight + textHeightMm(row.value, size, widthMm);
        }, 0),
    };
  }
  // 横向：前缀是一列（不折行），值从最宽的前缀之后开始。
  const valueWidthFor = (sizes: readonly number[]) => {
    const prefixColumnMm = Math.max(
      0,
      ...rows.map((row, index) => estimateTextWidthEm(row.prefix) * (sizes[index] ?? row.fontSizeMm)),
    );
    return Math.max(widthMm - prefixColumnMm, widthMm * MIN_VALUE_COLUMN_RATIO);
  };
  return {
    baseValueWidthMm: valueWidthFor(rows.map((row) => row.fontSizeMm)),
    totalHeightMm: (sizes: readonly number[]) => {
      const valueWidthMm = valueWidthFor(sizes);
      return rows.reduce((sum, row, index) => sum + textHeightMm(row.value, sizes[index] ?? 0, valueWidthMm), 0);
    },
  };
}
