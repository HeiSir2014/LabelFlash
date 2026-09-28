import type { AppUpdater } from 'electron-updater';

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
  // 后台自动下载；下载完成后由操作员点「重启更新」决定何时安装。
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

export function applyUpdateClientSettings(client: UpdateClientSettings): void {
  Object.assign(client, UPDATE_CLIENT_SETTINGS);
}
