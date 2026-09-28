import { describe, expect, test } from 'bun:test';
import { judgeResponse, nextAttemptAt } from './delivery-schedule';
import { WEBHOOK_LIMITS } from './webhook-model';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('judgeResponse', () => {
  test('treats 2xx as delivered', () => {
    expect(judgeResponse(200)).toBe('delivered');
    expect(judgeResponse(204)).toBe('delivered');
  });

  test('retries network errors, timeouts, throttling and server errors', () => {
    for (const status of [null, 408, 429, 500, 503]) {
      expect(judgeResponse(status)).toBe('retry');
    }
  });

  test('does not retry other client errors, which are configuration mistakes', () => {
    for (const status of [301, 400, 401, 403, 404, 410]) {
      expect(judgeResponse(status)).toBe('reject');
    }
  });
});

describe('nextAttemptAt', () => {
  test('backs off 1 min, 5 min, 30 min, 2 h, 12 h', () => {
    const delays = [1, 2, 3, 4, 5].map((attempts) => (nextAttemptAt(attempts, 0, 0) ?? 0) / MINUTE);
    expect(delays).toEqual([1, 5, 30, 120, 720]);
  });

  test('gives up after the last retry', () => {
    expect(nextAttemptAt(WEBHOOK_LIMITS.retryDelaysMs.length + 1, 0, 0)).toBeNull();
  });

  test('gives up when the next attempt would be more than 24 hours after the event', () => {
    expect(nextAttemptAt(5, 0, 13 * HOUR)).toBeNull();
    expect(nextAttemptAt(5, 0, 11 * HOUR)).toBe(23 * HOUR);
  });
});
