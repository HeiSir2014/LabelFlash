import { describe, expect, test } from 'bun:test';
import { ConcurrencyLimit } from './concurrency-limit';

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ConcurrencyLimit', () => {
  test('runs at most the given number of tasks at once, the rest in order', async () => {
    const limit = new ConcurrencyLimit(2, 5);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, index) =>
      limit.run(async () => {
        started.push(index);
        await gate.promise;
        return index;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[0]?.resolve();
    await runs[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.resolve();
    gates[2]?.resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
  });

  // 排队的也满了：直接拒绝，不让请求在程序里越积越多。
  test('refuses a task when the queue is full', async () => {
    const limit = new ConcurrencyLimit(1, 1);
    const gate = deferred();
    const first = limit.run(() => gate.promise);
    const second = limit.run(async () => 'queued');
    await expect(limit.run(async () => 'third')).rejects.toMatchObject({ reason: 'RENDER_BUSY' });
    gate.resolve();
    await first;
    expect(await second).toBe('queued');
  });

  test('frees the slot when a task fails', async () => {
    const limit = new ConcurrencyLimit(1, 0);
    await expect(limit.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await limit.run(async () => 'next')).toBe('next');
  });
});
