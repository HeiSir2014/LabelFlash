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

  test('reads GBK Chinese that looks like a Latin-1 letter or symbol', () => {
    // 帽：C3 B1，按 UTF-8 是「ñ」；路：C2 B7，按 UTF-8 是「·」。
    expect(decodeBarcodeBytes(new Uint8Array([0xc3, 0xb1]))).toBe('帽');
    expect(decodeBarcodeBytes(new Uint8Array([0xc2, 0xb7]))).toBe('路');
    const dashed = [...utf8('CL5640-'), 0xc3, 0xb1, ...utf8('-XL')];
    expect(decodeBarcodeBytes(new Uint8Array(dashed))).toBe('CL5640-帽-XL');
  });

  test('keeps UTF-8 Latin-1 symbols as they are', () => {
    expect(decodeBarcodeBytes(utf8('60×40 Café 5°C'))).toBe('60×40 Café 5°C');
  });

  test('keeps accented Latin words and units written next to letters', () => {
    for (const text of ['Café', 'Müller', '5°C', 'Ø12', '60×40']) {
      expect(decodeBarcodeBytes(utf8(text))).toBe(text);
    }
  });

  test('keeps plain ASCII', () => {
    expect(decodeBarcodeBytes(utf8('20260929001'))).toBe('20260929001');
  });
});
