import type { LabelData } from '../types';

/** 备注支持的变量（中文名，方便操作员记忆）。未知变量原样保留。 */
export const NOTE_VARIABLES = ['{编码}', '{颜色}', '{尺码}', '{完整编码}', '{日期}', '{时间}'] as const;

const VARIABLE_PATTERN = /\{(编码|颜色|尺码|完整编码|日期|时间)\}/g;

export function expandNoteText(text: string, label: LabelData, printedAt: Date): string {
  return text.replace(VARIABLE_PATTERN, (_, name: string) => {
    switch (name) {
      case '编码':
        return label.code;
      case '颜色':
        return label.color;
      case '尺码':
        return label.size;
      case '完整编码':
        return label.raw;
      case '日期':
        return formatDate(printedAt);
      default:
        return formatTime(printedAt);
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
