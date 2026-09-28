import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

const IN_MEMORY_PATH = ':memory:';
const BUSY_TIMEOUT_MS = 5_000;

/** 打开（或创建）数据库，设置 pragma，并执行尚未应用的迁移。 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== IN_MEMORY_PATH) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
  `);
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): void {
  const current = readUserVersion(db);
  if (current > migrations.length) {
    throw new Error(`Database schema v${current} is newer than this app supports (v${migrations.length})`);
  }
  for (const [index, sql] of migrations.entries()) {
    if (index < current) {
      continue;
    }
    runInTransaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}

export function runInTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readUserVersion(db: DatabaseSync): number {
  const version = db.prepare('PRAGMA user_version').get()?.['user_version'];
  if (typeof version !== 'number') {
    throw new Error('Unable to read database schema version');
  }
  return version;
}
