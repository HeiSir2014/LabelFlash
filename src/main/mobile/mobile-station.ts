/**
 * 「手机扫码」在主进程里的接线：按设置找到中转地址，创建 MobileHost，把手机的任务交给 PrintService 打印，
 * 跟着设置变化（打印机、中转地址）调整，状态推给界面。
 *
 * 不 import electron：打印、打印机列表、WebSocket、计时器都由参数注入，用 bun test 测试；index.ts 只负责创建它。
 */
import type { PrinterInfo, PrintRequest, PrintResult } from '../../core/types';
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

type StationSettings = Pick<AppSettings, 'mobileRelayUrl' | 'selectedPrinter'>;

export interface MobileStationDeps {
  settings: () => StationSettings;
  /** 安装包自带的中转地址（设置里没填时用它）。 */
  buildDefaultRelayUrl: string | null;
  listPrinters: () => Promise<PrinterInfo[]>;
  submit: (request: PrintRequest) => Promise<PrintResult>;
  /** 按中转地址创建会话编排；deps 里的打印和打印机由 station 提供。 */
  createHost: (deps: Pick<MobileHostDeps, 'relayBase' | 'print' | 'selectedPrinter'>) => MobileHostPort;
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

  settingsChanged(next: StationSettings, previous: StationSettings): void {
    if (next.selectedPrinter !== previous.selectedPrinter) {
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
      print: (raw, force, printerName) => this.print(raw, force, printerName),
      selectedPrinter: () => this.selectedPrinter(),
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

  private async print(raw: string, force: boolean, printerName: string) {
    return toPhonePrintResult(await this.deps.submit({ raw, printerName, source: 'mobile', force }));
  }

  /** 设置里选的打印机；显示名取打印机列表里的，列表里没有（例如拔掉了）时用系统名，打印时会报找不到。 */
  private async selectedPrinter(): Promise<PrinterInfo | null> {
    const name = this.deps.settings().selectedPrinter;
    if (name === null) {
      return null;
    }
    const printers = await this.deps.listPrinters();
    return printers.find((printer) => printer.name === name) ?? { name, displayName: name };
  }

  private emit(): void {
    this.deps.onStatus(this.status());
  }
}
