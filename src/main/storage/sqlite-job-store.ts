import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { JobStore, LastPrinted } from '../../core/job-store';
import type { ScanField } from '../../core/scan/scan-result';
import { type JobRecord, PRINT_FAILURE_REASONS, PRINT_SOURCES, PRINT_STATUSES } from '../../core/types';
import type { JobPage, JobQuery } from '../../shared/job-history';
import { runInTransaction } from './database';
import { type Row, readEnum, readInteger, readString } from './row-readers';

const JOB_COLUMNS = `
  jobs.seq, jobs.id, jobs.created_at AS createdAt, jobs.raw, jobs.printer_name AS printerName,
  jobs.source, jobs.status, jobs.forced, jobs.failure_reason AS failureReason, jobs.paper,
  jobs.template_id AS templateId, jobs.fields, jobs.caller,
  jobs.batch_id AS batchId, jobs.batch_row AS batchRow, jobs.batch_copy AS batchCopy,
  jobs.template_fingerprint AS templateFingerprint,
  jobs.pdf_file AS pdfFile, jobs.pdf_page AS pdfPage, jobs.pdf_piece AS pdfPiece, jobs.pdf_bitmap AS pdfBitmap`;
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
  private readonly selectById: StatementSync;
  private readonly selectBatchPage: StatementSync;
  private readonly selectBatchFailures: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    capacity: number,
  ) {
    this.capacity = assertCapacity(capacity);
    this.insertJob = db.prepare(`
      INSERT INTO jobs (id, created_at, raw, printer_name, source, status, forced, failure_reason, paper, template_id, fields, caller,
        batch_id, batch_row, batch_copy, template_fingerprint, pdf_file, pdf_page, pdf_piece, pdf_bitmap)
      VALUES (:id, :createdAt, :raw, :printerName, :source, :status, :forced, :failureReason, :paper, :templateId, :fields, :caller,
        :batchId, :batchRow, :batchCopy, :templateFingerprint, :pdfFile, :pdfPage, :pdfPiece, :pdfBitmap)`);
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
      WHERE status = 'printed' AND created_at >= :since AND caller IS NULL AND batch_id IS NULL AND pdf_bitmap IS NULL
      GROUP BY raw`);
    this.selectById = db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE jobs.id = :id`);
    // 按批次翻页：搜索只在这一批里用 LIKE（一批最多 2 万张，不需要全文索引）。
    this.selectBatchPage = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE jobs.batch_id = :batchId
        AND (:pattern IS NULL OR jobs.raw LIKE :pattern ESCAPE '\\')
        AND (:before IS NULL OR jobs.seq < :before)
      ORDER BY jobs.seq DESC LIMIT :limit`);
    // 每行每份最新的一条是失败的：重打成功过的不再算（重打和原来的记录同一个批次、行号、份号）。
    this.selectBatchFailures = db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE jobs.seq IN (
          SELECT MAX(seq) FROM jobs
          WHERE batch_id = :batchId AND (:row IS NULL OR batch_row = :row)
          GROUP BY batch_row, batch_copy)
        AND jobs.status = 'failed'
      ORDER BY jobs.batch_row, jobs.batch_copy`);
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
        paper: job.paper ?? null,
        templateId: job.templateId ?? null,
        fields: job.fields === undefined ? null : JSON.stringify(job.fields),
        caller: job.caller ?? null,
        batchId: job.batch?.id ?? null,
        batchRow: job.batch?.row ?? null,
        batchCopy: job.batch?.copy ?? null,
        templateFingerprint: job.templateFingerprint ?? null,
        pdfFile: job.pdf?.file ?? null,
        pdfPage: job.pdf?.page ?? null,
        pdfPiece: job.pdf?.piece ?? null,
        pdfBitmap: job.pdf?.bitmap ?? null,
      });
      return Number(this.trimBehind.run({ lastSeq: lastInsertRowid, capacity: this.capacity }).changes);
    });
    // 事务提交之后才更新内存总数：提交失败时数据库没变，总数也不能变。
    this.total += 1 - trimmed;
  }

  listPage(query: JobQuery): JobPage {
    const search = query.search?.trim() ?? '';
    const before = query.before ?? null;
    const rows =
      query.batchId === undefined
        ? this.selectRows(search, before, query.limit + 1)
        : this.selectBatchPage.all({
            batchId: query.batchId,
            pattern: search === '' ? null : `%${escapeLike(search)}%`,
            before,
            limit: query.limit + 1,
          });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const lastRow = pageRows.at(-1);
    return {
      jobs: pageRows.map(toJobRecord),
      nextCursor: hasMore && lastRow ? readInteger(lastRow, 'seq') : null,
      total: this.total,
    };
  }

  /** 按编号取一条（重打时用）；已经被环形保留删掉的返回 null。 */
  get(id: string): JobRecord | null {
    const row = this.selectById.get({ id });
    return row ? toJobRecord(row) : null;
  }

  /** 这一批里（只看某一行时传行号）每行每份最新一次是失败的记录，按行号、份号排：整批重打失败的用它。 */
  listBatchFailures(batchId: string, row: number | null): JobRecord[] {
    return this.selectBatchFailures.all({ batchId, row }).map(toJobRecord);
  }

  count(): number {
    return this.total;
  }

  /**
   * 扫码防重复窗口的恢复：只算扫码打的。本机接口、按字段重打（带调用方）、批量打印（带批次号）和 PDF 打印（带位图编号）
   * 都不用这个窗口，否则重启后扫到和它们打过的同样内容会被当成重复。
   */
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
  if (row['paper'] !== null) {
    job.paper = readString(row, 'paper');
  }
  if (row['templateId'] !== null) {
    job.templateId = readString(row, 'templateId');
  }
  if (row['fields'] !== null) {
    const fields = parseFields(readString(row, 'fields'));
    if (fields !== null) {
      job.fields = fields;
    }
  }
  if (row['caller'] !== null) {
    job.caller = readString(row, 'caller');
  }
  if (row['batchId'] !== null) {
    job.batch = {
      id: readString(row, 'batchId'),
      row: readInteger(row, 'batchRow'),
      copy: readInteger(row, 'batchCopy'),
    };
  }
  if (row['templateFingerprint'] !== null) {
    job.templateFingerprint = readString(row, 'templateFingerprint');
  }
  // 位图编号在，其余三项也必须在：readString / readInteger 遇到 NULL 抛错，坏行不当成合法记录。
  if (row['pdfBitmap'] !== null) {
    job.pdf = {
      file: readString(row, 'pdfFile'),
      page: readInteger(row, 'pdfPage'),
      piece: readInteger(row, 'pdfPiece'),
      bitmap: readString(row, 'pdfBitmap'),
    };
  }
  return job;
}

/** 库里的字段 JSON 不可信：解析失败按没有字段处理，不合格的项丢掉，不让一条坏记录拖垮整页。 */
function parseFields(text: string): ScanField[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    console.warn('[SqliteJobStore] stored fields are not JSON', error);
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .filter(
      (item): item is ScanField =>
        typeof item === 'object' && item !== null && typeof item.name === 'string' && typeof item.value === 'string',
    )
    .map((item) => ({ name: item.name, value: item.value }));
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
