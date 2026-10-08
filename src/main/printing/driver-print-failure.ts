import { PrintError } from '../../core/errors';

/** Chromium 在打印任务被取消时给出的原因（webContents.print 回调的 failureReason）。 */
const CANCELED_FAILURE_REASON = 'Print job canceled';

/**
 * 任务被取消时给操作员看的说明。例如虚拟 PDF 打印机弹出的「保存」对话框被关掉：没有出纸，但打印机没有坏，
 * 说「驱动报错，检查打印机状态」会让人去查一台好好的打印机。
 */
export const PRINT_CANCELED_DETAIL = '打印被取消了，没有出纸（例如关掉了虚拟打印机保存文件的对话框），需要时重试';

/**
 * webContents.print 失败时交给 PrintService 的错误：失败原因一律是 PRINT_ERROR（打印记录里的分类不变），
 * 原始原因留在 message 里写日志；认得出是被取消的，带上给操作员看的说明。
 */
export function driverPrintError(failureReason: string): PrintError {
  return failureReason === CANCELED_FAILURE_REASON
    ? new PrintError('PRINT_ERROR', failureReason, { detail: PRINT_CANCELED_DETAIL })
    : new PrintError('PRINT_ERROR', failureReason);
}
