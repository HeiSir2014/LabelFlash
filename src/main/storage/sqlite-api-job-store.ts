import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ApiJobPage, ApiJobStore } from '../../core/api/api-job-store';
import { PRINT_JOB_FAILURES, PRINT_JOB_STATES, type PrintJob } from '../../core/api/api-model';
import type { ScanField } from '../../core/scan/scan-result';
import { type Row, readEnum, readInteger, readString } from './row-readers';

const COLUMNS = `
  seq, id, caller, request_id AS requestId, template_id AS templateId, fields, content, copies,
  sent_copies AS sentCopies, printer, state, failure_reason AS failureReason, failure_message AS failureMessage,
  created_at AS createdAt, updated_at AS updatedAt`;

/** 本机接口的任务（api_jobs 表），实现 core 的 ApiJobStore。 */
export class SqliteApiJobStore implements ApiJobStore {
  private readonly insertJob: StatementSync;
  private readonly updateJob: StatementSync;
  private readonly selectById: StatementSync;
  private readonly selectByRequestId: StatementSync;
  private readonly selectPage: StatementSync;
  private readonly selectPending: StatementSync;
  private readonly selectUnfinished: StatementSync;
  private readonly deleteFinished: StatementSync;

  constructor(db: DatabaseSync) {
    this.insertJob = db.prepare(`
      INSERT INTO api_jobs (id, caller, request_id, template_id, fields, content, copies, sent_copies, printer,
        state, failure_reason, failure_message, created_at, updated_at)
      VALUES (:id, :caller, :requestId, :templateId, :fields, :content, :copies, :sentCopies, :printer,
        :state, :failureReason, :failureMessage, :createdAt, :updatedAt)`);
    // 请求内容（模板、字段、份数……）收下后不再变，只更新状态。
    this.updateJob = db.prepare(`
      UPDATE api_jobs SET state = :state, sent_copies = :sentCopies, failure_reason = :failureReason,
        failure_message = :failureMessage, updated_at = :updatedAt
      WHERE id = :id`);
    this.selectById = db.prepare(`SELECT ${COLUMNS} FROM api_jobs WHERE id = :id`);
    this.selectByRequestId = db.prepare(`
      SELECT ${COLUMNS} FROM api_jobs
      WHERE caller = :caller AND request_id = :requestId AND created_at >= :since
      ORDER BY seq DESC LIMIT 1`);
    this.selectPage = db.prepare(`
      SELECT ${COLUMNS} FROM api_jobs
      WHERE caller = :caller AND (:before IS NULL OR seq < :before)
      ORDER BY seq DESC LIMIT :limit`);
    this.selectPending = db.prepare(`
      SELECT COALESCE(SUM(copies - sent_copies), 0) AS pending FROM api_jobs WHERE state IN ('QUEUED', 'PRINTING')`);
    this.selectUnfinished = db.prepare(`
      SELECT ${COLUMNS} FROM api_jobs WHERE state IN ('QUEUED', 'PRINTING') ORDER BY seq`);
    this.deleteFinished = db.prepare(`
      DELETE FROM api_jobs WHERE created_at < :time AND state IN ('SENT', 'FAILED')`);
  }

  insert(job: PrintJob): void {
    this.insertJob.run({
      id: job.id,
      caller: job.caller,
      requestId: job.requestId,
      templateId: job.templateId,
      fields: JSON.stringify(job.fields),
      content: job.content,
      copies: job.copies,
      printer: job.printer,
      createdAt: job.createdAt,
      ...stateParams(job),
    });
  }

  update(job: PrintJob): void {
    const { changes } = this.updateJob.run({ id: job.id, ...stateParams(job) });
    if (Number(changes) !== 1) {
      throw new Error(`Unknown api job: ${job.id}`);
    }
  }

  get(id: string): PrintJob | null {
    const row = this.selectById.get({ id });
    return row ? toPrintJob(row) : null;
  }

  findByRequestId(caller: string, requestId: string, since: number): PrintJob | null {
    const row = this.selectByRequestId.get({ caller, requestId, since });
    return row ? toPrintJob(row) : null;
  }

  list(caller: string, limit: number, cursor: number | null): ApiJobPage {
    const rows = this.selectPage.all({ caller, before: cursor, limit: limit + 1 });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return { jobs: page.map(toPrintJob), nextCursor: hasMore && last ? readInteger(last, 'seq') : null };
  }

  pendingLabels(): number {
    const row = this.selectPending.get();
    return row ? readInteger(row, 'pending') : 0;
  }

  listUnfinished(): PrintJob[] {
    return this.selectUnfinished.all().map(toPrintJob);
  }

  deleteFinishedBefore(time: number): void {
    this.deleteFinished.run({ time });
  }
}

function stateParams(job: PrintJob) {
  return {
    state: job.state,
    sentCopies: job.sentCopies,
    failureReason: job.failure?.reason ?? null,
    failureMessage: job.failure?.message ?? null,
    updatedAt: job.updatedAt,
  };
}

function readNullableString(row: Row, column: string): string | null {
  return row[column] === null ? null : readString(row, column);
}

/** 字段 JSON 不合格说明数据损坏：直接抛错（和 row-readers 的约定一致）。 */
function readFields(row: Row): ScanField[] {
  const value: unknown = JSON.parse(readString(row, 'fields'));
  const isField = (item: unknown): item is ScanField =>
    typeof item === 'object' &&
    item !== null &&
    typeof (item as ScanField).name === 'string' &&
    typeof (item as ScanField).value === 'string';
  if (!Array.isArray(value) || !value.every(isField)) {
    throw new TypeError('Column "fields" is not a JSON field list');
  }
  return value.map((item) => ({ name: item.name, value: item.value }));
}

function toPrintJob(row: Row): PrintJob {
  const reason = row['failureReason'] === null ? null : readEnum(row, 'failureReason', PRINT_JOB_FAILURES);
  return {
    id: readString(row, 'id'),
    caller: readString(row, 'caller'),
    requestId: readNullableString(row, 'requestId'),
    templateId: readString(row, 'templateId'),
    fields: readFields(row),
    content: readNullableString(row, 'content'),
    copies: readInteger(row, 'copies'),
    printer: readNullableString(row, 'printer'),
    state: readEnum(row, 'state', PRINT_JOB_STATES),
    sentCopies: readInteger(row, 'sentCopies'),
    failure: reason === null ? null : { reason, message: readString(row, 'failureMessage') },
    createdAt: readInteger(row, 'createdAt'),
    updatedAt: readInteger(row, 'updatedAt'),
  };
}
