import { bottomText, type FieldRow, joinLines, resolveFields, resolveQrText } from '../../core/templates/label-content';
import { expandNoteText } from '../../core/templates/note-text';
import {
  type FieldArrangement,
  fullTextWidthMm,
  LAYOUT_GAP_MM,
  type QrLabelTemplate,
  sideTextWidthMm,
  type TextAlign,
  type TextStyle,
} from '../../core/templates/template-model';
import {
  fitFontSizeMm,
  fitRowFontSizes,
  LINE_HEIGHT,
  roundDownFontSizeMm,
  STACKED_PREFIX_SCALE,
  textHeightMm,
} from '../../core/templates/text-fit';
import type { LabelJob } from '../../core/types';
import { NO_RENDER_WARNINGS, type RenderWarnings } from '../../shared/render-warnings';
import { renderCanvasHtml } from './canvas-html';
import { escapeHtml, mm } from './html-text';
import { DEFAULT_PRINTER_DPI, planQr } from './qr-code';
import { renderWaybillHtml } from './waybill-html';

export { escapeHtml } from './html-text';

/** 底部整行和备注允许占用的最多行数；超出时自动缩小字号，保证不被标签边缘裁掉。 */
const MAX_LINES = { bottom: 3, noteBeside: 3, noteBottom: 2 } as const;

/** 标签 HTML 和生成时发现的问题（标签模板只会有「二维码放不下」）。 */
export interface RenderedLabel extends RenderWarnings {
  html: string;
}

interface Paragraph {
  text: string;
  style: TextStyle;
  fontSizeMm: number;
  heightMm: number;
}

interface FittedRow extends FieldRow {
  fontSizeMm: number;
}

/**
 * 按模板的纸张生成标签 HTML：预览和打印共用同一份输出。dpi 是打印机的分辨率，二维码按它对齐打印点。
 * 排版顺序：先定底部（底部整行、底部备注），剩下的高度给二维码旁的字段区和旁侧备注；
 * 横向排列时字段是「前缀列 + 值列」的网格，无论前缀长短、字号大小，同一列的值始终对齐。
 * 文本全部转义，样式值只来自已校验的模板。
 */
export function renderLabelHtml(job: LabelJob, dpi: number = DEFAULT_PRINTER_DPI): RenderedLabel {
  const { template } = job;
  if (template.kind === 'canvas') {
    return renderCanvasHtml({ ...job, template }, dpi);
  }
  if (template.kind === 'waybill') {
    return renderWaybillHtml({ ...job, template }, dpi);
  }
  return { ...NO_RENDER_WARNINGS, ...renderQrLabel({ ...job, template }, dpi) };
}

function renderQrLabel(
  job: LabelJob & { template: QrLabelTemplate },
  dpi: number,
): Pick<RenderedLabel, 'html' | 'qrOmitted'> {
  const { scan, template } = job;
  const printedAt = new Date(job.printedAt);
  const { widthMm: width, heightMm: height } = template.paper;
  const qr = template.qr.visible
    ? planQr(resolveQrText(template, scan, printedAt), template.qr.errorCorrection, template.qr.sizeMm, dpi)
    : null;
  const sideWidthMm = sideTextWidthMm(template);
  const fullWidthMm = fullTextWidthMm(template);

  const isNoteBesideQr = template.note.placement === 'beside-qr';
  const noteText = expandNoteText(template.note.text, scan, printedAt);
  const note =
    template.note.visible && noteText.trim() !== ''
      ? fitParagraph(
          template.note,
          noteText,
          isNoteBesideQr ? sideWidthMm : fullWidthMm,
          isNoteBesideQr ? MAX_LINES.noteBeside : MAX_LINES.noteBottom,
        )
      : null;
  const bottomLineText = template.bottom.visible ? bottomText(scan) : null;
  const bottomLine =
    bottomLineText === null ? null : fitParagraph(template.bottom, bottomLineText, fullWidthMm, MAX_LINES.bottom);
  const bottomParagraphs = [bottomLine, isNoteBesideQr ? null : note].filter((p): p is Paragraph => p !== null);

  const mainHeightMm =
    height - 2 * template.paddingMm - bottomParagraphs.reduce((sum, p) => sum + p.heightMm + LAYOUT_GAP_MM, 0);
  const { arrangement } = template.fieldsArea;
  const fields = resolveFields(template, scan);
  const rows = fitRows(
    fields.rows,
    sideWidthMm,
    mainHeightMm - (isNoteBesideQr && note ? note.heightMm : 0),
    arrangement,
    fields.isAllFields,
  );
  const noteHtml = (align: TextAlign) => (note ? paragraphHtml('note', note, align) : '');
  const qrHtml = qr
    ? `<div class="qr"><div class="qr__code" style="width:${mm(qr.sizeMm)};height:${mm(qr.sizeMm)}">${qr.svg}</div></div>`
    : '';

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(joinLines(scan.raw))}</title>
<style>
  @page { size: ${mm(width)} ${mm(height)}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${mm(width)}; height: ${mm(height)}; overflow: hidden; background: #fff; color: #000; }
  body {
    display: flex; flex-direction: column; gap: ${mm(LAYOUT_GAP_MM)}; padding: ${mm(template.paddingMm)};
    font-family: "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif;
  }
  .main { display: flex; flex: 1 1 auto; gap: ${mm(LAYOUT_GAP_MM)}; min-height: 0; }
  .layout-qr-right .main { flex-direction: row-reverse; }
  .qr {
    display: flex; flex: none; align-items: center; justify-content: center;
    width: ${mm(template.qr.sizeMm)}; height: ${mm(template.qr.sizeMm)};
  }
  .qr__code svg { display: block; width: 100%; height: 100%; }
  .side { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
  .fields { display: grid; flex: 1 1 auto; align-content: space-evenly; }
  .fields--inline { grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; }
  .fields--stacked { grid-template-columns: minmax(0, 1fr); }
  .prefix { white-space: nowrap; }
  .field > span { display: block; }
  .fields--stacked .prefix { white-space: normal; }
  .bottom { display: flex; flex: none; flex-direction: column; }
  p, span { line-height: ${LINE_HEIGHT}; word-break: break-all; }
  .value, .note { white-space: pre-line; }
</style>
</head>
<body class="layout-${template.layout}">
  <div class="main">
    ${qrHtml}
    <div class="side">
      <div class="fields fields--${arrangement}">${rows.map((row) => fieldHtml(row, arrangement, template.sideAlign)).join('')}</div>
      ${isNoteBesideQr ? noteHtml(template.sideAlign) : ''}
    </div>
  </div>
  <div class="bottom">${bottomLine ? paragraphHtml('bottom-line', bottomLine, template.bottomAlign) : ''}${
    isNoteBesideQr ? '' : noteHtml(template.bottomAlign)
  }</div>
</body>
</html>`;
  return { html, qrOmitted: template.qr.visible && qr === null };
}

function fitParagraph(style: TextStyle, text: string, widthMm: number, maxLines: number): Paragraph {
  const fontSizeMm = fitFontSizeMm(text, style.fontSizeMm, widthMm, maxLines);
  return { text, style, fontSizeMm, heightMm: textHeightMm(text, fontSizeMm, widthMm) };
}

function fitRows(
  rows: readonly FieldRow[],
  widthMm: number,
  heightMm: number,
  arrangement: FieldArrangement,
  uniform: boolean,
): FittedRow[] {
  const sizes = fitRowFontSizes(
    rows.map((row) => ({ prefix: row.prefix, value: row.value, fontSizeMm: row.style.fontSizeMm })),
    widthMm,
    heightMm,
    { arrangement, uniform },
  );
  return rows.map((row, index) => ({ ...row, fontSizeMm: sizes[index] ?? row.style.fontSizeMm }));
}

/**
 * 横向：前缀一格、值一格，占网格一行。
 * 垂直：前缀单独一行（小一号、不加粗），值在下一行；没有前缀时只有值。
 */
function fieldHtml(row: FittedRow, arrangement: FieldArrangement, align: TextAlign): string {
  const font = fontCss(row.style, row.fontSizeMm);
  const value = `<span class="value" style="${font};text-align:${align}">${escapeHtml(row.value)}</span>`;
  if (arrangement === 'inline') {
    return `<span class="prefix" style="${font}">${escapeHtml(row.prefix)}</span>${value}`;
  }
  if (row.prefix === '') {
    return `<div class="field">${value}</div>`;
  }
  const prefixFont = fontCss({ ...row.style, bold: false }, roundDownFontSizeMm(row.fontSizeMm * STACKED_PREFIX_SCALE));
  const prefix = `<span class="prefix" style="${prefixFont};text-align:${align}">${escapeHtml(row.prefix)}</span>`;
  return `<div class="field">${prefix}${value}</div>`;
}

function paragraphHtml(className: string, paragraph: Paragraph, align: TextAlign): string {
  const font = fontCss(paragraph.style, paragraph.fontSizeMm);
  return `<p class="${className}" style="${font};text-align:${align}">${escapeHtml(paragraph.text)}</p>`;
}

function fontCss(style: TextStyle, fontSizeMm: number): string {
  return `font-size:${mm(fontSizeMm)};font-weight:${style.bold ? 700 : 400}`;
}
