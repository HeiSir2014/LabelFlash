import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { isValidSecretName, isValidSecretValue } from '../../core/scan/enrich-model';
import type { Clock } from '../../core/types';
import { readString } from './row-readers';

/** 系统加密：生产环境是 Electron 的 safeStorage（Windows DPAPI、macOS 钥匙串）。 */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): Uint8Array;
  decrypt(data: Uint8Array): string;
}

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

/**
 * 本机密钥（接口令牌、签名密钥）。只存加密后的字节；渲染层只能拿到名称。
 * 解密失败（例如数据库被拷到另一台电脑）时当作没有这个密钥，并记日志。
 */
export class SqliteSecretStore {
  private readonly selectNames: StatementSync;
  private readonly selectValue: StatementSync;
  private readonly upsert: StatementSync;
  private readonly deleteByName: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly cipher: SecretCipher,
    private readonly clock: Clock,
  ) {
    this.selectNames = db.prepare('SELECT name FROM secrets ORDER BY name');
    this.selectValue = db.prepare('SELECT value FROM secrets WHERE name = :name');
    this.upsert = db.prepare(`
      INSERT INTO secrets (name, value, updated_at) VALUES (:name, :value, :now)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    this.deleteByName = db.prepare('DELETE FROM secrets WHERE name = :name');
  }

  names(): string[] {
    return this.selectNames.all().map((row) => readString(row, 'name'));
  }

  set(name: string, value: string): void {
    if (!isValidSecretName(name)) {
      throw new SecretError('密钥名称要有 1–30 个字符，不能含花括号或换行');
    }
    if (!isValidSecretValue(value)) {
      throw new SecretError('密钥内容不能为空，不能换行');
    }
    if (!this.cipher.isAvailable()) {
      throw new SecretError('这台电脑的系统加密不可用，不能保存密钥');
    }
    this.upsert.run({ name, value: this.cipher.encrypt(value), now: this.clock.now() });
  }

  get(name: string): string | null {
    const value = this.selectValue.get({ name })?.['value'];
    if (!(value instanceof Uint8Array)) {
      return null;
    }
    try {
      return this.cipher.decrypt(value);
    } catch (error) {
      console.error(`[SecretStore] secret "${name}" could not be decrypted`, error);
      return null;
    }
  }

  remove(name: string): void {
    this.deleteByName.run({ name });
  }
}
