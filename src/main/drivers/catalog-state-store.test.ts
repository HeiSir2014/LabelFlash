import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../storage/database';
import { SqliteSettingsStore } from '../storage/sqlite-settings-store';
import { createTempDir, removeTempDir } from '../storage/testing/temp-dir';
import { parseStoredCatalog, SqliteCatalogStateStore } from './catalog-state-store';

let dir: string;
let db: DatabaseSync;

beforeEach(async () => {
  dir = await createTempDir('catalog-state-');
  db = openDatabase(join(dir, 'test.db'));
});

afterEach(async () => {
  db.close();
  await removeTempDir(dir);
});

test('remembers the highest version and the last catalog next to the settings', () => {
  const store = new SqliteCatalogStateStore(db);
  expect(store.load()).toBeNull();
  const state = {
    highestVersion: 1_790_000_000,
    url: 'https://catalog.example.com/c.json',
    envelope: '{}',
    fetchedAt: 1,
  };
  store.save(state);
  expect(new SqliteCatalogStateStore(db).load()).toEqual(state);
});

test('is not part of the settings the renderer can change', () => {
  new SqliteCatalogStateStore(db).save({
    highestVersion: 9,
    url: 'https://c.example.com/c.json',
    envelope: '{}',
    fetchedAt: 1,
  });
  const settings = new SqliteSettingsStore(db);
  settings.update({ driverCatalogUrl: null });
  expect(new SqliteCatalogStateStore(db).load()?.highestVersion).toBe(9);
  expect(Object.keys(settings.current)).not.toContain('driverCatalog.state');
});

test('treats a damaged record as no record', () => {
  expect(parseStoredCatalog({ highestVersion: 'x' })).toBeNull();
  expect(parseStoredCatalog(null)).toBeNull();
});
