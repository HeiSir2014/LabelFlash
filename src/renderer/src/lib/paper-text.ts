import { formatPaperSize, type PaperCheck } from '../../../shared/driver-paper';
import { LABEL_PAPER_MM } from '../../../shared/label-paper';

export interface PaperCheckView {
  tone: 'ok' | 'warning';
  text: string;
}

const LABEL_SIZE_TEXT = formatPaperSize({ widthMm: LABEL_PAPER_MM.width, heightMm: LABEL_PAPER_MM.height });

/** 当前打印机的驱动纸张说明；读不到时不显示（null）。 */
export function describePaperCheck(check: PaperCheck | null): PaperCheckView | null {
  if (check === null || check.status === 'unknown') {
    return null;
  }
  const { paper } = check;
  if (check.status === 'ok') {
    const dpi = paper.dpi === null ? '' : ` · ${paper.dpi}dpi`;
    return { tone: 'ok', text: `驱动纸张 ${formatPaperSize(paper)}${dpi}` };
  }
  return {
    tone: 'warning',
    text: `驱动默认纸张是 ${formatPaperSize(paper)}，不是 ${LABEL_SIZE_TEXT}，打印会被缩放、跳纸或出空白标签。请在打印首选项里把纸张设为 ${LABEL_SIZE_TEXT}，纸张类型选间隙纸。`,
  };
}
