import { describe, expect, test } from 'bun:test';
import { PrintError } from './errors';
import { PrintQueue } from './print-queue';

function recorder() {
  const events: string[] = [];
  const task = (name: string, ms: number) => async () => {
    events.push(`start:${name}`);
    await Bun.sleep(ms);
    events.push(`end:${name}`);
  };
  return { events, task };
}

const hang = () => new Promise<void>(() => {});

describe('PrintQueue', () => {
  test('runs jobs for the same printer one at a time', async () => {
    const queue = new PrintQueue(1_000);
    const { events, task } = recorder();
    await Promise.all([queue.enqueue('P1', task('a', 20)), queue.enqueue('P1', task('b', 1))]);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  test('runs different printers in parallel', async () => {
    const queue = new PrintQueue(1_000);
    const { events, task } = recorder();
    await Promise.all([queue.enqueue('P1', task('a', 20)), queue.enqueue('P2', task('b', 1))]);
    expect(events).toEqual(['start:a', 'start:b', 'end:b', 'end:a']);
  });

  test('rejects with PRINT_TIMEOUT and aborts the task when it hangs', async () => {
    const queue = new PrintQueue(20);
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

  test('a failed or hung job does not block the next one', async () => {
    const queue = new PrintQueue(20);
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
