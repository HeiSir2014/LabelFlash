/**
 * 设计器插入图片的纯计算部分：RGBA → 8 位灰度、存进模板的像素尺寸、base64。
 * 解码图片文件在 view-models/use-image-import.ts（页面里，sandbox）；主进程只拿到灰度像素，不解码图片文件。
 */
import { CANVAS_LIMITS, type CanvasElement } from '../../../core/templates/canvas-model';

/** Rec. 601 亮度权重：打印机驱动和大多数图片软件转灰度用的就是它。 */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
/** 8 位灰度里的白（也是 alpha 的最大值）。 */
const WHITE = 255;
const RGBA_CHANNELS = 4;
/** 一次交给 String.fromCharCode 的字节数：参数太多会爆栈（一张 1MB 的图有一百多万个字节）。 */
const BASE64_CHUNK_BYTES = 0x8000;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/** 选图时文件最大 20MB：手机照片一般 3–8MB；再大的文件解码要占几百 MB 内存，界面会卡住。 */
export const MAX_IMAGE_FILE_BYTES = 20 * BYTES_PER_MEGABYTE;

/**
 * RGBA（逐行）→ 8 位灰度（0 黑 – 255 白）。透明的地方当作白纸：透明底的 Logo 不能印成一块黑。
 * 字节数比 width×height 允诺的少（数据和尺寸对不上）时抛出说明性的错误，不要默默当成全白——
 * 调用方传错尺寸是编程错误，应该在这里炸出来，不是悄悄解码出一张看起来合法但内容是假的图。
 */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const required = width * height * RGBA_CHANNELS;
  if (rgba.length < required) {
    throw new Error(
      `rgbaToGray: expected at least ${required} bytes for a ${width}×${height} image, got ${rgba.length}`,
    );
  }
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * RGBA_CHANNELS;
    const luma =
      LUMA_RED * (rgba[offset] ?? WHITE) +
      LUMA_GREEN * (rgba[offset + 1] ?? WHITE) +
      LUMA_BLUE * (rgba[offset + 2] ?? WHITE);
    const alpha = (rgba[offset + 3] ?? WHITE) / WHITE;
    gray[index] = Math.round(luma * alpha + WHITE * (1 - alpha));
  }
  return gray;
}

/** 像素尺寸（宽高，单位像素）。 */
export interface PixelSize {
  width: number;
  height: number;
}

/** 存进模板的像素尺寸：等比缩小到不超过 maxPixels 个像素、每边不超过 maxSide；本来就够小的不放大。 */
export function fitPixelBudget(width: number, height: number, maxPixels: number, maxSide: number): PixelSize {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxSide / width, maxSide / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** 字节 → base64（分段拼，避免爆栈）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** 模板里的图片一共占多少字节（灰度像素，一个像素一个字节）；exceptId 那张不算（换图时算换掉以后的）。 */
export function imageBytesUsed(elements: readonly CanvasElement[], exceptId: string | null): number {
  return elements.reduce(
    (total, element) =>
      element.kind === 'image' && element.id !== exceptId ? total + element.pixelWidth * element.pixelHeight : total,
    0,
  );
}

/** 再放一张 bytes 字节的图，整个模板的图片还在上限以内吗（超了 sanitize-canvas 会把它丢掉，所以插入前就拦住）。 */
export function fitsTemplateBudget(
  elements: readonly CanvasElement[],
  exceptId: string | null,
  bytes: number,
): boolean {
  return imageBytesUsed(elements, exceptId) + bytes <= CANVAS_LIMITS.templateImageBytes;
}

/** 提示里说的上限：字节换成 MB。 */
export function megabytes(bytes: number): number {
  return bytes / BYTES_PER_MEGABYTE;
}
