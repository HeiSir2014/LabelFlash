import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_LIMITS } from '../../../core/pdf/pdf-model';
import {
  MAX_PAGE_POINTS,
  type PageSize,
  type PdfHostApi,
  type RenderError,
  type RenderImageType,
  type RenderReply,
  type RenderRequest,
  renderedSize,
  rgbaToGray,
} from '../../../shared/pdf-render-protocol';

/**
 * 隐藏的 PDF 渲染页（主进程的 pdf-render-window.ts 打开，不显示）：用 pdf.js 把页面画到画布上，转成灰度交回主进程。
 * PDF 不可信，所以这一页开 sandbox、不连网、没有 Node，只能经 window.pdfHost 收请求、回结果；
 * 不碰主窗口的 window.api，也不属于界面的 MVVM 分层（它没有界面）。
 * window.pdfHost 只在这一页有，所以不加进全局的 Window 类型（免得界面的代码以为能用它）。
 */
const host = (window as unknown as { pdfHost: PdfHostApi }).pdfHost;

/** pdf.js 的运行时文件在产物里的位置（见 scripts/pdfjs-assets.ts）。 */
const ASSETS = new URL('pdfjs/', document.baseURI);

GlobalWorkerOptions.workerSrc = workerUrl;

/** 打开着的文档：PDF，或者一张已解码的图片（只有一页，局域网共享收到的 JPEG / PNG）。 */
type OpenDocument = { kind: 'pdf'; pdf: PDFDocumentProxy } | { kind: 'image'; bitmap: ImageBitmap };

let current: OpenDocument | null = null;

/** 图片太大（任一边超过 PDF 的页面上限）：按「打不开」回给主进程。 */
class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

host.onRequest((request) => {
  void handle(request).then(
    (reply) => host.reply(reply),
    (error: unknown) => host.reply(failure(request.id, error)),
  );
});

function handle(request: RenderRequest): Promise<RenderReply> {
  switch (request.kind) {
    case 'open':
      return open(request.id, request.data);
    case 'open-image':
      return openImage(request.id, request.data, request.type);
    case 'render':
      return render(request.id, request.page, request.scale);
  }
}

async function closeCurrent(): Promise<void> {
  const opened = current;
  current = null;
  if (opened?.kind === 'pdf') {
    // 放掉上一个文件（pdf.js 6 起 destroy 在加载任务上）：worker 里它的页面、字体都清掉。
    await opened.pdf.loadingTask.destroy();
  } else if (opened?.kind === 'image') {
    opened.bitmap.close();
  }
}

async function openImage(id: number, data: Uint8Array, type: RenderImageType): Promise<RenderReply> {
  await closeCurrent();
  // 复制一份成 ArrayBuffer 支撑的数组再交给 Blob；解码用 Chromium 自己的解码器，只在这个 sandbox 页里跑。
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
  if (bitmap.width > MAX_PAGE_POINTS || bitmap.height > MAX_PAGE_POINTS) {
    bitmap.close();
    throw new InvalidImageError(`image is ${bitmap.width}×${bitmap.height}`);
  }
  current = { kind: 'image', bitmap };
  return { id, kind: 'opened', pageCount: 1, pages: [{ width: bitmap.width, height: bitmap.height }] };
}

async function open(id: number, data: Uint8Array): Promise<RenderReply> {
  await closeCurrent();
  const pdf = await getDocument({
    data,
    cMapUrl: new URL('cmaps/', ASSETS).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', ASSETS).href,
    wasmUrl: new URL('wasm/', ASSETS).href,
    iccUrl: new URL('iccs/', ASSETS).href,
    // 不读 XFA 表单；缺字体时用随包的标准字体而不是系统字体：同一个 PDF 在每台电脑上打出来一样。
    enableXfa: false,
    useSystemFonts: false,
  }).promise;
  current = { kind: 'pdf', pdf };
  const pages: PageSize[] = [];
  // 页数超过上限时不逐页读大小（几千页要读很久），主进程按页数拒绝。
  if (pdf.numPages <= PDF_LIMITS.pages) {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      page.cleanup();
    }
  }
  return { id, kind: 'opened', pageCount: pdf.numPages, pages };
}

async function render(id: number, number: number, scale: number): Promise<RenderReply> {
  const opened = current;
  if (opened === null) {
    throw new Error('no document is open');
  }
  if (opened.kind === 'image') {
    const { bitmap } = opened;
    const size = renderedSize({ width: bitmap.width, height: bitmap.height }, scale);
    return drawGray(id, size, (context) => {
      context.drawImage(bitmap, 0, 0, size.width, size.height);
    });
  }
  const page = await opened.pdf.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const size = renderedSize({ width: base.width, height: base.height }, scale);
  const reply = await drawGray(id, size, async (context, canvas) => {
    // intent: 'print' 和打印 PDF 一样画表单里填的内容、不画只在屏幕上显示的批注。
    await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), intent: 'print' })
      .promise;
  });
  page.cleanup();
  return reply;
}

/** 开一块画布、铺白纸（透明的地方按白纸打）、画、转灰度，然后马上放掉画布（1600 万像素的 RGBA 就是 64MB）。 */
async function drawGray(
  id: number,
  size: { width: number; height: number },
  draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void | Promise<void>,
): Promise<RenderReply> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (context === null) {
    throw new Error('2d canvas is not available');
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  await draw(context, canvas);
  const gray = new Uint8Array(size.width * size.height);
  rgbaToGray(context.getImageData(0, 0, size.width, size.height).data, gray);
  canvas.width = 0;
  canvas.height = 0;
  return { id, kind: 'rendered', width: size.width, height: size.height, gray };
}

/**
 * pdf.js 的异常名：PasswordException（要密码）、InvalidPDFException（不是 PDF 或坏了）；
 * 图片解不开是 InvalidStateError / EncodingError，太大是 InvalidImageError。
 */
const INVALID_ERROR_NAMES: ReadonlySet<string> = new Set([
  'InvalidPDFException',
  'InvalidImageError',
  'InvalidStateError',
  'EncodingError',
]);

function failure(id: number, error: unknown): RenderReply {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  const kind: RenderError =
    name === 'PasswordException' ? 'password' : INVALID_ERROR_NAMES.has(name) ? 'invalid' : 'failed';
  const detail =
    error instanceof Error || error instanceof DOMException ? `${error.name}: ${error.message}` : String(error);
  return { id, kind: 'error', error: kind, detail };
}
