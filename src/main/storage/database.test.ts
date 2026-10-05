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
      'api_jobs',
      'api_keys',
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

describe('migration 5', () => {
  test('keeps every row with its fields and caller, and accepts TEXT_NOT_FOUND', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 4));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, fields, caller) VALUES ('a', 1, 'CL5640', 'P', 'api', 'printed', 0, '[]', 'key:k1')",
    ).run();
    migrate(db);
    expect({ ...db.prepare("SELECT seq, raw, source, fields, caller FROM jobs WHERE id = 'a'").get() }).toEqual({
      seq: 1,
      raw: 'CL5640',
      source: 'api',
      fields: '[]',
      caller: 'key:k1',
    });
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, failure_reason) VALUES ('b', 2, 'CL5887', 'P', 'mobile', 'failed', 0, 'TEXT_NOT_FOUND')",
    ).run();
    expect(db.prepare("SELECT seq FROM jobs WHERE id = 'b'").get()?.['seq']).toBe(2);
    const hits = db.prepare('SELECT rowid FROM jobs_search WHERE jobs_search MATCH \'"5887"\'').all();
    expect(hits.map((row) => row['rowid'])).toEqual([2]);
    db.close();
  });
});

describe('migration 6', () => {
  test('keeps every row and accepts batch jobs with their batch, row and copy', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 5));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, fields, caller) VALUES ('a', 1, 'CL5640', 'P', 'api', 'printed', 0, '[]', 'key:k1')",
    ).run();
    migrate(db);
    expect({ ...db.prepare("SELECT seq, source, caller, batch_id FROM jobs WHERE id = 'a'").get() }).toEqual({
      seq: 1,
      source: 'api',
      caller: 'key:k1',
      batch_id: null,
    });
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, batch_id, batch_row, batch_copy) VALUES ('b', 2, 'CL5887', 'P', 'batch', 'printed', 0, '20261002-143501-a1b2', 3, 1)",
    ).run();
    expect(db.prepare("SELECT seq FROM jobs WHERE id = 'b'").get()?.['seq']).toBe(2);
    const hits = db.prepare('SELECT rowid FROM jobs_search WHERE jobs_search MATCH \'"5887"\'').all();
    expect(hits.map((row) => row['rowid'])).toEqual([2]);
    db.close();
  });

  test('refuses a batch id without its row and copy', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, batch_id) VALUES ('c', 3, 'X', 'P', 'batch', 'printed', 0, '20261002-143501-a1b2')",
    );
    expect(() => insert.run()).toThrow();
    db.close();
  });

  // 后续子项目（PDF 打印、局域网共享、远程打印）要用到的来源：先占住取值，列由各自的迁移再加。
  test('accepts the sources reserved for later sub-projects', () => {
    const db = openDatabase(':memory:');
    for (const source of ['pdf', 'ipp', 'remote']) {
      db.prepare(
        'INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES (?, 1, ?, ?, ?, ?, 0)',
      ).run(source, source, 'P', source, 'printed');
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.['n']).toBe(3);
    db.close();
  });

  // CANCELED：批量打印退出时还没打到的那些行，从来没交给过打印机。
  test('accepts the CANCELED failure reason for batch labels never sent to the printer', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, failure_reason, batch_id, batch_row, batch_copy) VALUES ('c', 1, 'X', 'P', 'batch', 'failed', 0, 'CANCELED', '20261002-143501-a1b2', 5, 1)",
    ).run();
    expect(db.prepare("SELECT failure_reason FROM jobs WHERE id = 'c'").get()?.['failure_reason']).toBe('CANCELED');
    db.close();
  });

  // 重打失败的标签时要核对模板有没有改过：指纹（字段 + 纸张）跟着批量打印的记录一起存。
  test('keeps the template fingerprint on a batch job', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, batch_id, batch_row, batch_copy, template_fingerprint) VALUES ('d', 1, 'X', 'P', 'batch', 'failed', 0, '20261002-143501-a1b2', 1, 1, 'fp-1')",
    ).run();
    expect(db.prepare("SELECT template_fingerprint FROM jobs WHERE id = 'd'").get()?.['template_fingerprint']).toBe(
      'fp-1',
    );
    db.close();
  });

  // 和迁移 3 的同一条规则：重建表之后，自增计数接着旧表走，删掉的旧序号不会被新记录复用。
  test('keeps counting sequence numbers from where the old table stopped, even after a delete', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 5));
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('a', 1, 'A', 'P', 'desktop', 'printed', 0)",
    ).run();
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('b', 2, 'B', 'P', 'desktop', 'printed', 0)",
    ).run();
    db.prepare("DELETE FROM jobs WHERE id = 'b'").run();
    migrate(db);
    db.prepare(
      "INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced) VALUES ('c', 3, 'C', 'P', 'desktop', 'printed', 0)",
    ).run();
    expect(db.prepare("SELECT seq FROM jobs WHERE id = 'c'").get()?.['seq']).toBe(3);
    db.close();
  });
});
