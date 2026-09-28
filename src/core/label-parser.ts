import type { LabelData } from './types';

export const MAX_RAW_LENGTH = 128;

/** 编码本身可能含 "-"：贪婪匹配编码，最后两段固定为颜色和尺码。 */
const LABEL_PATTERN = /^(.+)-([^-]+)-([^-]+)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 专门用来过滤控制字符
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function parseLabel(input: string): LabelData | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_RAW_LENGTH || CONTROL_CHARACTERS.test(raw)) {
    return null;
  }
  const match = LABEL_PATTERN.exec(raw);
  if (!match) {
    return null;
  }
  const [, code = '', color = '', size = ''] = match;
  if ([code, color, size].some((field) => field.trim() === '')) {
    return null;
  }
  return { raw, code, color, size };
}
