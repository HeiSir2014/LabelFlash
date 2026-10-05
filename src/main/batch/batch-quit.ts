/**
 * 退出程序时批量打印还有没打到的标签：要不要弹确认、确认框的文字、以及把这些标签记成打印记录。
 * 不依赖 Electron（对话框、app.quit 在 src/main/index.ts 里调用），方便单测。
 */
import { templateFingerprint } from '../../core/api/template-fields';
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

/**
 * 退出确认之后：取消这一批、等正在打的那一张真的结束再记 CANCELED，但不无限等——防止一个卡住的
 * 驱动调用（打印机真的卡死）也让退出程序跟着卡住。等不到就放弃等待，照常继续退出；那一张万一真的
 * 之后才打完，它的记录会在进程已经退出之后才尝试写入，和别的来源异常退出时没写完的记录一样丢掉。
 */
export function waitForBatchIdle(whenIdle: () => Promise<void>, timeoutMs: number): Promise<void> {
  return Promise.race([whenIdle(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/**
 * 确认框的文字：只说程序确知的事——这些标签从来没交给过打印机，不是「打印失败」。措辞和打印记录里
 * 的说法一致（status-text.ts 的「退出时未打」）。批量打印页重启后不记得这一批了（状态只在内存里），
 * 不能说「去批量打印页重打」，要指到真的找得到的地方——打印记录按批次筛选、整批重打失败的。
 */
export function batchQuitDialogText(count: number): { message: string; detail: string } {
  return {
    message: `还有 ${count} 张批量打印的标签没有打印，现在退出吗？`,
    detail:
      '这些标签还没交给打印机。选「仍要退出」会把它们记到打印记录里，标成「退出时未打」，之后可以在打印记录里按批次筛选、整批重打。',
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
    templateFingerprint: templateFingerprint(template),
    fields: label.fields,
    batch: { id: batchId, row: label.row, copy: label.copy },
  }));
}
