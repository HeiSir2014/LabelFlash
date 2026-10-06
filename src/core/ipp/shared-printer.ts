import type { PaperSize } from '../../shared/paper-sizes';
import type { PrinterIssue, PrinterReadiness } from '../../shared/printer-readiness';

export type SharedPrinterStateName = 'idle' | 'processing' | 'stopped';

/** 共享打印机现在的状态（printer-state、printer-state-reasons、printer-state-message）。 */
export interface SharedPrinterState {
  state: SharedPrinterStateName;
  /** printer-state-reasons 的关键字；没有问题时是 none。 */
  reasons: string[];
  /** printer-state-message：给对方电脑的人看的中文。 */
  message: string;
}

/** 一台共享打印机 = 一种已分配打印机的纸张。主进程按纸张分配表、打印机资料和状态拼出来。 */
export interface SharedPrinter {
  /** 纸张键（60x40），也是网址里的名字：/printers/60x40。 */
  key: string;
  paper: PaperSize;
  /** printer-name：「60×40 标签」。 */
  name: string;
  /** printer-info：「60×40 标签（前台上的热敏标签机）」。 */
  info: string;
  makeAndModel: string;
  /** printer-device-id（IEEE 1284，只用 ASCII）：Windows 按它给打印机认驱动。 */
  deviceId: string;
  /** printer-location：这台电脑的名字。 */
  location: string;
  /** 打印机的分辨率（点 / 英寸）：光栅按它请对方渲染，标签按它出点。 */
  dpi: number;
  /** urn:uuid:…，按程序实例和纸张算出来，重启、换端口都不变。 */
  uuid: string;
  state: SharedPrinterState;
  /** 排着的和正在处理的任务数。 */
  queuedJobCount: number;
}

/** 打印机问题 → IPP 的 printer-state-reasons（PWG 5100.9 的关键字）。 */
const ISSUE_REASONS: Record<PrinterIssue, string> = {
  paperOut: 'media-empty-error',
  paperJam: 'media-jam-error',
  doorOpen: 'door-open-error',
  offline: 'offline-report',
  other: 'other-error',
};
const READY_MESSAGE = '可以打印';
const BUSY_MESSAGE = '正在打印';
const NO_REASON = 'none';

/**
 * 打印机状态 → printer-state：驱动明确报告问题才是 stopped；查不到（null，例如 macOS）按能打印算，
 * 和本机打印的规则一样（printer-status.ts），不因为不知道就拒绝。
 */
export function sharedPrinterState(readiness: PrinterReadiness | null, activeJobs: number): SharedPrinterState {
  if (readiness !== null && !readiness.ready) {
    return { state: 'stopped', reasons: [ISSUE_REASONS[readiness.issue]], message: readiness.detail };
  }
  return activeJobs > 0
    ? { state: 'processing', reasons: [NO_REASON], message: BUSY_MESSAGE }
    : { state: 'idle', reasons: [NO_REASON], message: READY_MESSAGE };
}

/** PWG 5101.1 的自描述纸张名：om（其他公制）_名字_尺寸。纸张键本来就是「宽x高」，正好当尺寸。 */
export function mediaName(key: string): string {
  return `om_label-${key}_${key}mm`;
}
