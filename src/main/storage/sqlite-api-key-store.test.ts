import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { FakeClock } from '../../core/testing/fake-clock';
import { hashApiKey } from '../api/api-keys';
import { openDatabase } from './database';
import { KEY_TOUCH_INTERVAL_MS, SqliteApiKeyStore } from './sqlite-api-key-store';

describe('SqliteApiKeyStore', () => {
  let db: DatabaseSync;
  let clock: FakeClock;
  let store: SqliteApiKeyStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    clock = new FakeClock();
    store = new SqliteApiKeyStore(db, clock);
  });

  afterEach(() => {
    db.close();
  });

  test('creates a key, shows its secret once and keeps only the hash', () => {
    expect(store.hasAny()).toBe(false);
    const { key, secret } = store.create(' ERP 服务器 ');
    expect(key).toMatchObject({ name: 'ERP 服务器', createdAt: clock.now(), lastUsedAt: null });
    expect(store.hasAny()).toBe(true);
    expect(store.list()).toEqual([key]);
    expect(store.findByHash(hashApiKey(secret))).toEqual({ id: key.id, name: 'ERP 服务器' });
    const stored = db.prepare('SELECT * FROM api_keys').all();
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  test('rejects a bad name', () => {
    expect(() => store.create('  ')).toThrow();
  });

  test('renames and removes a key', () => {
    const { key, secret } = store.create('ERP');
    store.rename(key.id, '仓库');
    expect(store.list()[0]?.name).toBe('仓库');
    store.remove(key.id);
    expect(store.findByHash(hashApiKey(secret))).toBeNull();
    expect(store.hasAny()).toBe(false);
  });

  // 每个请求都会用到密钥：最后使用时间按分钟记，不必每个请求都写库。
  test('notes when a key was last used, at most once a minute', () => {
    const { key } = store.create('ERP');
    store.touch(key.id);
    const first = clock.now();
    clock.advance(KEY_TOUCH_INTERVAL_MS - 1);
    store.touch(key.id);
    expect(store.list()[0]?.lastUsedAt).toBe(first);
    clock.advance(1);
    store.touch(key.id);
    expect(store.list()[0]?.lastUsedAt).toBe(clock.now());
  });
});
