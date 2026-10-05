import { basename } from 'node:path';
import type { BatchLabel } from '../../core/batch/batch-model';
import { type BatchProgress, BatchRun } from '../../core/batch/batch-runner';
import { inkMask } from '../../core/pdf/content-box';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { cropRects, detectCropMode, splitOptionsFor } from '../../core/pdf/page-split';
import { PDF_LIMITS, type PdfLayout, type PdfPrintRequest, pieceId } from '../../core/pdf/pdf-model';
import { paperDots, renderPiece, thumbnail } from '../../core/pdf/piece-fit';
import { pieceContent, pieceFields, pieceTemplate, shortFileName } from '../../core/pdf/piece-template';
import type { FieldsPrint } from '../../core/print-service';
import type { ScanField } from '../../core/scan/scan-result';
import { monoBmp } from '../../core/templates/mono-image';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { PdfRef, PrintResult } from '../../core/types';
import { type PaperSize, parsePaperKey } from '../../shared/paper-sizes';
import {
  type BitmapView,
  PDF_PRINTING_ISSUE,
  PDF_TOO_LARGE_ISSUE,
  type PdfCloseResult,
  type PdfLayoutResult,
  type PdfOpenResult,
  type PdfPiecePreviewResult,
  type PdfPieceView,
  type PdfPrintStartResult,
  type PdfStatus,
} from '../../shared/pdf';
import type { PageSize } from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PdfRenderError, type RenderedPage } from './pdf-render-host';

/** 第一页按 96dpi 渲染来识别裁切方式、当手动框选的底图：4mm 的缝有 15 个像素，够判断；A4 只有 79 万像素，打开很快。 */
const ANALYSIS_DPI = 96;
/** PDF 文件头：规范允许它出现在前 1024 字节里的任何位置（有的导出工具会在前面加几个字节）。 */
const PDF_HEADER = '%PDF-';
const PDF_HEADER_WINDOW_BYTES = 1024;
/** 打印进度最多 0.25 秒推一次：一千张逐张推会让界面一直重画。 */
const STATUS_INTERVAL_MS = 250;

/** 给用户看的原因（渲染页的原因见 PDF_ISSUES）。 */
export const PDF_STATION_ISSUES = {
  notPdf: '这不是 PDF 文件：只能打印 .pdf',
  tooLarge: PDF_TOO_LARGE_ISSUE,
  empty: '这个 PDF 一页也没有',
  noDocument: '先选一个 PDF',
  printing: PDF_PRINTING_ISSUE,
  stale: '预览已经变了：等这次处理完再打印',
  failed: '处理 PDF 时出错：详细原因已写入日志，重新选择文件再试',
} as const;

export function tooManyPagesIssue(pageCount: number): string {
  return `这个 PDF 有 ${pageCount} 页，一次最多 ${PDF_LIMITS.pages} 页：拆成几个文件再打`;
}

/** 渲染 PDF 的那一端（PdfRenderHost）。 */
export interface PdfDocumentRenderer {
  open(data: Uint8Array): Promise<OpenedPdf>;
  render(page: number, size: PageSize, dpi: number): Promise<RenderedPage>;
  close(): void;
}

/** 黑白位图的缓存（PieceCache）。 */
export interface PieceStore {
  save(bitmap: MonoBitmap): Promise<string>;
  load(key: string): Promise<MonoBitmap | null>;
  touch(key: string): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface PdfStationDeps {
  renderer: PdfDocumentRenderer;
  pieces: PieceStore;
  readFile: (path: string) => Promise<Uint8Array>;
  fileSize: (path: string) => Promise<number>;
  /** 这种纸会打到的那台打印机的分辨率（没有打印机时按 203dpi）。 */
  dpiFor: (paper: PaperSize) => Promise<number>;
  /** PrintService.printFields：决定打印机、排队、写记录。 */
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 一块打出来的 HTML（和打印同一份）。 */
  renderHtml: (template: LabelTemplate, content: string, fields: ScanField[], dpi: number) => string;
  createRunId: () => string;
  schedule: (run: () => void, delayMs: number) => () => void;
  onStatus: (status: PdfStatus) => void;
  /** 写了打印记录：界面刷新记录列表。 */
  onJobsChanged: () => void;
  log: (line: string) => void;
}

/** 退出程序时还没交给打印机的一张：记成「退出时未打」的打印记录用（见 pdf-quit.ts）。 */
export interface PdfPendingLabel {
  content: string;
  fields: ScanField[];
  paper: PaperSize;
  pdf: PdfRef;
}

interface OpenDocument {
  name: string;
  pages: PageSize[];
}

interface StoredPiece {
  page: number;
  piece: number;
  /** 缓存里的位图编号。 */
  key: string;
}

/** 处理完的一次出块：打印、预览都按它。 */
interface FinishedRun {
  id: string;
  paper: PaperSize;
  dpi: number;
  pieces: Map<string, StoredPiece>;
}

/** 正在打（或暂停、刚取消）的这一次：BatchRun 管顺序和暂停，chosen 按打印顺序记着每一块。 */
interface PrintJob {
  batch: BatchRun;
  run: FinishedRun;
  fileName: string;
  chosen: readonly StoredPiece[];
  /** run() 真正返回（取消时正在打的那一张也结束了）之后才 resolve。 */
  finished: Promise<void>;
}

/**
 * 主进程的 PDF 打印：一次一个文件。打开 → 按第一页识别裁切方式 → 按界面交来的设置出块（逐页渲染、切、放到纸上、存缓存）
 * → 预览一块 → 按顺序打印。换文件、改设置时还在处理的上一次作废，它存下的块删掉（打过的除外：打印记录指着它们）。
 */
export class PdfStation {
  private document: OpenDocument | null = null;
  private run: FinishedRun | null = null;
  /** 每次换文件、改设置加一：还在处理的上一次看到它变了就停下。 */
  private generation = 0;
  private processing: { done: number; total: number } | null = null;
  /** 最近一次打印：打完、取消后仍留着它的进度给界面看；isActive 为 false 时不再挡着换文件。 */
  private printJob: PrintJob | null = null;
  private progress: BatchProgress | null = null;
  /** 打过（或正在打）的块：打印记录指着它们，换设置、关文件时不删，到期由启动时的清理删。 */
  private readonly printedKeys = new Set<string>();
  private cancelStatusTimer: (() => void) | null = null;

  constructor(private readonly deps: PdfStationDeps) {}

  /** 还没打完的张数（暂停中的也算，取消后还在打的那一张也算）：有的时候不静默更新。 */
  get pendingLabels(): number {
    return this.printJob?.batch.pendingLabels ?? 0;
  }

  /** 打开对话框选的文件：先看大小再读，不把几 GB 的文件读进内存。 */
  async loadPath(path: string): Promise<PdfOpenResult> {
    if (this.isPrinting()) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    if ((await this.deps.fileSize(path)) > PDF_LIMITS.fileBytes) {
      return invalid(PDF_STATION_ISSUES.tooLarge);
    }
    return this.loadBytes(basename(path), await this.deps.readFile(path));
  }

  /** 打开一个 PDF（拖进窗口的文件直接给字节）；关掉上一个。 */
  async loadBytes(name: string, bytes: Uint8Array): Promise<PdfOpenResult> {
    if (this.isPrinting()) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    if (bytes.length > PDF_LIMITS.fileBytes) {
      return invalid(PDF_STATION_ISSUES.tooLarge);
    }
    if (!hasPdfHeader(bytes)) {
      return invalid(PDF_STATION_ISSUES.notPdf);
    }
    this.generation += 1;
    await this.discardRun();
    this.document = null;
    this.printJob = null;
    this.progress = null;
    let opened: OpenedPdf;
    let first: RenderedPage;
    try {
      opened = await this.deps.renderer.open(bytes);
      if (opened.pageCount > PDF_LIMITS.pages) {
        this.deps.renderer.close();
        return invalid(tooManyPagesIssue(opened.pageCount));
      }
      const firstSize = opened.pages[0];
      if (firstSize === undefined) {
        this.deps.renderer.close();
        return invalid(PDF_STATION_ISSUES.empty);
      }
      first = await this.deps.renderer.render(1, firstSize, ANALYSIS_DPI);
    } catch (error) {
      return invalid(this.issueOf(error));
    }
    const mask = inkMask(first.image);
    const document: OpenDocument = { name: shortFileName(name), pages: opened.pages };
    this.document = document;
    this.pushStatus();
    return {
      status: 'loaded',
      document: {
        name: document.name,
        pageCount: opened.pageCount,
        detected: detectCropMode(mask, splitOptionsFor(first.dpi)),
        // 底图就是程序认为「有内容」的地方：和识别、去白边用的是同一个判断。
        firstPage: bitmapView({ width: mask.width, height: mask.height, bits: mask.ink }),
      },
    };
  }

  /** 按设置出块：逐页按目标打印机的分辨率渲染、切、放到纸上、转黑白、存缓存。 */
  async layout(layout: PdfLayout): Promise<PdfLayoutResult> {
    const document = this.document;
    if (document === null) {
      return invalid(PDF_STATION_ISSUES.noDocument);
    }
    if (this.isPrinting()) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    const paper = parsePaperKey(layout.paperKey);
    if (paper === null) {
      return invalid(PDF_STATION_ISSUES.failed); // parsePdfLayout 已经核对过，只为类型
    }
    this.generation += 1;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation;
    await this.discardRun();
    const dpi = await this.deps.dpiFor(paper);
    const dots = paperDots(paper, dpi);
    const pieces = new Map<string, StoredPiece>();
    const views: PdfPieceView[] = [];
    let skippedPages = 0;
    let truncated = false;
    this.setProcessing({ done: 0, total: document.pages.length });
    try {
      for (const [index, size] of document.pages.entries()) {
        // 换文件、改设置发生在上一页处理期间（不一定卡在渲染上，存缓存也要等）：这一页还没开始就别再
        // 向渲染页要新的一页了，免得问一个可能已经被关掉、复用给新文档的渲染页。
        if (!isCurrent()) {
          break;
        }
        const page = index + 1;
        const rendered = await this.deps.renderer.render(page, size, dpi);
        if (!isCurrent()) {
          break;
        }
        const rects = cropRects(layout.crop, inkMask(rendered.image), splitOptionsFor(rendered.dpi), layout.boxes);
        if (rects.length === 0) {
          skippedPages += 1;
        }
        for (const { index: boxIndex, rect } of rects) {
          if (pieces.size >= PDF_LIMITS.pieces) {
            truncated = true;
            break;
          }
          const piece = boxIndex + 1;
          const bitmap = renderPiece(rendered.image, rect, { dots, mono: layout.mono, threshold: layout.threshold });
          const id = pieceId(page, piece);
          pieces.set(id, { page, piece, key: await this.deps.pieces.save(bitmap) });
          views.push({ id, page, piece, thumbnail: bitmapView(thumbnail(bitmap)) });
          // 存缓存是异步的：存的这一刻也可能已经被换设置、换文件超过。不再处理这一页剩下的块。
          if (!isCurrent()) {
            break;
          }
        }
        if (isCurrent()) {
          this.setProcessing({ done: page, total: document.pages.length });
        }
        if (truncated) {
          break;
        }
      }
    } catch (error) {
      await this.deps.pieces.remove(keysOf(pieces));
      if (!isCurrent()) {
        return { status: 'superseded' };
      }
      this.setProcessing(null);
      return invalid(this.issueOf(error));
    }
    if (!isCurrent()) {
      await this.deps.pieces.remove(keysOf(pieces));
      return { status: 'superseded' };
    }
    const runId = this.deps.createRunId();
    this.run = { id: runId, paper, dpi, pieces };
    this.setProcessing(null);
    return { status: 'ok', runId, paper, pieces: views, skippedPages, truncated };
  }

  /** 一块打出来的样子（和打印同一份 HTML）。 */
  async previewPiece(runId: string, id: string): Promise<PdfPiecePreviewResult> {
    const run = this.run;
    const document = this.document;
    const piece = run?.id === runId ? run.pieces.get(id) : undefined;
    if (run === null || document === null || piece === undefined) {
      return invalid(PDF_STATION_ISSUES.stale);
    }
    const bitmap = await this.deps.pieces.load(piece.key);
    if (bitmap === null) {
      return invalid(PDF_STATION_ISSUES.failed);
    }
    const html = this.deps.renderHtml(
      pieceTemplate(bitmap, run.paper),
      pieceContent(document.name, piece.page, piece.piece),
      pieceFields(document.name, piece.page, piece.piece),
      run.dpi,
    );
    return { status: 'ok', html, paper: run.paper };
  }

  /** 按顺序打选中的块，每块 copies 份；上一张进了打印队列才交下一张（BatchRun）。 */
  async print(request: PdfPrintRequest): Promise<PdfPrintStartResult> {
    if (this.isPrinting()) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    const run = this.run;
    const document = this.document;
    if (run === null || document === null || run.id !== request.runId) {
      return invalid(PDF_STATION_ISSUES.stale);
    }
    const chosen: StoredPiece[] = [];
    for (const id of request.pieceIds) {
      const piece = run.pieces.get(id);
      if (piece === undefined) {
        return invalid(PDF_STATION_ISSUES.stale);
      }
      chosen.push(piece);
    }
    // 行号就是打印顺序里的第几块（从 1 数），份号是这一块的第几份：BatchRun 按它们报进度和失败。
    const labels: BatchLabel[] = chosen.flatMap((piece, index) =>
      Array.from({ length: request.copies }, (_, copy) => ({
        row: index + 1,
        copy: copy + 1,
        fields: pieceFields(document.name, piece.page, piece.piece),
        content: pieceContent(document.name, piece.page, piece.piece),
      })),
    );
    const batch = new BatchRun(run.id, labels, {
      print: (label) => this.printPiece(run, document.name, chosen[label.row - 1], label),
      onChange: (progress) => {
        this.progress = progress;
        this.scheduleStatus();
      },
    });
    const finished = batch
      .run()
      .catch((error: unknown) => this.deps.log(`[pdf] printing stopped: ${String(error)}`))
      .finally(() => {
        // run() 返回时取消前正在打的那一张也结束了：再推一次，界面才看得到「真的停了」。
        this.progress = batch.snapshot();
        this.pushStatus();
      });
    this.printJob = { batch, run, fileName: document.name, chosen, finished };
    this.progress = batch.snapshot();
    this.pushStatus();
    return { status: 'started', progress: this.progress };
  }

  pause(): void {
    this.printJob?.batch.pause();
  }

  resume(): void {
    this.printJob?.batch.resume();
  }

  cancel(): void {
    this.printJob?.batch.cancel();
  }

  /** 等这一次打印真正结束（退出前取消之后用；没有在打时立即返回）。 */
  whenIdle(): Promise<void> {
    return this.printJob?.finished ?? Promise.resolve();
  }

  /**
   * 退出程序前要不要确认、能不能重启更新：正在打或暂停中时，还没轮到的那些块（不含正在打的那一张——
   * 它已经交给了打印机，可能已经出纸，不能当成「没打」）。没在打、打完了或被操作员取消了都返回 null。
   * 纯查询，不钉住任何位图：这一刻操作员完全可能看一眼就点「取消」，不能让这些块从此占着缓存不被清理。
   */
  pendingQuit(): { labels: PdfPendingLabel[] } | null {
    return this.pendingQuitSnapshot();
  }

  /**
   * 操作员确认「仍要退出」之后用：和 pendingQuit 同一份查询，但钉住这些块的位图——
   * 从这一刻起它们要记成「退出时未打」，7 天内还能从打印记录重打，换设置、关文件都不能删掉它们。
   */
  confirmQuit(): { labels: PdfPendingLabel[] } | null {
    const pending = this.pendingQuitSnapshot();
    if (pending !== null) {
      for (const label of pending.labels) {
        this.printedKeys.add(label.pdf.bitmap);
      }
    }
    return pending;
  }

  private pendingQuitSnapshot(): { labels: PdfPendingLabel[] } | null {
    const job = this.printJob;
    if (job === null || !job.batch.isActive) {
      return null;
    }
    const labels = job.batch.unattemptedLabels().flatMap((label) => {
      const piece = job.chosen[label.row - 1];
      if (piece === undefined) {
        return [];
      }
      return [
        {
          content: label.content,
          fields: label.fields,
          paper: job.run.paper,
          pdf: { file: job.fileName, page: piece.page, piece: piece.piece, bitmap: piece.key },
        },
      ];
    });
    return labels.length === 0 ? null : { labels };
  }

  /**
   * 关掉文件：放掉渲染页和没打过的块。打印中拒绝（要用缓存里的块），返回原因；界面只在失败时才
   * 保留文件、提示操作员，不能默认当作已经关掉了。
   */
  async closeDocument(): Promise<PdfCloseResult> {
    if (this.isPrinting()) {
      return invalid(PDF_STATION_ISSUES.printing);
    }
    this.generation += 1;
    await this.discardRun();
    this.document = null;
    this.printJob = null;
    this.progress = null;
    this.processing = null;
    this.deps.renderer.close();
    this.pushStatus();
    return { status: 'ok' };
  }

  /** 打印记录的预览、重打：读回那一块的位图，并从现在起再留一个保留期。已被清理时返回 null。 */
  async storedPiece(key: string): Promise<MonoBitmap | null> {
    const bitmap = await this.deps.pieces.load(key);
    if (bitmap !== null) {
      await this.deps.pieces.touch(key);
    }
    return bitmap;
  }

  status(): PdfStatus {
    return {
      fileName: this.document?.name ?? null,
      processing: this.processing,
      print: this.progress,
      isActive: this.isPrinting(),
    };
  }

  /** 还在打、暂停中，或取消后正在打的那一张还没结束（BatchRun.isActive）。 */
  private isPrinting(): boolean {
    return this.printJob?.batch.isActive === true;
  }

  private async printPiece(
    run: FinishedRun,
    fileName: string,
    piece: StoredPiece | undefined,
    label: BatchLabel,
  ): Promise<PrintResult> {
    if (piece === undefined) {
      throw new Error(`No PDF piece for print position ${label.row}`);
    }
    const bitmap = await this.deps.pieces.load(piece.key);
    if (bitmap === null) {
      throw new Error(`PDF piece ${piece.key} is missing from the cache`);
    }
    // 打印记录会指着这张位图：从现在起换设置、关文件都不删它。续期：打印记录按「最后用到的时间」
    // 显示过期，缓存按文件的修改时间清理，两边要用同一个时间点。
    this.printedKeys.add(piece.key);
    await this.deps.pieces.touch(piece.key);
    const result = await this.deps.printFields({
      template: pieceTemplate(bitmap, run.paper),
      fields: label.fields,
      content: label.content,
      source: 'pdf',
      caller: null,
      printerName: null,
      pdf: { file: fileName, page: piece.page, piece: piece.piece, bitmap: piece.key },
    });
    this.deps.onJobsChanged();
    return result;
  }

  private async discardRun(): Promise<void> {
    const run = this.run;
    this.run = null;
    if (run !== null) {
      await this.deps.pieces.remove(keysOf(run.pieces).filter((key) => !this.printedKeys.has(key)));
    }
  }

  private setProcessing(processing: { done: number; total: number } | null): void {
    this.processing = processing;
    this.pushStatus();
  }

  private scheduleStatus(): void {
    if (this.cancelStatusTimer !== null) {
      return;
    }
    this.cancelStatusTimer = this.deps.schedule(() => {
      this.cancelStatusTimer = null;
      this.pushStatus();
    }, STATUS_INTERVAL_MS);
  }

  private pushStatus(): void {
    this.cancelStatusTimer?.();
    this.cancelStatusTimer = null;
    this.deps.onStatus(this.status());
  }

  /** 渲染页的错误已经有中文原因（并已写日志）；其他意外写日志，给一句通用的。 */
  private issueOf(error: unknown): string {
    if (error instanceof PdfRenderError) {
      return error.issue;
    }
    this.deps.log(
      `[pdf] processing failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return PDF_STATION_ISSUES.failed;
  }
}

function invalid(issue: string): { status: 'invalid'; issue: string } {
  return { status: 'invalid', issue };
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, PDF_HEADER_WINDOW_BYTES)).includes(PDF_HEADER);
}

function bitmapView(bitmap: MonoBitmap): BitmapView {
  return { bmp: monoBmp(bitmap.bits, bitmap.width, bitmap.height), width: bitmap.width, height: bitmap.height };
}

function keysOf(pieces: ReadonlyMap<string, StoredPiece>): string[] {
  return [...pieces.values()].map((piece) => piece.key);
}
