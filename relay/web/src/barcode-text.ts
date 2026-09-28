/**
 * 没有声明字符集（ECI）的码，按原始字节决定是 UTF-8 还是 GBK。
 *
 * 不能只做「UTF-8 严格解码，失败再按 GBK」：短的 GBK 中文可能恰好是合法的 UTF-8。
 * 例如「图片色」的 GBK 字节 CD BC C6 AC C9 AB 按 UTF-8 解出来是「ͼƬɫ」，「帽」C3 B1 解出来是「ñ」，
 * 「路」C2 B7 解出来是「·」（ZXing 自己也会这么猜）。
 *
 * 规则：
 * - 不是合法 UTF-8 → 按 GB18030（兼容 GBK）。
 * - 是合法 UTF-8 时，满足下面几条才改按 GB18030：
 *   1. 非 ASCII 的都是 2 字节字符（U+0080–U+07FF）。真正的 UTF-8 中文是 3 字节字符，有它就一定是 UTF-8；
 *   2. 这些字节按 GBK 读都落在 GB2312 的汉字区（第二个字节不小于 A1），也就是常用汉字；
 *      「60×40」的「×」（C3 97）、「Ø」（C3 98）不在这个区，不会被误改；
 *   3. 用到了 Latin-1 以外的 2 字节字符（希腊字母、国际音标之类，标签里不会有），
 *      或者只有 Latin-1 字符、但没有一个紧挨着英文字母——「Café」「Müller」「5°C」里的重音字母和符号
 *      都贴着字母，是真的拉丁文字；「-帽-」「路」误读出的「ñ」「·」旁边是符号、数字或什么都没有；
 *   4. GB18030 结果干净：没有替换字符，非 ASCII 的都是中文或中文标点。
 * 代价：紧挨着英文字母、且恰好只由这类字节组成的 GBK 中文（例如「TK帽」）会读成拉丁字母；
 * 只由希腊、西里尔等字母组成、按 GBK 恰好能解成常用汉字的 UTF-8 文字会被误读。样衣间的码里几乎不会出现这两种。
 */
const ASCII_LAST = 0x7f;
const LATIN1_LAST = 0xff;
const TWO_BYTE_UTF8_LAST = 0x7ff;
const REPLACEMENT_CHARACTER = 0xfffd;
/** UTF-8 续字节：高两位是 10，低 6 位是码点的最低 6 位。 */
const CONTINUATION_PREFIX = 0x80;
const CONTINUATION_BITS = 0x3f;
/** GB2312 的第二个字节从 A1 开始；GBK 扩充的生僻字才用到 40–A0。 */
const GB2312_TRAIL_FIRST = 0xa1;
const ASCII_LETTER = /^[A-Za-z]$/;
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

/** 见文件开头的规则 1–3。 */
function looksLikeMisreadGbk(text: string): boolean {
  const characters = Array.from(text);
  let hasNonAscii = false;
  let hasBeyondLatin1 = false;
  let touchesLetter = false;
  for (const [index, char] of characters.entries()) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= ASCII_LAST) {
      continue;
    }
    if (code > TWO_BYTE_UTF8_LAST || (CONTINUATION_PREFIX | (code & CONTINUATION_BITS)) < GB2312_TRAIL_FIRST) {
      return false;
    }
    hasNonAscii = true;
    hasBeyondLatin1 ||= code > LATIN1_LAST;
    touchesLetter ||= isAsciiLetter(characters[index - 1]) || isAsciiLetter(characters[index + 1]);
  }
  return hasNonAscii && (hasBeyondLatin1 || !touchesLetter);
}

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && ASCII_LETTER.test(char);
}
