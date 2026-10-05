import { describe, expect, test } from 'bun:test';
import { decodeGray, encodeGray, fitContain, monoBmp, resizeGray, toMono } from './mono-image';

/** 把 0–255 的数组编码成 base64，方便写用例。 */
function base64(values: number[]): string {
  return btoa(String.fromCharCode(...values));
}

/** base64 解回字节数组，核对 BMP 头和像素数据用。 */
function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

describe('mono image', () => {
  test('decodes gray pixels only when the size matches', () => {
    expect(decodeGray(base64([0, 255]), 2, 1)?.pixels).toEqual(new Uint8Array([0, 255]));
    expect(decodeGray(base64([0, 255]), 3, 1)).toBeNull();
  });

  test('rejects invalid base64 and non-positive sizes', () => {
    expect(decodeGray('***', 1, 1)).toBeNull();
    // -2 * -1 = 2，和真实字节数凑巧相等；不单独守卫宽高就会被当成合法尺寸
    expect(decodeGray(base64([0, 255]), -2, -1)).toBeNull();
  });

  test('fits an image into a box keeping its aspect ratio', () => {
    expect(fitContain(200, 100, 50, 50)).toEqual({ width: 50, height: 25 });
    expect(fitContain(100, 200, 50, 50)).toEqual({ width: 25, height: 50 });
    expect(fitContain(1, 1000, 50, 50)).toEqual({ width: 1, height: 50 });
    expect(fitContain(100, 100, 50, 50)).toEqual({ width: 50, height: 50 });
  });

  test('falls back to a 1x1 box for non-positive sizes', () => {
    expect(fitContain(0, 10, 50, 50)).toEqual({ width: 1, height: 1 });
    expect(fitContain(10, 10, 0, 50)).toEqual({ width: 1, height: 1 });
  });

  test('averages pixels when shrinking', () => {
    const image = { width: 2, height: 2, pixels: new Uint8Array([0, 255, 255, 255]) };
    expect(resizeGray(image, 1, 1).pixels).toEqual(new Uint8Array([191]));
  });

  test('repeats pixels when enlarging (nearest neighbor)', () => {
    const square = { width: 1, height: 1, pixels: new Uint8Array([0]) };
    expect(resizeGray(square, 2, 2).pixels).toEqual(new Uint8Array([0, 0, 0, 0]));

    const strip = { width: 2, height: 1, pixels: new Uint8Array([0, 255]) };
    expect(resizeGray(strip, 4, 1).pixels).toEqual(new Uint8Array([0, 0, 255, 255]));
  });

  test('turns pixels darker than the threshold black', () => {
    const image = { width: 3, height: 1, pixels: new Uint8Array([10, 127, 200]) };
    expect(toMono(image, 'threshold', 128)).toEqual(new Uint8Array([1, 1, 0]));
  });

  test('dithers a mid gray into about half black dots', () => {
    const size = 20;
    const image = { width: size, height: size, pixels: new Uint8Array(size * size).fill(128) };
    const black = toMono(image, 'dither', 128).reduce((sum, value) => sum + value, 0);
    expect(black / (size * size)).toBeGreaterThan(0.4);
    expect(black / (size * size)).toBeLessThan(0.6);
  });

  test('encodes mono dots as a 1-bit BMP with the expected header', () => {
    // 3×2：顶行（y=0）[1,0,1] 黑白黑，底行（y=1）[0,1,0] 白黑白；BMP 文件里行是从下到上存的
    const mono = new Uint8Array([1, 0, 1, 0, 1, 0]);
    const bytes = bytesFromBase64(monoBmp(mono, 3, 2));
    const view = new DataView(bytes.buffer);

    expect(bytes[0]).toBe(0x42); // 'B'
    expect(bytes[1]).toBe(0x4d); // 'M'
    expect(view.getUint32(2, true)).toBe(bytes.length); // 文件头的文件大小字段
    expect(view.getUint32(10, true)).toBe(62); // 数据偏移 = 14（文件头）+ 40（信息头）+ 8（调色板）
    expect(view.getInt32(18, true)).toBe(3); // width
    expect(view.getInt32(22, true)).toBe(2); // height 为正数：行从下到上存
    expect(view.getUint16(28, true)).toBe(1); // bitCount：每像素 1 位

    // 每行 3 像素只占 1 字节，但 BMP 要求整行补到 4 字节的倍数
    expect(bytes[62]).toBe(0b01000000); // 底行 [0,1,0] 先存
    expect(bytes[63]).toBe(0);
    expect(bytes[64]).toBe(0);
    expect(bytes[65]).toBe(0);
    expect(bytes[66]).toBe(0b10100000); // 顶行 [1,0,1] 后存
    expect(bytes[67]).toBe(0);
  });

  test('keeps a full-label dithered photo bounded in size', () => {
    // 100×150mm 标签按打印点换算出的尺寸：787×1181 点，全黑是最坏情况
    const width = 787;
    const height = 1181;
    const mono = new Uint8Array(width * height).fill(1);
    const bytes = bytesFromBase64(monoBmp(mono, width, height));
    const rowBytesPadded = 100; // ceil(787 / 8) = 99，再补到 4 的倍数 = 100
    expect(bytes.length).toBe(62 + rowBytesPadded * height);
  });
});

describe('encodeGray', () => {
  test('is the inverse of decodeGray', () => {
    const image = { width: 3, height: 2, pixels: Uint8Array.of(0, 64, 128, 192, 255, 7) };
    expect(decodeGray(encodeGray(image), 3, 2)).toEqual(image);
  });
});
