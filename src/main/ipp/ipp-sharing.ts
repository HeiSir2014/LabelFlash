import { createHash, randomUUID } from 'node:crypto';
import { ippAdvert } from '../../core/ipp/ipp-advert';
import { IppJobBook } from '../../core/ipp/ipp-job-book';
import { type SharedPrinter, sharedPrinterState } from '../../core/ipp/shared-printer';
import type { DnsName } from '../../core/mdns/dns-message';
import type { MdnsZone } from '../../core/mdns/dns-sd';
import { SerialQueue } from '../../core/serial-queue';
import type { Clock } from '../../core/types';
import type { DiscoveryState, IppServerState, IppSharingStatus } from '../../shared/ipp-sharing';
import type { FirewallStatus } from '../../shared/local-api';
import { formatPaperName, type PaperSize, paperKey, parsePaperKey } from '../../shared/paper-sizes';
import type { PrinterReadiness } from '../../shared/printer-readiness';
import type { AppSettings } from '../../shared/settings';
import { isOnLanSubnet, type LanInterface } from '../api/network';
import { ANY_FREE_PORT, portOrder } from '../net/http-listener';
import type { SqliteIppStore } from '../storage/sqlite-ipp-store';
import { ClientApprovals, type PendingClient } from './client-approvals';
import { DEFAULT_IPP_PORTS, IppHttpServer } from './ipp-http-server';
import { IppJobProcessor, type IppJobProcessorDeps } from './ipp-job-processor';
import { MdnsAdvertiser } from './mdns-advertiser';
import { discoveryRetryDelayMs, FIRST_NAMES, hostLabelFor, type MdnsNames, renamedAfterConflict } from './mdns-naming';
import { SharePassword } from './share-password';

/** 仅开发 / E2E：共享用这个端口（0 = 系统随便给一个），不和本机上跑着的安装版抢 8631。安装版忽略它。 */
export const IPP_PORT_ENV = 'CDL_LABELFLASH_IPP_PORT';
/** 仅开发 / E2E：设为 0 时不开 mDNS（并行的用例、CI 机器上不往局域网广播）。安装版忽略它。 */
export const IPP_DISCOVERY_ENV = 'CDL_LABELFLASH_IPP_DISCOVERY';
/** 仅开发 / E2E：设为 1 时共享只监听 127.0.0.1（测试不在局域网上开端口）。安装版忽略它。 */
export const IPP_LOOPBACK_ENV = 'CDL_LABELFLASH_IPP_LOOPBACK';
const LOOPBACK_HOST = '127.0.0.1';
const MAX_PORT = 65_535;
/** mDNS 主机名里取实例编号的前 8 位（见 mdns-naming.ts 的 hostLabelFor）。 */
const HOST_ID_CHARS = 8;
const MDNS_DOMAIN = 'local';
/** 打印机资料读不到分辨率时按 203dpi：热敏标签机最常见的分辨率（和打印时的兜底一致）。 */
const FALLBACK_DPI = 203;
/** UUID 第 13 位写版本号 5（按名字算出来的），第 17 位的高两位写 10（RFC 4122 变体）。 */
const UUID_VERSION = '5';
const UUID_VARIANT_MASK = 0x3;
const UUID_VARIANT_BITS = 0x8;
const HEX = 16;
/** UUID 各段在 SHA-256 十六进制串里的位置。 */
const UUID_SLICES = { a: [0, 8], b: [8, 12], c: [13, 16], variant: [16, 17], d: [17, 20], e: [20, 32] } as const;
/** 关掉共享时还没处理的任务给对方看的原因。 */
const STOPPED_MESSAGE = '共享已关闭：请那台电脑上的操作员打开「局域网共享」后再打';

/** 没指定端口时依次尝试的端口（默认 8631–8640；开发版和 E2E 可以用环境变量换成别的）。 */
export function ippCandidatePorts(env: NodeJS.ProcessEnv, isPackaged: boolean): readonly number[] {
  const override = isPackaged ? undefined : env[IPP_PORT_ENV];
  const port = override === undefined || override === '' ? Number.NaN : Number(override);
  return Number.isInteger(port) && port >= 0 && port <= MAX_PORT ? [port] : DEFAULT_IPP_PORTS;
}

/** 开 mDNS 吗：安装版总是开；开发版和 E2E 可以用环境变量关掉。 */
export function isDiscoveryEnabled(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return isPackaged || env[IPP_DISCOVERY_ENV] !== '0';
}

/** 监听的地址：安装版是所有 IPv4 网卡（undefined）；开发版和 E2E 可以用环境变量限制在本机。 */
export function ippBindHost(env: NodeJS.ProcessEnv, isPackaged: boolean): string | undefined {
  return !isPackaged && env[IPP_LOOPBACK_ENV] === '1' ? LOOPBACK_HOST : undefined;
}

/** 每台共享打印机的 UUID：按程序实例和纸张键算（SHA-256 截成 UUID 的样子），重启、换端口都不变。 */
export function printerUuid(instanceId: string, key: string): string {
  const hex = createHash('sha256').update(`${instanceId}:${key}`).digest('hex');
  const part = ([start, end]: readonly [number, number]) => hex.slice(start, end);
  const variant = ((Number.parseInt(part(UUID_SLICES.variant), HEX) & UUID_VARIANT_MASK) | UUID_VARIANT_BITS).toString(
    HEX,
  );
  return `urn:uuid:${part(UUID_SLICES.a)}-${part(UUID_SLICES.b)}-${UUID_VERSION}${part(UUID_SLICES.c)}-${variant}${part(UUID_SLICES.d)}-${part(UUID_SLICES.e)}`;
}

/** IppSharing 的依赖：Electron 和系统的能力都由主进程传入。 */
export interface IppSharingDeps {
  clock: Clock;
  settings: () => AppSettings;
  /** 只改共享自己记的几项（上次的端口、实例编号）：不走 onSettingsChanged。 */
  updateSettings: (patch: Partial<AppSettings>) => AppSettings;
  store: SqliteIppStore;
  computerName: () => string;
  productNameAscii: string;
  makeAndModel: string;
  installedPrinters: () => Promise<string[]>;
  /** 打印机状态（驱动报告的）；查不到为 null。 */
  readinessOf: (printerName: string) => PrinterReadiness | null;
  dpiOf: (printerName: string) => Promise<number>;
  /** Windows 防火墙：TCP（服务）、UDP 5353（自动发现）、弹管理员确认加规则。其他平台都是 unknown。 */
  firewall: {
    check: () => Promise<FirewallStatus>;
    checkDiscovery: () => Promise<FirewallStatus>;
    add: () => Promise<FirewallStatus>;
  };
  /** 防火墙还没放行时先不监听（安装版为 true）。 */
  holdUntilFirewallAllows: boolean;
  candidatePorts: readonly number[];
  /** 监听的 IPv4 地址；默认所有网卡，测试和 E2E 用 127.0.0.1。 */
  ipv4Host?: string | undefined;
  /** 接受本机回环来的连接（只在开发 / E2E 的开关打开时）；其余只接受和选中的局域网网卡同一网段的。 */
  allowLoopback: boolean;
  discoveryEnabled: boolean;
  lanInterfaces: () => LanInterface[];
  /** 渲染页、位图缓存、打印（PrintService.printFields）。 */
  render: Pick<IppJobProcessorDeps, 'renderer' | 'pieces' | 'printFields'>;
  findPortOwner: (port: number) => Promise<string | null>;
  notifyClientRequest: (client: PendingClient) => void;
  onStatus: (status: IppSharingStatus) => void;
  onJobsChanged: () => void;
  schedule: (run: () => void, delayMs: number) => () => void;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

interface PrinterEntry {
  printer: Omit<SharedPrinter, 'state' | 'queuedJobCount'>;
  printerName: string;
}

/**
 * 局域网共享：把任务表、共享密码、新电脑询问、任务处理、IPP 服务和 mDNS 组装起来，跟随设置启停（默认关）。
 * 不 import electron：渲染窗口、打印、防火墙、通知都由主进程传入，可以用 bun test 整体测试。
 */
export class IppSharing {
  private readonly book: IppJobBook;
  private readonly password: SharePassword;
  private readonly approvals: ClientApprovals;
  private readonly processor: IppJobProcessor;
  private readonly server: IppHttpServer;
  private readonly advertiser: MdnsAdvertiser;
  /** 启停、刷新一次只做一件：每次都按那时最新的设置来。 */
  private readonly restarts = new SerialQueue();
  private entries = new Map<string, PrinterEntry>();
  private serverState: IppServerState = { state: 'off' };
  private discovery: DiscoveryState = 'off';
  private firewall: FirewallStatus = 'unknown';
  private portOwner: string | null = null;
  /** 每次启动加一：查占用程序是后台做的，查到时如果已经又重启过，结果就作废。 */
  private generation = 0;
  /** 名字冲突后加在实例名后面的序号。 */
  private names: MdnsNames = FIRST_NAMES;
  /** 自动发现连续失败了几次（决定下次重试等多久）。 */
  private discoveryAttempts = 0;
  /** 等着的那次重试；没有为 null。 */
  private cancelRetry: (() => void) | null = null;

  constructor(private readonly deps: IppSharingDeps) {
    this.book = new IppJobBook(deps.clock);
    this.password = new SharePassword(deps.store, deps.clock);
    this.approvals = new ClientApprovals({
      store: deps.store,
      clock: deps.clock,
      schedule: deps.schedule,
      notify: deps.notifyClientRequest,
      onChange: () => this.publish(),
    });
    this.processor = new IppJobProcessor({
      ...deps.render,
      book: this.book,
      dpiFor: async (paper) => this.dpiFor(paper),
      waitForApproval: (address, user, printerName) => this.approvals.waitFor(address, user, printerName),
      onJobsChanged: deps.onJobsChanged,
      onChange: () => this.publish(),
      log: deps.log,
    });
    this.server = new IppHttpServer({
      clock: deps.clock,
      printers: () => this.sharedPrinters(),
      book: this.book,
      password: this.password,
      decisionFor: (address) => this.approvals.decisionFor(address),
      onAccepted: (job) => {
        // 记下对方实际发来的格式：真机验证时据此判断 Windows、macOS 走的是 PDF 还是光栅。
        deps.log(
          `[ipp] job ${job.job.id} from ${job.job.client} for ${job.printer.key}: format ${job.document.format}, ${job.document.data.length} bytes, ${job.document.copies} copies`,
        );
        void this.processor.enqueue(job);
        this.publish();
      },
      fallbackHost: () => deps.lanInterfaces()[0]?.address ?? LOOPBACK_HOST,
      isAllowedAddress: (address) => isOnLanSubnet(address, deps.lanInterfaces(), deps.allowLoopback),
      ipv4Host: deps.ipv4Host,
    });
    this.advertiser = new MdnsAdvertiser({
      interfaces: deps.lanInterfaces,
      zoneFor: (iface) => this.zoneFor(iface),
      onConflict: (names) => void this.renameAfterConflict(names),
      clock: deps.clock,
      sleep: deps.sleep,
      log: deps.log,
    });
  }

  /** 收下还没结束的任务数（含等确认的）：有的时候不静默更新、不能「重启更新」、退出前要问（重启会丢掉它们）。 */
  get pendingJobs(): number {
    return this.book.activeCount();
  }

  start(): Promise<void> {
    return this.listen();
  }

  /** 关掉服务和广播；还没结束的任务都中止。 */
  stop(): Promise<void> {
    return this.restarts.run(async () => {
      this.generation += 1;
      await this.shutDown();
    });
  }

  async settingsChanged(next: AppSettings, previous: AppSettings): Promise<void> {
    if (next.ippPort === null && previous.ippPort !== null) {
      // 清空指定的端口就是回到默认端口：忘掉记住的那个（它多半就是刚才指定的）。
      this.deps.updateSettings({ ippLastPort: null });
    }
    if (next.ippSharingEnabled !== previous.ippSharingEnabled || next.ippPort !== previous.ippPort) {
      await this.listen();
    } else if (JSON.stringify(next.paperPrinters) !== JSON.stringify(previous.paperPrinters)) {
      await this.refresh();
    }
  }

  /** 打印机列表变了（插拔、重装驱动、纸张分配）：重新拼共享打印机，刷新广播；不重启服务。 */
  refresh(): Promise<void> {
    return this.restarts.run(async () => {
      if (this.serverState.state !== 'listening') {
        return;
      }
      await this.loadPrinters();
      await this.advertiser.refresh();
      this.publish();
    });
  }

  status(): IppSharingStatus {
    const isListening = this.serverState.state === 'listening';
    return {
      server: this.serverState,
      discovery: this.discovery,
      hostName: isListening ? `${this.hostLabel()}.${MDNS_DOMAIN}` : null,
      lanAddresses: this.deps.lanInterfaces().map((iface) => iface.address),
      printers: [...this.entries.values()].map(({ printer, printerName }) => ({
        key: printer.key,
        name: printer.name,
        printerName,
      })),
      portOwner: this.portOwner,
      firewall: this.firewall,
      passwordSet: this.password.isSet(),
      pendingClients: this.approvals
        .pending()
        .map(({ address, user, printerName, jobs }) => ({ address, user, printerName, jobs })),
      clients: this.approvals.remembered(),
      activeJobs: this.book.activeCount(),
    };
  }

  async setPassword(password: string): Promise<void> {
    await this.password.set(password);
    await this.passwordChanged();
  }

  async clearPassword(): Promise<void> {
    this.password.clear();
    await this.passwordChanged();
  }

  /** 操作员在询问条上点了「允许」或「拒绝」。 */
  decideClient(address: string, allow: boolean): void {
    this.approvals.decide(address, allow);
  }

  /** 撤销对一台电脑的决定：它下次打印时重新问。 */
  forgetClient(address: string): void {
    this.approvals.forget(address);
  }

  /** 弹管理员确认加防火墙规则（TCP 和 UDP 5353），然后按新的情况重新监听。 */
  async addFirewallRule(): Promise<FirewallStatus> {
    await this.deps.firewall.add();
    await this.listen();
    return this.firewall;
  }

  /** 本机接口那边加了防火墙规则：重新看要不要监听、广播。 */
  firewallChanged(): Promise<void> {
    return this.deps.settings().ippSharingEnabled ? this.listen() : Promise.resolve();
  }

  private async passwordChanged(): Promise<void> {
    // 密码变了：记住的认证全部作废；广播里的 air（要不要问用户名密码）也跟着变。
    this.server.forgetCredentials();
    await this.restarts.run(() => this.advertiser.refresh());
    this.publish();
  }

  private listen(): Promise<void> {
    return this.restarts.run(() => this.listenNow());
  }

  /** 按现在的设置（重新）监听。出错也只发布状态、写日志，不抛给保存设置的调用方：设置已经存下了。 */
  private async listenNow(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.portOwner = null;
    const settings = this.deps.settings();
    if (!settings.ippSharingEnabled) {
      await this.shutDown();
      this.publish();
      return;
    }
    if (settings.ippInstanceId === null) {
      this.deps.updateSettings({ ippInstanceId: randomUUID() });
    }
    await this.loadPrinters();
    this.firewall = await this.deps.firewall.check();
    if (this.deps.holdUntilFirewallAllows && this.firewall === 'missing') {
      await this.shutDown();
      this.serverState = { state: 'held' };
      this.publish();
      return;
    }
    const ports = portOrder(settings.ippPort, settings.ippLastPort, this.deps.candidatePorts);
    try {
      const status = await this.server.start(ports);
      this.serverState =
        status.state === 'listening'
          ? { state: 'listening', port: status.port, skippedPorts: status.skippedPorts }
          : status;
    } catch (error) {
      this.deps.log(`[ipp] sharing failed to start: ${error instanceof Error ? error.message : String(error)}`);
      this.serverState = { state: 'failed', reason: 'START_ERROR' };
      this.publish();
      return;
    }
    if (this.serverState.state === 'listening') {
      if (this.serverState.port !== settings.ippLastPort) {
        this.deps.updateSettings({ ippLastPort: this.serverState.port });
      }
      this.deps.log(`[ipp] sharing ${this.entries.size} papers on port ${this.serverState.port}`);
      await this.startDiscovery();
    } else {
      await this.advertiser.stop();
      this.discovery = 'off';
    }
    this.publish();
    // 首选的端口被占用时查一下是谁：界面上说清楚「被某某占用，已改用某端口」。
    const [preferred] =
      this.serverState.state === 'listening'
        ? this.serverState.skippedPorts
        : this.serverState.state === 'failed' && this.serverState.reason === 'PORT_IN_USE'
          ? this.serverState.ports
          : [];
    if (preferred !== undefined && preferred !== ANY_FREE_PORT) {
      void this.lookUpPortOwner(preferred, generation);
    }
  }

  private async startDiscovery(): Promise<void> {
    if (!this.deps.discoveryEnabled) {
      await this.advertiser.stop();
      this.discovery = 'off';
      return;
    }
    // 绑 UDP 5353 也会让 Windows 弹防火墙警告：没放行时先不绑，等操作员加规则。
    if (this.deps.holdUntilFirewallAllows && (await this.deps.firewall.checkDiscovery()) === 'missing') {
      await this.advertiser.stop();
      this.discovery = 'blocked';
      return;
    }
    if (await this.advertiser.start()) {
      this.discovery = 'on';
      this.discoveryAttempts = 0;
      return;
    }
    // 绑不上 5353（被别的程序独占）：稍后再试，不永久放弃。
    this.discovery = 'failed';
    this.scheduleDiscoveryRetry();
  }

  private async shutDown(): Promise<void> {
    this.cancelDiscoveryRetry();
    await this.advertiser.stop();
    await this.server.stop();
    // 收下还没处理的任务都中止（对方会看到原因）；还在等确认的按超时处理。
    this.book.abortAll(STOPPED_MESSAGE);
    this.approvals.dispose();
    this.serverState = { state: 'off' };
    this.discovery = 'off';
  }

  private async lookUpPortOwner(port: number, generation: number): Promise<void> {
    const owner = await this.deps.findPortOwner(port).catch((error: unknown) => {
      this.deps.log(`[ipp] cannot find the owner of port ${port}: ${String(error)}`);
      return null;
    });
    if (generation === this.generation && owner !== null) {
      this.portOwner = owner;
      this.publish();
    }
  }

  /** 纸张分配表里、打印机这台电脑上装着的那些纸。 */
  private async loadPrinters(): Promise<void> {
    const settings = this.deps.settings();
    const installed = new Set(
      await this.deps.installedPrinters().catch((error: unknown) => {
        // 读不到打印机列表（例如主窗口还没建好）：先当作没有，下次刷新再读。
        this.deps.log(`[ipp] cannot list printers: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }),
    );
    const instanceId = settings.ippInstanceId ?? '';
    const location = this.deps.computerName();
    const entries = new Map<string, PrinterEntry>();
    for (const [key, printerName] of Object.entries(settings.paperPrinters)) {
      const paper = parsePaperKey(key);
      if (paper === null || !installed.has(printerName)) {
        continue;
      }
      const name = formatPaperName(paper);
      entries.set(key, {
        printerName,
        printer: {
          key,
          paper,
          name,
          info: `${name}（${location} 上的热敏标签机）`,
          makeAndModel: this.deps.makeAndModel,
          deviceId: `MFG:${this.deps.productNameAscii};MDL:Label ${key};CMD:PDF,PWGRaster,URF,JPEG,PNG;CLS:PRINTER;`,
          location,
          dpi: await this.deps.dpiOf(printerName),
          uuid: printerUuid(instanceId, key),
        },
      });
    }
    this.entries = entries;
  }

  /** 共享打印机，状态（缺纸、离线、正在打印）每次实时算。 */
  private sharedPrinters(): ReadonlyMap<string, SharedPrinter> {
    const printers = new Map<string, SharedPrinter>();
    for (const [key, entry] of this.entries) {
      const active = this.book.activeFor(key);
      printers.set(key, {
        ...entry.printer,
        state: sharedPrinterState(this.deps.readinessOf(entry.printerName), active),
        queuedJobCount: active,
      });
    }
    return printers;
  }

  private dpiFor(paper: PaperSize): number {
    return this.entries.get(paperKey(paper))?.printer.dpi ?? FALLBACK_DPI;
  }

  private hostLabel(): string {
    const id = (this.deps.settings().ippInstanceId ?? '').replaceAll('-', '').slice(0, HOST_ID_CHARS);
    return hostLabelFor(id, this.names.hostSerial);
  }

  private zoneFor(iface: LanInterface): MdnsZone {
    const host = this.hostLabel();
    const context = {
      port: this.server.port() ?? 0,
      hostName: `${host}.${MDNS_DOMAIN}`,
      computerName: this.deps.computerName(),
      productNameAscii: this.deps.productNameAscii,
      authentication: this.password.isSet() ? ('basic' as const) : ('none' as const),
      serial: this.names.instanceSerial,
    };
    return {
      host: [host, MDNS_DOMAIN],
      address: iface.address,
      services: [...this.sharedPrinters().values()].map((printer) => ippAdvert(printer, context)),
    };
  }

  /**
   * 探测时别的设备在用我们的名字：主机名撞了换主机名，实例名撞了换实例名，再探测、宣告；
   * 一轮里换太多次就先停广播，过一会儿从头再试（不永久放弃，按地址添加一直能用）。
   */
  private async renameAfterConflict(conflicting: DnsName[]): Promise<void> {
    this.deps.log(`[ipp] renaming after a conflict on ${conflicting.map((name) => name.join('.')).join(', ')}`);
    const next = renamedAfterConflict(this.names, conflicting, [this.hostLabel(), MDNS_DOMAIN]);
    if (next === null) {
      await this.restarts.run(() => this.advertiser.stop());
      this.discovery = 'failed';
      this.publish();
      this.scheduleDiscoveryRetry();
      return;
    }
    this.names = next;
    await this.restarts.run(() => this.advertiser.refresh());
  }

  /** 自动发现失败后稍后重试：名字从头来，等的时间越来越长（最多 15 分钟）。 */
  private scheduleDiscoveryRetry(): void {
    this.cancelDiscoveryRetry();
    const generation = this.generation;
    const delayMs = discoveryRetryDelayMs(this.discoveryAttempts);
    this.discoveryAttempts += 1;
    this.deps.log(`[ipp] retrying discovery in ${delayMs}ms`);
    this.cancelRetry = this.deps.schedule(() => {
      this.cancelRetry = null;
      void this.restarts.run(async () => {
        if (generation !== this.generation || this.serverState.state !== 'listening') {
          return;
        }
        this.names = FIRST_NAMES;
        await this.startDiscovery();
        this.publish();
      });
    }, delayMs);
  }

  private cancelDiscoveryRetry(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  private publish(): void {
    // 退出的最后关头数据库可能已经关了（读不到密码、记住的电脑）：推不出状态只写日志，不打断停共享。
    try {
      this.deps.onStatus(this.status());
    } catch (error) {
      this.deps.log(
        `[ipp] cannot publish the sharing status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
