import type { PrinterIssue } from '../shared/printer-readiness';
import type { PrinterChoice } from './printing/resolve-printer';
import type { ScanImage } from './scan/image-text';
import type { ScanField, ScanResult } from './scan/scan-result';
import type { LabelTemplate } from './templates/template-model';

/**
 * desktop = 扫码枪，history = 从打印记录重打，mobile = 手机，api = 本机接口，batch = 批量打印，
 * pdf / ipp / remote 是后续子项目（PDF 打印、局域网共享打印、远程打印）预留的取值：
 * 先占住数据库的 CHECK 约束和这个联合类型，各自的列和流程由那几个子项目的迁移再加。
 */
export const PRINT_SOURCES = ['desktop', 'history', 'mobile', 'api', 'batch', 'pdf', 'ipp', 'remote'] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];

/** 批量打印的一张：哪一批、第几行（从 1 数，不含表头）、这一行的第几份。 */
export interface BatchRef {
  id: string;
  row: number;
  copy: number;
}

/** 打印请求不带打印机：主进程按模板决定（见 printing/resolve-printer.ts）。 */
export interface PrintRequest {
  raw: string;
  source: PrintSource;
  /** 强制补打：跳过门限窗口（不跳过正在打印的同一个码）。 */
  force?: boolean;
  /** 谁提交的（写进打印记录）：本机接口为 key:<密钥编号> 或 origin:<网站>；其他入口没有。 */
  caller?: string;
  /** 手机扫码时拍下的标签图，同一张标签连续的几帧（加工步骤「图中文字识别」依次识别）；其他入口没有。 */
  images?: readonly ScanImage[];
  /** 手机上手动输入的字段（例如没认出时补的货架号）：图中文字识别直接用它。 */
  manualFields?: Readonly<Record<string, string>>;
  /** 批量打印的一张（含从打印记录重打批量打的）；其他入口没有。 */
  batch?: BatchRef;
}

export const PRINT_FAILURE_REASONS = [
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_TIMEOUT',
  'PRINT_ERROR',
  /** 加工步骤里设为「拦下不打印」的 HTTP 查询失败。 */
  'LOOKUP_FAILED',
  /** 加工步骤「图中文字识别」设为「拦下不打印」时没认出（例如货架号）。 */
  'TEXT_NOT_FOUND',
  /** 批量打印还没打到的标签，操作员选择了在退出程序时不等它们：这些行从来没有交给过打印机。 */
  'CANCELED',
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
  | {
      status: 'failed';
      reason: PrintFailureReason;
      detail?: string;
      issue?: PrinterIssue;
      /** TEXT_NOT_FOUND 时没认出的字段名（手机据此显示输入框）。 */
      field?: string;
    }
  /** 这种纸没有可用的打印机：没有打印，不写打印记录，不占防重复窗口。 */
  | { status: 'no-printer'; paperKey: string; missingPrinter: string | null };

/** 写进打印记录的结果（no-printer 不写记录）。 */
export type RecordedResult = Exclude<PrintResult, { status: 'no-printer' }>;
export type PrintStatus = RecordedResult['status'];
export const PRINT_STATUSES = ['printed', 'duplicate', 'invalid', 'failed'] as const satisfies readonly PrintStatus[];

export type PreviewResult =
  | {
      status: 'ok';
      /** 已执行加工步骤的结果。 */
      scan: ScanResult;
      recent: RecentPrint | null;
      /** 设为「拦下不打印」的 HTTP 查询失败了：打印会被拦下，这里是原因。 */
      lookupFailure: string | null;
      /** 这一张会打到哪台打印机（或为什么没有）。 */
      printer: PrinterChoice;
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
  /** 这一张的纸张键（例如 100x180）；1.0.x 的旧记录和识别不了的记录没有。 */
  paper?: string;
  /** 这一张用的模板；1.0.x 的旧记录和识别不了的记录没有。 */
  templateId?: string;
  /** 这一张打出来的字段（识别、加工后的，或本机接口给的）；识别不了的、1.0.x 的旧记录没有。 */
  fields?: ScanField[];
  /** 谁提交的：本机接口为 key:<密钥编号> 或 origin:<网站>；其他来源暂时没有。 */
  caller?: string;
  /** 批量打印的一张：批次号、行号、份号；其他来源没有。 */
  batch?: BatchRef;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
