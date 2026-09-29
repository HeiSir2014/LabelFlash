import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { Clock } from '../../core/types';
import { API_KEY_NAME_LENGTH, type ApiKeyInfo, type CreatedApiKey, normalizeApiKeyName } from '../../shared/local-api';
import { generateApiKey, hashApiKey } from '../api/api-keys';
import { type Row, readInteger, readString } from './row-readers';

/** 最后使用时间最多每分钟写一次：每个请求都会用到密钥，配置中心只需要大概的时间。 */
export const KEY_TOUCH_INTERVAL_MS = 60_000;

/** 程序密钥（api_keys 表）：只存摘要，原文只在生成时返回一次，不写日志。 */
export class SqliteApiKeyStore {
  private readonly selectAll: StatementSync;
  private readonly selectByHash: StatementSync;
  private readonly selectAny: StatementSync;
  private readonly insertKey: StatementSync;
  private readonly updateName: StatementSync;
  private readonly updateUsed: StatementSync;
  private readonly deleteKey: StatementSync;
  private readonly touchedAt = new Map<string, number>();

  constructor(
    db: DatabaseSync,
    private readonly clock: Clock,
  ) {
    this.selectAll = db.prepare(
      'SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_keys ORDER BY created_at, id',
    );
    this.selectByHash = db.prepare('SELECT id, name FROM api_keys WHERE hash = :hash');
    this.selectAny = db.prepare('SELECT 1 AS found FROM api_keys LIMIT 1');
    this.insertKey = db.prepare(
      'INSERT INTO api_keys (id, name, hash, created_at, last_used_at) VALUES (:id, :name, :hash, :createdAt, NULL)',
    );
    this.updateName = db.prepare('UPDATE api_keys SET name = :name WHERE id = :id');
    this.updateUsed = db.prepare('UPDATE api_keys SET last_used_at = :now WHERE id = :id');
    this.deleteKey = db.prepare('DELETE FROM api_keys WHERE id = :id');
  }

  list(): ApiKeyInfo[] {
    return this.selectAll.all().map(toKeyInfo);
  }

  create(name: string): CreatedApiKey {
    const key: ApiKeyInfo = {
      id: randomUUID(),
      name: requireName(name),
      createdAt: this.clock.now(),
      lastUsedAt: null,
    };
    const secret = generateApiKey();
    this.insertKey.run({ id: key.id, name: key.name, hash: hashApiKey(secret), createdAt: key.createdAt });
    return { key, secret };
  }

  rename(id: string, name: string): void {
    this.updateName.run({ id, name: requireName(name) });
  }

  remove(id: string): void {
    this.deleteKey.run({ id });
    this.touchedAt.delete(id);
  }

  findByHash(hash: string): { id: string; name: string } | null {
    const row = this.selectByHash.get({ hash });
    return row ? { id: readString(row, 'id'), name: readString(row, 'name') } : null;
  }

  hasAny(): boolean {
    return this.selectAny.get() !== undefined;
  }

  touch(id: string): void {
    const now = this.clock.now();
    const last = this.touchedAt.get(id);
    if (last !== undefined && now - last < KEY_TOUCH_INTERVAL_MS) {
      return;
    }
    this.touchedAt.set(id, now);
    this.updateUsed.run({ id, now });
  }
}

function requireName(value: string): string {
  const name = normalizeApiKeyName(value);
  if (name === null) {
    throw new RangeError(`Api key name must be 1–${API_KEY_NAME_LENGTH} characters without control characters`);
  }
  return name;
}

function toKeyInfo(row: Row): ApiKeyInfo {
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    createdAt: readInteger(row, 'createdAt'),
    lastUsedAt: row['lastUsedAt'] === null ? null : readInteger(row, 'lastUsedAt'),
  };
}
