/**
 * 按二维码的四个角把整张标签摆正截下来（纯函数，bun test 测试）。
 *
 * 二维码由电脑打印，和标签同一个方向：按它的四个角做透视变换，截出来的标签总是正的，
 * 手机横着、斜着拍都一样。截哪块、多清楚由电脑在 welcome 里说（ImageRequest，单位是二维码边长）。
 */
import type { CodeSquare } from '../../../src/core/scan/image-text';
import { type ImageRequest, MAX_IMAGE_SIDE } from '../../../src/shared/mobile-protocol';

export interface Point {
  x: number;
  y: number;
}

/** 二维码的四个角（按二维码自己的方向：左上是第一个定位角所在的那个角），画面像素坐标。 */
export interface CodeCorners {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

/** RGBA 像素（和 ImageData 一样的排列；测试里不需要浏览器）。 */
export interface PixelImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface CropLayout {
  width: number;
  height: number;
  /** 截图里一个二维码边长是多少像素（超过 MAX_IMAGE_SIDE 时按比例缩小过）。 */
  pixelsPerCode: number;
  /** 二维码在截图里的位置。 */
  code: CodeSquare;
}

/** 截图的大小，和二维码在截图里的位置。 */
export function cropLayout(request: ImageRequest): CropLayout {
  const { area } = request;
  const codesWide = area.right - area.left;
  const codesHigh = area.bottom - area.top;
  const scale = Math.min(1, MAX_IMAGE_SIDE / (Math.max(codesWide, codesHigh) * request.pixelsPerCode));
  const pixelsPerCode = request.pixelsPerCode * scale;
  return {
    width: Math.max(1, Math.round(codesWide * pixelsPerCode)),
    height: Math.max(1, Math.round(codesHigh * pixelsPerCode)),
    pixelsPerCode,
    code: { x: -area.left * pixelsPerCode, y: -area.top * pixelsPerCode, size: pixelsPerCode },
  };
}

/**
 * 单位正方形 (0,0)(1,0)(1,1)(0,1) 到四边形（二维码四个角）的透视变换（Heckbert 的闭式解）。
 * 返回的函数把「二维码边长为单位的坐标」换成画面像素坐标；四个角共线等退化情况返回 null。
 */
export function squareToQuad(corners: CodeCorners): ((u: number, v: number) => Point) | null {
  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = corners;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < Number.EPSILON) {
    return null;
  }
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/** 画面外面填白：标签纸是白的，白边不会被读成字。 */
const OUTSIDE = 255;
const CHANNELS = 4;

/**
 * 截出摆正的整张标签（RGBA）。每个目标像素按中心点反算到画面里，双线性取样；画面外的部分填白，
 * 标签没拍全时拍到的部分照样能识别。四个角退化（算不出变换）时返回 null。
 */
export function cropLabel(source: PixelImage, corners: CodeCorners, request: ImageRequest): PixelImage | null {
  const toFrame = squareToQuad(corners);
  if (toFrame === null) {
    return null;
  }
  const layout = cropLayout(request);
  const { width, height, pixelsPerCode } = layout;
  const out = new Uint8ClampedArray(width * height * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    const v = request.area.top + (y + 0.5) / pixelsPerCode;
    for (let x = 0; x < width; x += 1) {
      const u = request.area.left + (x + 0.5) / pixelsPerCode;
      const at = toFrame(u, v);
      sampleInto(source, at.x - 0.5, at.y - 0.5, out, (y * width + x) * CHANNELS);
    }
  }
  return { data: out, width, height };
}

/** 双线性取样到 out[offset..offset+4]；落在画面外的一律填白。 */
function sampleInto(source: PixelImage, x: number, y: number, out: Uint8ClampedArray, offset: number): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= source.width || y0 + 1 >= source.height) {
    out.fill(OUTSIDE, offset, offset + CHANNELS);
    return;
  }
  const fx = x - x0;
  const fy = y - y0;
  const row = source.width * CHANNELS;
  const i00 = y0 * row + x0 * CHANNELS;
  const i10 = i00 + CHANNELS;
  const i01 = i00 + row;
  const i11 = i01 + CHANNELS;
  const { data } = source;
  for (let channel = 0; channel < 3; channel += 1) {
    const top = (data[i00 + channel] ?? 0) * (1 - fx) + (data[i10 + channel] ?? 0) * fx;
    const bottom = (data[i01 + channel] ?? 0) * (1 - fx) + (data[i11 + channel] ?? 0) * fx;
    out[offset + channel] = top * (1 - fy) + bottom * fy;
  }
  out[offset + 3] = 255;
}
