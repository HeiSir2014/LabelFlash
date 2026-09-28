import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../../core/testing/fake-clock';
import { ALERT_COOLDOWN_MS, AlertThrottle, MAX_ALERTS_PER_KIND_PER_DAY } from './alert-throttle';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('AlertThrottle', () => {
  test('suppresses the same kind during the cooldown, but not other kinds', () => {
    const clock = new FakeClock(new Date(2026, 8, 28, 9, 0).getTime());
    const throttle = new AlertThrottle(clock);
    expect(throttle.shouldNotify('缺纸')).toBe(true);
    clock.advance(ALERT_COOLDOWN_MS - 1);
    expect(throttle.shouldNotify('缺纸')).toBe(false);
    expect(throttle.shouldNotify('打印机离线')).toBe(true);
    clock.advance(1);
    expect(throttle.shouldNotify('缺纸')).toBe(true);
  });

  test('caps each kind per local day and resets the next day', () => {
    const clock = new FakeClock(new Date(2026, 8, 28, 9, 0).getTime());
    const throttle = new AlertThrottle(clock);
    for (let i = 0; i < MAX_ALERTS_PER_KIND_PER_DAY; i += 1) {
      expect(throttle.shouldNotify('卡纸')).toBe(true);
      clock.advance(ALERT_COOLDOWN_MS);
    }
    expect(throttle.shouldNotify('卡纸')).toBe(false);
    clock.advance(DAY_MS);
    expect(throttle.shouldNotify('卡纸')).toBe(true);
  });
});
