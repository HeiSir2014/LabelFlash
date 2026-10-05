import type { CommandSetName } from '../../core/diagnosis/diagnosis-model';
import { PrintError } from '../../core/errors';
import type { LabelJob, PrinterInfo } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { paperKey } from '../../shared/paper-sizes';
import type { RawSendFailureKind } from '../../shared/printer-commands';
import type { PrinterReadiness } from '../../shared/printer-readiness';
import type { PrinterDriver } from './printer-driver';
import type { RawSendResult } from './raw-sender';

/**
 * 仅开发 / E2E 可用：用假打印机代替系统打印机，验证多台打印机的分配（E2E 里没有真打印机）。
 * 值是 FakePrinterSpec 数组的 JSON。安装版忽略它，和 CDL_LABELFLASH_USER_DATA 一样。
 */
export const FAKE_PRINTERS_ENV = 'CDL_LABELFLASH_FAKE_PRINTERS';

/** 假打印机在诊断里的样子（都可以不填，不填就是「一切正常」）。 */
export interface FakeDiagnosisSpec {
  /** 后台打印服务：Windows 上是 Spooler 停了；macOS 上是这台在 CUPS 里被暂停了。任何一台写 stopped 都算。 */
  spooler?: 'running' | 'stopped';
  usb?: 'present' | 'disconnected' | 'not-found' | 'not-usb';
  /** 队列里卡住的任务：本程序的（记进账本）和别人的。 */
  stuckJobs?: { ours: number; others: number };
  /** false：驱动里没有这种纸，也不能自定义。 */
  paperSettable?: boolean;
  /** 假的管理员确认框：allow 点了「是」，decline 点了「否」。 */
  adminPrompt?: 'allow' | 'decline';
  /** 5a 的指令集；不填是 tspl。 */
  commandSet?: CommandSetName | 'none';
}

export interface FakePrinterSpec {
  name: string;
  /** 驱动默认纸张；null = 读不到。 */
  paper: DriverPaper | null;
  /** 状态；null = 未知。 */
  readiness: PrinterReadiness | null;
  /** 驱动名：「自动」按它认指令集；不设 = 读不到。 */
  driverName?: string;
  /** 设了就让标签机指令按这个原因发送失败（E2E、视觉验收看失败提示）。 */
  rawFailure?: RawSendFailureKind;
  /** 诊断用（见 FakeDiagnosisSpec）。 */
  diagnosis?: FakeDiagnosisSpec;
}

/** 假打印机收到的一张。 */
export interface FakePrint {
  printerName: string;
  raw: string;
  paper: string;
  templateId: string;
}

/** 假打印机收到的一次标签机指令：字节按 latin1 转成文字（指令都是 ASCII，E2E 直接比对文字）。 */
export interface FakeRawJob {
  printerName: string;
  text: string;
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
  readonly rawJobs: FakeRawJob[] = [];

  /** 诊断「自动设置驱动纸张」改过的驱动纸张。 */
  private readonly paperOverrides = new Map<string, DriverPaper>();

  constructor(private readonly specs: readonly FakePrinterSpec[]) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.specs.map(({ name }) => ({ name, displayName: name }));
  }

  async driverPaper(name: string): Promise<DriverPaper | null> {
    return this.paperOverrides.get(name) ?? this.find(name)?.paper ?? null;
  }

  setDriverPaper(name: string, paper: DriverPaper): void {
    this.paperOverrides.set(name, paper);
  }

  async readiness(name: string): Promise<PrinterReadiness | null> {
    return this.find(name)?.readiness ?? null;
  }

  /** 驱动名（DriverHints、guessFromDriverName 都按它查）；读不到为 null。 */
  async driverName(name: string): Promise<string | null> {
    return this.find(name)?.driverName ?? null;
  }

  /** 和真的发送方式一样回答：找不到、按 spec 失败，或记下来。 */
  async sendRaw(printerName: string, data: Uint8Array): Promise<RawSendResult> {
    const spec = this.find(printerName);
    if (!spec) {
      return { ok: false, failure: { kind: 'not-found', detail: `Printer not found: ${printerName}` } };
    }
    if (spec.rawFailure !== undefined) {
      return { ok: false, failure: { kind: spec.rawFailure, detail: `fake ${spec.rawFailure}` } };
    }
    this.rawJobs.push({ printerName, text: Buffer.from(data).toString('latin1') });
    return { ok: true };
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
