import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { parseWindowState, type SavedWindowState } from '../window-state';
import { readString } from './row-readers';

/**
 * 窗口位置存在 settings 表的一个独立键里。它不是用户设置：SqliteSettingsStore 读取时只取
 * 已知的设置字段，写入时也只写这些字段，两者互不影响，不需要新表。
 */
const WINDOW_STATE_KEY = 'window.state';

export class SqliteWindowStateStore {
  private readonly select: StatementSync;
  private readonly upsert: StatementSync;

  constructor(db: DatabaseSync) {
    this.select = db.prepare('SELECT value FROM settings WHERE key = :key');
    this.upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (:key, :value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  }

  load(): SavedWindowState | null {
    const row = this.select.get({ key: WINDOW_STATE_KEY });
    if (!row) {
      return null;
    }
    try {
      return parseWindowState(JSON.parse(readString(row, 'value')));
    } catch (error) {
      console.warn('[WindowStateStore] saved window state is unreadable, opening at the default place', error);
      return null;
    }
  }

  save(state: SavedWindowState): void {
    this.upsert.run({ key: WINDOW_STATE_KEY, value: JSON.stringify(state) });
  }
}
