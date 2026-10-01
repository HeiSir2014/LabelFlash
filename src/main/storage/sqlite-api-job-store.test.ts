import { afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseSync } from 'node:sqlite';
import { describeApiJobStore } from '../../core/testing/api-job-store-contract';
import { openDatabase } from './database';
import { SqliteApiJobStore } from './sqlite-api-job-store';

const opened: DatabaseSync[] = [];

afterEach(() => {
  for (const db of opened.splice(0)) {
    db.close();
  }
});

function createStore(): { db: DatabaseSync; store: SqliteApiJobStore } {
  const db = openDatabase(':memory:');
  opened.push(db);
  return { db, store: new SqliteApiJobStore(db) };
}

describeApiJobStore('SqliteApiJobStore', () => createStore().store);

describe('SqliteApiJobStore', () => {
  // 库里的数据不可信：字段 JSON 坏了的任务读出时报错，不把坏数据交给调用方。
  test('refuses a row whose fields are not a field list', () => {
    const { db, store } = createStore();
    store.insert({
      id: 'pj-1',
      caller: 'key:k1',
      templateId: 'builtin:generic',
      fields: [{ name: 'a', value: '1' }],
      content: null,
      copies: 1,
      printer: null,
      requestId: null,
      state: 'SENT',
      sentCopies: 1,
      failure: null,
      createdAt: 1,
      updatedAt: 1,
    });
    db.prepare(`UPDATE api_jobs SET fields = '[{"name":2}]'`).run();
    expect(() => store.get('pj-1')).toThrow(TypeError);
  });
});
