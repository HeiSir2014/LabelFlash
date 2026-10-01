// src/core/templates/mono-image.test.ts
import { describe, expect, test } from 'bun:test';
import { decodeGray, fitContain, monoPath, resizeGray, toMono } from './mono-image';

/** 把 0–255 的数组编码成 base64，方便写用例。 */
function base64(values: number[]): string {
  return btoa(String.fromCharCode(...values));
}

describe('mono image', () => {
  test('decodes gray pixels only when the size matches', () => {
    expect(decodeGray(base64([0, 255]), 2, 1)?.pixels).toEqual(new Uint8Array([0, 255]));
    expect(decodeGray(base64([0, 255]), 3, 1)).toBeNull();
  });

  test('fits an image into a box keeping its aspect ratio', () => {
    expect(fitContain(200, 100, 50, 50)).toEqual({ width: 50, height: 25 });
    expect(fitContain(100, 200, 50, 50)).toEqual({ width: 25, height: 50 });
    expect(fitContain(1, 1000, 50, 50)).toEqual({ width: 1, height: 50 });
  });

  test('averages pixels when shrinking', () => {
    const image = { width: 2, height: 2, pixels: new Uint8Array([0, 255, 255, 255]) };
    expect(resizeGray(image, 1, 1).pixels).toEqual(new Uint8Array([191]));
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

  test('draws runs of black dots as one rectangle each', () => {
    const mono = new Uint8Array([1, 1, 0, 1, 0, 0, 0, 0]);
    expect(monoPath(mono, 4, 2)).toBe('M0 0h2v1H0zM3 0h1v1H3z');
  });
});
