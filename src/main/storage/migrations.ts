/**
 * Schema 迁移：按顺序执行，数组下标 + 1 就是 PRAGMA user_version。
 * 1.0.1 是第一个发布版本，发布前只有这一份初始 schema，表结构直接改在这里（开发机删掉旧数据库即可）；
 * 发布之后已发布的迁移不能修改，只能在末尾追加。
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
      ('PRINTER_NOT_FOUND', 'PRINTER_NOT_READY', 'PRINT_TIMEOUT', 'PRINT_ERROR', 'LOOKUP_FAILED'))
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

  -- 自定义识别规则：写法和 templates 一致，body 是 JSON，读出时重新校验。
  CREATE TABLE scan_rules (
    id         TEXT    PRIMARY KEY,
    body       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  -- 查找表（从 CSV 导入）：columns 是列名的 JSON 数组，每行的 cells 是同样长度的 JSON 数组。
  CREATE TABLE lookup_tables (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    columns    TEXT    NOT NULL,
    row_count  INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE lookup_rows (
    table_id  TEXT    NOT NULL REFERENCES lookup_tables (id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    cells     TEXT    NOT NULL,
    PRIMARY KEY (table_id, row_index)
  ) STRICT, WITHOUT ROWID;

  -- 密钥（HTTP 查询的令牌、通知的签名密钥）：value 是系统加密（safeStorage）后的字节。
  CREATE TABLE secrets (
    name       TEXT    PRIMARY KEY,
    value      BLOB    NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  -- 打印结果通知的发送队列兼发送记录：pending 的按 next_attempt_at 发送，重启后继续。
  CREATE TABLE webhook_deliveries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id     TEXT    NOT NULL,
    event_id        TEXT    NOT NULL,
    event           TEXT    NOT NULL,
    payload         TEXT    NOT NULL,
    state           TEXT    NOT NULL CHECK (state IN ('pending', 'delivered', 'failed')),
    attempts        INTEGER NOT NULL,
    last_status     INTEGER,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    next_attempt_at INTEGER,
    updated_at      INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX webhook_deliveries_pending ON webhook_deliveries (endpoint_id, id) WHERE state = 'pending';
  `,
];
