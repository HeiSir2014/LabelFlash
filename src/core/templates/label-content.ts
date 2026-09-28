import { fieldValue, type ScanResult } from '../scan/scan-result';
import { expandNoteText } from './note-text';
import { type LabelTemplate, TEMPLATE_LIMITS, type TextStyle } from './template-model';

/** 字段区的一行：前缀一列、值一列。值可能有多行。 */
export interface FieldRow {
  prefix: string;
  value: string;
  style: TextStyle;
}

const LINE_JOINER = ' / ';

export interface ResolvedFields {
  rows: FieldRow[];
  /** 实际按「全部字段」显示（包括「指定字段」一个都没识别到时的退回）：所有行共用一种样式，排版时统一字号。 */
  isAllFields: boolean;
}

/**
 * 二维码旁要显示的字段行。
 * 「指定字段」只显示本次识别到的字段；一个都没识别到时按「全部字段」显示，标签不会空白。
 */
export function resolveFields(template: LabelTemplate, scan: ScanResult): ResolvedFields {
  const { mode, slots } = template.fieldsArea;
  if (mode === 'pick') {
    const rows = slots.flatMap((slot) => {
      const value = fieldValue(scan, slot.field);
      return value === undefined || value === '' ? [] : [{ prefix: slot.prefix, value, style: slot }];
    });
    if (rows.length > 0) {
      return { rows, isAllFields: false };
    }
  }
  return { rows: allFieldRows(template, scan), isAllFields: true };
}

/** 按识别顺序列出全部字段，最多 6 行；放不下时最后一行写「…等 N 项」。 */
function allFieldRows(template: LabelTemplate, scan: ScanResult): FieldRow[] {
  const { all } = template.fieldsArea;
  const style: TextStyle = { fontSizeMm: all.fontSizeMm, bold: all.bold };
  // 空值（例如查找表没查到）不占一行。
  const rows = scan.fields
    .filter((field) => field.value !== '')
    .map((field) => ({
      prefix: all.showNames ? `${field.name}${all.separator}` : '',
      value: field.value,
      style,
    }));
  const maxRows = TEMPLATE_LIMITS.allFieldRows;
  if (rows.length <= maxRows) {
    return rows;
  }
  const shown = rows.slice(0, maxRows - 1);
  return [...shown, { prefix: '', value: `…等 ${rows.length - shown.length} 项`, style }];
}

/** 二维码内容；字段没识别到、文本展开后为空时，退回原始内容。 */
export function resolveQrText(template: LabelTemplate, scan: ScanResult, printedAt: Date): string {
  const { content } = template.qr;
  switch (content.kind) {
    case 'raw':
      return scan.raw;
    case 'field':
      return fieldValue(scan, content.field) || scan.raw;
    case 'text':
      return expandNoteText(content.text, scan, printedAt).trim() || scan.raw;
  }
}

/**
 * 底部整行的文字：完整内容，多行用「 / 」连起来。
 * 只有一个字段、且它的值就是完整内容时（例如纯数字订单号）返回 null，避免同一段内容印两遍。
 */
export function bottomText(scan: ScanResult): string | null {
  const [only, ...rest] = scan.fields;
  if (only !== undefined && rest.length === 0 && only.value === scan.raw) {
    return null;
  }
  return joinLines(scan.raw);
}

/** 多行文字合成一行（去掉空行）：底部整行、打印任务名都用它。 */
export function joinLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(LINE_JOINER);
}
