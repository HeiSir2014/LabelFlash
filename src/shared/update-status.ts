/** 自动更新的状态：主进程推送给界面，界面据此显示标题栏提示和「关于」里的更新状态。 */
export type UpdateStatus =
  /** development：开发版；unsupported-platform：这个平台的安装包不能自动更新（macOS 的安装包没有 Apple 开发者签名）。 */
  | { state: 'disabled'; reason: 'development' | 'unsupported-platform' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: number }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error' };

/** 点「重启更新」的结果：批量打印还在打或暂停中时拒绝安装（quitAndInstall 会在确认框之前就
 *  把安装程序拉起来，没法像退出那样先弹确认），operator 要先打完或取消这一批。
 *  canceled：模板有没保存的修改，装之前问了，操作员选了「取消」。 */
export type InstallUpdateResult = { status: 'ok' } | { status: 'canceled' } | { status: 'refused'; issue: string };
