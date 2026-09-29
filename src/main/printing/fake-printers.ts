import { PrintError } from '../../core/errors';
import type { LabelJob, PrinterInfo } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { paperKey } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';
import type { PrinterDriver } from './printer-driver';

/**
 * 仅开发 / E2E 可用：用假打印机代替系统打印机，验证多台打印机的分配（E2E 里没有真打印机）。
 * 值是 FakePrinterSpec 数组的 JSON。安装版忽略它，和 CDL_LABELFLASH_USER_DATA 一样。
 */
export const FAKE_PRINTERS_ENV = 'CDL_LABELFLASH_FAKE_PRINTERS';

export interface FakePrinterSpec {
  name: string;
  /** 驱动默认纸张；null = 读不到。 */
  paper: DriverPaper | null;
  /** 状态；null = 未知。 */
  readiness: PrinterReadiness | null;
}

/** 假打印机收到的一张。 */
export interface FakePrint {
  printerName: string;
  raw: string;
  paper: string;
  templateId: string;
}

export function parseFakePrinters(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
): FakePrinterSpec[] | null {
  const value = env[FAKE_PRINTERS_ENV];
  if (isPackaged || value === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isSpec)) {
    throw new Error(`${FAKE_PRINTERS_ENV} must be a JSON array of { name, paper, readiness }`);
  }
  return parsed;
}

function isSpec(value: unknown): value is FakePrinterSpec {
  return typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string';
}

/** 假打印机：有名字、驱动纸张和状态；打印只记下来。 */
export class FakePrinters {
  readonly printed: FakePrint[] = [];

  constructor(private readonly specs: readonly FakePrinterSpec[]) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.specs.map(({ name }) => ({ name, displayName: name }));
  }

  async driverPaper(name: string): Promise<DriverPaper | null> {
    return this.find(name)?.paper ?? null;
  }

  async readiness(name: string): Promise<PrinterReadiness | null> {
    return this.find(name)?.readiness ?? null;
  }

  async print(printerName: string, job: LabelJob, _signal: AbortSignal): Promise<void> {
    if (!this.find(printerName)) {
      throw new PrintError('PRINTER_NOT_FOUND', `Printer not found: ${printerName}`);
    }
    this.printed.push({
      printerName,
      raw: job.scan.raw,
      paper: paperKey(job.template.paper),
      templateId: job.template.id,
    });
  }

  private find(name: string): FakePrinterSpec | undefined {
    return this.specs.find((spec) => spec.name === name);
  }
}

/** 用假打印机实现主进程的打印机能力；和真的适配器一样，不能打印的打印机直接拒绝。 */
export class FakeDriverAdapter implements PrinterDriver {
  constructor(private readonly printers: FakePrinters) {}

  listPrinters(): Promise<PrinterInfo[]> {
    return this.printers.listPrinters();
  }

  async hasPrinter(printerName: string): Promise<boolean> {
    return (await this.knownPrinterNames()).includes(printerName);
  }

  async knownPrinterNames(): Promise<string[]> {
    return (await this.printers.listPrinters()).map((printer) => printer.name);
  }

  async print(printerName: string, job: LabelJob, signal: AbortSignal): Promise<void> {
    const readiness = await this.printers.readiness(printerName);
    if (readiness && !readiness.ready) {
      throw new PrintError('PRINTER_NOT_READY', `Printer not ready: ${printerName}`, {
        detail: readiness.detail,
        issue: readiness.issue,
      });
    }
    await this.printers.print(printerName, job, signal);
  }
}
