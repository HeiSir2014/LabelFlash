import type { ImageMode } from '../templates/canvas-model';

/**
 * PDF 打印：导入 PDF，把每页（或每页里的每一块）缩放到标签纸上、转黑白后照常打印。
 * 设计见 docs/superpowers/specs/2026-10-01-feature-parity-design.md 第 6 节。
 */

export const PDF_LIMITS = {
  /** 50MB：平台导出的几百张面单的 PDF 也就几 MB；再大多半是扫描件，逐页渲染太慢。 */
  fileBytes: 50 * 1024 * 1024,
  /** 200 页：一次打一个班次的面单够用；更多拆成几个文件。 */
  pages: 200,
  /**
   * 一页渲染出的像素上限：1600 万（A4 在 400dpi 约 1550 万）。灰度一个像素一字节，一页经 IPC 传回最多 16MB；
   * 更大的页（海报）按比例降低渲染分辨率，不拒绝。
   */
  pagePixels: 16_000_000,
  /** 一次最多 1000 张：200 页 × 每页 4 张是 800，留余量；更多的不处理并说明。 */
  pieces: 1000,
  /** 手动框选最多 12 个框：一页 3×4 的小标签已经很密。 */
  manualBoxes: 12,
  /** 打印记录里文件名最多 100 个字：记录的内容是「文件名 第几页第几张」，太长的截断。 */
  fileNameChars: 100,
  /** 每张最多 99 份。 */
  copies: 99,
} as const;

/**
 * 打印记录里 PDF 这一块用的「模板」编号：不在模板库里，只说明这一张不是按模板排的。
 * 放在这里而不是 piece-template.ts：自由设计的排版要认它（不做安全边距检查），又不该依赖 PDF 的其余部分。
 */
export const PDF_PIECE_TEMPLATE_ID = 'builtin:pdf-piece';

/** 黑白位图在缓存里留 7 天：能从打印记录预览、重打；更久的 PDF 重新打开文件再打。 */
export const PDF_PIECE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 裁切方式：page = 整页缩放到纸上；trim = 去掉四周空白再缩放；split = 按空白或分割线切成几张；
 * manual = 在第一页上画框，每页按同样的位置裁。
 */
export const CROP_MODES = ['page', 'trim', 'split', 'manual'] as const;
export type CropMode = (typeof CROP_MODES)[number];

/** 页面上的一个框，按页面宽高的比例（0–1）记：页面大小不同时按比例套用。 */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 位图上的一个矩形（整数像素，左上角起）。 */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 怎么把 PDF 变成标签：界面交来，经 parsePdfLayout 校验。 */
export interface PdfLayout {
  /** 纸张键（例如 100x150）：按它决定打印机和分辨率。 */
  paperKey: string;
  crop: CropMode;
  /** 手动框选的框；crop 为 manual 时至少一个，其余方式忽略。 */
  boxes: NormalizedBox[];
  mono: ImageMode;
  /** 0–255：比它暗的算黑（抖动时作为基准）。 */
  threshold: number;
}

/** 打印设置：要打的块（按打印顺序，删掉的不在里面）和每张几份。 */
export interface PdfPrintRequest {
  /** 这一次出块的编号：预览变了（改了纸张、裁切）就对不上，拒绝打印旧的。 */
  runId: string;
  pieceIds: string[];
  copies: number;
}

/** 一块的编号：页码-第几张（都从 1 数），例如 2-1。 */
export function pieceId(page: number, piece: number): string {
  return `${page}-${piece}`;
}

/** 页码最多 3 位（200 页）、第几张最多 4 位（1000 张）。 */
export const PIECE_ID_PATTERN = /^[1-9]\d{0,2}-[1-9]\d{0,3}$/;
