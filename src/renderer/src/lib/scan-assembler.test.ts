import { describe, expect, test } from 'bun:test';
import { ScanAssembler } from './scan-assembler';
import type { IntentTimers } from './timers';

/** 假计时器：记录挂起的回调和时长，由测试决定何时到期。 */
function fakeTimers() {
  let next = 0;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  const timers: IntentTimers = {
    set: (callback, ms) => {
      next += 1;
      pending.set(next, { callback, ms });
      return next;
    },
    clear: (handle) => {
      pending.delete(handle);
    },
  };
  return {
    timers,
    lastDelay: () => [...pending.values()].at(-1)?.ms,
    elapse: () => {
      for (const [handle, { callback }] of [...pending]) {
        pending.delete(handle);
        callback();
      }
    },
  };
}

/** 模拟扫码框：按键依次送进来，按 ScanAssembler 的返回拼内容。 */
function createBox(gapMs = 80) {
  const clock = fakeTimers();
  const submitted: string[] = [];
  let value = '';
  const assembler = new ScanAssembler(
    gapMs,
    () => {
      submitted.push(value);
      value = '';
    },
    clock.timers,
  );
  const type = (keys: string) => {
    for (const key of keys) {
      if (key === '\n' || key === '\t') {
        value += assembler.breakKey(key === '\n' ? 'enter' : 'tab');
      } else {
        value += assembler.character() + key;
      }
    }
  };
  return { assembler, clock, submitted, type, value: () => value };
}

describe('ScanAssembler', () => {
  test('submits once when the scanner pauses after Enter', () => {
    const box = createBox();
    box.type('CL5640-TK-图片色-XL\n');
    expect(box.submitted).toEqual([]);
    box.clock.elapse();
    expect(box.submitted).toEqual(['CL5640-TK-图片色-XL']);
  });

  test('keeps a newline that is followed by more characters inside the gap', () => {
    const box = createBox();
    box.type('订单号：A001\n款号：CL5640\n');
    box.clock.elapse();
    expect(box.submitted).toEqual(['订单号：A001\n款号：CL5640']);
  });

  test('keeps a tab the same way', () => {
    const box = createBox();
    box.type('A001\tCL5640\n');
    box.clock.elapse();
    expect(box.submitted).toEqual(['A001\tCL5640']);
  });

  test('keeps an empty line between two Enters', () => {
    const box = createBox();
    box.type('第一段\n\n第二段\n');
    box.clock.elapse();
    expect(box.submitted).toEqual(['第一段\n\n第二段']);
  });

  test('uses a changed gap for the next Enter', () => {
    const box = createBox();
    box.assembler.setGap(200);
    box.type('A\n');
    expect(box.clock.lastDelay()).toBe(200);
    expect(box.assembler.isPending).toBe(true);
  });

  test('forgets a pending Enter when disposed', () => {
    const box = createBox();
    box.type('A\n');
    box.assembler.dispose();
    box.clock.elapse();
    expect(box.submitted).toEqual([]);
    expect(box.assembler.isPending).toBe(false);
  });
});
