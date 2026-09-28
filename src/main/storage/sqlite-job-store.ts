import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { JobStore, LastPrinted } from '../../core/job-store';
import { type JobRecord, PRINT_FAILURE_REASONS, PRINT_SOURCES, PRINT_STATUSES } from '../../core/types';
import type { JobPage, JobQuery } from '../../shared/job-history';
import { runInTransaction } from './database';
import { type Row, readEnum, readInteger, readString } from './row-readers';

const JOB_COLUMNS = `
  jobs.seq, jobs.id, jobs.created_at AS createdAt, jobs.raw, jobs.printer_name AS printerName,
  jobs.source, jobs.status, jobs.forced, jobs.failure_reason AS failureReason`;
/** trigram 索引至少需要 3 个字符；更短的搜索词退回 LIKE（LIMIT 保证找够一页就停）。 */
const FTS_MIN_QUERY_LENGTH = 3;
/** 调小容量时每批删除的行数；批与批之间让出主线程，避免卡住打印。 */
const TRIM_BATCH_SIZE = 10_000;

/**
 * 打印记录，环形保留：jobs 表只保留最新的 capacity 条。
 * seq 是 AUTOINCREMENT，单调递增且不复用；总数在内存中维护，避免每次翻页都 COUNT(*)。
 */
export class SqliteJobStore implements JobStore {
  private capacity: number;
  private total: number;
  private readonly insertJob: StatementSync;
  private readonly trimBehind: StatementSync;
  private readonly trimOldestBatch: StatementSync;
  private readonly selectPage: StatementSync;
  private readonly searchPageFts: StatementSync;
  private readonly searchPageLike: StatementSync;
  private readonly selectCount: StatementSync;
  private readonly selectLastPrinted: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    capacity: number,
  ) {
    this.capacity = assertCapacity(capacity);
    this.insertJob = db.prepare(`
      INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, failure_reason)
      VALUES (:id, :createdAt, :raw, :printerName, :source, :status, :forced, :failureReason)`);
    // 插入后使用：只保留 seq 落在最新 capacity 个序号内的记录，走主键，开销与容量无关。
    this.trimBehind = db.prepare('DELETE FROM jobs WHERE seq <= :lastSeq - :capacity');
    this.trimOldestBatch = db.prepare(`
      DELETE FROM jobs WHERE seq IN (SELECT seq FROM jobs ORDER BY seq ASC LIMIT :batch)`);
    this.selectPage = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    this.searchPageFts = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs_search JOIN jobs ON jobs.seq = jobs_search.rowid
      WHERE jobs_search MATCH :match AND (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    this.searchPageLike = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE jobs.raw LIKE :pattern ESCAPE '\\' AND (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    this.selectCount = db.prepare('SELECT COUNT(*) AS total FROM jobs');
    this.selectLastPrinted = db.prepare(`
      SELECT raw, MAX(created_at) AS printedAt
      FROM jobs
      WHERE status = 'printed' AND created_at >= :since
      GROUP BY raw`);
    this.total = this.readCount();
  }

  /** 启动时调用：历史超过容量（例如上次调小容量后异常退出）时分批裁剪。 */
  async initialize(): Promise<void> {
    await this.trimToCapacity();
  }

  append(job: JobRecord): void {
    const trimmed = runInTransaction(this.db, () => {
      const { lastInsertRowid } = this.insertJob.run({
        id: job.id,
        createdAt: job.createdAt,
        raw: job.raw,
        printerName: job.printerName,
        source: job.source,
        status: job.status,
        forced: job.forced ? 1 : 0,
        failureReason: job.failureReason ?? null,
      });
      return Number(this.trimBehind.run({ lastSeq: lastInsertRowid, capacity: this.capacity }).changes);
    });
    // 事务提交之后才更新内存总数：提交失败时数据库没变，总数也不能变。
    this.total += 1 - trimmed;
  }

  listPage(query: JobQuery): JobPage {
    const rows = this.selectRows(query.search?.trim() ?? '', query.before ?? null, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      jobs: pageRows.map(toJobRecord),
      nextCursor: hasMore && lastRow ? readInteger(lastRow, 'seq') : null,
      total: this.total,
    };
  }

  count(): number {
    return this.total;
  }

  listLastPrinted(since: number): LastPrinted[] {
    return this.selectLastPrinted.all({ since }).map((row) => ({
      raw: readString(row, 'raw'),
      printedAt: readInteger(row, 'printedAt'),
    }));
  }

  async setCapacity(capacity: number): Promise<void> {
    this.capacity = assertCapacity(capacity);
    await this.trimToCapacity();
  }

  private selectRows(search: string, before: number | null, limit: number): Row[] {
    if (search === '') {
      return this.selectPage.all({ before, limit });
    }
    if ([...search].length >= FTS_MIN_QUERY_LENGTH) {
      return this.searchPageFts.all({ match: toFtsPhrase(search), before, limit });
    }
    return this.searchPageLike.all({ pattern: `%${escapeLike(search)}%`, before, limit });
  }

  private async trimToCapacity(): Promise<void> {
    while (this.total > this.capacity) {
      const batch = Math.min(TRIM_BATCH_SIZE, this.total - this.capacity);
      const { changes } = this.trimOldestBatch.run({ batch });
      this.total -= Number(changes);
      if (Number(changes) === 0) {
        this.total = this.readCount();
        return;
      }
      await yieldToEventLoop();
    }
  }

  private readCount(): number {
    const row = this.selectCount.get();
    if (!row) {
      throw new Error('COUNT query returned no row');
    }
    return readInteger(row, 'total');
  }
}

function toJobRecord(row: Row): JobRecord {
  const job: JobRecord = {
    id: readString(row, 'id'),
    createdAt: readInteger(row, 'createdAt'),
    raw: readString(row, 'raw'),
    printerName: readString(row, 'printerName'),
    source: readEnum(row, 'source', PRINT_SOURCES),
    status: readEnum(row, 'status', PRINT_STATUSES),
    forced: readInteger(row, 'forced') === 1,
  };
  if (row['failureReason'] !== null) {
    job.failureReason = readEnum(row, 'failureReason', PRINT_FAILURE_REASONS);
  }
  return job;
}

/** FTS5 短语查询：用双引号包住，内部双引号转义，避免被当成查询语法。 */
function toFtsPhrase(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

function assertCapacity(capacity: number): number {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`Invalid history capacity: ${capacity}`);
  }
  return capacity;
}
