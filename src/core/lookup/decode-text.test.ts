import { describe, expect, test } from 'bun:test';
import { decodeCsvBytes } from './decode-text';

describe('decodeCsvBytes', () => {
  test('reads UTF-8, with or without a BOM', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('编码,货架'))).toBe('编码,货架');
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  test('falls back to GBK for files saved by Chinese Excel', () => {
    // 「编码」的 GBK 编码。
    expect(decodeCsvBytes(new Uint8Array([0xb1, 0xe0, 0xc2, 0xeb]))).toBe('编码');
  });
});
