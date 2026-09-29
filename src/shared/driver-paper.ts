import { DEFAULT_PAPER } from './label-paper';
import { isSamePaper, type PaperSize } from './paper-sizes';

/**
 * 打印机驱动的默认纸张。热敏标签机驱动的出厂默认纸张通常不是模板用的纸，
 * 而 Chromium 传入的自定义纸张尺寸有的驱动会忽略，结果是缩放、跳纸或出空白标签。
 */
export interface DriverPaper {
  widthMm: number;
  heightMm: number;
  /** 驱动报告的打印分辨率；读不到时为 null。 */
  dpi: number | null;
}

/** unknown = 读不到（非 Windows、查询失败或驱动没有报告）：不提示，也不阻止打印。 */
export type PaperCheck =
  | { status: 'unknown' }
  | { status: 'ok'; paper: DriverPaper }
  | { status: 'mismatch'; paper: DriverPaper };

/** 驱动纸张和这台打印机应该装的纸（expected）比较；尺寸差在 1mm 以内算同一种纸。 */
export function checkDriverPaper(paper: DriverPaper | null, expected: PaperSize = DEFAULT_PAPER): PaperCheck {
  if (paper === null) {
    return { status: 'unknown' };
  }
  return { status: isSamePaper(paper, expected) ? 'ok' : 'mismatch', paper };
}

/** 例如 76×130mm、60×40mm（保留最多一位小数）。 */
export function formatPaperSize(paper: Pick<DriverPaper, 'widthMm' | 'heightMm'>): string {
  const format = (mm: number) => String(Math.round(mm * 10) / 10);
  return `${format(paper.widthMm)}×${format(paper.heightMm)}mm`;
}
