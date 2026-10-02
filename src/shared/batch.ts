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
}

/** 界面看到的一批的进度：失败只带前 BATCH_STATUS_FAILURES 条（BatchRun.snapshot() 另有自己的上限，这里更严）。 */
export interface BatchStatus extends BatchProgress {
  templateName: string;
  failures: BatchFailure[];
}

export type BatchStartResult = { status: 'started'; batch: BatchStatus } | { status: 'invalid'; issue: string };

/** 状态里最多带几条失败：界面逐行列出、可以单独重打；更多的从打印记录按批次「重打失败的」。 */
export const BATCH_STATUS_FAILURES = 200;
