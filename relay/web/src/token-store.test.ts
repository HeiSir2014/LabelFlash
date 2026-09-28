import { describe, expect, test } from 'bun:test';
import { randomId } from '../../../src/shared/mobile-crypto';
import { createTokenStore, type KeyValueStorage } from './token-store';

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('createTokenStore', () => {
  test('keeps one token per session', () => {
    const store = createTokenStore(new MemoryStorage());
    const [first, second, token] = [randomId(), randomId(), randomId()];
    store.set(first, token);
    expect(store.get(first)).toBe(token);
    expect(store.get(second)).toBeNull();
  });

  test('ignores a malformed value left in storage by an earlier page', () => {
    const storage = new MemoryStorage();
    const session = randomId();
    createTokenStore(storage).set(session, randomId());
    for (const key of storage.items.keys()) {
      storage.items.set(key, 'not a token');
    }
    expect(createTokenStore(storage).get(session)).toBeNull();
  });

  test('reads a token saved by an earlier page', () => {
    const storage = new MemoryStorage();
    const [session, token] = [randomId(), randomId()];
    createTokenStore(storage).set(session, token);
    expect(createTokenStore(storage).get(session)).toBe(token);
  });

  test('falls back to memory when storage is blocked', () => {
    const store = createTokenStore(throwing);
    const [session, token] = [randomId(), randomId()];
    store.set(session, token);
    expect(store.get(session)).toBe(token);
  });

  test('works without any storage', () => {
    const store = createTokenStore(null);
    const [session, token] = [randomId(), randomId()];
    store.set(session, token);
    expect(store.get(session)).toBe(token);
  });
});
