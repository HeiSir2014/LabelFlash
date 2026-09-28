/**
 * 电脑端的会话状态（纯逻辑，时间由 Clock 注入）：手机加入与移除、防重放、打印队列、任务去重、背压与限流、到期。
 *
 * - 多部手机共用一个二维码，每部手机有自己的令牌；电脑上可以随时移除某一部（令牌作废）。
 * - 所有手机的任务进同一个队列，先来先打，一次打一张；每个任务的结果只发给提交它的手机。
 * - 任务是幂等的：同一个任务号只执行一次，重发只回当前进度（accepted / started）或已有的结果。
 */
import { timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../core/types';
import { randomId } from '../../shared/mobile-crypto';
import {
  type CloseReason,
  type DenialReason,
  type DesktopMessage,
  MAX_PENDING_JOBS,
  MAX_PHONES_PER_SESSION,
  type PhoneMessage,
  type PhonePrintResult,
} from '../../shared/mobile-protocol';

/** 二维码显示后多久没有手机加入就作废：拍到屏幕的人拿到的也只是一个很快过期的链接。 */
export const UNCLAIMED_TTL_MS = 10 * 60_000;
/** 多久没有任务就自动结束：偶尔补打用完就放下了，不该一直连着。 */
export const IDLE_END_MS = 30 * 60_000;
/** 所有手机合计每分钟最多接受的任务数：热敏标签机大约一秒出一张，再快也打不出来。 */
export const MAX_JOBS_PER_MINUTE = 60;
/** 保留结果的任务数：远多于重连时要补发的几张；更早的任务号即使被重放，也会先被 nonce / seq 挡住。 */
export const JOB_MEMORY = 1_000;
const RATE_WINDOW_MS = 60_000;

export type HelloReply = { kind: 'welcome'; token: string; nonce: string } | { kind: 'denied'; reason: DenialReason };

/** 要发给某个手机连接的消息。手机不在线时不发：结果已保存，它重连后重发任务号就能拿到。 */
export interface Delivery {
  connection: string;
  message: DesktopMessage;
}

export type SubmitDecision =
  | { kind: 'ignore' }
  | { kind: 'reply'; message: DesktopMessage }
  /** 新任务：先回复 accepted，再按队列顺序执行（started → complete）。 */
  | { kind: 'run'; reply: DesktopMessage; job: string; raw: string; force: boolean };

export interface PhoneSummary {
  /** 电脑界面上用来指认、移除这部手机；不是令牌。 */
  id: string;
  device: string;
  online: boolean;
  printed: number;
}

interface Phone {
  id: string;
  token: string;
  device: string;
  /** 当前连接号；断线时为 null。 */
  connection: string | null;
  /** 本次连接的 welcome 给的 nonce 和已收到的最大 seq。 */
  nonce: string | null;
  lastSeq: number;
  printed: number;
}

type Job = { owner: string; state: 'queued' | 'printing' } | { owner: string; state: 'done'; result: PhonePrintResult };

export class MobileSession {
  private readonly createdAt: number;
  private hasEverJoined = false;
  /** 按加入顺序排列（Map 保持插入顺序），界面上的手机列表也按这个顺序。 */
  private readonly phones = new Map<string, Phone>();
  /** 连接号 → 手机 id；连上了还没加入（或被拒绝）的连接为 null。 */
  private readonly connections = new Map<string, string | null>();
  private readonly jobs = new Map<string, Job>();
  /** 还没出结果的任务，按先来后到排列；打印中的在最前面。 */
  private readonly queue: string[] = [];
  private readonly acceptedAt: number[] = [];
  private lastActivity: number;
  private printedCount = 0;

  constructor(private readonly clock: Clock) {
    this.createdAt = clock.now();
    this.lastActivity = this.createdAt;
  }

  phoneJoined(connection: string): void {
    this.connections.set(connection, null);
  }

  phoneLeft(connection: string): void {
    const phone = this.phoneAt(connection);
    this.connections.delete(connection);
    if (phone) {
      phone.connection = null;
      phone.nonce = null;
    }
  }

  hello(connection: string, message: Extract<PhoneMessage, { type: 'hello' }>): HelloReply {
    if (!this.connections.has(connection)) {
      return { kind: 'denied', reason: 'removed' };
    }
    let phone: Phone;
    if (message.token === null) {
      if (this.phones.size >= MAX_PHONES_PER_SESSION) {
        return { kind: 'denied', reason: 'full' };
      }
      phone = {
        id: randomId(),
        token: randomId(),
        device: message.device,
        connection,
        nonce: null,
        lastSeq: 0,
        printed: 0,
      };
      this.phones.set(phone.id, phone);
      this.hasEverJoined = true;
      this.lastActivity = this.clock.now();
    } else {
      const known = this.phoneWithToken(message.token);
      // 不认识的令牌只可能来自被移除的手机（令牌已作废）：不能让它换个连接又混进来。
      if (!known) {
        return { kind: 'denied', reason: 'removed' };
      }
      phone = known;
      if (phone.connection !== null && phone.connection !== connection) {
        // 同一部手机换了连接（刷新页面、换网络）：旧连接不再代表它。
        this.connections.set(phone.connection, null);
      }
      phone.device = message.device;
    }
    phone.connection = connection;
    phone.nonce = randomId();
    phone.lastSeq = 0;
    this.connections.set(connection, phone.id);
    return { kind: 'welcome', token: phone.token, nonce: phone.nonce };
  }

  submit(connection: string, message: Extract<PhoneMessage, { type: 'submit' }>): SubmitDecision {
    const phone = this.phoneAt(connection);
    // 只接受已加入的手机、nonce 对得上、seq 严格递增的消息：挡住没加入的连接和重放的旧消息。
    if (!phone?.nonce || !sameSecret(message.nonce, phone.nonce) || message.seq <= phone.lastSeq) {
      return { kind: 'ignore' };
    }
    phone.lastSeq = message.seq;
    const now = this.clock.now();
    this.lastActivity = now;
    const known = this.jobs.get(message.job);
    if (known) {
      // 任务号是手机生成的随机数：别的手机不会用到同一个，用到了就是伪造，不理会。
      return known.owner === phone.id
        ? { kind: 'reply', message: this.progressOf(message.job, known) }
        : { kind: 'ignore' };
    }
    if (this.pendingOf(phone.id) >= MAX_PENDING_JOBS) {
      return { kind: 'reply', message: { type: 'refused', job: message.job, reason: 'too-many-pending' } };
    }
    this.forgetOldRates(now);
    if (this.acceptedAt.length >= MAX_JOBS_PER_MINUTE) {
      return { kind: 'reply', message: { type: 'refused', job: message.job, reason: 'rate-limited' } };
    }
    this.acceptedAt.push(now);
    this.jobs.set(message.job, { owner: phone.id, state: 'queued' });
    this.queue.push(message.job);
    return {
      kind: 'run',
      reply: { type: 'accepted', job: message.job, ahead: this.queue.length - 1 },
      job: message.job,
      raw: message.raw,
      force: message.force,
    };
  }

  /** 任务开始打印。任务已不在队列里（它的手机被移除了）时返回 null，调用方就不再打印它。 */
  started(jobId: string): Delivery[] | null {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== 'queued' || !this.queue.includes(jobId)) {
      return null;
    }
    this.jobs.set(jobId, { owner: job.owner, state: 'printing' });
    return this.deliver(job.owner, { type: 'started', job: jobId });
  }

  /** 任务执行完：记下结果，发给提交它的手机，并告诉排在后面的手机队伍往前走了。 */
  complete(jobId: string, result: PhonePrintResult): Delivery[] {
    const job = this.jobs.get(jobId);
    if (!job) {
      return [];
    }
    this.jobs.set(jobId, { owner: job.owner, state: 'done', result });
    this.removeFromQueue(jobId);
    if (result.status === 'printed') {
      this.printedCount += 1;
      const phone = this.phones.get(job.owner);
      if (phone) {
        phone.printed += 1;
      }
    }
    this.forgetOldJobs();
    return [...this.deliver(job.owner, { type: 'result', job: jobId, result }), ...this.queuePositions()];
  }

  /**
   * 移除一部手机：令牌作废，它排队中的任务不再打印（正在打印的那张照常打完）。
   * 返回要断开的连接，以及排在后面的手机的新位置。
   */
  removePhone(id: string): { kick: string | null; deliveries: Delivery[] } {
    const phone = this.phones.get(id);
    if (!phone) {
      return { kick: null, deliveries: [] };
    }
    this.phones.delete(id);
    if (phone.connection !== null) {
      this.connections.set(phone.connection, null);
    }
    for (const jobId of [...this.queue]) {
      const job = this.jobs.get(jobId);
      if (job?.owner === id && job.state === 'queued') {
        this.jobs.delete(jobId);
        this.removeFromQueue(jobId);
      }
    }
    return { kick: phone.connection, deliveries: this.queuePositions() };
  }

  /** 在线手机的连接号（打印机变了要告诉它们）。 */
  onlineConnections(): string[] {
    return [...this.phones.values()].flatMap((phone) => (phone.connection === null ? [] : [phone.connection]));
  }

  /** 还没有手机加入时，二维码的失效时间；有手机加入过之后为 null。 */
  unclaimedUntil(): number | null {
    return this.hasEverJoined ? null : this.createdAt + UNCLAIMED_TTL_MS;
  }

  /** 该结束时返回原因。队列里还有任务时不算空闲。 */
  expiry(): CloseReason | null {
    const now = this.clock.now();
    if (!this.hasEverJoined) {
      return now - this.createdAt >= UNCLAIMED_TTL_MS ? 'idle' : null;
    }
    if (this.queue.length > 0) {
      return null;
    }
    return now - this.lastActivity >= IDLE_END_MS ? 'idle' : null;
  }

  status(): { phones: PhoneSummary[]; printed: number; queued: number } {
    return {
      phones: [...this.phones.values()].map((phone) => ({
        id: phone.id,
        device: phone.device,
        online: phone.connection !== null,
        printed: phone.printed,
      })),
      printed: this.printedCount,
      queued: this.queue.length,
    };
  }

  private progressOf(jobId: string, job: Job): DesktopMessage {
    switch (job.state) {
      case 'queued':
        return { type: 'accepted', job: jobId, ahead: this.queue.indexOf(jobId) };
      case 'printing':
        return { type: 'started', job: jobId };
      case 'done':
        return { type: 'result', job: jobId, result: job.result };
    }
  }

  /** 排队中的每个任务的当前位置，发给各自的手机。 */
  private queuePositions(): Delivery[] {
    return this.queue.flatMap((jobId, ahead) => {
      const job = this.jobs.get(jobId);
      return job?.state === 'queued' ? this.deliver(job.owner, { type: 'accepted', job: jobId, ahead }) : [];
    });
  }

  private deliver(phoneId: string, message: DesktopMessage): Delivery[] {
    const connection = this.phones.get(phoneId)?.connection ?? null;
    return connection === null ? [] : [{ connection, message }];
  }

  private phoneAt(connection: string): Phone | undefined {
    const id = this.connections.get(connection);
    return id ? this.phones.get(id) : undefined;
  }

  private phoneWithToken(token: string): Phone | undefined {
    return [...this.phones.values()].find((phone) => sameSecret(token, phone.token));
  }

  private pendingOf(phoneId: string): number {
    return this.queue.filter((jobId) => this.jobs.get(jobId)?.owner === phoneId).length;
  }

  private removeFromQueue(jobId: string): void {
    const index = this.queue.indexOf(jobId);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  private forgetOldRates(now: number): void {
    while (this.acceptedAt.length > 0 && now - (this.acceptedAt[0] ?? now) >= RATE_WINDOW_MS) {
      this.acceptedAt.shift();
    }
  }

  private forgetOldJobs(): void {
    for (const [jobId, job] of this.jobs) {
      if (this.jobs.size <= JOB_MEMORY) {
        return;
      }
      // 只删已完成的：排队中和打印中的任务还要等它的结果。
      if (job.state === 'done') {
        this.jobs.delete(jobId);
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
