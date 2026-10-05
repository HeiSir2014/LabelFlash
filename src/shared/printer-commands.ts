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

/** 「标签机指令」面板要的：保存的设置、「自动」认出的指令集、驱动名、驱动报告的分辨率。 */
export interface PrinterCommandsView {
  config: PrinterCommandConfig;
  /** 「自动」会用的指令集（和当前选的是什么无关）；认不出为 null。 */
  detected: DetectedCommandSet | null;
  driverName: string | null;
  /** 驱动报告的分辨率；读不到为 null（ZPL、EPL 换算时按 203dpi）。 */
  driverDpi: number | null;
}
