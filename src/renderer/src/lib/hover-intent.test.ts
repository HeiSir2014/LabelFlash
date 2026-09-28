import { describe, expect, test } from 'bun:test';
import { HoverIntent, type IntentTimers } from './hover-intent';

const DELAY_MS = 1_000;

/** 手动推进的假计时器：只保留一个待触发的回调（HoverIntent 同一时间最多一个）。 */
function createFakeTimers() {
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
    now += ms;
    for (const [handle, timer] of [...pending]) {
      if (timer.at <= now) {
        pending.delete(handle);
        timer.callback();
      }
    }
  };
  return { timers, advance };
}

function setup() {
  const { timers, advance } = createFakeTimers();
  const changes: Array<string | null> = [];
  const intent = new HoverIntent<string>(DELAY_MS, (value) => changes.push(value), timers);
  return { intent, advance, changes };
}

describe('HoverIntent', () => {
  test('reports a row only after the pointer rests on it for the whole delay', () => {
    const { intent, advance, changes } = setup();
    intent.enter('a');
    advance(DELAY_MS - 1);
    expect(changes).toEqual([]);
    advance(1);
    expect(changes).toEqual(['a']);
  });

  test('ignores rows the pointer only passes over', () => {
    const { intent, advance, changes } = setup();
    intent.enter('a');
    advance(300);
    intent.enter('b');
    advance(300);
    intent.enter('c');
    advance(DELAY_MS);
    expect(changes).toEqual(['c']);
  });

  test('keeps the current preview while moving to another row, then switches after the delay', () => {
    const { intent, advance, changes } = setup();
    intent.enter('a');
    advance(DELAY_MS);
    intent.enter('b');
    advance(DELAY_MS - 1);
    expect(changes).toEqual(['a']);
    advance(1);
    expect(changes).toEqual(['a', 'b']);
  });

  test('clears at once when leaving the list, and cancels a pending preview', () => {
    const { intent, advance, changes } = setup();
    intent.enter('a');
    advance(DELAY_MS);
    intent.leave();
    expect(changes).toEqual(['a', null]);

    intent.enter('b');
    advance(500);
    intent.leave();
    advance(DELAY_MS);
    expect(changes).toEqual(['a', null]);
  });

  test('does not report again for the row already shown', () => {
    const { intent, advance, changes } = setup();
    intent.enter('a');
    advance(DELAY_MS);
    intent.enter('a');
    advance(DELAY_MS);
    intent.leave();
    intent.leave();
    expect(changes).toEqual(['a', null]);
  });
});
