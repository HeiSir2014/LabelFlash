import type { DocumentFormat } from '../../core/ipp/document-format';
import { IMAGE_LIMITS, imageSize, isImageTooLarge } from '../../core/ipp/image-size';
import type { IppJobBook } from '../../core/ipp/ipp-job-book';
import type { AcceptedDocument } from '../../core/ipp/ipp-operations';
import { chooseIppCrop, ippFields } from '../../core/ipp/ipp-print';
import { type RasterJobLimits, rasterJobLimits } from '../../core/ipp/raster';
import { inkMask } from '../../core/pdf/content-box';
import type { MonoBitmap } from '../../core/pdf/mono-pack';
import { cropRects, splitOptionsFor } from '../../core/pdf/page-split';
import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import { paperDots, renderPiece } from '../../core/pdf/piece-fit';
import { pieceContent, pieceTemplate } from '../../core/pdf/piece-template';
import type { FieldsPrint } from '../../core/print-service';
import { SerialQueue } from '../../core/serial-queue';
import type { ImageMode } from '../../core/templates/canvas-model';
import type { GrayImage } from '../../core/templates/mono-image';
import type { PrintResult } from '../../core/types';
import type { PaperSize } from '../../shared/paper-sizes';
import {
  type PageSize,
  POINTS_PER_INCH,
  type RasterPageInfo,
  type RenderImageType,
  type RenderRasterType,
} from '../../shared/pdf-render-protocol';
import { type OpenedPdf, PdfRenderError, type RenderedPage } from '../pdf/pdf-render-host';
import type { ApprovalResult } from './client-approvals';
import type { AcceptedJob } from './ipp-http-server';

const MM_PER_INCH = 25.4;
/** 转黑白的阈值：和 PDF 打印的默认值一样。 */
const MONO_THRESHOLD = 128;
/** 「万像素」：提示里按中文习惯写像素数。 */
const PIXELS_PER_WAN = 10_000;

/** 渲染 PDF、解图片和光栅的那一端（IPP 专用的一个 PdfRenderHost）。 */
export interface IppDocumentRenderer {
  open(data: Uint8Array): Promise<OpenedPdf>;
  openImage(data: Uint8Array, type: RenderImageType): Promise<OpenedPdf>;
  render(page: number, size: PageSize, dpi: number): Promise<RenderedPage>;
  openRaster(data: Uint8Array, type: RenderRasterType, limits: RasterJobLimits): Promise<RasterPageInfo[]>;
  renderRaster(page: number, info: RasterPageInfo): Promise<RenderedPage>;
  close(): void;
}

/** 黑白位图缓存（PDF 打印的 PieceCache）用到的部分。 */
export interface IppPieceStore {
  save(bitmap: MonoBitmap): Promise<string>;
  load(key: string): Promise<MonoBitmap | null>;
  remove(keys: readonly string[]): Promise<void>;
}

/** IppJobProcessor 的依赖。 */
export interface IppJobProcessorDeps {
  renderer: IppDocumentRenderer;
  pieces: IppPieceStore;
  book: IppJobBook;
  /** 这种纸会打到的那台打印机的分辨率。 */
  dpiFor: (paper: PaperSize) => Promise<number>;
  waitForApproval: (address: string, user: string, printerName: string) => Promise<ApprovalResult>;
  /** PrintService.printFields：决定打印机、排队、写记录。 */
  printFields: (input: FieldsPrint) => Promise<PrintResult>;
  /** 写了打印记录：界面刷新记录。 */
  onJobsChanged: () => void;
  /** 任务状态变了：刷新共享页的状态。 */
  onChange: () => void;
  log: (line: string) => void;
}

/** job-state-message：给交任务的那台电脑看的（打印队列里会显示）。 */
export const IPP_JOB_MESSAGES = {
  done: '已发送到打印机',
  canceled: '已取消',
  denied: '那台电脑上的操作员拒绝了这次打印',
  timeout: '等了 2 分钟没人允许：请那台电脑上的操作员点「允许」后再打',
  busy: '那台电脑上已经有几台电脑在等确认：稍后再打',
  blank: '文档是空白的，没有打印',
  tooManyPages: `文档超过 ${PDF_LIMITS.pages} 页：拆开再打`,
  badImage: '图片打不开：文件不完整或不是 JPEG / PNG',
  imageTooLarge: `图片太大（一边超过 ${IMAGE_LIMITS.side} 像素或超过 ${IMAGE_LIMITS.pixels / PIXELS_PER_WAN} 万像素）：缩小后再打`,
  badRaster: '收到的光栅数据不完整或格式不支持：在打印对话框里换一种打印方式再试',
  notReady: '热敏标签机现在不能打印（缺纸、卡纸、开盖或离线）：处理好再打',
  printerTimeout: '热敏标签机没有响应：检查连接后再打',
  noPrinter: '这种纸已经没有分配打印机',
  printFailed: '打印失败：详细原因已写入那台电脑的日志',
  failed: '处理文档时出错：详细原因已写入那台电脑的日志',
} as const;

interface Outcome {
  state: 'completed' | 'aborted' | 'canceled';
  reasons: string[];
  message: string;
}

const CANCELED: Outcome = { state: 'canceled', reasons: ['job-canceled-by-user'], message: IPP_JOB_MESSAGES.canceled };

/** 处理中遇到的、要原样告诉对方的问题。 */
class IppJobError extends Error {}

/** 一页：灰度、渲染用的分辨率、实际大小（毫米；图片不知道实际大小，为 null）。 */
interface SourcePage {
  image: GrayImage;
  dpi: number;
  sizeMm: PaperSize | null;
}

interface SavedPiece {
  page: number;
  piece: number;
  key: string;
}

/**
 * 局域网共享收到的任务 → 标签：先等操作员允许（新电脑；等的时候不占队列，别的电脑照样打），
 * 再一次处理一个（IPP 专用的一个渲染窗口）。复用 PDF 打印的裁切、放到纸上、临时模板和位图缓存，
 * 经 PrintService.printFields 照常决定打印机（按纸张）、排队、写记录。
 */
export class IppJobProcessor {
  private readonly queue = new SerialQueue();

  constructor(private readonly deps: IppJobProcessorDeps) {}

  /** 收下一个任务；返回的 Promise 在这个任务处理完时结束，不会失败（错误记进任务和日志）。 */
  enqueue(accepted: AcceptedJob): Promise<void> {
    return this.approve(accepted)
      .then((isApproved) => (isApproved ? this.queue.run(() => this.process(accepted)) : undefined))
      .catch((error: unknown) => this.deps.log(`[ipp] job ${accepted.job.id} stopped: ${describe(error)}`));
  }

  /** 新电脑：等操作员；拒绝、超时、太多电脑在等都中止。返回能不能接着处理。 */
  private async approve(accepted: AcceptedJob): Promise<boolean> {
    const { job, printer } = accepted;
    if (!accepted.needsApproval) {
      return true;
    }
    const decision = await this.deps.waitForApproval(job.client, job.user, printer.name);
    if (decision !== 'allowed') {
      const reason = decision === 'denied' ? 'job-canceled-by-operator' : 'aborted-by-system';
      this.deps.book.finish(job.id, 'aborted', [reason], IPP_JOB_MESSAGES[decision]);
      this.deps.onChange();
      return false;
    }
    this.deps.book.release(job.id);
    this.deps.onChange();
    return true;
  }

  private async process(accepted: AcceptedJob): Promise<void> {
    const { job, document } = accepted;
    const { book } = this.deps;
    // 排队时被取消了（对方取消、共享关了）：不再处理。
    if (!book.start(job.id)) {
      this.deps.onChange();
      return;
    }
    this.deps.onChange();
    const saved: SavedPiece[] = [];
    const printed = new Set<string>();
    try {
      const outcome = await this.printDocument(accepted, saved, printed);
      book.finish(job.id, outcome.state, outcome.reasons, outcome.message);
    } catch (error) {
      book.finish(job.id, 'aborted', ['aborted-by-system'], this.messageOf(error, document.format));
    } finally {
      this.deps.renderer.close();
      // 打过的位图打印记录还指着（7 天后由启动时的清理删）；没打的现在就删。
      await this.deps.pieces.remove(saved.map((piece) => piece.key).filter((key) => !printed.has(key)));
      this.deps.onChange();
    }
  }

  private async printDocument(accepted: AcceptedJob, saved: SavedPiece[], printed: Set<string>): Promise<Outcome> {
    const { job, printer, document } = accepted;
    const { book } = this.deps;
    const dpi = await this.deps.dpiFor(printer.paper);
    const dots = paperDots(printer.paper, dpi);
    // 照片用抖动（灰度层次）；文档、光栅里多是文字和条码，用阈值，边缘干净。
    const mono: ImageMode = document.format === 'image/jpeg' ? 'dither' : 'threshold';
    let pageNumber = 0;
    for await (const source of this.pages(document, printer.paper, dpi)) {
      pageNumber += 1;
      // 每页之间让出一次事件循环：裁切、转黑白在主进程里做，页多时别连着占住它（取消、别的请求要能进来）。
      await nextTurn();
      if (book.isCancelRequested(job.id)) {
        return CANCELED;
      }
      const crop = chooseIppCrop(source.sizeMm, printer.paper);
      // 空白页切不出块：不打白纸。
      const pieces = cropRects(crop, inkMask(source.image), splitOptionsFor(source.dpi), []);
      for (const piece of pieces) {
        const bitmap = renderPiece(source.image, piece.rect, { dots, mono, threshold: MONO_THRESHOLD });
        saved.push({ page: pageNumber, piece: piece.index + 1, key: await this.deps.pieces.save(bitmap) });
      }
    }
    if (saved.length === 0) {
      return { state: 'completed', reasons: ['job-completed-with-warnings'], message: IPP_JOB_MESSAGES.blank };
    }
    const share = { client: job.client, user: job.user };
    let impressions = 0;
    // 多份按整份文档依次打（1、2、1、2）：和办公打印机「逐份打印」一样。
    for (let copy = 0; copy < document.copies; copy += 1) {
      for (const piece of saved) {
        if (book.isCancelRequested(job.id)) {
          return CANCELED;
        }
        const bitmap = await this.deps.pieces.load(piece.key);
        if (bitmap === null) {
          throw new Error(`IPP piece ${piece.key} is missing from the cache`);
        }
        // 打印记录会指着这张位图：从现在起不删它。
        printed.add(piece.key);
        const result = await this.deps.printFields({
          template: pieceTemplate(bitmap, printer.paper),
          fields: ippFields(job.name, piece.page, piece.piece, share),
          content: pieceContent(job.name, piece.page, piece.piece),
          source: 'ipp',
          caller: null,
          printerName: null,
          pdf: { file: job.name, page: piece.page, piece: piece.piece, bitmap: piece.key },
          ipp: share,
        });
        this.deps.onJobsChanged();
        if (result.status !== 'printed') {
          return { state: 'aborted', reasons: ['aborted-by-system'], message: failureMessage(result) };
        }
        impressions += 1;
        book.progress(job.id, impressions);
      }
    }
    return { state: 'completed', reasons: ['job-completed-successfully'], message: IPP_JOB_MESSAGES.done };
  }

  /** 一页页的灰度，都在渲染页里解：光栅按原样大小；PDF 按打印机的分辨率；图片按原图大小（不知道实际尺寸，按去白边处理）。 */
  private async *pages(document: AcceptedDocument, paper: PaperSize, dpi: number): AsyncGenerator<SourcePage> {
    const { renderer } = this.deps;
    switch (document.format) {
      case 'image/pwg-raster':
      case 'image/urf': {
        // 解码在 sandbox 的渲染页里（行程编码几百 KB 能写出几十亿像素）；页的大小按这张纸、这台打印机限制。
        const infos = await renderer.openRaster(document.data, document.format, rasterJobLimits(paper, dpi));
        for (const [index, info] of infos.entries()) {
          const rendered = await renderer.renderRaster(index + 1, info);
          yield {
            image: rendered.image,
            dpi: rendered.dpi,
            sizeMm: {
              widthMm: (info.width / info.dpi) * MM_PER_INCH,
              heightMm: (info.height / info.dpi) * MM_PER_INCH,
            },
          };
        }
        return;
      }
      case 'image/jpeg':
      case 'image/png': {
        // 先按文件头看大小：几 KB 的文件能声明几十亿像素，这种不交给渲染页去解码。
        const declared = imageSize(document.data, document.format);
        if (declared === null) {
          throw new IppJobError(IPP_JOB_MESSAGES.badImage);
        }
        if (isImageTooLarge(declared)) {
          throw new IppJobError(IPP_JOB_MESSAGES.imageTooLarge);
        }
        const opened = await renderer.openImage(document.data, document.format);
        const size = opened.pages[0];
        if (size === undefined) {
          throw new IppJobError(IPP_JOB_MESSAGES.badImage);
        }
        const rendered = await renderer.render(1, size, POINTS_PER_INCH);
        yield { image: rendered.image, dpi: rendered.dpi, sizeMm: null };
        return;
      }
      case 'application/pdf': {
        const opened = await renderer.open(document.data);
        if (opened.pageCount > PDF_LIMITS.pages) {
          throw new IppJobError(IPP_JOB_MESSAGES.tooManyPages);
        }
        for (const [index, size] of opened.pages.entries()) {
          const rendered = await renderer.render(index + 1, size, dpi);
          yield {
            image: rendered.image,
            dpi: rendered.dpi,
            sizeMm: {
              widthMm: (size.width / POINTS_PER_INCH) * MM_PER_INCH,
              heightMm: (size.height / POINTS_PER_INCH) * MM_PER_INCH,
            },
          };
        }
        return;
      }
    }
  }

  private messageOf(error: unknown, format: DocumentFormat): string {
    if (error instanceof IppJobError) {
      return error.message;
    }
    if (error instanceof PdfRenderError) {
      // 渲染页的原始原因 PdfRenderHost 已经写过日志。
      if (format === 'application/pdf') {
        return error.issue;
      }
      return format === 'image/pwg-raster' || format === 'image/urf'
        ? IPP_JOB_MESSAGES.badRaster
        : IPP_JOB_MESSAGES.badImage;
    }
    this.deps.log(`[ipp] processing failed: ${describe(error)}`);
    return IPP_JOB_MESSAGES.failed;
  }
}

/** 让出一次事件循环（排在已经到达的网络事件之后）。 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function failureMessage(result: PrintResult): string {
  if (result.status === 'no-printer') {
    return IPP_JOB_MESSAGES.noPrinter;
  }
  if (result.status === 'failed') {
    switch (result.reason) {
      case 'PRINTER_NOT_READY':
        return IPP_JOB_MESSAGES.notReady;
      case 'PRINT_TIMEOUT':
        return IPP_JOB_MESSAGES.printerTimeout;
      default:
        return IPP_JOB_MESSAGES.printFailed;
    }
  }
  return IPP_JOB_MESSAGES.printFailed;
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
