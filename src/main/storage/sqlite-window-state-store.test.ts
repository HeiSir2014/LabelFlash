import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { SavedWindowState } from '../window-state';
import { openDatabase } from './database';
import { SqliteSettingsStore } from './sqlite-settings-store';
import { SqliteWindowStateStore } from './sqlite-window-state-store';
import { createTempDir, removeTempDir } from './testing/temp-dir';

const STATE: SavedWindowState = {
  bounds: { x: 120, y: 80, width: 1280, height: 800 },
  isMaximized: true,
  display: { id: 7, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25 },
};

describe('SqliteWindowStateStore', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await createTempDir('labelflash-window-state-');
    path = join(dir, 'labelflash.db');
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  test('has nothing saved on a fresh database', () => {
    const db = openDatabase(path);
    expect(new SqliteWindowStateStore(db).load()).toBeNull();
    db.close();
  });

  test('keeps the window state across reopen without touching the user settings', () => {
    const first = openDatabase(path);
    new SqliteWindowStateStore(first).save(STATE);
    first.close();
    const second = openDatabase(path);
    expect(new SqliteWindowStateStore(second).load()).toEqual(STATE);
    expect(new SqliteSettingsStore(second).current).toEqual(DEFAULT_SETTINGS);
    second.close();
  });

  test('ignores a stored value it cannot read', () => {
    const db = openDatabase(path);
    db.prepare("INSERT INTO settings (key, value) VALUES ('window.state', '{broken')").run();
    expect(new SqliteWindowStateStore(db).load()).toBeNull();
    db.close();
  });
});
