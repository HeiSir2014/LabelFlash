import { execFile } from 'node:child_process';
import { PRINTER_STATUS_POLL_MS } from '../../shared/print-timing';
import type { PrinterReadiness } from '../../shared/printer-readiness';

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

const PROBE_TIMEOUT_MS = 3_000;
/** 打印机名通过环境变量传入，不拼接进命令行，避免注入。 */
const PRINTER_NAME_ENV = 'CDL_PRINTER_NAME';
const PROBE_SCRIPT = `(Get-Printer -Name $env:${PRINTER_NAME_ENV} -ErrorAction Stop).PrinterStatus.ToString()`;

export const STATUS_POLL_INTERVAL_MS = PRINTER_STATUS_POLL_MS;

/** PrinterStatus 可能是单个状态（Normal），也可能是组合（Offline, PaperOut）。 */
export function parsePrinterStatus(output: string): PrinterReadiness {
  const problems = output
    .split(/[\s,]+/)
    .map((flag) => NOT_READY_STATUS[flag])
    .filter((detail): detail is string => detail !== undefined);
  return problems.length === 0 ? { ready: true } : { ready: false, detail: [...new Set(problems)].join('、') };
}

/** 查询打印机状态；非 Windows 或查询失败返回 null（未知，不阻止打印）。 */
export function queryPrinterReadiness(printerName: string): Promise<PrinterReadiness | null> {
  if (process.platform !== 'win32') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, env: { ...process.env, [PRINTER_NAME_ENV]: printerName } },
      (error, stdout) => {
        if (error) {
          console.warn(`[printer-status] probe failed for "${printerName}": ${error.message}`);
          resolve(null);
          return;
        }
        resolve(parsePrinterStatus(stdout));
      },
    );
  });
}

/** 后台轮询当前打印机状态；打印时直接读缓存，不增加出纸延迟。 */
export class PrinterStatusMonitor {
  private readonly readiness = new Map<string, PrinterReadiness>();
  private watched: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly probe: (printerName: string) => Promise<PrinterReadiness | null>,
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
    if (result) {
      this.readiness.set(printerName, result);
    } else {
      this.readiness.delete(printerName);
    }
  }
}
