import type { WebContents } from 'electron';
import type { SubmittedJobs } from '../../core/diagnosis/submitted-jobs';
import { PrintError } from '../../core/errors';
import type { Clock, LabelJob, PrinterInfo } from '../../core/types';
import { renderWarningTexts } from '../../shared/render-warnings';
import { driverPrintError } from './driver-print-failure';
import { renderLabelHtml } from './label-html';
import { withLabelWindow } from './label-window';
import { pageSizeMicrons } from './page-size';
import type { PrinterDriver } from './printer-driver';
import type { PrinterProfiles } from './printer-profiles';
import type { PrinterReadiness } from './printer-status';

/** 打印时用的打印机列表缓存；界面上的「刷新」总是取最新列表。 */
const PRINTER_LIST_TTL_MS = 5_000;

interface PrinterListCache {
  at: number;
  printers: PrinterInfo[];
}

/** 通过打印机驱动静默打印：隐藏窗口渲染标签 HTML，然后调用 webContents.print。 */
export class ElectronDriverAdapter implements PrinterDriver {
  private cache: PrinterListCache | null = null;
  /** 正在进行的系统查询：同时来的几张共用它，按调用顺序继续，不会因为谁先查完而插队（先扫先打）。 */
  private pending: Promise<PrinterInfo[]> | null = null;

  constructor(
    private readonly getWebContents: () => WebContents,
    /** 后台检测到的打印机状态（缓存）；null = 未知，不阻止打印。 */
    private readonly readinessOf: (printerName: string) => PrinterReadiness | null,
    private readonly clock: Clock,
    private readonly profiles: PrinterProfiles,
    /** 交给打印队列的任务的账本：诊断时据此认出队列里哪些是本程序发的。 */
    private readonly submitted: SubmittedJobs,
  ) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const printers = (await this.getWebContents().getPrintersAsync())
      .map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
    this.cache = { at: this.clock.now(), printers };
    return printers;
  }

  async print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void> {
    if (!(await this.hasPrinter(printerName))) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    const readiness = this.readinessOf(printerName);
    if (readiness && !readiness.ready) {
      throw new PrintError('PRINTER_NOT_READY', `Printer not ready: ${printerName}`, {
        detail: readiness.detail,
        issue: readiness.issue,
      });
    }
    // 二维码按这台打印机的分辨率对齐打印点；读不到（或 1 秒内没读到）按 203dpi。
    const { html, diagnostics, ...warnings } = renderLabelHtml(job, await this.profiles.dpiOf(printerName));
    // 打印照常进行，但少印的部分（条码、二维码、截断的格子）要留在日志里：本机接口来的面单没人看预览。
    const texts = renderWarningTexts(warnings);
    if (texts.length > 0) {
      console.warn(
        `[ElectronDriverAdapter] "${job.scan.raw}" on ${printerName} with template "${job.template.name}": ${texts.join('；')}`,
      );
    }
    // diagnostics 是条码库的原始英文错误：每次打印最多记一次，排查条码问题时去日志里找原始消息，不用去猜。
    if (diagnostics.length > 0) {
      console.warn(
        `[ElectronDriverAdapter] "${job.scan.raw}" on ${printerName} with template "${job.template.name}" diagnostics: ${diagnostics.join('；')}`,
      );
    }
    const startedAt = this.clock.now();
    // 超时（PrintQueue 触发 abort）时立刻销毁打印窗口，避免隐藏窗口堆积。
    await withLabelWindow(html, signal, (contents) =>
      printSilently(contents, printerName, pageSizeMicrons(job.template.paper)),
    );
    // 驱动回调成功 = 任务进了系统的打印队列：记下这个时间段。
    this.submitted.record(printerName, startedAt);
  }

  /** 渲染进程传来的打印机名在交给系统命令之前，必须是系统里真实存在的打印机。 */
  async hasPrinter(printerName: string): Promise<boolean> {
    return (await this.knownPrinters()).some((printer) => printer.name === printerName);
  }

  async knownPrinterNames(): Promise<string[]> {
    return (await this.knownPrinters()).map((printer) => printer.name);
  }

  private knownPrinters(): Promise<PrinterInfo[]> {
    if (this.cache && this.clock.now() - this.cache.at < PRINTER_LIST_TTL_MS) {
      return Promise.resolve(this.cache.printers);
    }
    this.pending ??= this.listPrinters().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

/** 中止（超时）时由 withLabelWindow 销毁窗口并结束等待：窗口销毁后 print 的回调可能永远不来。 */
function printSilently(
  webContents: WebContents,
  deviceName: string,
  pageSize: { width: number; height: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    webContents.print(
      {
        silent: true,
        deviceName,
        printBackground: true,
        landscape: false,
        margins: { marginType: 'none' },
        pageSize,
      },
      (success, failureReason) => {
        if (success) {
          resolve();
        } else {
          reject(driverPrintError(failureReason));
        }
      },
    );
  });
}
