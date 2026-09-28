import type { Clock } from '../../core/types';

/** 同一类问题 30 分钟内不重复提醒。 */
export const ALERT_COOLDOWN_MS = 30 * 60_000;
/** 同一类问题每天最多提醒 2 次：无人处理时不反复打扰。 */
export const MAX_ALERTS_PER_KIND_PER_DAY = 2;

interface KindHistory {
  day: string;
  countToday: number;
  lastAt: number;
}

/** 打印机异常通知的节流：冷却时间 + 每日上限，避免误报刷屏。 */
export class AlertThrottle {
  private readonly history = new Map<string, KindHistory>();

  constructor(private readonly clock: Clock) {}

  /** 返回是否应该提醒；返回 true 时同时记下这次提醒。 */
  shouldNotify(kind: string): boolean {
    const now = this.clock.now();
    const day = localDay(now);
    const previous = this.history.get(kind);
    const countToday = previous?.day === day ? previous.countToday : 0;
    if (previous && now - previous.lastAt < ALERT_COOLDOWN_MS) {
      return false;
    }
    if (countToday >= MAX_ALERTS_PER_KIND_PER_DAY) {
      return false;
    }
    this.history.set(kind, { day, countToday: countToday + 1, lastAt: now });
    return true;
  }
}

function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
