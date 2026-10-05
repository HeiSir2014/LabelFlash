import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_LIMITS } from '../../../core/pdf/pdf-model';
import {
  type PageSize,
  type PdfHostApi,
  type RenderError,
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

let current: PDFDocumentProxy | null = null;

host.onRequest((request) => {
  void handle(request).then(
    (reply) => host.reply(reply),
    (error: unknown) => host.reply(failure(request.id, error)),
  );
});

function handle(request: RenderRequest): Promise<RenderReply> {
  return request.kind === 'open' ? open(request.id, request.data) : render(request.id, request.page, request.scale);
}

async function open(id: number, data: Uint8Array): Promise<RenderReply> {
  // 放掉上一个文件（pdf.js 6 起 destroy 在加载任务上）：worker 里它的页面、字体都清掉。
  await current?.loadingTask.destroy();
  current = null;
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
  current = pdf;
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
  if (current === null) {
    throw new Error('no document is open');
  }
  const page = await current.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const size = renderedSize({ width: base.width, height: base.height }, scale);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (context === null) {
    throw new Error('2d canvas is not available');
  }
  // 先铺白纸：PDF 里透明的地方按白纸打。
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  // intent: 'print' 和打印 PDF 一样画表单里填的内容、不画只在屏幕上显示的批注。
  await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }), intent: 'print' }).promise;
  const gray = new Uint8Array(size.width * size.height);
  rgbaToGray(context.getImageData(0, 0, size.width, size.height).data, gray);
  page.cleanup();
  // 马上放掉画布：一页最多 1600 万像素，RGBA 就是 64MB。
  canvas.width = 0;
  canvas.height = 0;
  return { id, kind: 'rendered', width: size.width, height: size.height, gray };
}

/** pdf.js 的异常名：PasswordException（要密码）、InvalidPDFException（不是 PDF 或坏了）。 */
function failure(id: number, error: unknown): RenderReply {
  const name = error instanceof Error ? error.name : '';
  const kind: RenderError =
    name === 'PasswordException' ? 'password' : name === 'InvalidPDFException' ? 'invalid' : 'failed';
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { id, kind: 'error', error: kind, detail };
}
