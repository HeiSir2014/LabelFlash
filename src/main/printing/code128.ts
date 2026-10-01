/**
 * Code128 条码编码（快递运单号用的码制）。只做面单需要的：可打印 ASCII 用 B 子集，连续数字用 C 子集（两位一个符号，
 * 条码更短、更好扫）；不支持控制字符和中文（Code128 本身不能编码中文）。
 * 码表、校验位（起始符 + Σ 位置 × 值，模 103）和终止符按 ISO/IEC 15417。
 */

/** 每个符号是 3 条 3 空交替的宽度（模块数），共 11 个模块；终止符 2331112 共 13 个模块。 */
const PATTERNS = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
] as const;

export const CODE128_PATTERNS: readonly string[] = PATTERNS;

const START_B = 104;
const START_C = 105;
/** 在 B 子集里切到 C 子集。 */
const SWITCH_TO_C = 99;
/** 在 C 子集里切到 B 子集。 */
const SWITCH_TO_B = 100;
const STOP = 106;
const CHECKSUM_MODULUS = 103;
/** B 子集：空格（32）到 ~（126），值 = 字符码 − 32。 */
const FIRST_PRINTABLE = 32;
const LAST_PRINTABLE = 126;
/** 开头至少 4 位数字、中间至少 6 位、结尾至少 4 位才切到 C 子集：更短的数字串切换反而更长。 */
const MIN_DIGITS_AT_EDGE = 4;
const MIN_DIGITS_IN_MIDDLE = 6;

export interface Code128 {
  /** 符号值（含起始符、校验位、终止符），测试和排查用。 */
  symbols: number[];
  /** 从第一条开始，条、空交替的宽度（模块数）。 */
  widths: number[];
  /** 总模块数（不含两侧空白）。 */
  modules: number;
}

/** 编码失败（空、有不能编码的字符）返回 null：调用方不印条码，并提示。 */
export function encodeCode128(text: string): Code128 | null {
  if (
    text === '' ||
    [...text].some((char) => char.charCodeAt(0) < FIRST_PRINTABLE || char.charCodeAt(0) > LAST_PRINTABLE)
  ) {
    return null;
  }
  const symbols = dataSymbols(text);
  const checksum = symbols.reduce((sum, value, index) => sum + value * Math.max(1, index), 0) % CHECKSUM_MODULUS;
  const all = [...symbols, checksum, STOP];
  const widths = all.flatMap((value) => [...(PATTERNS[value] ?? '')].map(Number));
  return { symbols: all, widths, modules: widths.reduce((sum, width) => sum + width, 0) };
}

/** 起始符和数据符号：数字串够长就用 C 子集两位一组，其余用 B 子集。 */
function dataSymbols(text: string): number[] {
  const digitRun = (from: number) => {
    let end = from;
    while (end < text.length && isDigit(text[end] ?? '')) {
      end += 1;
    }
    return end - from;
  };
  const leading = digitRun(0);
  let inC = leading >= MIN_DIGITS_AT_EDGE || (leading === text.length && leading % 2 === 0);
  // 整串都是奇数位数字（例如 15 位运单号）：先在 B 子集印一位，剩下的偶数位用 C。
  // 后面还有字母时从 C 开始：多出的一位留到切回 B 之后和字母一起印，比先印这一位少一个符号。
  if (inC && leading % 2 === 1 && leading === text.length) {
    inC = false;
  }
  const symbols = [inC ? START_C : START_B];
  let position = 0;
  while (position < text.length) {
    const run = digitRun(position);
    if (inC) {
      if (run >= 2) {
        symbols.push(Number(text.slice(position, position + 2)));
        position += 2;
        continue;
      }
      symbols.push(SWITCH_TO_B);
      inC = false;
      continue;
    }
    const atEnd = position + run === text.length;
    const worthSwitching = run >= MIN_DIGITS_IN_MIDDLE || (run >= MIN_DIGITS_AT_EDGE && (atEnd || position === 0));
    if (worthSwitching && run % 2 === 0) {
      symbols.push(SWITCH_TO_C);
      inC = true;
      continue;
    }
    symbols.push((text.charCodeAt(position) ?? FIRST_PRINTABLE) - FIRST_PRINTABLE);
    position += 1;
  }
  return symbols;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}
