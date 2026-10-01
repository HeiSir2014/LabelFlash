import { fieldsScan } from '../../core/print-service';
import type { ScanField } from '../../core/scan/scan-result';
import type { LabelTemplate } from '../../core/templates/template-model';
import { renderWarningTexts } from '../../shared/render-warnings';
import { renderLabelHtml } from '../printing/label-html';
import { withLabelWindow } from '../printing/label-window';

/**
 * PDF 不针对某台打印机：二维码按 1200dpi 对齐，模块尺寸实际上就是按毫米算（最小仍约 0.25mm），
 * 打印出来在常见的 203、300dpi 打印机上都清晰。
 */
export const PDF_DPI = 1200;
/** 生成一张 PDF 最多等这么久：隐藏窗口卡住时不让接口请求一直挂着。 */
const PDF_RENDER_TIMEOUT_MS = 15_000;
const MM_PER_INCH = 25.4;

/** 按模板的纸张排版出一页 PDF，和打印共用同一份标签 HTML。 */
export async function renderLabelPdf(
  template: LabelTemplate,
  fields: ScanField[],
  content: string,
): Promise<Uint8Array> {
  const { html, ...warnings } = renderLabelHtml(
    { scan: fieldsScan(content, fields), template, printedAt: Date.now() },
    PDF_DPI,
  );
  const texts = renderWarningTexts(warnings);
  if (texts.length > 0) {
    console.warn(`[LocalApi] PDF of "${content}" with template "${template.name}": ${texts.join('；')}`);
  }
  const { widthMm, heightMm } = template.paper;
  return withLabelWindow(html, AbortSignal.timeout(PDF_RENDER_TIMEOUT_MS), (contents) =>
    contents.printToPDF({
      printBackground: true,
      // 标签 HTML 里有 @page 尺寸；pageSize 是它不生效时的兜底（单位英寸）。
      preferCSSPageSize: true,
      pageSize: { width: widthMm / MM_PER_INCH, height: heightMm / MM_PER_INCH },
      // printToPDF 默认留约 0.4 英寸边距，标签要贴边。
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }),
  );
}
