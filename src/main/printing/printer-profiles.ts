import type { Clock } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { DEFAULT_PRINTER_DPI } from './qr-code';

/** 驱动设置很少变；1 分钟内重复打印、预览不必每次都去查（Windows 上一次查询约耗 1 秒 CPU）。 */
export const PRINTER_PROFILE_TTL_MS = 60_000;
/** 打印时最多等驱动资料这么久：冷查询最长约 10 秒（PROBE_QUERY_TIMEOUT_MS），不能拖慢出纸；等不到按 203dpi。 */
export const PROFILE_WAIT_MS = 1_000;

interface Entry {
  at: number;
  paper: Promise<DriverPaper | null>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 每台打印机的驱动默认纸张和分辨率，短时缓存。查询失败按「读不到」处理，不影响打印。 */
export class PrinterProfiles {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly read: (printerName: string) => Promise<DriverPaper | null>,
    private readonly clock: Clock,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  get(printerName: string): Promise<DriverPaper | null> {
    const cached = this.entries.get(printerName);
    if (cached && this.clock.now() - cached.at < PRINTER_PROFILE_TTL_MS) {
      return cached.paper;
    }
    const paper = this.read(printerName).catch((error: unknown) => {
      console.warn(`[PrinterProfiles] cannot read the driver paper of ${printerName}`, error);
      return null;
    });
    this.entries.set(printerName, { at: this.clock.now(), paper });
    return paper;
  }

  /** 打印用的分辨率：限时等待，等不到或读不到按 203dpi。 */
  async dpiOf(printerName: string): Promise<number> {
    const paper = await Promise.race([this.get(printerName), this.wait(PROFILE_WAIT_MS).then(() => null)]);
    return paper?.dpi ?? DEFAULT_PRINTER_DPI;
  }

  /** 操作员刚在打印首选项里改过设置：下次重新读。 */
  forget(printerName: string): void {
    this.entries.delete(printerName);
  }
}
