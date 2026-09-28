import type { LabelData } from './types';

export const MAX_RAW_LENGTH = 128;

/** 编码本身可能含 "-"：贪婪匹配编码，最后两段固定为颜色和尺码。 */
const LABEL_PATTERN = /^(.+)-([^-]+)-([^-]+)$/;

/**
 * 控制字符 + 不可见字符黑名单（按码点区间拼正则，不在源码里直接写这些字符/转义，
 * 避免不可见字符本身混进源文件、也避免转义写法被编辑器/工具静默改写）：
 * - C0 控制符 (0x00-0x1F) 与 DEL/C1 控制符 (0x7F-0x9F)
 * - 零宽 / 双向控制符 (0x200B-0x200F)
 * - 行分隔符、段分隔符 (0x2028-0x2029)
 * - BOM / 零宽不换行空格 (0xFEFF)
 */
const CONTROL_CHARACTER_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0xfeff, 0xfeff],
];
const CONTROL_CHARACTERS = new RegExp(
  `[${CONTROL_CHARACTER_RANGES.map(([start, end]) => `${String.fromCharCode(start)}-${String.fromCharCode(end)}`).join('')}]`,
);

export function parseLabel(input: string): LabelData | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_RAW_LENGTH || CONTROL_CHARACTERS.test(raw)) {
    return null;
  }
  const match = LABEL_PATTERN.exec(raw);
  if (!match) {
    return null;
  }
  const [, rawCode = '', rawColor = '', rawSize = ''] = match;
  const code = rawCode.trim();
  const color = rawColor.trim();
  const size = rawSize.trim();
  if ([code, color, size].some((field) => field === '')) {
    return null;
  }
  return { raw, code, color, size };
}
