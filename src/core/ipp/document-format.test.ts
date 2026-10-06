import { describe, expect, test } from 'bun:test';
import { isSupportedFormat, sniffFormat } from './document-format';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffFormat', () => {
  test('recognises each supported format by its first bytes', () => {
    expect(sniffFormat(text('%PDF-1.7\n'))).toBe('application/pdf');
    // 有的导出工具在 %PDF- 前面加几个字节：规范允许它出现在前 1024 字节里。
    expect(sniffFormat(text('\n\n%PDF-1.4\n'))).toBe('application/pdf');
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('image/jpeg');
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('image/png');
    expect(sniffFormat(text('RaS2xxxx'))).toBe('image/pwg-raster');
    expect(sniffFormat(text('UNIRAST\0xxxx'))).toBe('image/urf');
  });

  test('returns null for anything else', () => {
    expect(sniffFormat(text('%!PS-Adobe-3.0'))).toBeNull();
    expect(sniffFormat(new Uint8Array(0))).toBeNull();
    // %PDF- 不在前 1024 字节里：不认。
    expect(sniffFormat(text(`${' '.repeat(1024)}%PDF-1.7`))).toBeNull();
  });
});

describe('isSupportedFormat', () => {
  test('accepts the declared formats in any case', () => {
    expect(isSupportedFormat('application/octet-stream')).toBe(true);
    expect(isSupportedFormat('Image/PWG-Raster')).toBe(true);
    expect(isSupportedFormat('application/postscript')).toBe(false);
  });
});
