import type { PaperSize } from '../../shared/paper-sizes';
import type { ImageMode } from '../templates/canvas-model';
import { fitContain, type GrayImage, resizeGray, toMono } from '../templates/mono-image';
import type { MonoBitmap } from './mono-pack';
import type { PixelRect } from './pdf-model';

const MM_PER_INCH = 25.4;
/** 转过来要能放大 2% 以上才转：差不多大时保持原方向，近似正方形的块不会无缘无故躺下。 */
const TURN_GAIN = 0.02;
/** 缩略图最长边（点）：一千张的缩略图加起来也只有几 MB，界面一次拿得动。 */
export const THUMBNAIL_MAX_SIDE = 240;
const WHITE = 255;

/** 转多少度（顺时针）。 */
export type Turn = 0 | 90;

/**
 * 纸在这台打印机上有多少个点。和 canvas-layout 的 snapRect 用同一个算式（毫米 ÷ 每点毫米数再四舍五入），
 * 自由设计的图片框正好是这么多点，打印时不会再缩放一次。
 */
export function paperDots(paper: PaperSize, dpi: number): { width: number; height: number } {
  const dotMm = MM_PER_INCH / dpi;
  return { width: Math.round(paper.widthMm / dotMm), height: Math.round(paper.heightMm / dotMm) };
}

/** 横竖和纸不一致时转 90°：比较两种放法哪种放得更大。 */
export function chooseTurn(width: number, height: number, boxWidth: number, boxHeight: number): Turn {
  const straight = Math.min(boxWidth / width, boxHeight / height);
  const turned = Math.min(boxWidth / height, boxHeight / width);
  return turned > straight * (1 + TURN_GAIN) ? 90 : 0;
}

export function cropGray(image: GrayImage, rect: PixelRect): GrayImage {
  const pixels = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const start = (rect.y + row) * image.width + rect.x;
    pixels.set(image.pixels.subarray(start, start + rect.width), row * rect.width);
  }
  return { width: rect.width, height: rect.height, pixels };
}

/** 顺时针转 90°：原来的 (x, y) 到 (高 - 1 - y, x)，原来的左边到了上边。 */
export function rotateClockwise(image: GrayImage): GrayImage {
  const { width, height } = image;
  const pixels = new Uint8Array(width * height);
  image.pixels.forEach((value, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    pixels[x * height + (height - 1 - y)] = value;
  });
  return { width: height, height: width, pixels };
}

/** 等比放进纸里、居中，四周补白。 */
export function placeOnPaper(piece: GrayImage, dots: { width: number; height: number }): GrayImage {
  const size = fitContain(piece.width, piece.height, dots.width, dots.height);
  const scaled = resizeGray(piece, size.width, size.height);
  const pixels = new Uint8Array(dots.width * dots.height).fill(WHITE);
  const left = Math.floor((dots.width - size.width) / 2);
  const top = Math.floor((dots.height - size.height) / 2);
  for (let row = 0; row < size.height; row += 1) {
    pixels.set(scaled.pixels.subarray(row * size.width, (row + 1) * size.width), (top + row) * dots.width + left);
  }
  return { width: dots.width, height: dots.height, pixels };
}

export interface PieceOptions {
  /** 纸在目标打印机上的点数（paperDots）。 */
  dots: { width: number; height: number };
  mono: ImageMode;
  threshold: number;
}

/** 页面上的一块 → 纸上的黑白点：裁出来、横竖和纸不一致时转 90°、等比缩放居中、转黑白。 */
export function renderPiece(page: GrayImage, rect: PixelRect, options: PieceOptions): MonoBitmap {
  const cropped = cropGray(page, rect);
  const turn = chooseTurn(cropped.width, cropped.height, options.dots.width, options.dots.height);
  const placed = placeOnPaper(turn === 90 ? rotateClockwise(cropped) : cropped, options.dots);
  return { width: placed.width, height: placed.height, bits: toMono(placed, options.mono, options.threshold) };
}

/**
 * 缩略图：按整数倍缩小，仍然只有黑白（看到的就是打出来的点）。一格里有一个黑点就算黑：
 * 面单上的细线、条码在缩略图里不会消失；抖动的照片会显得暗一些，可以点开看原大。
 */
export function thumbnail(bitmap: MonoBitmap, maxSide: number = THUMBNAIL_MAX_SIDE): MonoBitmap {
  const step = Math.max(1, Math.ceil(Math.max(bitmap.width, bitmap.height) / maxSide));
  const width = Math.ceil(bitmap.width / step);
  const height = Math.ceil(bitmap.height / step);
  const bits = new Uint8Array(width * height);
  bitmap.bits.forEach((bit, index) => {
    if (bit === 1) {
      const x = Math.floor((index % bitmap.width) / step);
      const y = Math.floor(Math.floor(index / bitmap.width) / step);
      bits[y * width + x] = 1;
    }
  });
  return { width, height, bits };
}
