import type { GrayImage } from '../templates/mono-image';
import type { PixelRect } from './pdf-model';

/** 比这个暗的算「有内容」：抗锯齿的浅灰边、浅底纹不算，免得白边去不掉；黑字、线、条码都远比它暗。 */
export const INK_THRESHOLD = 200;
/** 一行（一列）至少这么多个有墨的点才算有内容：扫描件上孤立的灰尘点不能把外框撑到页边。 */
const MIN_INK_PER_LINE = 2;

/** 有墨的点：1 = 有内容、0 = 白纸。 */
export interface InkMask {
  width: number;
  height: number;
  ink: Uint8Array;
}

export function inkMask(image: GrayImage, threshold: number = INK_THRESHOLD): InkMask {
  const ink = new Uint8Array(image.pixels.length);
  image.pixels.forEach((value, index) => {
    ink[index] = value < threshold ? 1 : 0;
  });
  return { width: image.width, height: image.height, ink };
}

/** 整个位图。 */
export function fullRect(size: { width: number; height: number }): PixelRect {
  return { x: 0, y: 0, width: size.width, height: size.height };
}

/** rect 里每一行有墨的点数（下标从 rect.y 起算）。 */
export function rowProfile(mask: InkMask, rect: PixelRect): Uint32Array {
  const profile = new Uint32Array(rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * mask.width + rect.x;
    let count = 0;
    for (const value of mask.ink.subarray(start, start + rect.width)) {
      count += value;
    }
    profile[row] = count;
  }
  return profile;
}

/** rect 里每一列有墨的点数（下标从 rect.x 起算）。 */
export function columnProfile(mask: InkMask, rect: PixelRect): Uint32Array {
  const profile = new Uint32Array(rect.width);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * mask.width + rect.x;
    mask.ink.subarray(start, start + rect.width).forEach((value, column) => {
      profile[column] = (profile[column] ?? 0) + value;
    });
  }
  return profile;
}

/**
 * rect 里内容的外框；整块都是白的返回 null。
 * 列只在已经找到的上下边之间统计：一个灰尘点自己所在的行先被 MIN_INK_PER_LINE 排除，它的列也就不再算。
 */
export function contentBox(mask: InkMask, rect: PixelRect): PixelRect | null {
  const hasInk = (count: number) => count >= MIN_INK_PER_LINE;
  const rows = rowProfile(mask, rect);
  const top = rows.findIndex(hasInk);
  if (top === -1) {
    return null;
  }
  const bottom = rows.findLastIndex(hasInk);
  const columns = columnProfile(mask, { x: rect.x, y: rect.y + top, width: rect.width, height: bottom - top + 1 });
  const left = columns.findIndex(hasInk);
  if (left === -1) {
    return null;
  }
  const right = columns.findLastIndex(hasInk);
  return { x: rect.x + left, y: rect.y + top, width: right - left + 1, height: bottom - top + 1 };
}
