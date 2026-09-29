import { describe, expect, test } from 'bun:test';
import { addonFileName } from './addon-name.ts';
import { checkRecognizeInput } from './index.ts';

describe('checkRecognizeInput', () => {
  test('fills in a tight stride', () => {
    const input = checkRecognizeInput({ data: new Uint8Array(24), width: 3, height: 2, pixelFormat: 'BGRA' });
    expect(input.stride).toBe(12);
  });

  test('accepts a padded stride whose last row has no padding', () => {
    const data = new Uint8Array(20 + 12);
    expect(checkRecognizeInput({ data, width: 3, height: 2, stride: 20, pixelFormat: 'BGRA' }).stride).toBe(20);
  });

  test('accepts a Buffer', () => {
    expect(() =>
      checkRecognizeInput({ data: Buffer.alloc(18), width: 3, height: 2, pixelFormat: 'RGB' }),
    ).not.toThrow();
  });

  test('refuses data shorter than the image', () => {
    expect(() => checkRecognizeInput({ data: new Uint8Array(23), width: 3, height: 2, pixelFormat: 'BGRA' })).toThrow(
      '至少要 24 字节',
    );
  });

  test('refuses a stride narrower than a row', () => {
    expect(() =>
      checkRecognizeInput({ data: new Uint8Array(100), width: 3, height: 2, stride: 8, pixelFormat: 'BGRA' }),
    ).toThrow('stride');
  });

  test('refuses sizes that are not positive integers', () => {
    expect(() => checkRecognizeInput({ data: new Uint8Array(100), width: 0, height: 2, pixelFormat: 'RGB' })).toThrow(
      'width',
    );
    expect(() => checkRecognizeInput({ data: new Uint8Array(100), width: 2, height: 1.5, pixelFormat: 'RGB' })).toThrow(
      'height',
    );
  });

  test('refuses an unknown pixel format', () => {
    expect(() =>
      checkRecognizeInput({ data: new Uint8Array(100), width: 2, height: 2, pixelFormat: 'YUV' as 'RGB' }),
    ).toThrow('pixelFormat');
  });
});

test('names the addon by platform and architecture', () => {
  expect(addonFileName('win32', 'x64')).toBe('ocr-addon.win32-x64-msvc.node');
  expect(addonFileName('darwin', 'arm64')).toBe('ocr-addon.darwin-arm64.node');
});
