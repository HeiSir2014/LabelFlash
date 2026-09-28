import { TEMPLATE_LIMITS } from './template-model';

/** 字宽估算（单位 em，按微软雅黑粗体偏保守取值）。 */
const WIDE_CHAR_EM = 1;
const NARROW_CHAR_EM = 0.62;
const SPACE_EM = 0.32;
/** 全角字符：韩文字母、CJK 及符号、韩文音节、兼容汉字、竖排与全角标点。 */
const WIDE_CHAR_PATTERN = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const FONT_SIZE_STEP_PER_MM = 10;

export function estimateTextWidthEm(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') {
      width += SPACE_EM;
    } else {
      width += WIDE_CHAR_PATTERN.test(char) ? WIDE_CHAR_EM : NARROW_CHAR_EM;
    }
  }
  return width;
}

/**
 * 文本在 maxLines 行内放不下时缩小字号（不低于最小字号），避免被标签边缘裁掉。
 * 这是估算：保证常见编码（含 128 字符上限）不被裁切，而不是精确排版。
 */
export function fitFontSizeMm(text: string, fontSizeMm: number, availableWidthMm: number, maxLines: number): number {
  const widthEm = estimateTextWidthEm(text);
  if (widthEm === 0 || availableWidthMm <= 0) {
    return fontSizeMm;
  }
  const fitting = (availableWidthMm * maxLines) / widthEm;
  const fitted = Math.min(fontSizeMm, fitting);
  // 向下取到 0.1mm：向上取会让文本再次超出可用宽度。
  const rounded = Math.floor(fitted * FONT_SIZE_STEP_PER_MM) / FONT_SIZE_STEP_PER_MM;
  return Math.max(TEMPLATE_LIMITS.fontSizeMm.min, rounded);
}
