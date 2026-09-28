import { describe, expect, test } from 'bun:test';
import { logFailures } from './ipc-errors';

function recorder() {
  const logged: string[] = [];
  return { logged, logError: (message: string) => logged.push(message) };
}

describe('logFailures', () => {
  test('passes results through without logging', async () => {
    const { logged, logError } = recorder();
    const handler = logFailures('label:preview', async (raw: unknown) => `ok:${String(raw)}`, logError);
    expect(await handler('A')).toBe('ok:A');
    expect(logged).toEqual([]);
  });

  test('logs a rejected handler with its channel and still rejects the caller', async () => {
    const { logged, logError } = recorder();
    const boom = new Error('disk full');
    const handler = logFailures(
      'settings:update',
      async () => {
        throw boom;
      },
      logError,
    );
    expect(await handler().catch((error: unknown) => error)).toBe(boom);
    expect(logged).toEqual(['[ipc] settings:update failed']);
  });

  test('also catches synchronous throws such as validation errors', async () => {
    const { logged, logError } = recorder();
    const handler = logFailures(
      'jobs:list',
      () => {
        throw new TypeError('Invalid job query limit');
      },
      logError,
    );
    expect(await handler().catch((error: unknown) => error)).toBeInstanceOf(TypeError);
    expect(logged).toEqual(['[ipc] jobs:list failed']);
  });
});
