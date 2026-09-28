import { describe, expect, test } from 'bun:test';
import { PrintError } from './errors';
import { PrintQueue } from './print-queue';

const TIMEOUT_MS = 20;
const LONG_TIMEOUT_MS = 1_000;

function recorder() {
  const events: string[] = [];
  const task = (name: string, ms: number) => async () => {
    events.push(`start:${name}`);
    await Bun.sleep(ms);
    events.push(`end:${name}`);
  };
  return { events, task };
}

/** 手动控制 Promise 何时完成，让并行测试不依赖真实计时。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const hang = () => new Promise<void>(() => {});

describe('PrintQueue', () => {
  test('rejects a timeout that is not a positive finite number', () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new PrintQueue(invalid)).toThrow(RangeError);
    }
  });

  test('runs jobs for the same printer one at a time', async () => {
    const queue = new PrintQueue(LONG_TIMEOUT_MS);
    const { events, task } = recorder();
    await Promise.all([queue.enqueue('P1', task('a', 20)), queue.enqueue('P1', task('b', 1))]);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  test('runs different printers in parallel', async () => {
    const queue = new PrintQueue(LONG_TIMEOUT_MS);
    const events: string[] = [];
    const started = { a: deferred(), b: deferred() };
    const finish = { a: deferred(), b: deferred() };
    const job = (name: 'a' | 'b') => async () => {
      events.push(`start:${name}`);
      started[name].resolve();
      await finish[name].promise;
      events.push(`end:${name}`);
    };

    const a = queue.enqueue('P1', job('a'));
    const b = queue.enqueue('P2', job('b'));
    // 两台打印机都开始后才放行任何一个：证明是真并行，而不是靠 sleep 时长碰巧成立。
    await Promise.all([started.a.promise, started.b.promise]);
    finish.b.resolve();
    await b;
    finish.a.resolve();
    await a;

    expect(events).toEqual(['start:a', 'start:b', 'end:b', 'end:a']);
  });

  test('rejects with PRINT_TIMEOUT and aborts the task when it hangs', async () => {
    const queue = new PrintQueue(TIMEOUT_MS);
    let received: AbortSignal | undefined;
    const error = await queue
      .enqueue('P1', (signal) => {
        received = signal;
        return hang();
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PrintError);
    expect((error as PrintError).reason).toBe('PRINT_TIMEOUT');
    expect(received?.aborted).toBe(true);
  });

  test('never aborts the signal of a job that succeeds', async () => {
    const queue = new PrintQueue(LONG_TIMEOUT_MS);
    let received: AbortSignal | undefined;
    await queue.enqueue('P1', async (signal) => {
      received = signal;
    });
    expect(received?.aborted).toBe(false);
  });

  test('a synchronous throw rejects with that error and leaves no timer behind', async () => {
    const boom = new Error('sync boom');
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const queue = new PrintQueue(TIMEOUT_MS);
      let received: AbortSignal | undefined;
      const error = await queue
        .enqueue('P1', (signal) => {
          received = signal;
          throw boom;
        })
        .catch((e: unknown) => e);
      expect(error).toBe(boom);
      // 等过超时时长：计时器若没清掉，会在这里中止 signal 并产生无人处理的 PRINT_TIMEOUT。
      await Bun.sleep(TIMEOUT_MS * 2);
      expect(received?.aborted).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  test('a failed or hung job does not block the next one', async () => {
    const queue = new PrintQueue(TIMEOUT_MS);
    const hung = queue.enqueue('P1', hang).catch(() => 'hung');
    const failed = queue
      .enqueue('P1', async () => {
        throw new Error('paper jam');
      })
      .catch(() => 'failed');
    const next = queue.enqueue('P1', async () => 'ok');
    expect(await Promise.all([hung, failed, next])).toEqual(['hung', 'failed', 'ok']);
  });
});
