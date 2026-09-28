import { describe, expect, test } from 'bun:test';
import type { IntentTimers } from './hover-intent';
import { IdleWatcher, isScannerCharacter, SCAN_FOCUS_IDLE_MS } from './scan-focus';

const KEY = { ctrlKey: false, altKey: false, metaKey: false };

describe('isScannerCharacter', () => {
  test('accepts the printable characters a scanner types', () => {
    for (const key of ['C', 'l', '5', '-', '图']) {
      expect(isScannerCharacter({ ...KEY, key })).toBe(true);
    }
  });

  test('leaves shortcuts, navigation and space to the focused control', () => {
    expect(isScannerCharacter({ ...KEY, key: 'Enter' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'F2' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'Tab' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: ' ' })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'c', ctrlKey: true })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'a', metaKey: true })).toBe(false);
    expect(isScannerCharacter({ ...KEY, key: 'x', altKey: true })).toBe(false);
  });
});

/** 可手动推进的假时钟：advance 按到期顺序触发计时器，并同步推进 now()。 */
function createClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: IntentTimers = {
    set(callback, ms) {
      const handle = nextHandle++;
      pending.set(handle, { at: now + ms, callback });
      return handle;
    },
    clear(handle) {
      pending.delete(handle);
    },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...pending].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      const [handle, timer] = due;
      now = timer.at;
      pending.delete(handle);
      timer.callback();
    }
    now = target;
  };
  return { timers, advance, now: () => now };
}

describe('IdleWatcher', () => {
  test('fires once the operator has been idle for the whole period', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(SCAN_FOCUS_IDLE_MS, () => idle++, clock.timers, clock.now);
    watcher.activity();
    clock.advance(SCAN_FOCUS_IDLE_MS - 1);
    expect(idle).toBe(0);
    clock.advance(1);
    expect(idle).toBe(1);
  });

  test('every activity restarts the period', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(10_000, () => idle++, clock.timers, clock.now);
    watcher.activity();
    clock.advance(6_000);
    watcher.activity();
    clock.advance(6_000);
    expect(idle).toBe(0);
    clock.advance(4_000);
    expect(idle).toBe(1);
  });

  test('fires again only after new activity followed by another idle period', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(10_000, () => idle++, clock.timers, clock.now);
    watcher.activity();
    clock.advance(30_000);
    expect(idle).toBe(1);
    watcher.activity();
    clock.advance(10_000);
    expect(idle).toBe(2);
  });

  test('stops after dispose', () => {
    const clock = createClock();
    let idle = 0;
    const watcher = new IdleWatcher(10_000, () => idle++, clock.timers, clock.now);
    watcher.activity();
    watcher.dispose();
    clock.advance(20_000);
    expect(idle).toBe(0);
  });
});
