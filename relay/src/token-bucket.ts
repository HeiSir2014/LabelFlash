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
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.updatedAt) * this.ratePerSecond) / MS_PER_SECOND);
    this.updatedAt = now;
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}
