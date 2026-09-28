/** 计时器接口：扫码焦点、多行扫码拼接这类按时间判断的逻辑经它计时，测试注入假时钟。 */
export interface Timers {
  set(callback: () => void, ms: number): number;
  clear(handle: number): void;
}

/** 界面里用的真实计时器。 */
export const WINDOW_TIMERS: Timers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle),
};
