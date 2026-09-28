import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { JobRecord } from '../../core/types';
import { openDatabase } from './database';
import { SqliteJobStore } from './sqlite-job-store';
import { createTempDir, removeTempDir } from './testing/temp-dir';

function job(n: number, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: `job-${n}`,
    createdAt: 1_000 + n,
    raw: `CL${n}-红-XL`,
    printerName: '热敏标签机',
    source: 'desktop',
    status: 'printed',
    forced: false,
    ...overrides,
  };
}

function ids(jobs: JobRecord[]): string[] {
  return jobs.map((j) => j.id);
}

function rowCount(db: DatabaseSync): unknown {
  return db.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.['n'];
}

describe('SqliteJobStore', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  test('starts empty', () => {
    expect(new SqliteJobStore(db, 10).listPage({ limit: 10 })).toEqual({ jobs: [], nextCursor: null, total: 0 });
  });

  test('round-trips every field, newest first', () => {
    const store = new SqliteJobStore(db, 10);
    const failed = job(2, { status: 'failed', failureReason: 'PRINTER_NOT_READY', source: 'history', forced: true });
    store.append(job(1));
    store.append(failed);
    expect(store.listPage({ limit: 10 }).jobs).toEqual([failed, job(1)]);
  });

  test('keeps only the newest jobs once capacity is reached (ring) and tracks the total', () => {
    const store = new SqliteJobStore(db, 3);
    for (let n = 1; n <= 5; n += 1) store.append(job(n));
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-5', 'job-4', 'job-3']);
    expect(store.count()).toBe(3);
    expect(rowCount(db)).toBe(3);
  });

  test('a failed append leaves the total unchanged', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1));
    expect(() => store.append(job(1))).toThrow();
    expect(store.count()).toBe(1);
    expect(rowCount(db)).toBe(1);
  });

  test('setCapacity trims in batches and keeps the total in sync', async () => {
    const store = new SqliteJobStore(db, 50);
    for (let n = 1; n <= 30; n += 1) store.append(job(n));
    await store.setCapacity(4);
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-30', 'job-29', 'job-28', 'job-27']);
    expect(store.count()).toBe(4);
    expect(rowCount(db)).toBe(4);
  });

  test('growing the capacity keeps history and accepts more', async () => {
    const store = new SqliteJobStore(db, 2);
    for (let n = 1; n <= 3; n += 1) store.append(job(n));
    await store.setCapacity(5);
    for (let n = 4; n <= 6; n += 1) store.append(job(n));
    expect(ids(store.listPage({ limit: 10 }).jobs)).toEqual(['job-6', 'job-5', 'job-4', 'job-3', 'job-2']);
  });

  test('initialize trims history that exceeds the capacity', async () => {
    const large = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 4; n += 1) large.append(job(n));
    const small = new SqliteJobStore(db, 2);
    await small.initialize();
    expect(small.count()).toBe(2);
  });

  test('pages through history with a cursor', () => {
    const store = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 5; n += 1) store.append(job(n));
    const first = store.listPage({ limit: 2 });
    expect(ids(first.jobs)).toEqual(['job-5', 'job-4']);
    expect(first.total).toBe(5);
    const second = store.listPage({ limit: 2, before: first.nextCursor ?? undefined });
    expect(ids(second.jobs)).toEqual(['job-3', 'job-2']);
    const last = store.listPage({ limit: 2, before: second.nextCursor ?? undefined });
    expect(ids(last.jobs)).toEqual(['job-1']);
    expect(last.nextCursor).toBeNull();
  });

  test('searches with the full-text index, case-insensitively, including Chinese', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'CL5640-TK-图片色-XL' }));
    store.append(job(2, { raw: 'AB12-黑色-S' }));
    expect(ids(store.listPage({ limit: 10, search: 'cl5640' }).jobs)).toEqual(['job-1']);
    expect(ids(store.listPage({ limit: 10, search: '图片色' }).jobs)).toEqual(['job-1']);
    expect(store.listPage({ limit: 10, search: 'cl5640' }).total).toBe(2);
  });

  test('short searches fall back to LIKE and treat wildcards literally', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'X%Y-红-M' }));
    store.append(job(2, { raw: 'XAY-黑-M' }));
    expect(ids(store.listPage({ limit: 10, search: '%' }).jobs)).toEqual(['job-1']);
    expect(ids(store.listPage({ limit: 10, search: '黑' }).jobs)).toEqual(['job-2']);
  });

  test('search terms cannot inject FTS syntax', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'A"B OR C-红-M' }));
    expect(ids(store.listPage({ limit: 10, search: 'A"B OR' }).jobs)).toEqual(['job-1']);
    expect(store.listPage({ limit: 10, search: '") OR ("' }).jobs).toEqual([]);
  });

  test('search results page with a cursor too', () => {
    const store = new SqliteJobStore(db, 10);
    for (let n = 1; n <= 5; n += 1) store.append(job(n, { raw: `SAME-红-${n}` }));
    store.append(job(6, { raw: 'OTHER-黑-1' }));
    const first = store.listPage({ limit: 2, search: 'SAME' });
    expect(ids(first.jobs)).toEqual(['job-5', 'job-4']);
    const second = store.listPage({ limit: 10, search: 'SAME', before: first.nextCursor ?? undefined });
    expect(ids(second.jobs)).toEqual(['job-3', 'job-2', 'job-1']);
  });

  test('ring deletions also leave the search index', () => {
    const store = new SqliteJobStore(db, 1);
    store.append(job(1, { raw: 'GONE-红-M' }));
    store.append(job(2, { raw: 'KEPT-黑-M' }));
    expect(store.listPage({ limit: 10, search: 'GONE' }).jobs).toEqual([]);
  });

  test('lists the latest successful print per code since a timestamp', () => {
    const store = new SqliteJobStore(db, 10);
    store.append(job(1, { raw: 'A-红-1', createdAt: 100 }));
    store.append(job(2, { raw: 'A-红-1', createdAt: 300 }));
    store.append(job(3, { raw: 'B-黑-2', createdAt: 400, status: 'duplicate' }));
    store.append(job(4, { raw: 'C-白-3', createdAt: 50 }));
    expect(store.listLastPrinted(90)).toEqual([{ raw: 'A-红-1', printedAt: 300 }]);
  });

  test.each([0, -1, 2.5])('rejects capacity %p', (capacity) => {
    expect(() => new SqliteJobStore(db, capacity)).toThrow(RangeError);
  });
});

describe('SqliteJobStore persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir('labelflash-db-');
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  test('keeps history and the search index across reopen', () => {
    const path = join(dir, 'CDL-LabelFlash', 'labelflash.db');
    const first = openDatabase(path);
    new SqliteJobStore(first, 10).append(job(1, { raw: 'CL5640-TK-图片色-XXL' }));
    first.close();
    const second = openDatabase(path);
    const store = new SqliteJobStore(second, 10);
    expect(ids(store.listPage({ limit: 10, search: 'XXL' }).jobs)).toEqual(['job-1']);
    expect(store.count()).toBe(1);
    second.close();
  });
});
