import type { PrinterIssue } from '../shared/printer-readiness';
import type { ScanResult } from './scan/scan-result';
import type { LabelTemplate } from './templates/template-model';

/** desktop = 扫码枪，history = 从打印记录重打，mobile = 手机（Phase 2）。 */
export const PRINT_SOURCES = ['desktop', 'history', 'mobile'] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];

export interface PrintRequest {
  raw: string;
  printerName: string;
  source: PrintSource;
  /** 强制补打：跳过门限窗口（不跳过正在打印的同一个码）。 */
  force?: boolean;
}

export const PRINT_FAILURE_REASONS = [
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_TIMEOUT',
  'PRINT_ERROR',
  /** 加工步骤里设为「拦下不打印」的 HTTP 查询失败。 */
  'LOOKUP_FAILED',
] as const;
export type PrintFailureReason = (typeof PRINT_FAILURE_REASONS)[number];

/** 门限命中时的状态：printing = 同一个码正在打印；printed = 窗口期内已打印。 */
export interface RecentPrint {
  state: 'printing' | 'printed';
  at: number;
}

/** INVALID_CONTENT = 空内容、超长或含控制字符；NO_MATCHING_RULE = 内容合法，但没有一条启用的规则能识别。 */
export type InvalidReason = 'INVALID_CONTENT' | 'NO_MATCHING_RULE';

export type PrintResult =
  | { status: 'printed'; jobId: string; scan: ScanResult }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'failed'; reason: PrintFailureReason; detail?: string; issue?: PrinterIssue };

export type PrintStatus = PrintResult['status'];
export const PRINT_STATUSES = ['printed', 'duplicate', 'invalid', 'failed'] as const satisfies readonly PrintStatus[];

export type PreviewResult =
  | {
      status: 'ok';
      /** 已执行加工步骤的结果。 */
      scan: ScanResult;
      recent: RecentPrint | null;
      /** 设为「拦下不打印」的 HTTP 查询失败了：打印会被拦下，这里是原因。 */
      lookupFailure: string | null;
    }
  | { status: 'invalid'; reason: InvalidReason };

export interface PrinterInfo {
  name: string;
  displayName: string;
}

/** 一次打印的完整输入：识别结果 + 模板 + 打印时间（备注里的 {日期}/{时间} 用它）。 */
export interface LabelJob {
  scan: ScanResult;
  template: LabelTemplate;
  printedAt: number;
}

export interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  /** signal 触发（超时）时，实现必须放弃并清理这次打印。 */
  print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void>;
}

export interface JobRecord {
  id: string;
  createdAt: number;
  raw: string;
  printerName: string;
  source: PrintSource;
  status: PrintStatus;
  forced: boolean;
  failureReason?: PrintFailureReason;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
