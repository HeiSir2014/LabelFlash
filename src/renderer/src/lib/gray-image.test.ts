import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS, type CanvasElement, newCanvasElement } from '../../../core/templates/canvas-model';
import { decodeGray } from '../../../core/templates/mono-image';
import { bytesToBase64, fitPixelBudget, fitsTemplateBudget, imageBytesUsed, rgbaToGray } from './gray-image';

const PAPER = { widthMm: 60, heightMm: 40 };

/** 指定像素尺寸的图片元素。只算字节数的用例用不到像素内容，留空省时间。 */
function image(id: string, pixelWidth: number, pixelHeight: number): CanvasElement {
  const base = newCanvasElement('image', id, PAPER);
  return base.kind === 'image' ? { ...base, pixelWidth, pixelHeight, pixels: '' } : base;
}

describe('rgbaToGray', () => {
  test('uses Rec. 601 luma', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect(rgbaToGray(rgba, 3, 1)).toEqual(new Uint8Array([255, 0, 76]));
  });

  test('treats transparent pixels as white paper', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]);
    expect(rgbaToGray(rgba, 2, 1)).toEqual(new Uint8Array([255, 127]));
  });

  test('throws when there are fewer bytes than the width and height promise', () => {
    expect(() => rgbaToGray(new Uint8ClampedArray(4), 2, 1)).toThrow(/expected at least 8 bytes/);
  });
});

describe('fitPixelBudget', () => {
  test('keeps an image that already fits', () => {
    expect(fitPixelBudget(100, 50, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels)).toEqual({
      width: 100,
      height: 50,
    });
  });

  test('shrinks a large photo to the pixel budget keeping its shape', () => {
    const size = fitPixelBudget(2000, 1000, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels);
    expect(size).toEqual({ width: 1448, height: 724 });
    expect(size.width * size.height).toBeLessThanOrEqual(CANVAS_LIMITS.imageBytes);
  });

  test('limits the longest side of a very thin image', () => {
    expect(fitPixelBudget(10000, 10, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels)).toEqual({
      width: 4000,
      height: 4,
    });
  });

  test('shrinks a photo where the pixel budget and the side limit both apply', () => {
    // 5000×3000：像素预算把它压到比两边的「单边上限」都更小，两条限制同时起作用，不是只有一条说了算。
    const width = 5000;
    const height = 3000;
    const { imageBytes, imageSidePixels } = CANVAS_LIMITS;
    const scale = Math.min(
      1,
      Math.sqrt(imageBytes / (width * height)),
      imageSidePixels / width,
      imageSidePixels / height,
    );
    expect(imageSidePixels / width).toBeLessThan(1);
    expect(Math.sqrt(imageBytes / (width * height))).toBeLessThan(1);
    expect(fitPixelBudget(width, height, imageBytes, imageSidePixels)).toEqual({
      width: Math.floor(width * scale),
      height: Math.floor(height * scale),
    });
  });
});

describe('bytesToBase64', () => {
  test('encodes gray pixels that the template decoder reads back', () => {
    const pixels = new Uint8Array([0, 128, 255, 7]);
    expect(decodeGray(bytesToBase64(pixels), 2, 2)?.pixels).toEqual(pixels);
  });

  test('encodes a megabyte without running out of stack', () => {
    const pixels = new Uint8Array(CANVAS_LIMITS.imageBytes).fill(200);
    expect(atob(bytesToBase64(pixels)).length).toBe(CANVAS_LIMITS.imageBytes);
  });
});

describe('template image budget', () => {
  test('adds up the gray pixels of every image except the one being replaced', () => {
    const elements = [image('a', 20, 10), image('b', 5, 5), newCanvasElement('text', 't', PAPER)];
    expect(imageBytesUsed(elements, null)).toBe(225);
    expect(imageBytesUsed(elements, 'a')).toBe(25);
  });

  test('refuses an image that would take the template over its limit', () => {
    // 3MB 的一张，再放 1MB 正好到 4MB 的上限。
    const big = image('a', 2048, 1536);
    expect(fitsTemplateBudget([big], null, CANVAS_LIMITS.imageBytes)).toBe(true);
    expect(fitsTemplateBudget([big], null, CANVAS_LIMITS.imageBytes + 1)).toBe(false);
    expect(fitsTemplateBudget([big], 'a', CANVAS_LIMITS.imageBytes + 1)).toBe(true);
  });
});
