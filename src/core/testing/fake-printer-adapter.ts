import type { LabelJob, PrinterAdapter, PrinterInfo } from '../types';

export class FakePrinterAdapter implements PrinterAdapter {
  readonly printed: Array<{ printerName: string; raw: string; templateId: string }> = [];
  printers: PrinterInfo[] = [{ name: '热敏标签机', displayName: '热敏标签机' }];
  private nextError: unknown = null;
  private gate: Promise<void> | null = null;

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.printers;
  }

  async print(printerName: string, job: LabelJob): Promise<void> {
    if (this.gate) {
      await this.gate;
    }
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    this.printed.push({ printerName, raw: job.label.raw, templateId: job.template.id });
  }

  failNext(error: unknown): void {
    this.nextError = error;
  }

  /** 让后续 print 挂起，直到调用返回的 release()。 */
  hold(): () => void {
    let release: () => void = () => {};
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = null;
      release();
    };
  }
}
