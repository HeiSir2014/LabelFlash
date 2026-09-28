import type { LabelTemplate } from './templates/template-model';

export interface LabelData {
  /** 二维码原文（已 trim），同时作为门限的去重 key。 */
  raw: string;
  code: string;
  color: string;
  /** 尺码是文本：36、36.5、S、M、XL、XXL、3XL、均码都合法。 */
  size: string;
}

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
] as const;
export type PrintFailureReason = (typeof PRINT_FAILURE_REASONS)[number];

/** 门限命中时的状态：printing = 同一个码正在打印；printed = 窗口期内已打印。 */
export interface RecentPrint {
  state: 'printing' | 'printed';
  at: number;
}

export type PrintResult =
  | { status: 'printed'; jobId: string; label: LabelData }
  | { status: 'duplicate'; recent: RecentPrint; windowMs: number }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' }
  | { status: 'failed'; reason: PrintFailureReason; detail?: string };

export type PrintStatus = PrintResult['status'];
export const PRINT_STATUSES = ['printed', 'duplicate', 'invalid', 'failed'] as const satisfies readonly PrintStatus[];

export type PreviewResult =
  | { status: 'ok'; label: LabelData; recent: RecentPrint | null }
  | { status: 'invalid'; reason: 'INVALID_FORMAT' };

export interface PrinterInfo {
  name: string;
  displayName: string;
}

/** 一次打印的完整输入：标签数据 + 模板 + 打印时间（备注里的 {日期}/{时间} 用它）。 */
export interface LabelJob {
  label: LabelData;
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
