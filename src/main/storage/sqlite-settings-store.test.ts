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

  test('persists the selected printer across reopen', () => {
    const first = openDatabase(path);
    new SqliteSettingsStore(first).update({ selectedPrinter: '热敏标签机', autoPrint: false });
    first.close();
    const second = openDatabase(path);
    expect(new SqliteSettingsStore(second).current).toMatchObject({
      selectedPrinter: '热敏标签机',
      autoPrint: false,
    });
    second.close();
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
