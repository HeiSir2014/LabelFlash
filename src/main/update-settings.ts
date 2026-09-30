import type { AppUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/update-status';

/**
 * 启动时的更新状态：只有打包好的 Windows 版自动更新。
 * macOS 的安装包（pkg）没有 Apple 开发者签名，Squirrel.Mac 装更新前要校验签名，校验不过，下载了也装不上；
 * 所以不检查，由「关于」提示去发布页下载。有了签名和公证之后再打开。
 */
export function initialUpdateStatus(platform: NodeJS.Platform, isPackaged: boolean): UpdateStatus {
  if (!isPackaged) {
    return { state: 'disabled', reason: 'development' };
  }
  return platform === 'win32' ? { state: 'idle' } : { state: 'disabled', reason: 'unsupported-platform' };
}

/** 更新客户端里我们依赖的那些行为。 */
export type UpdateClientSettings = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'autoRunAppAfterInstall'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'disableWebInstaller'
  | 'disableDifferentialDownload'
>;

/**
 * 全部显式设置，不依赖 electron-updater 的默认值：库升级时默认值变了，更新方式也不会悄悄跟着变。
 */
const UPDATE_CLIENT_SETTINGS: Readonly<UpdateClientSettings> = {
  // 后台自动下载；下载完成后由操作员点「重启更新」决定何时安装，窗口关在托盘里没人用时也会静默装（background-update.ts）。
  autoDownload: true,
  // 操作员一直没点「重启更新」：退出程序时静默安装，下次打开就是新版。
  autoInstallOnAppQuit: true,
  // 点「重启更新」时，安装界面装完后启动新版。
  autoRunAppAfterInstall: true,
  // 发布流程只打正式 Release，客户端也只接收正式版，不回退到旧版本。
  allowPrerelease: false,
  allowDowngrade: false,
  // 发布的是完整安装包（附 blockmap，可差分下载），没有网页安装包。
  // 不关掉这条路径，electron-updater 每次下载都会在日志里提醒一次。
  disableWebInstaller: true,
  disableDifferentialDownload: false,
};

/**
 * 安装更新的方式：静默安装，不弹安装界面（点一次「重启更新」就够，界面上的进度对操作员没有用），
 * 装完由安装程序带 --updated 启动新版本；新版本的窗口去哪由 relaunch-intent.ts 决定。
 */
export const INSTALL_OPTIONS = { isSilent: true, isForceRunAfter: true } as const;

export function applyUpdateClientSettings(client: UpdateClientSettings): void {
  Object.assign(client, UPDATE_CLIENT_SETTINGS);
}
