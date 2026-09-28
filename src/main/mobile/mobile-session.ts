/**
 * 电脑端的会话状态（纯逻辑，时间由 Clock 注入）：认领手机、防重放、任务去重和结果、背压与限流、到期。
 *
 * 任务是幂等的：同一个任务号只执行一次。重发的任务号只回当前进度（accepted）或已有的结果（result），
 * 所以手机可以放心地在重连后重发——不会丢，也不会多打。
 */
import { timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../core/types';
import { randomId } from '../../shared/mobile-crypto';
import {
  type CloseReason,
  type DesktopMessage,
  MAX_PENDING_JOBS,
  type PhoneMessage,
  type PhonePrintResult,
} from '../../shared/mobile-protocol';

/** 二维码显示后多久没有手机打开就作废：拍到屏幕的人拿到的也只是一个很快过期的链接。 */
export const UNCLAIMED_TTL_MS = 10 * 60_000;
/** 认领后多久没有任务就自动结束：偶尔补打用完就放下了，不该一直连着。 */
export const IDLE_END_MS = 30 * 60_000;
/** 每分钟最多接受的任务数：热敏标签机大约一秒出一张，再快也打不出来。 */
export const MAX_JOBS_PER_MINUTE = 60;
/** 保留结果的任务数：远多于重连时要补发的几张；更早的任务号即使被重放，也会先被 nonce / seq 挡住。 */
export const JOB_MEMORY = 1_000;
const RATE_WINDOW_MS = 60_000;

export type HelloReply = { kind: 'welcome'; token: string; nonce: string } | { kind: 'taken' };

export type SubmitDecision =
  | { kind: 'ignore' }
  | { kind: 'reply'; message: DesktopMessage }
  /** 新任务：先回复 accepted，再按顺序执行，执行完调用 complete。 */
  | { kind: 'run'; reply: DesktopMessage; job: string; raw: string; force: boolean };

interface PhoneConnection {
  /** 认领或恢复成功后才有；被拒绝的连接一直是 null。 */
  nonce: string | null;
  lastSeq: number;
}

type JobState = { state: 'queued' } | { state: 'done'; result: PhonePrintResult };

export class MobileSession {
  private readonly createdAt: number;
  private claim: { token: string; device: string } | null = null;
  /** 当前代表已认领手机的连接号；手机断线时为 null。 */
  private claimedPhone: string | null = null;
  private readonly connections = new Map<string, PhoneConnection>();
  /** 任务号 → 状态，按接受顺序排列（Map 保持插入顺序），超出上限时删最早完成的。 */
  private readonly jobs = new Map<string, JobState>();
  private readonly acceptedAt: number[] = [];
  private lastActivity: number;
  private printedCount = 0;

  constructor(private readonly clock: Clock) {
    this.createdAt = clock.now();
    this.lastActivity = this.createdAt;
  }

  phoneJoined(phone: string): void {
    this.connections.set(phone, { nonce: null, lastSeq: 0 });
  }

  phoneLeft(phone: string): void {
    this.connections.delete(phone);
    if (this.claimedPhone === phone) {
      this.claimedPhone = null;
    }
  }

  hello(phone: string, message: Extract<PhoneMessage, { type: 'hello' }>): HelloReply {
    const connection = this.connections.get(phone);
    if (!connection) {
      return { kind: 'taken' };
    }
    if (this.claim === null) {
      this.claim = { token: randomId(), device: message.device };
      this.lastActivity = this.clock.now();
    } else if (message.token === null || !sameSecret(message.token, this.claim.token)) {
      return { kind: 'taken' };
    } else {
      this.claim.device = message.device;
    }
    this.claimedPhone = phone;
    connection.nonce = randomId();
    connection.lastSeq = 0;
    return { kind: 'welcome', token: this.claim.token, nonce: connection.nonce };
  }

  submit(phone: string, message: Extract<PhoneMessage, { type: 'submit' }>): SubmitDecision {
    const connection = this.connections.get(phone);
    // 只接受当前认领连接上、nonce 对得上、seq 严格递增的消息：挡住被拒绝的手机和重放的旧消息。
    if (
      phone !== this.claimedPhone ||
      !connection?.nonce ||
      !sameSecret(message.nonce, connection.nonce) ||
      message.seq <= connection.lastSeq
    ) {
      return { kind: 'ignore' };
    }
    connection.lastSeq = message.seq;
    const now = this.clock.now();
    this.lastActivity = now;
    const known = this.jobs.get(message.job);
    if (known?.state === 'queued') {
      return { kind: 'reply', message: { type: 'accepted', job: message.job } };
    }
    if (known?.state === 'done') {
      return { kind: 'reply', message: { type: 'result', job: message.job, result: known.result } };
    }
    if (this.pendingCount() >= MAX_PENDING_JOBS) {
      return { kind: 'reply', message: { type: 'refused', job: message.job, reason: 'too-many-pending' } };
    }
    this.forgetOldRates(now);
    if (this.acceptedAt.length >= MAX_JOBS_PER_MINUTE) {
      return { kind: 'reply', message: { type: 'refused', job: message.job, reason: 'rate-limited' } };
    }
    this.acceptedAt.push(now);
    this.jobs.set(message.job, { state: 'queued' });
    return {
      kind: 'run',
      reply: { type: 'accepted', job: message.job },
      job: message.job,
      raw: message.raw,
      force: message.force,
    };
  }

  /** 任务执行完：记下结果，返回要发给手机的消息。 */
  complete(job: string, result: PhonePrintResult): DesktopMessage {
    this.jobs.set(job, { state: 'done', result });
    if (result.status === 'printed') {
      this.printedCount += 1;
    }
    this.forgetOldJobs();
    return { type: 'result', job, result };
  }

  /** 结果发给谁：当前代表已认领手机的连接；手机断线时为 null（结果已保存，手机重连后重发任务号就能拿到）。 */
  claimedConnection(): string | null {
    return this.claimedPhone;
  }

  /** 还没有手机打开时，二维码的失效时间；已有手机时为 null。 */
  unclaimedUntil(): number | null {
    return this.claim === null ? this.createdAt + UNCLAIMED_TTL_MS : null;
  }

  /** 该结束时返回原因。有任务在排队时不算空闲。 */
  expiry(): CloseReason | null {
    const now = this.clock.now();
    if (this.claim === null) {
      return now - this.createdAt >= UNCLAIMED_TTL_MS ? 'idle' : null;
    }
    if (this.pendingCount() > 0) {
      return null;
    }
    return now - this.lastActivity >= IDLE_END_MS ? 'idle' : null;
  }

  status(): { phone: { device: string; online: boolean } | null; printed: number } {
    return {
      phone: this.claim ? { device: this.claim.device, online: this.claimedPhone !== null } : null,
      printed: this.printedCount,
    };
  }

  private pendingCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.state === 'queued') {
        count += 1;
      }
    }
    return count;
  }

  private forgetOldRates(now: number): void {
    while (this.acceptedAt.length > 0 && now - (this.acceptedAt[0] ?? now) >= RATE_WINDOW_MS) {
      this.acceptedAt.shift();
    }
  }

  private forgetOldJobs(): void {
    for (const [job, state] of this.jobs) {
      if (this.jobs.size <= JOB_MEMORY) {
        return;
      }
      // 只删已完成的：排队中的任务要等它的结果。
      if (state.state === 'done') {
        this.jobs.delete(job);
      }
    }
  }
}

/** 按常数时间比较令牌和 nonce，不让比较耗时泄露它们有几位是对的。 */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
