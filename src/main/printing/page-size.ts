import type { PaperSize } from '../../shared/paper-sizes';

const MICRONS_PER_MM = 1_000;

/** webContents.print 的 pageSize 以微米为单位；取整：0.1mm 精度的纸张不会产生小数。 */
export function pageSizeMicrons(paper: PaperSize): { width: number; height: number } {
  return { width: Math.round(paper.widthMm * MICRONS_PER_MM), height: Math.round(paper.heightMm * MICRONS_PER_MM) };
}
