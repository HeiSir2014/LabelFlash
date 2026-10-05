import type { GrayImage } from '../templates/mono-image';

/** 黑白位图：每个点一个字节，1 = 黑、0 = 白（和 mono-image.ts 的 toMono 输出一致）。 */
export interface MonoBitmap {
  width: number;
  height: number;
  bits: Uint8Array;
}

/** 缓存文件开头的标记 'LFM1'：认出是本程序写的黑白位图，版本变了换数字。 */
const MAGIC = [0x4c, 0x46, 0x4d, 0x31] as const;
/** 标记 4 字节 + 宽、高各 4 字节（小端）。 */
const HEADER_BYTES = 12;
const BITS_PER_BYTE = 8;
const HIGH_BIT = 0x80;
/** 边长上限（点）：纸最大 120×220mm，600dpi 也只有 5197 点；挡住被改坏的文件。 */
export const MAX_MONO_SIDE = 8192;

/** 黑白位图 → 缓存文件的字节：每行按位打包（高位在前），一张 100×150mm、203dpi 的面单约 120KB。 */
export function packMono({ width, height, bits }: MonoBitmap): Uint8Array {
  const rowBytes = Math.ceil(width / BITS_PER_BYTE);
  const bytes = new Uint8Array(HEADER_BYTES + rowBytes * height);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, width, true);
  view.setUint32(8, height, true);
  bits.forEach((bit, index) => {
    if (bit === 1) {
      const x = index % width;
      const y = Math.floor(index / width);
      const at = HEADER_BYTES + y * rowBytes + Math.floor(x / BITS_PER_BYTE);
      bytes[at] = (bytes[at] ?? 0) | (HIGH_BIT >> (x % BITS_PER_BYTE));
    }
  });
  return bytes;
}

/** 缓存文件的字节 → 黑白位图；不是本程序写的、尺寸不合理、长度对不上都返回 null（文件在用户的磁盘上，不全信）。 */
export function unpackMono(bytes: Uint8Array): MonoBitmap | null {
  if (bytes.length < HEADER_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  if (width === 0 || height === 0 || width > MAX_MONO_SIDE || height > MAX_MONO_SIDE) {
    return null;
  }
  const rowBytes = Math.ceil(width / BITS_PER_BYTE);
  if (bytes.length !== HEADER_BYTES + rowBytes * height) {
    return null;
  }
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = bytes.subarray(HEADER_BYTES + y * rowBytes, HEADER_BYTES + (y + 1) * rowBytes);
    for (let x = 0; x < width; x += 1) {
      const byte = row[Math.floor(x / BITS_PER_BYTE)] ?? 0;
      bits[y * width + x] = (byte >> (BITS_PER_BYTE - 1 - (x % BITS_PER_BYTE))) & 1;
    }
  }
  return { width, height, bits };
}

/** 黑白 → 灰度（黑 0、白 255）：交给自由设计的图片元素，按 128 一刀切回来正好是同一批点。 */
export function monoToGray({ width, height, bits }: MonoBitmap): GrayImage {
  return { width, height, pixels: bits.map((bit) => (bit === 1 ? 0 : 255)) };
}
