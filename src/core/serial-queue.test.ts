import { describe, expect, test } from 'bun:test';
import { SerialQueue } from './serial-queue';

describe('SerialQueue', () => {
  test('runs tasks in submission order', async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    await Promise.all([
      queue.run(async () => {
        await Bun.sleep(5);
        events.push('first');
      }),
      queue.run(async () => {
        events.push('second');
      }),
    ]);
    expect(events).toEqual(['first', 'second']);
  });

  test('gives the caller the original rejection and still runs the next task', async () => {
    const queue = new SerialQueue();
    const boom = new Error('boom');
    const failed = queue.run(async () => {
      throw boom;
    });
    const next = queue.run(async () => 'ok');
    expect(await failed.catch((e: unknown) => e)).toBe(boom);
    expect(await next).toBe('ok');
  });

  // 关到托盘后的静默更新要知道还有没有任务：排着的和正在跑的都算，跑完（成功或失败）就不算。
  test('counts the tasks waiting or running until each settles', async () => {
    const queue = new SerialQueue();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const first = queue.run(() => gate);
    const second = queue.run(async () => {
      throw new Error('boom');
    });
    expect(queue.pending).toBe(2);
    release();
    await first;
    await second.catch(() => undefined);
    expect(queue.pending).toBe(0);
  });
});
