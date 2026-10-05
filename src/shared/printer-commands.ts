import type { CommandSet, DetectedCommandSet, PrinterCommandConfig } from '../core/printer-commands/command-model';

/**
 * 热敏标签机最常见的分辨率 203dpi；读不到驱动报告的分辨率时按它换算或显示。
 * 主进程（二维码、标签机指令）和界面（标签机指令面板的「按驱动」选项）共用同一个值，不要各自定义。
 */
export const DEFAULT_PRINTER_DPI = 203;

/**
 * 发不出去的原因。Windows 按 winspool 的错误码分：找不到打印机、没有权限、驱动不收 RAW；
 * not-sent = 探测进程重启时这条还没排到（连行都没被读到），确定没发出去；
 * uncertain = 排到了但探测进程没有及时回应，不知道发没发出去；unsupported = 这个平台不能直接发；其余为 error。
 */
export const RAW_SEND_FAILURES = [
  'not-found',
  'access-denied',
  'raw-rejected',
  'not-sent',
  'uncertain',
  'unsupported',
  'error',
] as const;
export type RawSendFailureKind = (typeof RAW_SEND_FAILURES)[number];

/** 没有发送的原因：设为不发指令、「自动」认不出、各项都是「不改」。 */
export type NotSentReason = 'no-command-set' | 'unknown-command-set' | 'nothing-to-send';

/** 保存设置、执行动作的结果。sent 只表示交给了系统的打印服务，打印机有没有照做程序不知道。 */
export type PrinterCommandResult =
  | { status: 'sent'; commandSet: CommandSet }
  | { status: 'not-sent'; reason: NotSentReason }
  | { status: 'invalid'; issue: string }
  | { status: 'failed'; reason: RawSendFailureKind; detail: string };

const NOT_SENT_TEXTS: Readonly<Record<NotSentReason, string>> = {
  'no-command-set': '这台打印机设为「不发指令」，没有发送',
  'unknown-command-set': '认不出这台打印机用哪种指令，没有发送：请在「指令集」里选一种',
  'nothing-to-send': '各项都是「不改」，没有要发送的设置',
};

/** 没发出去的原因 → 中文说明；界面的「标签机指令」面板和主进程（诊断的「走一张纸」「纸张校准」）共用同一份文字。 */
export function notSentText(reason: NotSentReason): string {
  return NOT_SENT_TEXTS[reason];
}

/** 失败详情只截这么多字显示：原始错误可能很长（系统报的英文原文），截断后还留得下后面的「再试一次」。 */
const MAX_FAILURE_DETAIL_CHARS = 80;

/**
 * 发送失败 / 不确定发没发出去的原因 → 中文说明和下一步，不是原始的英文代码（`not-found`、`uncertain`……）。
 * uncertain 单独说清楚是「不知道做没做成」，不是「没做成」：排到的请求因为探测进程没有及时回应而说不清结果，
 * 打印机可能已经收到了。
 */
export function rawSendFailureText(reason: RawSendFailureKind, detail: string): string {
  switch (reason) {
    case 'not-found':
      return '发送失败：系统里找不到这台打印机。点「刷新」看看它还在不在';
    case 'access-denied':
      return '发送失败：没有向这台打印机发送的权限。在 Windows 打印机属性的「安全」里给当前用户「打印」权限后再试';
    case 'raw-rejected':
      return '发送失败：这台打印机的驱动不接受直接发送的指令。装热敏标签机厂家的驱动后再试；只想正常打印的话，把指令集改成「不发指令」';
    case 'not-sent':
      return '没有发出去：排队时探测进程重启了，这条还没轮到就被取消。请重试';
    case 'uncertain':
      return '不确定有没有发出去：系统的打印服务没有及时回应。看看打印机有没有动作，再决定要不要重发';
    case 'unsupported':
      return '这个系统上不能直接向打印机发送指令';
    case 'error':
      return `发送失败：${detail.slice(0, MAX_FAILURE_DETAIL_CHARS)}。检查打印机是否开着、连好，再试一次`;
  }
}

/** 「标签机指令」面板要的：保存的设置、「自动」认出的指令集、驱动名、驱动报告的分辨率。 */
export interface PrinterCommandsView {
  config: PrinterCommandConfig;
  /** 「自动」会用的指令集（和当前选的是什么无关）；认不出为 null。 */
  detected: DetectedCommandSet | null;
  driverName: string | null;
  /** 驱动报告的分辨率；读不到为 null（ZPL、EPL 换算时按 203dpi）。 */
  driverDpi: number | null;
}
