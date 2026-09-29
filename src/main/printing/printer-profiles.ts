import type { Clock } from '../../core/types';
import type { DriverPaper } from '../../shared/driver-paper';
import { DEFAULT_PRINTER_DPI } from './qr-code';

/** 驱动设置很少变；1 分钟内重复打印、预览不必每次都去查（Windows 上一次查询约耗 1 秒 CPU）。 */
export const PRINTER_PROFILE_TTL_MS = 60_000;
/** 读不到（查询失败、超时）的结果只记这么久：打印机可能刚接上或探测进程刚重启，很快再试。 */
export const FAILED_READ_TTL_MS = 5_000;
/** 打印时最多等驱动资料这么久：冷查询最长约 10 秒（PROBE_QUERY_TIMEOUT_MS），不能拖慢出纸；等不到用上次读到的，或 203dpi。 */
export const PROFILE_WAIT_MS = 1_000;

interface Entry {
  expiresAt: number;
  paper: Promise<DriverPaper | null>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 每台打印机的驱动默认纸张和分辨率，短时缓存。查询失败按「读不到」处理，不影响打印。 */
export class PrinterProfiles {
  private readonly entries = new Map<string, Entry>();
  /** 每台最近一次读到的资料：缓存过期、重新读取还没回来时，打印先用它。 */
  private readonly lastKnown = new Map<string, DriverPaper>();

  constructor(
    private readonly read: (printerName: string) => Promise<DriverPaper | null>,
    private readonly clock: Clock,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  get(printerName: string): Promise<DriverPaper | null> {
    const cached = this.entries.get(printerName);
    if (cached && this.clock.now() < cached.expiresAt) {
      return cached.paper;
    }
    return this.fresh(printerName);
  }

  /** 不用缓存，现读一次（界面核对驱动纸张时：操作员可能刚在系统设置里改过）；读到的结果照常缓存。 */
  fresh(printerName: string): Promise<DriverPaper | null> {
    const entry: Entry = { expiresAt: this.clock.now() + PRINTER_PROFILE_TTL_MS, paper: Promise.resolve(null) };
    entry.paper = this.read(printerName)
      .catch((error: unknown) => {
        console.warn(`[PrinterProfiles] cannot read the driver paper of ${printerName}`, error);
        return null;
      })
      .then((paper) => {
        if (paper === null) {
          entry.expiresAt = this.clock.now() + FAILED_READ_TTL_MS;
        } else {
          this.lastKnown.set(printerName, paper);
        }
        return paper;
      });
    this.entries.set(printerName, entry);
    return entry.paper;
  }

  /** 打印用的分辨率：限时等待；等不到或读不到时用上次读到的，从没读到过按 203dpi。 */
  async dpiOf(printerName: string): Promise<number> {
    // 等不到时按「这次没读到」处理（undefined），和读失败（null）一样退回上次读到的。
    const paper = await Promise.race([this.get(printerName), this.wait(PROFILE_WAIT_MS).then(() => undefined)]);
    const known = paper ?? this.lastKnown.get(printerName);
    return known?.dpi ?? DEFAULT_PRINTER_DPI;
  }

  /** 操作员刚在打印首选项里改过设置：下次重新读。 */
  forget(printerName: string): void {
    this.entries.delete(printerName);
  }
}
