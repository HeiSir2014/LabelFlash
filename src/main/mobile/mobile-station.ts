/**
 * 「手机扫码」在主进程里的接线：按设置找到中转地址，创建 MobileHost，把手机的任务交给 PrintService 打印，
 * 跟着设置变化（纸张分配、中转地址）调整，状态推给界面。打印到哪台由 PrintService 按模板决定。
 *
 * 不 import electron：打印、打印机汇总、WebSocket、计时器都由参数注入，用 bun test 测试；index.ts 只负责创建它。
 */
import type { PrintRequest, PrintResult } from '../../core/types';
import type { CloseReason } from '../../shared/mobile-protocol';
import type { MobileStatus } from '../../shared/mobile-status';
import type { AppSettings } from '../../shared/settings';
import type { MobileHostDeps } from './mobile-host';
import { toPhonePrintResult } from './mobile-replies';
import { resolveRelayBase } from './relay-endpoint';

/** 检查二维码有没有过期、会话有没有闲置太久的间隔：到期精确到几秒就够了。 */
export const MOBILE_TICK_INTERVAL_MS = 5_000;

/** MobileHost 里 station 用到的部分：测试里换成假的。 */
export interface MobileHostPort {
  start(): MobileStatus;
  stop(reason: CloseReason): void;
  status(): MobileStatus;
  onStatus(listener: (status: MobileStatus) => void): () => void;
  printerChanged(): void;
  removePhone(id: string): void;
  setJoinLocked(locked: boolean): void;
  tick(): void;
}

type StationSettings = Pick<AppSettings, 'mobileRelayUrl' | 'paperPrinters'>;

export interface MobileStationDeps {
  settings: () => StationSettings;
  /** 安装包自带的中转地址（设置里没填时用它）。 */
  buildDefaultRelayUrl: string | null;
  /** 告诉手机的打印机汇总（src/shared/printer-summary.ts 的 phonePrinterLabel）；没有分配打印机时为 null。 */
  printerLabel: () => Promise<string | null>;
  submit: (request: PrintRequest) => Promise<PrintResult>;
  /** 按中转地址创建会话编排；deps 里的打印和打印机汇总由 station 提供。 */
  createHost: (deps: Pick<MobileHostDeps, 'relayBase' | 'print' | 'printerLabel'>) => MobileHostPort;
  onStatus: (status: MobileStatus) => void;
  log: (line: string) => void;
}

export class MobileStation {
  private host: MobileHostPort | null = null;
  /** 当前 host 连的中转地址；换了地址要换 host。 */
  private hostBase: string | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 没有中转地址时点了开始：界面提示去配置中心填写，直到下一次开始或结束。 */
  private isUnconfigured = false;

  constructor(private readonly deps: MobileStationDeps) {}

  status(): MobileStatus {
    if (this.isUnconfigured) {
      return { state: 'failed', error: 'not-configured' };
    }
    return this.host?.status() ?? { state: 'off' };
  }

  /** 开始一次会话；已在进行中时返回当前状态，二维码不变。 */
  start(): MobileStatus {
    const base = resolveRelayBase({
      setting: this.deps.settings().mobileRelayUrl,
      buildDefault: this.deps.buildDefaultRelayUrl,
    });
    if (base === null) {
      this.isUnconfigured = true;
      this.deps.log('mobile: no relay address configured');
      this.emit();
      return this.status();
    }
    this.isUnconfigured = false;
    if (this.hostBase !== base.href) {
      this.replaceHost(base);
    }
    return this.host?.start() ?? this.status();
  }

  stop(): void {
    this.isUnconfigured = false;
    this.host?.stop('stopped');
    this.emit();
  }

  removePhone(id: string): void {
    this.host?.removePhone(id);
  }

  setJoinLocked(locked: boolean): void {
    this.host?.setJoinLocked(locked);
  }

  tick(): void {
    this.host?.tick();
  }

  /** 程序退出：告诉手机「电脑上的程序已退出」。 */
  quit(): void {
    this.host?.stop('quit');
  }

  /** 被分配到的打印机变了（例如模板指定了别的打印机）：告诉在线的手机新的打印机汇总。 */
  printersChanged(): void {
    this.host?.printerChanged();
  }

  settingsChanged(next: StationSettings, previous: StationSettings): void {
    // 设置每次保存都是新对象：按内容比较，分配没变时不打扰手机。
    if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) {
      this.host?.printerChanged();
    }
    // 换了中转地址：结束当前会话，旧二维码作废；下次开始时连新地址。
    if (next.mobileRelayUrl !== previous.mobileRelayUrl && this.host) {
      this.deps.log('mobile: relay address changed, ending the session');
      this.host.stop('stopped');
      this.discardHost();
      this.emit();
    }
  }

  private replaceHost(base: URL): void {
    this.host?.stop('stopped');
    this.discardHost();
    const host = this.deps.createHost({
      relayBase: base,
      print: (raw, force) => this.print(raw, force),
      printerLabel: () => this.deps.printerLabel(),
    });
    this.unsubscribe = host.onStatus(() => this.emit());
    this.host = host;
    this.hostBase = base.href;
  }

  private discardHost(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.host = null;
    this.hostBase = null;
  }

  /** 打到哪台由 PrintService 按模板决定（和扫码枪一样）；这种纸没有打印机时手机收到 no-printer。 */
  private async print(raw: string, force: boolean) {
    return toPhonePrintResult(await this.deps.submit({ raw, source: 'mobile', force }));
  }

  private emit(): void {
    this.deps.onStatus(this.status());
  }
}
