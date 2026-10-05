import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { readString } from '../storage/row-readers';

/**
 * 驱动清单的本机记录存在 settings 表的独立键里（和窗口位置一样）：它不是用户设置，
 * SqliteSettingsStore 只读写已知的设置字段，界面的 updateSettings 改不到它（降低防回滚的版本号就要改到它）。
 */
const CATALOG_STATE_KEY = 'driverCatalog.state';

export interface StoredCatalog {
  /** 这台电脑用过的最高清单版本：比它低的清单不再用。 */
  highestVersion: number;
  /** 上次下载成功的清单原文（签名信封）和它的地址：连不上时用它；地址换了就不用。 */
  url: string;
  envelope: string;
  fetchedAt: number;
}

export function parseStoredCatalog(value: unknown): StoredCatalog | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { highestVersion, url, envelope, fetchedAt } = value as Record<string, unknown>;
  return Number.isSafeInteger(highestVersion) &&
    typeof url === 'string' &&
    typeof envelope === 'string' &&
    Number.isFinite(fetchedAt)
    ? { highestVersion: highestVersion as number, url, envelope, fetchedAt: fetchedAt as number }
    : null;
}

export class SqliteCatalogStateStore {
  private readonly select: StatementSync;
  private readonly upsert: StatementSync;

  constructor(db: DatabaseSync) {
    this.select = db.prepare('SELECT value FROM settings WHERE key = :key');
    this.upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (:key, :value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  }

  load(): StoredCatalog | null {
    const row = this.select.get({ key: CATALOG_STATE_KEY });
    if (!row) {
      return null;
    }
    try {
      return parseStoredCatalog(JSON.parse(readString(row, 'value')));
    } catch (error) {
      console.warn('[drivers] the saved catalog record is unreadable, starting over', error);
      return null;
    }
  }

  save(state: StoredCatalog): void {
    this.upsert.run({ key: CATALOG_STATE_KEY, value: JSON.stringify(state) });
  }
}
