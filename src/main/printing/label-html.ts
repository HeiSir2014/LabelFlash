import QRCode from 'qrcode';
import { expandNoteText } from '../../core/templates/note-text';
import {
  type FieldConfig,
  fullTextWidthMm,
  LAYOUT_GAP_MM,
  type LabelTemplate,
  SIDE_FIELD_KEYS,
  sideTextWidthMm,
  type TextAlign,
  type TextStyle,
} from '../../core/templates/template-model';
import { fitFontSizeMm } from '../../core/templates/text-fit';
import type { LabelData, LabelJob } from '../../core/types';
import { LABEL_PAPER_MM } from '../../shared/label-paper';

const LINE_HEIGHT = 1.2;
/** 每种文本允许占用的最多行数；超出时自动缩小字号，保证不被标签边缘裁掉。 */
const MAX_LINES = { sideField: 2, raw: 3, noteBeside: 3, noteBottom: 2 } as const;

/**
 * 由模板生成 60×40mm 标签 HTML：预览和打印共用同一份输出。
 * 二维码旁的字段是「前缀列 + 值列」的网格：无论前缀长短、字号大小，同一列的值始终对齐。
 * 文本全部转义，样式值只来自已校验的模板。
 */
export async function renderLabelHtml(job: LabelJob): Promise<string> {
  const { label, template } = job;
  const { width, height } = LABEL_PAPER_MM;
  const qrSvg = template.qr.visible
    ? await QRCode.toString(label.raw, { type: 'svg', errorCorrectionLevel: template.qr.errorCorrection, margin: 0 })
    : '';
  const isNoteBesideQr = template.note.placement === 'beside-qr';
  const noteText = expandNoteText(template.note.text, label, new Date(job.printedAt));
  const hasNote = template.note.visible && noteText.trim() !== '';
  const note = hasNote
    ? paragraph(
        'note',
        template.note,
        isNoteBesideQr ? template.sideAlign : template.bottomAlign,
        noteText,
        isNoteBesideQr ? sideTextWidthMm(template) : fullTextWidthMm(template),
        isNoteBesideQr ? MAX_LINES.noteBeside : MAX_LINES.noteBottom,
      )
    : '';
  const raw = template.fields.raw;
  const rawField = raw.visible
    ? paragraph(
        'field field-raw',
        raw,
        template.bottomAlign,
        `${raw.prefix}${label.raw}`,
        fullTextWidthMm(template),
        MAX_LINES.raw,
      )
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(label.raw)}</title>
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
  .qr { flex: none; width: ${mm(template.qr.sizeMm)}; height: ${mm(template.qr.sizeMm)}; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .side { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
  .fields {
    display: grid; flex: 1 1 auto; grid-template-columns: max-content minmax(0, 1fr);
    align-content: space-evenly; align-items: baseline;
  }
  .prefix { white-space: nowrap; }
  .bottom { display: flex; flex: none; flex-direction: column; }
  p, span { line-height: ${LINE_HEIGHT}; word-break: break-all; }
  .note { white-space: pre-line; }
</style>
</head>
<body class="layout-${template.layout}">
  <div class="main">
    ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
    <div class="side">
      <div class="fields">${sideFieldRows(template, label)}</div>
      ${isNoteBesideQr ? note : ''}
    </div>
  </div>
  <div class="bottom">${rawField}${isNoteBesideQr ? '' : note}</div>
</body>
</html>`;
}

/** 二维码旁的每个字段占网格一行：前缀一格、值一格；字号按整行（前缀 + 值）适配。 */
function sideFieldRows(template: LabelTemplate, label: LabelData): string {
  const widthMm = sideTextWidthMm(template);
  return SIDE_FIELD_KEYS.filter((key) => template.fields[key].visible)
    .map((key) => {
      const field: FieldConfig = template.fields[key];
      const value = label[key];
      const fontSizeMm = fitFontSizeMm(`${field.prefix}${value}`, field.fontSizeMm, widthMm, MAX_LINES.sideField);
      const font = fontCss(field, fontSizeMm);
      return (
        `<span class="prefix prefix-${key}" style="${font}">${escapeHtml(field.prefix)}</span>` +
        `<span class="value value-${key}" style="${font};text-align:${template.sideAlign}">${escapeHtml(value)}</span>`
      );
    })
    .join('');
}

function paragraph(
  className: string,
  style: TextStyle,
  align: TextAlign,
  text: string,
  widthMm: number,
  maxLines: number,
): string {
  const fontSizeMm = fitFontSizeMm(text, style.fontSizeMm, widthMm, maxLines);
  return `<p class="${className}" style="${fontCss(style, fontSizeMm)};text-align:${align}">${escapeHtml(text)}</p>`;
}

function fontCss(style: TextStyle, fontSizeMm: number): string {
  return `font-size:${mm(fontSizeMm)};font-weight:${style.bold ? 700 : 400}`;
}

function mm(value: number): string {
  return `${Number(value.toFixed(2))}mm`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
