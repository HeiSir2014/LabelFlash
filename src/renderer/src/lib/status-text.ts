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
import { formatWindow } from '../../../shared/duration-text';
import type { LabelPreview } from '../../../shared/ipc-contract';
import { DEFAULT_PAPER } from '../../../shared/label-paper';
import { formatPaperName, parsePaperKey } from '../../../shared/paper-sizes';
import { PRINT_TIMEOUT_SECONDS } from '../../../shared/print-timing';
import { VOICE_CUE_TEXT } from '../../../shared/voice';
import type { ConfigPage } from './app-view';
import type { NoticeTone } from './notices';

/** 防重复窗口的说法和手机扫码页共用一份（见 src/shared/duration-text.ts）。 */
export { formatWindow };

/** 状态条上的直达按钮：配置中心的某一页，或工作台右侧的打印机页。 */
/** 状态条上的链接都去配置中心的某一页（打印机也在配置中心）。 */
export type StatusLinkTarget = ConfigPage;

export type FeedbackTone = 'success' | 'warning' | 'error';
export type StatusTone = FeedbackTone | 'idle' | 'pending';

export interface StatusView {
  tone: StatusTone;
  title: string;
  detail: string;
  /** 要去配置中心的某一页才能解决时，状态条上给一个直达按钮。 */
  link?: { page: StatusLinkTarget; label: string };
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
  now: number;
  /** 刚扫的内容还在识别或查询（超过一小会儿才算）；界面暂时保留上一张的预览。 */
  queryingRaw: string | null;
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
    detail: '在「配置 › 识别规则」里启用「原样打印」，或新建一条能识别这种内容的规则',
    link: { page: 'rules', label: '打开「识别规则」' },
  },
};
/** 已打印时的详情最多列出几个字段值。 */
const PRINTED_DETAIL_FIELDS = 3;

const FAILURE_TITLES: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_NOT_READY: '打印机未就绪',
  PRINT_TIMEOUT: '打印机没有响应',
  PRINT_ERROR: '打印失败',
  LOOKUP_FAILED: '数据查询失败，没有打印',
  TEXT_NOT_FOUND: '没认出标签上的字，没有打印',
};

const FAILURE_SHORT: Record<PrintFailureReason, string> = {
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_NOT_READY: '未就绪',
  PRINT_TIMEOUT: '超时',
  PRINT_ERROR: '驱动报错',
  LOOKUP_FAILED: '查询失败',
  TEXT_NOT_FOUND: '没认出',
};

/** 这些失败确定没有出纸，可以直接重试；超时结果不确定，只能强制补打。 */
const RETRYABLE_FAILURES: ReadonlySet<PrintFailureReason> = new Set([
  'PRINTER_NOT_FOUND',
  'PRINTER_NOT_READY',
  'PRINT_ERROR',
  'LOOKUP_FAILED',
  'TEXT_NOT_FOUND',
]);

const SOURCE_LABELS: Record<PrintSource, string> = {
  desktop: '扫码枪',
  history: '记录重打',
  mobile: '手机',
  api: '本机接口',
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
    case 'LOOKUP_FAILED':
      return lookupFailureDetail(detail);
    case 'TEXT_NOT_FOUND':
      // 只有手机扫码会带图：处理也在手机上。
      return `${detail ?? '没认出标签上的字'}；请在手机上对准标签重扫，或手动输入`;
  }
}

function lookupFailureDetail(detail: string | undefined): string {
  return `${detail ?? '接口没有返回需要的数据'}；规则设为查询失败时不打印，接口恢复后点「重试打印」`;
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
    case 'no-printer':
      return describeNoPrinter(result.paperKey, result.missingPrinter);
  }
}

/** 这种纸没有可用的打印机：说清是哪种纸，模板指定的打印机不在时一并说明。 */
export function describeNoPrinter(paperKey: string, missingPrinter: string | null): FeedbackStatusView {
  const paper = formatPaperName(parsePaperKey(paperKey) ?? DEFAULT_PAPER);
  return {
    tone: 'warning',
    title: VOICE_CUE_TEXT.noPrinter,
    detail:
      missingPrinter === null
        ? `${paper} 还没有打印机`
        : `模板指定的 ${missingPrinter} 不在这台电脑上，${paper} 也还没有打印机`,
    link: { page: 'printers', label: '去指定打印机' },
  };
}

/** 「打印一张试试」的结果：用提示条说，用词和状态条一致（成功是「已发送打印」，不说「打印成功」）。 */
export function describeSamplePrint(result: PrintResult, now: number): { tone: NoticeTone; message: string } {
  const view = describeResult(result, now);
  const tone: NoticeTone = view.tone === 'success' ? 'info' : view.tone;
  return { tone, message: view.detail === '' ? view.title : `${view.title}：${view.detail}` };
}

export const IPC_ERROR_VIEW: FeedbackStatusView = {
  tone: 'error',
  title: '程序内部错误',
  detail: '已写入日志；请重试，仍然不行请重启程序',
};

const IDLE_STATUS: StatusView = { tone: 'idle', title: '', detail: '' };

export function describeScan(scan: ScanSnapshot | null, context: ScanContext): ScanView {
  if (context.queryingRaw !== null) {
    const [firstLine = ''] = context.queryingRaw.split('\n');
    return { status: { tone: 'pending', title: '正在查询…', detail: firstLine }, actions: NO_ACTIONS };
  }
  // 没扫码时不说话：扫码框里写了怎么扫，「自动打印」开关就是打不打印的模式。状态条留着高度，第一张出结果时预览不跳。
  if (!scan) {
    return { status: IDLE_STATUS, actions: NO_ACTIONS };
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
    // 没有打印机时指定好打印机就能直接重打这一张（主进程每次打印都重新决定打印机），不用再扫。
    const canRetry =
      print.status === 'no-printer' || (print.status === 'failed' && RETRYABLE_FAILURES.has(print.reason));
    const canForce =
      (print.status === 'duplicate' && print.recent.state === 'printed') ||
      (print.status === 'failed' && print.reason === 'PRINT_TIMEOUT');
    return {
      status: describeResult(print, context.now),
      actions: {
        print: canRetry ? 'retry' : null,
        forceReprint: canForce,
      },
    };
  }
  if (previewResult.lookupFailure !== null) {
    return {
      status: { tone: 'error', title: '数据查询失败', detail: lookupFailureDetail(previewResult.lookupFailure) },
      actions: { print: 'retry', forceReprint: false },
    };
  }
  // 预览时这种纸还没有打印机（手动模式）：说清是哪种纸；指定好之后按 F2，主进程会重新决定打印机。
  const { printer } = previewResult;
  if (printer.printerName === null) {
    return {
      status: describeNoPrinter(printer.paperKey, printer.missingPrinter),
      actions: { print: 'retry', forceReprint: false },
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

/**
 * 打印记录一行的说明：时间 · 来源 · 打印机 · 纸张。旧记录没有纸张时写「—」，识别不了的记录没有打印机。
 * caller 是本机接口的调用方（密钥名称或网站，见 local-api-text 的 describeCaller），写在来源后面的括号里。
 * 从这种记录重打的那一张也带着调用方，但不是调用方这次提交的：写成「原提交」。
 */
export function describeJobMeta(job: JobRecord, caller: string | null = null): string {
  const paper = job.paper === undefined ? null : parsePaperKey(job.paper);
  const source = describeSource(job.source);
  const submitter = job.source === 'history' ? `原提交：${caller}` : caller;
  return [
    formatDateTime(job.createdAt),
    caller === null ? source : `${source}（${submitter}）`,
    job.printerName === '' ? null : job.printerName,
    paper === null ? '—' : formatPaperName(paper),
  ]
    .filter((part) => part !== null)
    .join(' · ');
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
