import { LINE_HEIGHT } from '../../core/templates/text-fit';
import {
  CELL_PADDING_MM,
  type LaidCell,
  type LaidContent,
  type LaidRule,
  layoutWaybill,
  type Rect,
} from '../../core/templates/waybill-layout';
import type { WaybillTemplate } from '../../core/templates/waybill-model';
import type { LabelJob } from '../../core/types';
import type { RenderWarnings } from '../../shared/render-warnings';
import { encodeCode128 } from './code128';
import { escapeHtml, mm } from './html-text';
import { DEFAULT_PRINTER_DPI, dotMm, planQr } from './qr-code';

/**
 * 快递面单的 HTML：格子绝对定位（毫米），线是单独的细条，位置和换行都由 core 的 layoutWaybill 算好，
 * 浏览器只负责照着画（打印窗口不运行脚本）。预览和打印共用这一份。
 */

/** 条码两侧的空白（静区）：标准要求至少 10 个模块，扫码枪才找得到条码的起止。 */
const QUIET_ZONE_MODULES = 10;
/** 条码模块宽：203dpi 上 2–4 个点（0.25–0.5mm），其他分辨率按毫米换算。再窄扫码枪读不稳，再宽条码太长。 */
const MIN_MODULE_MM = 0.25;
const MAX_MODULE_MM = 0.5;
/** 号码和条码之间的空隙（mm）。 */
const BARCODE_TEXT_GAP_MM = 0.4;
/** 二维码按 M 级容错：面单二维码内容短，M 级足够；放不下时 planQr 逐级降低。 */
const QR_ERROR_LEVEL = 'M';
/** 反白的黑底比格子四边各缩进这么多：上下相邻的两个黑块之间留出白缝，不连成一片。 */
const INVERSE_INSET_MM = 0.4;
/** 虚线：一段 1.2mm、空 0.8mm。 */
const DASH_MM = 1.2;
const DASH_GAP_MM = 0.8;

export interface RenderedWaybill extends RenderWarnings {
  html: string;
}

export function renderWaybillHtml(
  job: LabelJob & { template: WaybillTemplate },
  dpi: number = DEFAULT_PRINTER_DPI,
): RenderedWaybill {
  const { template } = job;
  const dot = dotMm(dpi);
  const layout = layoutWaybill(template, { scan: job.scan, printedAt: new Date(job.printedAt), dotMm: dot });
  const omitted = { barcode: false, qr: false };
  const cells = layout.cells.map((cell) => cellHtml(cell, dot, dpi, omitted)).join('');
  const rules = layout.rules.map(ruleHtml).join('');
  const { widthMm, heightMm } = template.paper;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(titleOf(job))}</title>
<style>
  @page { size: ${mm(widthMm)} ${mm(heightMm)}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${mm(widthMm)}; height: ${mm(heightMm)}; overflow: hidden; background: #fff; color: #000; }
  body { position: relative; font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif; }
  .cell, .rule, .ink { position: absolute; }
  .cell { overflow: hidden; }
  .rule { background: #000; }
  .rule--dashed-h { background: repeating-linear-gradient(90deg, #000 0 ${mm(DASH_MM)}, transparent ${mm(DASH_MM)} ${mm(DASH_MM + DASH_GAP_MM)}); }
  .rule--dashed-v { background: repeating-linear-gradient(180deg, #000 0 ${mm(DASH_MM)}, transparent ${mm(DASH_MM)} ${mm(DASH_MM + DASH_GAP_MM)}); }
  .ink { inset: ${mm(INVERSE_INSET_MM)}; background: #000; }
  .text { position: absolute; inset: ${mm(CELL_PADDING_MM.y)} ${mm(CELL_PADDING_MM.x)}; display: flex; flex-direction: column; }
  .text--middle { justify-content: center; }
  .text--top { justify-content: flex-start; }
  .text--inverse { color: #fff; }
  .line { white-space: pre; overflow: hidden; line-height: ${LINE_HEIGHT}; }
  .code { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .code svg { display: block; }
  .code__text { white-space: pre; line-height: ${LINE_HEIGHT}; font-weight: 700; letter-spacing: 0.04em; }
</style>
</head>
<body>${cells}${rules}</body>
</html>`;
  return { html, overflowCells: layout.overflowCells, barcodeOmitted: omitted.barcode, qrOmitted: omitted.qr };
}

/** 打印任务名：运单号，没有时用完整内容。 */
function titleOf(job: LabelJob): string {
  return job.scan.fields.find((field) => field.name === '运单号')?.value || job.scan.raw;
}

interface Omitted {
  barcode: boolean;
  qr: boolean;
}

function cellHtml(cell: LaidCell, dot: number, dpi: number, omitted: Omitted): string {
  const inner = contentHtml(cell.content, cell.rect, dot, dpi, omitted);
  return inner === '' ? '' : `<div class="cell" style="${boxCss(cell.rect)}">${inner}</div>`;
}

function contentHtml(content: LaidContent, rect: Rect, dot: number, dpi: number, omitted: Omitted): string {
  switch (content.kind) {
    case 'empty':
      return '';
    case 'text': {
      if (content.lines.length === 0) {
        return '';
      }
      const lines = content.lines
        .map(
          (line) =>
            `<div class="line" style="font-size:${mm(line.fontSizeMm)};font-weight:${line.bold ? 700 : 400}">${escapeHtml(line.text)}</div>`,
        )
        .join('');
      const classes = `text text--${content.valign}${content.inverse ? ' text--inverse' : ''}`;
      return `${content.inverse ? '<div class="ink"></div>' : ''}<div class="${classes}" style="text-align:${content.align}">${lines}</div>`;
    }
    case 'barcode': {
      if (content.value === '') {
        return '';
      }
      const svg = barcodeSvg(content, rect, dot);
      if (svg === null) {
        omitted.barcode = true;
        return '';
      }
      return svg;
    }
    case 'qr': {
      if (content.value === '') {
        return '';
      }
      const box = Math.min(rect.width - 2 * CELL_PADDING_MM.x, rect.height - 2 * CELL_PADDING_MM.y);
      const plan = planQr(content.value, QR_ERROR_LEVEL, box, dpi);
      if (plan === null) {
        omitted.qr = true;
        return '';
      }
      return `<div class="code"><div style="width:${mm(plan.sizeMm)};height:${mm(plan.sizeMm)}">${plan.svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`;
    }
  }
}

/**
 * 条码：每个模块取整数个点，两侧留静区，在格子里居中；横排时号码印在条码下方。
 * 竖排时条码转 90°（条纹横着走），不印号码。放不下最小模块宽时返回 null。
 */
function barcodeSvg(content: Extract<LaidContent, { kind: 'barcode' }>, rect: Rect, dot: number): string | null {
  const code = encodeCode128(content.value);
  if (code === null) {
    return null;
  }
  const lengthMm = content.vertical ? rect.height : rect.width;
  const totalModules = code.modules + 2 * QUIET_ZONE_MODULES;
  const minDots = Math.max(1, Math.round(MIN_MODULE_MM / dot));
  const maxDots = Math.max(minDots, Math.round(MAX_MODULE_MM / dot));
  const moduleDots = Math.min(maxDots, Math.floor(lengthMm / dot / totalModules));
  if (moduleDots < minDots) {
    return null;
  }
  const moduleMm = moduleDots * dot;
  const barsLengthMm = code.modules * moduleMm;
  const showText = content.showText && !content.vertical;
  const textBlockMm = showText ? content.textSizeMm * LINE_HEIGHT + BARCODE_TEXT_GAP_MM : 0;
  const crossMm =
    (content.vertical ? rect.width - 2 * CELL_PADDING_MM.x : rect.height - 2 * CELL_PADDING_MM.y) - textBlockMm;
  if (crossMm <= 0) {
    return null;
  }
  let offset = 0;
  let path = '';
  code.widths.forEach((width, index) => {
    if (index % 2 === 0) {
      path += content.vertical ? `M0 ${offset}h1v${width}H0z` : `M${offset} 0h${width}v1H${offset}z`;
    }
    offset += width;
  });
  const viewBox = content.vertical ? `0 0 1 ${code.modules}` : `0 0 ${code.modules} 1`;
  const size = content.vertical
    ? `width:${mm(crossMm)};height:${mm(barsLengthMm)}`
    : `width:${mm(barsLengthMm)};height:${mm(crossMm)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none" shape-rendering="crispEdges" style="${size}"><path d="${path}"/></svg>`;
  const text = showText
    ? `<div class="code__text" style="font-size:${mm(content.textSizeMm)};margin-top:${mm(BARCODE_TEXT_GAP_MM)}">${escapeHtml(content.value)}</div>`
    : '';
  return `<div class="code">${svg}${text}</div>`;
}

function ruleHtml(rule: LaidRule): string {
  const dashed = rule.style === 'dashed' ? ` rule--dashed-${rule.orientation === 'horizontal' ? 'h' : 'v'}` : '';
  return `<div class="rule${dashed}" style="${boxCss(rule.rect)}"></div>`;
}

function boxCss(rect: Rect): string {
  return `left:${mm(rect.x)};top:${mm(rect.y)};width:${mm(rect.width)};height:${mm(rect.height)}`;
}
