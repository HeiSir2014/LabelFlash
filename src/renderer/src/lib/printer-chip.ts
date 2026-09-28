import type { PrinterReadiness } from '../../../shared/printer-readiness';

export type PrinterChipTone = 'ready' | 'unknown' | 'error' | 'muted';

export interface PrinterChipView {
  tone: PrinterChipTone;
  text: string;
}

export interface PrinterChipInput {
  printerName: string | null;
  isLoading: boolean;
  isListed: boolean;
  readiness: PrinterReadiness | null;
}

/** 标题栏里当前打印机的状态胶囊。 */
export function describePrinterChip({
  printerName,
  isLoading,
  isListed,
  readiness,
}: PrinterChipInput): PrinterChipView {
  if (printerName === null) {
    return { tone: 'muted', text: '未选择打印机' };
  }
  if (!isListed) {
    return isLoading
      ? { tone: 'muted', text: `${printerName}（读取中…）` }
      : { tone: 'error', text: `${printerName}（系统里找不到）` };
  }
  if (readiness === null) {
    return { tone: 'unknown', text: printerName };
  }
  return readiness.ready
    ? { tone: 'ready', text: `${printerName} · 就绪` }
    : { tone: 'error', text: `${printerName}（${readiness.detail}）` };
}
