import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../src/core/testing/fake-clock';
import { TokenBucket } from './token-bucket';

describe('TokenBucket', () => {
  test('allows a burst, then refuses', () => {
    const bucket = new TokenBucket(5, 3, new FakeClock());
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true, false]);
  });

  test('refills at the given rate', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(5, 3, clock);
    for (let index = 0; index < 3; index += 1) {
      bucket.take();
    }
    clock.advance(200);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  test('never holds more than the burst', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(5, 3, clock);
    clock.advance(60_000);
    const taken = Array.from({ length: 5 }, () => bucket.take()).filter(Boolean);
    expect(taken).toHaveLength(3);
  });
});
