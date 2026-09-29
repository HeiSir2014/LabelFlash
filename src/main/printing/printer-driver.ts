import type { PrinterAdapter } from '../../core/types';

/** 主进程用到的打印机能力：真的适配器（electron-driver-adapter.ts）和 E2E 的假打印机（fake-printers.ts）都实现它。 */
export interface PrinterDriver extends PrinterAdapter {
  /** 渲染进程、设置和模板给的打印机名在交给系统命令之前，必须是系统里真实存在的打印机。 */
  hasPrinter(printerName: string): Promise<boolean>;
  /** 系统里的打印机名（打印时用的短时缓存）。 */
  knownPrinterNames(): Promise<string[]>;
}
