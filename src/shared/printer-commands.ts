import type { CommandSet, DetectedCommandSet, PrinterCommandConfig } from '../core/printer-commands/command-model';

/**
 * 发不出去的原因。Windows 按 winspool 的错误码分：找不到打印机、没有权限、驱动不收 RAW；
 * uncertain = 系统的打印服务没有及时回应，不知道发没发出去；unsupported = 这个平台不能直接发；其余为 error。
 */
export const RAW_SEND_FAILURES = [
  'not-found',
  'access-denied',
  'raw-rejected',
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
