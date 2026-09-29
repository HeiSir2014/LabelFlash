import type { PrinterReadiness } from './printer-readiness';

/** 一台被分配到的打印机（纸张分配或模板指定里出现的）。 */
export interface PrinterSummaryInput {
  /** 显示用的名字。 */
  name: string;
  /** 系统打印机列表里有没有它（拔掉、删掉的打印机仍可能留在分配里）。 */
  isListed: boolean;
  /** null = 未知（尚未查询、查询失败或 macOS）。 */
  readiness: PrinterReadiness | null;
}

export type PrinterSummaryTone = 'ready' | 'unknown' | 'error' | 'muted';

export interface PrinterSummaryView {
  tone: PrinterSummaryTone;
  text: string;
}

/** 标题栏的打印机胶囊：都就绪时说几台，有问题时说出第一台的问题（和原来单台时的写法一致）。 */
export function describePrintersSummary(printers: readonly PrinterSummaryInput[]): PrinterSummaryView {
  const [only] = printers;
  if (!only) {
    return { tone: 'muted', text: '还没有分配打印机' };
  }
  for (const { name, isListed, readiness } of printers) {
    if (!isListed) {
      return { tone: 'error', text: `${name}（系统里找不到）` };
    }
    if (readiness !== null && !readiness.ready) {
      return { tone: 'error', text: `${name}（${readiness.detail}）` };
    }
  }
  const isKnown = printers.every((printer) => printer.readiness !== null);
  if (printers.length === 1) {
    return isKnown ? { tone: 'ready', text: `${only.name} · 就绪` } : { tone: 'unknown', text: only.name };
  }
  return { tone: isKnown ? 'ready' : 'unknown', text: `打印机 ${printers.length} 台${isKnown ? '就绪' : ''}` };
}

/**
 * 手机顶部「打印机：」后面的文字；没有分配打印机时为 null（手机按原来的「没有打印机」显示）。
 * 只说名字或台数，不说「就绪」：这段文字只在手机加入和分配变化时推送，状态变了手机上不会跟着变。
 */
export function phonePrinterLabel(printers: readonly PrinterSummaryInput[]): string | null {
  const [only] = printers;
  if (!only) {
    return null;
  }
  return printers.length === 1 ? only.name : `${printers.length} 台`;
}
