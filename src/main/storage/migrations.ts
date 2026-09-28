/**
 * Schema 迁移：按顺序执行，数组下标 + 1 就是 PRAGMA user_version。
 * 已发布的迁移不能修改，只能在末尾追加。
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE jobs (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    id             TEXT    NOT NULL UNIQUE,
    created_at     INTEGER NOT NULL,
    raw            TEXT    NOT NULL,
    printer_name   TEXT    NOT NULL,
    source         TEXT    NOT NULL CHECK (source IN ('desktop', 'history', 'mobile')),
    status         TEXT    NOT NULL CHECK (status IN ('printed', 'duplicate', 'invalid', 'failed')),
    forced         INTEGER NOT NULL CHECK (forced IN (0, 1)),
    failure_reason TEXT             CHECK (failure_reason IN
      ('PRINTER_NOT_FOUND', 'PRINTER_NOT_READY', 'PRINT_TIMEOUT', 'PRINT_ERROR'))
  ) STRICT;

  CREATE INDEX jobs_printed_at ON jobs (created_at) WHERE status = 'printed';

  -- 打印记录全文索引（trigram：任意 3 个字符以上的子串都能走索引，中文同样适用）
  CREATE VIRTUAL TABLE jobs_search USING fts5 (raw, content = 'jobs', content_rowid = 'seq', tokenize = 'trigram');

  CREATE TRIGGER jobs_search_insert AFTER INSERT ON jobs BEGIN
    INSERT INTO jobs_search (rowid, raw) VALUES (new.seq, new.raw);
  END;

  CREATE TRIGGER jobs_search_delete AFTER DELETE ON jobs BEGIN
    INSERT INTO jobs_search (jobs_search, rowid, raw) VALUES ('delete', old.seq, old.raw);
  END;

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE templates (
    id         TEXT    PRIMARY KEY,
    body       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  `,
];
