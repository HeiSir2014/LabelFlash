import { describe, expect, test } from 'bun:test';
import type { ApiJobStore } from '../api/api-job-store';
import type { PrintJob } from '../api/api-model';

function job(n: number, overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id: `pj-${n}`,
    caller: 'key:k1',
    templateId: 'builtin:standard',
    fields: [{ name: '订单号', value: `A00${n}` }],
    content: null,
    copies: 1,
    printer: null,
    requestId: null,
    state: 'QUEUED',
    sentCopies: 0,
    failure: null,
    createdAt: 1_000 + n,
    updatedAt: 1_000 + n,
    ...overrides,
  };
}

/** 任务存储的行为约定：内存实现和 SQLite 实现跑同一套测试，保证两边一致。 */
export function describeApiJobStore(name: string, create: () => ApiJobStore): void {
  describe(`${name} (ApiJobStore contract)`, () => {
    test('stores a job with every field and updates it', () => {
      const store = create();
      const original = job(1, {
        content: 'SF1',
        copies: 3,
        printer: '面单机B',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      });
      store.insert(original);
      expect(store.get('pj-1')).toEqual(original);
      const failed: PrintJob = {
        ...original,
        state: 'FAILED',
        sentCopies: 1,
        failure: { reason: 'PRINTER_NOT_READY', message: '缺纸' },
        updatedAt: 2_000,
      };
      store.update(failed);
      expect(store.get('pj-1')).toEqual(failed);
      expect(store.get('nope')).toBeNull();
    });

    test('finds the latest job with a request id from a caller since a time', () => {
      const store = create();
      const requestId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
      store.insert(job(1, { requestId }));
      store.insert(job(2, { requestId, caller: 'key:k2' }));
      store.insert(job(3, { requestId }));
      expect(store.findByRequestId('key:k1', requestId, 0)?.id).toBe('pj-3');
      expect(store.findByRequestId('key:k1', requestId, 1_004)).toBeNull();
      expect(store.findByRequestId('key:k3', requestId, 0)).toBeNull();
    });

    test('lists a caller’s jobs newest first, a page at a time', () => {
      const store = create();
      for (let n = 1; n <= 3; n += 1) {
        store.insert(job(n));
      }
      store.insert(job(4, { caller: 'key:k2' }));
      const first = store.list('key:k1', 2, null);
      expect(first.jobs.map((item) => item.id)).toEqual(['pj-3', 'pj-2']);
      const second = store.list('key:k1', 2, first.nextCursor);
      expect(second).toEqual({ jobs: [expect.objectContaining({ id: 'pj-1' })], nextCursor: null });
    });

    test('counts labels still waiting and lists unfinished jobs in order', () => {
      const store = create();
      store.insert(job(1, { copies: 5, sentCopies: 2, state: 'PRINTING' }));
      store.insert(job(2, { copies: 3 }));
      store.insert(job(3, { copies: 9, state: 'SENT', sentCopies: 9 }));
      expect(store.pendingLabels()).toBe(6);
      expect(store.listUnfinished().map((item) => item.id)).toEqual(['pj-1', 'pj-2']);
    });

    test('deletes only finished jobs created before a time', () => {
      const store = create();
      store.insert(job(1, { state: 'SENT' }));
      store.insert(job(2, { state: 'QUEUED' }));
      store.insert(job(5, { state: 'FAILED' }));
      store.deleteFinishedBefore(1_005);
      expect(store.get('pj-1')).toBeNull();
      expect(store.get('pj-2')).not.toBeNull();
      expect(store.get('pj-5')).not.toBeNull();
    });
  });
}
