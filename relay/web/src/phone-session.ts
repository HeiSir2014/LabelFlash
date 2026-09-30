/**
 * 手机端的协议：加入会话、用令牌打招呼、提交打印任务、把电脑的回复变成事件。
 *
 * 打印任务是幂等的：每个任务有手机生成的随机任务号，在拿到结果之前一直留在发件箱里（也存进 localStorage）。
 * 断线重连、电脑换了连接、页面被刷新，重新被接纳后把发件箱里的任务原样重发——电脑按任务号去重，
 * 已经收过的只回进度或结果，不会多打；网络再差也不会丢。
 * 已被接受的任务长时间没有进展，也用同一个任务号再问一次：中转服务可能丢帧，端到端靠这个补上。
 * 内层消息都经 AES-GCM 加密，中转服务只看得到外层信封。
 */
import { openMessage, randomId, sealMessage } from '../../../src/shared/mobile-crypto';
import {
  DESKTOP_GRACE_MS,
  type DenialReason,
  type DesktopMessage,
  type EndReason,
  type ImageRequest,
  isRequestRaw,
  JOB_ACK_TIMEOUT_MS,
  JOB_STATUS_POLL_MS,
  MOBILE_PROTOCOL_VERSION,
  type PhoneField,
  type PhoneFrame,
  type PhoneImage,
  type PhoneMessage,
  type PhonePrintResult,
  parseDesktopMessage,
  parseRelayToPhone,
  type QueuePosition,
  type RefusalReason,
  type RelayToPhone,
} from '../../../src/shared/mobile-protocol';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../../src/shared/relay-socket';
import type { SessionStore } from './session-store';

/** 会话发给页面的事件。 */
export type SessionEvent =
  /** reconnecting = 正在连中转服务；desktop-offline = 中转服务在，电脑暂时不在。 */
  | { type: 'link'; link: 'reconnecting' | 'desktop-offline' }
  /** image：电脑要手机随扫码截的标签图；不需要（或老电脑）时为 null。 */
  | { type: 'welcomed'; printer: string | null; image: ImageRequest | null }
  | { type: 'printer'; printer: string | null; image: ImageRequest | null }
  /** 新提交的任务，以及页面打开时从发件箱恢复的任务。 */
  | { type: 'submitted'; job: string; raw: string; force: boolean }
  /** 任务在电脑上排队，或者队伍往前走了。 */
  | { type: 'queued'; positions: QueuePosition[] }
  | { type: 'started'; job: string }
  | { type: 'result'; job: string; result: PhonePrintResult }
  | { type: 'refused'; job: string; reason: RefusalReason }
  | { type: 'ended'; reason: EndReason }
  | { type: 'not-found' }
  | { type: 'denied'; reason: DenialReason }
  /** 中转服务不支持这个页面的协议版本：刷新页面拿新版本。 */
  | { type: 'outdated' };

export interface PhoneSessionOptions {
  relayUrl: string;
  session: string;
  key: CryptoKey;
  device: string;
  store: SessionStore;
  createSocket: (url: string) => SocketLike;
  timers: SocketTimers;
  now: () => number;
  onEvent: (event: SessionEvent) => void;
}

/**
 * 任务随带的东西：摆正的标签图（电脑要时才有）和同一张标签接下来的几帧（电脑要几帧时才有，不含 image）、
 * 手机上手动输入的字段。
 */
export interface JobExtras {
  image: PhoneImage | null;
  moreImages: PhoneImage[];
  fields: PhoneField[];
}

export const NO_EXTRAS: JobExtras = { image: null, moreImages: [], fields: [] };

interface OutgoingJob extends JobExtras {
  raw: string;
  force: boolean;
  isAccepted: boolean;
  /** 重发计时器：没被接受时等 accepted（JOB_ACK_TIMEOUT_MS），接受之后等任何进展（JOB_STATUS_POLL_MS）。 */
  retryTimer: unknown;
}

export class PhoneSession {
  private readonly socket: RelaySocket<PhoneFrame>;
  /** 电脑在 welcome 里给的本次连接的随机数；没被接纳时为 null，这时任务先留在发件箱里。 */
  private nonce: string | null = null;
  private seq = 0;
  /** 发件箱：还没拿到结果的任务，按提交顺序排列（Map 保持插入顺序）。 */
  private readonly outbox = new Map<string, OutgoingJob>();
  /** 被这个会话接纳过：包括刷新页面之前（存着令牌）。 */
  private wasWelcomed: boolean;
  /** 被接纳过的会话第一次收到 not-found 的时间：中转服务可能刚重启，电脑还没连回来。 */
  private missingSince: number | null = null;
  /** 解密是异步的：收到的帧和断线都串成一条链，保证按发生的顺序处理。 */
  private inbox: Promise<void> = Promise.resolve();
  /** 加密也是异步的，几条同时加密可能乱序完成：串成一条链，保证按 seq 顺序发出。 */
  private outgoing: Promise<void> = Promise.resolve();
  private isStopped = false;

  constructor(private readonly options: PhoneSessionOptions) {
    for (const job of options.store.jobs) {
      this.outbox.set(job.id, {
        raw: job.raw,
        force: job.force,
        image: job.image ?? null,
        moreImages: job.moreImages ?? [],
        fields: job.fields ?? [],
        isAccepted: false,
        retryTimer: null,
      });
    }
    this.wasWelcomed = options.store.token !== null;
    this.socket = new RelaySocket<PhoneFrame>({
      url: options.relayUrl,
      createSocket: options.createSocket,
      timers: options.timers,
      onOpen: () => this.socket.send({ t: 'join', v: MOBILE_PROTOCOL_VERSION, session: options.session }),
      onFrame: (text) => {
        const frame = parseRelayToPhone(text);
        if (frame) {
          this.enqueue(() => this.handle(frame));
        } else {
          console.warn('[PhoneSession] dropped a malformed relay frame');
        }
      },
      onDown: () => this.enqueue(async () => this.handleDown()),
    });
  }

  start(): void {
    // 上次没拿到结果的任务（页面刷新或被系统回收之前留下的）先显示出来，被接纳后自动重发。
    for (const [job, entry] of this.outbox) {
      this.emit({ type: 'submitted', job, raw: entry.raw, force: entry.force });
    }
    this.socket.start();
  }

  stop(): void {
    this.isStopped = true;
    this.leaveChannel();
    this.socket.stop();
  }

  /** 提交一个打印任务，返回任务号。没连上时先留在发件箱里，被接纳后自动发出。 */
  submit(raw: string, force: boolean, extras: JobExtras = NO_EXTRAS): string {
    if (!isRequestRaw(raw)) {
      throw new Error('内容超过请求的长度上限，调用方应先检查');
    }
    const job = randomId();
    this.outbox.set(job, { raw, force, ...extras, isAccepted: false, retryTimer: null });
    this.saveOutbox();
    this.emit({ type: 'submitted', job, raw, force });
    this.send(job);
    return job;
  }

  /** 排进收件链。一条处理出错只记下来，不能卡住后面的。 */
  private enqueue(task: () => Promise<void>): void {
    this.inbox = this.inbox.then(task).catch((error: unknown) => {
      console.error('[PhoneSession] cannot handle a relay frame', error);
    });
  }

  private async handle(frame: RelayToPhone): Promise<void> {
    switch (frame.t) {
      case 'online':
        this.socket.markReady();
        await this.transmit({ type: 'hello', token: this.options.store.token, device: this.options.device });
        return;
      case 'waiting':
        this.socket.markReady();
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
        if (frame.code === 'version') {
          this.finish({ type: 'outdated' });
        } else {
          console.warn(`[PhoneSession] relay error ${frame.code}`);
        }
        return;
      case 'pong':
        return;
    }
  }

  private receive(message: DesktopMessage): void {
    switch (message.type) {
      case 'welcome':
        this.options.store.saveToken(message.token);
        this.nonce = message.nonce;
        this.seq = 0;
        this.wasWelcomed = true;
        this.missingSince = null;
        this.emit({ type: 'welcomed', printer: message.printer, image: message.image ?? null });
        // 新的连接：发件箱里的任务全部重发，已经收过的电脑会按任务号认出来。
        for (const job of this.outbox.keys()) {
          this.send(job);
        }
        return;
      case 'denied':
        this.finish({ type: 'denied', reason: message.reason });
        return;
      case 'printer':
        this.emit({ type: 'printer', printer: message.printer, image: message.image ?? null });
        return;
      case 'accepted':
        this.progress([{ job: message.job, ahead: message.ahead }]);
        return;
      case 'queue':
        this.progress(message.jobs);
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

  /** 排队位置：只转告发件箱里还有的任务（结果已到的不再退回「排队中」）。 */
  private progress(positions: QueuePosition[]): void {
    const known = positions.filter((position) => this.acknowledge(position.job));
    if (known.length > 0) {
      this.emit({ type: 'queued', positions: known });
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
      ...(job.image === null ? {} : { image: job.image }),
      ...(job.moreImages.length === 0 ? {} : { moreImages: job.moreImages }),
      ...(job.fields.length === 0 ? {} : { fields: job.fields }),
    });
    this.scheduleRetry(jobId, job);
  }

  /** 电脑有了这个任务的消息（排队或开始打印）：从现在起按进度查询的间隔等下一条。 */
  private acknowledge(jobId: string): boolean {
    const job = this.outbox.get(jobId);
    if (!job) {
      return false;
    }
    job.isAccepted = true;
    if (this.nonce !== null) {
      this.scheduleRetry(jobId, job);
    }
    return true;
  }

  private scheduleRetry(jobId: string, job: OutgoingJob): void {
    this.clearRetry(job);
    job.retryTimer = this.options.timers.setTimeout(
      () => {
        job.retryTimer = null;
        this.send(jobId);
      },
      job.isAccepted ? JOB_STATUS_POLL_MS : JOB_ACK_TIMEOUT_MS,
    );
  }

  private forget(jobId: string): boolean {
    const job = this.outbox.get(jobId);
    if (!job) {
      return false;
    }
    this.clearRetry(job);
    this.outbox.delete(jobId);
    this.saveOutbox();
    return true;
  }

  private saveOutbox(): void {
    this.options.store.saveJobs(
      [...this.outbox].map(([id, job]) => ({
        id,
        raw: job.raw,
        force: job.force,
        ...(job.image === null ? {} : { image: job.image }),
        ...(job.moreImages.length === 0 ? {} : { moreImages: job.moreImages }),
        ...(job.fields.length === 0 ? {} : { fields: job.fields }),
      })),
    );
  }

  /** 离开当前连接：nonce 作废，等下一次 welcome；发件箱保留。 */
  private leaveChannel(): void {
    this.nonce = null;
    for (const job of this.outbox.values()) {
      this.clearRetry(job);
    }
  }

  private clearRetry(job: OutgoingJob): void {
    if (job.retryTimer !== null) {
      this.options.timers.clearTimeout(job.retryTimer);
      job.retryTimer = null;
    }
  }

  private handleDown(): void {
    this.leaveChannel();
    // 等电脑回来的宽限期里，中转服务每次都回 not-found 并断开：这不是网络问题，提示在等电脑。
    this.emit({ type: 'link', link: this.missingSince === null ? 'reconnecting' : 'desktop-offline' });
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
      // 一条发不出去不能卡住后面的：记下来，任务还在发件箱里，下次 welcome 或重发计时到了会再发。
      .catch((error: unknown) => console.error('[PhoneSession] cannot send a message', error));
    return this.outgoing;
  }

  /**
   * 会话对这部手机结束了。发件箱里剩下的任务不会再有结果，从存储里清掉；
   * 只有版本不对时留着：刷新页面拿到新版本后还能接着发。
   */
  private finish(event: SessionEvent): void {
    this.emit(event);
    if (event.type !== 'outdated') {
      this.options.store.saveJobs([]);
    }
    this.stop();
  }

  private emit(event: SessionEvent): void {
    if (!this.isStopped) {
      this.options.onEvent(event);
    }
  }
}
