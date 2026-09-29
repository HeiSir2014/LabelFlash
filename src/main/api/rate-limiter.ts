import type { Clock } from '../../core/types';

const MS_PER_SECOND = 1_000;

export interface RateLimits {
  /** 稳定速率：每秒补充的请求数。 */
  perSecond: number;
  /** 桶的容量：允许的突发请求数。 */
  burst: number;
}

/** 每个调用方一个令牌桶：一个调用方出错反复提交时，挡住的是它自己，不影响别的调用方。 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly limits: RateLimits,
  ) {}

  /** 取一个令牌；取不到（超速）返回 false。 */
  take(callerId: string): boolean {
    const now = this.clock.now();
    const bucket = this.buckets.get(callerId) ?? { tokens: this.limits.burst, at: now };
    const refilled = Math.min(
      this.limits.burst,
      bucket.tokens + ((now - bucket.at) / MS_PER_SECOND) * this.limits.perSecond,
    );
    const allowed = refilled >= 1;
    this.buckets.set(callerId, { tokens: allowed ? refilled - 1 : refilled, at: now });
    return allowed;
  }
}
