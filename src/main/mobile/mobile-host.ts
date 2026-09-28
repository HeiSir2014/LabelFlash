/**
 * 电脑端的「手机扫码」：点开始时才连中转服务，按会话接待一部手机，按顺序执行它提交的打印任务。
 *
 * 不依赖 Electron：WebSocket、计时器、打印函数都由参数注入，集成测试用真实的中转服务和手机端代码跑通。
 * 会话规则（认领、防重放、任务去重、背压、到期）在 mobile-session.ts；这里只做编排。
 */
import type { Clock } from '../../core/types';
import { importSessionKey, openMessage, randomId, randomKey, sealMessage } from '../../shared/mobile-crypto';
import {
  buildPhoneUrl,
  type CloseReason,
  type DesktopMessage,
  MOBILE_PROTOCOL_VERSION,
  type PhonePrintResult,
  parsePhoneMessage,
  parseRelayToDesktop,
  type RelayToDesktop,
} from '../../shared/mobile-protocol';
import type { MobileFailure, MobileStatus } from '../../shared/mobile-status';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../shared/relay-socket';
import { MobileSession } from './mobile-session';
import { desktopSocketUrl } from './relay-endpoint';

export interface MobileHostDeps {
  relayBase: URL;
  clock: Clock;
  timers: SocketTimers;
  createSocket: (url: string) => SocketLike;
  /** 执行一个打印任务：PrintService.submit 加结果换算（由 mobile-station 提供）。 */
  print: (raw: string, force: boolean, printerName: string) => Promise<PhonePrintResult>;
  /** 设置里当前选中的打印机；没选时为 null。 */
  printerName: () => string | null;
  log: (line: string) => void;
}

/** 一次会话：从点「手机扫码」到结束。 */
interface Run {
  sessionId: string;
  secret: string;
  url: string;
  key: Promise<CryptoKey>;
  session: MobileSession;
  socket: RelaySocket;
  isOpened: boolean;
  isRelayOnline: boolean;
  failure: MobileFailure | null;
  /** 解密、加密、打印任务各串成一条链：收到的按顺序处理，发出的按顺序发，任务一个接一个执行。 */
  inbox: Promise<void>;
  outgoing: Promise<void>;
  jobs: Promise<void>;
}

export class MobileHost {
  private run: Run | null = null;
  /** 不会自己恢复的失败（中转服务不支持这个协议版本）：会话已结束，留着给界面看，直到下一次开始。 */
  private finalFailure: MobileFailure | null = null;
  private readonly listeners = new Set<(status: MobileStatus) => void>();

  constructor(private readonly deps: MobileHostDeps) {}

  /** 开始一次会话；已在进行中时返回当前状态，二维码不变。 */
  start(): MobileStatus {
    if (this.run) {
      return this.status();
    }
    const sessionId = randomId();
    const keyText = randomKey();
    const run: Run = {
      sessionId,
      secret: randomId(),
      url: buildPhoneUrl(this.deps.relayBase.href, sessionId, keyText),
      key: importSessionKey(keyText),
      session: new MobileSession(this.deps.clock),
      socket: new RelaySocket({
        url: desktopSocketUrl(this.deps.relayBase),
        createSocket: this.deps.createSocket,
        timers: this.deps.timers,
        onOpen: () => {
          run.socket.send({ t: 'open', v: MOBILE_PROTOCOL_VERSION, session: run.sessionId, secret: run.secret });
        },
        onFrame: (text) => {
          const frame = parseRelayToDesktop(text);
          if (!frame) {
            this.deps.log('mobile: dropped a malformed relay frame');
            return;
          }
          run.inbox = run.inbox
            .then(() => this.handle(run, frame))
            .catch((error: unknown) => this.deps.log(`mobile: failed to handle a relay frame: ${String(error)}`));
        },
        onDown: () => {
          run.isRelayOnline = false;
          if (!run.isOpened && run.failure === null) {
            run.failure = 'unreachable';
          }
          this.deps.log('mobile: relay connection lost, reconnecting');
          this.emit();
        },
      }),
      isOpened: false,
      isRelayOnline: false,
      failure: null,
      inbox: Promise.resolve(),
      outgoing: Promise.resolve(),
      jobs: Promise.resolve(),
    };
    this.run = run;
    this.finalFailure = null;
    run.socket.start();
    this.deps.log('mobile: session started');
    this.emit();
    return this.status();
  }

  stop(reason: CloseReason): void {
    const run = this.run;
    if (!run) {
      return;
    }
    this.run = null;
    // 让中转服务通知手机「已结束」；没连着时中转服务会按宽限期自己结束会话。
    run.socket.send({ t: 'close', reason });
    run.socket.stop();
    this.deps.log(`mobile: session ended (${reason})`);
    this.emit();
  }

  status(): MobileStatus {
    const run = this.run;
    if (!run) {
      return this.finalFailure ? { state: 'failed', error: this.finalFailure } : { state: 'off' };
    }
    if (run.failure) {
      return { state: 'failed', error: run.failure };
    }
    if (!run.isOpened) {
      return { state: 'connecting' };
    }
    const { phone, printed } = run.session.status();
    return {
      state: 'active',
      url: run.url,
      expiresAt: run.session.unclaimedUntil(),
      relayOnline: run.isRelayOnline,
      phone,
      printed,
    };
  }

  onStatus(listener: (status: MobileStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 设置里的打印机变了：告诉已连接的手机。 */
  printerChanged(): void {
    const run = this.run;
    const phone = run?.session.claimedConnection();
    if (run && phone) {
      this.send(run, phone, { type: 'printer', printer: this.deps.printerName() });
    }
  }

  /** 定时调用：二维码没人打开、或者长时间没有任务时结束会话。 */
  tick(): void {
    const reason = this.run?.session.expiry();
    if (reason) {
      this.stop(reason);
    }
  }

  private async handle(run: Run, frame: RelayToDesktop): Promise<void> {
    if (this.run !== run) {
      return;
    }
    switch (frame.t) {
      case 'opened':
        run.isOpened = true;
        run.isRelayOnline = true;
        run.failure = null;
        this.deps.log('mobile: session registered on the relay');
        this.emit();
        return;
      case 'joined':
        run.session.phoneJoined(frame.phone);
        return;
      case 'left':
        run.session.phoneLeft(frame.phone);
        this.emit();
        return;
      case 'recv':
        await this.receive(run, frame.phone, frame.body);
        return;
      case 'error':
        this.handleRelayError(run, frame.code);
        return;
      case 'pong':
        return;
    }
  }

  private async receive(run: Run, phone: string, body: Parameters<typeof openMessage>[3]): Promise<void> {
    const message = parsePhoneMessage(await openMessage(await run.key, 'p2d', run.sessionId, body));
    if (!message) {
      this.deps.log('mobile: dropped a phone message that could not be decrypted or parsed');
      return;
    }
    if (message.type === 'hello') {
      const reply = run.session.hello(phone, message);
      if (reply.kind === 'welcome') {
        this.send(run, phone, {
          type: 'welcome',
          token: reply.token,
          nonce: reply.nonce,
          printer: this.deps.printerName(),
        });
        this.deps.log(`mobile: phone welcomed (${message.device})`);
        this.emit();
      } else {
        this.send(run, phone, { type: 'taken' });
        this.enqueueFrame(run, { t: 'kick', phone });
        this.deps.log('mobile: turned away a second phone');
      }
      return;
    }
    const decision = run.session.submit(phone, message);
    switch (decision.kind) {
      case 'ignore':
        return;
      case 'reply':
        this.send(run, phone, decision.message);
        return;
      case 'run':
        this.send(run, phone, decision.reply);
        run.jobs = run.jobs.then(() => this.execute(run, decision.job, decision.raw, decision.force));
        return;
    }
  }

  /** 执行一个任务并把结果发给手机当前的连接；手机正好断线时结果已保存，它重连后重发任务号就能拿到。 */
  private async execute(run: Run, job: string, raw: string, force: boolean): Promise<void> {
    // 会话已经结束（用户点了「结束」）：排队中的任务不再打印。
    if (this.run !== run) {
      return;
    }
    const result = await this.print(raw, force);
    const message = run.session.complete(job, result);
    const phone = run.session.claimedConnection();
    if (phone && this.run === run) {
      this.send(run, phone, message);
    }
    this.emit();
  }

  private async print(raw: string, force: boolean): Promise<PhonePrintResult> {
    const printerName = this.deps.printerName();
    if (printerName === null) {
      return { status: 'no-printer' };
    }
    try {
      return await this.deps.print(raw, force, printerName);
    } catch (error) {
      // PrintService 自己不抛错；走到这里是接线出了问题，按驱动报错回复，不让任务卡住。
      this.deps.log(`mobile: printing a phone job failed unexpectedly: ${String(error)}`);
      return { status: 'failed', reason: 'PRINT_ERROR', detail: null, issue: null };
    }
  }

  private handleRelayError(run: Run, code: Extract<RelayToDesktop, { t: 'error' }>['code']): void {
    this.deps.log(`mobile: relay error ${code}`);
    switch (code) {
      case 'version':
        // 中转服务不支持这个版本的协议：重试也没用，结束会话，界面提示更新软件。
        this.stop('stopped');
        this.finalFailure = 'version';
        this.emit();
        return;
      case 'session-taken':
        // 会话号被别人占了（128 位随机数，几乎不可能）：换一个新会话，二维码随之更新。
        this.stop('stopped');
        this.start();
        return;
      case 'server-busy':
        run.failure = 'server-busy';
        this.emit();
        return;
      case 'rate-limited':
      case 'bad-frame':
        return;
    }
  }

  private send(run: Run, phone: string, message: DesktopMessage): void {
    run.outgoing = run.outgoing
      .then(async () => {
        const body = await sealMessage(await run.key, 'd2p', run.sessionId, message);
        run.socket.send({ t: 'send', phone, body });
      })
      .catch((error: unknown) => this.deps.log(`mobile: failed to send to the phone: ${String(error)}`));
  }

  /** 不加密的外层帧（踢出）也排进发送链，保证在它前面的消息先发出去。 */
  private enqueueFrame(run: Run, frame: { t: 'kick'; phone: string }): void {
    run.outgoing = run.outgoing.then(() => {
      run.socket.send(frame);
    });
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
