/**
 * 退出程序时批量打印还有没打到的标签：要不要弹确认、确认框的文字、以及把这些标签记成打印记录。
 * 不依赖 Electron（对话框、app.quit 在 src/main/index.ts 里调用），方便单测。
 */
import type { BatchLabel } from '../../core/batch/batch-model';
import type { LabelTemplate } from '../../core/templates/template-model';
import type { JobRecord } from '../../core/types';
import { paperKey } from '../../shared/paper-sizes';

/**
 * 要不要弹确认：还有没打到的标签，而且不是系统正在关机、注销（关机时不能挡着，Windows 的
 * session-end 本来就不会走到这里，这里主要防 macOS/Linux 的 before-quit 在关机时也会触发）。
 */
export function shouldConfirmBatchQuit(pendingLabels: number, isSystemShutdown: boolean): boolean {
  return pendingLabels > 0 && !isSystemShutdown;
}

/** 确认框的文字：只说程序确知的事——这些标签从来没交给过打印机，不是「打印失败」。 */
export function batchQuitDialogText(count: number): { message: string; detail: string } {
  return {
    message: `还有 ${count} 张批量打印的标签没有打印，现在退出吗？`,
    detail:
      '这些标签还没交给打印机。选「仍要退出」会把它们记到打印记录里，标成「退出时没打到」，之后可以在批量打印页或打印记录里重打。',
  };
}

/**
 * 把还没打到的标签记成打印记录：failureReason 固定是 CANCELED（批量打印专用，表示从来没交给过打印机）。
 * createId、now 和 SqliteJobStore.append 用的是同一套依赖，调用方（index.ts）传真实实现，测试传假的。
 */
export function canceledJobRecords(
  batchId: string,
  template: LabelTemplate,
  labels: readonly BatchLabel[],
  createId: () => string,
  now: () => number,
): JobRecord[] {
  return labels.map((label) => ({
    id: createId(),
    createdAt: now(),
    raw: label.content,
    printerName: '',
    source: 'batch',
    status: 'failed',
    forced: false,
    failureReason: 'CANCELED',
    paper: paperKey(template.paper),
    templateId: template.id,
    fields: label.fields,
    batch: { id: batchId, row: label.row, copy: label.copy },
  }));
}
