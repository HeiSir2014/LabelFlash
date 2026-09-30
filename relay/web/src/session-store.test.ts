import { beforeEach, describe, expect, test } from 'bun:test';
import { randomId } from '../../../src/shared/mobile-crypto';
import { type KeyValueStorage, openSessionStore, RECORD_TTL_MS, type StoredJob } from './session-store';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const throwing: KeyValueStorage = {
  get length(): number {
    throw new Error('SecurityError');
  },
  key: () => {
    throw new Error('SecurityError');
  },
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

let storage: MemoryStorage;
let now: number;
const clock = () => now;

function job(raw = 'CL5640-TK-图片色-XL'): StoredJob {
  return { id: randomId(), raw, force: false, images: [], fields: [] };
}

beforeEach(() => {
  storage = new MemoryStorage();
  now = 1_000_000;
});

describe('openSessionStore', () => {
  test('starts empty', () => {
    const store = openSessionStore(storage, randomId(), clock);
    expect(store.token).toBeNull();
    expect(store.jobs).toEqual([]);
  });

  test('gives a later page the token and the unfinished jobs of the same session', () => {
    const session = randomId();
    const token = randomId();
    const jobs = [job('A'), job('B')];
    const store = openSessionStore(storage, session, clock);
    store.saveToken(token);
    store.saveJobs(jobs);
    const reopened = openSessionStore(storage, session, clock);
    expect(reopened.token).toBe(token);
    expect(reopened.jobs).toEqual(jobs);
  });

  // 多帧择优：同一张标签的几帧随任务存着，刷新页面后重发的仍带着全部几帧（localStorage 里存成 base64url，读回来是字节）。
  test('keeps every frame of a waiting job as bytes', () => {
    const session = randomId();
    const image = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), code: { x: 10, y: 20, size: 130 } };
    const jobs = [{ ...job(), images: [image, { ...image, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe1]) }] }];
    openSessionStore(storage, session, clock).saveJobs(jobs);
    expect(openSessionStore(storage, session, clock).jobs).toEqual(jobs);
  });

  // 协议 1 的记录里图是 base64（可能有好几 MB），新页面不再读它们：打开时就清掉，不占手机的存储空间。
  test('clears the records left by protocol 1', () => {
    const old = `labelflash.session.${randomId()}`;
    storage.setItem(old, JSON.stringify({ token: null, jobs: [], savedAt: now }));
    openSessionStore(storage, randomId(), clock).saveToken(randomId());
    expect(storage.items.has(old)).toBe(false);
  });

  test('keeps sessions apart', () => {
    openSessionStore(storage, randomId(), clock).saveToken(randomId());
    expect(openSessionStore(storage, randomId(), clock).token).toBeNull();
  });

  test('ignores a record that was tampered with', () => {
    const session = randomId();
    openSessionStore(storage, session, clock).saveJobs([job()]);
    for (const key of storage.items.keys()) {
      storage.items.set(key, JSON.stringify({ token: 'not a token', jobs: [], savedAt: now }));
    }
    expect(openSessionStore(storage, session, clock).token).toBeNull();
  });

  test('ignores a record whose jobs are malformed', () => {
    const session = randomId();
    openSessionStore(storage, session, clock).saveJobs([job()]);
    for (const key of storage.items.keys()) {
      storage.items.set(key, JSON.stringify({ token: null, jobs: [{ id: 'job-1', raw: 'A' }], savedAt: now }));
    }
    expect(openSessionStore(storage, session, clock).jobs).toEqual([]);
  });

  test('clears the records of sessions that ended long ago', () => {
    const old = randomId();
    const recent = randomId();
    openSessionStore(storage, old, clock).saveToken(randomId());
    now += RECORD_TTL_MS / 2;
    openSessionStore(storage, recent, clock).saveToken(randomId());
    now += RECORD_TTL_MS / 2;
    openSessionStore(storage, randomId(), clock);
    expect([...storage.items.keys()].some((key) => key.endsWith(old))).toBe(false);
    expect([...storage.items.keys()].some((key) => key.endsWith(recent))).toBe(true);
  });

  test('falls back to memory when storage is blocked', () => {
    const store = openSessionStore(throwing, randomId(), clock);
    const token = randomId();
    store.saveToken(token);
    expect(store.token).toBe(token);
  });

  test('works without any storage', () => {
    const store = openSessionStore(null, randomId(), clock);
    const jobs = [job()];
    store.saveJobs(jobs);
    expect(store.jobs).toEqual(jobs);
  });
});
