import { describe, expect, test } from 'bun:test';
import type { QueueJob } from './diagnosis-model';
import { isOwnJob, isStuck, STUCK_JOB_AGE_MS, SUBMIT_TIME_SKEW_MS, summarizeQueue } from './queue-summary';

const NOW = 1_790_000_000_000;
const WINDOW = { printerName: '标签机A', startedAtMs: NOW - 10_000, finishedAtMs: NOW - 9_000 };

function job(overrides: Partial<QueueJob> = {}): QueueJob {
  return { id: 1, document: 'CL5640', user: 'shop', submittedAtMs: NOW - 9_500, flags: [], ...overrides };
}

describe('isStuck', () => {
  test('is stuck when the driver reports an error or the job waited too long', () => {
    expect(isStuck(job({ flags: ['printing'] }), NOW)).toBe(false);
    expect(isStuck(job({ flags: ['paper-out'] }), NOW)).toBe(true);
    expect(isStuck(job({ submittedAtMs: NOW - STUCK_JOB_AGE_MS - 1 }), NOW)).toBe(true);
  });
});

describe('isOwnJob', () => {
  test('matches the current user and a submit time inside a window we recorded', () => {
    expect(isOwnJob(job(), 'shop', [WINDOW])).toBe(true);
    expect(isOwnJob(job({ user: 'SHOP' }), 'shop', [WINDOW])).toBe(true);
    // Windows 有时带域名：DOMAIN\shop。
    expect(isOwnJob(job({ user: 'SHOPPC\\shop' }), 'shop', [WINDOW])).toBe(true);
    expect(isOwnJob(job({ user: 'someone' }), 'shop', [WINDOW])).toBe(false);
  });

  test('allows a small clock skew around the window, not more', () => {
    expect(isOwnJob(job({ submittedAtMs: WINDOW.finishedAtMs + SUBMIT_TIME_SKEW_MS }), 'shop', [WINDOW])).toBe(true);
    expect(isOwnJob(job({ submittedAtMs: WINDOW.finishedAtMs + SUBMIT_TIME_SKEW_MS + 1 }), 'shop', [WINDOW])).toBe(
      false,
    );
  });
});

describe('summarizeQueue', () => {
  test('counts stuck jobs, ours among them and how long the oldest waited', () => {
    const facts = {
      kind: 'listed' as const,
      currentUser: 'shop',
      total: 3,
      jobs: [
        job({ id: 1, flags: ['error'] }),
        job({ id: 2, user: 'someone', submittedAtMs: NOW - 300_000, flags: ['error'] }),
        job({ id: 3, flags: ['printing'], submittedAtMs: NOW - 1_000 }),
      ],
    };
    const summary = summarizeQueue(facts, [WINDOW], NOW);
    expect(summary.stuck).toBe(2);
    expect(summary.ownStuck).toBe(1);
    expect(summary.own.map((item) => item.id)).toEqual([1]);
    expect(summary.oldestStuckAgeMs).toBe(300_000);
  });
});
