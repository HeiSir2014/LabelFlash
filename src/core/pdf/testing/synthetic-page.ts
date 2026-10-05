import type { GrayImage } from '../../templates/mono-image';
import type { PixelRect } from '../pdf-model';

/**
 * 测试用的合成页面：白纸上画黑块、框、虚线，模拟渲染出来的 PDF 页（只有 0 和 255 两种灰度）。
 * 尺寸按「一个像素约 0.5mm」想：400×560 大致是 48dpi 的 A4。
 */

const WHITE = 255;
const BLACK = 0;

export function blankPage(width: number, height: number): GrayImage {
  return { width, height, pixels: new Uint8Array(width * height).fill(WHITE) };
}

/** 涂黑一块（模拟文字、条码这类内容）；超出页面的部分不画。 */
export function fill(page: GrayImage, rect: PixelRect): GrayImage {
  const left = Math.max(0, rect.x);
  const right = Math.min(page.width, rect.x + rect.width);
  for (let y = Math.max(0, rect.y); y < Math.min(page.height, rect.y + rect.height); y += 1) {
    page.pixels.fill(BLACK, y * page.width + left, y * page.width + right);
  }
  return page;
}

/** 空心框（模拟面单的外框），边粗 border。 */
export function frame(page: GrayImage, rect: PixelRect, border: number): GrayImage {
  fill(page, { ...rect, height: border });
  fill(page, { ...rect, y: rect.y + rect.height - border, height: border });
  fill(page, { ...rect, width: border });
  fill(page, { ...rect, x: rect.x + rect.width - border, width: border });
  return page;
}

/** 横贯整页的虚线：每段 dash 个像素、间隔 gap 个像素。 */
export function dashedRow(page: GrayImage, y: number, thickness: number, dash: number, gap: number): GrayImage {
  for (let x = 0; x < page.width; x += dash + gap) {
    fill(page, { x, y, width: dash, height: thickness });
  }
  return page;
}

/** 竖贯整页的虚线。 */
export function dashedColumn(page: GrayImage, x: number, thickness: number, dash: number, gap: number): GrayImage {
  for (let y = 0; y < page.height; y += dash + gap) {
    fill(page, { x, y, width: thickness, height: dash });
  }
  return page;
}

/** 一张有外框的「面单」：边粗 2 的外框、三行字、底部一个条码；内容外框就是 rect。 */
export function framedLabel(page: GrayImage, rect: PixelRect): GrayImage {
  frame(page, rect, 2);
  for (let line = 0; line < 3; line += 1) {
    fill(page, { x: rect.x + 10, y: rect.y + 10 + line * 20, width: Math.floor(rect.width / 2), height: 8 });
  }
  fill(page, { x: rect.x + 10, y: rect.y + rect.height - 60, width: rect.width - 20, height: 40 });
  return page;
}

/** 一张没有外框的「面单」（185×266）：一行满宽的字、两行短字、底部一个满宽的条码。用来测紧挨着、只靠分割线分开的排法。 */
export function denseLabel(page: GrayImage, x: number, y: number): GrayImage {
  fill(page, { x, y, width: 185, height: 8 });
  fill(page, { x, y: y + 40, width: 120, height: 8 });
  fill(page, { x, y: y + 60, width: 90, height: 8 });
  fill(page, { x, y: y + 200, width: 185, height: 66 });
  return page;
}

/** gridPage 上四张面单的位置：2×2，之间留 20 像素空白（约 10mm）。 */
export const GRID_LABELS: readonly PixelRect[] = [
  { x: 20, y: 20, width: 170, height: 250 },
  { x: 210, y: 20, width: 170, height: 250 },
  { x: 20, y: 290, width: 170, height: 250 },
  { x: 210, y: 290, width: 170, height: 250 },
];

/** 400×560 的「A4」上 2×2 四张有框的面单（A4 四联面单的样子）。 */
export function gridPage(): GrayImage {
  const page = blankPage(400, 560);
  for (const rect of GRID_LABELS) {
    framedLabel(page, rect);
  }
  return page;
}
