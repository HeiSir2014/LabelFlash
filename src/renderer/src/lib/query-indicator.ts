import type { Timers } from './timers';

/**
 * 「正在查询」提示：一次扫码的预览超过 delayMs 还没回来才显示（通常是查找表或接口查询），
 * 快的扫码不闪一下。每次扫码有一个递增序号，只有最新的那一次能改提示：
 * 旧扫码的计时到点或查询结束时，不能盖掉新扫码的状态。
 */
export class QueryIndicator {
  private latest = 0;
  private timer: number | null = null;

  constructor(
    private readonly delayMs: number,
    /** 提示变化：正在查询的内容，或 null（不显示）。 */
    private readonly onChange: (raw: string | null) => void,
    private readonly timers: Timers,
  ) {}

  /** 开始一次查询，返回它的序号。 */
  start(raw: string): number {
    this.latest += 1;
    const seq = this.latest;
    this.clearTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.onChange(raw);
    }, this.delayMs);
    return seq;
  }

  /** 这次查询结束（不论成败）。只有最新的一次会收起提示。 */
  finish(seq: number): void {
    if (seq !== this.latest) {
      return;
    }
    this.clearTimer();
    this.onChange(null);
  }

  isLatest(seq: number): boolean {
    return seq === this.latest;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }
}
