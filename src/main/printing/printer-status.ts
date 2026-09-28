import { PRINTER_STATUS_POLL_MS } from '../../shared/print-timing';
import type { PrinterReadiness } from '../../shared/printer-readiness';
import type { PrinterProbeHost } from './printer-probe-host';

export type { PrinterReadiness };

/** Get-Printer 的 PrinterStatus 中表示「打不了」的状态 → 给操作员看的中文说明。 */
const NOT_READY_STATUS: Readonly<Record<string, string>> = {
  Offline: '打印机离线',
  Error: '打印机报错',
  PaperJam: '卡纸',
  PaperOut: '缺纸',
  PaperProblem: '纸张异常',
  NotAvailable: '打印机不可用',
  DoorOpen: '机盖未关',
  UserIntervention: '需要人工处理',
  Paused: '打印机已暂停',
  NoToner: '碳带或墨粉耗尽',
  OutOfMemory: '打印机内存不足',
};

export const STATUS_POLL_INTERVAL_MS = PRINTER_STATUS_POLL_MS;

/** PrinterStatus 可能是单个状态（Normal），也可能是组合（Offline, PaperOut）。 */
export function parsePrinterStatus(output: string): PrinterReadiness {
  const problems = output
    .split(/[\s,]+/)
    .map((flag) => NOT_READY_STATUS[flag])
    .filter((detail): detail is string => detail !== undefined);
  return problems.length === 0 ? { ready: true } : { ready: false, detail: [...new Set(problems)].join('、') };
}

/** 打印机状态查询：经常驻探测进程（见 printer-probe-host.ts）；没有探测进程（非 Windows）或查询失败返回 null（未知，不阻止打印）。 */
export function createReadinessProbe(
  host: PrinterProbeHost | null,
): (printerName: string) => Promise<PrinterReadiness | null> {
  return async (printerName) => {
    const status = host ? await host.query('status', printerName) : null;
    return status === null ? null : parsePrinterStatus(status);
  };
}

/** 打印机从「可用 / 未知」变为「不能打印」（或不能打印的原因变了）时通知。 */
export type NotReadyListener = (printerName: string, detail: string) => void;

/** 后台轮询当前打印机状态；打印时直接读缓存，不增加出纸延迟。 */
export class PrinterStatusMonitor {
  private readonly readiness = new Map<string, PrinterReadiness>();
  private watched: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly probe: (printerName: string) => Promise<PrinterReadiness | null>,
    private readonly onNotReady: NotReadyListener = () => {},
    private readonly intervalMs: number = STATUS_POLL_INTERVAL_MS,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  watch(printerName: string | null): Promise<void> {
    this.watched = printerName;
    this.readiness.clear();
    return this.poll();
  }

  /** null = 未知（尚未查询、查询失败或非 Windows）。 */
  get(printerName: string): PrinterReadiness | null {
    return this.readiness.get(printerName) ?? null;
  }

  async poll(): Promise<void> {
    const printerName = this.watched;
    if (!printerName) {
      return;
    }
    const result = await this.probe(printerName);
    if (printerName !== this.watched) {
      return;
    }
    const previous = this.readiness.get(printerName);
    if (result) {
      this.readiness.set(printerName, result);
    } else {
      this.readiness.delete(printerName);
    }
    const becameNotReady =
      result !== null &&
      !result.ready &&
      (previous === undefined || previous.ready || previous.detail !== result.detail);
    if (becameNotReady) {
      this.onNotReady(printerName, result.detail);
    }
  }
}
