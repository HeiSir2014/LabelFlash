import { describe, expect, test } from 'bun:test';
import { MAX_RAW_LENGTH, normalizeRaw } from './normalize-raw';

const char = (codePoint: number) => String.fromCodePoint(codePoint);

describe('normalizeRaw', () => {
  test('unifies line endings and trims the whole content', () => {
    expect(normalizeRaw('  订单号:A100\r\n尺码:M\r颜色:红\n  ')).toBe('订单号:A100\n尺码:M\n颜色:红');
  });

  test('keeps line breaks and tabs inside the content', () => {
    expect(normalizeRaw('A100\tM\n第二行')).toBe('A100\tM\n第二行');
  });

  test('rejects empty content', () => {
    expect(normalizeRaw('')).toBeNull();
    expect(normalizeRaw(' \r\n\t ')).toBeNull();
  });

  test('rejects invisible and control characters that scanners never send on purpose', () => {
    for (const codePoint of [0x00, 0x07, 0x1b, 0x7f, 0x85, 0x200b, 0x200e, 0x2028, 0x2060, 0xfeff]) {
      expect(normalizeRaw(`A1${char(codePoint)}00`)).toBeNull();
    }
  });

  test('accepts content exactly at the length limit and rejects anything longer', () => {
    expect(normalizeRaw('9'.repeat(MAX_RAW_LENGTH))).toHaveLength(MAX_RAW_LENGTH);
    expect(normalizeRaw('9'.repeat(MAX_RAW_LENGTH + 1))).toBeNull();
  });
});
