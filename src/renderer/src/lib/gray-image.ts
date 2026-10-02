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
 * 解码前只看文件头要读的字节数：JPEG 的 SOF 段前面可能有一整段 Exif（相机写进去的缩略图，
 * 单个 APPn 段最多能有 64KB），留出几倍余量，宁可多读一点也不要把 SOF 段漏在窗口外面误判成「认不出」。
 */
export const IMAGE_HEADER_PEEK_BYTES = 512 * 1024;

/**
 * 解码前的原始像素上限：1 亿像素，解码成 RGBA 要占约 400MB 内存，普通电脑能扛住；
 * 手机摄像头拍出来的照片很少超过这个数（目前主流手机最高约 1 亿像素），超过的大概率是
 * 误选了超大图或扫描件，应该先在别处压缩再导入，不能让页面去解码一张几 GB 的位图。
 */
export const MAX_IMAGE_SOURCE_PIXELS = 100_000_000;

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

/**
 * 从文件头读像素尺寸，而不真正解码整张图：PNG 的 IHDR 块、JPEG 的 SOFn 段、GIF 的逻辑屏幕描述符、
 * BMP 的位图信息头、WebP 的 VP8X / VP8（有损）/ VP8L（无损）块。认不出格式、或者给的字节不够长读不到
 * 这些字段时返回 null——调用方把 null 当作「这不是能认出的图片」直接拒绝，不往下走真正的解码
 * （巨大的图片一旦真解码会占用大量内存，必须在那之前就能判断）。
 */
export function readImagePixelSize(bytes: Uint8Array): PixelSize | null {
  return readPngSize(bytes) ?? readJpegSize(bytes) ?? readGifSize(bytes) ?? readBmpSize(bytes) ?? readWebpSize(bytes);
}

function startsWith(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  return readUint32LE(bytes, offset) | 0;
}

/** PNG 签名：固定 8 字节。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPngSize(bytes: Uint8Array): PixelSize | null {
  // 签名(8) + 长度(4) + "IHDR"(4) + 宽(4) + 高(4) = 24 字节；再往后的位深、CRC 这些不需要。
  if (bytes.length < 24 || !startsWith(bytes, 0, PNG_SIGNATURE)) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** SOFn 标记：真正表示「帧开始、宽高紧跟在后面」的那一组。0xC4（DHT）、0xC8（JPG，保留未用）、
 * 0xCC（DAC）虽然编号落在 0xC0–0xCF 区间里，但不是帧开始标记，不能当 SOF 处理。 */
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** 没有长度字段、读完标记本身就直接找下一个标记的几种：填充字节 0xFF01、复位标记和 SOI/EOI（0xFFD0–0xFFD9）。 */
function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function readJpegSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  // 从 SOI 之后逐个段落跳过去找 SOFn：每段是「标记(2) + 长度(2，含长度字段自己) + payload」，
  // 不认识的段（Exif、量化表……）按长度跳过，SOFn 段的宽高紧跟在长度字段后面的第 2、4 字节。
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (isStandaloneJpegMarker(marker)) {
      offset += 2;
      continue;
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) {
        return null;
      }
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) {
      return null;
    }
    offset += 2 + length;
  }
  // 在读到的这段里一直没碰到 SOFn（极少见：前面塞了超大的 Exif 缩略图）：报告「认不出」，
  // 让调用方按「不是能识别的图片」处理，而不是莫名其妙地继续尝试解码。
  return null;
}

function readGifSize(bytes: Uint8Array): PixelSize | null {
  const isGif87 = startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
  const isGif89 = startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  if (bytes.length < 10 || (!isGif87 && !isGif89)) {
    return null;
  }
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readBmpSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null;
  }
  const width = readInt32LE(bytes, 18);
  // BITMAPINFOHEADER 的 height 可以是负数：表示像素数据从上到下存（正常是从下到上），和尺寸无关。
  const height = readInt32LE(bytes, 22);
  return width > 0 && height !== 0 ? { width, height: Math.abs(height) } : null;
}

function readWebpSize(bytes: Uint8Array): PixelSize | null {
  if (
    bytes.length < 20 ||
    !startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return null;
  }
  const fourCC = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  // VP8X（扩展格式）：画布宽高直接存在块里，不用管实际编码方式。
  if (fourCC === 'VP8X') {
    if (bytes.length < 30) {
      return null;
    }
    return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
  }
  // VP8（有损）：跳过帧标签（3 字节）和启动码（固定 3 字节 9D 01 2A），宽高各占 2 字节、低 14 位是尺寸。
  if (fourCC === 'VP8 ') {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // VP8L（无损）：签名字节 0x2F 之后是 4 字节小端压缩值，宽高各占 14 位，存的都是「尺寸减一」。
  if (fourCC === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) {
      return null;
    }
    const packed = readUint32LE(bytes, 21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  return null;
}
