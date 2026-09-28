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
});
