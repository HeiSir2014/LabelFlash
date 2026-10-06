import type { PaperSize } from '../../shared/paper-sizes';
import type { CropMode } from '../pdf/pdf-model';
import { pieceFields } from '../pdf/piece-template';
import type { ScanField } from '../scan/scan-result';
import type { IppRef } from '../types';

/**
 * 页面和纸的长、宽都差在 3mm 以内（正着或转 90°）就算「客户端已经按这张纸排好了」：
 * 驱动纸张按 0.1mm 存、PDF 的点换算成毫米有零点几毫米的误差，3mm 足够吸收，又远小于标签和 A4 的差别。
 */
export const SAME_PAPER_TOLERANCE_MM = 3;

/**
 * 收到的一页怎么放到纸上：已经是这张纸的大小就整页缩放（保留客户端的排版）；
 * 不是（A4 上的一张面单、截图、照片，page 为 null 表示不知道实际尺寸）就去掉四周空白再缩放。
 */
export function chooseIppCrop(page: PaperSize | null, paper: PaperSize): Extract<CropMode, 'page' | 'trim'> {
  if (page === null) {
    return 'trim';
  }
  const isClose = (a: number, b: number) => Math.abs(a - b) <= SAME_PAPER_TOLERANCE_MM;
  const straight = isClose(page.widthMm, paper.widthMm) && isClose(page.heightMm, paper.heightMm);
  const turned = isClose(page.widthMm, paper.heightMm) && isClose(page.heightMm, paper.widthMm);
  return straight || turned ? 'page' : 'trim';
}

/**
 * 打印记录和打印结果通知里的字段：PDF 那三项（文件、页码、第几张），加上电脑和用户。
 * 用户名是对方自己报的、不经核对，叫「自称用户」；能核对的只有电脑地址。
 */
export function ippFields(jobName: string, page: number, piece: number, share: IppRef): ScanField[] {
  const fields = [...pieceFields(jobName, page, piece), { name: '电脑', value: share.client }];
  return share.user === '' ? fields : [...fields, { name: '自称用户', value: share.user }];
}
