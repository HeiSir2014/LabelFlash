/**
 * 电脑端的会话状态（纯逻辑，时间由 Clock 注入）：手机加入与移除、防重放、打印队列、任务去重、背压与限流、到期。
 *
 * - 多部手机共用一个二维码，每部手机有自己的令牌；电脑上可以随时移除某一部（令牌作废，并暂停新手机加入）。
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
  IDLE_END_MS,
  MAX_PENDING_JOBS,
  MAX_PHONES_PER_SESSION,
  type PhoneField,
  type PhoneImage,
  type PhoneMessage,
  type PhonePrintResult,
  type QueuePosition,
  UNCLAIMED_TTL_MS,
} from '../../shared/mobile-protocol';
import type { MobilePhone } from '../../shared/mobile-status';

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

/** 一个手机任务要打印的内容：扫到的内容、是否补打、随扫码截的标签图（同一张标签连续的几帧，按顺序）、手机上手动输入的字段。 */
export interface PhoneJob {
  raw: string;
  force: boolean;
  images: PhoneImage[];
  fields: PhoneField[];
}

export type SubmitDecision =
  | { kind: 'ignore' }
  | { kind: 'reply'; message: DesktopMessage }
  /** 新任务：先回复 accepted，再按队列顺序执行（started → complete）。 */
  | { kind: 'run'; reply: DesktopMessage; job: string; request: PhoneJob };

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

type Job =
  /** ahead：最近一次告诉手机的排队位置，位置变了才再发。 */
  | { owner: string; state: 'queued'; ahead: number }
  | { owner: string; state: 'printing' }
  | { owner: string; state: 'done'; result: PhonePrintResult };

export class MobileSession {
  /** 二维码第一次显示（中转服务确认会话）的时间：没人打开的二维码从这时起算过期。 */
  private shownAt: number | null = null;
  private hasEverJoined = false;
  private isJoinLocked = false;
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
    this.lastActivity = clock.now();
  }

  /**
   * 中转服务确认了会话（第一次，或断线重连之后）。重连时中转服务可能已经换过一轮手机连接：
   * 旧的连接一律作废，由中转服务重新通知（joined），手机重新打招呼（hello）后再对上号。
   */
  relayOpened(): void {
    this.shownAt ??= this.clock.now();
    this.connections.clear();
    for (const phone of this.phones.values()) {
      phone.connection = null;
      phone.nonce = null;
    }
  }

  phoneJoined(connection: string): void {
    this.connections.set(connection, null);
  }

  phoneLeft(connection: string): void {
    const phone = this.phoneAt(connection);
    this.connections.delete(connection);
    if (phone?.connection === connection) {
      phone.connection = null;
      phone.nonce = null;
    }
  }

  hello(connection: string, message: Extract<PhoneMessage, { type: 'hello' }>): HelloReply {
    if (!this.connections.has(connection)) {
      return { kind: 'denied', reason: 'removed' };
    }
    // 同一个连接又打一次招呼（电脑重连后中转服务让手机重新打招呼）：先解开它和原来那部手机的关系，
    // 否则令牌对不上时原来那部手机会一直显示在线。
    this.unbind(connection);
    let phone: Phone;
    if (message.token === null) {
      if (this.isJoinLocked) {
        return { kind: 'denied', reason: 'locked' };
      }
      if (this.phones.size >= MAX_PHONES_PER_SESSION) {
        return { kind: 'denied', reason: 'full' };
      }
      phone = {
        id: randomId(),
        token: randomId(),
        device: message.device,
        connection: null,
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
      if (phone.connection !== null) {
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
    const ahead = this.queue.length;
    this.jobs.set(message.job, { owner: phone.id, state: 'queued', ahead });
    this.queue.push(message.job);
    return {
      kind: 'run',
      reply: { type: 'accepted', job: message.job, ahead },
      job: message.job,
      request: {
        raw: message.raw,
        force: message.force,
        images: message.images,
        fields: message.fields,
      },
    };
  }

  /** 任务开始打印。任务已不在队列里（它的手机被移除了）时返回 null，调用方就不再打印它。 */
  started(jobId: string): Delivery[] | null {
    const job = this.jobs.get(jobId);
    if (job?.state !== 'queued' || !this.queue.includes(jobId)) {
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
    return [...this.deliver(job.owner, { type: 'result', job: jobId, result }), ...this.queueUpdates()];
  }

  /**
   * 移除一部手机：令牌作废，它排队中的任务不再打印（正在打印的那张照常打完）。
   * 同时暂停新手机加入：被移除的人还拿着二维码，换个浏览器就能以新手机的身份回来；要加新手机时在电脑上重新允许。
   * 返回要断开的连接，以及排在后面的手机的新位置。
   */
  removePhone(id: string): { kick: string | null; deliveries: Delivery[] } {
    const phone = this.phones.get(id);
    if (!phone) {
      return { kick: null, deliveries: [] };
    }
    this.phones.delete(id);
    this.isJoinLocked = true;
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
    return { kick: phone.connection, deliveries: this.queueUpdates() };
  }

  /** 暂停或重新允许新手机加入；已加入的手机不受影响。 */
  setJoinLocked(locked: boolean): void {
    this.isJoinLocked = locked;
  }

  /** 在线手机的连接号（打印机变了要告诉它们）。 */
  onlineConnections(): string[] {
    return [...this.phones.values()].flatMap((phone) => (phone.connection === null ? [] : [phone.connection]));
  }

  /** 还没有手机加入时，二维码的失效时间；有手机加入过（或者二维码还没显示）时为 null。 */
  unclaimedUntil(): number | null {
    return this.hasEverJoined || this.shownAt === null ? null : this.shownAt + UNCLAIMED_TTL_MS;
  }

  /** 该结束时返回原因。队列里还有任务时不算空闲。 */
  expiry(): CloseReason | null {
    const now = this.clock.now();
    if (!this.hasEverJoined) {
      const until = this.unclaimedUntil();
      return until !== null && now >= until ? 'idle' : null;
    }
    if (this.queue.length > 0) {
      return null;
    }
    return now - this.lastActivity >= IDLE_END_MS ? 'idle' : null;
  }

  status(): { phones: MobilePhone[]; printed: number; queued: number; joinLocked: boolean } {
    return {
      phones: [...this.phones.values()].map((phone) => ({
        id: phone.id,
        device: phone.device,
        online: phone.connection !== null,
        printed: phone.printed,
      })),
      printed: this.printedCount,
      queued: this.queue.length,
      joinLocked: this.isJoinLocked,
    };
  }

  private progressOf(jobId: string, job: Job): DesktopMessage {
    switch (job.state) {
      case 'queued': {
        const ahead = this.queue.indexOf(jobId);
        this.jobs.set(jobId, { ...job, ahead });
        return { type: 'accepted', job: jobId, ahead };
      }
      case 'printing':
        return { type: 'started', job: jobId };
      case 'done':
        return { type: 'result', job: jobId, result: job.result };
    }
  }

  /**
   * 队伍往前走之后的位置更新：每部手机一条，列出它所有排队中的任务；位置都没变的手机不发。
   * 一次打印最多引出「结果 + 每部手机一条」，不会因为排队的任务多而刷爆中转服务的限速。
   */
  private queueUpdates(): Delivery[] {
    const byOwner = new Map<string, { positions: QueuePosition[]; hasMoved: boolean }>();
    this.queue.forEach((jobId, ahead) => {
      const job = this.jobs.get(jobId);
      if (job?.state !== 'queued') {
        return;
      }
      const entry = byOwner.get(job.owner) ?? { positions: [], hasMoved: false };
      entry.positions.push({ job: jobId, ahead });
      entry.hasMoved ||= job.ahead !== ahead;
      byOwner.set(job.owner, entry);
      this.jobs.set(jobId, { ...job, ahead });
    });
    return [...byOwner].flatMap(([owner, { positions, hasMoved }]) =>
      hasMoved ? this.deliver(owner, { type: 'queue', jobs: positions }) : [],
    );
  }

  private deliver(phoneId: string, message: DesktopMessage): Delivery[] {
    const connection = this.phones.get(phoneId)?.connection ?? null;
    return connection === null ? [] : [{ connection, message }];
  }

  private phoneAt(connection: string): Phone | undefined {
    const id = this.connections.get(connection);
    return id ? this.phones.get(id) : undefined;
  }

  /** 解开连接和它当前代表的手机。 */
  private unbind(connection: string): void {
    const phone = this.phoneAt(connection);
    this.connections.set(connection, null);
    if (phone?.connection === connection) {
      phone.connection = null;
      phone.nonce = null;
    }
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
