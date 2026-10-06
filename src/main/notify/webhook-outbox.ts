import type { Delivery } from '../../core/notify/delivery';
import { judgeResponse, nextAttemptAt } from '../../core/notify/delivery-schedule';
import { eventOf, payloadOf, type Station, testPayload } from '../../core/notify/webhook-event';
import { WEBHOOK_LIMITS, type WebhookEndpoint, webhookSourceOf } from '../../core/notify/webhook-model';
import type { ScanResult } from '../../core/scan/scan-result';
import type { Clock, JobRecord } from '../../core/types';
import type { NewDelivery, SqliteWebhookStore } from '../storage/sqlite-webhook-store';
import type { SendOutcome } from './webhook-sender';

/** 安排一次延迟执行，返回取消函数（生产环境是 setTimeout，测试里手动触发）。 */
export type Scheduler = (run: () => void, delayMs: number) => () => void;

export interface WebhookOutboxDeps {
  store: SqliteWebhookStore;
  send: (endpoint: WebhookEndpoint, delivery: Delivery) => Promise<SendOutcome>;
  /** 当前设置里的接口；每次发送时读取，改设置立即生效。 */
  endpoints: () => readonly WebhookEndpoint[];
  clock: Clock;
  station: Station;
  createId: () => string;
  schedule: Scheduler;
}

/**
 * 打印结果通知的发件箱：打印结果先落库，再在后台发送，不阻塞打印。
 * 每个接口按入队顺序逐条发送；失败按退避时间重试，重启后从数据库里接着发。
 * 接口被停用时它的通知先留着，重新启用后继续发；接口被删除时标记为失败。
 */
export class WebhookOutbox {
  private cancelTimer: (() => void) | null = null;
  private isRunning = false;
  private isRerunNeeded = false;
  private lastPendingPruneAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: WebhookOutboxDeps) {}

  start(): void {
    this.kick();
  }

  stop(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  /** 打印记录写入后调用：为订阅了这个事件、这个来源的接口入队。出任何错都只记日志，不影响打印。 */
  enqueueResult(job: JobRecord, scan: ScanResult | null): void {
    try {
      const event = eventOf(job.status);
      const source = webhookSourceOf(job);
      const endpoints = this.deps
        .endpoints()
        .filter((endpoint) => endpoint.enabled && endpoint.events.includes(event) && endpoint.sources.includes(source));
      if (endpoints.length === 0) {
        return;
      }
      const payload = JSON.stringify(payloadOf(job, scan, this.deps.station));
      const deliveries: NewDelivery[] = endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        eventId: job.id,
        event,
        payload,
      }));
      this.prunePendingNow();
      this.deps.store.enqueue(deliveries, this.deps.clock.now());
      if (deliveries.length > 0) {
        this.kick();
      }
    } catch (error) {
      console.error('[WebhookOutbox] failed to queue a print result', error);
    }
  }

  /** 「发送测试」：给这个接口发一条 test 事件（接口停用时也发，方便先调通再启用）。 */
  sendTest(endpointId: string): boolean {
    if (!this.deps.endpoints().some((endpoint) => endpoint.id === endpointId)) {
      return false;
    }
    const eventId = `test-${this.deps.createId()}`;
    const payload = JSON.stringify(testPayload(eventId, this.deps.clock.now(), this.deps.station));
    this.deps.store.enqueue([{ endpointId, eventId, event: 'test', payload }], this.deps.clock.now());
    this.kick();
    return true;
  }

  /** 失败或还在等待的通知立即重试。 */
  retryNow(deliveryId: number): boolean {
    const delivery = this.deps.store.get(deliveryId);
    if (!delivery || delivery.state === 'delivered') {
      return false;
    }
    const now = this.deps.clock.now();
    this.deps.store.save({ ...delivery, state: 'pending', nextAttemptAt: now }, now);
    this.kick();
    return true;
  }

  recent(limit: number): Delivery[] {
    return this.deps.store.recent(limit);
  }

  /** 发送所有到期的通知（每个接口最多一条），然后安排下一次。同一时间只跑一轮。 */
  async processDue(): Promise<void> {
    if (this.isRunning) {
      this.isRerunNeeded = true;
      return;
    }
    this.isRunning = true;
    try {
      do {
        this.isRerunNeeded = false;
        await this.processHeads();
      } while (this.isRerunNeeded);
    } finally {
      this.isRunning = false;
    }
    this.scheduleNext();
  }

  private async processHeads(): Promise<void> {
    const now = this.deps.clock.now();
    const endpoints = new Map(this.deps.endpoints().map((endpoint) => [endpoint.id, endpoint]));
    const work: Promise<void>[] = [];
    for (const delivery of this.deps.store.pendingHeads()) {
      const endpoint = endpoints.get(delivery.endpointId);
      if (!endpoint) {
        this.finish(delivery, { status: null, error: '接口已删除' }, 'failed', { isAttempt: false });
        this.isRerunNeeded = true;
        continue;
      }
      const isTest = delivery.event === 'test';
      if ((endpoint.enabled || isTest) && (delivery.nextAttemptAt ?? 0) <= now) {
        work.push(this.deliver(endpoint, delivery));
      }
    }
    await Promise.all(work);
  }

  private async deliver(endpoint: WebhookEndpoint, delivery: Delivery): Promise<void> {
    let outcome: SendOutcome;
    try {
      outcome = await this.deps.send(endpoint, delivery);
    } catch (error) {
      console.error('[WebhookOutbox] unexpected error while sending', error);
      outcome = { status: null, error: '发送时出错' };
    }
    const verdict = judgeResponse(outcome.status);
    if (verdict === 'delivered') {
      this.finish(delivery, outcome, 'delivered');
      this.isRerunNeeded = true;
      return;
    }
    if (verdict === 'reject') {
      this.finish(delivery, outcome, 'failed');
      this.isRerunNeeded = true;
      return;
    }
    const now = this.deps.clock.now();
    const attempts = delivery.attempts + 1;
    const next = nextAttemptAt(attempts, delivery.createdAt, now);
    if (next === null) {
      this.finish(delivery, { ...outcome, error: `多次重试仍失败，已放弃：${outcome.error ?? ''}` }, 'failed');
      this.isRerunNeeded = true;
      return;
    }
    this.deps.store.save(
      { ...delivery, attempts, lastStatus: outcome.status, lastError: outcome.error, nextAttemptAt: next },
      now,
    );
  }

  private finish(
    delivery: Delivery,
    outcome: SendOutcome,
    state: 'delivered' | 'failed',
    { isAttempt } = { isAttempt: true },
  ): void {
    this.deps.store.save(
      {
        ...delivery,
        state,
        attempts: delivery.attempts + (isAttempt ? 1 : 0),
        lastStatus: outcome.status,
        lastError: outcome.error,
        nextAttemptAt: null,
      },
      this.deps.clock.now(),
    );
  }

  /** 等待队列的上限（WEBHOOK_LIMITS）：最多每 pendingPruneIntervalMs 查一次，不是每张都查。 */
  private prunePendingNow(): void {
    const now = this.deps.clock.now();
    if (now - this.lastPendingPruneAt < WEBHOOK_LIMITS.pendingPruneIntervalMs) {
      return;
    }
    this.lastPendingPruneAt = now;
    const givenUp = this.deps.store.prunePending(
      { olderThan: now - WEBHOOK_LIMITS.pendingMaxAgeMs, keep: WEBHOOK_LIMITS.maxPendingDeliveries },
      now,
    );
    if (givenUp > 0) {
      console.warn(`[WebhookOutbox] gave up ${givenUp} deliveries that waited too long or overflowed the queue`);
    }
  }

  private kick(): void {
    this.cancelTimer?.();
    this.cancelTimer = this.deps.schedule(() => this.runInBackground(), 0);
  }

  /** 定时器里跑的一轮：任何错误都只记日志（例如退出时数据库已关闭）。 */
  private runInBackground(): void {
    this.processDue().catch((error: unknown) => console.error('[WebhookOutbox] delivery round failed', error));
  }

  /** 定时到最早一条可发送的通知（停用接口的通知不算，重新启用时会改设置并触发 kick）。 */
  private scheduleNext(): void {
    const enabled = new Set(
      this.deps
        .endpoints()
        .filter((endpoint) => endpoint.enabled)
        .map((endpoint) => endpoint.id),
    );
    const times = this.deps.store
      .pendingHeads()
      .filter((delivery) => enabled.has(delivery.endpointId) || delivery.event === 'test')
      .map((delivery) => delivery.nextAttemptAt ?? 0);
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (times.length > 0) {
      const delay = Math.max(0, Math.min(...times) - this.deps.clock.now());
      this.cancelTimer = this.deps.schedule(() => this.runInBackground(), delay);
    }
  }

  /** 设置里的接口变了（新增、启用）：马上看看有没有可以发的。 */
  endpointsChanged(): void {
    this.kick();
  }
}
