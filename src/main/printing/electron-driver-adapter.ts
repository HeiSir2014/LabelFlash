import { BrowserWindow, type WebContents } from 'electron';
import { PrintError } from '../../core/errors';
import type { Clock, LabelJob, PrinterAdapter, PrinterInfo } from '../../core/types';
import { LABEL_PAPER_MM } from '../../shared/label-paper';
import { renderLabelHtml } from './label-html';
import type { PrinterStatusMonitor } from './printer-status';

const MICRONS_PER_MM = 1_000;
/** 打印时用的打印机列表缓存；界面上的「刷新」总是取最新列表。 */
const PRINTER_LIST_TTL_MS = 5_000;

interface PrinterListCache {
  at: number;
  printers: PrinterInfo[];
}

/** 通过打印机驱动静默打印：隐藏窗口渲染标签 HTML，然后调用 webContents.print。 */
export class ElectronDriverAdapter implements PrinterAdapter {
  private cache: PrinterListCache | null = null;

  constructor(
    private readonly getWebContents: () => WebContents,
    private readonly status: PrinterStatusMonitor,
    private readonly clock: Clock,
  ) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const printers = (await this.getWebContents().getPrintersAsync())
      .map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
    this.cache = { at: this.clock.now(), printers };
    return printers;
  }

  async print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void> {
    if (!(await this.knownPrinters()).some((printer) => printer.name === printerName)) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    const readiness = this.status.get(printerName);
    if (readiness && !readiness.ready) {
      throw new PrintError('PRINTER_NOT_READY', `Printer not ready: ${printerName}`, readiness.detail);
    }
    const html = await renderLabelHtml(job);
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
      await printSilently(printWindow.webContents, printerName, signal);
    } finally {
      signal.removeEventListener('abort', destroy);
      destroy();
    }
  }

  private async knownPrinters(): Promise<PrinterInfo[]> {
    if (this.cache && this.clock.now() - this.cache.at < PRINTER_LIST_TTL_MS) {
      return this.cache.printers;
    }
    return this.listPrinters();
  }
}

/** 窗口被中止销毁后 print 回调可能永远不来，所以 abort 时也要结束这个 Promise，不留悬挂的任务。 */
function printSilently(webContents: WebContents, deviceName: string, signal: AbortSignal): Promise<void> {
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
        pageSize: { width: LABEL_PAPER_MM.width * MICRONS_PER_MM, height: LABEL_PAPER_MM.height * MICRONS_PER_MM },
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
