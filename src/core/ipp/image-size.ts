/**
 * 从 PNG、JPEG 的文件头读出图片大小，不解码。局域网共享收到的图片在主进程里先看一眼大小：
 * 几 KB 的文件能声明几十亿像素，交给渲染页解码前就要拒绝。
 */

export const IMAGE_LIMITS = {
  /** 一边最多 14400 像素：和渲染页的上限（MAX_PAGE_POINTS，按 72dpi 原图大小渲染）一样。 */
  side: 14_400,
  /** 最多 5000 万像素：手机 4800 万像素的照片放得下；解成 RGBA 约 200MB，在隔离的渲染页里还能承受。 */
  pixels: 50_000_000,
} as const;

export type SniffedImageType = 'image/png' | 'image/jpeg';

export interface ImageSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** PNG 的第一个块必须是 IHDR：签名 8 字节 + 长度 4 字节 + 类型 4 字节之后是宽、高。 */
const PNG_IHDR_TYPE_OFFSET = 12;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_IHDR = 'IHDR';

const JPEG_MARKER = 0xff;
const JPEG_SOI = 0xd8;
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
/** 没有长度字段的标记：TEM、RST0–7。 */
const JPEG_TEM = 0x01;
const JPEG_RST_FIRST = 0xd0;
const JPEG_RST_LAST = 0xd7;
/** SOF0–SOF15 是帧头（C4 DHT、C8 JPG、CC DAC 除外）。 */
const JPEG_SOF_FIRST = 0xc0;
const JPEG_SOF_LAST = 0xcf;
const JPEG_NOT_SOF: ReadonlySet<number> = new Set([0xc4, 0xc8, 0xcc]);
/** 帧头里：段长 2 字节、精度 1 字节，然后是高、宽（各 2 字节）。 */
const SOF_HEIGHT_OFFSET = 3;
const SOF_WIDTH_OFFSET = 5;
const SOF_MIN_LENGTH = 7;

/** 读出图片大小；文件头不全、不合规或某一边为 0 时返回 null。 */
export function imageSize(data: Uint8Array, type: SniffedImageType): ImageSize | null {
  const size = type === 'image/png' ? pngSize(data) : jpegSize(data);
  return size !== null && size.width > 0 && size.height > 0 ? size : null;
}

/** 解码出来会不会太大（任一边或像素数超过上限）。 */
export function isImageTooLarge(size: ImageSize): boolean {
  return (
    size.width > IMAGE_LIMITS.side || size.height > IMAGE_LIMITS.side || size.width * size.height > IMAGE_LIMITS.pixels
  );
}

function pngSize(data: Uint8Array): ImageSize | null {
  if (data.length < PNG_HEIGHT_OFFSET + 4 || PNG_SIGNATURE.some((byte, index) => data[index] !== byte)) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunkType = String.fromCharCode(...data.subarray(PNG_IHDR_TYPE_OFFSET, PNG_IHDR_TYPE_OFFSET + 4));
  if (chunkType !== PNG_IHDR) {
    return null;
  }
  return { width: view.getUint32(PNG_WIDTH_OFFSET), height: view.getUint32(PNG_HEIGHT_OFFSET) };
}

/** 按段往下找第一个帧头；到了图像数据（SOS）或文件尾还没找到就算读不出。 */
function jpegSize(data: Uint8Array): ImageSize | null {
  if (data[0] !== JPEG_MARKER || data[1] !== JPEG_SOI) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 2;
  while (at + 1 < data.length) {
    if (data[at] !== JPEG_MARKER) {
      return null;
    }
    const marker = data[at + 1] ?? 0;
    if (marker === JPEG_MARKER) {
      at += 1; // 标记前可以有任意多个填充的 0xFF
      continue;
    }
    at += 2;
    if (marker === JPEG_TEM || (marker >= JPEG_RST_FIRST && marker <= JPEG_RST_LAST)) {
      continue;
    }
    if (marker === JPEG_SOS || marker === JPEG_EOI || at + 2 > data.length) {
      return null;
    }
    const length = view.getUint16(at);
    if (marker >= JPEG_SOF_FIRST && marker <= JPEG_SOF_LAST && !JPEG_NOT_SOF.has(marker)) {
      if (length < SOF_MIN_LENGTH || at + SOF_MIN_LENGTH > data.length) {
        return null;
      }
      return { width: view.getUint16(at + SOF_WIDTH_OFFSET), height: view.getUint16(at + SOF_HEIGHT_OFFSET) };
    }
    if (length < 2) {
      return null;
    }
    at += length;
  }
  return null;
}
