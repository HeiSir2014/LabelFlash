import { describe, expect, test } from 'bun:test';
import { CODE128_PATTERNS, encodeCode128 } from './code128';

const START_B = 104;
const START_C = 105;
const SWITCH_TO_C = 99;
const STOP = 106;

/** 把条空宽度按码表解回符号值：和编码互相印证。 */
function decode(widths: readonly number[]): number[] {
  const symbols: number[] = [];
  let index = 0;
  while (index < widths.length) {
    const size = widths.length - index === 7 ? 7 : 6;
    const pattern = widths.slice(index, index + size).join('');
    symbols.push(CODE128_PATTERNS.indexOf(pattern));
    index += size;
  }
  return symbols;
}

describe('Code128 patterns', () => {
  test('every symbol is 11 modules wide and the stop symbol 13', () => {
    CODE128_PATTERNS.forEach((pattern, value) => {
      const modules = [...pattern].reduce((sum, width) => sum + Number(width), 0);
      expect(modules).toBe(value === STOP ? 13 : 11);
    });
  });

  test('every symbol has its own pattern', () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length);
  });
});

describe('encodeCode128', () => {
  test('encodes text in set B with the standard checksum', () => {
    // 校验位 = (起始符 104 + Σ 位置 × 值) mod 103 = 3281 mod 103 = 88。
    const code = encodeCode128('Wikipedia');
    expect(code?.symbols).toEqual([START_B, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, STOP]);
  });

  test('uses set C for an even run of digits', () => {
    const code = encodeCode128('123456');
    expect(code?.symbols.slice(0, 4)).toEqual([START_C, 12, 34, 56]);
  });

  test('prints the first digit in set B when a digit-only number has an odd length', () => {
    const code = encodeCode128('781234567890123');
    expect(code?.symbols.slice(0, 4)).toEqual([START_B, 23, SWITCH_TO_C, 81]);
  });

  test('switches to set C after a letter prefix', () => {
    const code = encodeCode128('DPK123456789012');
    expect(code?.symbols.slice(0, 5)).toEqual([START_B, 36, 48, 43, SWITCH_TO_C]);
  });

  test('round-trips through the pattern table and counts modules', () => {
    const code = encodeCode128('SF1234567890123');
    if (!code) throw new Error('expected a barcode');
    expect(decode(code.widths)).toEqual(code.symbols);
    expect(code.modules).toBe(11 * (code.symbols.length - 1) + 13);
  });

  test('refuses empty text, control characters and Chinese', () => {
    expect(encodeCode128('')).toBeNull();
    expect(encodeCode128('A\tB')).toBeNull();
    expect(encodeCode128('运单123')).toBeNull();
  });
});
