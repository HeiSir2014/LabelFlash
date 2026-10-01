import { type FieldArrangement, TEMPLATE_LIMITS } from './template-model';

/**
 * 标签、面单的文字排版估算。打印窗口不运行脚本（安全要求），没法在页面里实测文字宽度，
 * 所以在生成 HTML 前按字符类别估算字宽、逐字模拟折行，算出放得下的字号。
 *
 * 字宽按实测：2026-10-01 逐个字符量了微软雅黑（Windows）和苹方（macOS），两者取宽的，再放宽一点。
 * 宁可估宽、字号略小，也不能估窄：估窄了字会被标签或面单格子的边缘裁掉；
 * 也不按类别取上限，否则 L、I 这类窄字母会被当成 W 那么宽，天天打的标签无端缩小。
 * 雅黑和苹方的数字都是等宽的，1 和 0 一样宽。
 */

/**
 * 空格（32）到 ~（126）每个字符的宽度（em），按字符码顺序：Windows 的微软雅黑和 macOS 的苹方各自实测（常规、粗体取宽的），
 * 两种字体再取宽的那个。苹方由 CI 的 macOS E2E 量出（「never estimates a character narrower…」那一条会列出估窄的字）。
 */
const ASCII_WIDTHS_EM: readonly number[] = [
  0.337, 0.349, 0.521, 0.64, 0.617, 1.004, 0.911, 0.308, 0.39, 0.39, 0.518, 0.761, 0.286, 0.612, 0.286, 0.512, 0.617,
  0.617, 0.617, 0.617, 0.617, 0.617, 0.617, 0.617, 0.617, 0.617, 0.286, 0.286, 0.761, 0.761, 0.761, 0.565, 1.03, 0.752,
  0.706, 0.748, 0.792, 0.658, 0.598, 0.765, 0.821, 0.335, 0.554, 0.725, 0.608, 1.028, 0.848, 0.818, 0.657, 0.818, 0.698,
  0.665, 0.645, 0.776, 0.715, 1.076, 0.7, 0.708, 0.65, 0.39, 0.512, 0.39, 0.761, 0.504, 0.334, 0.578, 0.666, 0.578,
  0.665, 0.582, 0.405, 0.665, 0.646, 0.296, 0.317, 0.596, 0.296, 0.982, 0.648, 0.657, 0.666, 0.665, 0.424, 0.539, 0.414,
  0.648, 0.577, 0.852, 0.585, 0.574, 0.514, 0.39, 0.341, 0.39, 0.761,
];
const FIRST_ASCII = 32;
/** 其他常见符号的实测宽度（em）。 */
const SYMBOL_WIDTHS_EM: Readonly<Record<string, number>> = {
  '×': 0.761,
  '…': 1.004,
  '—': 1.08,
  '–': 0.828,
  '·': 0.504,
  '°': 0.41,
  '¥': 0.617,
};
/** 实测值再放宽 3%：不同版本的字体、渲染时的取整都可能让字略宽一点。 */
const SAFETY_FACTOR = 1.03;
/** 表里没有的字（汉字、全角标点、韩文和其他文字）：雅黑正好一个字宽，苹方实测 1.004 个字宽，取 1.01。 */
const DEFAULT_WIDTH_EM = 1.01;

export const LINE_HEIGHT = 1.2;
const FONT_SIZE_STEP_PER_MM = 10;

export function charWidthEm(char: string): number {
  const code = char.charCodeAt(0);
  const ascii = char.length === 1 ? ASCII_WIDTHS_EM[code - FIRST_ASCII] : undefined;
  const measured = ascii ?? SYMBOL_WIDTHS_EM[char];
  return measured === undefined ? DEFAULT_WIDTH_EM : measured * SAFETY_FACTOR;
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
/** 缩小到原字号的这个比例以内就能放进一行时，宁可缩小也不折行。 */
const ONE_LINE_MIN_RATIO = 0.75;
/**
 * 编码、订单号这类「码」（没有空格和汉字）断开就不好认，也没法照着输入：允许缩得更多。
 * 样衣模板的字段区只有 29mm，12 位订单号要缩到 0.74 倍，按 0.75 会断成「202609280 / 001」。
 */
const CODE_ONE_LINE_MIN_RATIO = 0.6;
/** 「码」：一串字母、数字和常见符号，中间没有空白、没有汉字。 */
const CODE_PATTERN = /^[\x21-\x7e]+$/;
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
    const minRatio = CODE_PATTERN.test(value) ? CODE_ONE_LINE_MIN_RATIO : ONE_LINE_MIN_RATIO;
    return isOneLine && oneLine >= base * minRatio ? oneLine : base;
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
