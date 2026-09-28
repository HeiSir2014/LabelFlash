import type { Clock, RecentPrint } from './types';

export const MAX_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type Reservation = { ok: true } | { ok: false; recent: RecentPrint };

/**
 * 同一二维码的时间窗口门限。
 * 所有方法都是同步的：Node 单线程保证 tryReserve 是原子操作，
 * 多个入口同时扫同一个码时只有一个能占位成功。
 */
export class DedupGuard {
  private readonly printedAt = new Map<string, number>();
  private readonly reservedAt = new Map<string, number>();
  private currentWindowMs: number;

  constructor(
    private readonly clock: Clock,
    windowMs: number,
  ) {
    this.currentWindowMs = clampWindow(windowMs);
  }

  get windowMs(): number {
    return this.currentWindowMs;
  }

  setWindowMs(windowMs: number): void {
    this.currentWindowMs = clampWindow(windowMs);
  }

  /** 只读：正在打印，或窗口期内已打印，返回对应状态；否则 null。 */
  peek(key: string): RecentPrint | null {
    const reserved = this.reservedAt.get(key);
    if (reserved !== undefined) {
      return { state: 'printing', at: reserved };
    }
    const printed = this.printedAt.get(key);
    if (printed !== undefined && this.clock.now() - printed < this.currentWindowMs) {
      return { state: 'printed', at: printed };
    }
    return null;
  }

  tryReserve(key: string, force: boolean): Reservation {
    const recent = this.peek(key);
    if (recent && (recent.state === 'printing' || !force)) {
      return { ok: false, recent };
    }
    this.reservedAt.set(key, this.clock.now());
    return { ok: true };
  }

  /** 打印已交给打印机（或结果不确定）：记为已打印。 */
  commit(key: string): void {
    this.reservedAt.delete(key);
    this.printedAt.set(key, this.clock.now());
    this.pruneExpired();
  }

  /** 确定没有出纸：释放占位，允许立即重试。 */
  release(key: string): void {
    this.reservedAt.delete(key);
  }

  restore(key: string, printedAt: number): void {
    const current = this.printedAt.get(key);
    if (current === undefined || printedAt > current) {
      this.printedAt.set(key, printedAt);
    }
  }

  /** 按最大窗口清理：之后调大窗口时，旧记录仍然有效。 */
  private pruneExpired(): void {
    const now = this.clock.now();
    for (const [key, printedAt] of this.printedAt) {
      if (now - printedAt >= MAX_DEDUP_WINDOW_MS) {
        this.printedAt.delete(key);
      }
    }
  }
}

function clampWindow(windowMs: number): number {
  return Math.min(MAX_DEDUP_WINDOW_MS, Math.max(0, windowMs));
}
