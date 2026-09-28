import { MAX_RAW_LENGTH } from '../../../core/scan/normalize-raw';
import { joinLines } from '../../../core/templates/label-content';
import type {
  InvalidReason,
  JobRecord,
  PrintFailureReason,
  PrintResult,
  PrintSource,
  RecentPrint,
} from '../../../core/types';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { PRINT_TIMEOUT_SECONDS } from '../../../shared/print-timing';

export type FeedbackTone = 'success' | 'warning' | 'error';
export type StatusTone = FeedbackTone | 'idle' | 'pending';

export interface StatusView {
  tone: StatusTone;
  title: string;
  detail: string;
}

export interface FeedbackStatusView extends StatusView {
  tone: FeedbackTone;
}

export interface ScanActions {
  print: 'print' | 'retry' | null;
  forceReprint: boolean;
}

export interface ScanSnapshot {
  raw: string;
  preview: LabelPreview;
  print: PrintResult | null;
  isPrinting: boolean;
  /** 调用主进程失败（程序内部错误），与打印机故障区分开。 */
  hasIpcError: boolean;
}

export interface ScanContext {
  autoPrint: boolean;
  hasPrinter: boolean;
  now: number;
}

export interface ScanView {
  status: StatusView;
  actions: ScanActions;
}

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const MINUTES_PER_HOUR = 60;
const NO_ACTIONS: ScanActions = { print: null, forceReprint: false };

const INVALID_VIEWS: Record<InvalidReason, FeedbackStatusView> = {
  INVALID_CONTENT: {
    tone: 'error',
    title: '扫码内容无法识别',
    detail: `内容为空、超过 ${MAX_RAW_LENGTH} 个字符或含有不可见字符。出现乱码时，检查扫码枪是否开启中文输出`,
  },
  NO_MATCHING_RULE: {
    tone: 'error',
    title: '没有匹配的识别规则',
    detail: '在「识别规则」里启用「原样打印」，或新建一条能识别这种内容的规则',
  },
};
/** 已打印时的详情最多列出几个字段值。 */
const PRINTED_DETAIL_FIELDS = 3;

const FAILURE_TITLES: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_NOT_READY: '打印机未就绪',
  PRINT_TIMEOUT: '打印机没有响应',
  PRINT_ERROR: '打印失败',
};

const FAILURE_SHORT: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_NOT_READY: '未就绪',
  PRINT_TIMEOUT: '超时',
  PRINT_ERROR: '驱动报错',
};

/** 这些失败确定没有出纸，可以直接重试；超时结果不确定，只能强制补打。 */
const RETRYABLE_FAILURES: ReadonlySet<PrintFailureReason> = new Set([
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_ERROR',
]);

const SOURCE_LABELS: Record<PrintSource, string> = {
  desktop: '扫码枪',
  history: '记录重打',
  mobile: '手机',
};

export function formatAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / MS_PER_MINUTE);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} 分钟前`;
  }
  return `${Math.floor(minutes / MINUTES_PER_HOUR)} 小时前`;
}

/** 防重复窗口用能整除的最大单位显示：3 秒、90 秒、10 分钟、2 小时。 */
export function formatWindow(windowMs: number): string {
  const seconds = Math.round(windowMs / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE || seconds % SECONDS_PER_MINUTE !== 0) {
    return `${seconds} 秒`;
  }
  const minutes = seconds / SECONDS_PER_MINUTE;
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
    return `${minutes / MINUTES_PER_HOUR} 小时`;
  }
  return `${minutes} 分钟`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function failureDetail(reason: PrintFailureReason, detail: string | undefined): string {
  switch (reason) {
    case 'PRINTER_NOT_FOUND':
      return '系统里找不到这台打印机，刷新打印机列表后重新选择';
    case 'PRINTER_NOT_READY':
      return `${detail ?? '打印机当前无法打印'}，处理好后点「重试打印」`;
    case 'PRINT_TIMEOUT':
      return `${PRINT_TIMEOUT_SECONDS} 秒内没有响应，可能已出纸或仍在排队；确认没有出纸再用「强制补打」`;
    case 'PRINT_ERROR':
      return '打印机驱动报错，检查打印机状态后重试';
  }
}

function describeRecent(recent: RecentPrint, now: number): string {
  return recent.state === 'printing' ? '同一标签正在打印' : `${formatAgo(recent.at, now)}已打印过`;
}

export function describeResult(result: PrintResult, now: number): FeedbackStatusView {
  switch (result.status) {
    case 'printed':
      return {
        tone: 'success',
        title: '已发送打印',
        detail: result.scan.fields
          .slice(0, PRINTED_DETAIL_FIELDS)
          .map((field) => joinLines(field.value))
          .join(' · '),
      };
    case 'duplicate':
      return {
        tone: 'warning',
        title: '重复扫码，已拦截',
        detail: `${describeRecent(result.recent, now)}，${formatWindow(result.windowMs)}内同一标签只打一次`,
      };
    case 'invalid':
      return INVALID_VIEWS[result.reason];
    case 'failed':
      return {
        tone: 'error',
        title: FAILURE_TITLES[result.reason],
        detail: failureDetail(result.reason, result.detail),
      };
  }
}

export const IPC_ERROR_VIEW: FeedbackStatusView = {
  tone: 'error',
  title: '程序内部错误',
  detail: '已写入日志；请重试，仍然不行请重启程序',
};

export function describeScan(scan: ScanSnapshot | null, context: ScanContext): ScanView {
  if (!scan) {
    return {
      status: {
        tone: 'idle',
        title: '等待扫码',
        detail: context.autoPrint ? '扫码后自动预览并打印' : '扫码后先预览，核对无误按 F2 打印',
      },
      actions: NO_ACTIONS,
    };
  }
  if (scan.hasIpcError) {
    return { status: IPC_ERROR_VIEW, actions: NO_ACTIONS };
  }
  const previewResult = scan.preview.result;
  if (previewResult.status === 'invalid') {
    return { status: describeResult(previewResult, context.now), actions: NO_ACTIONS };
  }
  if (scan.isPrinting) {
    return { status: { tone: 'pending', title: '正在打印…', detail: scan.raw }, actions: NO_ACTIONS };
  }
  if (scan.print) {
    const { print } = scan;
    const canRetry = print.status === 'failed' && RETRYABLE_FAILURES.has(print.reason);
    const canForce =
      (print.status === 'duplicate' && print.recent.state === 'printed') ||
      (print.status === 'failed' && print.reason === 'PRINT_TIMEOUT');
    return {
      status: describeResult(print, context.now),
      actions: {
        print: canRetry && context.hasPrinter ? 'retry' : null,
        forceReprint: canForce && context.hasPrinter,
      },
    };
  }
  if (!context.hasPrinter) {
    return {
      status: { tone: 'warning', title: '还没选打印机', detail: '在右侧「打印机」列表里点选一台，选好后按 F2 打印' },
      actions: NO_ACTIONS,
    };
  }
  const { recent } = previewResult;
  if (recent) {
    return {
      status: {
        tone: 'warning',
        title: describeRecent(recent, context.now),
        detail: '再打印会被门限拦截；确实需要再打一张，请用「强制补打」',
      },
      actions: { print: 'print', forceReprint: recent.state === 'printed' },
    };
  }
  return {
    status: { tone: 'idle', title: '待打印', detail: '核对预览无误后，按 F2 或点「打印」' },
    actions: { print: 'print', forceReprint: false },
  };
}

export function describeJobStatus(job: JobRecord): { tone: FeedbackTone; text: string } {
  switch (job.status) {
    case 'printed':
      return { tone: 'success', text: job.forced ? '已补打' : '已发送' };
    case 'duplicate':
      return { tone: 'warning', text: '已拦截' };
    case 'invalid':
      return { tone: 'error', text: '无法识别' };
    case 'failed':
      return { tone: 'error', text: job.failureReason ? `失败：${FAILURE_SHORT[job.failureReason]}` : '失败' };
  }
}

export function describeSource(source: PrintSource): string {
  return SOURCE_LABELS[source];
}
