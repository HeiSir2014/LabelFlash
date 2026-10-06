import { type LaidCanvasContent, type LaidCanvasElement, layoutCanvas } from '../../core/templates/canvas-layout';
import {
  type CanvasBarcode,
  type CanvasImage,
  type CanvasQr,
  type CanvasTemplate,
  snapBorderDots,
} from '../../core/templates/canvas-model';
import { decodeGray, fitContain, monoBmp, resizeGray, toMono } from '../../core/templates/mono-image';
import { LINE_HEIGHT } from '../../core/templates/text-fit';
import { LINE_WIDTH_SLACK, textWidthMm } from '../../core/templates/waybill-layout';
import type { LabelJob } from '../../core/types';
import type { ElementWarning, RenderWarnings } from '../../shared/render-warnings';
import {
  CANVAS_MAX_MODULE_MM,
  encodeBarcode,
  linearBarsPath,
  MIN_BAR_HEIGHT_MM,
  matrixPath,
  matrixQuietZone,
  minModuleDots,
  moduleDotsFor,
  QUIET_ZONE_MODULES,
} from './barcode';
import { BARCODE_TEXT_GAP_MM, DASH_GAP_MM, DASH_MM, escapeHtml, mm } from './html-text';
import { DEFAULT_PRINTER_DPI, dotMm, planQr } from './qr-code';

/** 自由设计的二维码外，至少留 2 个模块的空白：和条码两侧的静区一个道理，给扫码设备留出辨认边界的余地。 */
const CANVAS_QR_QUIET_ZONE_MODULES = 2;

export interface RenderedCanvas extends RenderWarnings {
  html: string;
  /** 条码库给的原始错误（英文，按码制加前缀），写日志用，不进 issues（那是给操作员看的中文）、不在预览里显示。 */
  diagnostics: string[];
}

interface Findings {
  barcodeOmitted: boolean;
  qrOmitted: boolean;
  issues: string[];
  /** 每个元素的问题：issues 的每一条都在这里，另有只在设计器里提醒的（条码宽度快不够）。 */
  elements: ElementWarning[];
  diagnostics: string[];
  /** 排版之后、画 HTML 时才发现的截断（例如条码号码比框宽）：和 layoutCanvas 的 overflowCount 加在一起。 */
  overflowCount: number;
}

/** 条码宽度不到最小宽度的 1.1 倍就提前提醒：内容（例如编码）再长几位就印不出了。 */
const TIGHT_WIDTH_RATIO = 1.1;
/** 「至少要多宽」往上取到 0.1mm：数字框按 0.1mm 调，操作员照着填也印得出。 */
const MINIMUM_SIZE_STEP_MM = 0.1;
/** 取整前去掉浮点误差：40.5 算成 40.500000001 时不该进到 40.6。 */
const ROUNDING_EPSILON = 1e-9;
/** 打印前检查里引用条码内容最多这么多个字：太长的内容一行放不下，后面用「…」。 */
const QUOTED_CONTENT_LENGTH = 20;

/** 给元素的问题：要不要也算打印问题（进 issues、写打印日志）由 isPrintIssue 决定。 */
function report(findings: Findings, warning: ElementWarning, isPrintIssue = true): void {
  findings.elements.push(warning);
  if (isPrintIssue) {
    findings.issues.push(warning.text);
  }
}

/**
 * 至少 neededDots 个点时，元素框要填多宽（mm）：元素框的两条边各自四舍五入到点，最坏会少半个点，
 * 所以多留半个点再往上取到 0.1mm——这样元素落在哪个小数位置上都印得出。
 */
function minimumSizeMm(neededDots: number, dot: number): number {
  const exact = (neededDots + 1 / 2) * dot;
  return Math.ceil(exact / MINIMUM_SIZE_STEP_MM - ROUNDING_EPSILON) / (1 / MINIMUM_SIZE_STEP_MM);
}

/** 毫米写成短数字（38、40.5）：不带多余的 0。 */
function formatMm(value: number): string {
  return String(Number(value.toFixed(2)));
}

function quoteContent(value: string): string {
  const characters = [...value];
  return characters.length <= QUOTED_CONTENT_LENGTH
    ? value
    : `${characters.slice(0, QUOTED_CONTENT_LENGTH - 1).join('')}…`;
}

/** 内容框（没转之前）方向上的最小尺寸 → 元素框（转过之后）方向：转 90° / 270° 时宽高对调。 */
function boxMinimum(
  rotation: LaidCanvasElement['rotation'],
  frameWidthMm: number | null,
  frameHeightMm: number | null,
): Pick<ElementWarning, 'minWidthMm' | 'minHeightMm'> {
  const turned = rotation === 90 || rotation === 270;
  return turned
    ? { minWidthMm: frameHeightMm, minHeightMm: frameWidthMm }
    : { minWidthMm: frameWidthMm, minHeightMm: frameHeightMm };
}

/**
 * 自由设计模板 → HTML：每个元素一个绝对定位的框（取整到打印点），转角度时内容框用整点的平移 + 直角旋转，
 * 条码、二维码、图片按打印点画成 SVG。预览和打印共用这一份（打印窗口不运行脚本）。
 */
export function renderCanvasHtml(
  job: LabelJob & { template: CanvasTemplate },
  dpi: number = DEFAULT_PRINTER_DPI,
): RenderedCanvas {
  const { template } = job;
  const dot = dotMm(dpi);
  const layout = layoutCanvas(template, { scan: job.scan, printedAt: new Date(job.printedAt), dotMm: dot });
  const findings: Findings = {
    barcodeOmitted: false,
    qrOmitted: false,
    issues: [...layout.issues],
    elements: layout.elementIssues.map((issue) => ({ ...issue, minWidthMm: null, minHeightMm: null })),
    diagnostics: [],
    overflowCount: 0,
  };
  const body = layout.elements.map((element) => elementHtml(element, dot, dpi, findings)).join('');
  const { widthMm, heightMm } = template.paper;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(job.scan.raw)}</title>
<style>
  @page { size: ${mm(widthMm)} ${mm(heightMm)}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${mm(widthMm)}; height: ${mm(heightMm)}; overflow: hidden; background: #fff; color: #000; }
  body { position: relative; font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif; }
  .el { position: absolute; }
  .frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
  .text { display: flex; flex-direction: column; height: 100%; }
  .text--middle { justify-content: center; }
  .text--top { justify-content: flex-start; }
  .line { white-space: pre; overflow: hidden; line-height: ${LINE_HEIGHT}; }
  .code { position: absolute; display: flex; flex-direction: column; align-items: center; }
  .code svg { display: block; }
  .dots { position: absolute; display: block; }
  .code__text { white-space: pre; line-height: ${LINE_HEIGHT}; font-weight: 700; text-align: center; }
</style>
</head>
<body>${body}</body>
</html>`;
  return {
    html,
    qrOmitted: findings.qrOmitted,
    barcodeOmitted: findings.barcodeOmitted,
    overflowCells: layout.overflowCount + findings.overflowCount,
    issues: findings.issues,
    elements: findings.elements,
    diagnostics: findings.diagnostics,
  };
}

function elementHtml(element: LaidCanvasElement, dot: number, dpi: number, findings: Findings): string {
  const inner = contentHtml(element, dot, dpi, findings);
  if (inner === '') {
    return '';
  }
  const { rect, frame } = element;
  // data-element-id：设计器的「隐藏（只在设计器里隐藏）」按它给画布上的预览加样式，打印不受影响。
  return `<div class="el" data-element-id="${escapeHtml(element.id)}" style="left:${mm(rect.x)};top:${mm(rect.y)};width:${mm(rect.width)};height:${mm(rect.height)}"><div class="frame" style="width:${mm(frame.width)};height:${mm(frame.height)}${rotationCss(element)}">${inner}</div></div>`;
}

/**
 * 直角旋转：内容框先绕左上角转，再平移回元素的框里。平移量是元素框的宽或高（都是整数个点），
 * 转完的每条边仍在打印点上；绕中心转的话，奇数个点的框会落在半个点上。
 */
function rotationCss({ rotation, rect }: LaidCanvasElement): string {
  switch (rotation) {
    case 0:
      return '';
    case 90:
      return `;transform:translate(${mm(rect.width)},0mm) rotate(90deg)`;
    case 180:
      return `;transform:translate(${mm(rect.width)},${mm(rect.height)}) rotate(180deg)`;
    case 270:
      return `;transform:translate(0mm,${mm(rect.height)}) rotate(270deg)`;
  }
}

function contentHtml(element: LaidCanvasElement, dot: number, dpi: number, findings: Findings): string {
  const { content, frame } = element;
  switch (content.kind) {
    case 'text':
      return textHtml(content);
    case 'barcode':
      return barcodeHtml(element, content.element, content.value, dot, findings);
    case 'qr':
      return qrHtml(element.id, content.element, content.value, frame, dot, dpi, findings);
    case 'image':
      return imageHtml(element.id, content.element, frame, dot, findings);
    case 'line':
      return lineHtml(content.dashed, frame);
    case 'rect':
      return rectHtml(content, dot);
    case 'table':
      return tableHtml(content, frame, dot);
  }
}

function linesHtml(lines: readonly { text: string; fontSizeMm: number; bold: boolean }[]): string {
  return lines
    .map(
      (line) =>
        `<div class="line" style="font-size:${mm(line.fontSizeMm)};font-weight:${line.bold ? 700 : 400}">${escapeHtml(line.text)}</div>`,
    )
    .join('');
}

function textHtml(content: Extract<LaidCanvasContent, { kind: 'text' }>): string {
  const colors = content.inverse ? ';background:#000;color:#fff' : '';
  return `<div class="text text--${content.valign}" style="text-align:${content.align}${colors}">${linesHtml(content.lines)}</div>`;
}

function barcodeHtml(
  laid: LaidCanvasElement,
  element: CanvasBarcode,
  value: string,
  dot: number,
  findings: Findings,
): string {
  const { frame, name, rotation } = laid;
  const turned = rotation === 90 || rotation === 270;
  // 「现在多宽 / 多高」按元素框说（属性栏里填的数），不是取整到点之后的。
  const frameWidthNow = turned ? element.height : element.width;
  const frameHeightNow = turned ? element.width : element.height;
  const omit = (
    reason: string,
    short: string,
    minimum: { frameWidthMm: number | null; frameHeightMm: number | null } = {
      frameWidthMm: null,
      frameHeightMm: null,
    },
  ) => {
    findings.barcodeOmitted = true;
    report(findings, {
      elementId: laid.id,
      level: 'omitted',
      text: `条码「${name}」不印：${reason}`,
      short: `条码不印：${short}`,
      ...boxMinimum(rotation, minimum.frameWidthMm, minimum.frameHeightMm),
    });
    return '';
  };
  const result = encodeBarcode(element.symbology, value);
  if (!result.ok) {
    // detail 是 bwip-js 的原始英文错误，写诊断日志用；issues 里的中文 reason 已经够操作员看了，不重复堆原始信息。
    if (result.detail !== undefined) {
      findings.diagnostics.push(`${element.symbology}: ${result.detail}`);
    }
    // 画布上的短原因去掉码制名（「Code 128：」）：框里地方小，码制在属性栏里看得到。
    return omit(result.reason, result.reason.replace(/^[^：]*：/, ''));
  }
  const widthDots = Math.round(frame.width / dot);
  const heightDots = Math.round(frame.height / dot);
  const minDots = minModuleDots(dot);
  if (result.code.dimensions === 2) {
    const { cells, columns, rows, rowScale } = result.code;
    const quiet = matrixQuietZone(element.symbology);
    const across = moduleDotsFor(widthDots, columns + 2 * quiet, dot, CANVAS_MAX_MODULE_MM);
    const down = moduleDotsFor(heightDots, rows * rowScale + 2 * quiet, dot, CANVAS_MAX_MODULE_MM);
    if (across === null || down === null) {
      const frameWidthMm = minimumSizeMm(minDots * (columns + 2 * quiet), dot);
      const frameHeightMm = minimumSizeMm(minDots * (rows * rowScale + 2 * quiet), dot);
      const [needW, needH, nowW, nowH] = turned
        ? [frameHeightMm, frameWidthMm, frameHeightNow, frameWidthNow]
        : [frameWidthMm, frameHeightMm, frameWidthNow, frameHeightNow];
      return omit(
        `框太小：内容 ${quoteContent(value)} 至少要 ${formatMm(needW)}×${formatMm(needH)}mm（现在 ${formatMm(nowW)}×${formatMm(nowH)}mm）`,
        '框太小',
        { frameWidthMm, frameHeightMm },
      );
    }
    const moduleDots = Math.min(across, down);
    const width = columns * moduleDots;
    const height = rows * rowScale * moduleDots;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${rows * rowScale}" shape-rendering="crispEdges" style="width:${mm(width * dot)};height:${mm(height * dot)}"><path d="${matrixPath(cells, columns, rows, rowScale)}"/></svg>`;
    return `<div class="code" style="left:${mm(Math.floor((widthDots - width) / 2) * dot)};top:${mm(Math.floor((heightDots - height) / 2) * dot)}">${svg}</div>`;
  }
  const { widths, heights, offsets } = result.code;
  const modules = widths.reduce((sum, width) => sum + width, 0);
  const totalModules = modules + 2 * QUIET_ZONE_MODULES;
  const neededWidthDots = minDots * totalModules;
  const frameWidthMm = minimumSizeMm(neededWidthDots, dot);
  // 「宽」按元素框说：转过 90° 的条码，条码的长边是元素框的高。
  const sideName = turned ? '高' : '宽';
  const moduleDots = moduleDotsFor(widthDots, totalModules, dot, CANVAS_MAX_MODULE_MM);
  if (moduleDots === null) {
    return omit(
      `内容 ${quoteContent(value)} 至少要 ${formatMm(frameWidthMm)}mm ${sideName}（现在 ${formatMm(frameWidthNow)}mm）`,
      `框不够${sideName}`,
      { frameWidthMm, frameHeightMm: null },
    );
  }
  const textBlockMm = element.showText ? element.textSizeMm * LINE_HEIGHT + BARCODE_TEXT_GAP_MM : 0;
  const barHeightMm = frame.height - textBlockMm;
  if (barHeightMm < MIN_BAR_HEIGHT_MM) {
    const neededHeightDots = Math.ceil((MIN_BAR_HEIGHT_MM + textBlockMm) / dot - ROUNDING_EPSILON);
    return omit(`太矮（条高不到 ${MIN_BAR_HEIGHT_MM}mm）`, '太矮', {
      frameWidthMm: null,
      frameHeightMm: minimumSizeMm(neededHeightDots, dot),
    });
  }
  if (widthDots < neededWidthDots * TIGHT_WIDTH_RATIO) {
    // 印得出，但内容再长几位就印不出：只在设计器里提醒，不算打印问题（不进 issues、不写打印日志）。
    report(
      findings,
      {
        elementId: laid.id,
        level: 'warning',
        text: `条码「${name}」只比最小宽度宽一点：内容再长一些就印不出（至少要 ${formatMm(frameWidthMm)}mm ${sideName}）`,
        short: null,
        ...boxMinimum(rotation, frameWidthMm, null),
      },
      false,
    );
  }
  const barsDots = modules * moduleDots;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules} 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="width:${mm(barsDots * dot)};height:${mm(barHeightMm)}"><path d="${linearBarsPath(widths, false, heights, offsets)}"/></svg>`;
  let text = '';
  if (element.showText) {
    text = `<div class="code__text" style="font-size:${mm(element.textSizeMm)};margin-top:${mm(BARCODE_TEXT_GAP_MM)}">${escapeHtml(value)}</div>`;
    // 号码比条码的整个框还宽时，外层 .frame 会把超出的部分裁掉（frame 设了 overflow:hidden）——
    // 这确实是「已截断」，不是猜测，所以在这里报出来，并算进截断数（和面单的号码截断一个道理）。
    // frame.width 打 LINE_WIDTH_SLACK 的折扣：textWidthMm 是按未加粗的字宽表估算的，号码却总是加粗显示
    // （.code__text 的 font-weight: 700），加粗的字更宽，这 2% 的余量和面单折行用的是同一条规则。
    if (textWidthMm(value, element.textSizeMm) > frame.width * (1 - LINE_WIDTH_SLACK)) {
      findings.overflowCount += 1;
      report(findings, {
        elementId: laid.id,
        level: 'warning',
        text: `条码「${name}」下面的号码放不下，已截断`,
        short: null,
        minWidthMm: null,
        minHeightMm: null,
      });
    }
  }
  // 起点落在整数个点上（见面单 barcodeSvg 的说明）；.code 是 flex 列、居中对齐，号码比条码宽时两边对称溢出。
  return `<div class="code" style="left:${mm(Math.floor((widthDots - barsDots) / 2) * dot)};top:0;width:${mm(barsDots * dot)}">${svg}${text}</div>`;
}

function qrHtml(
  elementId: string,
  element: CanvasQr,
  value: string,
  frame: { width: number; height: number },
  dot: number,
  dpi: number,
  findings: Findings,
): string {
  const plan = planQr(
    value,
    element.errorCorrection,
    Math.min(frame.width, frame.height),
    dpi,
    CANVAS_QR_QUIET_ZONE_MODULES,
  );
  if (plan === null) {
    findings.qrOmitted = true;
    report(findings, {
      elementId,
      level: 'omitted',
      text: `二维码「${element.name}」不印：内容太长、框太小`,
      short: '二维码不印：内容太长、框太小',
      minWidthMm: null,
      minHeightMm: null,
    });
    return '';
  }
  const sizeDots = plan.moduleCount * plan.moduleDots;
  const left = Math.floor((Math.round(frame.width / dot) - sizeDots) / 2) * dot;
  const top = Math.floor((Math.round(frame.height / dot) - sizeDots) / 2) * dot;
  return `<div class="code" style="left:${mm(left)};top:${mm(top)};width:${mm(plan.sizeMm)};height:${mm(plan.sizeMm)}">${plan.svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
}

function imageHtml(
  elementId: string,
  element: CanvasImage,
  frame: { width: number; height: number },
  dot: number,
  findings: Findings,
): string {
  const gray = decodeGray(element.pixels, element.pixelWidth, element.pixelHeight);
  if (gray === null) {
    report(findings, {
      elementId,
      level: 'omitted',
      text: `图片「${element.name}」不印：数据坏了`,
      short: '图片不印：数据坏了',
      minWidthMm: null,
      minHeightMm: null,
    });
    return '';
  }
  const box = fitContain(gray.width, gray.height, Math.round(frame.width / dot), Math.round(frame.height / dot));
  const mono = toMono(resizeGray(gray, box.width, box.height), element.mode, element.threshold);
  const left = Math.floor((Math.round(frame.width / dot) - box.width) / 2) * dot;
  const top = Math.floor((Math.round(frame.height / dot) - box.height) / 2) * dot;
  // 1 位 BMP：大小有上限（约 宽×高/8 字节），抖动的照片画成 SVG 路径会到几 MB。每个像素正好一个打印点，pixelated 不做插值。
  return `<img class="dots" alt="" src="data:image/bmp;base64,${monoBmp(mono, box.width, box.height)}" style="left:${mm(left)};top:${mm(top)};width:${mm(box.width * dot)};height:${mm(box.height * dot)};image-rendering:pixelated" />`;
}

function lineHtml(dashed: boolean, frame: { width: number; height: number }): string {
  const horizontal = frame.width >= frame.height;
  const fill = dashed
    ? `repeating-linear-gradient(${horizontal ? 90 : 180}deg, #000 0 ${mm(DASH_MM)}, transparent ${mm(DASH_MM)} ${mm(DASH_MM + DASH_GAP_MM)})`
    : '#000';
  return `<div style="width:100%;height:100%;background:${fill}"></div>`;
}

function rectHtml(content: Extract<LaidCanvasContent, { kind: 'rect' }>, dot: number): string {
  const border = snapBorderDots(content.borderMm, dot) * dot;
  const style = [
    'width:100%',
    'height:100%',
    border > 0 ? `border:${mm(border)} solid #000` : '',
    content.filled ? 'background:#000' : '',
    content.radiusMm > 0 ? `border-radius:${mm(content.radiusMm)}` : '',
  ]
    .filter((part) => part !== '')
    .join(';');
  return `<div style="${style}"></div>`;
}

function tableHtml(
  content: Extract<LaidCanvasContent, { kind: 'table' }>,
  frame: { width: number; height: number },
  dot: number,
): string {
  // content.borderMm 在排版时已经按点取整过（layoutCanvas 的 layoutTable，用的是 snapBorderDots），
  // 这里直接拿来用、不重新调用 snapBorderDots，也不用 CELL_PADDING_MM 重新算内边距：两边各自算一遍，早晚会对不上。
  const border = content.borderMm;
  const borderDots = Math.round(border / dot);
  const { paddingMm } = content;
  const parts: string[] = [];
  let top = 0;
  content.rows.forEach((rowHeight, row) => {
    let left = 0;
    content.columns.forEach((columnWidth, column) => {
      const cell = content.cells[row]?.[column];
      if (cell && cell.lines.length > 0) {
        const width = Math.max(0, columnWidth - 2 * paddingMm.x);
        const height = Math.max(0, rowHeight - 2 * paddingMm.y);
        parts.push(
          `<div class="text text--middle" style="position:absolute;left:${mm(left + paddingMm.x)};top:${mm(top + paddingMm.y)};width:${mm(width)};height:${mm(height)};text-align:${cell.align}">${linesHtml(cell.lines)}</div>`,
        );
      }
      left += columnWidth;
    });
    top += rowHeight;
  });
  if (borderDots > 0) {
    // 外框画在框内侧；内部格线以格子边界为中心，和面单的线一样。半宽用整数个点算（不是毫米除法再取整），
    // 偶数个点时才能正好居中，不会因为浮点误差多偏一点点。
    const halfDots = Math.floor(borderDots / 2);
    const half = halfDots * dot;
    parts.push(`<div style="position:absolute;inset:0;border:${mm(border)} solid #000"></div>`);
    let y = 0;
    for (const rowHeight of content.rows.slice(0, -1)) {
      y += rowHeight;
      parts.push(
        `<div style="position:absolute;left:0;top:${mm(y - half)};width:${mm(frame.width)};height:${mm(border)};background:#000"></div>`,
      );
    }
    let x = 0;
    for (const columnWidth of content.columns.slice(0, -1)) {
      x += columnWidth;
      parts.push(
        `<div style="position:absolute;left:${mm(x - half)};top:0;width:${mm(border)};height:${mm(frame.height)};background:#000"></div>`,
      );
    }
  }
  return parts.join('');
}
