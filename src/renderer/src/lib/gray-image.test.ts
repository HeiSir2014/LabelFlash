import { describe, expect, test } from 'bun:test';
import { CANVAS_LIMITS, type CanvasElement, newCanvasElement } from '../../../core/templates/canvas-model';
import { decodeGray } from '../../../core/templates/mono-image';
import {
  bytesToBase64,
  fitPixelBudget,
  fitsTemplateBudget,
  imageBytesUsed,
  readImagePixelSize,
  rgbaToGray,
} from './gray-image';

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

  test('the side limit decides when it is tighter than the pixel budget, even though the pixel budget alone would also shrink it', () => {
    // 8000×400：单按像素预算算，缩放到约 0.57 倍就够了（1024×1024 个像素以内）；
    // 但单边上限更严格（4000/8000=0.5 倍），真正说了算的是单边上限，不是像素预算。
    expect(fitPixelBudget(8000, 400, CANVAS_LIMITS.imageBytes, CANVAS_LIMITS.imageSidePixels)).toEqual({
      width: 4000,
      height: 200,
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

describe('readImagePixelSize', () => {
  /** PNG：签名 8 字节 + IHDR 块（长度 + 类型 + 宽高 + 其余字段 + CRC，宽高之外的内容不要求合法）。 */
  function png(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0, 0, 0, 13], 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return bytes;
  }

  /** JPEG：SOI + 一个带长度字段的 APP0 段（练一下「跳过不认识的段」）+ SOFn 段（宽高在这里）。 */
  function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
    const app0Payload = [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0];
    const sofPayload = [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 1, 1, 0x11, 0];
    return new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      (app0Payload.length + 2) >> 8,
      (app0Payload.length + 2) & 0xff,
      ...app0Payload,
      0xff,
      marker,
      (sofPayload.length + 2) >> 8,
      (sofPayload.length + 2) & 0xff,
      ...sofPayload,
    ]);
  }

  /** GIF：固定头 "GIF87a"/"GIF89a" + 逻辑屏幕描述符里的宽高（小端）。 */
  function gif(width: number, height: number, version: '87a' | '89a' = '89a'): Uint8Array {
    const bytes = new Uint8Array(10);
    const signature = `GIF${version}`;
    for (let index = 0; index < 6; index += 1) {
      bytes[index] = signature.charCodeAt(index);
    }
    const view = new DataView(bytes.buffer);
    view.setUint16(6, width, true);
    view.setUint16(8, height, true);
    return bytes;
  }

  /** BMP：BITMAPFILEHEADER（14 字节）+ BITMAPINFOHEADER 的宽高（小端，height 可以是负数表示从上到下存）。 */
  function bmp(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(26);
    bytes.set([0x42, 0x4d], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    return bytes;
  }

  /** WebP 公共头：RIFF + 文件大小占位 + "WEBP"。 */
  function webpHeader(fourCC: string, chunkSize: number): number[] {
    const bytes = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    for (let index = 0; index < 4; index += 1) {
      bytes.push(fourCC.charCodeAt(index));
    }
    bytes.push(chunkSize & 0xff, (chunkSize >> 8) & 0xff, (chunkSize >> 16) & 0xff, (chunkSize >> 24) & 0xff);
    return bytes;
  }

  /** WebP 扩展格式（VP8X）：画布宽高直接存在块里，各占 3 字节、小端、存的是「宽（或高）减一」。 */
  function webpExtended(width: number, height: number): Uint8Array {
    const bytes = webpHeader('VP8X', 10);
    const w = width - 1;
    const h = height - 1;
    bytes.push(0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff);
    return new Uint8Array(bytes);
  }

  /** WebP 有损格式（VP8 ）：帧标签 3 字节 + 启动码 3 字节 + 宽高各 2 字节（小端，低 14 位是尺寸）。 */
  function webpLossy(width: number, height: number): Uint8Array {
    const bytes = webpHeader('VP8 ', 10);
    bytes.push(0x10, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f);
    return new Uint8Array(bytes);
  }

  /** WebP 无损格式（VP8L）：签名字节 0x2f + 4 字节小端压缩值（宽高各占 14 位，都是「减一」）。 */
  function webpLossless(width: number, height: number): Uint8Array {
    const bytes = webpHeader('VP8L', 5);
    const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    bytes.push(0x2f, packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >> 24) & 0xff);
    return new Uint8Array(bytes);
  }

  test('reads a PNG IHDR chunk', () => {
    expect(readImagePixelSize(png(800, 600))).toEqual({ width: 800, height: 600 });
  });

  test('reads a baseline JPEG SOF0 segment, skipping the APP0 segment first', () => {
    expect(readImagePixelSize(jpeg(1920, 1080, 0xc0))).toEqual({ width: 1920, height: 1080 });
  });

  test('reads a progressive JPEG SOF2 segment', () => {
    expect(readImagePixelSize(jpeg(640, 480, 0xc2))).toEqual({ width: 640, height: 480 });
  });

  test('reads GIF87a and GIF89a headers', () => {
    expect(readImagePixelSize(gif(320, 200, '87a'))).toEqual({ width: 320, height: 200 });
    expect(readImagePixelSize(gif(320, 200, '89a'))).toEqual({ width: 320, height: 200 });
  });

  test('reads a BMP info header, taking the absolute value of a top-down (negative) height', () => {
    expect(readImagePixelSize(bmp(400, 300))).toEqual({ width: 400, height: 300 });
    expect(readImagePixelSize(bmp(400, -300))).toEqual({ width: 400, height: 300 });
  });

  test('reads WebP VP8X (extended), VP8 (lossy) and VP8L (lossless) chunks', () => {
    expect(readImagePixelSize(webpExtended(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(readImagePixelSize(webpLossy(1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(readImagePixelSize(webpLossless(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  test('returns null for a file that is none of the above, instead of throwing', () => {
    expect(readImagePixelSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(readImagePixelSize(new Uint8Array(0))).toBeNull();
  });
});
