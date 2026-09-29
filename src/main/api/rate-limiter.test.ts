import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { RateLimiter } from './rate-limiter';

const LIMITS = { perSecond: 20, burst: 40 };

function takeMany(limiter: RateLimiter, callerId: string, count: number): number {
  let allowed = 0;
  for (let i = 0; i < count; i += 1) {
    if (limiter.take(callerId)) {
      allowed += 1;
    }
  }
  return allowed;
}

describe('RateLimiter', () => {
  test('allows a burst, then refuses', () => {
    const limiter = new RateLimiter(new FakeClock(), LIMITS);
    expect(takeMany(limiter, 'key:k1', 41)).toBe(40);
  });

  test('refills at the steady rate', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, LIMITS);
    takeMany(limiter, 'key:k1', 40);
    clock.advance(1_000);
    expect(takeMany(limiter, 'key:k1', 21)).toBe(20);
  });

  // 一个调用方出错反复提交时，挡住的是它自己，不影响别的调用方。
  test('keeps a bucket per caller', () => {
    const limiter = new RateLimiter(new FakeClock(), LIMITS);
    takeMany(limiter, 'key:k1', 40);
    expect(limiter.take('key:k2')).toBe(true);
  });
});
