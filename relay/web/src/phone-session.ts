/**
 * 手机端的协议：加入会话、用令牌打招呼、发预览和打印请求、把电脑的回复变成页面事件。
 * 内层消息都经 AES-GCM 加密，中转服务只看得到外层信封。
 */
import { openMessage, sealMessage } from '../../../src/shared/mobile-crypto';
import {
  type DesktopMessage,
  MOBILE_PROTOCOL_VERSION,
  type PhoneMessage,
  parseDesktopMessage,
  parseRelayToPhone,
  RESUME_RETRY_MS,
  type RelayToPhone,
} from '../../../src/shared/mobile-protocol';
import { PRINT_TIMEOUT_MS } from '../../../src/shared/print-timing';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../../src/shared/relay-socket';
import type { PhoneEvent } from './phone-state';
import type { TokenStore } from './token-store';

/** 打印最多等 30 秒，再加上加工步骤里的查询和两段网络往返，留足余量。 */
export const REQUEST_TIMEOUT_MS = PRINT_TIMEOUT_MS * 2;

export interface PhoneSessionOptions {
  relayUrl: string;
  session: string;
  key: CryptoKey;
  device: string;
  tokens: TokenStore;
  createSocket: (url: string) => SocketLike;
  timers: SocketTimers;
  now: () => number;
  onEvent: (event: PhoneEvent) => void;
}

interface PendingRequest {
  id: number;
  kind: 'preview' | 'print';
  timer: unknown;
}

export class PhoneSession {
  private readonly socket: RelaySocket;
  /** 电脑在 welcome 里给的本次连接的随机数；没被接纳时为 null。 */
  private nonce: string | null = null;
  private nextId = 1;
  private pending: PendingRequest | null = null;
  private wasWelcomed = false;
  /** 被接纳过的会话第一次收到 not-found 的时间：中转服务可能刚重启，电脑还没连回来。 */
  private missingSince: number | null = null;
  /** 解密是异步的：串成一条链，保证按收到的顺序处理。 */
  private inbox: Promise<void> = Promise.resolve();
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
        this.nonce = null;
        this.failPending('timeout');
        this.emit({ type: 'link', link: 'reconnecting' });
      },
    });
  }

  start(): void {
    this.socket.start();
  }

  stop(): void {
    this.isStopped = true;
    this.clearPending();
    this.socket.stop();
  }

  preview(raw: string): void {
    this.request('preview', (nonce, id) => ({ type: 'preview', nonce, id, raw }));
  }

  print(raw: string, force: boolean): void {
    this.request('print', (nonce, id) => ({ type: 'print', nonce, id, raw, force }));
  }

  private request(kind: PendingRequest['kind'], build: (nonce: string, id: number) => PhoneMessage): void {
    if (this.nonce === null || this.pending !== null) {
      // 页面只在连上并被接纳、且没有进行中的请求时才让用户操作；走到这里说明连接刚好断了。
      this.emit({ type: 'request-failed', reason: 'timeout' });
      return;
    }
    const id = this.nextId++;
    const timer = this.options.timers.setTimeout(() => {
      if (this.pending?.id === id) {
        this.pending = null;
        this.emit({ type: 'request-failed', reason: 'timeout' });
      }
    }, REQUEST_TIMEOUT_MS);
    this.pending = { id, kind, timer };
    void this.send(build(this.nonce, id));
  }

  private async handle(frame: RelayToPhone): Promise<void> {
    switch (frame.t) {
      case 'online':
        await this.send({
          type: 'hello',
          token: this.options.tokens.get(this.options.session),
          device: this.options.device,
        });
        return;
      case 'waiting':
        this.nonce = null;
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
        this.finish({ type: 'taken' });
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
        this.wasWelcomed = true;
        this.missingSince = null;
        this.emit({ type: 'welcomed', printer: message.printer });
        return;
      case 'rejected':
        this.finish({ type: 'taken' });
        return;
      case 'preview':
        if (this.takePending(message.id, 'preview')) {
          this.emit({ type: 'preview-result', result: message.result });
        }
        return;
      case 'print':
        if (this.takePending(message.id, 'print')) {
          this.emit({ type: 'print-result', result: message.result });
        }
        return;
      case 'busy':
      case 'rate-limited':
        if (this.takePending(message.id, this.pending?.kind ?? 'print')) {
          this.emit({ type: 'request-failed', reason: message.type });
        }
        return;
    }
  }

  private handleMissing(): void {
    const now = this.options.now();
    if (!this.wasWelcomed) {
      this.finish({ type: 'not-found' });
      return;
    }
    this.missingSince ??= now;
    if (now - this.missingSince >= RESUME_RETRY_MS) {
      this.finish({ type: 'not-found' });
    }
    // 否则什么都不做：中转服务会关掉这个连接，RelaySocket 按退避重连，电脑回来后就能 join 上。
  }

  private takePending(id: number, kind: PendingRequest['kind']): boolean {
    if (this.pending?.id !== id || this.pending.kind !== kind) {
      return false;
    }
    this.clearPending();
    return true;
  }

  private failPending(reason: 'timeout'): void {
    if (this.pending) {
      this.clearPending();
      this.emit({ type: 'request-failed', reason });
    }
  }

  private clearPending(): void {
    if (this.pending) {
      this.options.timers.clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  private async send(message: PhoneMessage): Promise<void> {
    const body = await sealMessage(this.options.key, 'p2d', this.options.session, message);
    this.socket.send({ t: 'send', body });
  }

  private finish(event: PhoneEvent): void {
    this.emit(event);
    this.stop();
  }

  private emit(event: PhoneEvent): void {
    if (!this.isStopped) {
      this.options.onEvent(event);
    }
  }
}
