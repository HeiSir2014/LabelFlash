import { describe, expect, test } from 'bun:test';
import { decodeBarcodeBytes } from './barcode-text';

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('decodeBarcodeBytes', () => {
  test('reads UTF-8 Chinese', () => {
    expect(decodeBarcodeBytes(utf8('CL5640-TK-图片色-XL'))).toBe('CL5640-TK-图片色-XL');
    expect(decodeBarcodeBytes(utf8('图片色·XL'))).toBe('图片色·XL');
  });

  test('reads GBK Chinese whose bytes are not valid UTF-8', () => {
    // 编码
    expect(decodeBarcodeBytes(new Uint8Array([0xb1, 0xe0, 0xc2, 0xeb]))).toBe('编码');
  });

  test('reads GBK Chinese whose bytes happen to be valid UTF-8', () => {
    // 图片色：CD BC C6 AC C9 AB 按 UTF-8 解出来是「ͼƬɫ」。
    expect(decodeBarcodeBytes(new Uint8Array([0x41, 0xcd, 0xbc, 0xc6, 0xac, 0xc9, 0xab]))).toBe('A图片色');
  });

  test('keeps UTF-8 Latin-1 symbols as they are', () => {
    expect(decodeBarcodeBytes(utf8('60×40 Café 5°C'))).toBe('60×40 Café 5°C');
  });

  test('keeps plain ASCII', () => {
    expect(decodeBarcodeBytes(utf8('20260929001'))).toBe('20260929001');
  });
});
