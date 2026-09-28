import type { Clock } from '../../src/core/types';

const MS_PER_SECOND = 1_000;

/** 令牌桶：平均每秒 ratePerSecond 个，最多攒 burst 个。 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    private readonly clock: Clock,
  ) {
    this.tokens = burst;
    this.updatedAt = clock.now();
  }

  take(): boolean {
    const now = this.clock.now();
    // 时钟往回走（例如系统校时）时不能扣掉额度，否则这个连接要被拒很久。
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.ratePerSecond) / MS_PER_SECOND);
    this.updatedAt = now;
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}
