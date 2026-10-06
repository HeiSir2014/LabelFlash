import { describe, expect, test } from 'bun:test';
import { type MonoBitmap, monoToGray, packMono, unpackMono } from './mono-pack';

/** 10×3：宽度不是 8 的倍数，最后一个字节只用 2 位。 */
const BITMAP: MonoBitmap = {
  width: 10,
  height: 3,
  // biome-ignore format: 按行排列，一眼看出每一行的点
  bits: Uint8Array.from([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    0, 1, 1, 0, 0, 0, 0, 0, 1, 0,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ]),
};

describe('mono pack', () => {
  test('packs one bit per dot and reads back the same dots', () => {
    const packed = packMono(BITMAP);
    // 12 字节头 + 每行 2 字节 × 3 行
    expect(packed).toHaveLength(12 + 2 * 3);
    expect(unpackMono(packed)).toEqual(BITMAP);
  });

  test('refuses files that are not ours or are cut short', () => {
    const packed = packMono(BITMAP);
    expect(unpackMono(packed.slice(0, packed.length - 1))).toBeNull();
    const wrongMagic = packed.slice();
    wrongMagic[0] = 0;
    expect(unpackMono(wrongMagic)).toBeNull();
    expect(unpackMono(new Uint8Array(4))).toBeNull();
  });

  test('refuses an empty or oversized bitmap header', () => {
    const empty = packMono({ width: 1, height: 1, bits: Uint8Array.of(1) });
    new DataView(empty.buffer).setUint32(4, 0, true);
    expect(unpackMono(empty)).toBeNull();
    const huge = packMono({ width: 1, height: 1, bits: Uint8Array.of(1) });
    new DataView(huge.buffer).setUint32(8, 100_000, true);
    expect(unpackMono(huge)).toBeNull();
  });

  test('reads a buffer that is a view into a larger array', () => {
    const packed = packMono(BITMAP);
    const larger = new Uint8Array(packed.length + 5);
    larger.set(packed, 5);
    expect(unpackMono(larger.subarray(5))).toEqual(BITMAP);
  });

  test('turns black dots into gray 0 and white dots into gray 255', () => {
    expect(monoToGray({ width: 2, height: 1, bits: Uint8Array.of(1, 0) })).toEqual({
      width: 2,
      height: 1,
      pixels: Uint8Array.of(0, 255),
    });
  });
});
