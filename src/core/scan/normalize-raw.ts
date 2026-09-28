/** 扫码内容的长度上限：多行键值的二维码也够用，又不会让标签和打印记录失控。 */
export const MAX_RAW_LENGTH = 1_000;

/**
 * 不允许出现的字符（按码点区间拼正则，不在源码里直接写这些字符）：
 * 除换行（0x0A）和制表符（0x09）以外的 C0 控制符、DEL 与 C1 控制符、零宽和双向控制符、
 * 行 / 段分隔符、零宽连接类字符、BOM。扫码枪不会有意发送它们，出现时多半是乱码或粘贴进来的脏数据。
 */
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];
const FORBIDDEN_CHARACTERS = new RegExp(
  `[${FORBIDDEN_RANGES.map(([start, end]) => `${String.fromCharCode(start)}-${String.fromCharCode(end)}`).join('')}]`,
);

/**
 * 扫码内容规范化：换行统一为 \n，去掉首尾空白。结果既是识别的输入，也是防重复的依据。
 * 空内容、超长或含不允许的字符时返回 null。
 */
export function normalizeRaw(input: string): string | null {
  const raw = input.replace(/\r\n?/g, '\n').trim();
  if (raw === '' || raw.length > MAX_RAW_LENGTH || FORBIDDEN_CHARACTERS.test(raw)) {
    return null;
  }
  return raw;
}
