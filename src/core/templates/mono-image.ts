// src/core/templates/mono-image.ts
import type { ImageMode } from './canvas-model';

/**
 * 图片 → 热敏标签机能打的黑白点：只有黑和白，没有灰。全部是纯 TypeScript（不解码图片文件，见 canvas-model 的 CanvasImage），
 * 主进程和测试都能直接用。
 */

export interface GrayImage {
  width: number;
  height: number;
  /** 8 位灰度，逐行，0 黑 – 255 白。 */
  pixels: Uint8Array;
}

/** base64 的灰度像素 → 图像；字节数和宽高对不上（被改坏的模板）返回 null。 */
export function decodeGray(base64: string, width: number, height: number): GrayImage | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length !== width * height) {
    return null;
  }
  const pixels = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pixels[index] = binary.charCodeAt(index);
  }
  return { width, height, pixels };
}

/** 等比放进框里（整数像素，至少 1）。 */
export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.min(boxWidth, Math.round(sourceWidth * scale))),
    height: Math.max(1, Math.min(boxHeight, Math.round(sourceHeight * scale))),
  };
}

/** 缩放：每个目标点取它覆盖的源像素的平均值（缩小时不丢细节、不出摩尔纹），放大时就是最近邻。 */
export function resizeGray(image: GrayImage, width: number, height: number): GrayImage {
  const pixels = new Uint8Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor(y * scaleY);
    const bottom = Math.max(top + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor(x * scaleX);
      const right = Math.max(left + 1, Math.floor((x + 1) * scaleX));
      let sum = 0;
      for (let sy = top; sy < bottom; sy += 1) {
        for (let sx = left; sx < right; sx += 1) {
          sum += image.pixels[sy * image.width + sx] ?? 255;
        }
      }
      pixels[y * width + x] = Math.round(sum / ((bottom - top) * (right - left)));
    }
  }
  return { width, height, pixels };
}

/** Floyd–Steinberg 误差扩散的权重（右、左下、下、右下，分母 16）。 */
const DITHER_WEIGHTS = [
  { dx: 1, dy: 0, weight: 7 },
  { dx: -1, dy: 1, weight: 3 },
  { dx: 0, dy: 1, weight: 5 },
  { dx: 1, dy: 1, weight: 1 },
] as const;
const DITHER_DIVISOR = 16;
const WHITE = 255;

/** 转黑白：1 = 黑点、0 = 白。阈值：比 threshold 暗的为黑；抖动：同一阈值，误差分给邻居，灰度变成点的疏密。 */
export function toMono(image: GrayImage, mode: ImageMode, threshold: number): Uint8Array {
  const { width, height } = image;
  const mono = new Uint8Array(width * height);
  if (mode === 'threshold') {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] = (image.pixels[index] ?? WHITE) < threshold ? 1 : 0;
    }
    return mono;
  }
  const values = Float32Array.from(image.pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const old = values[index] ?? WHITE;
      const isBlack = old < threshold;
      mono[index] = isBlack ? 1 : 0;
      const error = old - (isBlack ? 0 : WHITE);
      for (const { dx, dy, weight } of DITHER_WEIGHTS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) {
          const target = ny * width + nx;
          values[target] = (values[target] ?? WHITE) + (error * weight) / DITHER_DIVISOR;
        }
      }
    }
  }
  return mono;
}

/** 黑点 → SVG 路径：每行连续的黑点合成一个矩形（和二维码的画法一样），坐标单位是点。 */
export function monoPath(mono: Uint8Array, width: number, height: number): string {
  let path = '';
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (mono[y * width + x] !== 1) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && mono[y * width + x] === 1) {
        x += 1;
      }
      path += `M${start} ${y}h${x - start}v1H${start}z`;
    }
  }
  return path;
}
