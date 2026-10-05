import type { BatchProgress } from '../core/batch/batch-runner';
import { type CropMode, PDF_LIMITS } from '../core/pdf/pdf-model';
import type { PaperSize } from './paper-sizes';

const BYTES_PER_MB = 1024 * 1024;

/** 文件太大：主进程（选文件时）和界面（拖进来、读字节之前）说同一句话。 */
export const PDF_TOO_LARGE_ISSUE = `文件超过 ${PDF_LIMITS.fileBytes / BYTES_PER_MB}MB：拆成几个小一点的 PDF 再打`;

/** 一张黑白小图：1 位 BMP 的 base64（界面用 data:image/bmp 显示）和宽高（像素）。 */
export interface BitmapView {
  bmp: string;
  width: number;
  height: number;
}

export interface PdfDocumentView {
  name: string;
  pageCount: number;
  /** 按第一页自动识别的裁切方式。 */
  detected: CropMode;
  /** 第一页里「有内容」的地方（黑白），手动框选时在上面画框。 */
  firstPage: BitmapView;
}

export type PdfOpenResult =
  | { status: 'loaded'; document: PdfDocumentView }
  | { status: 'canceled' }
  | { status: 'invalid'; issue: string };

export interface PdfPieceView {
  /** 页码-第几张，例如 2-1。 */
  id: string;
  page: number;
  piece: number;
  /** 缩略图：就是打出来的黑白点（按整数倍缩小）。 */
  thumbnail: BitmapView;
}

export type PdfLayoutResult =
  | {
      status: 'ok';
      /** 这一次出块的编号：打印时带上，预览变了就对不上。 */
      runId: string;
      paper: PaperSize;
      pieces: PdfPieceView[];
      /** 空白、没出块的页数。 */
      skippedPages: number;
      /** 超过 1000 张，后面的没处理。 */
      truncated: boolean;
    }
  /** 又换了文件或设置：这一次的结果作废，界面等新的那次。 */
  | { status: 'superseded' }
  | { status: 'invalid'; issue: string };

export type PdfPiecePreviewResult =
  | { status: 'ok'; html: string; paper: PaperSize }
  | { status: 'invalid'; issue: string };

/** 推给界面的状态：处理到第几页、打印进度（失败、暂停原因都在 BatchProgress 里）。 */
export interface PdfStatus {
  fileName: string | null;
  processing: { done: number; total: number } | null;
  print: BatchProgress | null;
  /**
   * 还在打、暂停中，或者取消之后正在打的那一张还没结束（和批量打印的 BatchStatus.isActive 一个意思）。
   * state 变成 canceled 的那一刻那一张可能还没打完，这时还不能换文件、再打一次：界面按它判断。
   */
  isActive: boolean;
}

export type PdfPrintStartResult = { status: 'started'; progress: BatchProgress } | { status: 'invalid'; issue: string };
