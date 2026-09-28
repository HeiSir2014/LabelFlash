import { app } from 'electron';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/update-status';

/** 启动后稍等再检查，不拖慢启动；之后定期检查（车间电脑常常整天不关）。 */
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface AppUpdaterOptions {
  onStatus: (status: UpdateStatus) => void;
  /** quitAndInstall 会先关闭所有窗口：调用前必须放行「关闭即隐藏到托盘」。 */
  onBeforeInstall: () => void;
}

/**
 * 自动更新（GitHub Releases + electron-updater）：后台下载，下载完成后由操作员决定何时重启安装；
 * 不重启的话，退出程序时自动安装。开发模式下禁用。
 */
export class AppUpdater {
  private status: UpdateStatus = app.isPackaged ? { state: 'idle' } : { state: 'disabled' };
  private pendingVersion = '';

  constructor(private readonly options: AppUpdaterOptions) {}

  get current(): UpdateStatus {
    return this.status;
  }

  start(): void {
    if (!app.isPackaged) {
      return;
    }
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.setStatus({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.setStatus({ state: 'up-to-date', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) => {
      this.pendingVersion = info.version;
      this.setStatus({ state: 'downloading', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({ state: 'downloading', version: this.pendingVersion, percent: Math.round(progress.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => this.setStatus({ state: 'ready', version: info.version }));
    autoUpdater.on('error', (error) => {
      console.error('[updater] update failed', error);
      this.setStatus({ state: 'error' });
    });
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    setInterval(() => void this.check(), CHECK_INTERVAL_MS);
  }

  async check(): Promise<void> {
    if (this.status.state === 'disabled' || this.status.state === 'downloading' || this.status.state === 'ready') {
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('[updater] check failed', error);
      this.setStatus({ state: 'error' });
    }
  }

  install(): void {
    if (this.status.state !== 'ready') {
      return;
    }
    this.options.onBeforeInstall();
    autoUpdater.quitAndInstall();
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.options.onStatus(status);
  }
}
