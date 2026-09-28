import { describe, expect, test } from 'bun:test';
import { QueryIndicator } from './query-indicator';
import type { Timers } from './timers';

const DELAY_MS = 200;

/** 假计时器：由测试决定何时到点。 */
function fakeTimers() {
  let next = 0;
  const pending = new Map<number, () => void>();
  const timers: Timers = {
    set: (callback) => {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  const fireAll = () => {
    for (const [handle, callback] of [...pending]) {
      pending.delete(handle);
      callback();
    }
  };
  return { timers, fireAll, pendingCount: () => pending.size };
}

function setup() {
  const clock = fakeTimers();
  const shown: (string | null)[] = [];
  const indicator = new QueryIndicator(DELAY_MS, (raw) => shown.push(raw), clock.timers);
  return { clock, shown, indicator };
}

describe('QueryIndicator', () => {
  test('stays quiet when the query answers before the delay', () => {
    const { clock, shown, indicator } = setup();
    const seq = indicator.start('A');
    indicator.finish(seq);
    clock.fireAll();
    expect(shown).toEqual([null]);
  });

  test('shows the content being queried once the delay passes, and clears it when done', () => {
    const { clock, shown, indicator } = setup();
    const seq = indicator.start('A');
    clock.fireAll();
    expect(shown).toEqual(['A']);
    indicator.finish(seq);
    expect(shown).toEqual(['A', null]);
  });

  test('ignores an older scan that finishes after a newer one started', () => {
    const { clock, shown, indicator } = setup();
    const first = indicator.start('A');
    const second = indicator.start('B');
    expect(clock.pendingCount()).toBe(1);
    indicator.finish(first);
    expect(shown).toEqual([]);
    clock.fireAll();
    expect(shown).toEqual(['B']);
    expect(indicator.isLatest(first)).toBe(false);
    expect(indicator.isLatest(second)).toBe(true);
    indicator.finish(second);
    expect(shown).toEqual(['B', null]);
  });
});
