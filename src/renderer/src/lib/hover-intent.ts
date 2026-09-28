/** 指针在模板上停留这么久才预览：一扫而过不会让预览来回跳。 */
export const HOVER_PREVIEW_DELAY_MS = 1_000;

export interface IntentTimers {
  set(callback: () => void, ms: number): number;
  clear(handle: number): void;
}

/** 界面里用的真实计时器；测试注入假时钟。 */
export const WINDOW_TIMERS: IntentTimers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle),
};

/**
 * 悬停意图：进入某一项后停留满 delayMs 才上报；在项之间移动时保留当前上报的项，
 * 直到新的一项停留满时间；离开整个列表时立即清除（上报 null）。
 */
export class HoverIntent<T> {
  private timer: number | null = null;
  private current: T | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly onChange: (value: T | null) => void,
    private readonly timers: IntentTimers,
  ) {}

  enter(value: T): void {
    this.cancelPending();
    if (value === this.current) {
      return;
    }
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.current = value;
      this.onChange(value);
    }, this.delayMs);
  }

  leave(): void {
    this.cancelPending();
    if (this.current !== null) {
      this.current = null;
      this.onChange(null);
    }
  }

  private cancelPending(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }
}
