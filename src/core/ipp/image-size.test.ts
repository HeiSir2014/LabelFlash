import { describe, expect, test } from 'bun:test';
import { IMAGE_LIMITS, imageSize, isImageTooLarge } from './image-size';
import { jpegHeader, pngHeader } from './testing/image-fixtures';

describe('imageSize', () => {
  test('reads the size from the PNG header', () => {
    expect(imageSize(pngHeader(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });

  test('reads the size from a baseline or progressive JPEG frame header', () => {
    expect(imageSize(jpegHeader(4032, 3024), 'image/jpeg')).toEqual({ width: 4032, height: 3024 });
    expect(imageSize(jpegHeader(800, 600, 0xc2), 'image/jpeg')).toEqual({ width: 800, height: 600 });
  });

  test('gives up on truncated or headerless files', () => {
    expect(imageSize(pngHeader(640, 480).subarray(0, 20), 'image/png')).toBeNull();
    expect(imageSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2), 'image/jpeg')).toBeNull();
    expect(imageSize(jpegHeader(800, 600).subarray(0, 18), 'image/jpeg')).toBeNull();
    expect(imageSize(Uint8Array.of(1, 2, 3), 'image/png')).toBeNull();
  });

  test('treats a zero side as unreadable', () => {
    expect(imageSize(pngHeader(0, 480), 'image/png')).toBeNull();
    expect(imageSize(jpegHeader(800, 0), 'image/jpeg')).toBeNull();
  });
});

describe('isImageTooLarge', () => {
  // 一张几 KB 的 PNG 能声明 10 万 × 10 万像素：解码前按文件头拒绝，不让渲染页去分配几十 GB。
  test('refuses images whose decoded size would be huge', () => {
    expect(isImageTooLarge({ width: 4032, height: 3024 })).toBe(false);
    expect(isImageTooLarge({ width: 100_000, height: 100_000 })).toBe(true);
    expect(isImageTooLarge({ width: IMAGE_LIMITS.side + 1, height: 10 })).toBe(true);
    const square = Math.ceil(Math.sqrt(IMAGE_LIMITS.pixels + 1));
    expect(isImageTooLarge({ width: square, height: square })).toBe(true);
  });
});
