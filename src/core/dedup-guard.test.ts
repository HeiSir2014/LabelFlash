import { beforeEach, describe, expect, test } from 'bun:test';
import { DedupGuard, MAX_DEDUP_WINDOW_MS } from './dedup-guard';
import { FakeClock } from './testing/fake-clock';

const WINDOW_MS = 10 * 60_000;
const KEY = 'CL5640-TK-图片色-XL';

describe('DedupGuard', () => {
  let clock: FakeClock;
  let guard: DedupGuard;

  beforeEach(() => {
    clock = new FakeClock();
    guard = new DedupGuard(clock, WINDOW_MS);
  });

  function printOnce(): number {
    guard.tryReserve(KEY, false);
    guard.commit(KEY);
    return clock.now();
  }

  test('allows the first reservation', () => {
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('blocks a second reservation while the first is still printing', () => {
    const reservedAt = clock.now();
    guard.tryReserve(KEY, false);
    clock.advance(500);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printing', at: reservedAt } });
  });

  test('force does not bypass a print that is still in flight', () => {
    guard.tryReserve(KEY, false);
    expect(guard.tryReserve(KEY, true).ok).toBe(false);
  });

  test('blocks inside the window after a successful print', () => {
    const printedAt = printOnce();
    clock.advance(WINDOW_MS - 1);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: printedAt } });
  });

  test('allows again once the window has passed', () => {
    printOnce();
    clock.advance(WINDOW_MS);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('release after a failed print allows an immediate retry', () => {
    guard.tryReserve(KEY, false);
    guard.release(KEY);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('force bypasses the window after a successful print', () => {
    printOnce();
    expect(guard.tryReserve(KEY, true)).toEqual({ ok: true });
  });

  test('a zero window turns the threshold off', () => {
    guard.setWindowMs(0);
    printOnce();
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('shrinking the window takes effect immediately', () => {
    printOnce();
    clock.advance(2 * 60_000);
    guard.setWindowMs(60_000);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: true });
  });

  test('clamps the window to the supported range', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS * 2);
    expect(guard.windowMs).toBe(MAX_DEDUP_WINDOW_MS);
    guard.setWindowMs(-1);
    expect(guard.windowMs).toBe(0);
  });

  test('peek distinguishes printing from printed and never reserves', () => {
    expect(guard.peek(KEY)).toBeNull();
    guard.tryReserve(KEY, false);
    expect(guard.peek(KEY)?.state).toBe('printing');
    guard.commit(KEY);
    expect(guard.peek(KEY)?.state).toBe('printed');
    expect(guard.peek('OTHER-红-1')).toBeNull();
    expect(guard.tryReserve('OTHER-红-1', false)).toEqual({ ok: true });
  });

  test('restore seeds the window after a restart and keeps the latest timestamp', () => {
    const latest = clock.now() - 1_000;
    guard.restore(KEY, latest);
    guard.restore(KEY, latest - 5_000);
    expect(guard.tryReserve(KEY, false)).toEqual({ ok: false, recent: { state: 'printed', at: latest } });
  });

  test('forgets prints older than the maximum window', () => {
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS);
    printOnce();
    clock.advance(MAX_DEDUP_WINDOW_MS);
    guard.tryReserve('OTHER-红-1', false);
    guard.commit('OTHER-红-1');
    guard.setWindowMs(MAX_DEDUP_WINDOW_MS);
    expect(guard.peek(KEY)).toBeNull();
  });
});
