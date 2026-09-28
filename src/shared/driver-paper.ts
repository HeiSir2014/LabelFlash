import { LABEL_PAPER_MM } from './label-paper';

/**
 * 打印机驱动的默认纸张。热敏标签机驱动的出厂默认纸张通常不是 60×40，
 * 而 Chromium 传入的自定义纸张尺寸有的驱动会忽略，结果是缩放、跳纸或出空白标签。
 */
export interface DriverPaper {
  widthMm: number;
  heightMm: number;
  /** 驱动报告的打印分辨率；读不到时为 null。 */
  dpi: number | null;
}

/** 驱动以 0.1mm 为单位保存纸张尺寸，四舍五入后可能差零点几毫米。 */
export const PAPER_TOLERANCE_MM = 1;

/** unknown = 读不到（非 Windows、查询失败或驱动没有报告）：不提示，也不阻止打印。 */
export type PaperCheck =
  | { status: 'unknown' }
  | { status: 'ok'; paper: DriverPaper }
  | { status: 'mismatch'; paper: DriverPaper };

export function checkDriverPaper(paper: DriverPaper | null): PaperCheck {
  if (paper === null) {
    return { status: 'unknown' };
  }
  const isMatch =
    Math.abs(paper.widthMm - LABEL_PAPER_MM.width) <= PAPER_TOLERANCE_MM &&
    Math.abs(paper.heightMm - LABEL_PAPER_MM.height) <= PAPER_TOLERANCE_MM;
  return { status: isMatch ? 'ok' : 'mismatch', paper };
}

/** 例如 76×130mm、60×40mm（保留最多一位小数）。 */
export function formatPaperSize(paper: Pick<DriverPaper, 'widthMm' | 'heightMm'>): string {
  const format = (mm: number) => String(Math.round(mm * 10) / 10);
  return `${format(paper.widthMm)}×${format(paper.heightMm)}mm`;
}
