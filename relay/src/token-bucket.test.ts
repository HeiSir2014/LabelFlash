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

  test('keeps its tokens when the clock steps back', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(5, 3, clock);
    clock.advance(-60_000);
    expect(bucket.take()).toBe(true);
  });

  test('takes several tokens at once and refuses when fewer are left', () => {
    const bucket = new TokenBucket(5, 10, new FakeClock());
    expect(bucket.take(6)).toBe(true);
    expect(bucket.take(6)).toBe(false);
    expect(bucket.take(4)).toBe(true);
  });

  test('never holds more than the burst', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(5, 3, clock);
    clock.advance(60_000);
    const taken = Array.from({ length: 5 }, () => bucket.take()).filter(Boolean);
    expect(taken).toHaveLength(3);
  });
});
