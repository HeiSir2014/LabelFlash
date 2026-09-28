import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { DELIVERY_STATES, type Delivery } from '../../core/notify/delivery';
import { WEBHOOK_EVENTS, WEBHOOK_LIMITS, type WebhookEventType } from '../../core/notify/webhook-model';
import { runInTransaction } from './database';
import { readEnum, readInteger, readString } from './row-readers';

const EVENT_TYPES: readonly WebhookEventType[] = [...WEBHOOK_EVENTS, 'test'];
const COLUMNS = `id, endpoint_id, event_id, event, payload, state, attempts, last_status, last_error,
  created_at, next_attempt_at, updated_at`;

export interface NewDelivery {
  endpointId: string;
  eventId: string;
  event: WebhookEventType;
  payload: string;
}

/** 通知的发送队列和发送记录。 */
export class SqliteWebhookStore {
  private readonly insert: StatementSync;
  private readonly selectHeads: StatementSync;
  private readonly selectRecent: StatementSync;
  private readonly selectOne: StatementSync;
  private readonly update: StatementSync;
  private readonly prune: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    this.insert = db.prepare(`
      INSERT INTO webhook_deliveries
        (endpoint_id, event_id, event, payload, state, attempts, created_at, next_attempt_at, updated_at)
      VALUES (:endpointId, :eventId, :event, :payload, 'pending', 0, :now, :now, :now)`);
    // 每个接口最早的一条待发送记录：同一接口按顺序发，前一条没发出去后面的就等着。
    this.selectHeads = db.prepare(`
      SELECT ${COLUMNS} FROM webhook_deliveries WHERE id IN (
        SELECT MIN(id) FROM webhook_deliveries WHERE state = 'pending' GROUP BY endpoint_id
      ) ORDER BY id`);
    this.selectRecent = db.prepare(`SELECT ${COLUMNS} FROM webhook_deliveries ORDER BY id DESC LIMIT :limit`);
    this.selectOne = db.prepare(`SELECT ${COLUMNS} FROM webhook_deliveries WHERE id = :id`);
    this.update = db.prepare(`
      UPDATE webhook_deliveries
      SET state = :state, attempts = :attempts, last_status = :lastStatus, last_error = :lastError,
          next_attempt_at = :nextAttemptAt, updated_at = :now
      WHERE id = :id`);
    // 只清理已完成的记录；待发送的一条都不能丢。
    this.prune = db.prepare(`
      DELETE FROM webhook_deliveries WHERE state != 'pending' AND id NOT IN (
        SELECT id FROM webhook_deliveries WHERE state != 'pending' ORDER BY id DESC LIMIT :keep
      )`);
  }

  enqueue(deliveries: readonly NewDelivery[], now: number): void {
    if (deliveries.length === 0) {
      return;
    }
    runInTransaction(this.db, () => {
      for (const delivery of deliveries) {
        this.insert.run({ ...delivery, now });
      }
    });
  }

  /** 每个接口排在最前面的待发送记录（不管到没到时间）。 */
  pendingHeads(): Delivery[] {
    return this.selectHeads.all().map(toDelivery);
  }

  recent(limit: number): Delivery[] {
    return this.selectRecent.all({ limit }).map(toDelivery);
  }

  get(id: number): Delivery | null {
    const row = this.selectOne.get({ id });
    return row ? toDelivery(row) : null;
  }

  save(delivery: Delivery, now: number): void {
    this.update.run({
      id: delivery.id,
      state: delivery.state,
      attempts: delivery.attempts,
      lastStatus: delivery.lastStatus,
      lastError: delivery.lastError,
      nextAttemptAt: delivery.nextAttemptAt,
      now,
    });
    if (delivery.state !== 'pending') {
      this.prune.run({ keep: WEBHOOK_LIMITS.keptDeliveries });
    }
  }
}

function toDelivery(row: Record<string, unknown>): Delivery {
  return {
    id: readInteger(row, 'id'),
    endpointId: readString(row, 'endpoint_id'),
    eventId: readString(row, 'event_id'),
    event: readEnum(row, 'event', EVENT_TYPES),
    payload: readString(row, 'payload'),
    state: readEnum(row, 'state', DELIVERY_STATES),
    attempts: readInteger(row, 'attempts'),
    lastStatus: nullableInteger(row, 'last_status'),
    lastError: row['last_error'] === null ? null : readString(row, 'last_error'),
    createdAt: readInteger(row, 'created_at'),
    nextAttemptAt: nullableInteger(row, 'next_attempt_at'),
    updatedAt: readInteger(row, 'updated_at'),
  };
}

function nullableInteger(row: Record<string, unknown>, column: string): number | null {
  return row[column] === null ? null : readInteger(row, column);
}
