/**
 * 没有声明字符集（ECI）的码，按原始字节决定是 UTF-8 还是 GBK。
 *
 * 不能只做「UTF-8 严格解码，失败再按 GBK」：短的 GBK 中文可能恰好是合法的 UTF-8。
 * 例如「图片色」的 GBK 字节 CD BC C6 AC C9 AB 按 UTF-8 解出来是「ͼƬɫ」（ZXing 自己也会这么猜）。
 *
 * 规则：
 * - 不是合法 UTF-8 → 按 GB18030（兼容 GBK）。
 * - 是合法 UTF-8，同时满足下面三条才改按 GB18030：
 *   1. UTF-8 结果里没有 U+0800 以上的字符。真正的 UTF-8 中文是 3 字节字符，一定超过它；
 *   2. 用到了 Latin-1 以外的 2 字节字符（希腊字母、国际音标之类）。「60×40」「Café」「5°C」都在 Latin-1 里，不受影响；
 *   3. GB18030 结果干净：没有替换字符，非 ASCII 的都是中文或中文标点。
 * 代价：只由希腊、西里尔等 2 字节字母组成、且按 GBK 恰好能解成中文的 UTF-8 文字会被误读。样衣间的码里几乎不会出现这种内容，
 * 而 GBK 编码的中文码很常见。
 */
const ASCII_LAST = 0x7f;
const LATIN1_LAST = 0xff;
const TWO_BYTE_UTF8_LAST = 0x7ff;
const REPLACEMENT_CHARACTER = 0xfffd;
/** 中文和中文标点所在的区段：CJK 符号和标点、CJK 扩展 A、CJK 统一汉字、全角字符。 */
const CHINESE_RANGES: readonly [number, number][] = [
  [0x3000, 0x303f],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xff00, 0xffef],
];

export function decodeBarcodeBytes(bytes: Uint8Array): string {
  let utf8: string;
  try {
    utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
  if (!looksLikeMisreadGbk(utf8)) {
    return utf8;
  }
  const gbk = new TextDecoder('gb18030').decode(bytes);
  return isCleanChinese(gbk) ? gbk : utf8;
}

/** 没有替换字符，非 ASCII 的字符都是中文或中文标点。 */
function isCleanChinese(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? REPLACEMENT_CHARACTER;
    if (code > ASCII_LAST && !CHINESE_RANGES.some(([first, last]) => code >= first && code <= last)) {
      return false;
    }
  }
  return true;
}

function looksLikeMisreadGbk(text: string): boolean {
  let hasBeyondLatin1 = false;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > TWO_BYTE_UTF8_LAST) {
      return false;
    }
    if (code > LATIN1_LAST) {
      hasBeyondLatin1 = true;
    }
  }
  return hasBeyondLatin1;
}
