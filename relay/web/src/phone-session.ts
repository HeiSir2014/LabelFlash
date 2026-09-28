/**
 * 手机端的协议：加入会话、用令牌打招呼、提交打印任务、把电脑的回复变成事件。
 *
 * 打印任务是幂等的：每个任务有手机生成的随机任务号，在拿到结果之前一直留在发件箱里。
 * 断线重连、电脑换了连接，重新被接纳后把发件箱里的任务原样重发——电脑按任务号去重，
 * 已经收过的只回进度或结果，不会多打；网络再差也不会丢。
 * 内层消息都经 AES-GCM 加密，中转服务只看得到外层信封。
 */
import { openMessage, randomId, sealMessage } from '../../../src/shared/mobile-crypto';
import {
  DESKTOP_GRACE_MS,
  type DesktopMessage,
  JOB_ACK_TIMEOUT_MS,
  MOBILE_PROTOCOL_VERSION,
  type PhoneMessage,
  parseDesktopMessage,
  parseRelayToPhone,
  type RelayToPhone,
} from '../../../src/shared/mobile-protocol';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../../src/shared/relay-socket';
import type { PhoneEvent } from './phone-state';
import type { TokenStore } from './token-store';

/** 会话发给页面的事件：就是页面状态机的这几种事件，直接送进 reducePhone。 */
export type SessionEvent = Extract<
  PhoneEvent,
  {
    type:
      | 'link'
      | 'welcomed'
      | 'printer'
      | 'accepted'
      | 'started'
      | 'result'
      | 'refused'
      | 'ended'
      | 'not-found'
      | 'denied';
  }
>;

export interface PhoneSessionOptions {
  relayUrl: string;
  session: string;
  key: CryptoKey;
  device: string;
  tokens: TokenStore;
  createSocket: (url: string) => SocketLike;
  timers: SocketTimers;
  now: () => number;
  onEvent: (event: SessionEvent) => void;
}

interface OutgoingJob {
  raw: string;
  force: boolean;
  isAccepted: boolean;
  /** 等 accepted 的计时器：到时还没回音就用同一个任务号重发。 */
  ackTimer: unknown;
}

export class PhoneSession {
  private readonly socket: RelaySocket;
  /** 电脑在 welcome 里给的本次连接的随机数；没被接纳时为 null，这时任务先留在发件箱里。 */
  private nonce: string | null = null;
  private seq = 0;
  /** 发件箱：还没拿到结果的任务，按提交顺序排列（Map 保持插入顺序）。 */
  private readonly outbox = new Map<string, OutgoingJob>();
  private wasWelcomed = false;
  /** 被接纳过的会话第一次收到 not-found 的时间：中转服务可能刚重启，电脑还没连回来。 */
  private missingSince: number | null = null;
  /** 解密是异步的：串成一条链，保证按收到的顺序处理。 */
  private inbox: Promise<void> = Promise.resolve();
  /** 加密也是异步的，几条同时加密可能乱序完成：串成一条链，保证按 seq 顺序发出。 */
  private outgoing: Promise<void> = Promise.resolve();
  private isStopped = false;

  constructor(private readonly options: PhoneSessionOptions) {
    this.socket = new RelaySocket({
      url: options.relayUrl,
      createSocket: options.createSocket,
      timers: options.timers,
      onOpen: () => this.socket.send({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: options.session }),
      onFrame: (text) => {
        const frame = parseRelayToPhone(text);
        if (frame) {
          this.inbox = this.inbox.then(() => this.handle(frame));
        }
      },
      onDown: () => {
        this.leaveChannel();
        this.emit({ type: 'link', link: 'reconnecting' });
      },
    });
  }

  start(): void {
    this.socket.start();
  }

  stop(): void {
    this.isStopped = true;
    this.leaveChannel();
    this.socket.stop();
  }

  /** 提交一个打印任务，返回任务号。没连上时先留在发件箱里，被接纳后自动发出。 */
  submit(raw: string, force: boolean): string {
    const job = randomId();
    this.outbox.set(job, { raw, force, isAccepted: false, ackTimer: null });
    this.send(job);
    return job;
  }

  private async handle(frame: RelayToPhone): Promise<void> {
    switch (frame.t) {
      case 'online':
        await this.transmit({
          type: 'hello',
          token: this.options.tokens.get(this.options.session),
          device: this.options.device,
        });
        return;
      case 'waiting':
        this.leaveChannel();
        this.emit({ type: 'link', link: 'desktop-offline' });
        return;
      case 'recv': {
        const message = parseDesktopMessage(
          await openMessage(this.options.key, 'd2p', this.options.session, frame.body),
        );
        if (message) {
          this.receive(message);
        } else {
          console.warn('[PhoneSession] dropped a message that could not be decrypted or parsed');
        }
        return;
      }
      case 'ended':
        this.finish({ type: 'ended', reason: frame.reason });
        return;
      case 'kicked':
        // 电脑移除这部手机时先发 denied 再让中转服务断开；只收到断开时也按「被移除」处理。
        this.finish({ type: 'denied', reason: 'removed' });
        return;
      case 'not-found':
        this.handleMissing();
        return;
      case 'error':
        console.warn(`[PhoneSession] relay error ${frame.code}`);
        return;
      case 'pong':
        return;
    }
  }

  private receive(message: DesktopMessage): void {
    switch (message.type) {
      case 'welcome':
        this.options.tokens.set(this.options.session, message.token);
        this.nonce = message.nonce;
        this.seq = 0;
        this.wasWelcomed = true;
        this.missingSince = null;
        this.emit({ type: 'welcomed', printer: message.printer });
        // 新的连接：发件箱里的任务全部重发，已经收过的电脑会按任务号认出来。
        for (const job of this.outbox.keys()) {
          this.send(job);
        }
        return;
      case 'denied':
        this.finish({ type: 'denied', reason: message.reason });
        return;
      case 'printer':
        this.emit({ type: 'printer', printer: message.printer });
        return;
      case 'accepted':
        if (this.acknowledge(message.job)) {
          this.emit({ type: 'accepted', job: message.job, ahead: message.ahead });
        }
        return;
      case 'started':
        if (this.acknowledge(message.job)) {
          this.emit({ type: 'started', job: message.job });
        }
        return;
      case 'result':
        if (this.forget(message.job)) {
          this.emit({ type: 'result', job: message.job, result: message.result });
        }
        return;
      case 'refused':
        if (this.forget(message.job)) {
          this.emit({ type: 'refused', job: message.job, reason: message.reason });
        }
        return;
    }
  }

  /** 发出发件箱里的一个任务；没被接纳时什么都不做，等下一次 welcome。 */
  private send(jobId: string): void {
    const job = this.outbox.get(jobId);
    if (!job || this.nonce === null) {
      return;
    }
    this.seq += 1;
    void this.transmit({
      type: 'submit',
      nonce: this.nonce,
      seq: this.seq,
      job: jobId,
      raw: job.raw,
      force: job.force,
    });
    this.clearAckTimer(job);
    if (!job.isAccepted) {
      job.ackTimer = this.options.timers.setTimeout(() => {
        job.ackTimer = null;
        this.send(jobId);
      }, JOB_ACK_TIMEOUT_MS);
    }
  }

  /** 电脑已收到这个任务（排队或开始打印）：不再因为确认超时重发。 */
  private acknowledge(jobId: string): boolean {
    const job = this.outbox.get(jobId);
    if (!job) {
      return false;
    }
    job.isAccepted = true;
    this.clearAckTimer(job);
    return true;
  }

  private forget(jobId: string): boolean {
    const job = this.outbox.get(jobId);
    if (!job) {
      return false;
    }
    this.clearAckTimer(job);
    this.outbox.delete(jobId);
    return true;
  }

  /** 离开当前连接：nonce 作废，等下一次 welcome；发件箱保留。 */
  private leaveChannel(): void {
    this.nonce = null;
    for (const job of this.outbox.values()) {
      this.clearAckTimer(job);
    }
  }

  private clearAckTimer(job: OutgoingJob): void {
    if (job.ackTimer !== null) {
      this.options.timers.clearTimeout(job.ackTimer);
      job.ackTimer = null;
    }
  }

  /**
   * 中转服务不认识这个会话：从没被接纳过，就是链接失效；被接纳过，就可能是中转服务刚重启、电脑还没连回来，
   * 按中转服务保留断线电脑的同一个宽限期等下去，过了宽限期才算失效。
   */
  private handleMissing(): void {
    if (!this.wasWelcomed) {
      this.finish({ type: 'not-found' });
      return;
    }
    const now = this.options.now();
    this.missingSince ??= now;
    if (now - this.missingSince >= DESKTOP_GRACE_MS) {
      this.finish({ type: 'not-found' });
    }
    // 否则什么都不做：中转服务会关掉这个连接，RelaySocket 按退避重连。
  }

  private transmit(message: PhoneMessage): Promise<void> {
    this.outgoing = this.outgoing
      .then(async () => {
        const body = await sealMessage(this.options.key, 'p2d', this.options.session, message);
        this.socket.send({ t: 'send', body });
      })
      // 一条发不出去不能卡住后面的：记下来，任务还在发件箱里，下次 welcome 或确认超时时会重发。
      .catch((error: unknown) => console.error('[PhoneSession] cannot send a message', error));
    return this.outgoing;
  }

  private finish(event: SessionEvent): void {
    this.emit(event);
    this.stop();
  }

  private emit(event: SessionEvent): void {
    if (!this.isStopped) {
      this.options.onEvent(event);
    }
  }
}
