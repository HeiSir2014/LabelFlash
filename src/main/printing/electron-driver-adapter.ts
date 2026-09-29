import { BrowserWindow, type WebContents } from 'electron';
import { PrintError } from '../../core/errors';
import type { Clock, LabelJob, PrinterInfo } from '../../core/types';
import { renderLabelHtml } from './label-html';
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

  constructor(
    private readonly getWebContents: () => WebContents,
    /** 后台检测到的打印机状态（缓存）；null = 未知，不阻止打印。 */
    private readonly readinessOf: (printerName: string) => PrinterReadiness | null,
    private readonly clock: Clock,
    private readonly profiles: PrinterProfiles,
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
    const { html } = renderLabelHtml(job, await this.profiles.dpiOf(printerName));
    signal.throwIfAborted();
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    const destroy = () => {
      if (!printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    };
    // 超时（PrintQueue 触发 abort）时立刻销毁打印窗口，避免隐藏窗口堆积。
    signal.addEventListener('abort', destroy, { once: true });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await printSilently(printWindow.webContents, printerName, pageSizeMicrons(job.template.paper), signal);
    } finally {
      signal.removeEventListener('abort', destroy);
      destroy();
    }
  }

  /** 渲染进程传来的打印机名在交给系统命令之前，必须是系统里真实存在的打印机。 */
  async hasPrinter(printerName: string): Promise<boolean> {
    return (await this.knownPrinters()).some((printer) => printer.name === printerName);
  }

  async knownPrinterNames(): Promise<string[]> {
    return (await this.knownPrinters()).map((printer) => printer.name);
  }

  private async knownPrinters(): Promise<PrinterInfo[]> {
    if (this.cache && this.clock.now() - this.cache.at < PRINTER_LIST_TTL_MS) {
      return this.cache.printers;
    }
    return this.listPrinters();
  }
}

/** 窗口被中止销毁后 print 回调可能永远不来，所以 abort 时也要结束这个 Promise，不留悬挂的任务。 */
function printSilently(
  webContents: WebContents,
  deviceName: string,
  pageSize: { width: number; height: number },
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
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
        signal.removeEventListener('abort', onAbort);
        if (success) {
          resolve();
        } else {
          reject(new PrintError('PRINT_ERROR', failureReason));
        }
      },
    );
  });
}
