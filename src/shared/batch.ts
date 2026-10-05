import type { BatchTable, RowProblem } from '../core/batch/batch-model';
import type { BatchFailure, BatchProgress } from '../core/batch/batch-runner';
import type { PaperSize } from './paper-sizes';
import type { RenderWarnings } from './render-warnings';

/** 导入表格的结果（选文件、拖进窗口、粘贴）。 */
export type BatchTableResult =
  | { status: 'loaded'; table: BatchTable }
  | { status: 'canceled' }
  | { status: 'invalid'; issue: string };

/** 一行打出来的样子：和实际打印同一份 HTML。 */
export interface BatchRowPreview {
  html: string;
  warnings: RenderWarnings;
  paper: PaperSize;
}

export type BatchPreviewResult = { status: 'ok'; preview: BatchRowPreview } | { status: 'invalid'; issue: string };

/** 把每一行排一遍才看得出的问题（条码不合码制、二维码放不下、文字被截断）。 */
export interface BatchCheckResult {
  problems: RowProblem[];
  /** 这次根本没能检查（模板、表格对不上，或者设置本身打印不了）时的原因：problems 固定是空的。 */
  issue?: string;
}

/** 界面看到的一批的进度：失败只带前 BATCH_STATUS_FAILURES 条（BatchRun.snapshot() 另有自己的上限，这里更严）。 */
export interface BatchStatus extends BatchProgress {
  templateName: string;
  failures: BatchFailure[];
  /** 这一批用的表格编号；「只按序号打」没有表格时为 null。界面按它核对当前打开的表格是不是这一批用的那张，
   *  不是的话不把失败标到当前表格的行上——避免换了一张新表之后，还显示着上一批、不相关的失败行。 */
  tableId: string | null;
  /** 还在打或者刚取消、正在打的那一张还没结束（和 BatchRun.isActive 一致）。界面用它判断「取消」之后
   *  是不是真的已经停了：state 变成 canceled 那一刻正在打的那一张可能还没打完，这时还不能当作已经停下。 */
  isActive: boolean;
}

export type BatchStartResult = { status: 'started'; batch: BatchStatus } | { status: 'invalid'; issue: string };

/** 状态里最多带几条失败：界面逐行列出、可以单独重打；更多的从打印记录按批次「重打失败的」。 */
export const BATCH_STATUS_FAILURES = 200;
