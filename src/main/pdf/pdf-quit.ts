/**
 * 退出程序、重启更新时 PDF 还有没打的：确认框的文字、拒绝更新的说明、把没打的记成打印记录。
 * 和 batch/batch-quit.ts 是同一套做法；不依赖 Electron（对话框、app.quit 在 src/main/index.ts 里调用），方便单测。
 */
import { PDF_PIECE_TEMPLATE_ID } from '../../core/pdf/pdf-model';
import type { JobRecord } from '../../core/types';
import { paperKey } from '../../shared/paper-sizes';
import { batchQuitDialogText } from '../batch/batch-quit';
import type { PdfPendingLabel } from './pdf-station';

/** 点「重启更新」时 PDF 还在打或暂停中：和批量打印一样直接拒绝（quitAndInstall 不给弹确认的机会）。 */
export const PDF_BLOCKS_UPDATE_ISSUE = 'PDF 还没打完：请先打完，或点「取消」，再重启更新';

/**
 * 退出确认框的文字：只说程序确知的事——这些标签从来没交给过打印机。PDF 的记录带着缓存位图的编号，
 * 7 天内能从打印记录逐张重打（PDF 没有批次，不说「按批次筛选」）。批量打印和 PDF 都有没打的时一起说。
 */
export function quitDialogText(batchCount: number, pdfCount: number): { message: string; detail: string } {
  if (pdfCount === 0) {
    return batchQuitDialogText(batchCount);
  }
  if (batchCount === 0) {
    return {
      message: `还有 ${pdfCount} 张 PDF 的标签没有打印，现在退出吗？`,
      detail:
        '这些标签还没交给打印机。选「仍要退出」会把它们记到打印记录里，标成「退出时未打」，7 天内可以在打印记录里逐张重打。',
    };
  }
  return {
    message: `还有 ${batchCount} 张批量打印、${pdfCount} 张 PDF 的标签没有打印，现在退出吗？`,
    detail:
      '这些标签还没交给打印机。选「仍要退出」会把它们记到打印记录里，标成「退出时未打」：批量打印的可以按批次筛选、整批重打，PDF 的 7 天内可以逐张重打。',
  };
}

/** 把还没打的 PDF 块记成打印记录：failureReason 是 CANCELED（从来没交给过打印机），带着位图编号以便重打。 */
export function canceledPdfJobRecords(
  labels: readonly PdfPendingLabel[],
  createId: () => string,
  now: () => number,
): JobRecord[] {
  return labels.map((label) => ({
    id: createId(),
    createdAt: now(),
    raw: label.content,
    printerName: '',
    source: 'pdf',
    status: 'failed',
    forced: false,
    failureReason: 'CANCELED',
    paper: paperKey(label.paper),
    templateId: PDF_PIECE_TEMPLATE_ID,
    fields: label.fields,
    pdf: label.pdf,
  }));
}
