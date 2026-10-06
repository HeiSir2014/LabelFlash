import { PDF_LIMITS } from '../../core/pdf/pdf-model';
import type { GrayImage } from '../../core/templates/mono-image';
import {
  type ExpectedReply,
  type PageSize,
  POINTS_PER_INCH,
  type RenderReply,
  type RenderRequest,
  readRenderReply,
  renderedSize,
  renderScale,
} from '../../shared/pdf-render-protocol';

/** 渲染页这一端：index.ts 用隐藏窗口实现（pdf-render-window.ts），测试里换成假的。 */
export interface RenderPort {
  send(request: RenderRequest): void;
  onReply(listener: (message: unknown) => void): void;
  /** 渲染页崩溃、被关掉时调用。 */
  onGone(listener: () => void): void;
  close(): void;
}

export interface PdfRenderHostDeps {
  openPort: () => Promise<RenderPort>;
  openTimeoutMs: number;
  pageTimeoutMs: number;
  schedule: (run: () => void, delayMs: number) => () => void;
  log: (line: string) => void;
}

/** 给用户看的原因（中文、带下一步）；原始的英文错误另写日志。 */
export const PDF_ISSUES = {
  password: 'PDF 加了密码：先在 PDF 阅读器里另存一份不带密码的再打',
  invalid: '打不开这个 PDF：文件不完整或不是 PDF。重新导出或下载一次再试',
  failed: '这个 PDF 渲染出错：重新导出一次再试，详细原因已写入日志',
  timeout: 'PDF 渲染超时：页面太复杂或文件有问题。重新导出一次再试',
  gone: 'PDF 渲染进程意外退出：重新选择这个文件再试',
} as const;

/** 打不开、渲染失败：issue 是给用户看的中文，message 是写日志的原始说明。 */
export class PdfRenderError extends Error {
  constructor(
    readonly issue: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'PdfRenderError';
  }
}

/**
 * 这次打开在建渲染页的时候被更新的打开、关闭超过了：它建好的渲染页已经关掉。不是错误，调用方按「作废」处理。
 */
export class PdfOpenSupersededError extends Error {
  constructor() {
    super('a newer open or close superseded this open');
    this.name = 'PdfOpenSupersededError';
  }
}

export interface OpenedPdf {
  pageCount: number;
  /** 每页大小（点）；页数超过上限时为空。 */
  pages: PageSize[];
}

export interface RenderedPage {
  image: GrayImage;
  /** 实际用的分辨率：特大的页会低于要求的 dpi。 */
  dpi: number;
}

interface Waiter {
  expected: ExpectedReply;
  resolve: (reply: RenderReply) => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
}

/**
 * 主进程这一侧的 PDF 渲染：一次只开一个渲染页（一个 PDF），请求带编号、各自限时。
 * 渲染页不可信：回复格式不对、超时都关掉它，下次打开文件时新建。
 */
export class PdfRenderHost {
  private port: RenderPort | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiter>();
  /**
   * 每次 open、close 加一。建渲染页要等（新建隐藏窗口），这期间又来一次打开或关闭的话，
   * 先建好的那个不能再挂上来：不然它会顶掉后来的那个，被顶掉的隐藏窗口没人关，两次打开也都失败。
   */
  private generation = 0;

  constructor(private readonly deps: PdfRenderHostDeps) {}

  /** 打开一个 PDF（关掉上一个）。打不开时抛 PdfRenderError；被更新的打开、关闭超过时抛 PdfOpenSupersededError。 */
  async open(data: Uint8Array): Promise<OpenedPdf> {
    this.close();
    const generation = this.generation;
    const port = await this.deps.openPort();
    if (generation !== this.generation) {
      port.close();
      throw new PdfOpenSupersededError();
    }
    this.port = port;
    port.onReply((message) => this.receive(port, message));
    port.onGone(() => {
      if (this.port === port) {
        this.deps.log('[pdf] the render page is gone');
        this.drop(new PdfRenderError(PDF_ISSUES.gone, 'render page is gone'));
      }
    });
    const reply = await this.request(
      (id) => ({ id, kind: 'open', data }),
      (id) => ({ id, kind: 'opened', maxPages: PDF_LIMITS.pages }),
      this.deps.openTimeoutMs,
    );
    if (reply.kind !== 'opened') {
      throw new PdfRenderError(PDF_ISSUES.failed, `unexpected ${reply.kind} reply to open`);
    }
    return { pageCount: reply.pageCount, pages: reply.pages };
  }

  /** 把第 page 页（从 1 数）按 dpi 渲染成灰度；像素超过上限时自动降低分辨率，实际用的 dpi 一起返回。 */
  async render(page: number, size: PageSize, dpi: number): Promise<RenderedPage> {
    const scale = renderScale(size, dpi, PDF_LIMITS.pagePixels);
    const expected = renderedSize(size, scale);
    const reply = await this.request(
      (id) => ({ id, kind: 'render', page, scale }),
      (id) => ({ id, kind: 'rendered', width: expected.width, height: expected.height }),
      this.deps.pageTimeoutMs,
    );
    if (reply.kind !== 'rendered') {
      throw new PdfRenderError(PDF_ISSUES.failed, `unexpected ${reply.kind} reply to render`);
    }
    return { image: { width: reply.width, height: reply.height, pixels: reply.gray }, dpi: scale * POINTS_PER_INCH };
  }

  /** 关掉渲染页（换文件、关文件、退出时）；还在等的请求都失败。 */
  close(): void {
    this.generation += 1;
    this.drop(new PdfRenderError(PDF_ISSUES.gone, 'render page closed'));
  }

  private drop(error: PdfRenderError): void {
    const port = this.port;
    this.port = null;
    port?.close();
    const waiters = [...this.waiting.values()];
    this.waiting.clear();
    for (const waiter of waiters) {
      waiter.cancelTimer();
      waiter.reject(error);
    }
  }

  private request(
    build: (id: number) => RenderRequest,
    expect: (id: number) => ExpectedReply,
    timeoutMs: number,
  ): Promise<RenderReply> {
    const port = this.port;
    if (port === null) {
      return Promise.reject(new PdfRenderError(PDF_ISSUES.gone, 'no PDF is open'));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const cancelTimer = this.deps.schedule(() => {
        this.waiting.delete(id);
        this.deps.log(`[pdf] render request ${id} timed out after ${timeoutMs}ms`);
        reject(new PdfRenderError(PDF_ISSUES.timeout, 'timed out'));
        // 卡住的渲染页不能再用：关掉它，下次打开文件时新建。
        this.drop(new PdfRenderError(PDF_ISSUES.timeout, 'another request timed out'));
      }, timeoutMs);
      this.waiting.set(id, { expected: expect(id), resolve, reject, cancelTimer });
      port.send(build(id));
    });
  }

  private receive(port: RenderPort, message: unknown): void {
    if (port !== this.port) {
      return; // 已经关掉的渲染页迟到的回复
    }
    const id = typeof message === 'object' && message !== null ? (message as { id?: unknown }).id : undefined;
    if (typeof id !== 'number') {
      this.deps.log('[pdf] ignored a reply without a request id');
      return;
    }
    const waiter = this.waiting.get(id);
    if (waiter === undefined) {
      this.deps.log(`[pdf] ignored a reply to request ${id} that nobody is waiting for`);
      return;
    }
    this.waiting.delete(id);
    waiter.cancelTimer();
    const reply = readRenderReply(message, waiter.expected);
    if (reply === null) {
      this.deps.log(`[pdf] the render page sent a malformed reply to request ${id}`);
      waiter.reject(new PdfRenderError(PDF_ISSUES.failed, 'malformed reply'));
      // 回复不合格式说明渲染页出了问题（甚至被 PDF 攻破）：不再用它。
      this.drop(new PdfRenderError(PDF_ISSUES.failed, 'render page sent a malformed reply'));
      return;
    }
    if (reply.kind === 'error') {
      this.deps.log(`[pdf] the render page reported ${reply.error}: ${reply.detail}`);
      waiter.reject(new PdfRenderError(PDF_ISSUES[reply.error], reply.detail));
      return;
    }
    waiter.resolve(reply);
  }
}
