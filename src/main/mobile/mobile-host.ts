/**
 * 电脑端的「手机扫码」：点开始时才连中转服务，按会话接待几部手机，把它们提交的打印任务排成一队，一次打一张。
 *
 * 不依赖 Electron：WebSocket、计时器、打印函数都由参数注入，集成测试用真实的中转服务和手机端代码跑通。
 * 会话规则（手机加入与移除、防重放、打印队列、任务去重、背压、到期）在 mobile-session.ts；这里只做编排。
 */
import type { Clock, PrinterInfo } from '../../core/types';
import { importSessionKey, openMessage, randomId, randomKey, sealMessage } from '../../shared/mobile-crypto';
import {
  buildPhoneUrl,
  type CloseReason,
  type DesktopFrame,
  type DesktopMessage,
  MOBILE_PROTOCOL_VERSION,
  type PhonePrintResult,
  parsePhoneMessage,
  parseRelayToDesktop,
  type RelayErrorCode,
  type RelayToDesktop,
  type SealedBody,
} from '../../shared/mobile-protocol';
import type { MobileFailure, MobileStatus } from '../../shared/mobile-status';
import { RelaySocket, type SocketLike, type SocketTimers } from '../../shared/relay-socket';
import { type Delivery, MobileSession } from './mobile-session';
import { desktopSocketUrl } from './relay-endpoint';

export interface MobileHostDeps {
  relayBase: URL;
  clock: Clock;
  timers: SocketTimers;
  createSocket: (url: string) => SocketLike;
  /** 执行一个打印任务：PrintService.submit 加结果换算（由 mobile-station 提供）。printerName 是系统里的打印机名。 */
  print: (raw: string, force: boolean, printerName: string) => Promise<PhonePrintResult>;
  /** 设置里当前选中的打印机（系统名用来打印，显示名告诉手机）；没选时为 null。 */
  selectedPrinter: () => Promise<PrinterInfo | null>;
  log: (line: string) => void;
}

/** 一次会话：从点「手机扫码」到结束。 */
interface Run {
  sessionId: string;
  secret: string;
  url: string;
  key: Promise<CryptoKey>;
  session: MobileSession;
  socket: RelaySocket<DesktopFrame>;
  isOpened: boolean;
  isRelayOnline: boolean;
  failure: MobileFailure | null;
  /** 这次会话是因为上一个会话号被占而换的：再被占就不再换，免得来回重试。 */
  isReplacement: boolean;
  /** 解密、加密、打印任务各串成一条链：收到的按顺序处理，发出的按顺序发，任务一个接一个执行。 */
  inbox: Promise<void>;
  outgoing: Promise<void>;
  jobs: Promise<void>;
}

export class MobileHost {
  private run: Run | null = null;
  /** 不会自己恢复的失败：会话已结束，留着给界面看，直到下一次开始。 */
  private finalFailure: MobileFailure | null = null;
  private readonly listeners = new Set<(status: MobileStatus) => void>();

  constructor(private readonly deps: MobileHostDeps) {}

  /** 开始一次会话；已在进行中时返回当前状态，二维码不变。 */
  start(): MobileStatus {
    if (!this.run) {
      this.begin(false);
    }
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
    const { phones, printed, queued, joinLocked } = run.session.status();
    return {
      state: 'active',
      url: run.url,
      expiresAt: run.session.unclaimedUntil(),
      relayOnline: run.isRelayOnline,
      joinLocked,
      phones,
      printed,
      queued,
    };
  }

  onStatus(listener: (status: MobileStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 设置里的打印机变了：告诉所有在线的手机。 */
  printerChanged(): void {
    const run = this.run;
    if (!run) {
      return;
    }
    // 排进收件链：和 welcome 一样按顺序发，不会有手机先收到新打印机、再收到旧的。
    this.enqueue(run, async () => {
      const printer = await this.printerLabel();
      for (const connection of run.session.onlineConnections()) {
        this.send(run, connection, { type: 'printer', printer });
      }
    });
  }

  /** 在电脑上移除一部手机：断开它、作废它的令牌，它排队中的任务不再打印；同时暂停新手机加入。 */
  removePhone(id: string): void {
    const run = this.run;
    if (!run) {
      return;
    }
    const { kick, deliveries } = run.session.removePhone(id);
    if (kick !== null) {
      this.send(run, kick, { type: 'denied', reason: 'removed' });
      this.sendFrame(run, { t: 'kick', phone: kick });
    }
    this.sendAll(run, deliveries);
    this.deps.log('mobile: removed a phone, new phones paused');
    this.emit();
  }

  /** 暂停或重新允许新手机加入。 */
  setJoinLocked(locked: boolean): void {
    const run = this.run;
    if (!run) {
      return;
    }
    run.session.setJoinLocked(locked);
    this.deps.log(`mobile: new phones ${locked ? 'paused' : 'allowed'}`);
    this.emit();
  }

  /** 定时调用：二维码没人打开、或者长时间没有任务时结束会话。 */
  tick(): void {
    const reason = this.run?.session.expiry();
    if (reason) {
      this.stop(reason);
    }
  }

  private begin(isReplacement: boolean): void {
    const sessionId = randomId();
    const keyText = randomKey();
    const run: Run = {
      sessionId,
      secret: randomId(),
      url: buildPhoneUrl(this.deps.relayBase.href, sessionId, keyText),
      key: importSessionKey(keyText),
      session: new MobileSession(this.deps.clock),
      socket: new RelaySocket<DesktopFrame>({
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
          this.enqueue(run, () => this.handle(run, frame));
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
      isReplacement,
      inbox: Promise.resolve(),
      outgoing: Promise.resolve(),
      jobs: Promise.resolve(),
    };
    this.run = run;
    this.finalFailure = null;
    run.socket.start();
    this.deps.log('mobile: session started');
    this.emit();
  }

  /** 排进收件链。一条处理出错只记日志，不能卡住后面的。 */
  private enqueue(run: Run, task: () => Promise<void>): void {
    run.inbox = run.inbox
      .then(task)
      .catch((error: unknown) => this.deps.log(`mobile: failed to handle a relay frame: ${String(error)}`));
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
        run.session.relayOpened();
        run.socket.markReady();
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

  private async receive(run: Run, phone: string, body: SealedBody): Promise<void> {
    const message = parsePhoneMessage(await openMessage(await run.key, 'p2d', run.sessionId, body));
    if (!message) {
      this.deps.log('mobile: dropped a phone message that could not be decrypted or parsed');
      return;
    }
    if (message.type === 'hello') {
      const reply = run.session.hello(phone, message);
      // 设备描述来自手机，已去掉控制字符；写日志时仍加引号，看得出它是外来的文字。
      const device = JSON.stringify(message.device);
      if (reply.kind === 'welcome') {
        const printer = await this.printerLabel();
        this.send(run, phone, { type: 'welcome', token: reply.token, nonce: reply.nonce, printer });
        this.deps.log(`mobile: phone welcomed ${device}`);
      } else {
        this.send(run, phone, { type: 'denied', reason: reply.reason });
        this.sendFrame(run, { t: 'kick', phone });
        this.deps.log(`mobile: turned away a phone ${device} (${reply.reason})`);
      }
      this.emit();
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
        run.jobs = run.jobs
          .then(() => this.execute(run, decision.job, decision.raw, decision.force))
          .catch((error: unknown) => this.deps.log(`mobile: a phone job failed unexpectedly: ${String(error)}`));
        this.emit();
        return;
    }
  }

  /**
   * 执行一个任务：告诉它的手机开始打印，打完把结果发回去，并告诉排在后面的手机新的位置。
   * 手机正好断线时结果已保存，它重连后重发任务号就能拿到。
   */
  private async execute(run: Run, job: string, raw: string, force: boolean): Promise<void> {
    // 会话已经结束（用户点了「结束」）：排队中的任务不再打印。
    if (this.run !== run) {
      return;
    }
    const started = run.session.started(job);
    // 任务已不在队列里：它的手机被移除了。
    if (started === null) {
      return;
    }
    this.sendAll(run, started);
    this.emit();
    const result = await this.print(raw, force);
    const deliveries = run.session.complete(job, result);
    if (this.run === run) {
      this.sendAll(run, deliveries);
    }
    this.emit();
  }

  private async print(raw: string, force: boolean): Promise<PhonePrintResult> {
    try {
      const printer = await this.deps.selectedPrinter();
      if (printer === null) {
        return { status: 'no-printer' };
      }
      return await this.deps.print(raw, force, printer.name);
    } catch (error) {
      // PrintService 自己不抛错；走到这里是接线出了问题，按驱动报错回复，不让任务卡住。
      this.deps.log(`mobile: printing a phone job failed unexpectedly: ${String(error)}`);
      return { status: 'failed', reason: 'PRINT_ERROR', detail: null, issue: null };
    }
  }

  /** 告诉手机的打印机名：用界面上显示的名字。 */
  private async printerLabel(): Promise<string | null> {
    return (await this.deps.selectedPrinter())?.displayName ?? null;
  }

  private handleRelayError(run: Run, code: RelayErrorCode): void {
    this.deps.log(`mobile: relay error ${code}`);
    switch (code) {
      case 'version':
        // 中转服务不支持这个版本的协议：重试也没用，结束会话，界面提示更新软件。
        this.finish('version');
        return;
      case 'session-taken':
        // 会话号被占（128 位随机数，正常不会发生）：换一个新会话，二维码随之更新。
        // 换过一次又被占，说明中转服务不正常：停下来报错，不来回重试。
        if (run.isReplacement) {
          this.finish('session-taken');
        } else {
          this.stop('stopped');
          this.begin(true);
        }
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

  /** 结束会话并留下一个不会自己恢复的失败。 */
  private finish(failure: MobileFailure): void {
    this.stop('stopped');
    this.finalFailure = failure;
    this.emit();
  }

  private send(run: Run, phone: string, message: DesktopMessage): void {
    run.outgoing = run.outgoing
      .then(async () => {
        const body = await sealMessage(await run.key, 'd2p', run.sessionId, message);
        run.socket.send({ t: 'send', phone, body });
      })
      .catch((error: unknown) => this.deps.log(`mobile: failed to send to the phone: ${String(error)}`));
  }

  private sendAll(run: Run, deliveries: Delivery[]): void {
    for (const { connection, message } of deliveries) {
      this.send(run, connection, message);
    }
  }

  /** 不加密的外层帧（踢出）也排进发送链，保证在它前面的消息先发出去。 */
  private sendFrame(run: Run, frame: DesktopFrame): void {
    run.outgoing = run.outgoing
      .then(() => {
        run.socket.send(frame);
      })
      .catch((error: unknown) => this.deps.log(`mobile: failed to send a relay frame: ${String(error)}`));
  }

  /** 通知界面。一个监听者出错不影响别的监听者，也不打断会话。 */
  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        this.deps.log(`mobile: a status listener failed: ${String(error)}`);
      }
    }
  }
}
