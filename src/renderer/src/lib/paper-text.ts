import { formatPaperSize, type PaperCheck } from '../../../shared/driver-paper';
import type { PaperSize } from '../../../shared/paper-sizes';

export interface PaperCheckView {
  tone: 'ok' | 'warning';
  text: string;
}

/**
 * 一台打印机的驱动纸张说明；读不到时不显示（null）。
 * expected 是这台打印机负责的纸：对不上时提醒怎么改；没有负责任何纸（null）时只说驱动纸张。
 */
export function describePaperCheck(check: PaperCheck | null, expected: PaperSize | null): PaperCheckView | null {
  if (check === null || check.status === 'unknown') {
    return null;
  }
  const { paper } = check;
  if (check.status === 'ok' || expected === null) {
    const dpi = paper.dpi === null ? '' : ` · ${paper.dpi}dpi`;
    return { tone: 'ok', text: `驱动纸张 ${formatPaperSize(paper)}${dpi}` };
  }
  const size = formatPaperSize(expected);
  return {
    tone: 'warning',
    text: `驱动默认纸张是 ${formatPaperSize(paper)}，不是 ${size}，打印会被缩放、跳纸或出空白标签。请在打印首选项里把纸张设为 ${size}，纸张类型选间隙纸。`,
  };
}
