/**
 * 主进程和隐藏的 PDF 渲染页之间的消息（main/pdf/pdf-render-host.ts ↔ renderer/src/pdf-render/main.ts）。
 * 渲染页里跑着 pdf.js（第三方库）和不可信的 PDF，它发回的每条消息主进程都用 readRenderReply 重新核对。
 * 这个文件主进程和渲染页都用：不碰 DOM、Node、Electron。
 */

import { RASTER_LIMITS, type RasterJobLimits } from '../core/ipp/raster';

export const PDF_RENDER_CHANNELS = { request: 'pdf-render:request', reply: 'pdf-render:reply' } as const;

/** PDF 的长度单位是点：1/72 英寸。 */
export const POINTS_PER_INCH = 72;
/** 一页最大 14400 点（200 英寸）：PDF 规范里页面尺寸的上限。 */
export const MAX_PAGE_POINTS = 14_400;
/** Chromium 画布的边长上限（像素）。 */
const MAX_CANVAS_SIDE = 32_767;
/** 出错说明最多 500 个字：只写日志，更长的截掉。 */
const MAX_DETAIL_LENGTH = 500;
/** RGBA 每个像素 4 个字节。 */
const RGBA_BYTES = 4;
const WHITE = 255;
/** ITU-R BT.601 的亮度权重（千分之几）：人眼对绿最敏感、对蓝最不敏感。 */
const LUMA_WEIGHTS = { red: 299, green: 587, blue: 114, total: 1000 } as const;

/** 一页的大小（点），已经按页面自带的旋转转好。 */
export interface PageSize {
  width: number;
  height: number;
}

/** 渲染页还能解码的图片（局域网共享收到的 JPEG / PNG 也只在这个 sandbox 页里解码）。 */
export const RENDER_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type RenderImageType = (typeof RENDER_IMAGE_TYPES)[number];

/** 渲染页还能解码的光栅（局域网共享收到的；行程编码解出来的像素数不可控，不在主进程里解）。 */
export const RENDER_RASTER_TYPES = ['image/pwg-raster', 'image/urf'] as const;
export type RenderRasterType = (typeof RENDER_RASTER_TYPES)[number];

/** 光栅的一页：像素大小和它自带的分辨率。 */
export interface RasterPageInfo {
  width: number;
  height: number;
  dpi: number;
}

export type RenderRequest =
  | { id: number; kind: 'open'; data: Uint8Array }
  /** 一张图片当作只有一页的文档：页面大小 = 图片的像素，按 72dpi 渲染就是原图大小。 */
  | { id: number; kind: 'open-image'; data: Uint8Array; type: RenderImageType }
  /** page 从 1 数；scale = 每点多少像素。 */
  | { id: number; kind: 'render'; page: number; scale: number }
  /** 光栅：渲染页按这些限制解一遍，回每页的大小（limits 由主进程按纸和打印机算）。 */
  | { id: number; kind: 'open-raster'; data: Uint8Array; type: RenderRasterType; limits: RasterJobLimits }
  /** 光栅的第几页（从 1 数），原样大小的灰度。 */
  | { id: number; kind: 'render-raster'; page: number };

/** password = 要密码；invalid = 不是 PDF 或文件坏了；failed = 其他错误。 */
export const RENDER_ERRORS = ['password', 'invalid', 'failed'] as const;
export type RenderError = (typeof RENDER_ERRORS)[number];

export type RenderReply =
  /** 页数超过主进程给的上限时 pages 为空（不逐页读几千页）。 */
  | { id: number; kind: 'opened'; pageCount: number; pages: PageSize[] }
  /** 8 位灰度，逐行，0 黑 – 255 白。 */
  | { id: number; kind: 'rendered'; width: number; height: number; gray: Uint8Array }
  | { id: number; kind: 'raster-opened'; pages: RasterPageInfo[] }
  | { id: number; kind: 'error'; error: RenderError; detail: string };

/** 渲染页能用的全部能力：preload 用 contextBridge 暴露成 window.pdfHost。 */
export interface PdfHostApi {
  onRequest(listener: (request: RenderRequest) => void): void;
  reply(reply: RenderReply): void;
}

/** 主进程在等的回复：编号、种类，以及它自己算好的位图宽高。 */
export type ExpectedReply =
  | { id: number; kind: 'opened'; maxPages: number }
  | { id: number; kind: 'raster-opened'; maxPages: number }
  | { id: number; kind: 'rendered'; width: number; height: number };

/** 按 dpi 渲染这一页用的缩放（每点多少像素）；像素数或边长超过上限时等比降低（海报这类特大的页）。 */
export function renderScale(page: PageSize, dpi: number, maxPixels: number): number {
  let scale = dpi / POINTS_PER_INCH;
  const pixels = page.width * page.height * scale * scale;
  if (pixels > maxPixels) {
    scale *= Math.sqrt(maxPixels / pixels);
  }
  const side = Math.max(page.width, page.height) * scale;
  if (side > MAX_CANVAS_SIDE) {
    scale *= MAX_CANVAS_SIDE / side;
  }
  return scale;
}

/** 渲染出来的位图大小：渲染页和主进程都用这一个算式，主进程据此核对回来的位图。 */
export function renderedSize(page: PageSize, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(page.width * scale)),
    height: Math.max(1, Math.floor(page.height * scale)),
  };
}

/** RGBA → 8 位灰度（ITU-R BT.601：0.299R + 0.587G + 0.114B）；透明的地方按白纸算。 */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, gray: Uint8Array): void {
  for (let index = 0; index < gray.length; index += 1) {
    const at = index * RGBA_BYTES;
    const luma =
      ((rgba[at] ?? WHITE) * LUMA_WEIGHTS.red +
        (rgba[at + 1] ?? WHITE) * LUMA_WEIGHTS.green +
        (rgba[at + 2] ?? WHITE) * LUMA_WEIGHTS.blue) /
      LUMA_WEIGHTS.total;
    const alpha = rgba[at + 3] ?? WHITE;
    gray[index] = Math.round(WHITE - ((WHITE - luma) * alpha) / WHITE);
  }
}

/** 渲染页的回复 → 核对过的回复；编号、种类、大小任何一项对不上都返回 null。 */
export function readRenderReply(message: unknown, expected: ExpectedReply): RenderReply | null {
  if (typeof message !== 'object' || message === null) {
    return null;
  }
  const reply = message as Record<string, unknown>;
  if (reply['id'] !== expected.id) {
    return null;
  }
  if (reply['kind'] === 'error') {
    return readError(expected.id, reply);
  }
  switch (expected.kind) {
    case 'opened':
      return readOpened(reply, expected);
    case 'raster-opened':
      return readRasterOpened(reply, expected);
    case 'rendered':
      return readRendered(reply, expected);
  }
}

function isWholeIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** 光栅每页：边长 1–8192 点、像素数不超过一页的上限、分辨率在光栅解码认的范围里。 */
function readRasterPage(value: unknown): RasterPageInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { width, height, dpi } = value as Record<string, unknown>;
  if (
    !isWholeIn(width, 1, RASTER_LIMITS.side) ||
    !isWholeIn(height, 1, RASTER_LIMITS.side) ||
    !isWholeIn(dpi, RASTER_LIMITS.minDpi, RASTER_LIMITS.maxDpi) ||
    width * height > RASTER_LIMITS.pagePixels
  ) {
    return null;
  }
  return { width, height, dpi };
}

function readRasterOpened(
  reply: Record<string, unknown>,
  expected: Extract<ExpectedReply, { kind: 'raster-opened' }>,
): RenderReply | null {
  const pages = reply['pages'];
  if (
    reply['kind'] !== 'raster-opened' ||
    !Array.isArray(pages) ||
    pages.length < 1 ||
    pages.length > expected.maxPages
  ) {
    return null;
  }
  const infos: RasterPageInfo[] = [];
  for (const page of pages) {
    const info = readRasterPage(page);
    if (info === null) {
      return null;
    }
    infos.push(info);
  }
  return { id: expected.id, kind: 'raster-opened', pages: infos };
}

function readError(id: number, reply: Record<string, unknown>): RenderReply | null {
  const error = reply['error'];
  const detail = reply['detail'];
  if (!(RENDER_ERRORS as readonly unknown[]).includes(error) || typeof detail !== 'string') {
    return null;
  }
  return { id, kind: 'error', error: error as RenderError, detail: detail.slice(0, MAX_DETAIL_LENGTH) };
}

function isPageSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PAGE_POINTS;
}

function readPageSize(value: unknown): PageSize | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { width, height } = value as { width?: unknown; height?: unknown };
  return isPageSide(width) && isPageSide(height) ? { width, height } : null;
}

function readOpened(
  reply: Record<string, unknown>,
  expected: Extract<ExpectedReply, { kind: 'opened' }>,
): RenderReply | null {
  const pageCount = reply['pageCount'];
  const pages = reply['pages'];
  if (
    reply['kind'] !== 'opened' ||
    typeof pageCount !== 'number' ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 0 ||
    !Array.isArray(pages) ||
    pages.length !== (pageCount <= expected.maxPages ? pageCount : 0)
  ) {
    return null;
  }
  const sizes: PageSize[] = [];
  for (const page of pages) {
    const size = readPageSize(page);
    if (size === null) {
      return null;
    }
    sizes.push(size);
  }
  return { id: expected.id, kind: 'opened', pageCount, pages: sizes };
}

function readRendered(
  reply: Record<string, unknown>,
  expected: Extract<ExpectedReply, { kind: 'rendered' }>,
): RenderReply | null {
  const gray = reply['gray'];
  if (
    reply['kind'] !== 'rendered' ||
    reply['width'] !== expected.width ||
    reply['height'] !== expected.height ||
    !(gray instanceof Uint8Array) ||
    gray.length !== expected.width * expected.height
  ) {
    return null;
  }
  return { id: expected.id, kind: 'rendered', width: expected.width, height: expected.height, gray };
}
