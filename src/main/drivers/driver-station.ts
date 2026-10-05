import { catalogDriverHints } from '../../core/drivers/catalog-hints';
import type { CatalogModel, DriverCatalog } from '../../core/drivers/catalog-model';
import type { DetectedDevice } from '../../core/drivers/detected-device';
import { type DriverHints, NO_DRIVER_HINTS } from '../../core/drivers/driver-hints';
import { type InstallFlowDeps, type InstallState, runDriverInstall } from '../../core/drivers/driver-install-flow';
import {
  actionFor,
  type DriverPlatform,
  findModelById,
  findModelByUsbId,
  type InstallTarget,
} from '../../core/drivers/install-plan';
import { formatUsbId } from '../../core/drivers/usb-id';
import type { Clock } from '../../core/types';
import type {
  CatalogView,
  DeviceActionView,
  DriverDeviceView,
  DriverInstallView,
  DriverStatus,
} from '../../shared/drivers';
import type { CatalogLoad } from './catalog-client';

export interface DeviceSource {
  /** 这台电脑上缺驱动的 USB 设备；macOS 要靠清单认型号，所以传入当前清单。检测失败时抛错。 */
  detect(catalog: DriverCatalog | null): Promise<DetectedDevice[]>;
}

export interface CatalogSource {
  load(force: boolean): Promise<CatalogLoad>;
  current(): DriverCatalog | null;
}

export interface DriverStationDeps {
  /** null = 这个平台不支持自动装驱动。 */
  platform: DriverPlatform | null;
  catalog: CatalogSource;
  devices: DeviceSource;
  flow: Omit<InstallFlowDeps, 'log'>;
  openExternal: (url: string) => Promise<void>;
  onStatus: (status: DriverStatus) => void;
  clock: Clock;
  log: (line: string) => void;
}

/** 下载进度最多 0.25 秒推一次（和批量打印的进度一样）；换步骤、结束立即推。 */
export const PROGRESS_PUSH_INTERVAL_MS = 250;

/**
 * 「驱动」一节在主进程的一侧：清单、检测到的设备、同一时间只有一个的安装。
 * 界面只能按设备编号（或 5b 按打印机）发起安装，不能指定地址或安装包。
 */
export class DriverStation {
  private catalogLoad: CatalogLoad | null = null;
  private devices: DetectedDevice[] | null = null;
  private detectIssue: string | null = null;
  private detecting: Promise<DriverStatus> | null = null;
  private isDetecting = false;
  private installView: DriverInstallView | null = null;
  private installCount = 0;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private lastPushAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: DriverStationDeps) {}

  /** 正在装驱动（后台静默更新要等它）。 */
  get isInstalling(): boolean {
    return this.installView?.state.phase === 'running';
  }

  status(): DriverStatus {
    const catalog = this.currentCatalog();
    return {
      platform: this.deps.platform ?? 'unsupported',
      catalog: catalogView(this.catalogLoad),
      devices: this.devices === null ? null : this.devices.flatMap((device) => this.deviceView(device, catalog)),
      isDetecting: this.isDetecting,
      detectIssue: this.detectIssue,
      install: this.installView,
    };
  }

  /** 读清单（force：不管刷新间隔，重新下载）并检测设备；同时只跑一次，重复调用拿到同一个结果。 */
  detect(force: boolean): Promise<DriverStatus> {
    if (this.deps.platform === null) {
      return Promise.resolve(this.status());
    }
    if (this.detecting === null) {
      // 先标记再推送：界面立即看到「检测中…」（runDetect 里的第一个 await 之前，detecting 还没赋值）。
      this.isDetecting = true;
      this.push(true);
      // 调用方（IPC 的返回值）和 onStatus 推送必须是同一份状态：runDetect() 自己返回的快照里 isDetecting 还是
      // true（它在 isDetecting 被置回 false 之前就生成了），直接把它当 detect() 的结果会把界面的「检测中」状态
      // 卡死——IPC 的返回值和随后的推送谁先到达渲染进程不确定，用旧快照覆盖新推送就再也不会恢复。
      // 这里在标记复位之后重新取一次 status()，保证两边看到的都是检测结束后的状态。
      this.detecting = this.runDetect(force).then(() => {
        this.detecting = null;
        this.isDetecting = false;
        this.push(true);
        return this.status();
      });
    }
    return this.detecting;
  }

  /** 给「驱动」一节里列出的一台设备装驱动；进度经 onStatus 推送。已有安装在进行、设备不认识或没有安装包时抛错。 */
  install(deviceKey: string): DriverStatus {
    const device = this.devices?.find((item) => item.key === deviceKey);
    const catalog = this.currentCatalog();
    if (!device || catalog === null) {
      throw new Error(`Unknown driver device: ${deviceKey}`);
    }
    this.start(this.requireTarget(findModelByUsbId(catalog, device.usbId)), deviceKey);
    return this.status();
  }

  /** 按型号编号装（5b 的「重新安装驱动」经驱动名找到型号后调用）。 */
  async installModel(modelId: string): Promise<DriverStatus> {
    await this.ensureCatalog();
    const catalog = this.currentCatalog();
    this.start(this.requireTarget(catalog === null ? null : findModelById(catalog, modelId)), null);
    return this.status();
  }

  cancelInstall(): void {
    this.controller?.abort();
  }

  /** 等正在进行的安装（含之后的重新检测）结束：测试和退出时用。 */
  async settled(): Promise<void> {
    await this.running;
  }

  /** 打开清单里这台设备的官方下载页（只有 open-page 的设备；地址来自签过名的清单，再核对一次是 https）。 */
  async openDownloadPage(deviceKey: string): Promise<void> {
    const device = this.devices?.find((item) => item.key === deviceKey);
    const catalog = this.currentCatalog();
    const model = device && catalog ? findModelByUsbId(catalog, device.usbId) : null;
    const action = this.deps.platform === null ? null : actionFor(model, this.deps.platform);
    if (action?.kind !== 'open-page' || new URL(action.url).protocol !== 'https:') {
      throw new Error(`No download page for driver device: ${deviceKey}`);
    }
    this.deps.log(`[drivers] opening the download page of ${action.model.id}: ${action.url}`);
    await this.deps.openExternal(action.url);
  }

  /** 给 5a、5b：按驱动名查当前清单（不触发下载；清单不可用时什么都查不到）。 */
  hints(): DriverHints {
    const catalog = this.currentCatalog();
    return catalog === null || this.deps.platform === null
      ? NO_DRIVER_HINTS
      : catalogDriverHints(catalog, this.deps.platform);
  }

  /** 设置里的清单地址变了：检测过的话立即按新地址重新检测。 */
  catalogUrlChanged(): void {
    if (this.devices !== null || this.catalogLoad !== null) {
      void this.detect(true);
    }
  }

  private currentCatalog(): DriverCatalog | null {
    return this.deps.catalog.current();
  }

  private async ensureCatalog(): Promise<void> {
    this.catalogLoad = await this.deps.catalog.load(false);
  }

  private async runDetect(force: boolean): Promise<DriverStatus> {
    this.catalogLoad = await this.deps.catalog.load(force);
    try {
      this.devices = await this.deps.devices.detect(this.currentCatalog());
      this.detectIssue = null;
    } catch (error) {
      this.deps.log(`[drivers] USB device detection failed: ${error instanceof Error ? error.message : String(error)}`);
      this.detectIssue = '检测 USB 设备失败，详情见日志：稍后点「重新检测」';
    }
    return this.status();
  }

  private requireTarget(model: CatalogModel | null): InstallTarget {
    if (this.deps.platform === null) {
      throw new Error('Driver install is not supported on this platform');
    }
    if (this.isInstalling) {
      throw new Error('A driver install is already running');
    }
    const action = actionFor(model, this.deps.platform);
    if (action.kind !== 'install') {
      throw new Error(`Nothing to install for ${model?.id ?? 'an unknown model'} (${action.kind})`);
    }
    return action.target;
  }

  private start(target: InstallTarget, deviceKey: string | null): void {
    const controller = new AbortController();
    this.controller = controller;
    this.installCount += 1;
    this.installView = {
      id: this.installCount,
      modelId: target.model.id,
      deviceKey,
      brand: target.model.brand,
      model: target.model.model,
      state: { phase: 'running', step: 'downloading', receivedBytes: 0, totalBytes: target.package.sizeBytes },
    };
    this.push(true);
    this.running = this.run(target, controller.signal);
  }

  private async run(target: InstallTarget, signal: AbortSignal): Promise<void> {
    try {
      await runDriverInstall(
        target,
        { ...this.deps.flow, log: this.deps.log },
        (state) => this.setState(state),
        signal,
      );
    } catch (error) {
      this.deps.log(
        `[drivers] install of ${target.model.id} stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.setState({ phase: 'failed', failure: 'internal', exitCode: null });
    } finally {
      this.controller = null;
    }
    // 装好的设备不再缺驱动：重新检测一次，列表跟着变。
    await this.detect(false);
  }

  private setState(state: InstallState): void {
    const current = this.installView;
    if (current === null) {
      return;
    }
    const isSameStep =
      current.state.phase === 'running' && state.phase === 'running' && current.state.step === state.step;
    this.installView = { ...current, state };
    this.push(!isSameStep);
  }

  private push(immediately: boolean): void {
    const now = this.deps.clock.now();
    if (!immediately && now - this.lastPushAt < PROGRESS_PUSH_INTERVAL_MS) {
      return;
    }
    this.lastPushAt = now;
    this.deps.onStatus(this.status());
  }

  private deviceView(device: DetectedDevice, catalog: DriverCatalog | null): DriverDeviceView[] {
    const model = catalog === null ? null : findModelByUsbId(catalog, device.usbId);
    if (model === null && !device.isPrinterClass) {
      return [];
    }
    return [
      {
        key: device.key,
        name: device.name,
        usbId: formatUsbId(device.usbId),
        problem: device.problem,
        problemCode: device.problemCode,
        action: this.actionView(catalog, model),
      },
    ];
  }

  private actionView(catalog: DriverCatalog | null, model: CatalogModel | null): DeviceActionView {
    if (catalog === null || this.deps.platform === null) {
      return { kind: 'no-catalog' };
    }
    const action = actionFor(model, this.deps.platform);
    switch (action.kind) {
      case 'install':
        return {
          kind: 'install',
          brand: action.target.model.brand,
          model: action.target.model.model,
          sizeBytes: action.target.package.sizeBytes,
        };
      case 'open-page':
      case 'no-package':
        return { kind: action.kind, brand: action.model.brand, model: action.model.model };
      case 'not-in-catalog':
        return { kind: 'not-in-catalog' };
    }
  }
}

function catalogView(load: CatalogLoad | null): CatalogView {
  if (load === null) {
    return { state: 'loading' };
  }
  switch (load.kind) {
    case 'unconfigured':
      return { state: 'unconfigured' };
    case 'failed':
      return { state: 'failed', issue: load.issue };
    case 'ready':
      return {
        state: 'ready',
        issuedAt: load.catalog.issuedAt,
        expiresAt: load.catalog.expiresAt,
        modelCount: load.catalog.models.length,
        staleIssue: load.staleIssue,
      };
  }
}
