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

describe('migration 3', () => {
  function seedVersion2(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 2));
    const insert = db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, paper) VALUES (?, ?, ?, 'P', 'desktop', 'printed', 0, '60x40')",
    );
    insert.run('a', 1, 'CL5640-TK-图片色-XL');
    insert.run('b', 2, 'CL5887-灰色-M');
    return db;
  }

  test('rebuilds jobs keeping every row, its sequence number and full-text search', () => {
    const db = seedVersion2();
    migrate(db);
    const rows = db.prepare('SELECT seq, id, raw, paper, fields, caller FROM jobs ORDER BY seq').all();
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { seq: 1, id: 'a', raw: 'CL5640-TK-图片色-XL', paper: '60x40', fields: null, caller: null },
      { seq: 2, id: 'b', raw: 'CL5887-灰色-M', paper: '60x40', fields: null, caller: null },
    ]);
    const hits = db.prepare('SELECT rowid FROM jobs_search WHERE jobs_search MATCH \'"5887"\'').all();
    expect(hits.map((row) => row['rowid'])).toEqual([2]);
    db.close();
  });

  // 保留条数到了会删掉旧记录：重建后序号接着原来的走，不回头复用删掉的序号。
  test('keeps counting sequence numbers from where the old table stopped', () => {
    const db = seedVersion2();
    db.prepare("DELETE FROM jobs WHERE id = 'b'").run();
    migrate(db);
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('c', 3, 'C', 'P', 'desktop', 'printed', 0)",
    ).run();
    expect(db.prepare("SELECT seq FROM jobs WHERE id = 'c'").get()?.['seq']).toBe(3);
    db.close();
  });

  test('accepts the api source and keeps full-text search working for new rows', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('c', 3, 'hello waybill', 'P', 'api', 'printed', 0)",
    ).run();
    const search = db.prepare("SELECT rowid FROM jobs_search WHERE jobs_search MATCH 'waybill'");
    expect(search.all()).toHaveLength(1);
    db.prepare("DELETE FROM jobs WHERE id = 'c'").run();
    expect(search.all()).toHaveLength(0);
    db.close();
  });
});
