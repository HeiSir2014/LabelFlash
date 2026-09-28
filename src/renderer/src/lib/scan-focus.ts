import type { IntentTimers } from './hover-intent';

/** 鼠标和键盘都这么久没动，就把焦点还给扫码框（设置、模板编辑里也一样）。 */
export const SCAN_FOCUS_IDLE_MS = 10_000;

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * 扫码枪「打字」的按键：单个可打印字符，没有 Ctrl / Alt / Meta。
 * 空格除外：焦点在开关、按钮上时，空格是用来操作它们的。
 */
export function isScannerCharacter(event: KeyInfo): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * 空闲检测：activity() 记录一次操作；最近一次操作之后满 idleMs 没有新操作时调用 onIdle 一次。
 * 鼠标移动很频繁，所以只记时间，不在每次移动时重建计时器。
 */
export class IdleWatcher {
  private timer: number | null = null;
  private lastActivity = 0;

  constructor(
    private readonly idleMs: number,
    private readonly onIdle: () => void,
    private readonly timers: IntentTimers,
    private readonly now: () => number = Date.now,
  ) {}

  activity(): void {
    this.lastActivity = this.now();
    if (this.timer === null) {
      this.schedule(this.idleMs);
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    this.timer = this.timers.set(() => this.check(), ms);
  }

  /** 到点时如果期间又有操作，就只补足剩下的时间，不重新从头计时。 */
  private check(): void {
    this.timer = null;
    const idleFor = this.now() - this.lastActivity;
    if (idleFor >= this.idleMs) {
      this.onIdle();
    } else {
      this.schedule(this.idleMs - idleFor);
    }
  }
}
