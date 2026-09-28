import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type AppSettings, sanitizeSettings } from '../../shared/settings';
import { runInTransaction } from './database';
import { readString } from './row-readers';

/** 设置存在 settings 表（key → JSON value）；读取和写入都经过 sanitizeSettings。 */
export class SqliteSettingsStore {
  private readonly selectAll: StatementSync;
  private readonly upsert: StatementSync;
  private settings: AppSettings;

  constructor(private readonly db: DatabaseSync) {
    this.selectAll = db.prepare('SELECT key, value FROM settings');
    this.upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (:key, :value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    this.settings = sanitizeSettings(this.readStored());
  }

  get current(): AppSettings {
    return this.settings;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = sanitizeSettings({ ...this.settings, ...patch });
    runInTransaction(this.db, () => {
      for (const [key, value] of Object.entries(next)) {
        this.upsert.run({ key, value: JSON.stringify(value) });
      }
    });
    this.settings = next;
    return next;
  }

  private readStored(): Record<string, unknown> {
    const stored: Record<string, unknown> = {};
    for (const row of this.selectAll.all()) {
      const key = readString(row, 'key');
      try {
        stored[key] = JSON.parse(readString(row, 'value'));
      } catch (error) {
        console.warn(`[SettingsStore] setting "${key}" is unreadable, using its default`, error);
      }
    }
    return stored;
  }
}
