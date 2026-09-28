import { fieldValue, type ScanResult } from '../scan/scan-result';

/** 固定变量；另外 {任意字段名} 取本次识别到的同名字段。固定变量优先于同名字段。 */
export const NOTE_VARIABLES = ['{完整内容}', '{规则}', '{日期}', '{时间}'] as const;

/** 花括号里 1–20 个字符（与字段名长度上限一致），不含花括号和换行。 */
const VARIABLE_PATTERN = /\{([^{}\n]{1,20})\}/g;

/** 展开备注（和二维码文本）里的变量；本次没有识别到的字段名和未知变量原样保留。 */
export function expandNoteText(text: string, scan: ScanResult, printedAt: Date): string {
  return text.replace(VARIABLE_PATTERN, (match, name: string) => {
    switch (name) {
      case '完整内容':
        return scan.raw;
      case '规则':
        return scan.ruleName;
      case '日期':
        return formatDate(printedAt);
      case '时间':
        return formatTime(printedAt);
      default:
        return fieldValue(scan, name) ?? match;
    }
  });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地时间 YYYY-MM-DD。 */
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地时间 HH:mm。 */
function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
