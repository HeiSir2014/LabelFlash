import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, MAX_DEDUP_WINDOW_SECONDS } from '../../shared/settings';
import { openDatabase } from './database';
import { SqliteSettingsStore } from './sqlite-settings-store';
import { createTempDir, removeTempDir } from './testing/temp-dir';

describe('SqliteSettingsStore', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await createTempDir('labelflash-settings-');
    path = join(dir, 'labelflash.db');
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  test('uses defaults on a fresh database', () => {
    const db = openDatabase(path);
    expect(new SqliteSettingsStore(db).current).toEqual(DEFAULT_SETTINGS);
    db.close();
  });

  test('persists the paper assignment across reopen', () => {
    const first = openDatabase(path);
    new SqliteSettingsStore(first).update({ paperPrinters: { '60x40': '热敏标签机' }, autoPrint: false });
    first.close();
    const second = openDatabase(path);
    expect(new SqliteSettingsStore(second).current).toMatchObject({
      paperPrinters: { '60x40': '热敏标签机' },
      autoPrint: false,
    });
    second.close();
  });

  // 数据库里 1.0.x 留下的 selectedPrinter 行不会被删：核对它只迁移一次，保存后不会复活。
  test('migrates the old selected printer once and never brings it back', () => {
    const db = openDatabase(path);
    db.prepare(`INSERT INTO settings (key, value) VALUES ('selectedPrinter', '"标签机A"')`).run();
    const store = new SqliteSettingsStore(db);
    expect(store.current.paperPrinters).toEqual({ '60x40': '标签机A' });
    store.update({ autoPrint: false });
    expect(new SqliteSettingsStore(db).current.paperPrinters).toEqual({ '60x40': '标签机A' });
    store.update({ paperPrinters: {} });
    expect(new SqliteSettingsStore(db).current.paperPrinters).toEqual({});
    db.close();
  });

  test('sanitizes updates', () => {
    const db = openDatabase(path);
    expect(new SqliteSettingsStore(db).update({ dedupWindowSeconds: 999_999 }).dedupWindowSeconds).toBe(
      MAX_DEDUP_WINDOW_SECONDS,
    );
    db.close();
  });

  test('ignores a stored value that is not valid JSON', () => {
    const db = openDatabase(path);
    db.prepare("INSERT INTO settings (key, value) VALUES ('autoPrint', 'not json')").run();
    expect(new SqliteSettingsStore(db).current.autoPrint).toBe(DEFAULT_SETTINGS.autoPrint);
    db.close();
  });
});
