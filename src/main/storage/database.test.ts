import { describe, expect, test } from 'bun:test';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openDatabase, runInTransaction } from './database';
import { MIGRATIONS } from './migrations';

function userVersion(db: DatabaseSync): unknown {
  return db.prepare('PRAGMA user_version').get()?.['user_version'];
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'jobs_search_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row['name']));
}

describe('openDatabase', () => {
  test('migrates a fresh database to the latest schema', () => {
    const db = openDatabase(':memory:');
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).toEqual([
      'jobs',
      'jobs_search',
      'lookup_rows',
      'lookup_tables',
      'scan_rules',
      'secrets',
      'settings',
      'templates',
      'webhook_deliveries',
    ]);
    db.close();
  });
});

describe('migrate', () => {
  test('applies only pending migrations and is idempotent', () => {
    const db = openDatabase(':memory:');
    const extra = [...MIGRATIONS, 'CREATE TABLE extra (x INTEGER) STRICT;'];
    migrate(db, extra);
    migrate(db, extra);
    expect(userVersion(db)).toBe(extra.length);
    expect(tableNames(db)).toContain('extra');
    db.close();
  });

  test('rolls back a failing migration and keeps the old version', () => {
    const db = openDatabase(':memory:');
    const broken = [...MIGRATIONS, 'CREATE TABLE half (x INTEGER) STRICT; CREATE TABLE half (x INTEGER) STRICT;'];
    expect(() => migrate(db, broken)).toThrow();
    expect(userVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db)).not.toContain('half');
    db.close();
  });

  test('refuses a database written by a newer app version', () => {
    const db = openDatabase(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer/);
    db.close();
  });
});

describe('runInTransaction', () => {
  test('rolls back every statement when the work throws', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      runInTransaction(db, () => {
        db.prepare("INSERT INTO settings (key, value) VALUES ('a', '1')").run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()?.['n']).toBe(0);
    db.close();
  });
});

describe('migration 2', () => {
  test('adds the paper and template columns to an existing 1.0.x database', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 1));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('old', 1, 'A', 'P', 'desktop', 'printed', 0)",
    ).run();
    migrate(db);
    expect({ ...db.prepare("SELECT paper, template_id FROM jobs WHERE id = 'old'").get() }).toEqual({
      paper: null,
      template_id: null,
    });
    db.close();
  });
});
